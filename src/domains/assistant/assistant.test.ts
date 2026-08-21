import { describe, it, expect, beforeEach } from "vitest";
import { buildDemoWorld, type DemoWorld } from "@/server/bootstrap";
import { createQuestionLimiter } from "@/domains/workplace/shared/limiter";
import { enforceAppendixD } from "./appendix-d";
import { peopleSpecialist, type AssistantCtx } from "./specialists";
import { DayPlanService } from "./day-plan/service";
import { applyDayPlanReactions } from "./day-plan/reactions";
import { dayWindowStart } from "./day-plan/time";
import {
  DayPlanStore,
  type DayPlan,
  type DayPlanPersistence,
  type StreakRecord,
} from "./day-plan/store";

let world: DemoWorld;
let store: DayPlanStore;
let service: DayPlanService;

function ctx(actor: string): AssistantCtx {
  return { actor, spine: world.spine, graph: world.deps.graph, asOf: "2026-08-08T23:59:59Z" };
}

function add(
  label: string,
  estimateMinutes: number,
  opts: { start?: string; end?: string; ref?: { nodeType: string; nodeId: string } } = {},
): string {
  const res = service.selectItem("james", "2026-08-08", { label, estimateMinutes, ...opts });
  return res.item!.id;
}

/**
 * Start a day and work through its brief, the way a person does.
 *
 * A1 is conversation-first and the service now enforces it, so a test cannot
 * jump straight from `startDay` to `selectItem` any more than the UI can.
 */
export async function openDay(svc: DayPlanService, actor: string, date: string): Promise<void> {
  await svc.startDay(actor, date);
  // Bounded: the brief is a handful of items, never dozens.
  for (let i = 0; i < 50; i += 1) {
    const plan = svc.getStore().get(actor, date);
    if (!plan || plan.phase !== "briefing") return;
    svc.answerBrief(actor, date, "Got it");
  }
}

beforeEach(async () => {
  world = await buildDemoWorld();
  store = new DayPlanStore();
  service = new DayPlanService(store, {
    graph: world.deps.graph,
    limiter: createQuestionLimiter(),
    actorLookup: () => ({ spine: world.spine }),
  });
  await openDay(service, "james", "2026-08-08");
});

describe("appendix D — comments on work, never the person", () => {
  it("blocks comments on the person", () => {
    expect(enforceAppendixD("You work more slowly in the afternoons.").ok).toBe(false);
    expect(enforceAppendixD("You should take a break.").ok).toBe(false);
    expect(enforceAppendixD("You tend to procrastinate.").ok).toBe(false);
  });
  it("blocks comparisons", () => {
    expect(enforceAppendixD("You are behind compared to Priya.").ok).toBe(false);
    expect(enforceAppendixD("Arun is faster than you.").ok).toBe(false);
  });
  it("allows work facts", () => {
    expect(enforceAppendixD("You have committed 8 hours to a day with 3 hours of meetings.").ok).toBe(true);
    expect(enforceAppendixD("This has been on your list four days running.").ok).toBe(true);
  });
});

describe("assistant is permission-bound (cannot leak what you can't open)", () => {
  it("a manager (own-team) sees a team member's pending leave; an outsider does not", async () => {
    await world.deps.graph.putNode("leave", "leave-x", {
      employeeId: "priya",
      employeeName: "Priya R.",
      status: "Pending",
      fromDate: "2026-08-08",
      toDate: "2026-08-08",
    });
    expect(await peopleSpecialist.answer("", ctx("james"))).toContain("Priya");
    expect(await peopleSpecialist.answer("", ctx("ravi"))).toContain("Nothing is waiting");
  });
});

describe("A1 — once-a-day, mandatory time, resume", () => {
  it("reopening a planned day goes straight to the dashboard", async () => {
    add("Review", 60);
    service.commitPlan("james", "2026-08-08");
    expect((await service.startDay("james", "2026-08-08")).open).toBe("dashboard");
  });
  it("an item without a time is refused", () => {
    expect(service.selectItem("james", "2026-08-08", { label: "X", estimateMinutes: 0 }).error).toBeTruthy();
  });
  it("an abandoned brief offers to resume", async () => {
    service.abandon("james", "2026-08-08");
    const resumed = await service.startDay("james", "2026-08-08");
    expect(resumed.open).toBe("resume");
    expect(resumed.prompt).toMatch(/finish/);
  });
});

