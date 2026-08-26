import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { buildDemoWorld, type DemoWorld } from "@/server/bootstrap";
import { resetProviders } from "@/config/providers";
import { resetEnvCache } from "@/config/env";
import { resetFakeLlm } from "@/config/llm-fake";
import { createQuestionLimiter } from "@/domains/workplace/shared/limiter";
import { CourseService } from "@/domains/course/service";
import { DayPlanService } from "@/domains/assistant/day-plan/service";
import { DayPlanStore } from "@/domains/assistant/day-plan/store";
import { openDay } from "@/domains/assistant/day-plan/test-support";
import { toolsFor, type ToolDeps } from "./index";
import { resetTokenBudget } from "../token-budget";
import { resetConfirmations, setConfirmationClock } from "./confirmation";

/**
 * The read-back, and whether anything actually holds it.
 *
 * ── What this file exists to prove ──────────────────────────────────────────
 *
 * `drop_item` and `close_out` took a `confirmed: boolean` **in their input
 * schema**, which the MODEL sets. Nothing anywhere checked that a human had
 * been asked, that a sentence had been read back, or that anybody had said yes.
 * A model passing `confirmed: true` on its first call dropped the item without
 * a word, and the refusal branch never ran.
 *
 * It worked because the model was well behaved, not because anything held it —
 * Phase 2's own log says exactly that. A self-attested guard is not a guard:
 * the one thing a read-back exists to prevent, acting without asking, is
 * precisely what it cannot detect.
 *
 * The fix is a two-call protocol the SERVER drives. The first call does not
 * act; it returns the consequence and a server-generated token bound to
 * (actor, tool, target) with a short expiry. The second call must present that
 * token. **The model cannot invent a token it was never given**, so "did we
 * actually stop and ask?" stops being a claim and becomes a fact.
 */

const TODAY = "2026-08-08";

let world: DemoWorld;
let deps: ToolDeps;
let dayPlan: DayPlanService;
let store: DayPlanStore;

