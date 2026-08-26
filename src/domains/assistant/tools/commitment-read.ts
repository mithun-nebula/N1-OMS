import { tool } from "ai";
import { z } from "zod";
import type { ToolSpec } from "./catalogue";

/**
 * The read that supplies `settle_commitment`'s id.
 *
 * ── Found by a test, which is the point ─────────────────────────────────────
 *
 * `pairing.test.ts` walks every write tool, reads the id fields out of its
 * `inputSchema`, and asserts some read tool actually returns them. It found
 * that `settle_commitment` takes a `commitmentId` and **nothing produced one**.
 * Its own description said the id came "from the brief or from
 * remember_commitment" — the brief is not a tool, and the other is a write.
 *
 * So the model could only ever settle a reminder it had created moments before
 * in the same conversation. Anything recorded yesterday was unreachable, and
 * the failure mode is not an error: it is a confident wrong answer about a
 * reminder that plainly exists.
 *
 * The corroboration was already in Phase 2's log and nobody had joined it up —
 * across a whole live day `settle_commitment` was reached **0 times**, the only
 * write tool never used. It was not that nobody wanted to settle a reminder.
 * There was no id to settle one with.
 *
 * This is exactly the class of bug the pairing test exists to catch before
 * Phase 3 does it fifty-nine times.
 */
export const myCommitments: ToolSpec = {
  name: "my_commitments",
  build: (ctx) =>
    tool({
      description: [
        "This tool does NOT show today's committed work — for that, use my_day. These are reminders the person explicitly asked to be chased about.",
        "",
        "The reminders this person asked for, with their ids.",
        'Use for "what did I ask you to remind me about", "what have I got outstanding", and BEFORE settling one.',
        "",
        "Returns, per reminder: its id, what they said, the day it is due, and whether it has been settled.",
        "The id is what settle_commitment needs — call this first if you do not have one, and never invent one.",
        "",
        "Only ever about the person asking. There is no way to see anybody else's.",
      ].join("\n"),
      inputSchema: z.object({
        includeSettled: z
          .boolean()
          .optional()
          .describe("Defaults to false — only what is still outstanding."),
      }),
      execute: async ({ includeSettled = false }) => {
        const store = ctx.deps.commitments;
        if (!store) {
          return { found: false, note: "Reminders are not available." };
        }
        const all = await store.listFor(ctx.actor);
        const rows = includeSettled ? all : all.filter((c) => !c.dischargedAt);
        for (const c of rows) ctx.note("commitment", c.id);
        return {
          found: rows.length > 0,
          // Honest about an empty list rather than returning [] with no word,
          // which reads as "you have nothing" whichever way it is meant.
          note:
            rows.length === 0
              ? "Nothing outstanding — they have not asked to be reminded of anything."
              : undefined,
          items: rows.map((c) => ({
            id: c.id,
            what: c.what,
            dueDate: c.dueDate,
            settled: c.dischargedAs,
          })),
        };
      },
    }),
};

export const commitmentReadTools: ToolSpec[] = [myCommitments];