describe("A2 — telling the two kinds of miss apart", () => {
  it("a meeting in the window ⇒ interrupted (it knows, no question)", async () => {
    await world.deps.graph.putNode("meeting", "m1", {
      title: "Arun review",
      from: "2026-08-08T11:00:00Z",
      to: "2026-08-08T12:00:00Z",
      attendees: ["james"],
    });
    const id = add("Module 4", 60, { start: "2026-08-08T11:00:00Z", end: "2026-08-08T12:00:00Z" });
    const res = await service.tick("james", "2026-08-08", id, { actualMinutes: 120 });
    expect(res.miss?.kind).toBe("interrupted");
    expect(res.miss?.cause).toBe("Arun review");
  });
  it("no meeting ⇒ ran-over", async () => {
    const id = add("Module 4", 60, { start: "2026-08-08T11:00:00Z", end: "2026-08-08T12:00:00Z" });
    const res = await service.tick("james", "2026-08-08", id, { actualMinutes: 180 });
    expect(res.miss?.kind).toBe("ran-over");
  });
});

describe("A3/A4 — interrupted keeps streak; ran-over asks once (2/day)", () => {
  it("interrupted items don't break the streak", async () => {
    await world.deps.graph.putNode("meeting", "m1", {
      title: "Review",
      from: "2026-08-08T11:00:00Z",
      to: "2026-08-08T12:00:00Z",
      attendees: ["james"],
    });
    const id = add("Work", 60, { start: "2026-08-08T11:00:00Z", end: "2026-08-08T12:00:00Z" });
    await service.tick("james", "2026-08-08", id, { actualMinutes: 120 });
    service.finalizeDay("james", "2026-08-08");
    expect(store.streakFor("james").clean).toBe(1);
  });

  it("ran-over questions respect the two-questions-per-day limit", async () => {
    const ids: string[] = [];
    for (let i = 1; i <= 3; i++) {
      ids.push(add(`Work ${i}`, 30, { start: `2026-08-08T0${i}:00:00Z`, end: `2026-08-08T0${i}:30:00Z` }));
      await service.tick("james", "2026-08-08", ids[i - 1], { actualMinutes: 90 });
    }
    expect(service.recordMissReason("james", "2026-08-08", ids[0], "underestimated").asked).toBe(true);
    expect(service.recordMissReason("james", "2026-08-08", ids[1], "blocked").asked).toBe(true);
    expect(service.recordMissReason("james", "2026-08-08", ids[2], "grew").asked).toBe(false);
  });
});

describe("A5 — estimate learning", () => {
  it("learns from the overrun itself, without waiting for an answer", async () => {
    const id = add("Review work", 60, {
      start: "2026-08-08T09:00:00Z",
      end: "2026-08-08T10:00:00Z",
      ref: { nodeType: "course", nodeId: "ai-presentations" },
    });
    await service.tick("james", "2026-08-08", id, { actualMinutes: 180 });
    // No `recordMissReason` call — A4 lets the question lapse quietly, and the
    // minutes are a fact whether or not anyone explains them.
    expect(store.learnedAdjustment("course:ai-presentations")).toBe(180);
  });

  it("answering does not count the same overrun a second time", async () => {
    const id = add("Review work", 60, {
      start: "2026-08-08T09:00:00Z",
      end: "2026-08-08T10:00:00Z",
      ref: { nodeType: "course", nodeId: "ai-presentations" },
    });
    await service.tick("james", "2026-08-08", id, { actualMinutes: 180 });
    service.recordMissReason("james", "2026-08-08", id, "review always takes longer");
    // 180 recorded once, not averaged with itself.
    expect(store.learnedAdjustment("course:ai-presentations")).toBe(180);
  });

  it("records an adjusted estimate after a miss reason", async () => {
    const id = add("Review work", 60, {
      start: "2026-08-08T09:00:00Z",
      end: "2026-08-08T10:00:00Z",
      ref: { nodeType: "course", nodeId: "ai-presentations" },
    });
    await service.tick("james", "2026-08-08", id, { actualMinutes: 180 });
    const res = service.recordMissReason("james", "2026-08-08", id, "review always takes longer");
    expect(res.asked).toBe(true);
    expect(res.learnedEstimate).toBe(180);
  });
});

