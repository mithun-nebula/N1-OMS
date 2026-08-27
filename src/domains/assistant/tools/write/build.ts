import { tool } from "ai";
import { z } from "zod";
import * as adapters from "@/spine/adapters";
import type { ToolSpec } from "../catalogue";
import type { ToolContext } from "../context";
import { requireConfirmation } from "../confirmation";
import { proposeInstead, wouldPark } from "../propose";
import { resolvePerson } from "./resolve-person";

/**
 * One builder, fifty-six operations.
 *
 * ── Why a factory and not fifty-six hand-rolled files ───────────────────────
 *
 * The parts that differ between write tools are **words and a schema**. The
 * parts that must never differ are the safety mechanics: check whether it would
 * park, read back if it is destructive, submit through `Spine.submit`, and make
 * every refusal loud. Fifty-six hand-written copies of that is fifty-six
 * chances to leave one out, and the one left out is the one that matters.
 *
 * So the mechanics live here, once, and each operation supplies its description
 * and its shape. Adding a tool cannot skip the gate, because there is no path
 * that goes round this function.
 *
 * ── The three tiers ─────────────────────────────────────────────────────────
 *
 * Phase 2's handover is explicit that these are different mechanisms and that
 * *"conflating them would either park everything (unusable) or park nothing
 * (unsafe)"*:
 *
 * | `propose`  | would park under a standing rule | the agent **cannot act** |
 * | `readBack` | destructive but not money/people | acts **after** a server-issued token |
 * | `straight` | everything else                  | it just does it |
 *
 * `readBack` reuses Phase 2.5 Part B's confirmation gate rather than building a
 * second one. That gate's real guarantee is a **turn boundary**: a model can
 * chain two tool calls, but it cannot forge the fact that a person replied.
 */

export type WriteTier = "propose" | "readBack" | "straight";

export interface WriteToolSpec {
  /** The registered operation this wraps — the single source of truth. */
  operation: string;
  /** The tool name the model sees. */
  tool: string;
  tier: WriteTier;
  /**
   * ⚠ **The negative clause, and it comes first.**
   *
   * 1b's finding, and it is the whole craft of this phase: *"This tool does NOT
   * do X, use Y instead"* — written **before** what the tool does. Naming the
   * sibling is half of it; saying what this tool will not do is the half that
   * stops a model settling for a plausible near-miss.
   *
   * A wrong read tool wastes a turn. A wrong write tool cancels the wrong
   * thing, and `cancel_meeting` notifies everybody invited.
   */
  not: string;
  /** What it does, in one line. */
  does: string;
  /** The phrasings that should reach it. */
  use: string;
  /** Anything else the model needs at the moment it chooses. */
  notes?: string[];
  args: z.ZodObject<z.ZodRawShape>;
  /**
   * What a `readBack` confirmation is bound to, so agreeing to delete task A
   * cannot be spent deleting task B. Required for that tier and ignored
   * otherwise.
   */
  target?: (args: Record<string, unknown>) => string;
  /**
   * Argument names that hold a PERSON.
   *
   * Every one of these accepts an employee id or a name, and a name is
   * resolved here before the operation sees it.
   *
   * Why it exists: `create_task` asked for an "Employee id" and said to omit
   * it if unsure. A model told *"create a task for Arun"* does not hold an
   * id, so it omitted the field — and a task the person had plainly assigned
   * arrived on the board **unassigned**, with nothing anywhere saying why.
   * The silence is the defect: a refusal would have been fine.
   */
  people?: string[];
  /** The consequence sentence, read to the person before a `readBack` acts. */
  consequence?: string;
  /** How the proposal reads when this is a `propose` tool. */
  summary?: (args: Record<string, unknown>) => string;
  /** What the actor must be able to view for this tool to be offered at all. */
  requires?: { action: "view" | "export"; nodeType: string };
}

/** Every refusal says, in the payload, that nothing happened and what to say. */
function refused(reason: string, tellThem: string, extra: Record<string, unknown> = {}) {
  return {
    ok: false,
    didNotHappen: true,
    reason,
    tellThem: `This did NOT happen: ${reason} ${tellThem}`,
    ...extra,
  };
}

function describe(spec: WriteToolSpec): string {
  return [
    spec.not,
    "",
    spec.does,
    spec.use,
    ...(spec.notes ?? []),
    "",
    spec.tier === "propose"
      ? "THIS AFFECTS MONEY OR ANOTHER PERSON, so calling it does NOT do it. It prepares it and returns what needs approving. Say plainly that nothing has happened yet and ask them to confirm."
      : spec.tier === "readBack"
        ? "TWO CALLS, AND THE FIRST NEVER ACTS. Call it, read the consequence it returns back to them, get a yes, and only then call it again. You cannot skip the first call."
        : "This acts immediately. Only call it once they have actually asked for it.",
  ].join("\n");
}

