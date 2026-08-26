import type { ActorId } from "@/spine/operation/types";

/**
 * A read-back the server can verify, rather than one the model asserts.
 *
 * ── The hole this closes ────────────────────────────────────────────────────
 *
 * `drop_item` and `close_out` took `confirmed: boolean` **in their input
 * schema**. The MODEL set that flag. Nothing anywhere checked that a human had
 * been asked, that a sentence had been read back, or that anybody had said yes
 * — so a model passing `confirmed: true` on its first call dropped the item
 * without a word, and the refusal branch never ran.
 *
 * That is a self-attested guard, which is not a guard. **The one thing a
 * read-back exists to prevent — acting without asking — is precisely what it
 * could not detect.** It held in nineteen live turns because the model was well
 * behaved, not because anything stopped it; Phase 2's own log says exactly that.
 *
 * ── The protocol ────────────────────────────────────────────────────────────
 *
 *  1. First call arrives with nothing pending. The tool does not act. It
 *     returns the consequence sentence and a **server-generated** token, stored
 *     against `(actor, tool, target)` with a short expiry — **and the id of the
 *     turn it was issued in**.
 *  2. The model reads the consequence to the person and its turn ends.
 *  3. The person answers, which starts a NEW turn. Only now will the server
 *     spend the confirmation.
 *
 * ── ⚠ THE TURN BOUNDARY IS THE PART THAT ACTUALLY HOLDS ─────────────────────
 *
 * The first version of this file required the model to present the token back.
 * **Asked for real, that could not work and was worse than useless**, in two
 * ways that only a live conversation showed:
 *
 *  - The token never reached the second turn. `assistantAsk` persists
 *    `{role:"assistant", content: answer}` and nothing else — the tool traffic
 *    carrying the token is deliberately not kept, because re-sending every tool
 *    result on every turn is the cost this codebase's conversation store exists
 *    to avoid. So the model had no token to present, ever. Asked *"yes, go
 *    ahead and drop it"*, it called `drop_item`, got a fresh token, and asked
 *    AGAIN. The gate was not decorative — it was impassable.
 *  - Worse, the token never prevented the thing it was for. Nothing stopped a
 *    model calling `drop_item` twice **inside one loop**, taking the token from
 *    its own first call and spending it immediately, having asked nobody. It
 *    did not do that. But "it behaved" is exactly what Part B exists to stop
 *    relying on.
 *
 * So the guarantee moved to where the server can actually make it. **A model
 * can chain two tool calls; it cannot forge a turn boundary.** A new turn means
 * the answer was delivered to a person and that person sent another message.
 * That is not a claim in a payload — it is a fact about what happened.
 *
 * The token is kept as well, because it costs nothing and binds the
 * confirmation to one actor, one tool and one target, single-use. When the
 * model does present it, that path is taken and is stricter.
 *
 * ── Why there is no table ───────────────────────────────────────────────────
 *
 * In memory, with an expiry, behind an injectable store. A token lives for one
 * conversational turn, so a restart losing it is **correct** behaviour — the
 * person is simply asked again, which is the safe direction to fail in. The
 * seam exists so Phase 3 can swap it if a parked proposal ever needs to outlive
 * a process, which is the lesson `durability.test.ts` already encodes for the
 * limiter and the bus.
 *
 * This is deliberately one weight lighter than the propose-gate in `gate.ts`.
 * They are different things and Phase 3 needs both: the gate PARKS a money or
 * people operation for somebody with authority to release it; this only proves
 * a question was asked in the conversation. Conflating them would either park
 * everything, which is unusable, or park nothing, which is unsafe.
 */

export interface ConfirmationRecord {
  actor: ActorId;
  /** The tool it was issued for. A `drop_item` token is not a `close_out` token. */
  tool: string;
  /**
   * What it is about — a plan item id, a date, whatever the verb acts on.
   * Bound so that agreeing to drop item A cannot be spent on item B.
   */
  target: string;
  expiresAt: number;
  /**
   * The turn that issued it. Spending is refused while this is still the
   * current turn — see the header. This is the check that does the work.
   */
  turnId: string;
  /**
   * ⚠ **The exchange it was asked in.** Added 2026-08-27, after a live run
   * saved a standing rule nobody had agreed to.
   *
   * `turnId` proves a turn boundary was crossed. It does NOT prove the person
   * was answering *this* question — and without a conversation in the key,
   * `findPending` handed a read-back from one chat to a different chat:
   *
   *     conversation ONE   "let me know about courses sitting in review
   *                         too long"   -> read back. NOBODY ANSWERED.
   *     conversation TWO   "flag stale courses for me"
   *                                     -> "I have set up a rule."
   *
   * `phases/phase 4/outcome.md` §9c has the Postgres row. A confirmation
   * belongs to the exchange it was asked in, and now it says so.
   */
  conversation: string;
}