describe("A7 — streak: clean vs ran-over", () => {
  it("a clean day increments the streak", async () => {
    const id = add("A", 60);
    await service.tick("james", "2026-08-08", id, { actualMinutes: 60 });
    service.finalizeDay("james", "2026-08-08");
    expect(store.streakFor("james").clean).toBe(1);
  });
  it("a ran-over day resets the clean streak", async () => {
    const id = add("A", 60);
    await service.tick("james", "2026-08-08", id, { actualMinutes: 180 });
    service.finalizeDay("james", "2026-08-08");
    expect(store.streakFor("james").clean).toBe(0);
  });
});

describe("A8 — manager never sees the streak or miss reasons", () => {
  it("managerView exposes committed/estimates but not streak or miss", async () => {
    const plan = store.get("james", "2026-08-08")!;
    void plan;
    const serviceP = new DayPlanService(store, {
      graph: world.deps.graph,
      limiter: createQuestionLimiter(),
      actorLookup: () => ({ spine: world.spine }),
    });
    await openDay(serviceP, "priya", "2026-08-09");
    const res = serviceP.selectItem("priya", "2026-08-09", { label: "Draft", estimateMinutes: 90 });
    await serviceP.tick("priya", "2026-08-09", res.item!.id, { actualMinutes: 180 });
    const view = serviceP.managerView("james", "priya", "2026-08-09");
    expect(view.streakVisible).toBe(false);
    expect(view.committed.length).toBe(1);
    // Assert the WHOLE key set, not the absence of one field. Checking only
    // `"miss" in item` passed while `actualMinutes` and `doneAt` still came
    // through — and `actualMinutes > estimateMinutes` is the ran-over miss A8
    // forbids, one subtraction away.
    expect(Object.keys(view.committed[0]).sort()).toEqual([
      "done",
      "estimateMinutes",
      "id",
      "label",
    ]);
  });

  it("nothing a manager receives can reconstruct a miss", async () => {
    const serviceP = new DayPlanService(store, {
      graph: world.deps.graph,
      limiter: createQuestionLimiter(),
      actorLookup: () => ({ spine: world.spine }),
    });
    await openDay(serviceP, "priya", "2026-08-09");
    const res = serviceP.selectItem("priya", "2026-08-09", { label: "Draft", estimateMinutes: 90 });
    await serviceP.tick("priya", "2026-08-09", res.item!.id, { actualMinutes: 240 });
    serviceP.recordMissReason("priya", "2026-08-09", res.item!.id, "blocked by review");

    const serialised = JSON.stringify(serviceP.managerView("james", "priya", "2026-08-09"));
    for (const forbidden of ["actualMinutes", "doneAt", "miss", "interrupted", "blocked by review", "240"]) {
      expect(serialised).not.toContain(forbidden);
    }
  });
});

describe("A9 — edge cases", () => {
  it("a day with no commitments has no streak effect", () => {
    service.commitPlan("james", "2026-08-08");
    service.finalizeDay("james", "2026-08-08");
    expect(store.streakFor("james").clean).toBe(0);
  });
  it("leave pauses the day (no streak penalty)", () => {
    service.markLeave("james", "2026-08-08");
    service.finalizeDay("james", "2026-08-08");
    expect(store.streakFor("james").clean).toBe(0);
  });
});

