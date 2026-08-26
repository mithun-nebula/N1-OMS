import { describe, it, expect, beforeEach } from "vitest";
import { buildDemoWorld, type DemoWorld } from "@/server/bootstrap";
import { PublishBus, type NotificationPersistence, type StoredNotification } from "@/spine/bus";
import {
  createQuestionLimiter,
  QUESTIONS_PER_DAY,
  type QuestionLimiterPersistence,
} from "@/domains/workplace/shared/limiter";
import { DayPlanService } from "@/domains/assistant/day-plan/service";
import { openDay } from "@/domains/assistant/day-plan/test-support";
import {
  DayPlanStore,
  type DayPlan,
  type DayPlanPersistence,
  type StreakRecord,
} from "@/domains/assistant/day-plan/store";

/**
 * The three things that did not survive a restart.
 *
 * Each test does the same thing: run against one backing store, then build a
 * *fresh* in-memory layer over the same persistence — which is exactly what a
 * restart or a second serverless instance looks like from the inside.
 */

/** Writes are fire-and-forget throughout; let the queued microtasks land. */
const flush = () => new Promise((r) => setTimeout(r, 0));

/**
 * These pin the cap at 2 explicitly.
 *
 * They were written when 2 was the only cap there was, and every assertion in
 * them counts to it. Phase 2 made the allowance a per-actor setting defaulting
 * to six, so leaving them bare would have quietly changed what they test from
 * "a spent allowance survives a restart" to "six is the default" — a different
 * claim, tested elsewhere.
 *
 * Pinning keeps every assertion exactly as it was, and exercises the override
 * as a side effect.
 */
describe("the question allowance is kept across a restart", () => {
  class FakeBudget implements QuestionLimiterPersistence {
    rows = new Map<string, number>();
    async save(actor: string, date: string, used: number) {
      const key = `${actor}:${date}`;
      this.rows.set(key, Math.max(this.rows.get(key) ?? 0, used));
    }
    async loadFor(date: string) {
      return [...this.rows]
        .filter(([key]) => key.endsWith(`:${date}`))
        .map(([key, used]) => ({ actor: key.slice(0, key.lastIndexOf(":")), used }));
    }
  }

  it("two questions asked before the restart are still two questions asked", async () => {
    const budget = new FakeBudget();
    const before = createQuestionLimiter(budget, { defaultCap: 2 });
    expect(before.tryConsume("james", "2026-08-08")).toBe(true);
    expect(before.tryConsume("james", "2026-08-08")).toBe(true);
    expect(before.tryConsume("james", "2026-08-08")).toBe(false);
    await flush();

    const after = createQuestionLimiter(budget, { defaultCap: 2 });
    await after.load("2026-08-08");
    expect(after.remaining("james", "2026-08-08")).toBe(0);
    expect(after.tryConsume("james", "2026-08-08")).toBe(false);
  });

  it("a new day starts with a full allowance", async () => {
    const budget = new FakeBudget();
    const before = createQuestionLimiter(budget, { defaultCap: 2 });
    before.tryConsume("james", "2026-08-08");
    before.tryConsume("james", "2026-08-08");
    await flush();

    const after = createQuestionLimiter(budget, { defaultCap: 2 });
    await after.load("2026-08-09");
    expect(after.remaining("james", "2026-08-09")).toBe(QUESTIONS_PER_DAY);
  });

  it("configuring a durable limiter hydrates it — there is no unhydrated state", async () => {
    const budget = new FakeBudget();
    await budget.save("james", "2026-08-08", 2);

    // Stands in for `configureQuestionLimiter`: the point is that building the
    // durable limiter and hydrating it are one step. They used to be two, and
    // `buildDemoWorld` only ever performed the first.
    const limiter = createQuestionLimiter(budget, { defaultCap: 2 });
    await limiter.load("2026-08-08");

    expect(limiter.remaining("james", "2026-08-08")).toBe(0);
  });

  it("hydrating never hands back an allowance already spent this process", async () => {
    const budget = new FakeBudget();
    await budget.save("james", "2026-08-08", 1);

    const limiter = createQuestionLimiter(budget, { defaultCap: 2 });
    limiter.tryConsume("james", "2026-08-08");
    limiter.tryConsume("james", "2026-08-08");
    await limiter.load("2026-08-08");
    expect(limiter.remaining("james", "2026-08-08")).toBe(0);
  });
});

