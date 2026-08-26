import { describe, it, expect, beforeEach } from "vitest";
import { buildDemoWorld, type DemoWorld } from "@/server/bootstrap";
import { createQuestionLimiter } from "@/domains/workplace/shared/limiter";
import { DayPlanService, LOOKBACK_DAYS } from "./service";
import { DayPlanStore } from "./store";
import { openDay } from "./test-support";

/**
 * The wider lookback.
 *
 * `carryForward` used to reach back exactly one day, which had two
 * consequences a person would notice. Work committed on Monday and not
 * re-picked on Tuesday **disappeared** — Wednesday looked at Tuesday, found
 * nothing, and the debt was gone. And four days pending read exactly like one
 * day pending, when the four-day one is the reason to have a brief at all.
 */

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
});

/** Commit a day with one item, left unfinished. */
async function unfinishedDay(date: string, label: string, minutes = 60) {
  await openDay(service, "james", date);
  const res = service.selectItem("james", date, { label, estimateMinutes: minutes });
  service.commitPlan("james", date);
  return res.item!.id;
}

async function briefOn(date: string): Promise<string> {
  const next = await service.startDay("james", date);
  return (next.plan?.brief.changed ?? []).join(" | ");
}

describe("work does not fall off the end after one day", () => {
  it("an item not re-picked still surfaces two days later", async () => {
    await unfinishedDay("2026-08-10", "Module 4");
    // Tuesday: a day happens, and Module 4 is not picked up again.
    await openDay(service, "james", "2026-08-11");
    service.selectItem("james", "2026-08-11", { label: "Something else", estimateMinutes: 30 });
    service.commitPlan("james", "2026-08-11");

    // Wednesday. Under the old one-day reach this was silently lost.
    const brief = await briefOn("2026-08-12");
    expect(brief).toContain("Module 4");
  });

  it("counts the days it has been carried", async () => {
    await unfinishedDay("2026-08-10", "Module 4");
    await unfinishedDay("2026-08-11", "Module 4");
    await unfinishedDay("2026-08-12", "Module 4");

    const brief = await briefOn("2026-08-13");
    expect(brief).toMatch(/Module 4 is 3 days overdue/);
  });

  it("says nothing about overdue days for work owed only since yesterday", async () => {
    // "1 day overdue" is technically true about yesterday and reads as nagging.
    await unfinishedDay("2026-08-10", "Module 4");
    const brief = await briefOn("2026-08-11");
    expect(brief).toContain("Module 4 is still open from yesterday.");
    expect(brief).not.toMatch(/overdue/);
  });
});

describe("the three things a wider window must not break", () => {
  it("dropped stays dropped, even from three days ago", async () => {
    // The rule the old code protected with a one-line skip, now protected
    // across the whole window: dropped is a decision, not a debt.
    const id = await unfinishedDay("2026-08-10", "Module 4");
    await unfinishedDay("2026-08-11", "Module 4");
    service.dropItem("james", "2026-08-11", id, "Not needed");
    // Drop it on the most recent day it appears.
    const day11 = store.get("james", "2026-08-11")!;
    service.dropItem("james", "2026-08-11", day11.plan[0].id, "Not needed");

    const brief = await briefOn("2026-08-12");
    expect(brief).not.toContain("Module 4");
  });

  it("a later completion settles an earlier unfinished copy", async () => {
    await unfinishedDay("2026-08-10", "Module 4");
    await openDay(service, "james", "2026-08-11");
    const again = service.selectItem("james", "2026-08-11", {
      label: "Module 4",
      estimateMinutes: 60,
    });
    service.commitPlan("james", "2026-08-11");
    await service.tick("james", "2026-08-11", again.item!.id, { actualMinutes: 60 });

    const brief = await briefOn("2026-08-12");
    expect(brief).not.toContain("Module 4");
  });

  it("the remainder carries, not the whole item", async () => {
    const id = await unfinishedDay("2026-08-10", "Module 4", 60);
    await service.tick("james", "2026-08-10", id, { progressMinutes: 45 });
    const brief = await briefOn("2026-08-11");
    // A9: 15 minutes owed, not an hour.
    expect(brief).toContain("15m left from yesterday");
    expect(brief).not.toMatch(/60m/);
  });

  it("interrupted is named as such, and still is when it is overdue", async () => {
    await openDay(service, "james", "2026-08-10");
    service.selectItem("james", "2026-08-10", {
      label: "Module 4",
      estimateMinutes: 60,
      start: "2026-08-10T11:00:00Z",
      end: "2026-08-10T12:00:00Z",
    });
    service.commitPlan("james", "2026-08-10");
    service.arriveDuringDay("james", "2026-08-10", {
      id: "m-late",
      title: "Review",
      start: "2026-08-10T11:00:00Z",
      end: "2026-08-10T12:00:00Z",
    });
    // Carry it a second day so the overdue wording is exercised too.
    await openDay(service, "james", "2026-08-11");
    service.selectItem("james", "2026-08-11", { label: "Module 4", estimateMinutes: 60 });
    service.commitPlan("james", "2026-08-11");

    const brief = await briefOn("2026-08-12");
    // A3 — the time was taken from them; the brief must not read as a telling-off.
    expect(brief).toMatch(/Module 4 was interrupted/);
    expect(brief).not.toMatch(/you (failed|missed|did not)/i);
  });
});

