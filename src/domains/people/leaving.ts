import type { OperationHandler, OperationResult } from "@/spine/operation/registry";
import type { NodeId } from "@/spine/operation/types";
import type { RecordStore } from "@/spine/record/types";
import { teamLeadOf } from "./leave";

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

function readOffboarding(
  graph: RecordStore,
  employeeId: string,
): OffboardingData | undefined {
  const node = graph.getNode("offboarding", offboardingIdFor(employeeId));
  return node ? (node.data as OffboardingData) : undefined;
}

function detectOutstanding(
  graph: RecordStore,
  employeeId: string,
  newOwner: string,
): HandoverItem[] {
  const handovers: HandoverItem[] = [];
  const courses = graph.traverse({
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
  const assets = graph.find(
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

function reassign(
  graph: RecordStore,
  item: HandoverItem,
): void {
  if (item.type === "course") {
    graph.removeEdge(item.from, item.nodeId, "owns");
    graph.addEdge({ from: item.to, to: item.nodeId, type: "owns" });
    graph.patchNode("course", item.nodeId, { owner: item.to });
  } else {
    graph.removeEdge(item.from, item.nodeId, "holds");
    graph.addEdge({ from: item.to, to: item.nodeId, type: "holds" });
    graph.patchNode("equipment", item.nodeId, { assignee: item.to });
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
    execute: (args) => {
      const newOwner = teamLeadOf(args.employeeId) ?? "shruti";
      const handovers = detectOutstanding(graph, args.employeeId, newOwner);
      const data: OffboardingData = {
        employeeId: args.employeeId,
        separationDate: args.separationDate,
        status: handovers.length === 0 ? "complete" : "active",
        handovers,
        separated: false,
      };
      graph.putNode("offboarding", offboardingIdFor(args.employeeId), data);
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
    permission: (args) => {
      const offboarding = readOffboarding(graph, args.employeeId);
      const item = offboarding?.handovers.find((h) => h.id === args.handoverId);
      return {
        action: "edit",
        nodeType: "offboarding",
        recordNodeIds: [offboardingIdFor(args.employeeId)],
        allowedActors: item ? [item.to] : undefined,
      };
    },
    involvesMoneyOrPeople: () => true,
    execute: (args, ctx) => {
      const before = readOffboarding(graph, args.employeeId);
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
      reassign(graph, { ...item, status: "done" });
      const updated: OffboardingData = {
        ...before,
        handovers,
        status: handovers.every((h) => h.status === "done") ? "complete" : "active",
      };
      graph.putNode("offboarding", offboardingIdFor(args.employeeId), updated);
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
          revert: () => {
            reassign(graph, { ...item, to: item.from, status: "pending" });
            graph.putNode("offboarding", offboardingIdFor(args.employeeId), before);
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
    validate: (args) =>
      args.employeeId
        ? { ok: true }
        : { ok: false, missing: ["employeeId"], detail: "An employee id is required." },
    permission: (args) => ({
      action: "edit",
      nodeType: "offboarding",
      recordNodeIds: [offboardingIdFor(args.employeeId)],
    }),
    involvesMoneyOrPeople: () => false,
    execute: (args, ctx) => {
      const offboarding = readOffboarding(graph, args.employeeId);
      if (offboarding) {
        graph.putNode("offboarding", offboardingIdFor(args.employeeId), {
          ...offboarding,
          separated: true,
        });
      }
      graph.patchNode("employee", args.employeeId, {
        status: "separated",
        separatedAt: ctx.now(),
        suspendedRules: true,
      });
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
