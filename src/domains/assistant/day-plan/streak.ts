import type { DayPlan, StreakRecord } from "./store";

export interface DayOutcome {
  cleanDay: boolean;
  ranOver: boolean;
  allDone: boolean;
}

export function assessDay(plan: DayPlan): DayOutcome {
  if (plan.plan.length === 0) {
    return { cleanDay: false, ranOver: false, allDone: true };
  }
  const allDone = plan.plan.every((p) => p.done);
  const ranOver = plan.plan.some((p) => p.miss?.kind === "ran-over");
  const interruptedOnly =
    plan.plan.some((p) => p.miss?.kind === "interrupted") && !ranOver;
  const cleanDay = (allDone || interruptedOnly || allDone) && !ranOver && allDone;
  return { cleanDay, ranOver, allDone };
}

export function applyDayToStreak(plan: DayPlan, streak: StreakRecord): StreakRecord {
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
    streak.finishedWithinTime += 1;
  } else if (outcome.ranOver) {
    streak.clean = 0;
  }
  streak.lastAssessedDate = plan.date;
  return streak;
}
