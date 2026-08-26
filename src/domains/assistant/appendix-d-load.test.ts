import { describe, it, expect, beforeEach } from "vitest";
import { readFileSync } from "node:fs";
import { buildDemoWorld, type DemoWorld } from "@/server/bootstrap";
import { createQuestionLimiter } from "@/domains/workplace/shared/limiter";
import { DayPlanService } from "./day-plan/service";
import { DayPlanStore } from "./day-plan/store";
import { openDay } from "./day-plan/test-support";
import { gatherBrief, plainBrief } from "./day-plan/chat-brief";
import { whatToAsk, allCandidates } from "./day-plan/scheduler";
import { enforceAppendixD, sanitizeForAppendixD } from "./appendix-d";
import { toolsFor, type ToolDeps } from "./tools";

/**
 * Appendix D, under the load Phase 2 puts on it.
 *
 * Phase 2 generates far more sentences about a person's work than Phase 1 did,
 * and every one passes `sanitizeForAppendixD`. The filter is a blunt keyword
 * denylist, so **false blocks are expected** — and 1b established what to do
 * about them: the field name `rankedOn` was echoed by the model, `/ranked/i`
 * caught it as a comparison, and a correct, well-hedged answer was replaced by
 * *"I can only comment on your work, not on you."* The fix was to rename the
 * field to `orderedBy`, **not** to loosen the pattern.
 *
 * So this file sweeps every sentence this phase can generate. When one is
 * blocked wrongly, the wording changes and `appendix-d.ts` does not.
 */

const TODAY = "2026-08-08";

let world: DemoWorld;
let store: DayPlanStore;
let service: DayPlanService;
let deps: ToolDeps;

beforeEach(async () => {
  world = await buildDemoWorld();
  store = new DayPlanStore();
  service = new DayPlanService(store, {
    graph: world.deps.graph,
    limiter: createQuestionLimiter(),
    actorLookup: () => ({ spine: world.spine }),
  });
  deps = {
    spine: world.spine,
    graph: world.deps.graph,
    figures: world.deps.figures,
    permissions: world.deps.permissions,
    courses: new (await import("@/domains/course/service")).CourseService(
      world.deps.graph,
      world.deps.figures,
    ),
    dayPlan: service,
    today: () => TODAY,
  };
  await openDay(service, "james", TODAY);
});

/** Assert a line survives the filter, and say which pattern caught it if not. */
function passes(line: string, where: string) {
  const check = enforceAppendixD(line);
  expect(
    check.ok,
    `BLOCKED (${check.kind}) in ${where}:\n  "${line}"\n  ${check.reason ?? ""}`,
  ).toBe(true);
}

describe("the filter is not weakened", () => {
  it("appendix-d.ts is unmodified — the patterns are exactly as they were", () => {
    const src = readFileSync("src/domains/assistant/appendix-d.ts", "utf8");
    // The three person patterns and the comparison patterns 1b ran into.
    expect(src).toContain("/\\byou (always|never|tend to|seem to)\\b/i");
    expect(src).toContain("/\\btake a break/i");
    expect(src).toContain("/\\branked\\b/i");
    expect(src).toContain("/\\bcompared (to|with) /i");
  });

  it("still blocks what it is for", () => {
    for (const bad of [
      "You tend to procrastinate in the afternoons.",
      "You should take a break.",
      "You are behind compared to Priya.",
      "Arun is faster than you.",
    ]) {
      expect(enforceAppendixD(bad).ok, bad).toBe(false);
    }
  });

  /**
   * Phase 2.5 Part B, option A: the time-of-day pattern is scoped to the
   * surfaces it was written for. The full reasoning is in the header of
   * `appendix-d.ts`. What must be true either way:
   *   - no pattern was loosened, narrowed or reworded;
   *   - a coaching surface still blocks the judgement sentence;
   *   - a scheduling proposal naming a diary fact passes.
   */
  it("the time-of-day pattern still exists, unmodified", () => {
    const src = readFileSync("src/domains/assistant/appendix-d.ts", "utf8");
    expect(src).toContain("/\\bin the (afternoon|morning|evening) you\\b/i");
  });

  it("coaching still blocks the judgement, on both wordings", () => {
    for (const bad of [
      "In the afternoon you work more slowly.",
      "In the morning you are at your best.",
      "In the afternoon you get distracted.",
    ]) {
      expect(enforceAppendixD(bad, "coaching").ok, bad).toBe(false);
      expect(sanitizeForAppendixD(bad, "coaching")).toBe(
        "I can only comment on your work, not on you.",
      );
    }
  });

  it("a scheduling proposal naming a diary fact passes", () => {
    for (const good of [
      "In the morning you have a free hour — shall I move Module 4 there?",
      "In the afternoon you have the review, so this would have to be tomorrow.",
      "In the evening you have nothing booked.",
    ]) {
      // Destroyed on the coaching surface — which is exactly the category
      // error that made this decision necessary.
      expect(enforceAppendixD(good, "coaching").ok, good).toBe(false);
      expect(enforceAppendixD(good, "scheduling").ok, good).toBe(true);
    }
  });

  it("scheduling does NOT become a way round appendix D", () => {
    // The sentence the scoped pattern was written for is still blocked on the
    // scheduling surface, by the patterns that name the judgement itself.
    for (const bad of [
      "In the afternoon you work more slowly.",
      "In the afternoon you get distracted.",
      "You tend to leave it late.",
      "Your pace has dropped.",
      "You are behind compared to Priya.",
      "Arun is faster than you.",
      "You should take a break.",
    ]) {
      expect(enforceAppendixD(bad, "scheduling").ok, bad).toBe(false);
    }
  });

  it("the strict set is the DEFAULT — loosening has to be asked for by name", () => {
    const proposal = "In the morning you have a free hour.";
    // No second argument means coaching, which blocks it. A call site that says
    // nothing cannot accidentally get the weaker set.
    expect(enforceAppendixD(proposal).ok).toBe(false);
    expect(enforceAppendixD(proposal, "scheduling").ok).toBe(true);
  });
});

