import { describe, it, expect } from "vitest";
import { buildDemoWorld } from "@/server/bootstrap";
import * as adapters from "@/spine/adapters";
import type { PermissionRequirement } from "@/spine/operation/registry";
import { ownerOfRecordData } from "@/domains/people/n1-classification";

/**
 * Write-conformance: every record an operation touches must appear in what it
 * asked the gate about.
 *
 * `leaving.applySeparation` asked permission on one record and wrote another —
 * and it was one of a class, not a one-off. Reviewing 50 handlers by eye found
 * it late; this harness catches the whole class mechanically: it wraps the
 * graph, runs each operation, and compares actual writes against the
 * operation's own permission declaration.
 *
 * Coverage rule: a write to (nodeType, nodeId) conforms when the declaration
 * includes that nodeType with the id listed, or with no ids at all (creation —
 * the id does not exist until execute runs). The open calendar is exempt by
 * design (appendix E).
 */

interface Write {
  kind: "put" | "patch" | "remove";
  nodeType: string;
  nodeId: string;
  /** Effective record data after the write, for person-owner resolution. */
  data?: Record<string, unknown>;
}

async function declaredFor(
  registryGet: (name: string) => { permission: (args: Record<string, unknown>) => unknown } | undefined,
  name: string,
  args: Record<string, unknown>,
): Promise<PermissionRequirement[]> {
  const handler = registryGet(name);
  if (!handler) throw new Error(`No handler ${name}`);
  const declared = await handler.permission(args);
  return (Array.isArray(declared) ? declared : [declared]) as PermissionRequirement[];
}

function conforms(write: Write, declared: PermissionRequirement[]): boolean {
  if (write.nodeType === "calendar-entry") return true;
  const covers = (nodeType: string, nodeId: string) =>
    declared.some((req) => {
      if (req.nodeType !== nodeType) return false;
      const ids = (req as { recordNodeIds?: string[] }).recordNodeIds;
      return !ids || ids.length === 0 || ids.includes(nodeId);
    });
  if (covers(write.nodeType, write.nodeId)) return true;
  // Person-equivalence: HR records are person-scoped — the unit of authority
  // is the person, so `leave.approve` declares "approve employee:priya" and
  // the gate resolves it against her manager's own-team rule. A write to a
  // record OWNED by that person is inside the authority the gate checked.
  // The applySeparation class is still caught: a write to a record whose
  // owner (or the record itself) was never declared stays a violation.
  if (write.nodeType !== "employee" && write.data) {
    const owner = ownerOfRecordData(write.data);
    if (owner && covers("employee", owner)) return true;
  }
  return false;
}