describe("A6 — a meeting arriving during the day interrupts work", () => {
  it("marks overlapping planned work as interrupted", () => {
    const id = add("Module 4", 60, { start: "2026-08-08T11:00:00Z", end: "2026-08-08T12:00:00Z" });
    service.commitPlan("james", "2026-08-08");
    service.arriveDuringDay("james", "2026-08-08", {
      id: "m-late",
      title: "Arun booked a review",
      start: "2026-08-08T11:00:00Z",
      end: "2026-08-08T12:00:00Z",
    });
    expect(store.get("james", "2026-08-08")!.plan.find((p) => p.id === id)?.interrupted).toBe(true);
  });
});

describe("A1 — work is placed in the day, around what is already booked", () => {
  // The working day opens at 09:00 *local*, so these assert against the
  // computed window rather than a hard-coded `Z` literal — which is exactly
  // the bug being fixed: 09:00Z showed as 2:30 PM for an India-resident org.
  const opensAt = (date: string) => dayWindowStart(date);
  const isoAt = (date: string, offsetMinutes: number) =>
    new Date(opensAt(date) + offsetMinutes * 60_000).toISOString();

  it("an item with no window given is scheduled from the start of the day", () => {
    const first = service.selectItem("james", "2026-08-08", { label: "Module 4", estimateMinutes: 60 });
    const second = service.selectItem("james", "2026-08-08", { label: "Friday prep", estimateMinutes: 30 });
    expect(first.item!.start).toBe(isoAt("2026-08-08", 0));
    expect(first.item!.end).toBe(isoAt("2026-08-08", 60));
    expect(second.item!.start).toBe(isoAt("2026-08-08", 60));
    expect(second.item!.end).toBe(isoAt("2026-08-08", 90));
  });

  it("work steps over a meeting rather than through it", async () => {
    // A half-hour standup at the moment the day opens, wherever that is.
    await world.deps.graph.putNode("meeting", "m-standup", {
      title: "Standup",
      from: isoAt("2026-08-10", 0),
      to: isoAt("2026-08-10", 30),
      attendees: ["james"],
    });
    await openDay(service, "james", "2026-08-10");
    const res = service.selectItem("james", "2026-08-10", { label: "Module 4", estimateMinutes: 60 });
    expect(res.item!.start).toBe(isoAt("2026-08-10", 30));
    expect(res.item!.end).toBe(isoAt("2026-08-10", 90));
  });

  it("an explicitly scheduled item is left where the caller put it", () => {
    const id = add("Fixed", 60, { start: "2026-08-08T14:00:00Z", end: "2026-08-08T15:00:00Z" });
    service.selectItem("james", "2026-08-08", { label: "Auto", estimateMinutes: 60 });
    const plan = store.get("james", "2026-08-08")!;
    expect(plan.plan.find((p) => p.id === id)!.start).toBe("2026-08-08T14:00:00Z");
  });

  it("the same task cannot be committed to twice in a day", () => {
    const ref = { nodeType: "task", nodeId: "t-dup" };
    const first = service.selectItem("james", "2026-08-08", { label: "Draft", estimateMinutes: 60, ref });
    const second = service.selectItem("james", "2026-08-08", { label: "Draft", estimateMinutes: 30, ref });
    expect(second.item!.id).toBe(first.item!.id);
    expect(store.get("james", "2026-08-08")!.plan).toHaveLength(1);
  });

  it("a hydrated item with no window is scheduled, not treated as pinned", () => {
    // What every plan written before `autoScheduled` existed looks like.
    const plan = store.get("james", "2026-08-08")!;
    plan.plan.push({ id: "legacy-1", label: "From an older release", estimateMinutes: 60 });
    store.put(plan);

    service.selectItem("james", "2026-08-08", { label: "New", estimateMinutes: 30 });

    const legacy = store.get("james", "2026-08-08")!.plan.find((p) => p.id === "legacy-1")!;
    expect(legacy.start).toBeDefined();
    expect(legacy.end).toBeDefined();
  });

  it("planning before the day has started fails cleanly rather than crashing", () => {
    expect(() =>
      service.selectItem("ravi", "2026-08-08", { label: "X", estimateMinutes: 30 }),
    ).toThrow(/start the day/i);
  });
});

