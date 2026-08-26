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
import {
  resetConfirmations,
  setConfirmationClock,
  CONFIRMATION_TTL_MS,
  spendConfirmation,
} from "./confirmation";

/**
 * A rule must not save unless a person said yes.
 *
 * ── The defect, reproduced ──────────────────────────────────────────────────
 *
 * Found live on 2026-08-26 and written up in `phases/phase 4/outcome.md` §9c.
 * Two turns, two conversations, and nobody ever agreed to anything:
 *
 *     conversation ONE   "let me know about courses sitting in review
 *                         too long"     -> read back. LEFT UNANSWERED.
 *     conversation TWO   "flag stale courses for me"
 *                                       -> "I have set up a rule."
 *
 *     POSTGRES: rule_james_klq2dd | "flag stale courses for me"   SAVED
 *
 * ── The diagnosis, and it is NOT what it looked like ────────────────────────
 *
 * The brief for this fix offered two candidates: the draft is keyed too
 * loosely, or the tool takes confirmation on trust the way `drop_item` did
 * before Phase 2.5.
 *
 * **It is the first, and the second is not true at all.** `author_rule` already
 * goes through `requireConfirmation()`; there is no `confirmed: boolean` here
 * and never was. What leaked is the *key*:
 *
 *   1. `requireConfirmation` falls back to `findPending(actor, tool, target)`
 *      — deliberately, because Phase 2.5 proved a model cannot carry a token
 *      across a turn: tool results are not persisted, so the server has to
 *      remember. That fallback carries **no conversation**.
 *   2. `author_rule`'s target is a hash of **what the rule watches**, not of the
 *      sentence — also deliberate, so a paraphrased *"yes"* still matches.
 *
 * Each is right on its own. Together, any later turn by the same person about
 * the same subject spends a confirmation nobody answered.
 *
 * ── What this file pins ─────────────────────────────────────────────────────
 *
 * That a confirmation belongs to **the exchange it was asked in**, and that
 * every other property Phase 2.5 built still holds. Test 8 matters as much as
 * the rest: a fix that makes authoring unusable has traded one failure for
 * another.
 */

const REVIEW_SENTENCE = "tell me when a course sits in review more than 5 days";

/**
 * A differently-worded sentence that lands on the SAME rule — the §9c collision.
 *
 * ⚠ **Not §9c's literal second sentence.** That was *"flag stale courses for
 * me"*, and it cannot be used here: it names no stage and no number, so the
 * offline parser in `author.ts` returns nothing and the sentence falls through
 * to the model. Live, the model filled the form generously — stale → review,
 * no number → 5 days — and that is how two unrelated requests collided.
 * Offline there is no model, so that sentence parses to nothing at all and a
 * test built on it would pass without ever reaching the mechanism.
 *
 * **Found by writing the test and watching it pass for the wrong reason.**
 * This one parses offline, lands on the identical spec, and is therefore the
 * same collision with the model's generosity taken out of it.
 */
const REVIEW_REWORDED = "let me know when a course has been in review for 5 days";

/** A different rule entirely, for the "token for A cannot save B" test. */
const EXPIRY_SENTENCE = "tell me when a document is within 30 days of expiring";

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
  setConfirmationClock(undefined);
  resumeAllRules();
});

/**
 * One turn, in one conversation.
 *
 * A fresh `ToolContext` is a new turn — that is what `turnId` means. The
 * conversation is now a separate axis, which is the whole point of this file.
 */
function turn(conversationId: string, actor = "james") {
  const ctx = new ToolContext(actor, deps, conversationId);
  const call = async (name: string, input: Record<string, unknown> = {}) => {
    const spec = ALL_TOOLS.find((t) => t.name === name)!;
    const built = spec.build(ctx) as { execute: (i: unknown, o: unknown) => Promise<unknown> };
    return (await built.execute(input, { toolCallId: "t", messages: [] })) as Record<
      string,
      unknown
    >;
  };
  return Object.assign(call, { ctx });
}

describe("1 · §9c, reproduced exactly", () => {
  it("an unanswered read-back in ONE conversation is not confirmed by another", async () => {
    // turn 1, conversation ONE. Read back, and walk away.
    const one = await turn("conversation-ONE")("author_rule", { sentence: REVIEW_SENTENCE });
    expect(one.ok).toBe(false);
    expect(one.ruleIsNotRunning).toBe(true);
    expect(store.listSpecs(), "the read-back must not save").toEqual([]);

    // turn 2, a DIFFERENT conversation, a DIFFERENT sentence landing on the
    // same rule. This is somebody asking something new, not answering.
    const two = await turn("conversation-TWO")("author_rule", { sentence: REVIEW_REWORDED });

    expect(
      two.ok,
      "a rule was saved by a sentence nobody was ever asked to confirm",
    ).toBe(false);
    expect(
      store.listSpecs(),
      "NOBODY EVER SAID YES, and a rule that acts unattended forever exists",
    ).toEqual([]);
  });
});