describe("notifications survive a restart", () => {
  class FakeNotifications implements NotificationPersistence {
    rows: StoredNotification[] = [];
    async append(n: StoredNotification) {
      this.rows.push(JSON.parse(JSON.stringify(n)) as StoredNotification);
    }
    async loadRecent(limit: number) {
      return this.rows.slice(-limit);
    }
    async markRead(ids: string[], at: string) {
      for (const row of this.rows) if (ids.includes(row.id) && !row.readAt) row.readAt = at;
    }
  }

  it("a delivered notification comes back with the same id", async () => {
    const store = new FakeNotifications();
    const before = new PublishBus(store);
    before.publish({ kind: "actor", actor: "james", message: "Priya's leave needs your approval" });
    await flush();
    const original = before.deliveredTo("james")[0];

    const after = new PublishBus(store);
    await after.load();
    const recovered = after.deliveredTo("james");
    expect(recovered).toHaveLength(1);
    expect(recovered[0].id).toBe(original.id);
    expect(recovered[0].payload).toEqual(original.payload);
  });

  it("read state is remembered, so the bell does not light up again", async () => {
    const store = new FakeNotifications();
    const before = new PublishBus(store);
    before.publish({ kind: "actor", actor: "james", message: "One" });
    await flush();
    before.markRead(before.deliveredTo("james").map((n) => n.id));
    await flush();

    const after = new PublishBus(store);
    await after.load();
    expect(after.deliveredTo("james").every((n) => n.readAt)).toBe(true);
  });

  it("ids are stable between two reads, unlike an array index", async () => {
    const bus = new PublishBus();
    bus.publish({ kind: "actor", actor: "james", message: "First" });
    const firstId = bus.deliveredTo("james")[0].id;
    bus.publish({ kind: "actor", actor: "james", message: "Second" });
    expect(bus.deliveredTo("james")[0].id).toBe(firstId);
    expect(bus.deliveredTo("james")[1].id).not.toBe(firstId);
  });

  it("hydrating twice does not duplicate what is already in memory", async () => {
    const store = new FakeNotifications();
    const bus = new PublishBus(store);
    bus.publish({ kind: "actor", actor: "james", message: "Only once" });
    await flush();
    await bus.load();
    await bus.load();
    expect(bus.deliveredTo("james")).toHaveLength(1);
  });
});

describe("past days can be looked back over", () => {
  class FakeDays implements DayPlanPersistence {
    plans = new Map<string, DayPlan>();
    streaks = new Map<string, StreakRecord>();
    estimates = new Map<string, { estimate: number; actuals: number[] }>();
    async savePlan(p: DayPlan) {
      this.plans.set(`${p.actor}:${p.date}`, JSON.parse(JSON.stringify(p)) as DayPlan);
    }
    async loadPlan(actor: string, date: string) {
      return this.plans.get(`${actor}:${date}`);
    }
    async loadRange(actor: string, from: string, to: string) {
      return [...this.plans.values()]
        .filter((p) => p.actor === actor && p.date >= from && p.date <= to)
        .sort((a, b) => a.date.localeCompare(b.date));
    }
    async saveStreak(actor: string, s: StreakRecord) {
      this.streaks.set(actor, JSON.parse(JSON.stringify(s)) as StreakRecord);
    }
    async loadStreak(actor: string) {
      return this.streaks.get(actor);
    }
    async saveEstimate(key: string, estimate: number, actuals: number[]) {
      this.estimates.set(key, { estimate, actuals: [...actuals] });
    }
    async loadEstimate(key: string) {
      return this.estimates.get(key);
    }
  }

  let world: DemoWorld;
  beforeEach(async () => {
    world = await buildDemoWorld();
  });

  it("summarises a range of days after a restart", async () => {
    const persistence = new FakeDays();
    const storeA = new DayPlanStore(persistence);
    const svcA = new DayPlanService(storeA, {
      graph: world.deps.graph,
      limiter: createQuestionLimiter(),
      actorLookup: () => ({ spine: world.spine }),
    });

    for (const [date, minutes] of [
      ["2026-08-06", 60],
      ["2026-08-07", 90],
      ["2026-08-08", 30],
    ] as const) {
      await openDay(svcA, "james", date);
      const item = svcA.selectItem("james", date, { label: `Work ${date}`, estimateMinutes: minutes });
      svcA.commitPlan("james", date);
      if (date !== "2026-08-08") {
        await svcA.tick("james", date, item.item!.id, { actualMinutes: minutes });
      }
    }
    await flush();

    const storeB = new DayPlanStore(persistence); // "after the restart"
    const days = await storeB.history("james", "2026-08-06", "2026-08-08");

    expect(days.map((d) => d.date)).toEqual(["2026-08-06", "2026-08-07", "2026-08-08"]);
    expect(days.map((d) => d.done)).toEqual([1, 1, 0]);
    expect(days.map((d) => d.committedMinutes)).toEqual([60, 90, 30]);
  });

  it("excludes days outside the range", async () => {
    const persistence = new FakeDays();
    const store = new DayPlanStore(persistence);
    const svc = new DayPlanService(store, {
      graph: world.deps.graph,
      limiter: createQuestionLimiter(),
      actorLookup: () => ({ spine: world.spine }),
    });
    await svc.startDay("james", "2026-07-01");
    await svc.startDay("james", "2026-08-08");
    await flush();

    const days = await new DayPlanStore(persistence).history("james", "2026-08-01", "2026-08-31");
    expect(days.map((d) => d.date)).toEqual(["2026-08-08"]);
  });

  it("a day still only in memory is not lost from the history", async () => {
    const store = new DayPlanStore();
    const svc = new DayPlanService(store, {
      graph: world.deps.graph,
      limiter: createQuestionLimiter(),
      actorLookup: () => ({ spine: world.spine }),
    });
    await openDay(svc, "james", "2026-08-08");
    svc.selectItem("james", "2026-08-08", { label: "Review", estimateMinutes: 45 });

    const days = await store.history("james", "2026-08-01", "2026-08-31");
    expect(days).toHaveLength(1);
    expect(days[0].committedMinutes).toBe(45);
  });
});