describe("A4 — the overrun offer appears only when the rest of the day is at risk", () => {
  it("offers when later work has already been overrun into", async () => {
    const first = add("Module 4", 60);
    service.selectItem("james", "2026-08-08", { label: "Friday prep", estimateMinutes: 60 });
    const res = await service.tick("james", "2026-08-08", first, {
      actualMinutes: 180,
      at: "2026-08-08T12:00:00Z",
    });
    expect(res.miss?.kind).toBe("ran-over");
    expect(res.offerNow).toBe(true);
  });

  it("stays quiet when nothing later is affected", async () => {
    const only = add("Module 4", 60);
    const res = await service.tick("james", "2026-08-08", only, {
      actualMinutes: 180,
      at: "2026-08-08T12:00:00Z",
    });
    expect(res.miss?.kind).toBe("ran-over");
    expect(res.offerNow).toBeFalsy();
  });
});

describe("A7 — interrupted work is excused, not counted against the day", () => {
  it("an interrupted, unfinished item does not cost a day that was otherwise clean", async () => {
    const finished = add("Finished", 60, { start: "2026-08-08T09:00:00Z", end: "2026-08-08T10:00:00Z" });
    add("Displaced", 60, { start: "2026-08-08T11:00:00Z", end: "2026-08-08T12:00:00Z" });
    await service.tick("james", "2026-08-08", finished, { actualMinutes: 60 });
    service.arriveDuringDay("james", "2026-08-08", {
      id: "m-late",
      title: "Arun booked a review",
      start: "2026-08-08T11:00:00Z",
      end: "2026-08-08T12:00:00Z",
    });
    service.finalizeDay("james", "2026-08-08");
    expect(store.streakFor("james").clean).toBe(1);
  });

  it("a day entirely taken by meetings neither builds nor breaks the streak", () => {
    add("Displaced", 60, { start: "2026-08-08T11:00:00Z", end: "2026-08-08T12:00:00Z" });
    service.arriveDuringDay("james", "2026-08-08", {
      id: "m-late",
      title: "All-hands",
      start: "2026-08-08T11:00:00Z",
      end: "2026-08-08T12:00:00Z",
    });
    service.finalizeDay("james", "2026-08-08");
    expect(store.streakFor("james").clean).toBe(0);
  });
});

describe("A1 — answering the brief feeds the plan", () => {
  async function briefFor(date: string) {
    await world.deps.graph.putNode("leave", `leave-${date}`, {
      employeeId: "priya",
      employeeName: "Priya R.",
      status: "Pending",
      fromDate: date,
      toDate: date,
    });
    await service.startDay("james", date);
    return store.get("james", date)!;
  }

  it("“Handle” is offered back when choosing the day", async () => {
    const plan = await briefFor("2026-08-11");
    const item = service.currentBriefItem(plan)!;
    service.answerBrief("james", "2026-08-11", "Handle");
    expect(store.get("james", "2026-08-11")!.suggested).toContain(item.text);
  });

  it("“Later” is not, and comes back in tomorrow's brief", async () => {
    const plan = await briefFor("2026-08-11");
    const item = service.currentBriefItem(plan)!;
    service.answerBrief("james", "2026-08-11", "Later");
    expect(store.get("james", "2026-08-11")!.suggested ?? []).not.toContain(item.text);
    const tomorrow = await service.startDay("james", "2026-08-12");
    expect(tomorrow.plan!.brief.changed.join(" ")).toContain(item.text);
  });
});