describe("every sentence the brief can generate", () => {
  it("a plain brief with overdue work, meetings and commitments passes", async () => {
    // Two days of unfinished work, so the overdue wording is exercised.
    await openDay(service, "james", "2026-08-06");
    service.selectItem("james", "2026-08-06", { label: "Module 4", estimateMinutes: 60 });
    service.commitPlan("james", "2026-08-06");
    await openDay(service, "james", "2026-08-07");
    service.selectItem("james", "2026-08-07", { label: "Module 4", estimateMinutes: 60 });
    service.commitPlan("james", "2026-08-07");

    const ctx = await gatherBrief(service, "james", TODAY, {
      commitments: [
        { id: "c1", what: "the Priya review", dueDate: TODAY },
        { id: "c2", what: "the induction deck", dueDate: "2026-08-05" },
      ],
    });
    const text = plainBrief(ctx);
    expect(text).toContain("days overdue");
    for (const line of text.split("\n")) passes(line, "plain brief");
    // And as a whole, since the filter runs on the whole answer.
    passes(text, "plain brief (whole)");
  });

  it("an interrupted item's wording passes — A3 and appendix D agree here", async () => {
    await openDay(service, "james", "2026-08-07");
    service.selectItem("james", "2026-08-07", {
      label: "Module 4",
      estimateMinutes: 60,
      start: "2026-08-07T11:00:00Z",
      end: "2026-08-07T12:00:00Z",
    });
    service.commitPlan("james", "2026-08-07");
    service.arriveDuringDay("james", "2026-08-07", {
      id: "m1",
      title: "Review",
      start: "2026-08-07T11:00:00Z",
      end: "2026-08-07T12:00:00Z",
    });
    const ctx = await gatherBrief(service, "james", TODAY);
    const text = plainBrief(ctx);
    expect(text).toMatch(/interrupted/);
    passes(text, "interrupted brief");
  });

  it("an empty day's brief passes", async () => {
    const ctx = await gatherBrief(service, "james", TODAY);
    passes(plainBrief(ctx), "empty brief");
  });
});

describe("every question the scheduler can ask", () => {
  it("all three kinds pass the filter", async () => {
    const item = service.selectItem("james", TODAY, {
      label: "Module 4",
      estimateMinutes: 60,
      ref: { nodeType: "task", nodeId: "task-2" },
      start: `${TODAY}T09:00:00Z`,
      end: `${TODAY}T10:00:00Z`,
    });
    service.commitPlan("james", TODAY);
    await service.tick("james", TODAY, item.item!.id, { actualMinutes: 180 });

    const candidates = allCandidates({
      plan: store.get("james", TODAY)!,
      now: `${TODAY}T17:00:00Z`,
      allowanceLeft: 6,
      alreadyAsked: new Set(),
      learned: { "task:task-2": 180 },
      commitmentsDue: [{ id: "c1", what: "the Priya review", dueDate: TODAY }],
    });
    expect(candidates.length).toBeGreaterThanOrEqual(2);
    for (const c of candidates) {
      passes(c.question, `scheduler ${c.kind}`);
      passes(c.changes, `scheduler ${c.kind} (rationale)`);
    }
  });

  it("the coaching offer is a question, never an instruction about the person", () => {
    const decision = whatToAsk({
      plan: store.get("james", TODAY)!,
      now: `${TODAY}T17:00:00Z`,
      allowanceLeft: 6,
      alreadyAsked: new Set(),
      commitmentsDue: [{ id: "c1", what: "the Priya review", dueDate: TODAY }],
    });
    const q = decision.ask?.question ?? "";
    passes(q, "commitment chase");
    // "You should…" is the shape appendix D exists to stop.
    expect(q).not.toMatch(/you should/i);
  });
});

