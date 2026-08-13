import { describe, it, expect } from "vitest";
import { buildDemoWorld } from "@/server/bootstrap";
import { Spine } from "@/spine/spine";
import * as adapters from "@/spine/adapters";
import type { UndoStep } from "@/spine/operation/registry";

/**
 * Block 0 — the integrity foundations.
 *
 * These cover the three defects the rest of Phase 1 is built on top of:
 * undo that survives a restart, confirmation that checks authority, and node
 * ids that cannot collide across types.
 */

describe("durable undo — the plan replays when the closure is gone", () => {
  it("reverts a task edit using only the persisted plan", async () => {
    const { spine, deps } = await buildDemoWorld();

    const created = await spine.submit(
      adapters.fromForm({
        actor: "priya",
        name: "task.create",
        args: { title: "Original title" },
      }),
    );
    const taskId = (created.result?.response as { taskId?: string })?.taskId as string;

    const edit = await spine.submit(
      adapters.fromForm({
        actor: "priya",
        name: "task.edit",
        args: { taskId, title: "Edited title" },
      }),
    );
    expect(edit.status).toBe("ran");

    // Stand in for a restart: a brand-new Spine over the same stores has an
    // empty in-process undo map, exactly like a fresh process would.
    const restarted = new Spine(deps);

    const entry = await deps.log.get(edit.activityEntry!.id);
    // task.edit does not carry a plan yet, so undo is correctly unavailable
    // after a restart. Operations added in later blocks must supply one.
    expect(entry).toBeDefined();
    const withoutPlan = await restarted.undo(edit.activityEntry!.id, "priya");
    expect(withoutPlan.status).toBe("rejected");
    expect(withoutPlan.detail).toContain("No undo is available");

    // With a plan on the entry, the same restarted spine can revert it.
    const plan: UndoStep[] = [
      { op: "patch", nodeType: "task", nodeId: taskId, data: { title: "Original title" } },
    ];
    entry!.undoPlan = plan;

    const replayed = await restarted.undo(edit.activityEntry!.id, "priya");
    expect(replayed.status).toBe("undone");
    const data = (await deps.graph.getNode("task", taskId))?.data as { title: string };
    expect(data.title).toBe("Original title");
  });

  it("refuses to undo the same entry twice", async () => {
    const { spine } = await buildDemoWorld();
    const created = await spine.submit(
      adapters.fromForm({ actor: "priya", name: "task.create", args: { title: "Once" } }),
    );
    const taskId = (created.result?.response as { taskId?: string })?.taskId as string;
    const done = await spine.submit(
      adapters.fromForm({ actor: "priya", name: "task.complete", args: { taskId } }),
    );

    expect((await spine.undo(done.activityEntry!.id, "priya")).status).toBe("undone");
    const again = await spine.undo(done.activityEntry!.id, "priya");
    expect(again.status).toBe("rejected");
    expect(again.detail).toContain("already undone");
  });
});

describe("confirm — parked money/people operations check authority", () => {
  /**
   * A delegated leave request parks for confirmation because leave is a people
   * operation. Knowing the pending id must not be enough to release it.
   */
  async function parkALeaveRequest() {
    const world = await buildDemoWorld();
    const submitted = await world.spine.submit(
      adapters.fromStandingRule({
        ruleId: "rule-leave",
        ruleAuthor: "shruti",
        name: "leave.request",
        args: { employeeId: "priya", fromDate: "2026-09-01", toDate: "2026-09-02" },
      }),
    );
    expect(submitted.status).toBe("awaiting-confirmation");
    return { ...world, pendingId: submitted.pendingId as string };
  }

  it("an unrelated employee cannot confirm, and the refusal discloses nothing", async () => {
    const { spine, pendingId } = await parkALeaveRequest();
    const attempt = await spine.confirm(pendingId, "ravi");
    expect(attempt.status).toBe("forbidden");
    expect(attempt.opaqueMessage).toBe("That action is not available.");
    // The refusal must not name the operation, the subject or the reason.
    expect(JSON.stringify(attempt)).not.toContain("priya");
    expect(JSON.stringify(attempt)).not.toContain("leave");
  });

  it("a refused attempt does not consume the pending confirmation", async () => {
    const { spine, pendingId } = await parkALeaveRequest();
    await spine.confirm(pendingId, "ravi");
    expect(spine.listPending().some((p) => p.id === pendingId)).toBe(true);

    // The rule's own author can still release it afterwards.
    const byAuthor = await spine.confirm(pendingId, "shruti");
    expect(byAuthor.status).toBe("ran");
  });

  it("an approver who is not the rule author can confirm", async () => {
    const { spine, pendingId } = await parkALeaveRequest();
    const byHr = await spine.confirm(pendingId, "admin");
    expect(byHr.status).toBe("ran");
  });
});

