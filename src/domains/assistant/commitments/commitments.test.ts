import { describe, it, expect, beforeEach } from "vitest";
import { buildDemoWorld, type DemoWorld } from "@/server/bootstrap";
import { createQuestionLimiter } from "@/domains/workplace/shared/limiter";
import { DayPlanService } from "@/domains/assistant/day-plan/service";
import { DayPlanStore } from "@/domains/assistant/day-plan/store";
import { openDay } from "@/domains/assistant/day-plan/test-support";
import { gatherBrief, plainBrief } from "@/domains/assistant/day-plan/chat-brief";
import { CommitmentStore, type Commitment, type CommitmentPersistence } from "./store";

/**
 * Explicit commitments, and the chase.
 *
 * Explicit only, by decision. *"Remind me to do the Priya review Thursday"* is
 * recorded; *"I'll get that done Thursday"* is not. Chasing somebody about a
 * thing they never promised is worse than not remembering at all, and the
 * table and the follow-up are the same either way — so inference is a detector
 * added later, not a rewrite of any of this.
 */

/** Stands in for Postgres. Survives being handed to a second store. */
class FakeCommitments implements CommitmentPersistence {
  rows = new Map<string, Commitment>();
  async save(c: Commitment) {
    this.rows.set(c.id, { ...c });
  }
  async loadFor(actor: string) {
    return [...this.rows.values()].filter((c) => c.actor === actor).map((c) => ({ ...c }));
  }
}

let world: DemoWorld;

beforeEach(async () => {
  world = await buildDemoWorld();
});

describe("recording and chasing", () => {
  it("records what was asked for, with a resolved date", async () => {
    const store = await CommitmentStore.create();
    const c = await store.record({
      actor: "james",
      what: "the Priya review",
      // Resolved before it gets here — never a relative phrase, for the same
      // reason no tool lets the model do date arithmetic.
      dueDate: "2026-08-13",
      conversationId: "conv-1",
    });
    expect(c.what).toBe("the Priya review");
    expect(c.dueDate).toBe("2026-08-13");
    expect(c.conversationId).toBe("conv-1");
    expect(c.dischargedAt).toBeUndefined();
  });

  it("chases what is due today, and anything that has slipped", async () => {
    const store = await CommitmentStore.create();
    await store.record({ actor: "james", what: "due today", dueDate: "2026-08-13" });
    await store.record({ actor: "james", what: "slipped", dueDate: "2026-08-10" });
    await store.record({ actor: "james", what: "next week", dueDate: "2026-08-20" });

    const due = await store.dueBy("james", "2026-08-13");
    // Overdue first — a promise that slipped is the one worth mentioning.
    expect(due.map((c) => c.what)).toEqual(["slipped", "due today"]);
  });

  it("stops chasing once it is discharged", async () => {
    const store = await CommitmentStore.create();
    const c = await store.record({ actor: "james", what: "the review", dueDate: "2026-08-13" });
    expect(await store.dueBy("james", "2026-08-13")).toHaveLength(1);
    await store.discharge("james", c.id, "done");
    expect(await store.dueBy("james", "2026-08-13")).toHaveLength(0);
  });

  it("moving it is not discharging it", async () => {
    // The common answer to a chase is "not today", not "done".
    const store = await CommitmentStore.create();
    const c = await store.record({ actor: "james", what: "the review", dueDate: "2026-08-13" });
    await store.reschedule("james", c.id, "2026-08-20");
    expect(await store.dueBy("james", "2026-08-13")).toHaveLength(0);
    expect(await store.dueBy("james", "2026-08-20")).toHaveLength(1);
  });

  it("one person's commitment is not another's", async () => {
    const store = await CommitmentStore.create();
    const c = await store.record({ actor: "james", what: "his", dueDate: "2026-08-13" });
    expect(await store.dueBy("priya", "2026-08-13")).toHaveLength(0);
    // And somebody else's id discharges nothing.
    expect(await store.discharge("priya", c.id, "done")).toBeUndefined();
    expect(await store.dueBy("james", "2026-08-13")).toHaveLength(1);
  });
});

