import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { z } from "zod";
import { buildDemoWorld, type DemoWorld } from "@/server/bootstrap";
import { resetProviders } from "@/config/providers";
import { resetEnvCache } from "@/config/env";
import { resetFakeLlm } from "@/config/llm-fake";
import { createQuestionLimiter } from "@/domains/workplace/shared/limiter";
import { CourseService } from "@/domains/course/service";
import { CommitmentStore } from "@/domains/assistant/commitments/store";
import { DayPlanService } from "@/domains/assistant/day-plan/service";
import { DayPlanStore } from "@/domains/assistant/day-plan/store";
import { openDay } from "@/domains/assistant/day-plan/test-support";
import { ToolContext, type ToolDeps } from "./context";
import { ALL_TOOLS, type ToolSpec } from "./index";
import { dayWriteTools } from "./day-write";
import { commitmentTools } from "./commitment-write";
import { writeTools } from "./write";
import { resetTokenBudget } from "../token-budget";
import { resetConfirmations } from "./confirmation";

/**
 * Every write tool's ids must be obtainable from a read tool.
 *
 * ── Why this exists, and what it costs not to have it ───────────────────────
 *
 * In Phase 2, `my_day` did not return item ids, so `mark_done` and `drop_item`
 * had nothing to reference. The model guessed, and answered *"I could not find
 * Module 4 on your plan"* for an item plainly on the plan.
 *
 * **Found by running a real day. Not by any test.**
 *
 * At fifty-nine operations that failure mode is not an error — it is a
 * confident wrong answer about a record that plainly exists, and it is
 * invisible from the inside. Discovering it once cost an afternoon. Discovering
 * it fifty-nine times is a phase.
 *
 * Precedent: Phase 1b's test that every tool belongs to exactly one specialist
 * domain, that none is orphaned, and that no domain names a tool that does not
 * exist. Same idea, applied to the read→write seam.
 *
 * ── How the pairing is judged ───────────────────────────────────────────────
 *
 * Not by matching field names, which would be a test of spelling. Every read
 * tool is **actually executed** against a seeded world, and its real output is
 * searched for an id belonging to the same kind of thing:
 *
 *   `itemId`       -> `my_day` returns `items: [{ id, ... }]`
 *   `taskId`       -> `list_tasks` returns `items: [{ id: "task-1", ... }]`
 *   `commitmentId` -> something must return commitments with ids
 *
 * A write field `<thing>Id` counts as paired when ANY of these holds:
 *
 *   a. some read tool returns a field spelled exactly `<thing>Id`;
 *   b. some read tool returns a collection named after the thing;
 *   c. a read tool NAMED for the thing exists at all.
 *
 * ── Why (c) does not check that it returned rows ────────────────────────────
 *
 * The first version of this rule required the named tool to actually return
 * id-bearing rows when called. Run over Phase 3's full catalogue that produced
 * seventeen "gaps" that were nothing of the kind: `list_meetings` returned
 * nothing because the probing actor could not see the seeded meeting, and
 * `list_leave` returned nothing for the same reason.
 *
 * **A verdict that depends on who is probing and what happens to be seeded is
 * not a verdict about pairing.** The question this test exists to answer is
 * "can the model obtain this id at all", and the existence of `list_meetings`
 * is the answer for `meetingId`. Whether a *particular* world has a meeting in
 * it is a different question, and `my_day`'s own test already covers the shape
 * of what a read returns.
 *
 * It still bites where it matters. Run over Phase 3 it found that
 * `approve_expense` and `decline_expense` take a `claimId` and **no expense
 * read tool existed at all** — the exact Phase 2 failure at scale. That is what
 * `list_expenses` was written for.
 */

const TODAY = "2026-08-08";

/**
 * The tools that change something.
 *
 * Named explicitly rather than sniffed, for the reason 1b's domain test is
 * written the same way: a heuristic that decides what counts as a write would
 * itself become the thing that is wrong. A new write tool that is not in one of
 * these arrays is not covered — and it will be in one of them, because that is
 * how it gets into `ALL_TOOLS`.
 */
const WRITE_TOOLS: readonly ToolSpec[] = [
  ...dayWriteTools,
  ...commitmentTools,
  // Phase 3: the 56 operations, plus send_message, undo_last and
  // approve_proposal. This is where the test earns its keep — most of the 56
  // take a record id, and a write whose id no read tool produces is a
  // confident wrong answer waiting to happen.
  ...writeTools,
];