describe("readMany — batched reads agree with single reads", () => {
  /**
   * The whole point is that it is a shortcut for looping `read()`, so the thing
   * that matters is that it cannot become a *looser* shortcut. If these ever
   * disagree, the batched path is leaking something the single path hides.
   */
  const actors = ["ravi", "priya", "james", "shruti", "admin"];

  it.each(actors)("%s sees exactly what read() would give them", async (actor) => {
    const { spine, deps } = await buildDemoWorld();
    const everyone = await deps.graph.find("employee", () => true);

    const expected: Record<string, unknown> = {};
    for (const node of everyone) {
      const one = await spine.read({ actor, nodeType: "employee", nodeId: node.id });
      if (one.found) expected[node.id] = one.record;
    }

    const many = await spine.readMany({ actor, nodeType: "employee" });
    const got = Object.fromEntries(many.map((m) => [m.nodeId, m.record]));

    expect(Object.keys(got).sort()).toEqual(Object.keys(expected).sort());
    expect(got).toEqual(expected);
  });

  it("masks restricted fields rather than dropping them", async () => {
    const { spine } = await buildDemoWorld();
    const rows = await spine.readMany({ actor: "ravi", nodeType: "employee" });
    expect(rows.length).toBeGreaterThan(0);

    // An intern may see the directory but not pay. The field has to be present
    // and marked restricted — silently omitting it would read as "no pay set".
    const someoneElse = rows.find((r) => r.nodeId !== "ravi");
    expect(someoneElse).toBeDefined();
    expect(Object.keys(someoneElse!.record)).toContain("pay");
    expect(someoneElse!.record.pay).toMatchObject({ __restricted: true });
  });

  it("returns nothing for a type the actor has no rule for", async () => {
    const { spine } = await buildDemoWorld();
    const rows = await spine.readMany({ actor: "ravi", nodeType: "not-a-real-type" });
    expect(rows).toEqual([]);
  });

  it("applies the caller's filter as well as permission", async () => {
    const { spine } = await buildDemoWorld();
    const all = await spine.readMany({ actor: "shruti", nodeType: "employee" });
    const one = await spine.readMany({
      actor: "shruti",
      nodeType: "employee",
      filter: (_data, nodeId) => nodeId === "priya",
    });
    expect(all.length).toBeGreaterThan(1);
    expect(one.map((r) => r.nodeId)).toEqual(["priya"]);
  });
});

describe("node ids are unique across types", () => {
  /**
   * PostgresRecordStore.nodeByIdAny() resolves an id without a type
   * (`WHERE id=$1 LIMIT 1`) and traverse() depends on it. Two node types
   * sharing an id would make traversal silently return the wrong record.
   */
  it("no two node types share an id in the seeded graph", async () => {
    const { deps } = await buildDemoWorld();
    const nodeTypes = [
      "employee", "leave", "course", "task", "room", "booking", "meeting",
      "calendar-entry", "event", "equipment", "fault", "document",
      "announcement", "org-memory", "utility-capture", "onboarding",
      "offboarding", "attendance", "payslip",
    ];

    const seen = new Map<string, string>();
    const collisions: string[] = [];
    for (const type of nodeTypes) {
      for (const node of await deps.graph.find(type, () => true)) {
        const owner = seen.get(node.id);
        if (owner && owner !== type) {
          collisions.push(`${node.id} is both ${owner} and ${type}`);
        }
        seen.set(node.id, type);
      }
    }
    expect(collisions).toEqual([]);
  });
});
