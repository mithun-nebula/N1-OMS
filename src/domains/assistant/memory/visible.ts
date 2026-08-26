import type { ToolContext } from "../tools/context";
import type { DomainId } from "../specialists/domains";
import type { MemoryFact, MemoryStore } from "./store";

/**
 * What this person may actually be told, right now.
 *
 * ── ⚠ TRAP 2: RE-CHECK PERMISSION AT READ TIME ─────────────────────────────
 *
 * A fact carrying `derivedFrom` was written when somebody could see those
 * records. **Permissions change.** Somebody moves team, a manager stops being
 * a manager, a record is reassigned — and a fact trusted from write time
 * outlives the permission that justified it. A rule never outlives its owner.
 *
 * `OrgMemoryService.retrieve(id, canView)` (`org-memory/service.ts:34-54`) is
 * the worked example of exactly this problem in this codebase, and this is the
 * same shape: resolve every linked record through `spine.read` **as the person
 * asking**, at the moment they ask.
 *
 * ── ⚠ TRAP 3: REFUSE BY OMISSION ──────────────────────────────────────────
 *
 * A fact the actor may not see is **absent**. Never *"you may not see memory
 * #7"* — that discloses #7 exists. Non-negotiable #2, and it is why
 * `spine.read` itself returns `{ found: false }` for "no such record" and "not
 * yours" alike.
 *
 * ⚠ **One function, two callers.** `my_memory` and the specialist injection
 * both come through here. A rule that has to be remembered in two places is a
 * rule that will be forgotten in the third.
 */
export async function visibleFacts(
  store: MemoryStore,
  ctx: ToolContext,
  opts: { domain?: DomainId; today?: string } = {},
): Promise<MemoryFact[]> {
  const facts = await store.recall(ctx.actor, {
    domain: opts.domain,
    today: opts.today ?? ctx.deps.today(),
  });

  const checked = await Promise.all(
    facts.map(async (fact) => {
      if (!fact.derivedFrom || fact.derivedFrom.length === 0) return fact;
      for (const link of fact.derivedFrom) {
        const result = await ctx.deps.spine.read({
          actor: ctx.actor,
          nodeType: link.nodeType,
          nodeId: link.nodeId,
        });
        // Every record it rests on, or it is not returned. A fact half-visible
        // is a fact that leaks the other half by implication.
        if (!result.found) return undefined;
      }
      return fact;
    }),
  );

  return checked.filter((f): f is MemoryFact => f !== undefined);
}
