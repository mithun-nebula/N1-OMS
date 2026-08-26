import type { DayPlan, PlanItem, MeetingItem } from "./store";
import { isDropped } from "./store";
import { at, overlaps } from "./time";

/**
 * When the assistant is allowed to interrupt somebody, and what with.
 *
 * ── The rule, in plain words ────────────────────────────────────────────────
 *
 * **A question earns its place only when the answer changes something.**
 *
 * Not "is this interesting", not "would this be useful to know" — *what will be
 * different once they answer?* Three things qualify today:
 *
 *  - an **estimate** the system will learn from,
 *  - a **commitment** it will follow up,
 *  - a **plan** it will re-order.
 *
 * Everything else is *"how's it going?"*, and the honest answer to that is that
 * the application already knows.
 *
 * Held to that bar this lands near three to five questions a day on its own and
 * the cap never fires. Held to no bar, two bad questions a day is still
 * annoying — which is why the bar matters more than the number.
 *
 * ── Four gates, in order ────────────────────────────────────────────────────
 *
 *  1. Is there anything worth asking? (the bar, above)
 *  2. Is this a good moment? Mid-meeting is not.
 *  3. Has this person's allowance run out?
 *  4. Has this exact question already been asked today?
 *
 * ── Drop, do not queue ──────────────────────────────────────────────────────
 *
 * A question that was not worth asking at eleven is worth **less** at four, not
 * more. Queueing produces a batch of stale questions at the end of the day,
 * which is the worst possible time to receive them. So this returns at most one
 * candidate for right now, and forgets the rest.
 *
 * ── Where it runs ───────────────────────────────────────────────────────────
 *
 * Phase 0.5 already built the timer — a 60-second `setInterval` on the
 * dashboard with `restOfDayAtRisk` and a `seenKey` so the same warning fires
 * once. **This is the judgement that timer calls.** There is no second
 * scheduler, and this function does no I/O so it can run on either side.
 */

export type AskKind = "miss-reason" | "estimate-offer" | "commitment-chase";

export interface AskCandidate {
  /** Stable within a day, so `seenKey` can suppress a repeat. */
  id: string;
  kind: AskKind;
  /** The question, as a person would hear it. */
  question: string;
  /**
   * What is different once they answer.
   *
   * Required, and not decoration: a candidate that cannot fill this in does not
   * pass the bar and should not exist.
   */
  changes: string;
  /** The plan item it is about, where there is one. */
  itemId?: string;
}

export interface SchedulerInput {
  plan: DayPlan;
  /** Now, as an ISO instant. Passed in — never read from the clock here. */
  now: string;
  /** From the limiter. Zero means say nothing. */
  allowanceLeft: number;
  /** Candidate ids already put to this person today. */
  alreadyAsked: ReadonlySet<string>;
  /** Learned minutes per record key, where the system has an opinion. */
  learned?: Record<string, number>;
  /** Commitments due today and not yet discharged. */
  commitmentsDue?: Array<{ id: string; what: string; dueDate: string }>;
}

export interface SchedulerDecision {
  ask: AskCandidate | null;
  /** Why nothing is being asked. For the log, and for the learning log. */
  reason:
    | "asked"
    | "nothing-worth-asking"
    | "bad-moment"
    | "no-allowance"
    | "already-asked-today";
}

/** Mid-meeting is not a good moment. Nor is any other booked block. */
function inAMeeting(meetings: readonly MeetingItem[], now: string): boolean {
  return meetings.some((m) => overlaps(m.start, m.end, now, now));
}

function keyOf(item: PlanItem): string | undefined {
  return item.ref ? `${item.ref.nodeType}:${item.ref.nodeId}` : undefined;
}

/**
 * At most one question, for right now.
 *
 * Ordered by how much the answer changes, most first: a miss reason teaches the
 * estimate table *and* records why; an estimate offer changes one future
 * number; a commitment chase changes today's plan.
 */