/**
 * Where pending confirmations live.
 *
 * An interface rather than a bare `Map` so Phase 3 can put them somewhere that
 * survives a process without any tool changing.
 */
export interface ConfirmationStore {
  put(token: string, record: ConfirmationRecord): void;
  /** Reads AND removes: a token is single-use, so spending it is taking it. */
  take(token: string): ConfirmationRecord | undefined;
  /**
   * The confirmation already pending for this exact thing, if any.
   *
   * This is how a confirmation survives from the turn that asked to the turn
   * that answers, without the model having to carry anything: the server
   * remembers, and the model cannot make one appear.
   */
  findPending(
    actor: ActorId,
    tool: string,
    target: string,
    conversation: string,
  ): { token: string; record: ConfirmationRecord } | undefined;
  clear(): void;
}

class InMemoryConfirmationStore implements ConfirmationStore {
  private records = new Map<string, ConfirmationRecord>();

  put(token: string, record: ConfirmationRecord): void {
    this.records.set(token, record);
  }

  take(token: string): ConfirmationRecord | undefined {
    const found = this.records.get(token);
    // Removed whether or not it turns out to be valid. A token presented once
    // is spent; leaving a rejected one in place would make repeated
    // presentation a way to probe.
    if (found) this.records.delete(token);
    return found;
  }

  findPending(actor: ActorId, tool: string, target: string, conversation: string) {
    for (const [token, record] of this.records) {
      if (
        record.actor === actor &&
        record.tool === tool &&
        record.target === target &&
        // ⚠ Without this line a read-back left unanswered in one chat is spent
        // by the next sentence in another. See `ConfirmationRecord.conversation`.
        record.conversation === conversation
      ) {
        return { token, record };
      }
    }
    return undefined;
  }

  clear(): void {
    this.records.clear();
  }
}

/**
 * How long a token lives.
 *
 * Long enough for a person to read a sentence and answer, short enough that it
 * is genuinely one turn of a conversation rather than a standing permission.
 */
export const CONFIRMATION_TTL_MS = 5 * 60 * 1000;

/**
 * On `globalThis` for the reason `limiter.ts` and `directory.ts` are: Next.js
 * dev reloads modules, and a plain module-level singleton would be rebuilt
 * empty while a conversation still held a token issued by the old one.
 */
const globalForConfirmations = globalThis as unknown as {
  __orgConfirmationStore?: ConfirmationStore;
  __orgConfirmationClock?: () => number;
};

export function confirmationStore(): ConfirmationStore {
  globalForConfirmations.__orgConfirmationStore ??= new InMemoryConfirmationStore();
  return globalForConfirmations.__orgConfirmationStore;
}

/** Swap the store — the seam Phase 3 would use, and what a test would use. */
export function setConfirmationStore(store?: ConfirmationStore): void {
  globalForConfirmations.__orgConfirmationStore = store;
}

function now(): number {
  return globalForConfirmations.__orgConfirmationClock?.() ?? Date.now();
}

/** Drive time by hand, so "an expired token is refused" is a test and not a wait. */
export function setConfirmationClock(clock?: () => number): void {
  globalForConfirmations.__orgConfirmationClock = clock;
}

export function resetConfirmations(): void {
  confirmationStore().clear();
}

/**
 * A token the model could not have produced.
 *
 * `randomUUID` is cryptographically random, which is the whole point: a
 * guessable token would be exactly as good as the boolean it replaces.
 */
function newToken(): string {
  return `cfm_${globalThis.crypto.randomUUID()}`;
}

export interface IssuedConfirmation {
  ok: false;
  didNotHappen: true;
  needsConfirmation: true;
  reason: string;
  consequence: string;
  confirmationToken: string;
  tellThem: string;
}

