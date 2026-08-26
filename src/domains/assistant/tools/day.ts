import { tool } from "ai";
import { z } from "zod";
import { directory } from "@/server/directory";
import type { ToolSpec } from "./catalogue";
import { shape } from "./shape";
import { PERIODS, resolveWindow } from "./window";

/**
 * The days behind you, and the thin slice of somebody else's a manager may see.
 *
 * `team_day` is the highest-risk description in this stage — not because it
 * might leak (the whitelist is enforced in code, in `managerView`), but because
 * **succeeding thinly looks like succeeding**. It returns four fields and no
 * error, so a model that reaches for it to answer "what is my team working on"
 * gets a confident, complete-looking, badly incomplete answer. Its description
 * therefore explains the *limit* rather than only pointing away.
 */

export const myHistory: ToolSpec = {
  name: "my_history",
  build: (ctx) =>
    tool({
      description: [
        "This tool does NOT show today — for what is on you right now, with times, use my_day. It also cannot show anybody else's days; it is only ever your own.",
        "For the work itself rather than how the days went, use list_tasks.",
        "",
        "How your recent days actually went — the stretch behind you.",
        'Use for "how did last week go", "how many days have I planned", "have I been finishing what I commit to", "how am I doing lately".',
        "Returns, per day: the date, how many items were committed and how many finished, the minutes committed, how many ran over, how many were interrupted or dropped, and the shortfall in minutes.",
        "Also returns the exact window it looked at. State those dates rather than working any out yourself.",
      ].join("\n"),
      inputSchema: z.object({
        period: z
          .enum(PERIODS)
          .optional()
          .describe("A named period. Do NOT calculate dates yourself — name the period."),
        from: z.string().optional().describe("Explicit start, YYYY-MM-DD. Overrides period."),
        to: z.string().optional().describe("Explicit end, YYYY-MM-DD. Overrides period."),
      }),
      execute: async ({ period, from, to }) => {
        const service = ctx.deps.dayPlan;
        if (!service) return { found: false, note: "The day plan is not available." };
        const window = resolveWindow(ctx.deps.today(), {
          period: period ?? "this-week",
          from,
          to,
        });
        // Only ever `ctx.actor`. There is no parameter for whose history this
        // is, which is what makes "it cannot show anybody else's" true in code
        // rather than only in the sentence above.
        const days = await service.getStore().history(ctx.actor, window.from, window.to);
        ctx.note("day-plan", `${ctx.actor}:${window.from}..${window.to}`);

        const planned = days.filter((d) => d.committed > 0);
        return {
          found: true,
          window,
          summary: {
            daysWithAPlan: planned.length,
            itemsCommitted: planned.reduce((n, d) => n + d.committed, 0),
            itemsDone: planned.reduce((n, d) => n + d.done, 0),
            daysThatRanOver: planned.filter((d) => d.ranOver > 0).length,
            totalShortfallMinutes: planned.reduce((n, d) => n + d.shortfallMinutes, 0),
          },
          ...shape(days, (d) => ({
            date: d.date,
            committed: d.committed,
            done: d.done,
            committedMinutes: d.committedMinutes,
            ranOver: d.ranOver,
            interrupted: d.interrupted,
            dropped: d.dropped,
            shortfallMinutes: d.shortfallMinutes,
            onLeave: d.onLeave,
          })),
        };
      },
    }),
};

/**
 * Exactly the columns appendix A8 grants a manager, and no more.
 *
 * `managerView` is a four-field whitelist — `id`, `label`, `estimateMinutes`,
 * `done`. Never the streak. Never the reason a thing was missed. A8's argument
 * is that people answer honestly when nobody is reading over their shoulder,
 * so the reason stays between a person and the application.
 *
 * The filter is in `managerView` and this tool does not widen it, does not add
 * a field "for context", and does not return the underlying plan with a note
 * asking the model to ignore parts of it. A filter that depends on the model
 * choosing to honour it is not a filter.
 */
export const teamDay: ToolSpec = {
  name: "team_day",
  build: (ctx) =>
    tool({
      description: [
        "This tool is DELIBERATELY THIN and does NOT show what your team is working on. It returns four things about one person on one day — what they committed to, the time they estimated, and whether each is done. Nothing else.",
        "For what your team is actually working on, use list_tasks. That is almost always the tool you want, and this one is not a substitute for it.",
        "It will never return anybody's streak, and never the reason something was missed. Those are private to the person, by design — do not describe them as unavailable to you, simply do not discuss them.",
        "",
        "What one person on your team committed to on one day.",
        'Use only for "what did Priya commit to today", "did she plan anything for Monday" — a question specifically about somebody\'s COMMITMENTS for a DAY.',
        "Returns the committed items with their estimates and whether each is done. That is the whole of it.",
      ].join("\n"),
      inputSchema: z.object({
        person: z.string().describe("The team member's employee id."),
        date: z
          .string()
          .optional()
          .describe("The day, YYYY-MM-DD. Omit for today — do not calculate it yourself."),
      }),
      execute: async ({ person, date }) => {
        const service = ctx.deps.dayPlan;
        if (!service) return { found: false, note: "The day plan is not available." };
        const day = date ?? ctx.deps.today();

        // The gate decides whether this manager may look at this person at all.
        // A8 governs which FIELDS come back; the permission layer governs WHO.
        const who = await ctx.deps.spine.read({
          actor: ctx.actor,
          nodeType: "employee",
          nodeId: person,
        });
        if (!who.found) {
          return { found: false, date: day, note: `No plan visible for "${person}".` };
        }

        await service.getStore().load(person, day);
        const view = service.managerView(ctx.actor, person, day);
        ctx.note("day-plan", `${person}:${day}`);

        return {
          found: true,
          date: day,
          person,
          name: directory().nameOf(person),
          // Straight from `managerView`. Not re-mapped, not augmented — a
          // second mapping here is a second place a field could creep back in.
          committed: view.committed,
          streakVisible: view.streakVisible,
        };
      },
    }),
};

export const dayTools: ToolSpec[] = [myHistory, teamDay];