export function whatToAsk(input: SchedulerInput): SchedulerDecision {
  const { plan, now, allowanceLeft, alreadyAsked } = input;

  // Gate 3 first, because it is the cheapest and the most absolute.
  if (allowanceLeft <= 0) return { ask: null, reason: "no-allowance" };

  // Gate 2. A4 is explicit that interrupting to help is the point and
  // interrupting to interrogate is not; mid-meeting is neither.
  if (inAMeeting(plan.meetings, now)) return { ask: null, reason: "bad-moment" };

  const candidates: AskCandidate[] = [];

  // ── 1. A ran-over item with no reason recorded ────────────────────────────
  //
  // The answer changes two things: the recorded reason, and — through
  // `recordMissReason` — what gets suggested next time. A4 also says an
  // ignored question lapses quietly, and `lapsed` is how that is remembered.
  for (const item of plan.plan) {
    if (isDropped(item)) continue;
    if (item.miss?.kind !== "ran-over") continue;
    if (item.miss.asked || item.miss.lapsed) continue;
    candidates.push({
      id: `miss:${item.id}`,
      kind: "miss-reason",
      itemId: item.id,
      question: `${item.label} took longer than planned. What got in the way?`,
      changes: "records why, and improves what is suggested for this work next time",
    });
  }

  // ── 2. An estimate the system now disagrees with ──────────────────────────
  //
  // Only offered where there is a learned figure AND it differs enough to be
  // worth a person's attention. A5: the minutes are already recorded either
  // way, so this question is purely about whether the number is *offered* or
  // imposed — and it is offered.
  for (const item of plan.plan) {
    if (isDropped(item) || !item.done) continue;
    const key = keyOf(item);
    if (!key) continue;
    const learned = input.learned?.[key];
    if (typeof learned !== "number" || item.estimateMinutes <= 0) continue;
    // A quarter out, and at least fifteen minutes. Below that, correcting the
    // number costs more attention than it saves.
    const drift = Math.abs(learned - item.estimateMinutes);
    if (drift < 15 || drift / item.estimateMinutes < 0.25) continue;
    candidates.push({
      id: `estimate:${key}`,
      kind: "estimate-offer",
      itemId: item.id,
      question: `${item.label} has been taking about ${learned} minutes. Plan for that next time?`,
      changes: "changes the time this work is planned for from now on",
    });
  }

  // ── 3. A commitment due today, not yet discharged ─────────────────────────
  //
  // Explicit only — something the person actually asked to be reminded of.
  // Inferring a promise from "I should probably look at that" is a later
  // decision, and chasing somebody about a thing they never committed to is
  // worse than not remembering at all.
  for (const c of input.commitmentsDue ?? []) {
    candidates.push({
      id: `commitment:${c.id}`,
      kind: "commitment-chase",
      question: `You asked to be reminded: ${c.what}. Still today?`,
      changes: "settles a commitment, or moves it",
    });
  }

  if (candidates.length === 0) return { ask: null, reason: "nothing-worth-asking" };

  // Gate 4. Dropped, not queued — a repeat is worth less than silence.
  const unasked = candidates.filter((c) => !alreadyAsked.has(c.id));
  if (unasked.length === 0) return { ask: null, reason: "already-asked-today" };

  // ── Rotate between kinds before repeating one ─────────────────────────────
  //
  // The list above is built most-valuable-kind first, and taking `[0]` of it
  // was wrong on exactly the day it mattered most. A bad day generates a
  // miss-reason candidate *per* ran-over item, so five of them would spend the
  // whole allowance on "what got in the way?" and never reach the commitment
  // the person explicitly asked to be reminded of. The system's own questions
  // were crowding out the one the user requested.
  //
  // So: prefer a kind that has not been asked yet today. The first question of
  // the day is unchanged — the ordering above still decides it — but the
  // second is drawn from a different kind where one exists.
  const kindsAsked = new Set(
    candidates.filter((c) => alreadyAsked.has(c.id)).map((c) => c.kind),
  );
  const fresh = unasked.find((c) => !kindsAsked.has(c.kind)) ?? unasked[0];

  return { ask: fresh, reason: "asked" };
}

/**
 * Everything the pass would ask about right now, in order.
 *
 * Exposed for tests and for the learning log — how many candidates the bar
 * produces on a real day is the number that says whether the bar is set right,
 * and it cannot be measured if only the winner is visible.
 */
export function allCandidates(input: SchedulerInput): AskCandidate[] {
  const relaxed = whatToAsk({ ...input, allowanceLeft: Number.MAX_SAFE_INTEGER, alreadyAsked: new Set() });
  if (!relaxed.ask) return [];
  // Re-run the gathering by asking with each previous winner suppressed.
  const seen = new Set<string>();
  const out: AskCandidate[] = [];
  for (let i = 0; i < 20; i += 1) {
    const next = whatToAsk({
      ...input,
      allowanceLeft: Number.MAX_SAFE_INTEGER,
      alreadyAsked: seen,
    });
    if (!next.ask) break;
    out.push(next.ask);
    seen.add(next.ask.id);
  }
  return out;
}

/** True when this instant sits inside any of the day's meetings. */
export function isBadMoment(plan: DayPlan, now: string): boolean {
  return inAMeeting(plan.meetings, now);
}

/** Exposed so a caller can build the same `seenKey` the dashboard already uses. */
export function seenKeyFor(actor: string, date: string): string {
  return `orga.asked.${actor}.${date}`;
}

/** Guard against a malformed instant reaching the comparisons above. */
export function isUsableInstant(now: string): boolean {
  return Number.isFinite(at(now));
}