/**
 * The first call's answer: nothing happened, here is what would, here is the
 * token to come back with.
 *
 * Shaped as a **refusal**, not as a neutral status. Phase 2 found out the hard
 * way that `{ ok: false }` on its own gets narrated as success — the model
 * replied *"I've added Module 4 (60 minutes)"* when the tool had refused.
 * `didNotHappen` and `tellThem` in the payload fixed it immediately, and they
 * are carried here for the same reason: **a constraint in the tool RESULT is
 * obeyed; the same constraint in the system prompt is obeyed less.**
 */
export function issueConfirmation(input: {
  actor: ActorId;
  tool: string;
  target: string;
  turnId: string;
  /** The exchange this is being asked in. See `ConfirmationRecord`. */
  conversation: string;
  /** What will happen, in words the model can read to the person. */
  consequence: string;
  /** What to say, and what to ask. */
  tellThem: string;
}): IssuedConfirmation {
  // Re-asking in the same turn must not mint a second confirmation, or the
  // first is orphaned and the store grows one entry per retry.
  const already = confirmationStore().findPending(
    input.actor,
    input.tool,
    input.target,
    input.conversation,
  );
  const token = already?.token ?? newToken();
  confirmationStore().put(token, {
    actor: input.actor,
    tool: input.tool,
    target: input.target,
    conversation: input.conversation,
    turnId: already?.record.turnId ?? input.turnId,
    expiresAt: already?.record.expiresAt ?? now() + CONFIRMATION_TTL_MS,
  });
  return {
    ok: false,
    didNotHappen: true,
    needsConfirmation: true,
    reason: input.consequence,
    consequence: input.consequence,
    confirmationToken: token,
    tellThem: input.tellThem,
  };
}

export type SpendResult =
  | { ok: true }
  | { ok: false; reason: string; tellThem: string };

/**
 * Spend a token, or say precisely why not.
 *
 * Every mismatch has the same effect — nothing happens and the person is asked
 * again — but the causes are distinguished so a test can show each attack is
 * refused for the right reason rather than coincidentally.
 */
export function spendConfirmation(input: {
  token: string;
  actor: ActorId;
  tool: string;
  target: string;
  turnId: string;
  /** The exchange it is being spent in. See `ConfirmationRecord`. */
  conversation: string;
}): SpendResult {
  const askAgain =
    "Nothing has changed. Read the consequence back, ask them again, and use the new token you are given.";

  const record = confirmationStore().take(input.token);
  if (!record) {
    return {
      ok: false,
      reason: "That confirmation is not one this server issued, or it has already been used.",
      tellThem: askAgain,
    };
  }
  if (record.expiresAt <= now()) {
    return {
      ok: false,
      reason: "That confirmation has expired.",
      tellThem: askAgain,
    };
  }
  if (record.actor !== input.actor) {
    // Belt and braces: the actor is a closure on every tool, so this should be
    // unreachable from the model. Checked anyway, because the day it IS
    // reachable is the day something else has gone wrong.
    return {
      ok: false,
      reason: "That confirmation was given by somebody else.",
      tellThem: askAgain,
    };
  }
  if (record.tool !== input.tool) {
    return {
      ok: false,
      reason: `That confirmation was for ${record.tool}, not ${input.tool}.`,
      tellThem: askAgain,
    };
  }
  if (record.target !== input.target) {
    return {
      ok: false,
      reason: "That confirmation was about something else.",
      tellThem: askAgain,
    };
  }
  if (record.conversation !== input.conversation) {
    // ⚠ Asked in one exchange, answered in another — which means it was not
    // answered at all. A person who walks away from a question in one chat has
    // not agreed to anything by typing something else in a different one.
    return {
      ok: false,
      reason: "That confirmation was asked for in a different conversation.",
      tellThem: askAgain,
    };
  }
  if (record.turnId === input.turnId) {
    // ⚠ The check that does the work. Asking and answering inside one turn
    // means nobody was asked: the person never saw the question, because the
    // answer had not been delivered yet.
    return {
      ok: false,
      reason: "You have not asked them yet — that confirmation was issued in this same turn.",
      tellThem:
        "Stop here. Tell them what will happen, ask them, and wait for their reply. Do NOT call this tool again until they have answered.",
    };
  }
  return { ok: true };
}

