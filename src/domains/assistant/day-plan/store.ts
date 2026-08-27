import type { ActorId } from "@/spine/operation/types";

export type DayPhase = "briefing" | "planning" | "planned" | "abandoned";

export interface PlanItem {
  id: string;
  label: string;
  ref?: { nodeType: string; nodeId: string };
  estimateMinutes: number;
  start?: string;
  end?: string;
  /**
   * True when the service placed this item in the day itself, rather than the
   * caller supplying a window. Only auto-placed, unfinished work is moved when
   * the day is re-laid-out — an explicitly scheduled item is an anchor.
   */
  autoScheduled?: boolean;
  done?: boolean;
  doneAt?: string;
  actualMinutes?: number;
  /**
   * Appendix A9 — "half done: progress recorded, remainder carried forward.
   * Only the shortfall counts against the day."
   *
   * Minutes actually spent on an item that is **not** finished. Accumulates
   * across several sittings. `actualMinutes` is the different fact: what a
   * *completed* item took, which is what estimate learning reads.
   */
  progressMinutes?: number;
  miss?: {
    kind: "interrupted" | "ran-over";
    cause?: string;
    reason?: string;
    asked?: boolean;
    lapsed?: boolean;
    offerNow?: boolean;
  };
  interrupted?: boolean;
  /**
   * Appendix A9 — "item dropped mid-day: allowed. Asked once why, does not
   * break the streak."
   *
   * The item is **marked**, never removed. A day that quietly loses the work
   * somebody decided against is not an honest record of the day, and the
   * carried-forward brief would have nothing to explain its absence.
   */
  dropped?: { at: string; reason?: string };
  /**
   * Answered "carried over" at close-out: the person means to do it, just not
   * today. Unlike `dropped` this is **not** excused from the day — see
   * `carryOverItem` for why leaving it accountable is what keeps the streak
   * from being gameable.
   */
  carriedOver?: { at: string };
  /**
   * The check made shortly BEFORE this item's window ends — "still on track?"
   *
   * ⚠ Not a miss and not an interrogation. A miss is judged after the fact and
   * can break the streak; this is asked while the work is still in flight, so a
   * person can say "I need longer" *before* the day is wrong rather than
   * explaining afterwards why it was. It therefore:
   *   - never touches the streak (`streak.ts` does not read it),
   *   - is exempt from the daily question budget — it is an offer about work in
   *     flight, which appendix A4 explicitly separates from the question about
   *     what went wrong,
   *   - is asked once per item; `at` is what stops it being asked again.
   */
  check?: {
    status: "on-time" | "more-time" | "blocked";
    at: string;
    note?: string;
  };
}

export interface MeetingItem {
  id: string;
  title: string;
  start: string;
  end: string;
  arrivedDuringDay?: boolean;
  /**
   * The join link, for an online or `both` meeting.
   *
   * E7 names three places the link must be visible, and *"each person's day"*
   * is one of them. This field did not exist, so the day plan dropped it and
   * the only way to join a meeting from your own day was to go and find it on
   * another screen. Undefined for an in-person meeting — never an empty string,
   * which would render as a dead link.
   */
  link?: string;
}

export interface StreakRecord {
  /** Consecutive clean days. Personal only — never shown to a manager (A7). */
  clean: number;
  /** The best run so far, so a broken streak is not the whole story. */
  bestClean: number;
  /** How many days this person has planned at all. */
  dayPlanned: number;
  lastAssessedDate?: string;
}
/*
 * `finishedWithinTime` used to sit here too. It was incremented in lockstep
 * with `clean` — the same number under a second name — and never read by
 * anything. Rows written before this still carry the key; extra JSON keys are
 * ignored on the way back in.
 */

export interface DayPlan {
  actor: ActorId;
  date: string;
  phase: DayPhase;
  brief: { changed: string[]; needsYou: string[]; atRisk: string[] };
  briefStep: number;
  plan: PlanItem[];
  meetings: MeetingItem[];
  streak: StreakRecord;
  /**
   * When this person's day actually began — their clock-in.
   *
   * Work is laid out from here rather than from a fixed 09:00 opening: someone
   * who clocks in at ten has an eight-hour day starting at ten, and showing
   * their first task at nine would put it in a past they were not working in,
   * making every window — and so every interrupted-versus-ran-over verdict —
   * wrong by the difference.
   *
   * Absent on a plan made before clocking in, and on plans hydrated from before
   * this existed; `scheduleWork` falls back to the 09:00 opening for both.
   */
  startedAt?: string;
  /**
   * When the day was committed — the line that makes "new work" meaningful.
   *
   * Work assigned before this was on the board while they were choosing, and
   * they chose not to take it; work assigned after arrived once the day was
   * already settled, which is the only case worth raising. Without the line,
   * offering "shall I add this?" would mean nagging about everything they had
   * already passed over that morning.
   */
  committedAt?: string;
  /**
   * Work offered mid-day and turned down. Asked once, per A4's "if you ignore
   * it, it lapses quietly. No reminder, no second ask."
   */
  declinedWork?: string[];
  onLeave?: boolean;
  /**
   * Brief items the person said they would handle. Offered first in the
   * picker, so answering the brief actually feeds the plan (appendix A1).
   */
  suggested?: string[];
  /** Brief items pushed to "Later" — they reappear in tomorrow's brief. */
  deferred?: string[];
  /**
   * What close-out offered up for **tomorrow**. Read by `startDay` into the
   * next day's `suggested`, the same way `deferred` feeds the next brief.
   *
   * Seeds, not commitments: A1 keeps planning in the morning, once a day, with
   * mandatory time estimates. Clock-out seeds; morning commits.
   */
  seeded?: string[];
  /**
   * The close-out conversation. `finishedAt` is what gates folding the day into
   * the streak — `finalizeDay` is idempotent, so assessing before the answers
   * arrive would silently discard every one of them.
   */
  closeOut?: { startedAt: string; finishedAt?: string };
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
  /**
   * Days in a range, oldest first. The store could only ever be asked for a
   * single (actor, date), so there was no way to look back over a week — no
   * streak timeline, no "how did last month go".
   */
  loadRange?(actor: string, from: string, to: string): Promise<DayPlan[]>;
}