/**
 * Turn one specification into a tool.
 *
 * Everything a write tool does passes through here: the gate, the read-back,
 * the submit, and the shape of the answer.
 */
export function buildWriteTool(spec: WriteToolSpec): ToolSpec {
  return {
    name: spec.tool,
    ...(spec.requires ? { requires: spec.requires } : {}),
    build: (ctx: ToolContext) =>
      tool({
        description: describe(spec),
        inputSchema: spec.args,
        execute: async (raw: Record<string, unknown>) => {
          const args = { ...raw };

          // ── names to ids, before anything else looks at the arguments ────
          //
          // Refuses rather than dropping. An unassigned task that was meant for
          // somebody is worse than an error, because nobody finds out.
          for (const field of spec.people ?? []) {
            const given = args[field];
            if (typeof given !== "string" || given.trim() === "") continue;
            const resolved = resolvePerson(given);
            if (resolved.kind === "one") {
              args[field] = resolved.id;
              continue;
            }
            return refused(
              resolved.kind === "none"
                ? `There is nobody here called "${given}".`
                : `More than one person matches "${given}": ${resolved.names.join(", ")}.`,
              resolved.kind === "none"
                ? "Say so, and ask who they meant. Nothing was created."
                : "Ask which of them they meant. Nothing was created — do not pick one.",
            );
          }
          const handler = ctx.deps.spine.operationHandler(spec.operation);
          if (!handler) {
            return refused(
              `${spec.operation} is not available on this system.`,
              "Say so plainly rather than describing it as done.",
            );
          }

          // ── the propose-gate ────────────────────────────────────────────
          // Checked against the HANDLER, not against this tool's declared
          // tier, so a tier written down wrongly cannot open a hole. The tier
          // only ever makes a tool stricter than the handler requires.
          if (spec.tier === "propose" || wouldPark(handler, args)) {
            return await proposeInstead({
              actor: ctx.actor,
              opName: spec.operation,
              args,
              summary: spec.summary?.(args) ?? `${spec.does} (${spec.operation})`,
              turnId: ctx.turnId,
            });
          }

          // ── the read-back ───────────────────────────────────────────────
          if (spec.tier === "readBack") {
            const gate = requireConfirmation({
              actor: ctx.actor,
              tool: spec.tool,
              target: spec.target?.(args) ?? spec.operation,
              turnId: ctx.turnId,
              conversation: ctx.conversationId,
              token: typeof args.confirmationToken === "string" ? args.confirmationToken : undefined,
              consequence: spec.consequence ?? "This cannot be taken back easily.",
              tellThem:
                "Say what will happen, ask them, and then STOP and wait for their reply.",
            });
            if (!gate.act) return gate.result;
            delete args.confirmationToken;
          }

          // ── and only now, the spine ─────────────────────────────────────
          // `fromTyped`, because a person asked for this in words. The gate,
          // the permission policy and the activity log are all unchanged: the
          // SDK orchestrates, the spine decides.
          const outcome = await ctx.deps.spine.submit(
            adapters.fromTyped({ actor: ctx.actor, name: spec.operation, args }),
          );

          if (outcome.status === "forbidden") {
            return refused(
              "They are not allowed to do that.",
              "Say only that it is not available to them. Do not say who could do it, or what the record contains.",
            );
          }
          if (outcome.status === "rejected") {
            return refused(
              outcome.detail ?? "The details were not enough to do it.",
              "Pass that on as a question — do not decide for yourself what was missing, and do not describe it as done.",
              { missing: outcome.missing },
            );
          }
          if (outcome.status !== "ran") {
            return refused(
              `It is waiting: ${outcome.status}.`,
              "Say it has NOT happened and what it is waiting for.",
            );
          }

          for (const change of outcome.result?.changes ?? []) {
            ctx.note(change.nodeType, String(change.nodeId));
          }
          return {
            ok: true,
            did: spec.operation,
            result: outcome.result?.response ?? null,
            // So the model can offer it, and so `undo_last` has something to
            // take hold of.
            activityId: outcome.activityEntry?.id,
            undoable: Boolean(outcome.activityEntry?.undoDescription),
          };
        },
      }),
  };
}

/** The one field every read-back tool adds to its own schema. */
export const CONFIRMATION_FIELD = {
  confirmationToken: z
    .string()
    .optional()
    .describe(
      "The token the FIRST call gave you, passed back after they agreed. Omit it on the first call. Never invent one.",
    ),
};
