import { describe, it, expect, beforeEach } from "vitest";
import { buildDemoWorld, type DemoWorld } from "@/server/bootstrap";
import { createQuestionLimiter } from "@/domains/workplace/shared/limiter";
import { DayPlanService } from "./service";
import { DayPlanStore, type DayPlan } from "./store";
import { openDay } from "./test-support";
import { whatToAsk, allCandidates, isBadMoment } from "./scheduler";

/**
 * When the assistant is allowed to interrupt.
 *
 * The plan calls this the hardest piece in the phase and the only one with no
 * offline test. That is true of the *judgement* — whether these are the right
 * three things to ask about can only be learned from people using it. The
 * *gates* are ordinary code and are tested here.
 */

const TODAY = "2026-08-08";
const NONE = new Set<string>();

let world: DemoWorld;
let store: DayPlanStore;
let service: DayPlanService;

beforeEach(async () => {
  world = await buildDemoWorld();
  store = new DayPlanStore();
  service = new DayPlanService(store, {
    graph: world.deps.graph,
    limiter: createQuestionLimiter(),
    actorLookup: () => ({ spine: world.spine }),
  });
  await openDay(service, "james", TODAY);
});

function plan(): DayPlan {
  return store.get("james", TODAY)!;
}

/** An item that ran over, with no reason recorded yet. */
async function ranOver(label = "Module 4") {
  const item = service.selectItem("james", TODAY, {
    label,
    estimateMinutes: 60,
    start: `${TODAY}T09:00:00Z`,
    end: `${TODAY}T10:00:00Z`,
  });
  service.commitPlan("james", TODAY);
  await service.tick("james", TODAY, item.item!.id, { actualMinutes: 180 });
  return item.item!.id;
}