/** One past day, reduced to what a history view actually needs. */
export interface DaySummary {
  date: string;
  committed: number;
  done: number;
  committedMinutes: number;
  ranOver: number;
  interrupted: number;
  dropped: number;
  /** Minutes committed to and not delivered — A9's "shortfall". */
  shortfallMinutes: number;
  onLeave: boolean;
  phase: DayPhase;
}

/**
 * What is still owed on an item, in minutes.
 *
 * Zero once it is done or dropped. For an untouched item it is the whole
 * estimate — which is what makes "only the shortfall counts" reduce to the old
 * whole-item behaviour when nobody has recorded any progress.
 */
export function shortfallOf(item: PlanItem): number {
  if (item.done || isDropped(item)) return 0;
  const estimate = Number(item.estimateMinutes);
  const planned = Number.isFinite(estimate) && estimate > 0 ? estimate : 0;
  const doneSoFar = Number(item.progressMinutes);
  return Math.max(0, planned - (Number.isFinite(doneSoFar) ? doneSoFar : 0));
}

/** Dropped work is off the day: it is neither owed nor held against anyone. */
export function isDropped(item: PlanItem): boolean {
  return item.dropped !== undefined;
}

export function summariseDay(plan: DayPlan): DaySummary {
  return {
    date: plan.date,
    committed: plan.plan.length,
    done: plan.plan.filter((p) => p.done).length,
    committedMinutes: plan.plan.reduce((sum, p) => sum + p.estimateMinutes, 0),
    ranOver: plan.plan.filter((p) => p.miss?.kind === "ran-over").length,
    interrupted: plan.plan.filter((p) => p.miss?.kind === "interrupted" || p.interrupted).length,
    dropped: plan.plan.filter(isDropped).length,
    shortfallMinutes: plan.plan.reduce((sum, p) => sum + shortfallOf(p), 0),
    onLeave: Boolean(plan.onLeave),
    phase: plan.phase,
  };
}

export class DayPlanStore {
  private plans = new Map<string, DayPlan>();
  private streaks = new Map<ActorId, StreakRecord>();
  private learning = new Map<string, { estimate: number; actuals: number[] }>();
  private hydrated = new Set<string>();
  private estimatesHydrated = false;

  /**
   * Without persistence the store is memory-only, as the tests use it.
   * `onChange` fires after every put — the composition root wires it to the
   * live-update hub so screens hear about day changes from ANY start (form,
   * chat tool, voice tool); the domain stays dependency-free.
   */
  constructor(
    private readonly persistence?: DayPlanPersistence,
    private readonly onChange?: () => void,
  ) {}

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
    try {
      this.onChange?.();
    } catch {
      /* a broken listener must never fail a write */
    }
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

  /**
   * Past days, oldest first. Falls back to whatever is in memory when there is
   * no persistence — which is what the tests run against.
   */
  async history(actor: string, from: string, to: string): Promise<DaySummary[]> {
    const persisted = this.persistence?.loadRange
      ? await this.persistence.loadRange(actor, from, to)
      : [];
    const byDate = new Map(persisted.map((p) => [p.date, p]));
    // Memory is newer than any snapshot, so it wins on a date held by both.
    for (const plan of this.plans.values()) {
      if (plan.actor !== actor) continue;
      if (plan.date < from || plan.date > to) continue;
      byDate.set(plan.date, plan);
    }
    return [...byDate.values()]
      .sort((a, b) => a.date.localeCompare(b.date))
      .map(summariseDay);
  }

  streakFor(actor: ActorId): StreakRecord {
    let s = this.streaks.get(actor);
    if (!s) {
      s = { clean: 0, bestClean: 0, dayPlanned: 0 };
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

  /**
   * Learned estimates for a specific set of records (appendix A5).
   *
   * Callers pass only the keys the actor may already see — the learning table
   * is keyed by record, not by person, so handing back the whole map would
   * disclose which records exist.
   */
  learnedFor(keys: string[]): Record<string, number> {
    const out: Record<string, number> = {};
    for (const key of keys) {
      const learned = this.learnedAdjustment(key);
      if (learned !== undefined) out[key] = learned;
    }
    return out;
  }
}
