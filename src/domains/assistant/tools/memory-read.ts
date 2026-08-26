import { tool } from "ai";
import { z } from "zod";
import type { ToolSpec } from "./catalogue";
import { DOMAIN_IDS } from "../specialists/domain-ids";
import { visibleFacts } from "../memory/visible";

/**
 * What this person has told the assistant about how they work.
 *
 * ── ⚠ WHY THIS IS ON THE COORDINATOR AND NOT BEHIND A SPECIALIST ───────────
 *
 * Phase 4.5 measured the reason twice, live:
 *
 *     A TOOL MOVED OUT OF VIEW IS NOT MERELY SLOWER TO REACH.
 *     THE NEAREST THING STILL IN VIEW GETS CALLED INSTEAD.
 *
 *   `remember_commitment` out of view -> `author_rule` called, and refused
 *   `drop_item`           out of view -> `approve_proposal` called, and failed
 *
 * Neither was a routing error. **The model never considered routing** — it
 * found something plausible and used it. Memory spans every domain, and
 * `search_memory` — recorded organisational decisions, an entirely different
 * thing — is already in view. Hidden, this is the textbook substitution case.
 *
 * ── ⚠ AND SPECIALISTS DO NOT GET A TOOL ────────────────────────────────────
 *
 * They receive their own domain's facts directly, when their instructions are
 * built (`fanout.ts`). A specialist holding a memory tool would be a second
 * door to the same store with a second set of rules to keep in step.
 *
 * ── ⚠ THE ACTOR IS NOT A PARAMETER ─────────────────────────────────────────
 *
 * `tools/context.ts:12-29`. It is a closure variable, bound from the signed-in
 * session. `grep -rn "actor: z\." src/domains/assistant/tools/` must keep
 * returning nothing — a memory tool that took an actor would be the first place
 * prompt injection could name somebody else.
 *
 * ── Modelled on `my_commitments`, deliberately ─────────────────────────────
 *
 * Phase 2.5 found the mirror defect: `settle_commitment` took an id nothing
 * produced, so across a whole live day it was reached **zero times**. **A store
 * nothing can retrieve is not memory.** This ships in the same step as the
 * table for that reason.
 */
export const myMemory: ToolSpec = {
  name: "my_memory",
  build: (ctx) =>
    tool({
      description: [
        "What this person has TOLD you about how they work — stated preferences, corrections, standing context.",
        "",
        "This is NOT search_memory. search_memory finds decisions the ORGANISATION recorded, with the reason given at the time. This is what THIS PERSON said about their own work.",
        "",
        'Use when a request depends on how they like things done — "schedule the review", "when should I do this", "set that up the usual way" — and before asking them something they may have already told you.',
        "",
        "Returns short statements in their own words, optionally narrowed to one area.",
        "",
        "Only ever about the person asking. There is no way to see anybody else's.",
      ].join("\n"),
      inputSchema: z.object({
        // Derived from the existing DomainId union, not a second vocabulary
        // written out again here — see `specialists/domain-ids.ts`.
        area: z
          .enum(DOMAIN_IDS)
          .optional()
          .describe("Narrow to one area. Omit for everything they have said."),
      }),
      execute: async ({ area }) => {
        const store = ctx.deps.memory;
        if (!store) {
          return { found: false, note: "Memory is not available." };
        }
        // Through `visibleFacts`, never `recall` — that is where the read-time
        // permission re-check lives, and a fact resting on a record this person
        // may no longer see is ABSENT rather than refused.
        const facts = await visibleFacts(store, ctx, area ? { domain: area } : {});
        return {
          found: facts.length > 0,
          // Honest about an empty list rather than returning [] with no word,
          // which reads as "they have told you nothing" whichever way it is
          // meant — the same reason `my_commitments` says so.
          note:
            facts.length === 0
              ? "They have not told you anything about how they like this done."
              : undefined,
          items: facts.map((f) => ({
            area: f.domain,
            said: f.text,
            since: f.createdAt.slice(0, 10),
          })),
        };
      },
    }),
};

export const memoryReadTools: ToolSpec[] = [myMemory];
