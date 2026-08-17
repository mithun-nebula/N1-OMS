import type { OperationHandler, OperationResult } from "@/spine/operation/registry";
import type { NodeId } from "@/spine/operation/types";
import type { RecordStore } from "@/spine/record/types";
import { teamLeadOf } from "./leave";
import { directory } from "@/server/directory";
import { setAccountEnabled } from "@/server/accounts";

export interface HandoverItem {
  id: string;
  type: "course" | "asset";
  nodeId: NodeId;
  title: string;
  from: string;
  to: string;
  status: "pending" | "done";
  completedAt?: string;
}

interface OffboardingData {
  employeeId: string;
  separationDate: string;
  status: "active" | "complete";
  handovers: HandoverItem[];
  separated: boolean;
  [key: string]: unknown;
}

export function offboardingIdFor(employeeId: string): NodeId {
  return `offboarding:${employeeId}`;
}

async function readOffboarding(
  graph: RecordStore,
  employeeId: string,
): Promise<OffboardingData | undefined> {
  const node = await graph.getNode("offboarding", offboardingIdFor(employeeId));
  return node ? (node.data as OffboardingData) : undefined;
}

async function detectOutstanding(
  graph: RecordStore,
  employeeId: string,
  newOwner: string,
): Promise<HandoverItem[]> {
  const handovers: HandoverItem[] = [];
  const courses = await graph.traverse({
    start: employeeId,
    steps: [{ edgeType: "owns", direction: "out", toNodeType: "course" }],
  });
  for (const course of courses) {
    handovers.push({
      id: `h-course-${course.id}`,
      type: "course",
      nodeId: course.id,
      title: String((course.data as { title?: unknown }).title ?? course.id),
      from: employeeId,
      to: newOwner,
      status: "pending",
    });
  }
  const assets = await graph.find(
    "equipment",
    (n) => (n.data as { assignee?: string }).assignee === employeeId,
  );
  for (const asset of assets) {
    handovers.push({
      id: `h-asset-${asset.id}`,
      type: "asset",
      nodeId: asset.id,
      title: String((asset.data as { name?: unknown }).name ?? asset.id),
      from: employeeId,
      to: newOwner,
      status: "pending",
    });
  }
  return handovers;
}

async function reassign(
  graph: RecordStore,
  item: HandoverItem,
): Promise<void> {
  if (item.type === "course") {
    await graph.removeEdge(item.from, item.nodeId, "owns");
    await graph.addEdge({ from: item.to, to: item.nodeId, type: "owns" });
    await graph.patchNode("course", item.nodeId, { owner: item.to });
  } else {
    await graph.removeEdge(item.from, item.nodeId, "holds");
    await graph.addEdge({ from: item.to, to: item.nodeId, type: "holds" });
    await graph.patchNode("equipment", item.nodeId, { assignee: item.to });
  }
}

export function leavingStartHandler(
  graph: RecordStore,
): OperationHandler<{ employeeId: string; separationDate: string }> {
  return {
    name: "leaving.start",
    category: "people",
    validate: (args) => {
      const missing: string[] = [];
      if (!args.employeeId) missing.push("employeeId");
      if (!args.separationDate) missing.push("separationDate");
      return missing.length === 0
        ? { ok: true }
        : {
            ok: false,
            missing,
            detail: "Employee id and separation date are required.",
          };
    },
    permission: (args) => ({
      action: "create",
      nodeType: "offboarding",
      recordNodeIds: [offboardingIdFor(args.employeeId)],
    }),
    involvesMoneyOrPeople: () => true,
    execute: async (args) => {
      const newOwner = teamLeadOf(args.employeeId) ?? "shruti";
      const handovers = await detectOutstanding(graph, args.employeeId, newOwner);
      const data: OffboardingData = {
        employeeId: args.employeeId,
        separationDate: args.separationDate,
        status: handovers.length === 0 ? "complete" : "active",
        handovers,
        separated: false,
      };
      await graph.putNode("offboarding", offboardingIdFor(args.employeeId), data);
      const result: OperationResult = {
        changes: [
          {
            nodeType: "offboarding",
            nodeId: offboardingIdFor(args.employeeId),
            after: data,
          },
        ],
        publishedTo: [
          { kind: "actor", actor: args.employeeId },
          { kind: "actor", actor: newOwner },
          { kind: "actor", actor: "shruti" },
        ],
        response: {
          offboardingId: offboardingIdFor(args.employeeId),
          outstandingCount: handovers.length,
          handovers,
        },
      };
      return result;
    },
  };
}

