import { tool } from "ai";
import { z } from "zod";
import { directory } from "@/server/directory";
import type { ToolSpec } from "./catalogue";
import { shape, safeFields, visible } from "./shape";

/**
 * Expense claims — the read that `approve_expense` and `decline_expense` need.
 *
 * ── Found by a test, not by a person ────────────────────────────────────────
 *
 * `pairing.test.ts` walks every write tool and asserts some read tool returns
 * the ids it takes. Run over Phase 3's full catalogue it found that
 * `approve_expense` and `decline_expense` take a `claimId` and **there was no
 * expense read tool at all** — not a thin one, not a badly-named one, none.
 *
 * So the model could be asked to approve a claim and had no way to learn a
 * single claim id. The failure mode is not an error: it is a confident wrong
 * answer about a claim that plainly exists, which is precisely what happened in
 * Phase 2 when `my_day` returned no item ids.
 *
 * Modelled on `list_leave`, deliberately: the two are the same shape of thing —
 * somebody asks, somebody approves — and reading side by side is how a model
 * tells `approve_expense` from `approve_leave`.
 */
export const listExpenses: ToolSpec = {
  name: "list_expenses",
  requires: { action: "view", nodeType: "expense-claim" },
  build: (ctx) =>
    tool({
      description: [
        "This tool does NOT list LEAVE requests — that is list_leave, and \"whose requests need approving\" could mean either. It also does not show what somebody is owed in pay; that is not something this assistant reads.",
        "",
        "List expense claims.",
        'Use for "whose expenses need approving", "what has Arun claimed", "any outstanding claims".',
        "Returns, per claim: its id, whose it is, the amount, the category, the date and the status (pending, approved or declined).",
        "",
        "The id is what approve_expense and decline_expense need — call this first if you do not have one, and never invent one.",
      ].join("\n"),
      inputSchema: z.object({
        person: z.string().optional().describe("Only this person's claims, by employee id."),
        status: z.enum(["pending", "approved", "declined"]).optional(),
      }),
      execute: async ({ person, status }) => {
        const wanted = status
          ? status.charAt(0).toUpperCase() + status.slice(1)
          : undefined;
        const rows = await ctx.deps.spine.readMany({
          actor: ctx.actor,
          nodeType: "expense-claim",
          filter: (data) => {
            const d = data as { employee?: string; status?: string };
            if (person && d.employee !== person) return false;
            if (wanted && d.status !== wanted) return false;
            return true;
          },
        });
        ctx.noteAll(
          "expense-claim",
          rows.map((r) => r.nodeId),
        );
        const dir = directory();
        return shape(rows, (r) => {
          const employee = visible(r.record.employee) as string | undefined;
          return {
            // The id matters: it is what approve_expense and decline_expense
            // take. Without it the model has to guess one.
            id: r.nodeId,
            employeeId: employee,
            who: employee ? dir.nameOf(employee) : undefined,
            ...safeFields(r.record, [
              "totalAmount",
              "category",
              "description",
              "expenseDate",
              "status",
            ]),
          };
        });
      },
    }),
};

export const expenseTools: ToolSpec[] = [listExpenses];
