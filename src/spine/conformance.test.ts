import { describe, it, expect } from "vitest";
import { buildDemoWorld } from "@/server/bootstrap";
import * as adapters from "@/spine/adapters";
import type { PermissionRequirement } from "@/spine/operation/registry";

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
  return declared.some((req) => {
    if (req.nodeType !== write.nodeType) return false;
    const ids = (req as { recordNodeIds?: string[] }).recordNodeIds;
    return !ids || ids.length === 0 || ids.includes(write.nodeId);
  });
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
      writes.push({ kind: "put", nodeType, nodeId: String(nodeId) });
      return origPut(nodeType, nodeId, data);
    };
    graph.patchNode = async (nodeType, nodeId, data) => {
      writes.push({ kind: "patch", nodeType, nodeId: String(nodeId) });
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

    const battery: Array<{ actor: string; name: string; args: Record<string, unknown> }> = [
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
      { actor: "james", name: "announcement.send", args: { message: "Conformance notice", to: ["priya"] } },
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

    const violations: string[] = [];
    for (const op of battery) {
      writes.length = 0;
      const outcome = await spine.submit(
        adapters.fromForm({ actor: op.actor, name: op.name, args: op.args }),
      );
      // A refused or parked op that wrote anything is its own violation.
      if (outcome.status !== "ran") {
        if (writes.length > 0) {
          violations.push(`${op.name}: wrote ${writes.length} record(s) despite status ${outcome.status}`);
        }
        continue;
      }
      const declared = await declaredFor((n) => registry.get(n), op.name, op.args);
      for (const w of writes) {
        if (!conforms(w, declared)) {
          violations.push(
            `${op.name}: ${w.kind} ${w.nodeType}:${w.nodeId} was never declared to the gate`,
          );
        }
      }
    }

    expect(violations, violations.join("\n")).toEqual([]);
  });
});
