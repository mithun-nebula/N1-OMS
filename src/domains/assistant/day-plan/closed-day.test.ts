import { describe, it, expect, beforeEach } from "vitest";
import { buildDemoWorld, type DemoWorld } from "@/server/bootstrap";
import { createQuestionLimiter } from "@/domains/workplace/shared/limiter";
import { DayPlanService } from "./service";
import { DayPlanStore } from "./store";
import { openDay } from "./test-support";

/**
 * A day you have clocked out of is finished.
 *
 * `finishCloseOut` carries the unfinished work forward, stamps `finishedAt`,
 * and calls `finalizeDay` — which folds the day into the streak exactly once,
 * because `applyDayToStreak` is guarded by `lastAssessedDate`.
 *
 * That guard is right, and it is what makes a later edit dangerous: marking
 * something done afterwards would change the PLAN and not the STREAK, so the
 * day on screen and the day that was counted would disagree permanently, with
 * nothing to say which was true. A streak whose past can be edited is not a
 * record of anything.
 */

const TODAY = "2026-08-08";
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

/** A committed day with one item still open, then clocked out. */
async function clockedOutDay() {
  const item = service.selectItem("james", TODAY, {
    label: "Module 4",
    estimateMinutes: 60,
    start: `${TODAY}T09:00:00Z`,
    end: `${TODAY}T10:00:00Z`,
  });
  service.commitPlan("james", TODAY);
  service.beginCloseOut("james", TODAY);
  service.finishCloseOut("james", TODAY);
  return item.item!.id;
}

describe("after clocking out, the day cannot be changed", () => {
  it("refuses to tick something off", async () => {
    const id = await clockedOutDay();
    await expect(service.tick("james", TODAY, id, { actualMinutes: 60 })).rejects.toThrow(
      /clocked out/i,
    );
  });

  it("refuses to drop an item", async () => {
    const id = await clockedOutDay();
    expect(() => service.dropItem("james", TODAY, id, "changed my mind")).toThrow(/clocked out/i);
  });

  it("refuses to add new work", async () => {
    await clockedOutDay();
    expect(() =>
      service.selectItem("james", TODAY, { label: "Sneaked in", estimateMinutes: 30 }),
    ).toThrow(/clocked out/i);
  });

  it("refuses to reorder it", async () => {
    const id = await clockedOutDay();
    expect(() => service.reorder("james", TODAY, [id])).toThrow(/clocked out/i);
  });

  it("refuses to carry something over again", async () => {
    const id = await clockedOutDay();
    expect(() => service.carryOverItem("james", TODAY, id)).toThrow(/clocked out/i);
  });

  it("refuses to record a miss reason", async () => {
    const id = await clockedOutDay();
    expect(() => service.recordMissReason("james", TODAY, id, "it grew")).toThrow(/clocked out/i);
  });

  it("names the day in the refusal, so it is obvious which one is closed", async () => {
    const id = await clockedOutDay();
    expect(() => service.dropItem("james", TODAY, id, "")).toThrow(new RegExp(TODAY));
  });
});

describe("what stays open after clocking out", () => {
  it("the day can still be READ", async () => {
    await clockedOutDay();
    // Reading is not editing. The dashboard, the close-out summary and the
    // history all have to keep working on a finished day.
    expect(() => service.dashboard("james", TODAY)).not.toThrow();
    expect(() => service.closeOutSummary("james", TODAY)).not.toThrow();
  });

  it("a NEW day is unaffected", async () => {
    await clockedOutDay();
    const tomorrow = "2026-08-09";
    await openDay(service, "james", tomorrow);
    // The guard is per day, not a latch on the person.
    expect(() =>
      service.selectItem("james", tomorrow, { label: "Fresh start", estimateMinutes: 45 }),
    ).not.toThrow();
  });

  it("a day still open is untouched by another day being closed", async () => {
    await clockedOutDay();
    const other = "2026-08-07";
    await openDay(service, "priya", other);
    expect(() =>
      service.selectItem("priya", other, { label: "Priya's work", estimateMinutes: 30 }),
    ).not.toThrow();
  });
});
