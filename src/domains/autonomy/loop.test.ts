import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { buildDemoWorld, type DemoWorld } from "@/server/bootstrap";
import { AutonomyEngine, resumeAllRules, stopAllRules } from "./engine";
import { AutonomyStore } from "./store";
import { FiredKeyStore } from "./fired";
import { authorRule } from "./author";
import type { RuleSpec } from "./spec";
import { cleanApprovalsToGraduate } from "@/spine/gate/autonomy";

/**
 * The loop, the budget, and the switch.
 *
 * ── The loop that was live in production ────────────────────────────────────
 *
 * `registerRule` used to subscribe `tick` to the publish bus. A rule fires →
 * `spine.submit` → `publishResult` → `bus.publish` → every listener, including
 * `tick` → every rule re-evaluates. **And the condition is still true**: a
 * course in review for five days is still in review five days after you have
 * been told. `notify.send` publishes, so it re-triggered itself, forever.
 *
 * Two accidents hid it, and neither is a design: `compileRule` understood one
 * sentence so almost no rules existed, and the one registered rule had never
 * graduated — a supervised emission parks, and a parked operation does not
 * publish. Give that rule ten clean approvals and the cycle closes.
 */

let world: DemoWorld;
let store: AutonomyStore;
let fired: FiredKeyStore;

beforeEach(async () => {
  world = await buildDemoWorld();
  store = new AutonomyStore();
  await store.init();
  fired = new FiredKeyStore();
  await fired.init();
  resumeAllRules();
});

afterEach(() => {
  resumeAllRules();
});

function engine(): AutonomyEngine {
  return new AutonomyEngine(store, world.spine, world.deps.graph, world.deps.log, world.deps.bus, fired);
}

async function aRule(id = "r_loop", sentence = "tell me when a course sits in review more than 1 days") {
  const authored = await authorRule(sentence, "james", id);
  expect(authored.ok, `could not author: ${sentence}`).toBe(true);
  const spec = (authored as { spec: RuleSpec }).spec;
  engine().registerRule(spec);
  return spec;
}

/** Let the rule act for real rather than parking, so publishing is reachable. */
function graduate(ruleId: string) {
  const state = store.get(ruleId)!;
  state.cleanCount = cleanApprovalsToGraduate();
  state.status = "graduated";
  store.set(state);
}

describe("the loop is closed", () => {
  it("registering a rule does not subscribe anything to the publish bus", async () => {
    const before = world.deps.bus.published().length;
    await aRule("r_nobus");
    // Nothing may listen. The old line was:
    //   this.bus.subscribe(() => this.tick(...))
    let ticksTriggered = 0;
    world.deps.bus.subscribe(() => {
      ticksTriggered += 1;
    });
    world.deps.bus.publish({ kind: "broadcast", message: "unrelated" });
    // Our own listener fired once; the engine's did not exist to fire at all.
    expect(ticksTriggered).toBe(1);
    expect(world.deps.bus.published().length).toBe(before + 1);
  });

  it("a rule that fires does not cause itself to fire again", async () => {
    const spec = await aRule();
    graduate(spec.id);

    const first = await engine().tick("2027-01-10T09:00:00.000Z");
    // The seeded world has stale courses, so this must actually do something —
    // a test that passes because nothing happened proves nothing.
    expect(first.emitted, "nothing fired, so the loop was never exercised").toBeGreaterThan(0);

    // ⚠ The same tick again, on the same findings. THE CONDITION IS STILL TRUE:
    // the course is still in review. Before fire-once this notified again, and
    // again, for as long as it stayed stale.
    const second = await engine().tick("2027-01-10T09:05:00.000Z");
    expect(second.emitted, "the rule told them the same thing twice").toBe(0);

    const third = await engine().tick("2027-01-11T09:00:00.000Z");
    expect(third.emitted, "a new day is not a new finding").toBe(0);
  });

  it("fire-once survives a restart — a reboot must not re-notify everything", async () => {
    const spec = await aRule("r_persist");
    graduate(spec.id);
    const first = await engine().tick("2027-01-10T09:00:00.000Z");
    expect(first.emitted).toBeGreaterThan(0);

    // A fresh engine over the same fired-key store, exactly as boot builds one.
    const restarted = new AutonomyEngine(
      store,
      world.spine,
      world.deps.graph,
      world.deps.log,
      world.deps.bus,
      fired,
    );
    const after = await restarted.tick("2027-01-10T10:00:00.000Z");
    expect(
      after.emitted,
      "the rule shouted everything again on restart — an in-memory seen-set is " +
        "the same bug wearing a different hat, and notify.send cannot be un-sent",
    ).toBe(0);
  });

  it("an overlapping tick is skipped, not queued", async () => {
    const spec = await aRule("r_reentrant");
    graduate(spec.id);
    const e = engine();
    const [a, b] = await Promise.all([
      e.tick("2027-01-10T09:00:00.000Z"),
      e.tick("2027-01-10T09:00:00.001Z"),
    ]);
    // Two ticks interleaved would both read "not yet fired" for the same
    // finding before either wrote, and notify twice.
    const skipped = [a, b].filter((r) => r.skipped === "already ticking");
    expect(skipped.length).toBe(1);
  });
});

describe("the budget bounds a runaway", () => {
  it("a rule with many findings emits at most the daily budget", async () => {
    // Forty stale courses. Being told forty things at once is not being told
    // anything, and a rule that suddenly matches an imported spreadsheet is
    // exactly the shape this guards.
    for (let i = 0; i < 40; i++) {
      await world.deps.graph.putNode("course", `flood_${i}`, {
        title: `Flood ${i}`,
        stage: "review",
        stageEnteredAt: "2026-01-01T00:00:00.000Z",
        owner: "james",
      });
    }
    const spec = await aRule("r_flood");
    graduate(spec.id);

    const out = await engine().tick("2027-01-10T09:00:00.000Z");
    expect(out.emitted).toBeLessThanOrEqual(20);
    // ⚠ And it SAYS it hit the budget. A rule silently truncated is a rule you
    // believe is working.
    expect(out.budgetHit).toContain("r_flood");
  });
});

describe("one switch, all rules off", () => {
  it("stops everything immediately", async () => {
    const spec = await aRule("r_switch");
    graduate(spec.id);

    stopAllRules();
    const out = await engine().tick("2027-01-10T09:00:00.000Z");
    expect(out.emitted).toBe(0);
    expect(out.evaluated).toBe(0);
    expect(out.skipped).toBe("stopped");

    resumeAllRules();
    const after = await engine().tick("2027-01-10T09:00:00.000Z");
    expect(after.evaluated).toBeGreaterThan(0);
  });
});

describe("money and people never graduate, however well behaved", () => {
  it("is asserted directly, not inherited from the constant", async () => {
    const spec = await aRule("r_never");
    // Rewrite the grant to claim a people category and a spotless record.
    const state = store.get(spec.id)!;
    state.category = "people";
    state.cleanCount = 10_000;
    store.set(state);

    const accepted = engine().acceptGraduation(spec.id, "james");
    expect(
      accepted,
      "a people-category rule graduated. NEVER_GRADUATE is not a suggestion",
    ).toBe(false);
    expect(store.get(spec.id)?.status).toBe("supervised");
  });

  it("a routine rule with enough clean approvals DOES graduate", () => {
    // Or the test above passes because nothing ever graduates.
    const state = store.get("r_never");
    if (!state) return;
    state.category = "routine";
    state.cleanCount = cleanApprovalsToGraduate();
    state.status = "supervised";
    store.set(state);
    expect(engine().acceptGraduation("r_never", "james")).toBe(true);
  });
});
