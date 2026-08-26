import { tool } from "ai";
import { z } from "zod";
import type { ToolSpec } from "./catalogue";
import type { ToolContext } from "./context";
import { requireConfirmation } from "./confirmation";

/**
 * The first tools in this product that write.
 *
 * ── What they may touch, and what they may not ──────────────────────────────
 *
 * **The caller's own day, and nothing else.** Not another person's plan, and
 * not one of the 59 gated operations — those stay untouched until Phase 3.
 * `team_day` remains read-only, and appendix A8's four-field whitelist is not
 * negotiable from the write side either: a manager sees what was committed and
 * whether it was done, never the streak and never why something was missed.
 *
 * None of these takes a person as a parameter. There is nowhere to put one —
 * the actor is the closure, as it is for every read tool, so "write to somebody
 * else's day" is not a thing the model can express.
 *
 * ── Why they exist at all ───────────────────────────────────────────────────
 *
 * `/api/today` does **not** go through the 59 gated operations. It is a
 * separate write path, so Phase 3's write catalogue would never have reached
 * it. Without these six the assistant can describe your day and not change it,
 * which is a strange thing for a productivity product whose stated motive is
 * the day plan.
 *
 * ── The rule that governs the wording of all six ────────────────────────────
 *
 * **The service keeps its judgement.** `tick` asks `classifyMiss` whether an
 * overrun was an interruption, against the real meeting calendar. That verdict
 * comes back in the result and the model writes the sentence *around* it. A
 * model that re-decides "was this interrupted?" will contradict the streak, and
 * the streak is the thing a person actually trusts.
 */

/** The service, or a clear refusal. Every tool below starts here. */
function dayPlanOf(ctx: ToolContext) {
  return ctx.deps.dayPlan;
}

const UNAVAILABLE = {
  ok: false,
  didNotHappen: true,
  tellThem: "The day plan is not available, so nothing was recorded.",
} as const;

/**
 * A refusal the model cannot mistake for a success.
 *
 * Found by running a real morning: three items were named, all three were
 * refused by the service, and the assistant replied *"I've added Module 4 (60
 * minutes) and Arun prep (30 minutes) to your plan."* It had read `ok: false`
 * and narrated a success anyway.
 *
 * `{ ok: false }` alone is too quiet to survive a model in a hurry. So a
 * failure now says, in the payload, both that nothing happened and what to
 * tell the person — the same trick that worked for `required_documents`, where
 * naming the absence in the DATA rather than only the description is what
 * stopped it being papered over.
 */
function refused(reason: string, extra: Record<string, unknown> = {}) {
  return {
    ok: false,
    didNotHappen: true,
    reason,
    tellThem: `This did NOT happen: ${reason} Say so plainly. Do not describe it as done.`,
    ...extra,
  };
}

export const selectItemTool: ToolSpec = {
  name: "select_item",
  build: (ctx) =>
    tool({
      description: [
        "This tool does NOT read the plan — for what is on today, use my_day. It cannot add anything to anybody else's day, only your own.",
        "",
        "Commit to a piece of work for today, with a time estimate.",
        'Use when the person says what they are taking on — "I\'ll do Module 4 and the Arun prep", "put the deck on today".',
        "Call it once per item.",
        "",
        "A TIME IS REQUIRED and the service enforces it. Call this with whatever you were told; if no time was given, call it anyway and it will come back refused with a message. Pass that refusal on as a question — do not decide for yourself that a time is missing, and do not ask for one before calling.",
        "Returns the item that was added, or an error explaining what is missing.",
      ].join("\n"),
      inputSchema: z.object({
        label: z.string().describe("What the work is, in the person's own words."),
        estimateMinutes: z
          .number()
          .optional()
          .describe("Minutes they said it would take. OMIT if they did not say — do not guess."),
        taskId: z
          .string()
          .optional()
          .describe("The backing task id, when this is a task from the board."),
      }),
      execute: async ({ label, estimateMinutes, taskId }) => {
        const service = dayPlanOf(ctx);
        if (!service) return UNAVAILABLE;
        const date = ctx.deps.today();
        await service.getStore().load(ctx.actor, date);
        try {
          // Called with whatever was said, including nothing. `selectItem`
          // refuses an item with no estimate and there is a test for it — this
          // surfaces that refusal rather than duplicating the rule. Two rules
          // that can drift apart is worse than one that sometimes says no.
          const result = service.selectItem(ctx.actor, date, {
            label,
            estimateMinutes: estimateMinutes ?? 0,
            ref: taskId ? { nodeType: "task", nodeId: taskId } : undefined,
          });
          if (result.error) {
            return refused(result.error, { needsAnswer: true, question: result.error, label });
          }
          ctx.note("day-plan", `${ctx.actor}:${date}`);
          return {
            ok: true,
            added: { id: result.item?.id, label, estimateMinutes: result.item?.estimateMinutes },
            overCapacity: result.overCapacity === true,
            note: result.overCapacity
              ? "This is now more than the working day holds. Say so plainly; do not refuse it."
              : undefined,
          };
        } catch (error) {
          return refused(error instanceof Error ? error.message : "That did not work.");
        }
      },
    }),
};

