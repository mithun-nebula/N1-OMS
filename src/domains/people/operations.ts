import type { OperationHandler, OperationResult } from "@/spine/operation/registry";
import type { ActorId } from "@/spine/operation/types";
import type { RecordStore } from "@/spine/record/types";

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
      graph.patchNode("employee", args.employeeId, {
        pendingLeave: { from: args.fromDate, to: args.toDate },
      });
      const result: OperationResult = {
        changes: [
          {
            nodeType: "employee",
            nodeId: args.employeeId,
            after: {
              pendingLeave: { from: args.fromDate, to: args.toDate },
            },
          },
        ],
        publishedTo: [{ kind: "actor", actor: "james" as ActorId }],
      };
      return result;
    },
  };
}
