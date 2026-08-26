import { describe, it, expect, beforeEach } from "vitest";
import { resetConfirmations, requireConfirmation } from "./confirmation";

/**
 * A bad token must not be worse than no token at all.
 *
 * ── The live run this file exists for ──────────────────────────────────────
 *
 * Somebody was read a standing rule and said *"yes, that's right."* The model
 * called `author_rule` again and, being tidy, presented a `confirmationToken`
 * it had carried out of an earlier tool result. That token was stale.
 *
 * `requireConfirmation` refused on the spot — and never looked at the pending
 * confirmation this server had issued in the previous turn, sitting a few lines
 * further down and perfectly valid. **The rule was not saved.** The model did
 * the right thing and asked again rather than claiming success, so nobody was
 * lied to. But the person said yes twice and could not have told you why.
 *
 * The asymmetry is the bug: presenting NOTHING reached the pending path and
 * worked; presenting something WRONG skipped it. A model's own bookkeeping
 * could veto a confirmation a person had genuinely given.
 *
 * ⚠ The turn boundary is not part of the softening, and the last test here is
 * what says so. Falling back is allowed to forgive a lost token. It is never
 * allowed to forgive nobody having been asked.
 */

const ASK = {
  actor: "james",
  tool: "author_rule",
  target: "rule_james_abc",
  // Every case in this file is ONE exchange — asked in a turn, answered in the
  // next. The conversation is therefore constant, which is what makes these the
  // fallback tests rather than the scoping ones. Crossing an exchange is
  // `rule-confirmation.test.ts`.
  conversation: "chat-1",
  consequence: "This rule will run unattended, from now on.",
  tellThem: "Read it back and wait.",
};

beforeEach(() => {
  resetConfirmations();
});

describe("a lost or invented token falls back to what the server remembers", () => {
  it("the ordinary two-turn path still works with no token at all", () => {
    const first = requireConfirmation({ ...ASK, turnId: "turn_1" });
    expect(first.act).toBe(false);

    const second = requireConfirmation({ ...ASK, turnId: "turn_2" });
    expect(second.act).toBe(true);
  });

  it("A MADE-UP TOKEN DOES NOT DESTROY A REAL CONFIRMATION — the rule that was lost", () => {
    const first = requireConfirmation({ ...ASK, turnId: "turn_1" });
    expect(first.act).toBe(false);

    // The person has said yes. The model presents a token that means nothing.
    const second = requireConfirmation({
      ...ASK,
      turnId: "turn_2",
      token: "conf_something_the_model_remembered_wrong",
    });

    expect(
      second.act,
      "a stale token blocked a confirmation the person had actually given",
    ).toBe(true);
  });

  it("a token for a DIFFERENT rule does not act on this one by falling back", () => {
    // Fallback is keyed on this call's own actor, tool and target — it cannot
    // be steered by what the token pointed at.
    const other = requireConfirmation({
      ...ASK,
      target: "rule_james_other",
      turnId: "turn_1",
    }) as { act: false; result: Record<string, unknown> };
    const otherToken = String(other.result.confirmationToken);
    expect(otherToken).toBeTruthy();

    // Nothing was ever asked about THIS target, so there is nothing to fall
    // back to and the answer is a refusal, not a free pass.
    const out = requireConfirmation({ ...ASK, turnId: "turn_2", token: otherToken });
    expect(out.act).toBe(false);
  });

  it("with nothing pending, a bad token is refused with the reason and not quietly reissued", () => {
    const out = requireConfirmation({
      ...ASK,
      turnId: "turn_1",
      token: "conf_never_issued",
    }) as { act: false; result: Record<string, unknown> };

    expect(out.act).toBe(false);
    expect(out.result.didNotHappen).toBe(true);
    expect(String(out.result.reason)).toMatch(/not one this server issued|already been used/i);
  });

  it("⚠ THE TURN BOUNDARY IS NOT SOFTENED — a real token cannot be spent in its own turn", () => {
    const first = requireConfirmation({ ...ASK, turnId: "turn_1" }) as {
      act: false;
      result: Record<string, unknown>;
    };
    const token = String(first.result.confirmationToken);

    // The genuine token, in the turn that issued it. A model can chain two tool
    // calls; it cannot forge a person's reply.
    const sneaked = requireConfirmation({ ...ASK, turnId: "turn_1", token });
    expect(sneaked.act).toBe(false);
    expect(String((sneaked as { result: Record<string, unknown> }).result.reason)).toMatch(
      /same turn/i,
    );
  });

  it("⚠ and a BAD token cannot be used to sneak past the turn boundary either", () => {
    // The dangerous version of the fallback: ask in this turn, then present
    // rubbish in the SAME turn hoping the fallback spends the pending one.
    requireConfirmation({ ...ASK, turnId: "turn_1" });
    const sneaked = requireConfirmation({ ...ASK, turnId: "turn_1", token: "conf_rubbish" });
    expect(sneaked.act, "the fallback let a model answer its own question").toBe(false);
  });

  /**
   * ⚠ Worth knowing, because it was measured rather than assumed.
   *
   * Deleting the early `same turn` return from `requireConfirmation` does NOT
   * make either of the two tests above fail. The turn boundary is checked a
   * second time inside the pending path, which every fallback route runs
   * through, so removing the first check changes the wording of the refusal and
   * nothing else.
   *
   * That early return is therefore belt-and-braces: it keeps the reason precise
   * for the caller. **The thing actually holding the boundary is
   * `spendConfirmation`**, and that is where to look before trusting any future
   * change here — not at the guard that reads as though it were the important
   * one.
   */
});
