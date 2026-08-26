import { describe, it, expect, beforeEach } from "vitest";
import { buildDemoWorld, type DemoWorld } from "@/server/bootstrap";
import * as adapters from "@/spine/adapters";
import { AutonomyEngine } from "./engine";
import { authorRule } from "./author";
import type { RuleSpec } from "./spec";

let world: DemoWorld;
let engine: AutonomyEngine;

beforeEach(async () => {
  world = await buildDemoWorld();
  engine = new AutonomyEngine(
    world.autonomy,
    world.spine,
    world.deps.graph,
    world.deps.log,
    world.deps.bus,
  );
});

/**
 * A rule now has to exist before anything can run under it.
 *
 * These tests used to submit against an id nobody had declared and let the
 * first confirmation bring the rule into being — which was the vulnerability:
 * confirming your own parked operation minted a persisted grant of authority.
 * Declaring it up front is the real flow.
 */
function declareRule(ruleId: string, opName = "notify.send") {
  if (!world.autonomy.get(ruleId)) {
    world.autonomy.declare(ruleId, "james", opName, "routine");
  }
}

function standingAnnouncement(ruleId: string) {
  declareRule(ruleId);
  return adapters.fromStandingRule({
    ruleId,
    ruleAuthor: "james",
    name: "notify.send",
    args: { message: "test", to: ["james"] },
  });
}

async function confirmTimes(ruleId: string, times: number, edited = false) {
  declareRule(ruleId);
  let lastOffer = undefined as { ruleId: string; cleanCount: number } | undefined;
  for (let i = 0; i < times; i++) {
    const submit = await world.spine.submit(standingAnnouncement(ruleId));
    const pendingId = submit.pendingId!;
    const res = await world.spine.confirm(pendingId, "james", edited ? { editedArgs: { message: `edit-${i}` } } : undefined);
    lastOffer = res.graduationOffer;
  }
  return lastOffer;
}

describe("earning the right (appendix B) — graduation after 10 clean approvals", () => {
  it("offers graduation on the 10th unchanged approval", async () => {
    const offer = await confirmTimes("rule-a", 10);
    expect(offer).toBeTruthy();
    expect(offer?.cleanCount).toBe(10);
  });

  it("runs on its own after the author accepts graduation", async () => {
    await confirmTimes("rule-b", 10);
    expect(engine.acceptGraduation("rule-b", "james")).toBe(true);
    const res = await world.spine.submit(standingAnnouncement("rule-b"));
    expect(res.status).toBe("ran");
  });

  it("a supervised rule (not yet graduated) still asks every time", async () => {
    const res = await world.spine.submit(standingAnnouncement("rule-c"));
    expect(res.status).toBe("awaiting-confirmation");
  });
});

describe("earning the right — an edit resets the count", () => {
  it("9 clean + 1 edit + 1 clean ⇒ not yet due (edit reset)", async () => {
    await confirmTimes("rule-d", 9);
    await confirmTimes("rule-d", 1, true);
    const offer = await confirmTimes("rule-d", 1);
    expect(offer).toBeUndefined();
  });
});

describe("never-graduate — money/people/leaving-org never earn autonomy", () => {
  it("a people-action rule is never offered graduation", async () => {
    declareRule("rule-leave", "leave.request");
    for (let i = 0; i < 12; i++) {
      const submit = await world.spine.submit(
        adapters.fromStandingRule({
          ruleId: "rule-leave",
          ruleAuthor: "james",
          name: "leave.request",
          args: { employeeId: "priya", fromDate: "2026-08-10", toDate: "2026-08-10" },
        }),
      );
      await world.spine.confirm(submit.pendingId!, "james");
    }
    expect(world.autonomy.get("rule-leave")?.status).toBe("supervised");
    expect(world.autonomy.get("rule-leave")?.cleanCount).toBe(0);
  });
});

describe("one-tap revoke", () => {
  it("graduates then revokes back to supervised", async () => {
    await confirmTimes("rule-e", 10);
    engine.acceptGraduation("rule-e", "james");
    expect(world.autonomy.get("rule-e")?.status).toBe("graduated");
    engine.revoke("rule-e", "james");
    expect(world.autonomy.get("rule-e")?.status).toBe("supervised");
    expect(world.autonomy.get("rule-e")?.cleanCount).toBe(0);
    const res = await world.spine.submit(standingAnnouncement("rule-e"));
    expect(res.status).toBe("awaiting-confirmation");
  });
});