export function leavingCompleteHandoverHandler(
  graph: RecordStore,
): OperationHandler<{ employeeId: string; handoverId: string }> {
  return {
    name: "leaving.completeHandover",
    category: "people",
    validate: (args) => {
      const missing: string[] = [];
      if (!args.employeeId) missing.push("employeeId");
      if (!args.handoverId) missing.push("handoverId");
      return missing.length === 0
        ? { ok: true }
        : {
            ok: false,
            missing,
            detail: "Employee id and handover id are required.",
          };
    },
    permission: async (args) => {
      const offboarding = await readOffboarding(graph, args.employeeId);
      const item = offboarding?.handovers.find((h) => h.id === args.handoverId);
      return {
        action: "edit",
        nodeType: "offboarding",
        recordNodeIds: [offboardingIdFor(args.employeeId)],
        allowedActors: item ? [item.to] : undefined,
      };
    },
    involvesMoneyOrPeople: () => true,
    execute: async (args, ctx) => {
      const before = await readOffboarding(graph, args.employeeId);
      if (!before) {
        throw new Error(`No offboarding found for ${args.employeeId}`);
      }
      const item = before.handovers.find((h) => h.id === args.handoverId);
      if (!item) {
        throw new Error(`No handover ${args.handoverId}`);
      }
      const handovers = before.handovers.map((h) =>
        h.id === args.handoverId
          ? { ...h, status: "done" as const, completedAt: ctx.now() }
          : h,
      );
      await reassign(graph, { ...item, status: "done" });
      const updated: OffboardingData = {
        ...before,
        handovers,
        status: handovers.every((h) => h.status === "done") ? "complete" : "active",
      };
      await graph.putNode("offboarding", offboardingIdFor(args.employeeId), updated);
      const result: OperationResult = {
        changes: [
          {
            nodeType: item.type === "course" ? "course" : "equipment",
            nodeId: item.nodeId,
            after: { reassignedTo: item.to },
          },
        ],
        undo: {
          description: `Undo handover ${args.handoverId}.`,
          revert: async () => {
            await reassign(graph, { ...item, to: item.from, status: "pending" });
            await graph.putNode("offboarding", offboardingIdFor(args.employeeId), before);
          },
        },
        publishedTo: [{ kind: "actor", actor: before.employeeId }],
      };
      return result;
    },
  };
}

export function leavingApplySeparationHandler(
  graph: RecordStore,
): OperationHandler<{ employeeId: string }> {
  return {
    name: "leaving.applySeparation",
    category: "leaving-org",
    validate: async (args) => {
      if (!args.employeeId) {
        return { ok: false, missing: ["employeeId"], detail: "An employee id is required." };
      }
      const person = (await graph.getNode("employee", args.employeeId))?.data as
        | { name?: string; status?: string }
        | undefined;
      if (!person) {
        return {
          ok: false,
          missing: ["employeeId"],
          detail: `No employee ${args.employeeId}.`,
        };
      }
      // The same guard `employee.deactivate` applies. Without it this operation
      // was a way around it: separate a manager and their reports are left
      // pointing at somebody who no longer works here, and approvals routed to
      // them go nowhere.
      const reports = directory().reportsOf(args.employeeId);
      if (reports.length > 0) {
        return {
          ok: false,
          missing: ["reassignReports"],
          detail: `${person.name ?? args.employeeId} still manages ${reports.length} ${
            reports.length === 1 ? "person" : "people"
          }. Reassign them first.`,
        };
      }
      return { ok: true };
    },
    // Two requirements, because this writes two records. It used to ask only
    // about `offboarding` while writing `employee.status` — the same shape as
    // the pay hole: permission on record X, write on record Y.
    permission: (args) => [
      {
        action: "edit",
        nodeType: "offboarding",
        recordNodeIds: [offboardingIdFor(args.employeeId)],
      },
      {
        action: "edit",
        nodeType: "employee",
        recordNodeIds: [args.employeeId],
        fields: ["status"],
      },
    ],
    // Somebody leaving the organisation is people-data by definition.
    involvesMoneyOrPeople: () => true,
    execute: async (args, ctx) => {
      const offboarding = await readOffboarding(graph, args.employeeId);
      if (offboarding) {
        await graph.putNode("offboarding", offboardingIdFor(args.employeeId), {
          ...offboarding,
          separated: true,
        });
      }
      await graph.patchNode("employee", args.employeeId, {
        status: "separated",
        separatedAt: ctx.now(),
        suspendedRules: true,
      });
      // Their login has to stop working. Marking the record separated used to
      // leave the account fully usable, so "no rule outlives its owner" did not
      // hold and a departed employee kept a valid session for up to a week.
      await setAccountEnabled(args.employeeId, false);

      const result: OperationResult = {
        changes: [
          {
            nodeType: "employee",
            nodeId: args.employeeId,
            after: { status: "separated", suspendedRules: true },
          },
        ],
        publishedTo: [{ kind: "actor", actor: "shruti" }],
      };
      return result;
    },
  };
}
