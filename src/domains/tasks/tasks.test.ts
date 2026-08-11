import { describe, it, expect } from "vitest";
import { buildDemoWorld } from "@/server/bootstrap";
import * as adapters from "@/spine/adapters";

function world() {
  return buildDemoWorld();
}

describe("task.edit — gated, undoable", () => {
  it("an employee edits title and priority of a task", async () => {
    const { spine, deps } = await world();
    const created = await spine.submit(
      adapters.fromForm({ actor: "priya", name: "task.create", args: { title: "Draft module" } }),
    );
    const taskId = (created.result?.response as { taskId?: string })?.taskId as string;

    const edit = await spine.submit(
      adapters.fromForm({
        actor: "priya",
        name: "task.edit",
        args: { taskId, title: "Draft module (revised)", priority: "high", dueDate: "2026-09-01" },
      }),
    );
    expect(edit.status).toBe("ran");
    const data = (await deps.graph.getNode("task", taskId))?.data as Record<string, unknown>;
    expect(data.title).toBe("Draft module (revised)");
    expect(data.priority).toBe("high");
    expect(data.dueDate).toBe("2026-09-01");

    const undone = await spine.undo(edit.activityEntry!.id, "priya");
    expect(undone.status).toBe("undone");
    expect(((await deps.graph.getNode("task", taskId))?.data as { title: string }).title).toBe("Draft module");
  });
});

describe("task.delete — admin-only via gate", () => {
  it("an admin can delete a task", async () => {
    const { spine, deps } = await world();
    const created = await spine.submit(
      adapters.fromForm({ actor: "priya", name: "task.create", args: { title: "Temp" } }),
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
      adapters.fromForm({ actor: "priya", name: "task.create", args: { title: "Mine" } }),
    );
    const taskId = (created.result?.response as { taskId?: string })?.taskId as string;

    const del = await spine.submit(
      adapters.fromForm({ actor: "arun", name: "task.delete", args: { taskId } }),
    );
    expect(del.status).toBe("forbidden");
  });
});

describe("export — canExport respects export ≠ view", () => {
  it("hr can export employees, an employee cannot", async () => {
    const { spine } = await world();
    expect(spine.canExport("shruti", "employee")).toBe(true);
    expect(spine.canExport("priya", "employee")).toBe(false);
  });
});