/**
 * The one call a destructive tool makes.
 *
 * Returns `{ act: true }` only when a person has genuinely been asked and has
 * come back. Everything else is a refusal the tool returns as-is.
 *
 * Three routes in, in order of strictness:
 *
 *  1. **A token was presented.** Checked in full — actor, tool, target, expiry,
 *     single use, and the turn boundary.
 *  2. **Nothing presented, but a confirmation is pending from an EARLIER turn.**
 *     Spent. This is the ordinary path, because the tool traffic carrying the
 *     token is not kept between turns and the model therefore has nothing to
 *     present. The server remembers instead.
 *  3. **Nothing presented and nothing pending.** A confirmation is issued and
 *     the call is refused, loudly.
 */
export type ConfirmationOutcome =
  | { act: true }
  | { act: false; result: Record<string, unknown> };

export function requireConfirmation(input: {
  actor: ActorId;
  tool: string;
  target: string;
  turnId: string;
  /**
   * ⚠ The exchange this is being asked in — `ctx.conversationId`.
   *
   * Required, not optional. A caller that could forget it would be a caller
   * that silently reopens §9c, and the whole point of this parameter is that
   * there is no way to be in the old, leaky state by accident.
   */
  conversation: string;
  token?: string;
  consequence: string;
  tellThem: string;
}): ConfirmationOutcome {
  const refuse = (reason: string, tellThem: string): ConfirmationOutcome => ({
    act: false,
    result: {
      ok: false,
      didNotHappen: true,
      needsConfirmation: true,
      reason,
      tellThem: `This did NOT happen: ${reason} ${tellThem}`,
    },
  });

  // ⚠ A token that fails must not leave the caller WORSE OFF than presenting
  // none at all.
  //
  // A live run lost a rule to this. The person said *"yes, that's right"*, the
  // model called the tool again — and presented a token it had carried out of
  // an earlier tool result. The token was stale, this branch refused on the
  // spot, and the real pending confirmation sitting a few lines below, issued
  // by this server in the previous turn, was never looked at. The rule was not
  // saved. The model asked again rather than claiming otherwise, so nobody was
  // told a lie, but the person had to say yes twice for no reason they could
  // see.
  //
  // Falling through weakens nothing: the pending path re-runs every check,
  // including the turn boundary. What it removes is a way for a model's own
  // bookkeeping to block a confirmation a person genuinely gave.
  let tokenRefusal: { reason: string; tellThem: string } | undefined;
  if (input.token) {
    const spent = spendConfirmation({
      token: input.token,
      actor: input.actor,
      tool: input.tool,
      target: input.target,
      turnId: input.turnId,
      conversation: input.conversation,
    });
    if (spent.ok) return { act: true };
    // The one refusal that is never softened. Asked and answered inside a
    // single turn means nobody was asked, and no fallback may paper over it.
    if (spent.reason.includes("same turn")) return refuse(spent.reason, spent.tellThem);
    tokenRefusal = spent;
  }

  const pending = confirmationStore().findPending(
    input.actor,
    input.tool,
    input.target,
    input.conversation,
  );
  if (pending) {
    const spent = spendConfirmation({
      token: pending.token,
      actor: input.actor,
      tool: input.tool,
      target: input.target,
      turnId: input.turnId,
      conversation: input.conversation,
    });
    if (spent.ok) return { act: true };
    // Same turn, or expired. Either way nothing happens — but an expired one is
    // replaced so the next turn has something to spend rather than looping.
    if (spent.reason.includes("expired")) {
      const reissued = issueConfirmation({ ...input, token: undefined } as never);
      return { act: false, result: { ...reissued } };
    }
    return refuse(spent.reason, spent.tellThem);
  }

  // Nothing was pending to fall back on, so a token that failed is now the
  // whole story and the model is told exactly why rather than being handed a
  // fresh token as though it had presented nothing.
  if (tokenRefusal) return refuse(tokenRefusal.reason, tokenRefusal.tellThem);

  const issued = issueConfirmation({
    actor: input.actor,
    tool: input.tool,
    target: input.target,
    turnId: input.turnId,
    conversation: input.conversation,
    consequence: input.consequence,
    tellThem: input.tellThem,
  });
  return { act: false, result: { ...issued } };
}
