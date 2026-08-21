import { describe, it, expect } from "vitest";
import { buildDemoWorld } from "@/server/bootstrap";
import * as adapters from "@/spine/adapters";
import { Spine } from "@/spine/spine";

function world() {
  return buildDemoWorld();
}

describe("task.edit — gated, undoable", () => {
  it("a manager edits title and priority of a task", async () => {
    const { spine, deps } = await world();
    const created = await spine.submit(
      adapters.fromForm({ actor: "james", name: "task.create", args: { title: "Draft module" } }),
    );
    const taskId = (created.result?.response as { taskId?: string })?.taskId as string;

    const edit = await spine.submit(
      adapters.fromForm({
        actor: "james",
        name: "task.edit",
        args: { taskId, title: "Draft module (revised)", priority: "high", dueDate: "2026-09-01" },
      }),
    );
    expect(edit.status).toBe("ran");
    const data = (await deps.graph.getNode("task", taskId))?.data as Record<string, unknown>;
    expect(data.title).toBe("Draft module (revised)");
    expect(data.priority).toBe("high");
    expect(data.dueDate).toBe("2026-09-01");

    const undone = await spine.undo(edit.activityEntry!.id, "james");
    expect(undone.status).toBe("undone");
    expect(((await deps.graph.getNode("task", taskId))?.data as { title: string }).title).toBe("Draft module");
  });
});

describe("task.delete — admin-only via gate", () => {
  it("an admin can delete a task", async () => {
    const { spine, deps } = await world();
    const created = await spine.submit(
      adapters.fromForm({ actor: "james", name: "task.create", args: { title: "Temp" } }),
    );
    const taskId = (created.result?.response as { taskId?: string })?.taskId as string;

    const del = await spine.submit(
      adapters.fromForm({ actor: "admin", name: "task.delete", args: { taskId } }),
    );
    expect(del.status).toBe("ran");
    expect(await deps.graph.getNode("task", taskId)).toBeUndefined();

    const undone = await spine.undo(del.activityEntry!.id, "admin");
    expect(undone.status).toBe("undone");
    expect(await deps.graph.getNode("task", taskId)).toBeDefined();
  });

  it("an employee cannot delete a task (forbidden, opaque)", async () => {
    const { spine } = await world();
    const created = await spine.submit(
      adapters.fromForm({ actor: "james", name: "task.create", args: { title: "Mine" } }),
    );
    const taskId = (created.result?.response as { taskId?: string })?.taskId as string;

    const del = await spine.submit(
      adapters.fromForm({ actor: "arun", name: "task.delete", args: { taskId } }),
    );
    expect(del.status).toBe("forbidden");
  });
});

