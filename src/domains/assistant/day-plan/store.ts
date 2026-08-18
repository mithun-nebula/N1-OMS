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

/**
 * Durable backing for the day plan.
 *
 * Writes are fire-and-forget so the store's reads can stay **synchronous** —
 * `DayPlanService` is built on sync reads throughout, and making them async
 * would mean `await` in ~30 places across the 13 tests that already pass.
 *
 * The trade: read-your-own-writes holds within one process only. Running more
 * than one instance would need the store async-ified properly.
 */
export interface DayPlanPersistence {
  savePlan(plan: DayPlan): Promise<void>;
  loadPlan(actor: string, date: string): Promise<DayPlan | undefined>;
  saveStreak(actor: ActorId, streak: StreakRecord): Promise<void>;
  loadStreak(actor: ActorId): Promise<StreakRecord | undefined>;
  saveEstimate(key: string, estimate: number, actuals: number[]): Promise<void>;
  loadEstimate(key: string): Promise<{ estimate: number; actuals: number[] } | undefined>;
  /** Bulk-hydrate the estimate learning table on first load after a restart. */
  loadAllEstimates?(): Promise<Array<{ key: string; estimate: number; actuals: number[] }>>;
}

export class DayPlanStore {
  private plans = new Map<string, DayPlan>();
  private streaks = new Map<ActorId, StreakRecord>();
  private learning = new Map<string, { estimate: number; actuals: number[] }>();
  private hydrated = new Set<string>();
  private estimatesHydrated = false;

  /** Without persistence the store is memory-only, as the tests use it. */
  constructor(private readonly persistence?: DayPlanPersistence) {}

  key(actor: string, date: string): string {
    return `${actor}:${date}`;
  }

  get(actor: string, date: string): DayPlan | undefined {
    return this.plans.get(this.key(actor, date));
  }

  put(plan: DayPlan): void {
    this.plans.set(this.key(plan.actor, plan.date), plan);
    void this.persistence?.savePlan(plan).catch(() => {});
    void this.persistence?.saveStreak(plan.actor, plan.streak).catch(() => {});
  }

  /**
   * Pull a day (and its streak) back into memory. Awaited by the API route
   * before anything reads the plan, so a restart does not lose someone's day.
   */
  async load(actor: string, date: string): Promise<void> {
    if (!this.persistence) return;
    // Once hydrated, memory is the source of truth — a second load must not
    // clobber in-memory state with a stale fire-and-forget snapshot.
    const key = this.key(actor, date);
    if (this.hydrated.has(key)) return;
    this.hydrated.add(key);
    const [plan, streak] = await Promise.all([
      this.persistence.loadPlan(actor, date),
      this.persistence.loadStreak(actor),
    ]);
    if (streak) this.streaks.set(actor, streak);
    if (plan) {
      // A streak loaded from its own row is more current than the copy
      // embedded in the plan snapshot. Keep them the same object so later
      // streak mutations flow into the plan snapshot on save, as in startDay.
      const s = this.streaks.get(actor) ?? plan.streak;
      this.streaks.set(actor, s);
      this.plans.set(key, { ...plan, streak: s });
    }
    if (!this.estimatesHydrated && this.persistence.loadAllEstimates) {
      this.estimatesHydrated = true;
      for (const e of await this.persistence.loadAllEstimates()) {
        if (!this.learning.has(e.key)) {
          this.learning.set(e.key, { estimate: e.estimate, actuals: e.actuals });
        }
      }
    }
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
    void this.persistence?.saveEstimate(key, entry.estimate, entry.actuals).catch(() => {});
  }

  learnedAdjustment(key: string): number | undefined {
    const entry = this.learning.get(key);
    if (!entry || entry.actuals.length === 0) return undefined;
    const avg = entry.actuals.reduce((a, b) => a + b, 0) / entry.actuals.length;
    return Math.round(avg);
  }
}
