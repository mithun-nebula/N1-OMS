export interface AppendixDCheck {
  ok: boolean;
  reason?: string;
  kind?: "person" | "comparison";
}

/**
 * Which surface the sentence is coming out of.
 *
 * ── The decision, taken deliberately in Phase 2.5 Part B ────────────────────
 *
 * `/\bin the (afternoon|morning|evening) you\b/i` was written to block
 * *"in the afternoon you work more slowly"* — a comment on the person, which
 * appendix D forbids outright. It is correct where it was written, which is
 * **coaching prose**.
 *
 * It cannot tell that sentence from *"in the afternoon you have the review"* —
 * a fact about the diary. Both match. Phase 2 never advises WHEN to do
 * something, so it never fired. **Phase 3 proposes**, and every one of these is
 * a legitimate Phase 3 sentence that the pattern destroys:
 *
 *   "In the morning you have a free hour — shall I move Module 4 there?"
 *   "In the afternoon you have the review, so this would have to be tomorrow."
 *
 * Three options were on the table. **Option A was taken: scope the pattern to
 * the surfaces it was written for.** Applying a coaching filter to a scheduling
 * proposal is a category error — a diary fact is not a comment on a person.
 *
 * Option B (narrow the pattern by requiring a judgement word after "you") was
 * rejected as brittle: the list of judgement words is unbounded. Option C
 * (rewrite rather than block) was rejected because a rewrite that alters
 * meaning is worse than a refusal.
 *
 * ── What this costs, stated honestly ────────────────────────────────────────
 *
 * Measured rather than assumed. Of the sentences this pattern catches:
 *
 *   "In the afternoon you work more slowly."   also caught by TWO others
 *                                              (`you (work|are) slow`,
 *                                               `works more slowly`)
 *   "In the afternoon you get distracted."     also caught by `distracted`
 *   "In the morning you are at your best."     caught by THIS PATTERN ALONE
 *
 * So on a scheduling surface the sentence this pattern was *written for* is
 * still blocked, twice over, by patterns that name the judgement itself. What
 * is genuinely given up is the bare valorising judgement — "in the morning you
 * are at your best" — which no other pattern catches. That is the price, and it
 * is small set against destroying every scheduling proposal the product makes.
 *
 * ── The rule that was not broken ────────────────────────────────────────────
 *
 * **No pattern was loosened, narrowed or reworded.** Every regex below is
 * byte-identical to what it was; only *which surface applies which set*
 * changed. 1b's precedent stands: when `rankedOn` tripped `/\branked\b/i`, the
 * FIELD was renamed rather than the pattern weakened.
 *
 * `"coaching"` is the default, so a caller that says nothing keeps the full,
 * strict set. Loosening has to be asked for by name.
 */
export type AppendixDSurface = "coaching" | "scheduling";

/**
 * Comments on the person. These apply everywhere, on every surface, always.
 */
const PERSON_PATTERNS = [
  /\byou (work|are) (more )?slow/i,
  /\btake a break/i,
  /\byou (always|never|tend to|seem to)\b/i,
  /\byour (habits|pace|character|attitude|energy)\b/i,
  /\b(procrastinat|lazy|distracted|unfocused|burnout|tired)\b/i,
  /\bwork(s)? more slowly\b/i,
];

/**
 * Correct in coaching prose, a category error against a scheduling proposal.
 * Unchanged — moved, not modified.
 */
const COACHING_ONLY_PERSON_PATTERNS = [
  /\bin the (afternoon|morning|evening) you\b/i,
];

/**
 * Comparisons between people. **Never scoped** — appendix D's ban on comparing
 * people has no surface on which it stops applying, and a proposal has no
 * business saying "faster than Priya" either.
 */
const COMPARISON_PATTERNS = [
  /\bcompared (to|with) /i,
  /\bslower than\b/i,
  /\bfaster than\b/i,
  /\bbetter than\b/i,
  /\bworse than\b/i,
  /\bbehind (compared|relative) /i,
  /\branked\b/i,
  /\bvs\.? .*(vs\.? )/i,
];

export function enforceAppendixD(
  text: string,
  surface: AppendixDSurface = "coaching",
): AppendixDCheck {
  const person =
    surface === "coaching"
      ? [...PERSON_PATTERNS, ...COACHING_ONLY_PERSON_PATTERNS]
      : PERSON_PATTERNS;

  for (const re of person) {
    if (re.test(text)) {
      return {
        ok: false,
        kind: "person",
        reason: "Reflexively blocked: comments on the person, not the work (appendix D).",
      };
    }
  }
  for (const re of COMPARISON_PATTERNS) {
    if (re.test(text)) {
      return {
        ok: false,
        kind: "comparison",
        reason: "Reflexively blocked: compares people (appendix D).",
      };
    }
  }
  return { ok: true };
}

export function sanitizeForAppendixD(
  text: string,
  surface: AppendixDSurface = "coaching",
): string {
  const check = enforceAppendixD(text, surface);
  if (check.ok) return text;
  return "I can only comment on your work, not on you.";
}