const READ_TOOLS: readonly ToolSpec[] = ALL_TOOLS.filter(
  (t) => !WRITE_TOOLS.some((w) => w.name === t.name),
);

let world: DemoWorld;
let deps: ToolDeps;
let dayPlan: DayPlanService;

beforeEach(async () => {
  process.env.ORG_LLM_PROVIDER = "fake";
  resetEnvCache();
  resetProviders();
  resetFakeLlm();
  resetTokenBudget();
  resetConfirmations();
  world = await buildDemoWorld();
  dayPlan = new DayPlanService(new DayPlanStore(), {
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
    commitments: await CommitmentStore.create(),
    dayPlan,
    today: () => TODAY,
  };
});

afterEach(() => {
  delete process.env.ORG_LLM_PROVIDER;
  resetEnvCache();
  resetProviders();
  resetFakeLlm();
  resetConfirmations();
});

/** The id-shaped fields a tool takes, read straight out of its `inputSchema`. */
function idFieldsOf(spec: ToolSpec): string[] {
  const ctx = new ToolContext("james", deps);
  const built = spec.build(ctx) as { inputSchema?: unknown };
  const schema = built.inputSchema;
  if (!(schema instanceof z.ZodObject)) return [];
  return Object.keys(schema.shape as Record<string, unknown>).filter((k) =>
    /Id$|Ids$|^id$/.test(k),
  );
}

/** Every key name anywhere in a value, however deeply nested. */
function keysIn(value: unknown, into: Set<string> = new Set()): Set<string> {
  if (Array.isArray(value)) {
    for (const v of value) keysIn(v, into);
  } else if (value && typeof value === "object") {
    for (const [k, v] of Object.entries(value)) {
      into.add(k);
      keysIn(v, into);
    }
  }
  return into;
}

/**
 * Collections whose members carry an `id` — `{ items: [{ id }] }` yields
 * `"items"`. That is how `itemId` is satisfied without anything being spelled
 * `itemId` anywhere.
 */
function idBearingCollections(value: unknown, into: Set<string> = new Set()): Set<string> {
  if (Array.isArray(value)) {
    for (const v of value) idBearingCollections(v, into);
  } else if (value && typeof value === "object") {
    for (const [k, v] of Object.entries(value)) {
      const members = Array.isArray(v) ? v : [v];
      if (
        members.some(
          (m) => m && typeof m === "object" && !Array.isArray(m) && "id" in (m as object),
        )
      ) {
        into.add(k);
      }
      idBearingCollections(v, into);
    }
  }
  return into;
}

/** Run a read tool with no arguments and hand back whatever it returned. */
async function readOutput(spec: ToolSpec, actor: string): Promise<unknown> {
  const ctx = new ToolContext(actor, deps);
  const built = spec.build(ctx) as {
    execute?: (i: unknown, o: unknown) => Promise<unknown>;
  };
  if (!built.execute) return undefined;
  try {
    const out = await built.execute({}, { toolCallId: "t", messages: [] });
    return out;
  } catch {
    // A tool that needs an argument it was not given proves nothing either way.
    return undefined;
  }
}

/** `itemId` -> `item`, `commitmentId` -> `commitment`. */
function thingOf(field: string): string {
  return field.replace(/Ids?$/, "").toLowerCase();
}

/**
 * Where the record is called one thing and the tool that lists it another.
 *
 * Kept short and explicit on purpose. Every entry is a place a human would have
 * to know the same fact, and writing it down here is cheaper than a model
 * guessing it — `claimId` comes from `list_expenses`, and nothing about the
 * word "claim" says so.
 */
const READS_FOR: Record<string, readonly string[]> = {
  employee: ["find_people", "get_person"],
  manager: ["find_people", "get_person"],
  department: ["find_people", "get_person"],
  designation: ["find_people", "get_person"],
  claim: ["list_expenses"],
  entry: ["calendar_month"],
  step: ["joining_status"],
  handover: ["handover_status"],
  action: ["get_meeting"],
  booking: ["room_availability"],
  module: ["get_course"],
  version: ["course_versions"],
  project: ["list_tasks"],
  equipment: ["list_equipment"],
  activity: ["explain_figure"],
  proposal: ["__issued_by_the_server__"],
};

/**
 * Id fields that are NOT lookups, and why.
 *
 * A `create_*` tool naming the thing it is about to create is asking the person
 * to choose an id, not to find one. Treating that as a missing read would push
 * towards inventing a read tool for records that do not exist yet.
 */
const NOT_A_LOOKUP = new Set([
  "create_employee.employeeId",
  // The server issues this and hands it back; there is deliberately no read
  // tool for it, because a model that could LIST proposals could hunt for one
  // to approve.
  "approve_proposal.proposalId",
  "discard_proposal.proposalId",
  // `undo_last` takes the activity id the earlier tool returned in its own
  // result. That is the pairing, and it is a stronger one than a read tool.
  "undo_last.activityId",
  // POLYMORPHIC. `nodeId` is whatever `nodeType` beside it says — an employee,
  // a course, a meeting. Its pairing is not one read tool but whichever one
  // matches the type, so a fixed answer here would be a wrong one. Both
  // descriptions say so in as many words instead.
  "store_document.nodeId",
  "require_document.nodeId",
]);

describe("every write tool's ids are supplied by a read tool", () => {
  it("covers every write tool, and finds an id field on the ones that take one", () => {
    // If this drifts, the test below is quietly checking nothing.
    // 9 day-plan writes + 59 Phase 3 write tools. The 9th is `report_status`,
    // whose `itemId` comes from `my_day` like every other day write — which is
    // exactly what the rest of this test then proves.
    expect(WRITE_TOOLS).toHaveLength(69);
    for (const named of [
      "carry_over",
      "close_out",
      "drop_item",
      "settle_commitment",
      "approve_leave",
      "cancel_meeting",
      "create_task",
      "undo_last",
    ]) {
      expect(WRITE_TOOLS.map((t) => t.name)).toContain(named);
    }
    // Most of them take an id. If this collapses, the test below is checking
    // almost nothing.
    const withIds = WRITE_TOOLS.filter((t) => idFieldsOf(t).length > 0);
    expect(withIds.length).toBeGreaterThan(30);
  });

  it("some read tool returns every id a write tool asks for", async () => {
    // A seeded day, so `my_day` has something to return. A read tool that
    // returns nothing because the world is empty would pass this test for the
    // wrong reason.
    await openDay(dayPlan, "james", TODAY);
    const service = dayPlan;
    service.selectItem("james", TODAY, { label: "Module 4", estimateMinutes: 60 });
    service.commitPlan("james", TODAY);
    await deps.commitments!.record({
      actor: "james",
      what: "the Priya review",
      dueDate: "2026-08-09",
    });

    const names = new Set<string>();
    const collections = new Set<string>();
    // Probed as superadmin: a tool returning nothing because THIS actor cannot
    // see the seeded record says nothing about whether the pairing exists.
    for (const spec of READ_TOOLS) {
      const out = await readOutput(spec, "superadmin");
      for (const k of keysIn(out)) names.add(k);
      for (const c of idBearingCollections(out)) collections.add(c);
    }
    const readNames = READ_TOOLS.map((t) => t.name.toLowerCase());

    const gaps: string[] = [];
    for (const spec of WRITE_TOOLS) {
      for (const field of idFieldsOf(spec)) {
        if (NOT_A_LOOKUP.has(`${spec.name}.${field}`)) continue;
        const thing = thingOf(field);
        const exactly = names.has(field);
        const viaCollection = [...collections].some((c) => c.toLowerCase().startsWith(thing));
        const viaNamedTool = readNames.some((n) => n.includes(thing));
        const viaSynonym = (READS_FOR[thing] ?? []).some((n) => readNames.includes(n));
        if (!exactly && !viaCollection && !viaNamedTool && !viaSynonym) {
          gaps.push(`${spec.name}.${field} — no read tool returns an id for "${thing}"`);
        }
      }
    }

    expect(
      gaps,
      `A write tool takes an id that no read tool produces. The model cannot succeed:\n  ${gaps.join(
        "\n  ",
      )}`,
    ).toEqual([]);
  });

  it("the test would notice if my_day stopped returning ids — the Phase 2 bug", async () => {
    // Proving the test bites, on the exact regression it exists to catch.
    await openDay(dayPlan, "james", TODAY);
    dayPlan.selectItem("james", TODAY, { label: "Module 4", estimateMinutes: 60 });
    dayPlan.commitPlan("james", TODAY);

    const myDay = READ_TOOLS.find((t) => t.name === "my_day")!;
    const out = await readOutput(myDay, "james");
    const collections = idBearingCollections(out);
    // `items: [{ id, ... }]` is what makes drop_item / mark_done / carry_over
    // usable at all. Strip the id and this set no longer contains "items".
    expect([...collections]).toContain("items");
  });
});