describe("A9 — unfinished work carries to tomorrow", () => {
  it("names yesterday's open items in today's brief", async () => {
    service.selectItem("james", "2026-08-08", { label: "Module 4", estimateMinutes: 60 });
    service.commitPlan("james", "2026-08-08");
    const next = await service.startDay("james", "2026-08-09");
    expect(next.plan!.brief.changed.join(" ")).toContain("Module 4");
  });

  it("says an item was interrupted rather than blaming the person for it", async () => {
    add("Module 4", 60, { start: "2026-08-08T11:00:00Z", end: "2026-08-08T12:00:00Z" });
    service.arriveDuringDay("james", "2026-08-08", {
      id: "m-late",
      title: "Review",
      start: "2026-08-08T11:00:00Z",
      end: "2026-08-08T12:00:00Z",
    });
    const next = await service.startDay("james", "2026-08-09");
    expect(next.plan!.brief.changed.join(" ")).toMatch(/Module 4 was interrupted/);
  });

  it("nothing is carried from a day spent on leave", async () => {
    service.selectItem("james", "2026-08-08", { label: "Module 4", estimateMinutes: 60 });
    service.markLeave("james", "2026-08-08");
    const next = await service.startDay("james", "2026-08-09");
    expect(next.plan!.brief.changed.join(" ")).not.toContain("Module 4");
  });
});

describe("a committed day cannot be corrupted or double-counted", () => {
  it("answering the brief after committing is refused, not silently accepted", () => {
    add("Module 4", 60);
    service.commitPlan("james", "2026-08-08");
    expect(() => service.answerBrief("james", "2026-08-08", "Got it")).toThrow(/already planned/i);
    expect(store.get("james", "2026-08-08")!.phase).toBe("planned");
  });

  it("committing twice counts one planned day", () => {
    add("Module 4", 60);
    service.commitPlan("james", "2026-08-08");
    service.commitPlan("james", "2026-08-08");
    service.commitPlan("james", "2026-08-08");
    expect(store.streakFor("james").dayPlanned).toBe(1);
  });

  it("closing out twice counts one clean day", async () => {
    const id = add("Module 4", 60);
    service.commitPlan("james", "2026-08-08");
    await service.tick("james", "2026-08-08", id, { actualMinutes: 60 });
    service.finalizeDay("james", "2026-08-08");
    service.finalizeDay("james", "2026-08-08");
    service.finalizeDay("james", "2026-08-08");
    expect(store.streakFor("james").clean).toBe(1);
  });

  it("a ran-over day cannot be re-closed to keep resetting the streak", async () => {
    const streak = store.streakFor("james");
    streak.clean = 4;
    const id = add("Module 4", 60);
    service.commitPlan("james", "2026-08-08");
    await service.tick("james", "2026-08-08", id, { actualMinutes: 180 });
    service.finalizeDay("james", "2026-08-08");
    expect(store.streakFor("james").clean).toBe(0);
    // Second close-out is a no-op rather than another assessment.
    service.finalizeDay("james", "2026-08-08");
    expect(store.streakFor("james").lastAssessedDate).toBe("2026-08-08");
  });

  it("adding and reordering stay open on a committed day (A9, A1b)", () => {
    add("First", 60);
    service.commitPlan("james", "2026-08-08");
    const added = service.selectItem("james", "2026-08-08", { label: "Added mid-day", estimateMinutes: 30 });
    expect(added.item).toBeDefined();
    const ids = store.get("james", "2026-08-08")!.plan.map((p) => p.id).reverse();
    expect(() => service.reorder("james", "2026-08-08", ids)).not.toThrow();
  });
});