describe("every read-back a write tool can produce", () => {
  it("the wording each tool tells the model to use passes the filter", async () => {
    const { tools } = toolsFor("james", deps);
    for (const name of ["drop_item", "carry_over", "close_out", "select_item", "mark_done"]) {
      const description = String((tools[name] as { description?: string }).description);
      // The descriptions carry the sentences the model is steered towards, so
      // a phrase that would be blocked on the way out is worth catching here.
      for (const line of description.split("\n")) {
        if (line.trim().length === 0) continue;
        passes(line, `${name} description`);
      }
    }
  });

  it("the carry-over wording does not claim the day is clean", async () => {
    const { tools } = toolsFor("james", deps);
    const execute = tools.carry_over.execute as (i: unknown, o: unknown) => Promise<unknown>;
    const item = service.selectItem("james", TODAY, { label: "Module 4", estimateMinutes: 60 });
    const out = (await execute(
      { itemId: item.item!.id },
      { toolCallId: "t", messages: [] },
    )) as { untrusted_record_data: Record<string, unknown> };
    const data = out.untrusted_record_data;
    expect(data.dayStillCounted).toBe(false);
    passes(String(data.streakEffect), "carry_over streakEffect");
    passes(String(data.note), "carry_over note");
  });
});

describe("nothing applies a learned estimate silently", () => {
  /**
   * The one number in the day plan the person owns. Changing it silently takes
   * that away, and people stop trusting numbers they did not set. The system
   * knows the count, not the cause — it knows Module 4 took three hours; it
   * does not know you were interrupted twice and it will take one next time.
   */
  it("no code path writes estimateMinutes from a learned figure", () => {
    const service_src = readFileSync("src/domains/assistant/day-plan/service.ts", "utf8");
    const scheduler_src = readFileSync("src/domains/assistant/day-plan/scheduler.ts", "utf8");
    const write_src = readFileSync("src/domains/assistant/tools/day-write.ts", "utf8");
    for (const src of [service_src, scheduler_src, write_src]) {
      // An assignment of a learned value onto an estimate is the thing that
      // must not exist. Reading one to OFFER it is fine and is what happens.
      expect(src).not.toMatch(/estimateMinutes\s*=\s*.*learned/i);
      expect(src).not.toMatch(/learnedAdjustment\([^)]*\)\s*\)?\s*;?\s*\n?\s*.*estimateMinutes\s*=/i);
    }
  });

  it("the learned figure is offered as a question, not applied", async () => {
    const item = service.selectItem("james", TODAY, {
      label: "Module 4",
      estimateMinutes: 60,
      ref: { nodeType: "task", nodeId: "task-2" },
    });
    await service.tick("james", TODAY, item.item!.id, { actualMinutes: 60 });
    const before = store.get("james", TODAY)!.plan[0].estimateMinutes;

    const decision = whatToAsk({
      plan: store.get("james", TODAY)!,
      now: `${TODAY}T17:00:00Z`,
      allowanceLeft: 6,
      alreadyAsked: new Set(),
      learned: { "task:task-2": 180 },
    });
    expect(decision.ask?.kind).toBe("estimate-offer");
    expect(decision.ask?.question).toMatch(/\?$/);
    // And deciding to offer it changed nothing.
    expect(store.get("james", TODAY)!.plan[0].estimateMinutes).toBe(before);
  });
});

describe("classifyMiss still owns the verdict", () => {
  it("the model's reading of a free-text reason does not overwrite miss.kind", async () => {
    const item = service.selectItem("james", TODAY, {
      label: "Module 4",
      estimateMinutes: 60,
      start: `${TODAY}T09:00:00Z`,
      end: `${TODAY}T10:00:00Z`,
    });
    service.commitPlan("james", TODAY);
    await service.tick("james", TODAY, item.item!.id, { actualMinutes: 180 });
    const before = store.get("james", TODAY)!.plan[0].miss?.kind;
    expect(before).toBe("ran-over");

    // A reason that reads like an interruption. The verdict does not move —
    // `classifyMiss` decided from the meeting calendar, and a model that
    // re-decides would contradict the streak.
    service.recordMissReason("james", TODAY, item.item!.id, "the client call ran long");
    expect(store.get("james", TODAY)!.plan[0].miss?.kind).toBe("ran-over");
    expect(store.get("james", TODAY)!.plan[0].miss?.reason).toBe("the client call ran long");
  });
});

describe("a blocked sentence is replaced, not leaked", () => {
  it("sanitize returns the refusal rather than the offending text", () => {
    const out = sanitizeForAppendixD("You tend to procrastinate.");
    expect(out).not.toContain("procrastinate");
    expect(out).toBe("I can only comment on your work, not on you.");
  });
});
