import { tool } from "ai";
import { z } from "zod";
import type { ToolSpec } from "./catalogue";
import { resolveDueDate, DUE_WHEN } from "./due-date";

/**
 * Recording a promise, and settling it.
 *
 * ── Explicit only ───────────────────────────────────────────────────────────
 *
 * *"Remind me to do the Priya review on Thursday"* is recorded. *"I'll get that
 * done Thursday"* is not, and inferring the second is a later decision.
 *
 * The reason is the failure mode. *"I should probably look at that"* is not a
 * promise, and an assistant that chases you about things you never committed to
 * is worse than one that only remembers what you asked it to. Explicit costs a
 * person a few words and cannot misfire — so the description below says, in as
 * many words, only record what was actually asked for.
 *
 * ── Why these are tools at all ──────────────────────────────────────────────
 *
 * Found by running a real day. Asked *"remind me to do the Priya review on
 * Thursday"*, the assistant searched the calendar, found nothing, and replied
 * *"I cannot create reminders"* — because it could not. The store existed and
 * the brief read from it; there was simply no way to put anything in.
 */

export const rememberCommitment: ToolSpec = {
  name: "remember_commitment",
  build: (ctx) =>
    tool({
      description: [
        "This tool does NOT add work to today's plan — for that, use select_item. It does not create a meeting or a calendar entry either; it is a private reminder, and nobody else sees it.",
        "",
        "Remember something the person has EXPLICITLY asked to be reminded of.",
        'Use only when they actually ask: "remind me to…", "don\'t let me forget…", "chase me about…".',
        "",
        "DO NOT record something they merely mentioned. \"I should probably look at that\" and \"I'll try to get to it\" are not requests to be reminded, and chasing somebody about a thing they never promised is worse than not remembering at all. If you are unsure whether they asked, ask them.",
        "",
        "Say WHEN as one of the named options — do not work a date out yourself. This resolves it and tells you the date it used, which is the date to say back to them.",
        "Returns what was recorded and the resolved due date.",
      ].join("\n"),
      inputSchema: z.object({
        what: z
          .string()
          .describe("What to remind them of, in their own words. Keep it short."),
        when: z
          .enum(DUE_WHEN)
          .optional()
          .describe("A named day. Do NOT calculate a date — name the day and this resolves it."),
        dueDate: z
          .string()
          .optional()
          .describe("An explicit date, YYYY-MM-DD, only if they gave one. Overrides `when`."),
      }),
      execute: async ({ what, when, dueDate }) => {
        const store = ctx.deps.commitments;
        if (!store) {
          return {
            ok: false,
            didNotHappen: true,
            tellThem: "Reminders are not available, so nothing was recorded.",
          };
        }
        const resolved = resolveDueDate(ctx.deps.today(), { when, explicit: dueDate });
        const commitment = await store.record({
          actor: ctx.actor,
          what,
          dueDate: resolved.date,
        });
        ctx.note("commitment", commitment.id);
        return {
          ok: true,
          remembered: { id: commitment.id, what: commitment.what },
          // The ground truth, so the sentence can state the day rather than
          // repeating "Thursday" and hoping it meant the same one.
          dueDate: resolved.date,
          meaning: resolved.meaning,
          tellThem: `Say it back with the date: ${resolved.meaning}. It will come up in that morning's brief.`,
        };
      },
    }),
};

export const settleCommitment: ToolSpec = {
  name: "settle_commitment",
  build: (ctx) =>
    tool({
      description: [
        "This tool does NOT mark day-plan work done — for that, use mark_done. It only settles a reminder they asked for earlier.",
        "",
        "Close off a reminder, or move it.",
        'Use when they answer a chase: "done that", "drop it", "not today, make it Friday".',
        "",
        'Moving it is not the same as finishing it, and "drop" is not "done" — record what they actually said, because the difference is the whole value of having remembered.',
        "Returns what was settled and how.",
      ].join("\n"),
      inputSchema: z.object({
        commitmentId: z.string().describe("The id, from the brief or from remember_commitment."),
        outcome: z
          .enum(["done", "dropped", "moved"])
          .describe("What they said. Use `moved` with a new day rather than `done`."),
        when: z
          .enum(DUE_WHEN)
          .optional()
          .describe("For `moved`: the new day, named. Do not calculate a date."),
        dueDate: z.string().optional().describe("For `moved`: an explicit YYYY-MM-DD."),
      }),
      execute: async ({ commitmentId, outcome, when, dueDate }) => {
        const store = ctx.deps.commitments;
        if (!store) {
          return {
            ok: false,
            didNotHappen: true,
            tellThem: "Reminders are not available, so nothing was changed.",
          };
        }
        if (outcome === "moved") {
          const resolved = resolveDueDate(ctx.deps.today(), { when, explicit: dueDate });
          const moved = await store.reschedule(ctx.actor, commitmentId, resolved.date);
          if (!moved) {
            return {
              ok: false,
              didNotHappen: true,
              tellThem: "There is no reminder with that id, so nothing was moved.",
            };
          }
          ctx.note("commitment", commitmentId);
          return { ok: true, moved: moved.what, dueDate: resolved.date, meaning: resolved.meaning };
        }
        const settled = await store.discharge(ctx.actor, commitmentId, outcome);
        if (!settled) {
          return {
            ok: false,
            didNotHappen: true,
            tellThem: "There is no reminder with that id, so nothing was changed.",
          };
        }
        ctx.note("commitment", commitmentId);
        return { ok: true, settled: settled.what, as: outcome };
      },
    }),
};

export const commitmentTools: ToolSpec[] = [rememberCommitment, settleCommitment];