describe("A6/A9 — a planned day reacts to meetings and leave", () => {
  function react(name: string, args: Record<string, unknown>) {
    return applyDayPlanReactions(name, args, { service, graph: world.deps.graph });
  }

  it("a meeting booked into a committed window displaces the work there", async () => {
    const id = add("Module 4", 60, { start: "2026-08-08T11:00:00Z", end: "2026-08-08T12:00:00Z" });
    service.commitPlan("james", "2026-08-08");
    await world.deps.graph.putNode("meeting", "m-arrived", {
      title: "Arun booked a review",
      from: "2026-08-08T11:00:00Z",
      to: "2026-08-08T12:00:00Z",
      attendees: ["james"],
    });

    await react("meeting.create", { meetingId: "m-arrived" });

    const item = store.get("james", "2026-08-08")!.plan.find((p) => p.id === id)!;
    expect(item.interrupted).toBe(true);
    expect(item.miss?.cause).toBe("Arun booked a review");
  });

  it("leaves a day alone that has not been committed to yet", async () => {
    const id = add("Module 4", 60, { start: "2026-08-08T11:00:00Z", end: "2026-08-08T12:00:00Z" });
    await world.deps.graph.putNode("meeting", "m-early", {
      title: "Next week's review",
      from: "2026-08-08T11:00:00Z",
      to: "2026-08-08T12:00:00Z",
      attendees: ["james"],
    });

    await react("meeting.create", { meetingId: "m-early" });

    expect(store.get("james", "2026-08-08")!.plan.find((p) => p.id === id)?.interrupted).toBeFalsy();
  });

  it("the same meeting arriving twice does not stack up", async () => {
    add("Module 4", 60, { start: "2026-08-08T11:00:00Z", end: "2026-08-08T12:00:00Z" });
    service.commitPlan("james", "2026-08-08");
    await world.deps.graph.putNode("meeting", "m-twice", {
      title: "Review",
      from: "2026-08-08T11:00:00Z",
      to: "2026-08-08T12:00:00Z",
      attendees: ["james"],
    });

    await react("meeting.create", { meetingId: "m-twice" });
    await react("meeting.update", { meetingId: "m-twice" });

    expect(store.get("james", "2026-08-08")!.meetings.filter((m) => m.id === "m-twice")).toHaveLength(1);
  });

  it("approved leave pauses the streak instead of breaking it", async () => {
    const streak = store.streakFor("james");
    streak.clean = 3;
    const id = add("Module 4", 60, { start: "2026-08-08T09:00:00Z", end: "2026-08-08T10:00:00Z" });
    service.commitPlan("james", "2026-08-08");
    await service.tick("james", "2026-08-08", id, { actualMinutes: 180 });
    expect(store.get("james", "2026-08-08")!.plan[0].miss?.kind).toBe("ran-over");

    await world.deps.graph.putNode("leave", "lv-react", {
      employeeId: "james",
      fromDate: "2026-08-08",
      toDate: "2026-08-08",
      status: "Approved",
    });
    await react("leave.approve", { leaveId: "lv-react" });
    service.finalizeDay("james", "2026-08-08");

    expect(store.get("james", "2026-08-08")!.onLeave).toBe(true);
    expect(store.streakFor("james").clean).toBe(3);
  });

  it("an operation with nothing to react to is harmless", async () => {
    await expect(react("task.create", { title: "X" })).resolves.toBeUndefined();
    await expect(react("meeting.create", { meetingId: "does-not-exist" })).resolves.toBeUndefined();
  });
});

describe("tasks and the day plan stay in step", () => {
  function react(name: string, args: Record<string, unknown>) {
    return applyDayPlanReactions(name, args, {
      service,
      graph: world.deps.graph,
      asOf: "2026-08-08",
    });
  }

  async function taskFor(actor: string, id: string) {
    await world.deps.graph.putNode("task", id, {
      title: `Task ${id}`,
      assignedTo: actor,
      status: "todo",
      priority: "medium",
      createdBy: actor,
    });
  }

  it("finishing a task on the board ticks the item committed to it", async () => {
    await taskFor("james", "t-linked");
    const item = service.selectItem("james", "2026-08-08", {
      label: "Task t-linked",
      estimateMinutes: 60,
      ref: { nodeType: "task", nodeId: "t-linked" },
    });
    service.commitPlan("james", "2026-08-08");

    await react("task.complete", { taskId: "t-linked" });

    const plan = store.get("james", "2026-08-08")!;
    expect(plan.plan.find((p) => p.id === item.item!.id)?.done).toBe(true);
  });

  it("no time was given, so nothing is judged and nothing is asked", async () => {
    await taskFor("james", "t-quiet");
    service.selectItem("james", "2026-08-08", {
      label: "Task t-quiet",
      estimateMinutes: 60,
      ref: { nodeType: "task", nodeId: "t-quiet" },
    });
    service.commitPlan("james", "2026-08-08");

    await react("task.complete", { taskId: "t-quiet" });

    expect(store.get("james", "2026-08-08")!.plan[0].miss).toBeUndefined();
  });

  it("an unrelated task leaves the plan alone", async () => {
    await taskFor("james", "t-planned");
    await taskFor("james", "t-other");
    service.selectItem("james", "2026-08-08", {
      label: "Task t-planned",
      estimateMinutes: 60,
      ref: { nodeType: "task", nodeId: "t-planned" },
    });
    service.commitPlan("james", "2026-08-08");

    await react("task.complete", { taskId: "t-other" });

    expect(store.get("james", "2026-08-08")!.plan[0].done).toBeFalsy();
  });

  it("someone else's task does not tick your day", async () => {
    await taskFor("priya", "t-priya");
    service.selectItem("james", "2026-08-08", { label: "Mine", estimateMinutes: 60 });
    service.commitPlan("james", "2026-08-08");

    await react("task.complete", { taskId: "t-priya" });

    expect(store.get("james", "2026-08-08")!.plan[0].done).toBeFalsy();
  });
});

