import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { buildDemoWorld, type DemoWorld } from "@/server/bootstrap";
import { resetProviders } from "@/config/providers";
import { resetEnvCache } from "@/config/env";
import { resetFakeLlm } from "@/config/llm-fake";
import { CourseService } from "@/domains/course/service";
import { AutonomyEngine, resumeAllRules } from "@/domains/autonomy/engine";
import { AutonomyStore } from "@/domains/autonomy/store";
import { FiredKeyStore } from "@/domains/autonomy/fired";
import { ToolContext, type ToolDeps } from "./context";
import { ALL_TOOLS } from "./index";
import { resetTokenBudget } from "../token-budget";
import { resetConfirmations } from "./confirmation";

/**
 * Authoring a rule from the assistant.
 *
 * ── The bug this file exists for ────────────────────────────────────────────
 *
 * A live run wrote a rule, read it back, and the person said *"yes, that's
 * right."* The model called `author_rule` again — and the tool **refused**,
 * because the rule id was a hash of the exact sentence and the model had
 * re-typed it slightly differently. A brand new confirmation was issued in that
 * turn and immediately failed the turn boundary.
 *
 * The model then answered: **"I have set up the rule… It is now running and
 * will notify you."** Nothing had been saved.
 *
 * That is the worst sentence this phase can produce. A person believes
 * something is watching for them, and nothing is — and unlike a failed write,
 * there is no missing record to notice. They simply never get told.
 */

let world: DemoWorld;
let deps: ToolDeps;
let store: AutonomyStore;

beforeEach(async () => {
  process.env.ORG_LLM_PROVIDER = "fake";
  resetEnvCache();
  resetProviders();
  resetFakeLlm();
  resetTokenBudget();
  resetConfirmations();
  resumeAllRules();
  world = await buildDemoWorld();
  store = new AutonomyStore();
  await store.init();
  const fired = new FiredKeyStore();
  await fired.init();
  deps = {
    spine: world.spine,
    graph: world.deps.graph,
    figures: world.deps.figures,
    permissions: world.deps.permissions,
    courses: new CourseService(world.deps.graph, world.deps.figures),
    autonomy: new AutonomyEngine(
      store,
      world.spine,
      world.deps.graph,
      world.deps.log,
      world.deps.bus,
      fired,
    ),
    today: () => "2026-08-08",
  };
});

afterEach(() => {
  delete process.env.ORG_LLM_PROVIDER;
  resetEnvCache();
  resetProviders();
  resetFakeLlm();
  resetConfirmations();
  resumeAllRules();
});

/** One turn. Reusing a context is what makes two calls share a turn. */
function turn(actor = "james") {
  const ctx = new ToolContext(actor, deps);
  return async (name: string, input: Record<string, unknown> = {}) => {
    const spec = ALL_TOOLS.find((t) => t.name === name)!;
    const built = spec.build(ctx) as { execute: (i: unknown, o: unknown) => Promise<unknown> };
    return (await built.execute(input, { toolCallId: "t", messages: [] })) as Record<
      string,
      unknown
    >;
  };
}

const SENTENCE = "tell me when a course sits in review more than 5 days";

describe("authoring a rule takes two turns, and the second one works", () => {
  it("the first call reads back and saves nothing", async () => {
    const out = await turn()("author_rule", { sentence: SENTENCE });
    expect(out.ok).toBe(false);
    expect(out.didNotHappen).toBe(true);
    expect(out.readBack).toBe("Tell you when a course sits in review for more than 5 days.");
    // ⚠ And it says so twice, in words the model cannot narrate around.
    expect(out.ruleIsNotRunning).toBe(true);
    expect(String(out.tellThem)).toMatch(/NOTHING IS WATCHING YET/);
    expect(String(out.tellThem)).toMatch(/Do NOT say the rule is set up/);
    expect(store.listSpecs()).toEqual([]);
  });

  it("A PARAPHRASE ON THE SECOND TURN STILL SAVES — the bug that shipped a lie", async () => {
    await turn()("author_rule", { sentence: SENTENCE });

    // A new turn, and the model re-types the sentence differently — which is
    // exactly what it did live. The rule is the same rule.
    const out = await turn()("author_rule", {
      sentence: "Tell me when a course has been in review for over 5 days.",
    });

    expect(
      out.ok,
      "the confirmation did not carry across a paraphrase, so 'yes' saved nothing",
    ).toBe(true);
    expect(store.listSpecs()).toHaveLength(1);
    expect(store.listSpecs()[0].when).toMatchObject({ state: "review", days: 5 });
  });

  it("still cannot be authored and confirmed inside one turn", async () => {
    const one = turn();
    await one("author_rule", { sentence: SENTENCE });
    const sneaked = await one("author_rule", { sentence: SENTENCE });
    expect(sneaked.ok).toBe(false);
    expect(store.listSpecs()).toEqual([]);
  });

  it("a saved rule starts supervised, not acting alone", async () => {
    await turn()("author_rule", { sentence: SENTENCE });
    const out = await turn()("author_rule", { sentence: SENTENCE });
    expect(out.ok).toBe(true);
    const listed = await turn()("list_rules");
    const items = listed.items as Array<Record<string, unknown>>;
    expect(items[0].status).toBe("supervised");
    expect(items[0].actsAlone).toBe(false);
    expect(String(out.note)).toMatch(/ten clean approvals/);
  });
});

describe("it refuses rather than approximating, through the tool too", () => {
  it("refuses an action outside the DO list", async () => {
    const out = await turn()("author_rule", {
      sentence: "when a course has been in review 7 days, assign it to Karthik",
    });
    expect(out.ok).toBe(false);
    expect(out.kind).toBe("unsupported-action");
    expect(String(out.reason)).toMatch(/only notify/i);
    expect(store.listSpecs()).toEqual([]);
  });

  it("asks rather than guessing when a sentence could be a question", async () => {
    const out = await turn()("author_rule", { sentence: "courses in review over 5 days" });
    expect(out.ok).toBe(false);
    expect(out.kind).toBe("ambiguous");
    expect(out.needsAnswer).toBe(true);
    expect(String(out.ask)).toMatch(/standing rule, or just the answer/i);
  });
});

describe("the kill switch, through the tool", () => {
  it("stops everything, and list_rules says so rather than looking normal", async () => {
    await turn()("author_rule", { sentence: SENTENCE });
    await turn()("author_rule", { sentence: SENTENCE });

    const stopped = await turn()("stop_all_rules", {});
    expect(stopped.ok).toBe(true);
    expect(stopped.rulesStopped).toBe(true);

    const listed = await turn()("list_rules");
    // ⚠ A stopped rule that lists as though it were running is how somebody
    // waits all week for a notification that was never coming.
    expect(listed.allRulesStopped).toBe(true);
    expect(String(listed.note)).toMatch(/EVERY rule is currently stopped/);

    const resumed = await turn()("stop_all_rules", { resume: true });
    expect(resumed.rulesStopped).toBe(false);
  });
});