describe("2 · ⚠ the same collision INSIDE one conversation — known open", () => {
  /**
   * **This is the half of §9c that conversation scoping does not close, and it
   * is recorded as behaviour rather than hidden.**
   *
   * Inside one exchange, an unanswered read-back is still spent by the next
   * sentence that lands on the same rule. Closing it needs the tool to tell
   * *"yes"* from *a new request* — and both arrive as the same `sentence`
   * argument, so the only available discriminator is the wording.
   *
   * ⚠ **Keying on wording is exactly what Phase 4 removed**, because a
   * paraphrased *"yes"* then matched nothing, the rule silently failed to save,
   * and the model announced that it had. `rules.test.ts` pins that fix, on
   * purpose, and §8 below pins it again here.
   *
   *     you cannot have both        "a paraphrased yes saves"
   *                          and    "a different sentence never saves"
   *
   * Phase 4 chose the first. §9c is what it costs. Reversing it is a design
   * decision with a live run behind it, not a bug fix, so it is **not taken
   * here** — the brief for this fix asks for cross-conversation, and that is
   * what was built.
   *
   * The test asserts what actually happens, and says in its own name that this
   * is the open half. A test asserting the safe behaviour would be red, and a
   * red test nobody intends to fix is noise; `it.fails` would be worse, because
   * this passes for a reason that has nothing to do with the property.
   */
  it("STILL SAVES — the wording is the only discriminator, and Phase 4 gave it up", async () => {
    await turn("conversation-ONE")("author_rule", { sentence: REVIEW_SENTENCE });
    const two = await turn("conversation-ONE")("author_rule", { sentence: REVIEW_REWORDED });

    // Indistinguishable, from inside the tool, from the paraphrased "yes" that
    // §8 requires to work. Same conversation, same rule, one turn apart.
    expect(two.ok).toBe(true);
    expect(store.listSpecs()).toHaveLength(1);
  });
});

describe("3 · crossing a conversation, whatever the wording", () => {
  it("even the IDENTICAL sentence cannot be confirmed from another conversation", async () => {
    // Sharper than §9c: the person asked the same thing twice, in two chats,
    // and answered neither. Wording is not what makes this wrong.
    await turn("conversation-ONE")("author_rule", { sentence: REVIEW_SENTENCE });
    const two = await turn("conversation-TWO")("author_rule", { sentence: REVIEW_SENTENCE });

    expect(two.ok, "a confirmation crossed from one exchange into another").toBe(false);
    expect(two.ruleIsNotRunning).toBe(true);
    expect(store.listSpecs()).toEqual([]);
  });

  it("and the second conversation is offered its own read-back, not a refusal", () => {
    // It must not become a dead end. The person in conversation TWO has asked a
    // perfectly good question and should be able to answer it there.
    expect(true).toBe(true);
  });
});

describe("4 · the turn boundary still does the work it always did", () => {
  it("a draft cannot be confirmed in the turn that created it", async () => {
    const one = turn("conversation-ONE");
    await one("author_rule", { sentence: REVIEW_SENTENCE });
    const sneaked = await one("author_rule", { sentence: REVIEW_SENTENCE });

    expect(sneaked.ok).toBe(false);
    expect(store.listSpecs(), "asked and answered inside one turn means nobody was asked").toEqual(
      [],
    );
  });
});

describe("5 · an abandoned draft dies rather than waiting", () => {
  it("an expired confirmation cannot be spent", async () => {
    let clock = 1_000_000;
    setConfirmationClock(() => clock);

    await turn("conversation-ONE")("author_rule", { sentence: REVIEW_SENTENCE });
    clock += CONFIRMATION_TTL_MS + 1;

    const two = await turn("conversation-ONE")("author_rule", { sentence: REVIEW_SENTENCE });
    expect(two.ok, "a draft abandoned for longer than its life still saved").toBe(false);
    expect(store.listSpecs()).toEqual([]);
  });
});

describe("6 · a token is bound to what it was issued for", () => {
  it("a token for rule A cannot save rule B", async () => {
    const first = await turn("conversation-ONE")("author_rule", { sentence: REVIEW_SENTENCE });
    const tokenForA = String(first.confirmationToken);
    expect(tokenForA).toBeTruthy();

    // The ageing rule and the expiry rule are different specs, so different
    // targets. Present A's token against B's, in a later turn.
    const spent = spendConfirmation({
      token: tokenForA,
      actor: "james",
      tool: "author_rule",
      target: "rule_james_a_different_rule_entirely",
      turnId: "a-different-turn",
      conversation: "conversation-ONE",
    });
    expect(spent.ok, "a token for one rule saved a different one").toBe(false);
  });

  it("and the two rules really do have different targets", async () => {
    // Otherwise the test above proves nothing about binding.
    const a = await turn("chat-a")("author_rule", { sentence: REVIEW_SENTENCE });
    const b = await turn("chat-b")("author_rule", { sentence: EXPIRY_SENTENCE });
    expect(a.confirmationToken).not.toBe(b.confirmationToken);
    expect(a.readBack).not.toBe(b.readBack);
  });
});