beforeEach(async () => {
  process.env.ORG_LLM_PROVIDER = "fake";
  resetEnvCache();
  resetProviders();
  resetFakeLlm();
  resetTokenBudget();
  resetConfirmations();
  world = await buildDemoWorld();
  store = new DayPlanStore();
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

afterEach(() => {
  delete process.env.ORG_LLM_PROVIDER;
  resetEnvCache();
  resetProviders();
  resetFakeLlm();
  resetConfirmations();
  setConfirmationClock(undefined);
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

/**
 * Two calls inside ONE turn — one `toolsFor`, one `ToolContext`, exactly what a
 * model does when it chains tool calls in a single agent loop.
 */
async function runTwiceInOneTurn(
  actor: string,
  name: string,
  first: Record<string, unknown>,
  second: (firstOut: Record<string, unknown> | undefined) => Record<string, unknown>,
) {
  const { tools } = toolsFor(actor, deps);
  const t = tools[name];
  const execute = t.execute as (i: unknown, o: unknown) => Promise<unknown>;
  const call = async (input: unknown) =>
    (
      (await execute(input, { toolCallId: "t", messages: [] })) as {
        untrusted_record_data: Record<string, unknown>;
      }
    ).untrusted_record_data;
  const a = await call(first);
  const b = await call(second(a));
  return { first: a, second: b };
}

async function anItem(actor = "james", label = "Module 4") {
  await openDay(dayPlan, actor, TODAY);
  const added = await run(actor, "select_item", { label, estimateMinutes: 60 });
  return (added?.added as { id: string }).id;
}

/** Every refusal has to be loud, or it gets narrated as success. */
function expectLoudRefusal(out: Record<string, unknown> | undefined) {
  expect(out?.ok).toBe(false);
  expect(out?.didNotHappen).toBe(true);
  expect(typeof out?.tellThem).toBe("string");
  expect(String(out?.tellThem).length).toBeGreaterThan(10);
}

describe("B1 — a first call cannot act, however confident the model is", () => {
  it("drop_item does NOT drop on a single call with confirmed: true", async () => {
    const id = await anItem();

    // Exactly what a model in a hurry does: assert the read-back happened and
    // call once. Before the token, this dropped the item.
    const out = await run("james", "drop_item", { itemId: id, confirmed: true });

    expect(store.get("james", TODAY)!.plan[0].dropped).toBeUndefined();
    expectLoudRefusal(out);
    // And it hands back what it needs for the second call.
    expect(out?.confirmationToken).toBeTruthy();
    expect(String(out?.consequence)).toMatch(/carry over/i);
  });

  it("close_out does NOT close the day on a single finish with confirmed: true", async () => {
    await anItem();
    await run("james", "commit_plan", {});
    await run("james", "close_out", { step: "begin" });

    const out = await run("james", "close_out", { step: "finish", confirmed: true });

    expect(store.get("james", TODAY)!.phase).not.toBe("closed");
    expectLoudRefusal(out);
    expect(out?.confirmationToken).toBeTruthy();
  });

  it("the second call, with the token, does act", async () => {
    const id = await anItem();
    const first = await run("james", "drop_item", { itemId: id });
    const out = await run("james", "drop_item", {
      itemId: id,
      confirmationToken: first?.confirmationToken,
    });
    expect(out?.ok).toBe(true);
    expect(store.get("james", TODAY)!.plan[0].dropped).toBeDefined();
  });
});

describe("B3 — attacks on the gate. Every one must be refused", () => {
  it("a made-up token string is refused", async () => {
    const id = await anItem();
    const out = await run("james", "drop_item", {
      itemId: id,
      confirmationToken: "cfm_totally_made_up",
    });
    expectLoudRefusal(out);
    expect(store.get("james", TODAY)!.plan[0].dropped).toBeUndefined();
  });

  it("a token issued to one actor cannot be used by another", async () => {
    const jamesItem = await anItem("james");
    const priyaItem = await anItem("priya");
    const first = await run("james", "drop_item", { itemId: jamesItem });
    expect(first?.confirmationToken).toBeTruthy();

    const out = await run("priya", "drop_item", {
      itemId: priyaItem,
      confirmationToken: first?.confirmationToken,
    });
    expectLoudRefusal(out);
    expect(store.get("priya", TODAY)!.plan[0].dropped).toBeUndefined();
  });

  it("a token for drop_item cannot be spent on close_out", async () => {
    const id = await anItem();
    await run("james", "commit_plan", {});
    const first = await run("james", "drop_item", { itemId: id });

    await run("james", "close_out", { step: "begin" });
    const out = await run("james", "close_out", {
      step: "finish",
      confirmationToken: first?.confirmationToken,
    });
    expectLoudRefusal(out);
    expect(store.get("james", TODAY)!.phase).not.toBe("closed");
  });

  it("a token for item A cannot be used to drop item B", async () => {
    await openDay(dayPlan, "james", TODAY);
    const a = await run("james", "select_item", { label: "Item A", estimateMinutes: 60 });
    const b = await run("james", "select_item", { label: "Item B", estimateMinutes: 60 });
    const idA = (a?.added as { id: string }).id;
    const idB = (b?.added as { id: string }).id;

    const first = await run("james", "drop_item", { itemId: idA });
    const out = await run("james", "drop_item", {
      itemId: idB,
      confirmationToken: first?.confirmationToken,
    });
    expectLoudRefusal(out);
    const plan = store.get("james", TODAY)!.plan;
    expect(plan.find((i) => i.id === idB)!.dropped).toBeUndefined();
    // And A is untouched too — a refused call changes nothing at all.
    expect(plan.find((i) => i.id === idA)!.dropped).toBeUndefined();
  });

  it("an expired token is refused", async () => {
    let now = 1_000_000;
    setConfirmationClock(() => now);
    const id = await anItem();
    const first = await run("james", "drop_item", { itemId: id });

    // Well past any sane read-back. A token lives for one conversational turn.
    now += 60 * 60 * 1000;
    const out = await run("james", "drop_item", {
      itemId: id,
      confirmationToken: first?.confirmationToken,
    });
    expectLoudRefusal(out);
    expect(String(out?.tellThem)).toMatch(/again/i);
    expect(store.get("james", TODAY)!.plan[0].dropped).toBeUndefined();
  });

  it("the same token cannot be used twice", async () => {
    await openDay(dayPlan, "james", TODAY);
    const a = await run("james", "select_item", { label: "Item A", estimateMinutes: 60 });
    const idA = (a?.added as { id: string }).id;

    const first = await run("james", "drop_item", { itemId: idA });
    const spent = await run("james", "drop_item", {
      itemId: idA,
      confirmationToken: first?.confirmationToken,
    });
    expect(spent?.ok).toBe(true);

    // Re-presenting a spent token must not act a second time, even though the
    // first use was legitimate.
    const again = await run("james", "drop_item", {
      itemId: idA,
      confirmationToken: first?.confirmationToken,
    });
    expectLoudRefusal(again);
  });

  it("cannot ask and answer inside ONE turn — the attack the token alone allowed", async () => {
    const id = await anItem();
    // The model chaining two calls in a single loop, taking the token from its
    // own first call. Nobody was asked: the first answer had not been delivered.
    const { first, second } = await runTwiceInOneTurn(
      "james",
      "drop_item",
      { itemId: id },
      (out) => ({ itemId: id, confirmationToken: out?.confirmationToken }),
    );
    expect(first?.ok).toBe(false);
    expectLoudRefusal(second);
    expect(String(second?.reason)).toMatch(/not asked them yet|same turn/i);
    expect(store.get("james", TODAY)!.plan[0].dropped).toBeUndefined();
  });

  it("cannot chain two bare calls inside one turn either", async () => {
    const id = await anItem();
    const { second } = await runTwiceInOneTurn(
      "james",
      "drop_item",
      { itemId: id },
      () => ({ itemId: id }),
    );
    // The server carries the pending confirmation forward, so the second bare
    // call finds one — and must still refuse it, because it is the same turn.
    expectLoudRefusal(second);
    expect(store.get("james", TODAY)!.plan[0].dropped).toBeUndefined();
  });

  it("a later turn with no token DOES act — the server remembers, so the person can say yes", async () => {
    // This is the ordinary path. Asked live, the model has no token to present:
    // the tool traffic carrying it is not kept between turns. Requiring one made
    // the gate impassable — "yes, go ahead" could never drop anything.
    const id = await anItem();
    const asked = await run("james", "drop_item", { itemId: id });
    expect(asked?.ok).toBe(false);
    expect(store.get("james", TODAY)!.plan[0].dropped).toBeUndefined();

    const acted = await run("james", "drop_item", { itemId: id });
    expect(acted?.ok).toBe(true);
    expect(store.get("james", TODAY)!.plan[0].dropped).toBeDefined();
  });

  it("no token at all still refuses, and says what to do next", async () => {
    const id = await anItem();
    const out = await run("james", "drop_item", { itemId: id });
    expectLoudRefusal(out);
    expect(out?.needsConfirmation).toBe(true);
    expect(store.get("james", TODAY)!.plan[0].dropped).toBeUndefined();
  });
});