describe("undo survives a restart — the serialised plan, not the closure", () => {
  /**
   * A fresh `Spine` over the same stores is what a restart actually looks like
   * to `undo`: the activity log and the graph are still there, but the
   * in-process `undos` map that holds every `revert` closure is empty. Anything
   * without a serialisable `plan` is refused outright at that point.
   */
  const afterRestart = (deps: Awaited<ReturnType<typeof world>>["deps"]) => new Spine(deps);

  it("task.create can be taken back", async () => {
    const { spine, deps } = await world();
    const created = await spine.submit(
      adapters.fromForm({ actor: "james", name: "task.create", args: { title: "Draft", assignedTo: "priya" } }),
    );
    const taskId = (created.result?.response as { taskId?: string })?.taskId as string;
    expect(await deps.graph.getNode("task", taskId)).toBeDefined();

    const undone = await afterRestart(deps).undo(created.activityEntry!.id, "james");
    expect(undone.status).toBe("undone");
    expect(await deps.graph.getNode("task", taskId)).toBeUndefined();
  });

  it("task.assign goes back to whoever held it before", async () => {
    const { spine, deps } = await world();
    const created = await spine.submit(
      adapters.fromForm({ actor: "james", name: "task.create", args: { title: "Review", assignedTo: "priya" } }),
    );
    const taskId = (created.result?.response as { taskId?: string })?.taskId as string;
    const assigned = await spine.submit(
      adapters.fromForm({ actor: "james", name: "task.assign", args: { taskId, assignedTo: "arun" } }),
    );
    expect(assigned.status).toBe("ran");

    const undone = await afterRestart(deps).undo(assigned.activityEntry!.id, "james");
    expect(undone.status).toBe("undone");
    const data = (await deps.graph.getNode("task", taskId))?.data as { assignedTo?: string };
    expect(data.assignedTo).toBe("priya");
  });

  it("task.complete, task.start and task.edit all reverse", async () => {
    const { spine, deps } = await world();
    const created = await spine.submit(
      adapters.fromForm({ actor: "james", name: "task.create", args: { title: "Module" } }),
    );
    const taskId = (created.result?.response as { taskId?: string })?.taskId as string;

    for (const [name, args] of [
      ["task.start", { taskId }],
      ["task.edit", { taskId, title: "Module (revised)" }],
      ["task.complete", { taskId }],
    ] as const) {
      const ran = await spine.submit(adapters.fromForm({ actor: "james", name, args }));
      expect(ran.status).toBe("ran");
      expect((await afterRestart(deps).undo(ran.activityEntry!.id, "james")).status).toBe("undone");
    }
    const data = (await deps.graph.getNode("task", taskId))?.data as { title: string; status: string };
    expect(data.title).toBe("Module");
    expect(data.status).toBe("todo");
  });

  it("a mistaken clock-in can still be taken back", async () => {
    const { spine, deps } = await world();
    const ran = await spine.submit(
      adapters.fromForm({
        actor: "priya",
        name: "attendance.checkIn",
        args: { employeeId: "priya", date: "2026-08-08" },
      }),
    );
    expect(ran.status).toBe("ran");

    const undone = await afterRestart(deps).undo(ran.activityEntry!.id, "priya");
    expect(undone.status).toBe("undone");
    expect(await deps.graph.getNode("attendance", "att_priya_2026-08-08")).toBeUndefined();
  });
});

describe("a task carries its own time estimate", () => {
  it("is kept on create and reused later", async () => {
    const { spine, deps } = await world();
    const created = await spine.submit(
      adapters.fromForm({
        actor: "james",
        name: "task.create",
        args: { title: "Draft module", estimateMinutes: 90 },
      }),
    );
    const taskId = (created.result?.response as { taskId?: string })?.taskId as string;
    expect(((await deps.graph.getNode("task", taskId))?.data as { estimateMinutes?: number }).estimateMinutes).toBe(90);
  });

  it("nonsense is dropped rather than stored", async () => {
    const { spine, deps } = await world();
    const created = await spine.submit(
      adapters.fromForm({
        actor: "james",
        name: "task.create",
        args: { title: "Bad estimate", estimateMinutes: -5 },
      }),
    );
    const taskId = (created.result?.response as { taskId?: string })?.taskId as string;
    expect(((await deps.graph.getNode("task", taskId))?.data as { estimateMinutes?: number }).estimateMinutes).toBeUndefined();
  });

  it("editing keeps the old estimate when none is supplied", async () => {
    const { spine, deps } = await world();
    const created = await spine.submit(
      adapters.fromForm({
        actor: "james",
        name: "task.create",
        args: { title: "Keep me", estimateMinutes: 45 },
      }),
    );
    const taskId = (created.result?.response as { taskId?: string })?.taskId as string;
    await spine.submit(
      adapters.fromForm({ actor: "james", name: "task.edit", args: { taskId, title: "Renamed" } }),
    );
    const data = (await deps.graph.getNode("task", taskId))?.data as {
      title: string;
      estimateMinutes?: number;
    };
    expect(data.title).toBe("Renamed");
    expect(data.estimateMinutes).toBe(45);
  });
});

describe("export — canExport respects export ≠ view", () => {
  it("hr can export employees, an employee cannot", async () => {
    const { spine } = await world();
    expect(spine.canExport("shruti", "employee")).toBe(true);
    expect(spine.canExport("priya", "employee")).toBe(false);
  });
});