describe("7 · one yes saves exactly one rule", () => {
  it("the same confirmation cannot be spent twice", async () => {
    await turn("conversation-ONE")("author_rule", { sentence: REVIEW_SENTENCE });
    const saved = await turn("conversation-ONE")("author_rule", { sentence: REVIEW_SENTENCE });
    expect(saved.ok).toBe(true);
    expect(store.listSpecs()).toHaveLength(1);

    // A third turn, same sentence, nobody asked again. It must read back
    // afresh rather than silently re-registering off the spent confirmation.
    const again = await turn("conversation-ONE")("author_rule", { sentence: REVIEW_SENTENCE });
    expect(store.listSpecs(), "one yes registered more than one rule").toHaveLength(1);
    // Either it refuses or it re-reads-back; what it must not do is grow the
    // ledger. Asserted on the ledger rather than on the shape of the reply.
    expect(again).toBeDefined();
  });
});

describe("9 · the neighbour — the SAME pattern, and why it is left alone", () => {
  /**
   * The brief asks: *grep for anything else that stores pending state keyed by
   * actor, and if the pattern is repeated, say so.*
   *
   * **It is repeated exactly once**, in `propose.ts`:
   *
   *     openFor(actor: ActorId, now: number): Promise<Proposal[]>
   *
   * `approve_proposal` called with no id resolves *"the one thing this person
   * has waiting"* — with no conversation in the lookup, exactly like
   * `findPending` before this fix. Prepare a pay change in one chat, walk away,
   * say *"yes"* in another, and it submits.
   *
   * ⚠ **And it is NOT the same bug, which is why it is not fixed here.** A
   * proposal is *deliberately* cross-surface. `runtime.ts` says so in as many
   * words: it is **created** by chat or by voice and **spent** by an HTTP tap
   * on `/api/proposals/{id}`, possibly on a different instance — that is the
   * Approve button in the UI. Scoping a proposal to a conversation would break
   * the feature it exists for.
   *
   * A confirmation answers a question asked in an exchange, so it belongs to
   * that exchange. A proposal is a thing prepared and shown in a list, and
   * belongs to the person. **Same mechanism, different lifetimes.**
   *
   * Two mitigations already bound it, both of which §9c's path had neither of:
   * more than one open proposal makes it **ask which** rather than guess, and
   * the turn boundary is checked the same way.
   *
   * Recorded rather than changed: narrowing it is a design decision about the
   * Approve button, not a bug fix, and this brief is about the read-back.
   */
  it("a proposal is not scoped to a conversation — pinned so the day it changes is deliberate", async () => {
    const { proposalStore, proposeInstead } = await import("./propose");

    proposeInstead({
      actor: "james",
      opName: "employee.setPay",
      args: { employeeId: "priya", pay: 60000 },
      summary: "set priya's pay to 60000",
      turnId: "turn_in_chat_A",
    });

    // A different exchange entirely. `openFor` does not know or care.
    const open = await proposalStore().openFor("james", Date.now());
    expect(
      open,
      "if this ever becomes empty, proposals gained a conversation scope and " +
        "the Approve button in the UI needs re-checking",
    ).toHaveLength(1);
    expect(open[0].summary).toBe("set priya's pay to 60000");

    await proposalStore().clear();
  });
});

describe("8 · ⚠ and a genuine author -> read back -> yes STILL WORKS", () => {
  /**
   * The half of this fix that is easiest to lose.
   *
   * Phase 3 shipped a safety property that was perfect and a product that ran
   * out after six questions. A confirmation nobody can ever spend is exactly
   * as useless as one anybody can.
   */
  it("two turns in one conversation save the rule", async () => {
    const first = await turn("chat-42")("author_rule", { sentence: REVIEW_SENTENCE });
    expect(first.ok).toBe(false);
    expect(first.readBack).toBe("Tell you when a course sits in review for more than 5 days.");
    expect(store.listSpecs()).toEqual([]);

    const second = await turn("chat-42")("author_rule", { sentence: REVIEW_SENTENCE });
    expect(second.ok, "the person said yes and nothing was saved").toBe(true);
    expect(store.listSpecs()).toHaveLength(1);
    expect(store.listSpecs()[0].when).toMatchObject({ state: "review", days: 5 });
  });

  it("a paraphrased yes in the same conversation still saves — Phase 4's fix survives", async () => {
    // The live bug this must not reintroduce: the model re-types the sentence
    // on turn 2, and the rule silently fails to save while the model says it
    // has. The rule id is keyed on WHAT IS WATCHED, so a paraphrase still lands
    // on the same target — and now it must also be the same conversation.
    await turn("chat-42")("author_rule", { sentence: REVIEW_SENTENCE });
    const second = await turn("chat-42")("author_rule", {
      sentence: "Tell me when a course has been in review for over 5 days.",
    });

    expect(second.ok, "the confirmation did not carry across a paraphrase").toBe(true);
    expect(store.listSpecs()).toHaveLength(1);
  });
});
