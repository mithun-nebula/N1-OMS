import type { OperationHandler, OperationResult } from "@/spine/operation/registry";
import type { RecordStore } from "@/spine/record/types";
import { findLeaveClashes, nextLeaveId, teamLeadOf } from "./leave";

interface LeaveNodeData {
  employeeId: string;
  employeeName?: string;
  fromDate: string;
  toDate: string;
  type?: string;
  status: "Pending" | "Approved" | "Declined";
  clashes: unknown[];
  reason?: string;
  approvedBy?: string;
  declinedBy?: string;
  [key: string]: unknown;
}

async function readLeave(graph: RecordStore, leaveId: string): Promise<LeaveNodeData | undefined> {
  const node = await graph.getNode("leave", leaveId);
  return node ? (node.data as LeaveNodeData) : undefined;
}

export function leaveRequestHandler(
  graph: RecordStore,
  owners?: Map<string, string>,
): OperationHandler<{
  employeeId: string;
  fromDate: string;
  toDate: string;
  type?: string;
  reason?: string;
}> {
  return {
    name: "leave.request",
    category: "people",
    validate: (args) => {
      const missing: string[] = [];
      if (!args.employeeId) missing.push("employeeId");
      if (!args.fromDate) missing.push("fromDate");
      if (!args.toDate) missing.push("toDate");
      return missing.length === 0
        ? { ok: true }
        : {
            ok: false,
            missing,
            detail: "Employee, fromDate and toDate are required.",
          };
    },
    permission: (args) => ({
      action: "edit",
      nodeType: "employee",
      recordNodeIds: [args.employeeId],
    }),
    involvesMoneyOrPeople: () => true,
    execute: async (args) => {
      const employee = await graph.getNode("employee", args.employeeId);
      const employeeName = (employee?.data as { name?: string })?.name;
      const clashes = await findLeaveClashes(graph, args.employeeId, args.fromDate, args.toDate);
      const leaveId = nextLeaveId();
      const data: LeaveNodeData = {
        employeeId: args.employeeId,
        employeeName,
        fromDate: args.fromDate,
        toDate: args.toDate,
        type: args.type,
        reason: args.reason,
        status: "Pending",
        clashes,
      };
      await graph.putNode("leave", leaveId, data);
      // Self/own-team visibility of this fresh request must not wait for the
      // next restart's owner hydration.
      owners?.set(`leave:${leaveId}`, args.employeeId);
      await graph.addEdge({ from: args.employeeId, to: leaveId, type: "requests" });
      const approver = teamLeadOf(args.employeeId);
      const result: OperationResult = {
        changes: [{ nodeType: "leave", nodeId: leaveId, after: data }],
        publishedTo: approver
          ? [{ kind: "actor", actor: approver }]
          : [],
        response: { leaveId, clashes, approver },
      };
      return result;
    },
  };
}

export function leaveApproveHandler(
  graph: RecordStore,
): OperationHandler<{ leaveId: string }> {
  return {
    name: "leave.approve",
    category: "people",
    validate: (args) => {
      const missing: string[] = [];
      if (!args.leaveId) missing.push("leaveId");
      return missing.length === 0
        ? { ok: true }
        : { ok: false, missing, detail: "A leave id is required." };
    },
    permission: async (args) => {
      const leave = await readLeave(graph, args.leaveId);
      return {
        action: "approve",
        nodeType: "employee",
        recordNodeIds: [leave?.employeeId ?? ""],
      };
    },
    involvesMoneyOrPeople: () => true,
    execute: async (args, ctx) => {
      const before = await readLeave(graph, args.leaveId);
      const updated: LeaveNodeData = {
        ...(before as LeaveNodeData),
        status: "Approved",
        approvedBy: ctx.actor,
      };
      await graph.putNode("leave", args.leaveId, updated);

      // Decrement the employee's leave balance by the inclusive day count.
      // (Money/people actions always have a real effect — non-negotiable #3.)
      const employeeId = before?.employeeId;
      let balanceBefore: number | undefined;
      if (employeeId) {
        const empNode = await graph.getNode("employee", employeeId);
        const empData = empNode?.data as { leaveBalance?: number } | undefined;
        balanceBefore = empData?.leaveBalance;
        if (typeof balanceBefore === "number") {
          const days = leaveDays(before?.fromDate, before?.toDate);
          await graph.patchNode("employee", employeeId, {
            leaveBalance: Math.max(0, balanceBefore - days),
          });
        }
      }

      const result: OperationResult = {
        changes: [
          {
            nodeType: "leave",
            nodeId: args.leaveId,
            before: { status: before?.status },
            after: { status: "Approved", approvedBy: ctx.actor },
          },
        ],
        undo: {
          description: `Revert leave ${args.leaveId} to Pending.`,
          revert: async () => {
            if (before) await graph.putNode("leave", args.leaveId, before);
            if (employeeId && typeof balanceBefore === "number") {
              await graph.patchNode("employee", employeeId, { leaveBalance: balanceBefore });
            }
          },
        },
        publishedTo: before
          ? [{ kind: "actor", actor: before.employeeId }]
          : [],
      };
      return result;
    },
  };
}