describe("auto-suspend on departure", () => {
  it("a graduated rule is suspended + forbidden when the author separates", async () => {
    await confirmTimes("rule-f", 10);
    engine.acceptGraduation("rule-f", "james");
    await world.deps.graph.patchNode("employee", "james", { status: "separated" });
    await engine.suspendSeparated();
    expect(world.autonomy.get("rule-f")?.status).toBe("suspended");
    const res = await world.spine.submit(standingAnnouncement("rule-f"));
    expect(res.status).toBe("forbidden");
  });
});

describe("standing instructions (08) — amber loop emits operations", () => {
  it("ticks + emits announcements for stale courses in review", async () => {
    const authored = await authorRule(
      "tell me when a course sits in review more than 8 days",
      "james",
      "stale-review",
    );
    const rule = authored.ok ? (authored as { spec: RuleSpec }).spec : undefined;
    expect(rule).toBeTruthy();
    engine.registerRule(rule!);
    const result = await engine.tick("2026-08-08T23:59:59Z");
    expect(result.emitted).toBeGreaterThan(0);
  });
});

describe("routine watcher (10) — offers, never auto", () => {
  /**
   * Phase 4 tightened all three of these, and the old version of this test
   * asserted the loose behaviour: four `notify.send` calls in one instant
   * produced a suggestion. That is a batch of work, not a habit — and
   * `notify.send` writes no record, so there is no subject to be habitual
   * about.
   */
  it("does NOT offer a batch of work done in one afternoon", async () => {
    for (let i = 0; i < 4; i++) {
      await world.spine.submit(
        adapters.fromTyped({
          actor: "priya",
          name: "notify.send",
          args: { message: `routine ${i}`, to: ["priya"] },
        }),
      );
    }
    const suggestions = await engine.detectRoutines();
    expect(
      suggestions.find((s) => s.actor === "priya"),
      "four things in one go is a busy afternoon, not a routine",
    ).toBeUndefined();
  });

  it("offers the same work repeated across three separate weeks", async () => {
    // The same action against the same subject — a task for Arun called
    // "deck" — three weeks running. That is a habit.
    for (const week of [0, 1, 2]) {
      const at = new Date(Date.UTC(2026, 6, 6 + week * 7)).toISOString();
      await world.deps.log.append({
        id: `act_routine_${week}`,
        operationId: `op_routine_${week}`,
        operationName: "task.create",
        actor: "priya",
        authority: { kind: "self", actor: "priya" },
        startedBy: { kind: "typed", at, actor: "priya" },
        at,
        changes: [
          {
            nodeType: "task",
            nodeId: `task_r_${week}`,
            after: { title: "deck", assignedTo: "arun" },
          },
        ],
        outcome: "ran",
      });
    }
    const suggestions = await engine.detectRoutines("2026-07-27T09:00:00.000Z");
    const found = suggestions.find((s) => s.actor === "priya" && s.opName === "task.create");
    expect(found, "the same work three weeks running is a routine").toBeTruthy();
    expect(found?.status).toBe("offered");
  });

  it("offers at most one suggestion a week", async () => {
    // One bad suggestion teaches people to ignore all of them.
    for (const week of [0, 1, 2]) {
      const at = new Date(Date.UTC(2026, 6, 6 + week * 7)).toISOString();
      for (const [n, who] of [["deck", "arun"], ["notes", "karthik"]] as const) {
        await world.deps.log.append({
          id: `act_two_${n}_${week}`,
          operationId: `op_two_${n}_${week}`,
          operationName: "task.create",
          actor: "priya",
          authority: { kind: "self", actor: "priya" },
          startedBy: { kind: "typed", at, actor: "priya" },
          at,
          changes: [
            { nodeType: "task", nodeId: `t_${n}_${week}`, after: { title: n, assignedTo: who } },
          ],
          outcome: "ran",
        });
      }
    }
    const first = await engine.detectRoutines("2026-07-27T09:00:00.000Z");
    expect(first.length).toBe(1);
    // Same week again — nothing new, however much there is to offer.
    const second = await engine.detectRoutines("2026-07-28T09:00:00.000Z");
    expect(second.length).toBe(1);
  });
});
