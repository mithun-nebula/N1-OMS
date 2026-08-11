import { describe, it, expect, beforeEach } from "vitest";
import { buildDemoWorld, type DemoWorld } from "@/server/bootstrap";
import { createQuestionLimiter } from "@/domains/workplace/shared/limiter";
import { enforceAppendixD } from "./appendix-d";
import { peopleSpecialist, type AssistantCtx } from "./specialists";
import { DayPlanService } from "./day-plan/service";
import { DayPlanStore } from "./day-plan/store";

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

beforeEach(async () => {
  world = await buildDemoWorld();
  store = new DayPlanStore();
  service = new DayPlanService(store, {
    graph: world.deps.graph,
    limiter: createQuestionLimiter(),
    actorLookup: () => ({ spine: world.spine }),
  });
  await service.startDay("james", "2026-08-08");
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
    await serviceP.startDay("priya", "2026-08-09");
    const res = serviceP.selectItem("priya", "2026-08-09", { label: "Draft", estimateMinutes: 90 });
    await serviceP.tick("priya", "2026-08-09", res.item!.id, { actualMinutes: 180 });
    const view = serviceP.managerView("james", "priya", "2026-08-09");
    expect(view.streakVisible).toBe(false);
    expect(view.committed.length).toBe(1);
    expect("miss" in view.committed[0]).toBe(false);
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