describe("a day on leave is skipped, not counted", () => {
  it("does not accrue an overdue day", async () => {
    await unfinishedDay("2026-08-10", "Module 4");
    // Away on the 11th.
    await openDay(service, "james", "2026-08-11");
    service.markLeave("james", "2026-08-11");

    const brief = await briefOn("2026-08-12");
    expect(brief).toContain("Module 4");
    // One working day owed, not two — so no overdue wording at all.
    expect(brief).not.toMatch(/overdue/);
  });

  it("still carries work from before the leave", async () => {
    // The old code returned [] the moment yesterday was a leave day, so a week
    // away wiped everything owed before it.
    await unfinishedDay("2026-08-10", "Module 4");
    await openDay(service, "james", "2026-08-11");
    service.markLeave("james", "2026-08-11");
    const brief = await briefOn("2026-08-12");
    expect(brief).toContain("Module 4");
  });

  it("nothing is carried from the leave day itself", async () => {
    // The existing guarantee, unchanged.
    await openDay(service, "james", "2026-08-10");
    service.selectItem("james", "2026-08-10", { label: "Module 4", estimateMinutes: 60 });
    service.markLeave("james", "2026-08-10");
    const brief = await briefOn("2026-08-11");
    expect(brief).not.toContain("Module 4");
  });
});

describe("across a weekend", () => {
  it("counts only the days that had a plan", async () => {
    // Friday the 7th, then nothing over the weekend, then Monday the 10th.
    // Saturday and Sunday have no plan at all, so they cannot be owed days.
    await unfinishedDay("2026-08-07", "Module 4");
    const brief = await briefOn("2026-08-10");
    expect(brief).toContain("Module 4");
    expect(brief).not.toMatch(/overdue/);
  });

  it("reaches back across a gap of several empty days", async () => {
    await unfinishedDay("2026-08-03", "Module 4");
    // Six days with nothing recorded at all.
    const brief = await briefOn("2026-08-09");
    expect(brief).toContain("Module 4");
  });

  it("stops at the lookback window", async () => {
    expect(LOOKBACK_DAYS).toBe(14);
    await unfinishedDay("2026-08-01", "Ancient");
    // Well past fourteen days later.
    const brief = await briefOn("2026-09-30");
    expect(brief).not.toContain("Ancient");
  });
});

describe("the same work across days is one debt", () => {
  it("matches on the backing record rather than the label", async () => {
    const ref = { nodeType: "task", nodeId: "task-2" };
    await openDay(service, "james", "2026-08-10");
    service.selectItem("james", "2026-08-10", { label: "Module 4", estimateMinutes: 60, ref });
    service.commitPlan("james", "2026-08-10");

    await openDay(service, "james", "2026-08-11");
    // Relabelled, same task. Still one debt, now two days old.
    service.selectItem("james", "2026-08-11", {
      label: "Module 4 — practice",
      estimateMinutes: 60,
      ref,
    });
    service.commitPlan("james", "2026-08-11");

    const brief = await briefOn("2026-08-12");
    expect(brief).toMatch(/2 days overdue/);
    // Named once, not twice.
    expect(brief.match(/days overdue/g)).toHaveLength(1);
  });
});