describe("day-plan persistence — a restart does not lose the day", () => {
  class FakePersistence implements DayPlanPersistence {
    plans = new Map<string, DayPlan>();
    streaks = new Map<string, StreakRecord>();
    estimates = new Map<string, { estimate: number; actuals: number[] }>();
    async savePlan(p: DayPlan) {
      this.plans.set(`${p.actor}:${p.date}`, JSON.parse(JSON.stringify(p)) as DayPlan);
    }
    async loadPlan(actor: string, date: string) {
      return this.plans.get(`${actor}:${date}`);
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
    async loadAllEstimates() {
      return [...this.estimates].map(([key, v]) => ({ key, ...v }));
    }
  }

  function serviceOn(s: DayPlanStore): DayPlanService {
    return new DayPlanService(s, {
      graph: world.deps.graph,
      limiter: createQuestionLimiter(),
      actorLookup: () => ({ spine: world.spine }),
    });
  }

  // Writes are fire-and-forget; let the queued microtasks land.
  const flush = () => new Promise((r) => setTimeout(r, 0));

  it("a committed plan and its streak come back through a fresh store", async () => {
    const persistence = new FakePersistence();
    const storeA = new DayPlanStore(persistence);
    const svcA = serviceOn(storeA);
    await openDay(svcA, "james", "2026-08-08");
    svcA.selectItem("james", "2026-08-08", { label: "Review", estimateMinutes: 60 });
    svcA.commitPlan("james", "2026-08-08");
    await flush();

    const storeB = new DayPlanStore(persistence); // "after the restart"
    await storeB.load("james", "2026-08-08");
    const plan = storeB.get("james", "2026-08-08");
    expect(plan?.phase).toBe("planned");
    expect(plan?.plan.map((p) => p.label)).toEqual(["Review"]);
    expect(storeB.streakFor("james").dayPlanned).toBe(1);
  });

  it("learned estimates survive the restart", async () => {
    const persistence = new FakePersistence();
    const storeA = new DayPlanStore(persistence);
    storeA.recordEstimate("task:t1", 60, 90);
    storeA.recordEstimate("task:t1", 60, 110);
    await flush();

    const storeB = new DayPlanStore(persistence);
    await storeB.load("james", "2026-08-08");
    expect(storeB.learnedAdjustment("task:t1")).toBe(100);
  });

  it("a second load never clobbers newer in-memory state", async () => {
    const persistence = new FakePersistence();
    const storeA = new DayPlanStore(persistence);
    const svcA = serviceOn(storeA);
    await storeA.load("james", "2026-08-08");
    await openDay(svcA, "james", "2026-08-08");
    const id = svcA.selectItem("james", "2026-08-08", { label: "Draft", estimateMinutes: 30 }).item!.id;
    svcA.commitPlan("james", "2026-08-08");
    await svcA.tick("james", "2026-08-08", id, {});
    await storeA.load("james", "2026-08-08"); // hydrated → must be a no-op
    expect(storeA.get("james", "2026-08-08")!.plan[0].done).toBe(true);
  });
});
