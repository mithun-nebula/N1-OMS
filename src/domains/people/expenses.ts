import type { OperationHandler, OperationResult } from "@/spine/operation/registry";
import type { RecordStore } from "@/spine/record/types";
import { teamLeadOf } from "./leave";

/**
 * Self-service expense claims, shaped exactly like the leave flow:
 * request → manager/HR approve or decline, undoable, published to the
 * requester. Authority is person-scoped — a claim is about one employee, so
 * `expense.claim` asks for `edit` on that employee node and the approvals ask
 * for `approve` on it, which the policy resolves against self / team-others /
 * all scopes.
 *
 * The node shape stays compatible with the seeded N1 `expense-claim` records
 * (`employee`, `employeeName`, `company`, `expenseDate`, `totalAmount`,
 * `status`, `description`) so the read paths treat both alike.
 */

interface ExpenseClaimData {
  employee: string;
  employeeName?: string;
  company?: string;
  expenseDate: string;
  totalAmount: number;
  category?: string;
  description: string;
  status: "Pending" | "Approved" | "Declined";
  reason?: string;
  approvedBy?: string;
  declinedBy?: string;
  [key: string]: unknown;
}

async function readClaim(
  graph: RecordStore,
  claimId: string,
): Promise<ExpenseClaimData | undefined> {
  const node = await graph.getNode("expense-claim", claimId);
  return node ? (node.data as ExpenseClaimData) : undefined;
}

let claimSeq = 0;
function nextClaimId(): string {
  claimSeq += 1;
  return `expense_${Date.now().toString(36)}_${claimSeq.toString(36)}`;
}

export function expenseClaimHandler(
  graph: RecordStore,
  owners?: Map<string, string>,
): OperationHandler<{
  employeeId: string;
  amount: number;
  category: string;
  description: string;
  date: string;
}> {
  return {
    name: "expense.claim",
    category: "people",
    validate: (args) => {
      const missing: string[] = [];
      if (!args.employeeId) missing.push("employeeId");
      if (args.amount === undefined || args.amount === null || Number.isNaN(Number(args.amount)))
        missing.push("amount");
      if (!args.category) missing.push("category");
      if (!args.description) missing.push("description");
      if (!args.date) missing.push("date");
      if (missing.length > 0) {
        return {
          ok: false,
          missing,
          detail: "Employee, amount, category, description and date are required.",
        };
      }
      if (Number(args.amount) <= 0) {
        return {
          ok: false,
          missing: ["amount"],
          detail: "The amount must be greater than zero.",
        };
      }
      return { ok: true };
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
      const claimId = nextClaimId();
      const data: ExpenseClaimData = {
        employee: args.employeeId,
        employeeName,
        company: "Organization A",
        expenseDate: args.date,
        totalAmount: Number(args.amount),
        category: args.category,
        description: args.description,
        status: "Pending",
      };
      await graph.putNode("expense-claim", claimId, data);
      // Self/own-team visibility of this fresh claim must not wait for the
      // next restart's owner hydration.
      owners?.set(`expense-claim:${claimId}`, args.employeeId);
      await graph.addEdge({ from: args.employeeId, to: claimId, type: "claims" });
      const approver = teamLeadOf(args.employeeId);
      const result: OperationResult = {
        changes: [{ nodeType: "expense-claim", nodeId: claimId, after: data }],
        undo: {
          description: `Withdraw expense claim ${claimId}.`,
          revert: async () => {
            await graph.removeNode("expense-claim", claimId);
          },
        },
        publishedTo: approver ? [{ kind: "actor", actor: approver }] : [],
        response: { claimId, approver },
      };
      return result;
    },
  };
}

export function expenseApproveHandler(
  graph: RecordStore,
): OperationHandler<{ claimId: string }> {
  return {
    name: "expense.approve",
    category: "people",
    validate: (args) => {
      const missing: string[] = [];
      if (!args.claimId) missing.push("claimId");
      return missing.length === 0
        ? { ok: true }
        : { ok: false, missing, detail: "A claim id is required." };
    },
    permission: async (args) => {
      const claim = await readClaim(graph, args.claimId);
      return {
        action: "approve",
        nodeType: "employee",
        recordNodeIds: [claim?.employee ?? ""],
      };
    },
    involvesMoneyOrPeople: () => true,
    execute: async (args, ctx) => {
      const before = await readClaim(graph, args.claimId);
      const updated: ExpenseClaimData = {
        ...(before as ExpenseClaimData),
        status: "Approved",
        approvedBy: ctx.actor,
      };
      await graph.putNode("expense-claim", args.claimId, updated);
      const result: OperationResult = {
        changes: [
          {
            nodeType: "expense-claim",
            nodeId: args.claimId,
            before: { status: before?.status },
            after: { status: "Approved", approvedBy: ctx.actor },
          },
        ],
        undo: {
          description: `Revert expense claim ${args.claimId} to Pending.`,
          revert: async () => {
            if (before) await graph.putNode("expense-claim", args.claimId, before);
          },
        },
        publishedTo: before ? [{ kind: "actor", actor: before.employee }] : [],
      };
      return result;
    },
  };
}

export function expenseDeclineHandler(
  graph: RecordStore,
): OperationHandler<{ claimId: string; reason: string }> {
  return {
    name: "expense.decline",
    category: "people",
    validate: (args) => {
      const missing: string[] = [];
      if (!args.claimId) missing.push("claimId");
      if (!args.reason) missing.push("reason");
      return missing.length === 0
        ? { ok: true }
        : {
            ok: false,
            missing,
            detail: "A claim id and a reason are required.",
          };
    },
    permission: async (args) => {
      const claim = await readClaim(graph, args.claimId);
      return {
        action: "approve",
        nodeType: "employee",
        recordNodeIds: [claim?.employee ?? ""],
      };
    },
    involvesMoneyOrPeople: () => true,
    execute: async (args, ctx) => {
      const before = await readClaim(graph, args.claimId);
      const updated: ExpenseClaimData = {
        ...(before as ExpenseClaimData),
        status: "Declined",
        reason: args.reason,
        declinedBy: ctx.actor,
      };
      await graph.putNode("expense-claim", args.claimId, updated);
      const result: OperationResult = {
        changes: [
          {
            nodeType: "expense-claim",
            nodeId: args.claimId,
            before: { status: before?.status },
            after: { status: "Declined", reason: args.reason, declinedBy: ctx.actor },
          },
        ],
        undo: {
          description: `Revert expense claim ${args.claimId} to Pending.`,
          revert: async () => {
            if (before) await graph.putNode("expense-claim", args.claimId, before);
          },
        },
        publishedTo: before ? [{ kind: "actor", actor: before.employee }] : [],
      };
      return result;
    },
  };
}