describe("the bar: a question earns its place only when the answer changes something", () => {
  it("says nothing about a day where nothing has happened", () => {
    const out = whatToAsk({
      plan: plan(),
      now: `${TODAY}T11:00:00Z`,
      allowanceLeft: 6,
      alreadyAsked: NONE,
    });
    expect(out.ask).toBeNull();
    expect(out.reason).toBe("nothing-worth-asking");
  });

  it("every candidate states what changes if it is answered", async () => {
    await ranOver();
    const all = allCandidates({
      plan: plan(),
      now: `${TODAY}T11:00:00Z`,
      allowanceLeft: 6,
      alreadyAsked: NONE,
      commitmentsDue: [{ id: "c1", what: "the Priya review", dueDate: TODAY }],
    });
    expect(all.length).toBeGreaterThan(0);
    for (const c of all) {
      // Not decoration. A candidate that cannot say what changes has not
      // passed the bar and should not have been built.
      expect(c.changes, `${c.id} must say what changes`).toBeTruthy();
      expect(c.changes.length).toBeGreaterThan(10);
    }
  });

  it("never asks how it is going", async () => {
    await ranOver();
    const all = allCandidates({
      plan: plan(),
      now: `${TODAY}T11:00:00Z`,
      allowanceLeft: 6,
      alreadyAsked: NONE,
    });
    for (const c of all) {
      expect(c.question).not.toMatch(/how('s| is) it going|everything ok|how are you/i);
    }
  });
});

describe("the four gates", () => {
  it("1 · asks about a ran-over item with no reason yet", async () => {
    const id = await ranOver();
    const out = whatToAsk({
      plan: plan(),
      now: `${TODAY}T11:00:00Z`,
      allowanceLeft: 6,
      alreadyAsked: NONE,
    });
    expect(out.reason).toBe("asked");
    expect(out.ask?.kind).toBe("miss-reason");
    expect(out.ask?.itemId).toBe(id);
  });

  it("2 · says nothing mid-meeting", async () => {
    await ranOver();
    service.arriveDuringDay("james", TODAY, {
      id: "m1",
      title: "Review",
      start: `${TODAY}T10:45:00Z`,
      end: `${TODAY}T11:30:00Z`,
    });
    const out = whatToAsk({
      plan: plan(),
      now: `${TODAY}T11:00:00Z`,
      allowanceLeft: 6,
      alreadyAsked: NONE,
    });
    expect(out.ask).toBeNull();
    expect(out.reason).toBe("bad-moment");
    expect(isBadMoment(plan(), `${TODAY}T11:00:00Z`)).toBe(true);
    // And it is fine again once the meeting is over.
    expect(isBadMoment(plan(), `${TODAY}T12:00:00Z`)).toBe(false);
  });

  it("3 · says nothing once the allowance is gone", async () => {
    await ranOver();
    const out = whatToAsk({
      plan: plan(),
      now: `${TODAY}T11:00:00Z`,
      allowanceLeft: 0,
      alreadyAsked: NONE,
    });
    expect(out.ask).toBeNull();
    expect(out.reason).toBe("no-allowance");
  });

  it("4 · does not ask the same thing twice in a day", async () => {
    const id = await ranOver();
    const out = whatToAsk({
      plan: plan(),
      now: `${TODAY}T11:00:00Z`,
      allowanceLeft: 6,
      alreadyAsked: new Set([`miss:${id}`]),
    });
    expect(out.ask).toBeNull();
    expect(out.reason).toBe("already-asked-today");
  });

  it("the allowance gate is checked before anything is gathered", async () => {
    // Cheapest and most absolute. A person who has said "stop asking me" should
    // not have work done on their behalf to decide what not to ask them.
    await ranOver();
    const out = whatToAsk({
      plan: plan(),
      now: "not-a-real-instant",
      allowanceLeft: 0,
      alreadyAsked: NONE,
    });
    expect(out.reason).toBe("no-allowance");
  });
});

describe("drop, do not queue", () => {
  it("returns at most one question, however many qualify", async () => {
    await ranOver("Module 4");
    const second = service.selectItem("james", TODAY, {
      label: "Deck",
      estimateMinutes: 30,
      start: `${TODAY}T10:00:00Z`,
      end: `${TODAY}T10:30:00Z`,
    });
    await service.tick("james", TODAY, second.item!.id, { actualMinutes: 120 });

    const all = allCandidates({
      plan: plan(),
      now: `${TODAY}T12:00:00Z`,
      allowanceLeft: 6,
      alreadyAsked: NONE,
    });
    expect(all.length).toBeGreaterThan(1);

    const out = whatToAsk({
      plan: plan(),
      now: `${TODAY}T12:00:00Z`,
      allowanceLeft: 6,
      alreadyAsked: NONE,
    });
    // One. The rest are not saved for later — a question not worth asking at
    // eleven is worth less at four.
    expect(out.ask).not.toBeNull();
    expect([out.ask]).toHaveLength(1);
  });

  it("a question already asked is forgotten, not deferred", async () => {
    const id = await ranOver();
    const second = service.selectItem("james", TODAY, {
      label: "Deck",
      estimateMinutes: 30,
      start: `${TODAY}T10:00:00Z`,
      end: `${TODAY}T10:30:00Z`,
    });
    await service.tick("james", TODAY, second.item!.id, { actualMinutes: 120 });

    // Having asked about the first, the pass moves on rather than retrying it.
    const out = whatToAsk({
      plan: plan(),
      now: `${TODAY}T12:00:00Z`,
      allowanceLeft: 6,
      alreadyAsked: new Set([`miss:${id}`]),
    });
    expect(out.ask?.id).not.toBe(`miss:${id}`);
    expect(out.ask?.kind).toBe("miss-reason");
  });
});

describe("the estimate offer", () => {
  it("offers when the learned figure is meaningfully different", async () => {
    const item = service.selectItem("james", TODAY, {
      label: "Module 4",
      estimateMinutes: 60,
      ref: { nodeType: "task", nodeId: "task-2" },
    });
    await service.tick("james", TODAY, item.item!.id, { actualMinutes: 60 });

    const out = whatToAsk({
      plan: plan(),
      now: `${TODAY}T17:00:00Z`,
      allowanceLeft: 6,
      alreadyAsked: NONE,
      learned: { "task:task-2": 180 },
    });
    expect(out.ask?.kind).toBe("estimate-offer");
    expect(out.ask?.question).toMatch(/180 minutes/);
    // Offered, never imposed — the wording is a question.
    expect(out.ask?.question).toMatch(/\?$/);
  });

  it("stays quiet when the difference is not worth the interruption", async () => {
    const item = service.selectItem("james", TODAY, {
      label: "Module 4",
      estimateMinutes: 60,
      ref: { nodeType: "task", nodeId: "task-2" },
    });
    await service.tick("james", TODAY, item.item!.id, { actualMinutes: 60 });
    const out = whatToAsk({
      plan: plan(),
      now: `${TODAY}T17:00:00Z`,
      allowanceLeft: 6,
      alreadyAsked: NONE,
      // Ten minutes out. Correcting that costs more attention than it saves.
      learned: { "task:task-2": 70 },
    });
    expect(out.ask).toBeNull();
  });
});

describe("commitment chases", () => {
  it("chases one that is due", () => {
    const out = whatToAsk({
      plan: plan(),
      now: `${TODAY}T15:00:00Z`,
      allowanceLeft: 6,
      alreadyAsked: NONE,
      commitmentsDue: [{ id: "c1", what: "the Priya review", dueDate: TODAY }],
    });
    expect(out.ask?.kind).toBe("commitment-chase");
    expect(out.ask?.question).toContain("the Priya review");
    // It quotes back what they said, so it cannot be about something they
    // never committed to.
    expect(out.ask?.question).toMatch(/you asked to be reminded/i);
  });

  it("a ran-over item outranks a commitment chase", async () => {
    await ranOver();
    const out = whatToAsk({
      plan: plan(),
      now: `${TODAY}T15:00:00Z`,
      allowanceLeft: 6,
      alreadyAsked: NONE,
      commitmentsDue: [{ id: "c1", what: "the Priya review", dueDate: TODAY }],
    });
    // The miss reason changes two things; the chase changes one.
    expect(out.ask?.kind).toBe("miss-reason");
  });

  /**
   * Phase 2's own learning log flagged this, and it was real.
   *
   * Candidates are gathered most-valuable-kind first and a bad day produces a
   * miss-reason *per* ran-over item. Taking the first fresh one therefore spent
   * the entire allowance on "what got in the way?" and never reached the
   * commitment the person had explicitly asked to be reminded of — the
   * system's own questions crowding out the one the user requested, on exactly
   * the day it mattered most.
   */
  it("a bad day still reaches the commitment the person asked for", async () => {
    await ranOver("Module 4");
    await ranOver("Module 5");
    await ranOver("Module 6");
    await ranOver("Module 7");
    await ranOver("Module 8");

    const due = [{ id: "c1", what: "the Priya review", dueDate: TODAY }];
    const asked = new Set<string>();
    const kinds: string[] = [];

    // Six ticks, which is the whole default allowance.
    for (let i = 0; i < 6; i += 1) {
      const out = whatToAsk({
        plan: plan(),
        now: `${TODAY}T15:00:00Z`,
        allowanceLeft: 6 - i,
        alreadyAsked: asked,
        commitmentsDue: due,
      });
      if (!out.ask) break;
      kinds.push(out.ask.kind);
      asked.add(out.ask.id);
    }

    // The first is still the miss reason — the ordering above decides that,
    // and it is right.
    expect(kinds[0]).toBe("miss-reason");
    // The second is the chase, not a sixth interrogation.
    expect(kinds[1]).toBe("commitment-chase");
    expect(kinds).toContain("commitment-chase");
  });

  it("asks every miss reason when there is nothing else to rotate to", async () => {
    await ranOver("Module 4");
    await ranOver("Module 5");

    const asked = new Set<string>();
    const kinds: string[] = [];
    for (let i = 0; i < 2; i += 1) {
      const out = whatToAsk({
        plan: plan(),
        now: `${TODAY}T15:00:00Z`,
        allowanceLeft: 6 - i,
        alreadyAsked: asked,
      });
      if (!out.ask) break;
      kinds.push(out.ask.kind);
      asked.add(out.ask.id);
    }
    // Rotation must not become silence: with one kind available it still asks.
    expect(kinds).toEqual(["miss-reason", "miss-reason"]);
  });
});

describe("dropped work is never asked about", () => {
  it("says nothing about an item that was dropped", async () => {
    // Note the shape: a ran-over item is DONE, and finished work cannot be
    // dropped. So the case that actually arises is unfinished work that was
    // dropped, and the guard has to cover the estimate offer rather than the
    // miss question.
    const item = service.selectItem("james", TODAY, {
      label: "Module 4",
      estimateMinutes: 60,
      ref: { nodeType: "task", nodeId: "task-2" },
    });
    service.commitPlan("james", TODAY);
    const dropped = service.dropItem("james", TODAY, item.item!.id, "Not needed");
    expect(dropped.error).toBeUndefined();

    const out = whatToAsk({
      plan: plan(),
      now: `${TODAY}T17:00:00Z`,
      allowanceLeft: 6,
      alreadyAsked: NONE,
      // Even with a strong opinion about the estimate, dropped work is off the
      // day and asking about it would be asking about a decision already made.
      learned: { "task:task-2": 180 },
    });
    expect(out.ask).toBeNull();
    expect(out.reason).toBe("nothing-worth-asking");
  });

  it("finished work cannot be dropped, so a ran-over item stays askable", async () => {
    const id = await ranOver();
    // Stated as a test because it is the reason the case above is shaped the
    // way it is, and it would otherwise look like an oversight.
    expect(service.dropItem("james", TODAY, id).error).toBeTruthy();
    const out = whatToAsk({
      plan: plan(),
      now: `${TODAY}T11:00:00Z`,
      allowanceLeft: 6,
      alreadyAsked: NONE,
    });
    expect(out.ask?.kind).toBe("miss-reason");
  });
});
