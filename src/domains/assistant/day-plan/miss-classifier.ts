import type { PlanItem, MeetingItem } from "./store";
import { at, overlaps } from "./time";

export interface MissClassification {
  kind: "interrupted" | "ran-over";
  cause?: string;
}

/**
 * Appendix A2 — did something else take the time, or did the work take longer?
 *
 * The whole question is whether a meeting sat inside the window that was
 * committed. If one did, the application already knows why and asks nothing.
 */
export function classifyMiss(
  item: PlanItem,
  meetings: MeetingItem[],
): MissClassification {
  const { start, end } = item;
  // An item with no window cannot be judged interrupted — there is nothing for
  // a meeting to overlap. `scheduleWork` gives every outstanding item one, so
  // in practice this is the guard for a hydrated plan from before that existed.
  if (!start || !end) {
    return { kind: "ran-over" };
  }
  const conflicting = meetings.filter((m) => overlaps(start, end, m.start, m.end));
  if (conflicting.length > 0) {
    return { kind: "interrupted", cause: conflicting[0].title };
  }
  return { kind: "ran-over" };
}

/**
 * Appendix A4: the overrun offer "appears only if the overrun actually affects
 * the rest of the day. If nothing later is at risk, it says nothing at all."
 *
 * `asOf` is when the work actually finished, past its planned end. Something is
 * at risk when it was scheduled **after** the overrunning item and its start
 * has already gone by.
 *
 * Both halves matter. The original filtered to `p.start >= asOf` and then
 * required `p.start < item.end`, which an overrun makes unsatisfiable — so this
 * always returned false and the offer never appeared. Replacing that with a
 * bare `p.start < asOf` swung too far the other way: work scheduled *earlier*
 * in the day, which this item never displaced, counted as at risk too, and the
 * "says nothing at all" branch stopped existing.
 */
export function restOfDayAtRisk(
  item: PlanItem,
  remaining: PlanItem[],
  asOf: string,
): boolean {
  return firstAtRisk(item, remaining, asOf) !== undefined;
}

/**
 * *Which* piece of later work this overrun has eaten into — the one A4 names
 * in the offer: "your 12:00 session will not fit."
 *
 * `restOfDayAtRisk` is defined in terms of this so the live warning and the
 * post-hoc question can never disagree about whether anything is at risk. The
 * boolean came first; the live strip needed the item itself, and answering that
 * with a second copy of the predicate is how the two drift apart.
 */
export function firstAtRisk(
  item: PlanItem,
  remaining: PlanItem[],
  asOf: string,
): PlanItem | undefined {
  const finishedAt = at(asOf);
  const itemStart = at(item.start);
  if (!Number.isFinite(finishedAt)) return undefined;
  return remaining.find((p) => {
    if (p.done || p.id === item.id) return false;
    const start = at(p.start);
    if (!Number.isFinite(start)) return false;
    // Scheduled after this item, and its slot has already passed.
    const isLater = !Number.isFinite(itemStart) || start >= itemStart;
    return isLater && start < finishedAt;
  });
}
