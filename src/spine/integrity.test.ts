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
        actor: "james",
        name: "task.create",
        args: { title: "Original title" },
      }),
    );
    const taskId = (created.result?.response as { taskId?: string })?.taskId as string;

    const edit = await spine.submit(
      adapters.fromForm({
        actor: "james",
        name: "task.edit",
        args: { taskId, title: "Edited title" },
      }),
    );
    expect(edit.status).toBe("ran");

    // Stand in for a restart: a brand-new Spine over the same stores has an
    // empty in-process undo map, exactly like a fresh process would.
    const restarted = new Spine(deps);

    const entry = await deps.log.get(edit.activityEntry!.id);
    expect(entry).toBeDefined();
    // `task.edit` now ships a plan of its own, so the entry carries one. Strip
    // it to reach the case this test exists for: an entry whose only undo was
    // a closure the restart threw away.
    const shipped = entry!.undoPlan;
    expect(shipped).toBeDefined();
    entry!.undoPlan = undefined;

    const withoutPlan = await restarted.undo(edit.activityEntry!.id, "james");
    expect(withoutPlan.status).toBe("rejected");
    expect(withoutPlan.detail).toContain("No undo is available");

    // With a plan on the entry, the same restarted spine can revert it.
    const plan: UndoStep[] = [
      { op: "patch", nodeType: "task", nodeId: taskId, data: { title: "Original title" } },
    ];
    entry!.undoPlan = plan;

    const replayed = await restarted.undo(edit.activityEntry!.id, "james");
    expect(replayed.status).toBe("undone");
    const data = (await deps.graph.getNode("task", taskId))?.data as { title: string };
    expect(data.title).toBe("Original title");
  });

  it("reverts a whole meeting — record, calendar entry, edge and room — from the plan alone", async () => {
    const { spine, deps } = await buildDemoWorld();

    const created = await spine.submit(
      adapters.fromForm({
        actor: "james",
        name: "meeting.create",
        args: {
          title: "Course review",
          // `both` is the default kind, so this is the ordinary path rather
          // than a special case: a link AND a room.
          kind: "both",
          from: "2026-12-01T15:00:00Z",
          to: "2026-12-01T16:00:00Z",
          attendees: ["priya", "arun"],
        },
      }),
    );
    expect(created.status).toBe("ran");
    const { meetingId, entryId, bookingId } = created.result?.response as {
      meetingId: string;
      entryId: string;
      bookingId: string;
    };
    expect(bookingId).toBeTruthy();

    // Stand in for a restart: a brand-new Spine over the same stores has an
    // empty in-process undo map, exactly like a fresh process would. So the
    // closure is gone and only the persisted plan can do this.
    const restarted = new Spine(deps);
    const entry = await deps.log.get(created.activityEntry!.id);
    expect(entry!.undoPlan?.length).toBeGreaterThan(0);

    const replayed = await restarted.undo(created.activityEntry!.id, "james");
    expect(replayed.status).toBe("undone");

    // All four, or the undo left something behind: a calendar entry people
    // plan around, or a room blocked for a meeting nobody can see.
    expect(await deps.graph.getNode("meeting", meetingId)).toBeUndefined();
    expect(await deps.graph.getNode("calendar-entry", entryId)).toBeUndefined();
    expect(await deps.graph.getNode("booking", bookingId)).toBeUndefined();
    expect(await deps.graph.edgesOf(meetingId, "out")).toEqual([]);
  });

  it("reverts a meeting cancellation from the plan alone, room included", async () => {
    const { spine, deps } = await buildDemoWorld();
    const created = await spine.submit(
      adapters.fromForm({
        actor: "james",
        name: "meeting.create",
        args: {
          title: "Standup",
          kind: "in-person",
          from: "2026-12-02T09:00:00Z",
          to: "2026-12-02T09:30:00Z",
          attendees: ["priya"],
        },
      }),
    );
    const { meetingId, entryId, bookingId } = created.result?.response as {
      meetingId: string;
      entryId: string;
      bookingId: string;
    };
    const cancelled = await spine.submit(
      adapters.fromForm({ actor: "james", name: "meeting.cancel", args: { meetingId } }),
    );
    expect(await deps.graph.getNode("booking", bookingId)).toBeUndefined();

    const restarted = new Spine(deps);
    const replayed = await restarted.undo(cancelled.activityEntry!.id, "james");
    expect(replayed.status).toBe("undone");

    // `put` replaces the record wholesale with what was there before the
    // cancellation, where `cancelled` was absent rather than false.
    expect(
      ((await deps.graph.getNode("meeting", meetingId))?.data as { cancelled?: boolean }).cancelled,
    ).toBeFalsy();
    expect(
      ((await deps.graph.getNode("calendar-entry", entryId))?.data as { cancelled?: boolean })
        .cancelled,
    ).toBeFalsy();
    // The room comes back, or the meeting returns to the calendar with nowhere
    // to happen.
    expect(await deps.graph.getNode("booking", bookingId)).toBeTruthy();
  });

  it("refuses to undo the same entry twice", async () => {
    const { spine } = await buildDemoWorld();
    const created = await spine.submit(
      adapters.fromForm({ actor: "james", name: "task.create", args: { title: "Once" } }),
    );
    const taskId = (created.result?.response as { taskId?: string })?.taskId as string;
    const done = await spine.submit(
      adapters.fromForm({ actor: "james", name: "task.complete", args: { taskId } }),
    );

    expect((await spine.undo(done.activityEntry!.id, "james")).status).toBe("undone");
    const again = await spine.undo(done.activityEntry!.id, "james");
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
      "org-memory", "utility-capture", "onboarding",
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