export const commitPlanTool: ToolSpec = {
  name: "commit_plan",
  build: (ctx) =>
    tool({
      description: [
        "This tool does NOT add work — use select_item for each item first. It only closes the choosing.",
        "",
        "Commit today's plan, once the person has finished saying what they are taking on.",
        'Use for "that\'s it", "yes, commit that", "start the day".',
        "Safe to call twice: committing an already-committed day changes nothing.",
        "Returns what was committed and the total time it comes to.",
      ].join("\n"),
      inputSchema: z.object({}),
      execute: async () => {
        const service = dayPlanOf(ctx);
        if (!service) return UNAVAILABLE;
        const date = ctx.deps.today();
        await service.getStore().load(ctx.actor, date);
        try {
          const plan = service.commitPlan(ctx.actor, date);
          ctx.note("day-plan", `${ctx.actor}:${date}`);
          const { tally } = service.dashboard(ctx.actor, date);
          return {
            ok: true,
            committed: plan.plan.filter((p) => !p.dropped).map((p) => p.label),
            minutes: { work: tally.work, meetings: tally.meetings, free: tally.free },
          };
        } catch (error) {
          return refused(error instanceof Error ? error.message : "That did not work.");
        }
      },
    }),
};

export const markDoneTool: ToolSpec = {
  name: "mark_done",
  build: (ctx) =>
    tool({
      description: [
        "This tool does NOT drop work or carry it over — for those, use drop_item or carry_over. It records that something is finished, or partly finished.",
        "",
        "Mark a committed item done, or record progress on it without finishing it.",
        'Use for "I\'ve finished Module 4", "that took about three hours", "I got halfway through the deck".',
        "",
        "IMPORTANT — WHETHER AN OVERRUN WAS AN INTERRUPTION IS NOT YOURS TO DECIDE. If it ran over, the result tells you `missKind`: `interrupted` means a meeting sat in the window and the time was taken from them; `ran-over` means the work took longer. Write your sentence around whichever comes back. Never contradict it, and never call something interrupted because they said it felt like it.",
        "Returns what was recorded, the verdict if there is one, and whether anything later in the day is now at risk.",
      ].join("\n"),
      inputSchema: z.object({
        itemId: z.string().describe("The plan item id, from my_day."),
        actualMinutes: z
          .number()
          .optional()
          .describe("How long it actually took, if they said. Finishes the item."),
        progressMinutes: z
          .number()
          .optional()
          .describe("Minutes done WITHOUT finishing it. Use for 'I got halfway'."),
      }),
      execute: async ({ itemId, actualMinutes, progressMinutes }) => {
        const service = dayPlanOf(ctx);
        if (!service) return UNAVAILABLE;
        const date = ctx.deps.today();
        await service.getStore().load(ctx.actor, date);
        try {
          const result = await service.tick(ctx.actor, date, itemId, {
            actualMinutes,
            progressMinutes,
          });
          if (!result.item) return refused("No such item on today's plan.");
          ctx.note("day-plan", `${ctx.actor}:${date}`);
          return {
            ok: true,
            item: result.item.label,
            finished: result.item.done === true,
            minutesLeft: result.shortfallMinutes,
            // The verdict, decided by classifyMiss against the real calendar.
            missKind: result.miss?.kind,
            missCause: result.miss?.cause,
            laterWorkAtRisk: result.offerNow === true,
            note: result.miss?.kind
              ? "The verdict above was decided from the meeting calendar. Write around it; do not re-decide it."
              : undefined,
          };
        } catch (error) {
          return refused(error instanceof Error ? error.message : "That did not work.");
        }
      },
    }),
};