describe("write-conformance: operations only touch what they declared", () => {
  it("a representative battery of operations conforms", async () => {
    const { spine, deps, registry } = await buildDemoWorld();

    // Wrap the graph so every write during a submit is observed.
    const writes: Write[] = [];
    const graph = deps.graph;
    const origPut = graph.putNode.bind(graph);
    const origPatch = graph.patchNode.bind(graph);
    const origRemove = graph.removeNode.bind(graph);
    graph.putNode = async (nodeType, nodeId, data) => {
      writes.push({ kind: "put", nodeType, nodeId: String(nodeId), data: data as Record<string, unknown> });
      return origPut(nodeType, nodeId, data);
    };
    graph.patchNode = async (nodeType, nodeId, data) => {
      // A patch may not carry the owner field — resolve it from the merged record.
      const existing = await graph.getNode(nodeType, nodeId);
      const merged = { ...(existing?.data as Record<string, unknown> | undefined), ...(data as Record<string, unknown>) };
      writes.push({ kind: "patch", nodeType, nodeId: String(nodeId), data: merged });
      return origPatch(nodeType, nodeId, data);
    };
    graph.removeNode = async (nodeType, nodeId) => {
      writes.push({ kind: "remove", nodeType, nodeId: String(nodeId) });
      return origRemove(nodeType, nodeId);
    };

    // Args come from the seeded world so the battery stays valid as data moves.
    const anyTask = (await origPut, await deps.graph.find("task", () => true))[0];
    const anyMeeting = (await deps.graph.find("meeting", () => true))[0];
    const anyEquipment = (await deps.graph.find("equipment", () => true))[0];
    const anyCourse = (await deps.graph.find("course", () => true))[0];

    interface BatteryOp {
      actor: string;
      name: string;
      /** A thunk defers args that depend on an earlier op's response. */
      args: Record<string, unknown> | (() => Record<string, unknown>);
      after?: (outcome: { result?: { response?: unknown } }) => void;
    }
    const battery: BatteryOp[] = [
      { actor: "james", name: "task.create", args: { title: "Conformance task", assignedTo: "priya" } },
      ...(anyTask
        ? [
            { actor: "james", name: "task.assign", args: { taskId: anyTask.id, assignedTo: "arun" } },
            { actor: "james", name: "task.edit", args: { taskId: anyTask.id, title: "Edited title" } },
            { actor: "james", name: "task.start", args: { taskId: anyTask.id } },
            { actor: "james", name: "task.complete", args: { taskId: anyTask.id } },
          ]
        : []),
      { actor: "james", name: "meeting.create", args: { title: "Conformance sync", kind: "online", from: "2026-09-01T09:00:00Z", to: "2026-09-01T10:00:00Z", attendees: ["priya"] } },
      ...(anyMeeting
        ? [{ actor: "james", name: "meeting.update", args: { meetingId: anyMeeting.id, title: "Renamed" } }]
        : []),
      { actor: "james", name: "notify.send", args: { message: "Conformance notice", to: ["priya"] } },
      { actor: "priya", name: "utility.capture", args: { subject: "AC timing", detail: "9 to 6" } },
      ...(anyEquipment
        ? [{ actor: "priya", name: "equipment.reportFault", args: { equipmentId: anyEquipment.id, fault: "Flickers" } }]
        : []),
      ...(anyCourse
        ? [{ actor: "james", name: "course.setProgressNote", args: { courseId: anyCourse.id, note: "On track" } }]
        : []),
      { actor: "priya", name: "attendance.checkIn", args: { employeeId: "priya", date: "2026-08-19" } },
      { actor: "priya", name: "attendance.checkOut", args: { employeeId: "priya", date: "2026-08-19" } },
      { actor: "priya", name: "employee.updateContact", args: { employeeId: "priya", contact: "priya@conform.example" } },
    ];

    // Phase 2 — write-heavy workplace ops whose targets come from phase 1
    // or the seed. Pushed after the static battery so ids exist by then.
    const anyRoom = (await deps.graph.find("room", () => true))[0];
    if (anyRoom) {
      battery.push({ actor: "priya", name: "room.book", args: { roomId: anyRoom.id, title: "Conformance booking", from: "2026-09-02T09:00:00Z", to: "2026-09-02T10:00:00Z" } });
    }
    battery.push({ actor: "james", name: "orgMemory.record", args: { title: "Chose the teal theme", decision: "Teal + marigold", reason: "Matches the references" } });
    battery.push({ actor: "james", name: "document.store", args: { title: "Conformance doc", blobRef: "blob:conformance" } });
    battery.push({ actor: "james", name: "event.create", args: { title: "Conformance day", date: "2026-09-10", budget: 1000 } });
    if (anyMeeting) {
      battery.push({ actor: "james", name: "meeting.addAttendee", args: { meetingId: anyMeeting.id, attendee: "arun" } });
      battery.push({ actor: "james", name: "meeting.recordDecisions", args: { meetingId: anyMeeting.id, decisions: [{ text: "Ship it", owner: "priya" }] } });
      battery.push({ actor: "james", name: "meeting.cancel", args: { meetingId: anyMeeting.id } });
    }
    if (anyCourse) {
      battery.push({ actor: "james", name: "course.assignStageOwner", args: { courseId: anyCourse.id, stage: "draft", owner: "priya" } });
      battery.push({ actor: "james", name: "course.setModuleState", args: { courseId: anyCourse.id, moduleIndex: 0, state: "draft" } });
    }

    // Phase 3 — the money/people flows: leave lifecycle, employee lifecycle,
    // joining and leaving. Ids that only exist after an earlier op ran arrive
    // through thunked args.
    let approveLeaveId: string | undefined;
    let declineLeaveId: string | undefined;
    let approveClaimId: string | undefined;
    const leaveIdOf = (o: { result?: { response?: unknown } }) =>
      (o.result?.response as { leaveId?: string } | undefined)?.leaveId;
    const claimIdOf = (o: { result?: { response?: unknown } }) =>
      (o.result?.response as { claimId?: string } | undefined)?.claimId;
    battery.push(
      { actor: "shruti", name: "employee.create", args: { employeeId: "conform1", name: "Conform Ance", role: "employee", username: "conform1", temporaryPassword: "TempPass2026", team: "courses" } },
      { actor: "priya", name: "leave.request", args: { employeeId: "priya", fromDate: "2026-09-03", toDate: "2026-09-04" }, after: (o) => { approveLeaveId = leaveIdOf(o); } },
      { actor: "james", name: "leave.approve", args: () => ({ leaveId: approveLeaveId }) },
      { actor: "priya", name: "leave.request", args: { employeeId: "priya", fromDate: "2026-09-10", toDate: "2026-09-11" }, after: (o) => { declineLeaveId = leaveIdOf(o); } },
      { actor: "james", name: "leave.decline", args: () => ({ leaveId: declineLeaveId, reason: "No cover that week." }) },
      // Expense claims mirror the leave lifecycle: person-scoped request,
      // approve declared on the employee node the claim belongs to.
      { actor: "priya", name: "expense.claim", args: { employeeId: "priya", amount: 2600, category: "Travel", description: "Conformance cab fare", date: "2026-09-05" }, after: (o) => { approveClaimId = claimIdOf(o); } },
      { actor: "james", name: "expense.approve", args: () => ({ claimId: approveClaimId }) },
      { actor: "shruti", name: "employee.update", args: { employeeId: "conform1", patch: { contact: "conform1@example.org" } } },
      { actor: "shruti", name: "employee.setPay", args: { employeeId: "conform1", pay: 50000, effectiveFrom: "2026-09-01" } },
      { actor: "shruti", name: "employee.updateContact", args: { employeeId: "shruti", contact: "shruti@example.org" } },
      { actor: "shruti", name: "joining.start", args: { employeeId: "ravi" } },
      { actor: "ravi", name: "joining.completeStep", args: { employeeId: "ravi", stepId: "policy-ack" } },
      { actor: "shruti", name: "leaving.start", args: { employeeId: "conform1", separationDate: "2026-09-30" } },
      { actor: "shruti", name: "employee.deactivate", args: { employeeId: "conform1", lastWorkingDay: "2026-09-30", reason: "Resigned" } },
      { actor: "shruti", name: "leaving.applySeparation", args: { employeeId: "conform1" } },
      // Meena holds two laptops and owns a course — her offboarding exercises
      // the handover reassignment path, which writes course/equipment nodes.
      { actor: "shruti", name: "leaving.start", args: { employeeId: "meena", separationDate: "2026-10-01" } },
      { actor: "james", name: "leaving.completeHandover", args: { employeeId: "meena", handoverId: "h-course-ai-basics" } },
    );

    // Phase 4 — course lifecycle: creating, assigning (which also writes one
    // task per assignee — both declared), and the admin-level delete.
    let createdCourseId: string | undefined;
    battery.push(
      {
        actor: "james",
        name: "course.create",
        args: { title: "Conformance Course", modules: ["One", "Two"] },
        after: (o) => {
          createdCourseId = (o.result?.response as { courseId?: string } | undefined)?.courseId;
        },
      },
      { actor: "james", name: "course.assign", args: () => ({ courseId: createdCourseId, assignees: ["priya", "arun"] }) },
      { actor: "admin", name: "course.delete", args: () => ({ courseId: createdCourseId }) },
    );

    const violations: string[] = [];
    const ranOps = new Set<string>();
    /** Operations that offered an undo which would not survive a restart. */
    const undoGaps = new Set<string>();
    for (const op of battery) {
      writes.length = 0;
      const args = typeof op.args === "function" ? op.args() : op.args;
      let outcome = await spine.submit(
        adapters.fromForm({ actor: op.actor, name: op.name, args }),
      );
      // A parked money/people op must not write until it is confirmed. The
      // confirmed run's writes are then held to the same declaration.
      if (outcome.status === "awaiting-confirmation") {
        if (writes.length > 0) {
          violations.push(`${op.name}: wrote ${writes.length} record(s) while parked for confirmation`);
        }
        outcome = await spine.confirm(outcome.pendingId as string, op.actor);
      }
      // A refused op that wrote anything is its own violation.
      if (outcome.status !== "ran") {
        if (writes.length > 0) {
          violations.push(`${op.name}: wrote ${writes.length} record(s) despite status ${outcome.status}`);
        }
        continue;
      }
      ranOps.add(op.name);
      op.after?.(outcome);
      // An operation that offers an undo must offer one that survives a
      // restart. `spine.undo` prefers the in-process closure and falls back to
      // `entry.undoPlan`; with no plan it refuses outright once the process is
      // gone. AGENTS.md: "closures die with the process."
      const entry = outcome.activityEntry;
      if (entry?.undoDescription && !entry.undoPlan?.length) {
        undoGaps.add(op.name);
      }
      const declared = await declaredFor((n) => registry.get(n), op.name, args);
      for (const w of writes) {
        if (!conforms(w, declared)) {
          violations.push(
            `${op.name}: ${w.kind} ${w.nodeType}:${w.nodeId} was never declared to the gate`,
          );
        }
      }
    }

    expect(violations, violations.join("\n")).toEqual([]);

    /**
     * Operations whose undo is still a closure only, and therefore dies with
     * the process.
     *
     * This list is a ratchet, not a permission slip: it may shrink, never grow.
     * A new operation offering an undo without a plan fails this test on the
     * spot. The day-flow verbs — every `task.*`, both `attendance.*`, all of
     * `employee.*` and the three `course.*` writes — have been cleared; what
     * remains is the workplace and HR surface, which no agent runs unattended
     * yet. Clear these before anything does.
     */
    const KNOWN_UNDO_GAPS = new Set([
      "employee.updateContact",
      "expense.approve",
      "expense.claim",
      "joining.completeStep",
      "leave.approve",
      "leave.decline",
      "leaving.completeHandover",
      "meeting.create",
    ]);
    const newGaps = [...undoGaps].filter((n) => !KNOWN_UNDO_GAPS.has(n)).sort();
    expect(
      newGaps,
      `These operations offer an undo with no serialisable plan, so it stops working after a restart:\n  ${newGaps.join("\n  ")}`,
    ).toEqual([]);

    // A battery op that silently never ran proves nothing — the flows this
    // harness exists for must actually have executed.
    for (const mustRun of [
      "task.create", "meeting.create", "attendance.checkIn", "room.book",
      "employee.create", "leave.request", "leave.approve", "leave.decline",
      "expense.claim", "expense.approve",
      "employee.setPay", "joining.start", "joining.completeStep", "leaving.start",
      "leaving.completeHandover", "employee.deactivate",
      "course.create", "course.assign", "course.delete",
    ]) {
      expect(ranOps.has(mustRun), `${mustRun} never ran — its conformance was not tested`).toBe(true);
    }
  });
});
