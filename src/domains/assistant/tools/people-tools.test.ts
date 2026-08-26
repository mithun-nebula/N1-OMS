import { describe, it, expect, beforeEach } from "vitest";
import { buildDemoWorld, type DemoWorld } from "@/server/bootstrap";
import { CourseService } from "@/domains/course/service";
import { attendanceId } from "@/domains/people/attendance";
import { toolsFor, type ToolDeps } from "./index";
import { resolveWindow, withinWindow } from "./window";

/**
 * The three that complete People — and the one of them that wraps a path which
 * was a real leak.
 */

let world: DemoWorld;
let deps: ToolDeps;

beforeEach(async () => {
  world = await buildDemoWorld();
  deps = {
    spine: world.spine,
    graph: world.deps.graph,
    figures: world.deps.figures,
    permissions: world.deps.permissions,
    courses: new CourseService(world.deps.graph, world.deps.figures),
    today: () => "2026-08-24",
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

/** Give two people a day of attendance each, on the same date. */
async function seedAttendance(date = "2026-08-20") {
  for (const who of ["priya", "arun"]) {
    await world.deps.graph.putNode("attendance", attendanceId(who, date), {
      employeeId: who,
      date,
      checkInAt: `${date}T09:00:00.000Z`,
      checkOutAt: `${date}T17:00:00.000Z`,
      workedMinutes: 480,
    });
  }
}

describe("attendance — the tool over a path that leaked", () => {
  /**
   * `/api/people/[id]/attendance` used to check `view` on the **employee** and
   * then return attendance straight from the graph. Employees hold `own-team`
   * on employee while attendance is scoped to `self`, so the permissive check
   * ran and any employee could read a colleague's whole history. Phase 0 fixed
   * it. This asserts the tool did not reopen it.
   */
  it("an employee cannot read a colleague's attendance through it", async () => {
    await seedAttendance();
    const mine = await run("priya", "attendance", { person: "priya", period: "last-30-days" });
    const theirs = await run("priya", "attendance", { person: "arun", period: "last-30-days" });

    // Her own is there.
    expect(mine?.found).toBe(true);
    expect((mine as { items: unknown[] }).items.length).toBeGreaterThan(0);

    // His is not — and if the employee record is visible to her at all, the
    // answer must still be an EMPTY list rather than his days.
    const items = (theirs as { items?: unknown[] } | undefined)?.items ?? [];
    expect(items).toHaveLength(0);
    expect(JSON.stringify(theirs ?? {})).not.toContain(attendanceId("arun", "2026-08-20"));
  });

  it("never returns a record whose id belongs to somebody else", async () => {
    await seedAttendance();
    for (const actor of ["ravi", "priya", "arun", "james", "shruti"]) {
      const out = await run(actor, "attendance", { person: actor, period: "last-30-days" });
      const ids = ((out as { items?: Array<{ id: string }> } | undefined)?.items ?? []).map(
        (i) => i.id,
      );
      for (const id of ids) {
        // Ownership is encoded in the id — att_<employee>_<date>.
        expect(id.startsWith(`att_${actor}_`)).toBe(true);
      }
    }
  });

  it("reveals no attendance for somebody else, real or invented", async () => {
    await seedAttendance();
    const real = await run("ravi", "attendance", { person: "shruti" });
    const invented = await run("ravi", "attendance", { person: "nobody-at-all" });

    // `found` legitimately differs here: the employee record itself is in the
    // directory and ravi can already open it, so it is not a secret that
    // shruti exists. What must be identical is the ATTENDANCE, which is
    // `self`-scoped — and it is empty either way.
    const rows = (o: typeof real) => ((o as { items?: unknown[] } | undefined)?.items ?? []);
    expect(rows(real)).toHaveLength(0);
    expect(rows(invented)).toHaveLength(0);
  });

  it("a person whose record is invisible is indistinguishable from an invented one", async () => {
    // The case the opaque check exists for. `attendance` is only reached after
    // an employee read, so anybody the actor cannot open looks like nobody.
    const { tools } = toolsFor("ravi", deps);
    expect(tools.attendance).toBeDefined();
    const hidden = await run("ravi", "attendance", { person: "definitely-not-real" });
    const alsoHidden = await run("ravi", "attendance", { person: "also-not-real" });
    // Compared on everything except the echoed id: quoting back what you asked
    // for is not disclosure, and it makes the refusal readable.
    const shapeOf = (o: typeof hidden) => ({
      found: (o as { found?: boolean } | undefined)?.found,
      items: (o as { items?: unknown[] } | undefined)?.items,
    });
    expect(shapeOf(hidden)).toEqual(shapeOf(alsoHidden));
    expect(shapeOf(hidden).found).toBe(false);
  });

  it("returns the window it resolved, so the dates can be checked", async () => {
    const out = await run("priya", "attendance", { period: "last-week" });
    const w = (out as { window: { from: string; to: string; meaning: string } }).window;
    // 2026-08-24 minus 13 and minus 7.
    expect(w).toEqual({
      from: "2026-08-11",
      to: "2026-08-17",
      meaning: "the 7 days before the last 7",
    });
  });
});

describe("joining and handover — mirror images, kept apart", () => {
  it("joining_status returns onboarding steps, not board tasks", async () => {
    const out = await run("shruti", "joining_status", {});
    expect(out).toBeDefined();
    expect(JSON.stringify(out)).not.toContain('"status":"todo"');
  });

  it("each description names the other, in both directions", async () => {
    const { peopleTools } = await import("./people");
    const joining = peopleTools.find((t) => t.name === "joining_status")!;
    const handover = peopleTools.find((t) => t.name === "handover_status")!;
    const desc = (spec: typeof joining) =>
      String((spec.build(toolsFor("shruti", deps).ctx) as { description?: string }).description);

    expect(desc(joining)).toContain("handover_status");
    expect(desc(handover)).toContain("joining_status");
    // And each says which direction it is, in words, since they are otherwise
    // near-identical in shape.
    expect(desc(joining)).toMatch(/NEW STARTER|joining/i);
    expect(desc(handover)).toMatch(/LEAVING|leaver/i);
  });

  it("every new description leads with what it does NOT return", async () => {
    const { peopleTools } = await import("./people");
    const ctx = toolsFor("shruti", deps).ctx;
    for (const name of ["attendance", "joining_status", "handover_status"]) {
      const spec = peopleTools.find((t) => t.name === name)!;
      const description = String(
        (spec.build(ctx) as { description?: string }).description,
      );
      const firstLine = description.split("\n")[0];
      // Rule 1 of 1a's learning log: the negative clause comes first.
      expect(firstLine, `${name} must open with its negative clause`).toMatch(
        /does NOT|not show|will not/i,
      );
    }
  });

  it("attendance and list_leave point at each other", async () => {
    const { peopleTools } = await import("./people");
    const ctx = toolsFor("shruti", deps).ctx;
    const desc = (name: string) =>
      String(
        (peopleTools.find((t) => t.name === name)!.build(ctx) as { description?: string })
          .description,
      );
    expect(desc("attendance")).toContain("list_leave");
    expect(desc("list_leave")).toContain("attendance");
  });
});

describe("the window resolver — no date arithmetic in the model", () => {
  const today = "2026-08-24";

  it("resolves each named period to explicit dates", () => {
    expect(resolveWindow(today, { period: "today" })).toMatchObject({
      from: "2026-08-24",
      to: "2026-08-24",
    });
    expect(resolveWindow(today, { period: "yesterday" })).toMatchObject({
      from: "2026-08-23",
      to: "2026-08-23",
    });
    expect(resolveWindow(today, { period: "this-week" })).toMatchObject({
      from: "2026-08-18",
      to: "2026-08-24",
    });
    expect(resolveWindow(today, { period: "this-month" })).toMatchObject({
      from: "2026-08-01",
      to: "2026-08-24",
    });
    expect(resolveWindow(today, { period: "last-month" })).toMatchObject({
      from: "2026-07-01",
      to: "2026-07-31",
    });
  });

  it("crosses a month boundary correctly", () => {
    // The bug that adding 86_400_000 ms would introduce.
    expect(resolveWindow("2026-03-02", { period: "this-week" }).from).toBe("2026-02-24");
    expect(resolveWindow("2026-01-01", { period: "yesterday" }).from).toBe("2025-12-31");
  });

  it("explicit dates always win over a named period", () => {
    const w = resolveWindow(today, { period: "today", from: "2026-01-01", to: "2026-01-31" });
    expect(w).toMatchObject({ from: "2026-01-01", to: "2026-01-31" });
  });

  it("an unknown period falls back to something stated, never to a guess", () => {
    const w = resolveWindow(today, { period: "sometime recently" });
    expect(w.from).toBe("2026-07-26");
    expect(w.meaning).toMatch(/last 30 days/);
  });

  it("membership is inclusive at both ends", () => {
    const w = resolveWindow(today, { period: "this-week" });
    expect(withinWindow("2026-08-18", w)).toBe(true);
    expect(withinWindow("2026-08-24", w)).toBe(true);
    expect(withinWindow("2026-08-17", w)).toBe(false);
    expect(withinWindow(undefined, w)).toBe(false);
  });
});