export const dropItemTool: ToolSpec = {
  name: "drop_item",
  build: (ctx) =>
    tool({
      description: [
        "This tool does NOT postpone work — dropping means it is off, and it will NOT come back tomorrow. To keep it for another day, use carry_over instead. That distinction matters and the person should hear it before you call this.",
        "",
        "Drop a committed item: they are not doing it, and it is not owed.",
        'Use for "forget Module 4", "drop the deck", "I\'m not doing that today".',
        "",
        "TWO CALLS, AND THE FIRST ONE NEVER ACTS. Call it with no confirmationToken: it will refuse and hand you a consequence sentence plus a token. Read the consequence to the person, get a yes, then call again passing that token back. Dropping does not break their streak, and you may say so.",
        "You cannot skip the first call, and you cannot make up a token — the server issues them and checks them.",
        "Returns what was dropped.",
      ].join("\n"),
      inputSchema: z.object({
        itemId: z.string().describe("The plan item id, from my_day."),
        reason: z
          .string()
          .optional()
          .describe("Why, if they said. Optional — never press for it."),
        confirmationToken: z
          .string()
          .optional()
          .describe(
            "The token the FIRST call gave you, passed back after they agreed. Omit it on the first call. Never invent one.",
          ),
      }),
      execute: async ({ itemId, reason, confirmationToken }) => {
        const service = dayPlanOf(ctx);
        if (!service) return UNAVAILABLE;
        // Acts only once a person has been asked in an EARLIER turn and has
        // come back. Everything else returns the refusal as-is.
        const gate = requireConfirmation({
          actor: ctx.actor,
          tool: "drop_item",
          target: itemId,
          turnId: ctx.turnId,
          conversation: ctx.conversationId,
          token: confirmationToken,
          consequence:
            "Dropping it takes it off today and it will NOT carry over to another day. It does not break their streak.",
          tellThem:
            "Say what dropping does — it comes off today and will not carry over — and ask them to confirm. Then STOP and wait for their reply.",
        });
        if (!gate.act) return gate.result;
        const date = ctx.deps.today();
        await service.getStore().load(ctx.actor, date);
        const result = service.dropItem(ctx.actor, date, itemId, reason);
        if (result.error) return refused(result.error);
        ctx.note("day-plan", `${ctx.actor}:${date}`);
        return {
          ok: true,
          dropped: result.item?.label,
          // A9. Worth returning so the sentence can be reassuring and true.
          streakEffect: "none — dropping does not break a streak",
        };
      },
    }),
};

export const carryOverTool: ToolSpec = {
  name: "carry_over",
  build: (ctx) =>
    tool({
      description: [
        "This tool does NOT drop work and does NOT finish it. It means: meant to do it, not today.",
        "For work they are abandoning, use drop_item. For work they finished, use mark_done.",
        "",
        "Carry an unfinished item over to another day. It is offered again tomorrow morning.",
        'Use for "I\'ll do that tomorrow", "push Module 4 to next week", "not today".',
        "",
        "SAY THIS CORRECTLY, IT IS EASY TO GET WRONG. Carrying something over does NOT make the day count as clean — a day is clean when everything committed was finished in its time. What it does mean is that it will not BREAK their streak the way running over does, and it comes back tomorrow. Never tell somebody their day is still clean because they carried work over; that teaches them to game their own streak.",
        "Returns what was carried, and what it means for the day.",
      ].join("\n"),
      inputSchema: z.object({
        itemId: z.string().describe("The plan item id, from my_day."),
      }),
      execute: async ({ itemId }) => {
        const service = dayPlanOf(ctx);
        if (!service) return UNAVAILABLE;
        const date = ctx.deps.today();
        await service.getStore().load(ctx.actor, date);
        const result = service.carryOverItem(ctx.actor, date, itemId);
        if (result.error) return refused(result.error);
        ctx.note("day-plan", `${ctx.actor}:${date}`);
        return {
          ok: true,
          carried: result.item?.label,
          // Spelled out because the wrong sentence here is actively harmful.
          dayStillCounted: false,
          streakEffect: "does not break the streak, but the day is not clean either",
          note: "Do not say the day is still clean. Say it will be offered again tomorrow and that it has not broken anything.",
        };
      },
    }),
};

