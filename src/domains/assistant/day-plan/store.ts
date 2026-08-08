import type { ActorId } from "@/spine/operation/types";

export type DayPhase = "briefing" | "planning" | "planned" | "abandoned";

export interface PlanItem {
  id: string;
  label: string;
  ref?: { nodeType: string; nodeId: string };
  estimateMinutes: number;
  start?: string;
  end?: string;
  done?: boolean;
  doneAt?: string;
  actualMinutes?: number;
  miss?: {
    kind: "interrupted" | "ran-over";
    cause?: string;
    reason?: string;
    asked?: boolean;
    lapsed?: boolean;
    offerNow?: boolean;
  };
  interrupted?: boolean;
}

export interface MeetingItem {
  id: string;
  title: string;
  start: string;
  end: string;
  arrivedDuringDay?: boolean;
}

export interface StreakRecord {
  clean: number;
  bestClean: number;
  finishedWithinTime: number;
  dayPlanned: number;
  lastAssessedDate?: string;
}

export interface DayPlan {
  actor: ActorId;
  date: string;
  phase: DayPhase;
  brief: { changed: string[]; needsYou: string[]; atRisk: string[] };
  briefStep: number;
  plan: PlanItem[];
  meetings: MeetingItem[];
  streak: StreakRecord;
  onLeave?: boolean;
}

export class DayPlanStore {
  private plans = new Map<string, DayPlan>();
  private streaks = new Map<ActorId, StreakRecord>();
  private learning = new Map<string, { estimate: number; actuals: number[] }>();

  key(actor: string, date: string): string {
    return `${actor}:${date}`;
  }

  get(actor: string, date: string): DayPlan | undefined {
    return this.plans.get(this.key(actor, date));
  }

  put(plan: DayPlan): void {
    this.plans.set(this.key(plan.actor, plan.date), plan);
  }

  streakFor(actor: ActorId): StreakRecord {
    let s = this.streaks.get(actor);
    if (!s) {
      s = { clean: 0, bestClean: 0, finishedWithinTime: 0, dayPlanned: 0 };
      this.streaks.set(actor, s);
    }
    return s;
  }

  recordEstimate(key: string, estimate: number, actual: number): void {
    const entry = this.learning.get(key) ?? { estimate, actuals: [] };
    entry.actuals.push(actual);
    this.learning.set(key, entry);
  }

  learnedAdjustment(key: string): number | undefined {
    const entry = this.learning.get(key);
    if (!entry || entry.actuals.length === 0) return undefined;
    const avg = entry.actuals.reduce((a, b) => a + b, 0) / entry.actuals.length;
    return Math.round(avg);
  }
}