describe("it survives a restart, and building it hydrates it", () => {
  it("a commitment comes back after the process is gone", async () => {
    const disk = new FakeCommitments();
    const before = await CommitmentStore.create(disk, ["james"]);
    const c = await before.record({ actor: "james", what: "the review", dueDate: "2026-08-13" });
    await before.flush(c.id);

    const after = await CommitmentStore.create(disk, ["james"]);
    const due = await after.dueBy("james", "2026-08-13");
    expect(due.map((x) => x.what)).toEqual(["the review"]);
  });

  it("a discharge survives too", async () => {
    const disk = new FakeCommitments();
    const before = await CommitmentStore.create(disk, ["james"]);
    const c = await before.record({ actor: "james", what: "the review", dueDate: "2026-08-13" });
    await before.discharge("james", c.id, "done");
    await before.flush(c.id);

    const after = await CommitmentStore.create(disk, ["james"]);
    expect(await after.dueBy("james", "2026-08-13")).toHaveLength(0);
  });

  it("there is no way to get a durable-but-unhydrated store", async () => {
    // The pattern `durability.test.ts` enforces, and the reason it exists:
    // building and hydrating used to be two steps and only the first was ever
    // performed. `create` is async so the second cannot be skipped.
    const disk = new FakeCommitments();
    await disk.save({
      id: "pre-existing",
      actor: "james",
      what: "written before this process started",
      dueDate: "2026-08-13",
      createdAt: "2026-08-01T00:00:00Z",
    });
    const store = await CommitmentStore.create(disk, ["james"]);
    // Not "load it first" — it is already there.
    expect((await store.dueBy("james", "2026-08-13")).map((c) => c.what)).toEqual([
      "written before this process started",
    ]);
  });

  it("somebody not hydrated at boot is pulled back on first read", async () => {
    const disk = new FakeCommitments();
    await disk.save({
      id: "p1",
      actor: "priya",
      what: "hers",
      dueDate: "2026-08-13",
      createdAt: "2026-08-01T00:00:00Z",
    });
    // Only james was named at boot.
    const store = await CommitmentStore.create(disk, ["james"]);
    expect((await store.dueBy("priya", "2026-08-13")).map((c) => c.what)).toEqual(["hers"]);
  });
});

describe("it appears in the next morning's brief", () => {
  it("a commitment due today is in the brief", async () => {
    const planStore = new DayPlanStore();
    const service = new DayPlanService(planStore, {
      graph: world.deps.graph,
      limiter: createQuestionLimiter(),
      actorLookup: () => ({ spine: world.spine }),
    });
    await openDay(service, "james", "2026-08-13");

    const commitments = await CommitmentStore.create();
    await commitments.record({ actor: "james", what: "the Priya review", dueDate: "2026-08-13" });
    const due = await commitments.dueBy("james", "2026-08-13");

    const ctx = await gatherBrief(service, "james", "2026-08-13", {
      commitments: due.map((c) => ({ id: c.id, what: c.what, dueDate: c.dueDate })),
    });
    expect(ctx.commitments.map((c) => c.what)).toEqual(["the Priya review"]);

    const text = plainBrief(ctx);
    // Quoted back as something they asked for, so it cannot read as the
    // assistant having decided this for them.
    expect(text).toContain("You asked to be reminded: the Priya review.");
  });

  it("says so when one has slipped", async () => {
    const planStore = new DayPlanStore();
    const service = new DayPlanService(planStore, {
      graph: world.deps.graph,
      limiter: createQuestionLimiter(),
      actorLookup: () => ({ spine: world.spine }),
    });
    await openDay(service, "james", "2026-08-13");

    const ctx = await gatherBrief(service, "james", "2026-08-13", {
      commitments: [{ id: "c1", what: "the Priya review", dueDate: "2026-08-10" }],
    });
    expect(ctx.commitments[0].overdue).toBe(true);
    expect(plainBrief(ctx)).toContain("that was due 2026-08-10");
  });

  it("the brief ends by asking what they are taking on", async () => {
    const planStore = new DayPlanStore();
    const service = new DayPlanService(planStore, {
      graph: world.deps.graph,
      limiter: createQuestionLimiter(),
      actorLookup: () => ({ spine: world.spine }),
    });
    await openDay(service, "james", "2026-08-13");
    const ctx = await gatherBrief(service, "james", "2026-08-13");
    expect(plainBrief(ctx).trimEnd().endsWith("What are you taking on today?")).toBe(true);
  });
});