export const closeOutTool: ToolSpec = {
  name: "close_out",
  build: (ctx) =>
    tool({
      description: [
        "This tool does NOT mark anything done — settle each open item with mark_done, carry_over or drop_item first, or during the conversation.",
        "",
        "Close the day. TWO STEPS, AND THE ORDER MATTERS.",
        "",
        'First call it with step "begin". That returns a summary of the day and what is still open. It deliberately does NOT fold the day into the streak, so anything they tell you next still counts.',
        'Then talk through whatever is still open. Only when that is settled, call it again with step "finish".',
        "",
        "NEVER call finish first. The day is assessed once and only on finish; assessing it before the conversation would mean every answer arrives too late to change anything, and the conversation is theatre.",
        "FINISH ALSO TAKES TWO CALLS. The first finish never acts: it refuses and hands you a consequence sentence plus a token. Read it back, get a yes, then call finish again passing that token. You cannot skip it and you cannot make up a token — the server issues them and checks them.",
        "Returns the summary on begin, and what was recorded on finish.",
      ].join("\n"),
      inputSchema: z.object({
        step: z
          .enum(["begin", "finish"])
          .describe("Always begin first. Only finish once everything open has been settled."),
        confirmationToken: z
          .string()
          .optional()
          .describe(
            "For finish: the token the FIRST finish call gave you, passed back after they agreed. Never invent one.",
          ),
      }),
      execute: async ({ step, confirmationToken }) => {
        const service = dayPlanOf(ctx);
        if (!service) return UNAVAILABLE;
        const date = ctx.deps.today();
        await service.getStore().load(ctx.actor, date);
        try {
          if (step === "begin") {
            const summary = service.beginCloseOut(ctx.actor, date);
            ctx.note("day-plan", `${ctx.actor}:${date}`);
            return {
              ok: true,
              step: "begin",
              summary,
              note:
                summary.unfinished.length > 0
                  ? "Settle each open item before calling finish. The day has NOT been assessed yet."
                  : "Nothing is open. Read back that this ends the day, then call finish.",
            };
          }
          // The day is the target: a confirmation to close Tuesday must not
          // close Wednesday.
          const gate = requireConfirmation({
            actor: ctx.actor,
            tool: "close_out",
            target: date,
            turnId: ctx.turnId,
            conversation: ctx.conversationId,
            token: confirmationToken,
            consequence:
              "Finishing closes the day and folds it into the streak. Nothing said afterwards changes it.",
            tellThem:
              "Say that this ends the day, ask them, and then STOP and wait for their reply. Nothing has been assessed yet.",
          });
          if (!gate.act) return gate.result;
          const { seeded } = service.finishCloseOut(ctx.actor, date);
          ctx.note("day-plan", `${ctx.actor}:${date}`);
          return {
            ok: true,
            step: "finish",
            offeredTomorrow: seeded,
            note: "The day is now folded into the streak. Nothing said after this changes it.",
          };
        } catch (error) {
          return refused(error instanceof Error ? error.message : "That did not work.");
        }
      },
    }),
};

export const dayWriteTools: ToolSpec[] = [
  selectItemTool,
  commitPlanTool,
  markDoneTool,
  dropItemTool,
  carryOverTool,
  closeOutTool,
];
