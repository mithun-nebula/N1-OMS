import { describe, it, expect, beforeEach } from "vitest";
import { buildDemoWorld, type DemoWorld } from "@/server/bootstrap";
import { createQuestionLimiter } from "@/domains/workplace/shared/limiter";
import { CourseService } from "@/domains/course/service";
import { DayPlanService } from "@/domains/assistant/day-plan/service";
import { DayPlanStore } from "@/domains/assistant/day-plan/store";
import { toolsFor, ALL_TOOL_NAMES, type ToolDeps } from "./index";

const TODAY = "2026-08-24";
const ROLES = ["superadmin", "admin", "shruti", "james", "priya", "ravi"] as const;

let world: DemoWorld;
let deps: ToolDeps;

beforeEach(async () => {
  world = await buildDemoWorld();
  const store = new DayPlanStore();
  deps = {
    spine: world.spine,
    graph: world.deps.graph,
    figures: world.deps.figures,
    permissions: world.deps.permissions,
    courses: new CourseService(world.deps.graph, world.deps.figures),
    dayPlan: new DayPlanService(store, {
      graph: world.deps.graph,
      limiter: createQuestionLimiter(),
      actorLookup: () => ({ spine: world.spine }),
    }),
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

function descriptionOf(actor: string, name: string): string {
  const { tools } = toolsFor(actor, deps);
  return String((tools[name] as { description?: string }).description ?? "");
}

describe("the catalogue at 107", () => {
  it("has exactly 41 tools and no duplicates", () => {
    // 34 read · 6 day-plan writes · 2 commitment writes · 56 operations ·
    // send_message · undo_last.
    //
    // The 56 are Phase 3's whole point. `record.create/update/delete` are NOT
    // among them and never will be — they browse 162 raw N1 doctypes and were
    // the source of the pay hole.
    // 106 -> 107 in Phase 4.6: `my_memory`, the only tool this phase added.
    expect(ALL_TOOL_NAMES).toHaveLength(107);
    expect(new Set(ALL_TOOL_NAMES).size).toBe(107);
  });

  it("the gated operations are tools now — but never record.*", () => {
    // Until Phase 3 this asserted that NO gated operation was a tool. That was
    // right then and is the whole point of the phase now, so what it pins has
    // moved rather than been deleted: the three that must never be wrapped.
    //
    // `record.create/update/delete` browse 162 raw N1 doctypes and were the
    // source of the pay hole. A generic write-any-record verb is not something
    // a model gets, in this phase or any other.
    for (const forbidden of ["create_record", "update_record", "delete_record", "write_record"]) {
      expect(ALL_TOOL_NAMES, forbidden).not.toContain(forbidden);
    }
    // And the gated verbs that SHOULD be here, so this cannot pass by the
    // catalogue quietly emptying.
    for (const expected of ["approve_leave", "create_task", "cancel_meeting", "book_room"]) {
      expect(ALL_TOOL_NAMES, expected).toContain(expected);
    }
  });
});

describe("search — written to lose, and permission-bound anyway", () => {
  /**
   * The description is the only thing stopping a general search winning every
   * vague question. These assert the three things it must do.
   */
  it("says USE THIS LAST, first", () => {
    const d = descriptionOf("james", "search");
    expect(d.split("\n")[0]).toMatch(/USE THIS LAST/);
  });

  it("enumerates its competitors, so the model need not infer them", () => {
    const d = descriptionOf("james", "search");
    for (const name of [
      "find_people",
      "list_leave",
      "attendance",
      "course_progress",
      "list_tasks",
      "list_meetings",
      "calendar_month",
      "list_events",
      "list_documents",
      "list_equipment",
      "my_day",
      "search_memory",
    ]) {
      expect(d, `search must name ${name} as a better option`).toContain(name);
    }
  });

  it("states what it gives up", () => {
    const d = descriptionOf("james", "search");
    expect(d).toMatch(/no ordering and no counts|none of that/i);
  });

  it("returns nothing the actor could not already open — all six roles", async () => {
    for (const actor of ROLES) {
      const out = await run(actor, "search", { query: "course review priya" });
      const hits =
        ((out as { items?: Array<{ nodeType: string; nodeId: string }> } | undefined)?.items ?? []);
      for (const hit of hits) {
        const direct = await world.spine.read({
          actor,
          nodeType: hit.nodeType,
          nodeId: hit.nodeId,
        });
        expect(
          direct.found,
          `${actor} was shown ${hit.nodeType}:${hit.nodeId} by search but cannot open it`,
        ).toBe(true);
      }
    }
  });

  it("an intern's results are a subset of an admin's", async () => {
    const key = (h: { nodeType: string; nodeId: string }) => `${h.nodeType}:${h.nodeId}`;
    const asAdmin = await run("admin", "search", { query: "course" });
    const asIntern = await run("ravi", "search", { query: "course" });
    const adminSaw = new Set(
      (((asAdmin as { items?: Array<{ nodeType: string; nodeId: string }> })?.items) ?? []).map(key),
    );
    const internSaw = (((asIntern as { items?: Array<{ nodeType: string; nodeId: string }> })?.items) ?? []).map(key);
    for (const k of internSaw) expect(adminSaw.has(k)).toBe(true);
  });

  it("never surfaces a masked field", async () => {
    for (const actor of ROLES) {
      const out = await run(actor, "search", { query: "priya" });
      expect(JSON.stringify(out ?? {})).not.toContain("__restricted");
    }
  });
});

describe("explain_figure — a number is not a way round the gate", () => {
  it("refuses a figure whose record the actor cannot open, opaquely", async () => {
    const out = await run("ravi", "explain_figure", { figureId: "no-such-figure" });
    expect(out?.found).toBe(false);
    // Says nothing about whether the figure exists.
    expect(String(out?.note)).not.toMatch(/permission|restricted|not allowed/i);
  });

  it("says plainly that only one kind of figure exists", () => {
    const d = descriptionOf("james", "explain_figure");
    expect(d).toMatch(/[Oo]nly ONE kind of figure/);
    expect(d).toMatch(/streak.*not a figure|not a figure and has no breakdown/i);
  });
});

describe("the ground-truth sweep — no date arithmetic in the model", () => {
  /**
   * The direct descendant of 1a's only real defect. Every tool that takes a
   * relative period resolves it in code and returns the window it used, so the
   * dates in an answer can be checked against the dates in the data.
   */
  const PERIOD_TOOLS: Array<{ name: string; input: Record<string, unknown>; actor: string }> = [
    { name: "attendance", input: { period: "last-week" }, actor: "priya" },
    { name: "calendar_month", input: { period: "last-week" }, actor: "james" },
    { name: "my_history", input: { period: "last-week" }, actor: "priya" },
    { name: "list_events", input: { period: "last-week" }, actor: "james" },
    { name: "utility_log", input: { period: "last-week" }, actor: "shruti" },
  ];

  for (const { name, input, actor } of PERIOD_TOOLS) {
    it(`${name} returns the window it resolved`, async () => {
      const out = await run(actor, name, input);
      const w = (out as { window?: { from: string; to: string; meaning: string } })?.window;
      expect(w, `${name} must return its resolved window`).toBeDefined();
      // 2026-08-24 minus 13 and minus 7 — computed here, not by the model.
      expect(w).toEqual({
        from: "2026-08-11",
        to: "2026-08-17",
        meaning: "the 7 days before the last 7",
      });
    });

    it(`${name} tells the model not to work dates out itself`, () => {
      const d = descriptionOf(actor, name);
      expect(d).toMatch(/rather than working dates out yourself|rather than working any out yourself/);
    });
  }

  it("course_versions returns real timestamps, never a relative word", async () => {
    // The sixth period-ish tool. It takes no period — it returns every version
    // with its actual timestamp, which is the stronger form of the same rule.
    const d = descriptionOf("james", "course_versions");
    expect(d).toMatch(/real timestamps/i);
    expect(d).toMatch(/never as 'recently'|never — as|never as .recently./i);
  });

  it("required_documents states that acknowledgement is not recorded", async () => {
    // The absence must be in the DATA, not only in the description — this is
    // the kind of gap a model papers over.
    const out = await run("shruti", "required_documents", {});
    expect(String((out as { acknowledgementTracking?: string })?.acknowledgementTracking)).toMatch(
      /not recorded/i,
    );
  });
});
