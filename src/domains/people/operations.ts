import type { OperationHandler, OperationResult } from "@/spine/operation/registry";
import type { RecordStore } from "@/spine/record/types";
import { findLeaveClashes, nextLeaveId, teamLeadOf } from "./leave";

interface LeaveNodeData {
  employeeId: string;
  employeeName?: string;
  fromDate: string;
  toDate: string;
  status: "Pending" | "Approved" | "Declined";
  clashes: unknown[];
  reason?: string;
  approvedBy?: string;
  declinedBy?: string;
  [key: string]: unknown;
}

function readLeave(graph: RecordStore, leaveId: string): LeaveNodeData | undefined {
  const node = graph.getNode("leave", leaveId);
  return node ? (node.data as LeaveNodeData) : undefined;
}

export function leaveRequestHandler(
  graph: RecordStore,
): OperationHandler<{
  employeeId: string;
  fromDate: string;
  toDate: string;
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
    execute: (args) => {
      const employee = graph.getNode("employee", args.employeeId);
      const employeeName = (employee?.data as { name?: string })?.name;
      const clashes = findLeaveClashes(graph, args.employeeId, args.fromDate, args.toDate);
      const leaveId = nextLeaveId();
      const data: LeaveNodeData = {
        employeeId: args.employeeId,
        employeeName,
        fromDate: args.fromDate,
        toDate: args.toDate,
        status: "Pending",
        clashes,
      };
      graph.putNode("leave", leaveId, data);
      graph.addEdge({ from: args.employeeId, to: leaveId, type: "requests" });
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
    permission: (args) => {
      const leave = readLeave(graph, args.leaveId);
      return {
        action: "approve",
        nodeType: "employee",
        recordNodeIds: [leave?.employeeId ?? ""],
      };
    },
    involvesMoneyOrPeople: () => true,
    execute: (args, ctx) => {
      const before = readLeave(graph, args.leaveId);
      const updated: LeaveNodeData = {
        ...(before as LeaveNodeData),
        status: "Approved",
        approvedBy: ctx.actor,
      };
      graph.putNode("leave", args.leaveId, updated);
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
          revert: () => {
            if (before) graph.putNode("leave", args.leaveId, before);
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
    permission: (args) => {
      const leave = readLeave(graph, args.leaveId);
      return {
        action: "approve",
        nodeType: "employee",
        recordNodeIds: [leave?.employeeId ?? ""],
      };
    },
    involvesMoneyOrPeople: () => true,
    execute: (args, ctx) => {
      const before = readLeave(graph, args.leaveId);
      const updated: LeaveNodeData = {
        ...(before as LeaveNodeData),
        status: "Declined",
        reason: args.reason,
        declinedBy: ctx.actor,
      };
      graph.putNode("leave", args.leaveId, updated);
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
          revert: () => {
            if (before) graph.putNode("leave", args.leaveId, before);
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
