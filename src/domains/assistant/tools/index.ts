import type { ToolSet } from "ai";
import type { ActorId } from "@/spine/operation/types";
import { ToolContext, type ToolDeps } from "./context";
import { buildToolSet, toolNames, type ToolSpec } from "./catalogue";
import { peopleTools } from "./people";
import { workTools } from "./work";
import { supportTools } from "./support";
import { scheduleTools } from "./schedule";
import { dayTools } from "./day";
import { capabilityTools } from "./capability";
import { crossTools } from "./cross";
import { dayWriteTools } from "./day-write";
import { commitmentTools } from "./commitment-write";
import { commitmentReadTools } from "./commitment-read";
import { memoryReadTools } from "./memory-read";
import { expenseTools } from "./expenses";
import { writeTools } from "./write";
import { ruleTools } from "./rules";

export { ToolContext, type ToolDeps, type ReadRef } from "./context";
export { toolNames, type ToolSpec } from "./catalogue";
export { shape, safeFields, visible, DEFAULT_CAP } from "./shape";

/**
 * Everything the assistant can do.
 *
 * **34 read tools, six that write to the caller's own day, and two that record
 * an explicit reminder.**
 *
 * The thirty-fourth is `my_commitments`, added in Phase 2.5 Part B because
 * `pairing.test.ts` found that `settle_commitment` took a `commitmentId` no
 * read tool produced. Phase 2's live day corroborates it: `settle_commitment`
 * was the one write tool reached ZERO times, and now it is clear why.
 *
 * Phase 2 is where the second group arrives, and the boundary is narrow on
 * purpose: they reach `/api/today` and nothing else. None of the 59 gated
 * operations is a tool here, and none of the six takes a person as a parameter
 * — the actor is the closure, so "change somebody else's day" is not
 * expressible. Wrapping the gated operations is Phase 3.
 *
 * Every tool wraps `spine.read` / `spine.readMany` or a service above them, so
 * each one re-checks record scope per row and applies the field policy. An
 * agent built only on these cannot surface something its user could not already
 * open — not because it is well behaved, but because there is no path.
 *
 * `record.*` is deliberately absent: it is a browsing tool over all 150
 * doctypes and was the source of the pay hole.
 *
 * `who_is_best` and `capability_gaps` are here now, and are the only two
 * written to a different shape: they **derive** rather than retrieve, so they
 * return the numbers they ranked on rather than a verdict. See
 * `capability.ts` for why 1a's date bug is the reason.
 *
 * `search` is here too, and its description is written to LOSE — it competes
 * with all thirty-two others on every vague question and answers most of them
 * worse. See `cross.ts`.
 */
export const ALL_TOOLS: readonly ToolSpec[] = [
  ...peopleTools,
  ...workTools,
  ...scheduleTools,
  ...supportTools,
  ...dayTools,
  ...capabilityTools,
  ...crossTools,
  ...commitmentReadTools,
  // Phase 4.6: what this person told the assistant about how they work.
  ...memoryReadTools,
  ...expenseTools,
  ...dayWriteTools,
  ...commitmentTools,
  ...writeTools,
  // Phase 4: rules that watch unattended. Coordinator-only like every write.
  ...ruleTools,
];

/** Every tool name, for tests and for the outcome checklist. */
export const ALL_TOOL_NAMES: readonly string[] = ALL_TOOLS.map((t) => t.name);

/**
 * Build this person's tool catalogue, for this request.
 *
 * Per request because that is what lets the actor be a closure variable rather
 * than a parameter — see `context.ts` for why that distinction is the one the
 * whole phase rests on.
 */
export function toolsFor(
  actor: ActorId,
  deps: ToolDeps,
): { tools: ToolSet; ctx: ToolContext; names: string[] } {
  const ctx = new ToolContext(actor, deps);
  const tools = buildToolSet(ctx, ALL_TOOLS);
  return { tools, ctx, names: toolNames(tools) };
}
