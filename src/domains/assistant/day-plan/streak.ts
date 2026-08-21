import type { DayPlan, StreakRecord } from "./store";

export interface DayOutcome {
  cleanDay: boolean;
  ranOver: boolean;
  allDone: boolean;
}

/** Work the person was not held responsible for — the time was taken from them. */
function wasInterrupted(item: DayPlan["plan"][number]): boolean {
  return item.miss?.kind === "interrupted" || item.interrupted === true;
}

/**
 * Appendix A7, read literally:
 *
 *   "A day counts as clean when every committed item was finished within its
 *    time. Interrupted misses do not break it. Ran-over misses do."
 *
 * The subtlety is what "every committed item" means once something was
 * interrupted. A2 settles it — an interrupted item's streak effect is
 * *unaffected*, so it is excluded from the judgement rather than counted as a
 * failure. Otherwise one meeting booked over your morning would cost you the
 * day, which is precisely the "supervisor, not a colleague" behaviour the
 * appendix keeps warning against.
 *
 * So the assessment runs over the items the person was actually accountable
 * for. `someDone` then stops a day that was entirely consumed by meetings from
 * *building* a streak it did nothing to earn — that day is neither clean nor
 * ran-over, and `applyDayToStreak` leaves the count untouched.
 *
 * This previously read `(allDone || interruptedOnly || allDone) && !ranOver &&
 * allDone`, which reduces algebraically to `allDone && !ranOver` — the
 * `interruptedOnly` term was computed and then cancelled out, so interrupted
 * work stalled the streak instead of being excused.
 */
export function assessDay(plan: DayPlan): DayOutcome {
  if (plan.plan.length === 0) {
    return { cleanDay: false, ranOver: false, allDone: true };
  }
  const allDone = plan.plan.every((p) => p.done);
  const ranOver = plan.plan.some((p) => p.miss?.kind === "ran-over");
  const accountable = plan.plan.filter((p) => !wasInterrupted(p));
  const someDone = plan.plan.some((p) => p.done);
  const cleanDay = !ranOver && someDone && accountable.every((p) => p.done);
  return { cleanDay, ranOver, allDone };
}

/**
 * Fold a finished day into the streak. **Idempotent** — a day is only ever
 * assessed once.
 *
 * `lastAssessedDate` was written on every path here and read by none of them,
 * which is exactly the guard it exists to be: without it, posting `closeOut`
 * ten times added ten clean days to a streak the appendix describes as
 * personal and honest. A day already folded in is left alone.
 */
export function applyDayToStreak(plan: DayPlan, streak: StreakRecord): StreakRecord {
  if (streak.lastAssessedDate === plan.date) return streak;
  if (plan.onLeave) {
    streak.lastAssessedDate = plan.date;
    return streak;
  }
  if (plan.plan.length === 0) {
    streak.lastAssessedDate = plan.date;
    return streak;
  }
  const outcome = assessDay(plan);
  if (outcome.cleanDay && !outcome.ranOver) {
    streak.clean += 1;
    streak.bestClean = Math.max(streak.bestClean, streak.clean);
  } else if (outcome.ranOver) {
    streak.clean = 0;
  }
  streak.lastAssessedDate = plan.date;
  return streak;
}
