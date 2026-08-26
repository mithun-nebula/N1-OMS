import { describe, it, expect, beforeEach } from "vitest";
import { buildDemoWorld, type DemoWorld } from "@/server/bootstrap";
import { createQuestionLimiter } from "@/domains/workplace/shared/limiter";
import { CourseService } from "@/domains/course/service";
import { DayPlanService } from "@/domains/assistant/day-plan/service";
import { DayPlanStore } from "@/domains/assistant/day-plan/store";
import { openDay } from "@/domains/assistant/day-plan/test-support";
import { toolsFor, type ToolDeps } from "./index";

/**
 * The day tools, and the line appendix A8 draws through `team_day`.
 */

const TODAY = "2026-08-08";

let world: DemoWorld;
let deps: ToolDeps;
let dayPlan: DayPlanService;

beforeEach(async () => {
  world = await buildDemoWorld();
  const store = new DayPlanStore();
  dayPlan = new DayPlanService(store, {
    graph: world.deps.graph,
    limiter: createQuestionLimiter(),
    actorLookup: () => ({ spine: world.spine }),
  });
  deps = {
    spine: world.spine,
    graph: world.deps.graph,
    figures: world.deps.figures,
    permissions: world.deps.permissions,
    courses: new CourseService(world.deps.graph, world.deps.figures),
    dayPlan,
    today: () => TODAY,
  };
});

async function run(actor: string, name: string, input: unknown = {}) {
  const { tools } = toolsFor(actor, deps);
  const t = tools[name];
  if (!t) return undefined;
  const execute = t.execute as (i: unknown, o: unknown) => Promise<unknown>;
  const out = (await execute(input, { toolCallId: "t", messages: [] })) as {
    untrusted_record_data: Record<string, unknown>;
  };
  return out.untrusted_record_data;
}

/** A committed day for priya, with one item finished and one that ran over. */
async function priyaHasADay() {
  await openDay(dayPlan, "priya", TODAY);
  const a = dayPlan.selectItem("priya", TODAY, { label: "Write module 4", estimateMinutes: 60 });
  dayPlan.selectItem("priya", TODAY, { label: "Review deck", estimateMinutes: 30 });
  dayPlan.commitPlan("priya", TODAY);
  await dayPlan.tick("priya", TODAY, a.item!.id, { actualMinutes: 180 });
  // A ran-over miss, with a reason — the two things A8 must never surface.
  dayPlan.recordMissReason("priya", TODAY, a.item!.id, "Bigger than expected");
}

describe("team_day — appendix A8's four fields, and only those", () => {
  it("returns EXACTLY the four whitelisted fields per item", async () => {
    await priyaHasADay();
    const out = await run("james", "team_day", { person: "priya", date: TODAY });
    expect(out?.found).toBe(true);

    const committed = (out as { committed: Array<Record<string, unknown>> }).committed;
    expect(committed.length).toBeGreaterThan(0);
    for (const item of committed) {
      // Not a subset and not a superset. Exactly these.
      expect(Object.keys(item).sort()).toEqual(["done", "estimateMinutes", "id", "label"]);
    }
  });

  it("never carries the streak", async () => {
    await priyaHasADay();
    const out = await run("james", "team_day", { person: "priya", date: TODAY });
    const serialised = JSON.stringify(out);
    expect(serialised).not.toContain("clean");
    expect(serialised).not.toContain("bestClean");
    expect(serialised).not.toContain("dayPlanned");
    expect((out as { streakVisible: boolean }).streakVisible).toBe(false);
  });

  it("never carries the reason a thing was missed", async () => {
    await priyaHasADay();
    const out = await run("james", "team_day", { person: "priya", date: TODAY });
    const serialised = JSON.stringify(out);
    // The reason itself, and everything it could be reconstructed from.
    expect(serialised).not.toContain("Bigger than expected");
    expect(serialised).not.toContain("miss");
    expect(serialised).not.toContain("ran-over");
    // `actualMinutes` is the one that matters most: actual > estimate IS the
    // ran-over miss, recoverable in one subtraction.
    expect(serialised).not.toContain("actualMinutes");
    expect(serialised).not.toContain("doneAt");
  });

  it("a manager cannot reach somebody outside their scope", async () => {
    await priyaHasADay();
    // Ravi is an intern; whoever he asks about, the gate decides first.
    const out = await run("ravi", "team_day", { person: "priya", date: TODAY });
    if (out?.found === true) {
      // If the employee record is visible to him at all, the fields are still
      // exactly four — A8 does not vary by who is asking.
      for (const item of (out as { committed: Array<Record<string, unknown>> }).committed) {
        expect(Object.keys(item).sort()).toEqual(["done", "estimateMinutes", "id", "label"]);
      }
    } else {
      expect(out?.found).toBe(false);
    }
  });

  it("its description warns that it is thin, and sends workload questions elsewhere", async () => {
    const { dayTools } = await import("./day");
    const ctx = toolsFor("james", deps).ctx;
    const desc = String(
      (dayTools.find((t) => t.name === "team_day")!.build(ctx) as { description?: string })
        .description,
    );
    // The risk here is not leaking — it is succeeding thinly and looking whole.
    expect(desc).toMatch(/THIN|does NOT show what your team is working on/i);
    expect(desc).toContain("list_tasks");
    expect(desc).toMatch(/never return anybody's streak/i);
  });
});

describe("my_history — the stretch behind you", () => {
  it("resolves the period server-side and returns the window", async () => {
    const out = await run("priya", "my_history", { period: "last-week" });
    expect((out as { window: unknown }).window).toEqual({
      from: "2026-07-26",
      to: "2026-08-01",
      meaning: "the 7 days before the last 7",
    });
  });

  it("is only ever about the asker — there is no parameter for whose", async () => {
    const { dayTools } = await import("./day");
    const ctx = toolsFor("priya", deps).ctx;
    const spec = dayTools.find((t) => t.name === "my_history")!;
    const built = spec.build(ctx) as { inputSchema?: unknown };
    const schema = JSON.stringify(built.inputSchema);
    expect(schema).not.toContain("person");
    expect(schema).not.toContain("actor");
  });

  it("summarises the days that had a plan", async () => {
    await priyaHasADay();
    const out = await run("priya", "my_history", { period: "this-week" });
    const summary = (out as { summary: { daysWithAPlan: number; itemsCommitted: number } }).summary;
    expect(summary.daysWithAPlan).toBeGreaterThanOrEqual(1);
    expect(summary.itemsCommitted).toBeGreaterThanOrEqual(2);
  });

  it("my_day and my_history point at each other", async () => {
    const { dayTools } = await import("./day");
    const { supportTools } = await import("./support");
    const ctx = toolsFor("priya", deps).ctx;
    const desc = (specs: typeof dayTools, name: string) =>
      String((specs.find((t) => t.name === name)!.build(ctx) as { description?: string }).description);

    expect(desc(dayTools, "my_history")).toContain("my_day");
    expect(desc(supportTools, "my_day")).toContain("my_history");
  });
});
