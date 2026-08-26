import { describe, it, expect, beforeEach } from "vitest";
import { buildDemoWorld, type DemoWorld } from "@/server/bootstrap";
import { AutonomyEngine } from "./engine";
import { AutonomyStore } from "./store";
import type { RuleSpec } from "./spec";
import { authorRule } from "./author";

/**
 * A rule must survive a restart.
 *
 * ── The bug, and why it is familiar ─────────────────────────────────────────
 *
 * `RuleState` persists `ruleId`, `author`, `opName`, `category`, `cleanCount`
 * and `status` — **the grant, not the rule**. The rule itself is a
 * `CompiledRule` whose `evaluate` is a **JavaScript closure** held in
 * `engine.rules`, an in-memory array, and `plainLanguage` lives on that object
 * and is not persisted either.
 *
 * So after a restart the ledger knows *"rule R may emit `notify.send` and has
 * seven clean approvals"* and **nothing anywhere knows what R watches**.
 *
 * This is `UndoInfo.revert` versus `undo.plan` again — a problem this codebase
 * has already solved once. A closure dies with the process; a plan survives it.
 * The lesson did not transfer.
 *
 * ── How a restart is simulated ──────────────────────────────────────────────
 *
 * The same trick `spine/integrity.test.ts` uses for durable undo: build a fresh
 * engine over the same store, exactly as boot does. Nothing in memory carries
 * over, which is the whole point.
 */

let world: DemoWorld;

beforeEach(async () => {
  world = await buildDemoWorld();
});

/** An engine, built the way `runtime.ts` builds one. */
function engineOver(store: AutonomyStore): AutonomyEngine {
  return new AutonomyEngine(store, world.spine, world.deps.graph, world.deps.log, world.deps.bus);
}

describe("a rule survives a restart", () => {
  it("still watches the same thing after the engine is thrown away", async () => {
    const store = new AutonomyStore();
    await store.init();
    const engine = engineOver(store);

    const authored = await authorRule(
      "tell me when a course sits in review more than 5 days",
      "james",
      "r_restart",
    );
    expect(authored.ok, "the sentence did not become a rule at all").toBe(true);
    engine.registerRule((authored as { spec: RuleSpec }).spec);

    // The grant is persisted. That much has always worked.
    expect(store.get("r_restart")?.opName).toBe("notify.send");

    // ── the restart ──────────────────────────────────────────────────────
    const restarted = engineOver(store);

    const known = restarted.listRules();
    const found = known.find((r) => r.ruleId === "r_restart");
    expect(found, "the rule is gone — the ledger kept the grant, not the rule").toBeTruthy();

    // And it must know WHAT it watches, not merely that it may notify.
    expect(
      found?.plainLanguage,
      "nothing knows what this rule watches; plainLanguage was never persisted",
    ).toMatch(/review/i);
    expect(
      found?.spec,
      "there is no serialisable spec — evaluate was a closure and died with the process",
    ).toBeTruthy();
  });

  it("still evaluates after a restart, without being re-compiled", async () => {
    const store = new AutonomyStore();
    await store.init();
    const authored = await authorRule(
      "tell me when a course sits in review more than 5 days",
      "james",
      "r_eval",
    );
    engineOver(store).registerRule((authored as { spec: RuleSpec }).spec);

    const restarted = engineOver(store);
    // A tick on a fresh engine must still be able to run the rule. Today the
    // rules array is empty, so this silently emits nothing — the worst shape of
    // failure, because it looks exactly like "there was nothing to report".
    const result = await restarted.tick(new Date().toISOString());
    expect(
      result.evaluated,
      "a restarted engine evaluated no rules — it does not know it has any",
    ).toBeGreaterThan(0);
  });
});

describe("routine suggestions survive a restart", () => {
  it("keeps what it has already offered", async () => {
    const store = new AutonomyStore();
    await store.init();
    const engine = engineOver(store);

    await engine.recordSuggestion({
      id: "sug_1",
      actor: "james",
      opName: "task.create",
      count: 3,
      status: "offered",
    });
    expect(engine.listSuggestions().length).toBe(1);

    const restarted = engineOver(store);
    expect(
      restarted.listSuggestions().length,
      "suggestions are an in-memory Map, so a restart forgets what was offered " +
        "— and the same suggestion is offered again, which is how people learn " +
        "to ignore them",
    ).toBe(1);
  });
});