export function leaveDeclineHandler(
  graph: RecordStore,
): OperationHandler<{ leaveId: string; reason: string }> {
  return {
    name: "leave.decline",
    category: "people",
    validate: (args) => {
      const missing: string[] = [];
      if (!args.leaveId) missing.push("leaveId");
      if (!args.reason) missing.push("reason");
      return missing.length === 0
        ? { ok: true }
        : {
            ok: false,
            missing,
            detail: "A leave id and a reason are required.",
          };
    },
    permission: async (args) => {
      const leave = await readLeave(graph, args.leaveId);
      return {
        action: "approve",
        nodeType: "employee",
        recordNodeIds: [leave?.employeeId ?? ""],
      };
    },
    involvesMoneyOrPeople: () => true,
    execute: async (args, ctx) => {
      const before = await readLeave(graph, args.leaveId);
      const updated: LeaveNodeData = {
        ...(before as LeaveNodeData),
        status: "Declined",
        reason: args.reason,
        declinedBy: ctx.actor,
      };
      await graph.putNode("leave", args.leaveId, updated);
      const result: OperationResult = {
        changes: [
          {
            nodeType: "leave",
            nodeId: args.leaveId,
            before: { status: before?.status },
            after: { status: "Declined", reason: args.reason, declinedBy: ctx.actor },
          },
        ],
        undo: {
          description: `Revert leave ${args.leaveId} to Pending.`,
          revert: async () => {
            if (before) await graph.putNode("leave", args.leaveId, before);
          },
        },
        publishedTo: before
          ? [{ kind: "actor", actor: before.employeeId }]
          : [],
      };
      return result;
    },
  };
}

export function employeeUpdateContactHandler(
  graph: RecordStore,
): OperationHandler<{ employeeId: string; contact: string }> {
  return {
    name: "employee.updateContact",
    category: "people",
    validate: (args) => {
      const missing: string[] = [];
      if (!args.employeeId) missing.push("employeeId");
      if (!args.contact) missing.push("contact");
      return missing.length === 0
        ? { ok: true }
        : {
            ok: false,
            missing,
            detail: "An employee id and contact are required.",
          };
    },
    permission: (args) => ({
      action: "edit",
      nodeType: "employee",
      recordNodeIds: [args.employeeId],
    }),
    involvesMoneyOrPeople: () => false,
    execute: async (args) => {
      const node = await graph.getNode("employee", args.employeeId);
      const before = node?.data as Record<string, unknown> | undefined;
      if (!before) throw new Error(`No employee ${args.employeeId}`);
      const updated = { ...before, contact: args.contact };
      await graph.putNode("employee", args.employeeId, updated);
      const result: OperationResult = {
        changes: [
          {
            nodeType: "employee",
            nodeId: args.employeeId,
            before: { contact: before.contact },
            after: { contact: args.contact },
          },
        ],
        undo: {
          description: `Revert contact for ${args.employeeId}.`,
          revert: async () => {
            await graph.putNode("employee", args.employeeId, before);
          },
        },
      };
      return result;
    },
  };
}

/** Inclusive day count between two YYYY-MM-DD dates (1 if equal/missing). */
export function leaveDays(fromDate?: string, toDate?: string): number {
  if (!fromDate || !toDate) return 1;
  const from = new Date(fromDate).getTime();
  const to = new Date(toDate).getTime();
  if (!Number.isFinite(from) || !Number.isFinite(to)) return 1;
  const days = Math.floor((to - from) / 86_400_000) + 1;
  return days > 0 ? days : 1;
}
