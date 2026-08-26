import type { ModelMessage } from "ai";
import type { ActorId } from "@/spine/operation/types";

/**
 * A daily ceiling on what one person can spend on the assistant.
 *
 * Cheap insurance against the failure mode this project has never had before:
 * every other dependency here is a database that answers in milliseconds and
 * costs nothing per call. A tool loop that goes wrong is a **bill**, and it
 * arrives silently — nothing in the application gets slower or louder while it
 * happens.
 *
 * Deliberately not the two-questions-a-day limiter. That one is about not
 * pestering people (non-negotiable #12) and is a product rule. This is about
 * money, applies to questions the person chose to ask, and is set high enough
 * that no honest day of use will reach it.
 *
 * ── ⚠ This WAS in memory on purpose, and Phase 4.6 reversed that ──────────
 *
 * The original note read:
 *
 *   > In memory on purpose: a restart forgiving somebody's budget is the right
 *   > failure. Making it durable would mean an outage could lock people out of
 *   > the assistant, which is worse than the overspend it would prevent.
 *
 * That reasoning was sound about restarts and silent about the case that
 * actually breaks it: **two servers**. A `Map` per process means each of them
 * believes nothing has been spent, so the ceiling silently becomes two
 * ceilings, three, one per instance — and nothing reports it. A cost guard
 * that multiplies by the deployment is not a cost guard.
 *
 * **So it is durable now, and a restart no longer forgives.** The trade is
 * stated rather than hidden.
 *
 * ⚠ **The original concern is answered rather than dismissed.** The failure it
 * feared — an outage locking people out of the assistant — is prevented by
 * failing OPEN: if the database cannot be reached, the in-process number is
 * used, which is exactly the old behaviour. A database outage degrades this
 * back to what it was before; it does not deny anybody an answer.
 */

/**
 * Enough for a full working day of use. **Not** a rationing device.
 *
 * ── Why this number changed in Phase 3, and how it was arrived at ───────────
 *
 * 200,000 was set when the catalogue was 15 tools, and it survived 33. It was
 * described as "roughly a hundred substantial questions a day", and at 33 tools
 * that was true.
 *
 * At 102 tools it was **seven**. Not seven hundred — seven. Phase 3's first
 * live run exhausted a person's whole allowance after **six questions**, and
 * every one after that got "You have reached today's limit" instead of an
 * answer.
 *
 * The cause is not waste in the loop. **Every tool definition is sent with
 * every request**, and `tool-cost.test.ts` measures the coordinator's set at
 * about 25,000 tokens — before a single word of the question, the records read,
 * or the answer, and re-sent on every step of a multi-step answer.
 *
 * ⚠ **This is a cost guard, never a safety guard.** Nothing about permission,
 * parking or the propose-gate depends on it; hitting it degrades the assistant
 * and leaves every screen working, which is feature 03's promise. So raising it
 * cannot open a hole — the worst case is a larger bill, and at flash-lite rates
 * two million tokens is a few pence per person per day.
 *
 * `tool-cost.test.ts` FAILS if a working day of thirty questions no longer
 * fits, so the next person to add twenty tools finds out there rather than in
 * front of somebody at eleven in the morning.
 *
 * ── The structural fix this defers, deliberately ────────────────────────────
 *
 * Raising a ceiling does not make 25,000 tokens of definitions a sensible thing
 * to send in order to answer "what is on today?". The real answer is the one
 * Phase 3's own plan names: give the coordinator the READ tools plus
 * `consult_specialists`, and let the write tools be loaded only when they are
 * actually needed. A specialist's set measures at about 1,500 tokens, so the
 * headroom is seventeen-fold and not in doubt.
 *
 * It is not done here because it restructures the agent loop, and the plan is
 * explicit that this is a measurement to be acted on rather than predicted —
 * the measurement now exists, and the restructuring should be its own piece of
 * work rather than an afterthought at the end of the largest phase in the plan.
 */
export const DAILY_TOKEN_CEILING = 2_000_000;

/**
 * Durable backing, when there is a database.
 *
 * ⚠ **`add` returns the new total rather than taking one.** A read-then-write
 * from two servers is the same bug in a different place: both read 100,000,
 * both write 150,000, and 50,000 of somebody's spend disappears. The addition
 * happens inside the statement, and the statement says what the total became.
 */
export interface TokenBudgetPersistence {
  spentOn(actor: ActorId, date: string): Promise<number>;
  add(actor: ActorId, date: string, tokens: number): Promise<number>;
}

/**
 * The last number this process knows.
 *
 * No longer the source of truth — it is the **fallback for when the database
 * cannot be reached**, which is what keeps a database outage from locking
 * anybody out of the assistant. See the header.
 */
const spent = new Map<string, number>();
let store: TokenBudgetPersistence | undefined;

function key(actor: ActorId, date: string): string {
  return `${actor}:${date}`;
}

/** Installed by the runtime when a pool exists. Without one, nothing changes. */
export function setTokenBudgetPersistence(persistence: TokenBudgetPersistence | undefined): void {
  store = persistence;
}

export async function tokenBudgetLeft(actor: ActorId, date: string): Promise<number> {
  const k = key(actor, date);
  if (store) {
    try {
      const total = await store.spentOn(actor, date);
      spent.set(k, total);
      return Math.max(0, DAILY_TOKEN_CEILING - total);
    } catch {
      // Fail OPEN, deliberately. A cost guard that becomes an outage is worse
      // than the overspend it prevents — that was the original argument for
      // keeping this in memory, and it is still right about this case.
    }
  }
  return Math.max(0, DAILY_TOKEN_CEILING - (spent.get(k) ?? 0));
}

export async function spendTokens(actor: ActorId, date: string, tokens: number): Promise<void> {
  if (!Number.isFinite(tokens) || tokens <= 0) return;
  const k = key(actor, date);
  const amount = Math.round(tokens);
  // The local number moves first, so a database that is down still costs the
  // asker something within this process rather than being free.
  spent.set(k, (spent.get(k) ?? 0) + amount);
  if (!store) return;
  try {
    spent.set(k, await store.add(actor, date, amount));
  } catch {
    /* the local number stands until the database is reachable again */
  }
}

/** Tests only. */
export function resetTokenBudget(): void {
  spent.clear();
  store = undefined;
}

/**
 * ── Counting a prompt BEFORE it is sent ────────────────────────────────────
 *
 * Everything above charges from `result.usage` — **after** the call. That is
 * exact, and it is the wrong end of the request for two jobs this phase needs:
 *
 *  - Deciding how much conversation to send. `trimHistory` used to count
 *    *messages*, so ten one-word questions and ten thousand-word ones were the
 *    same number to it.
 *  - Knowing that a question will not fit before spending the money finding
 *    out.
 *
 * ⚠ **This is an ESTIMATE and the two numbers will not agree.** The provider
 * tokenises with its own vocabulary, which nothing here can reproduce without
 * shipping a tokeniser. What matters is that it is *the same measure
 * everywhere* — the alternative, and the thing the plan warns against, is a
 * second private notion of size inside `conversation.ts` that drifts from the
 * one the bill is written in.
 *
 * Four characters per token is the usual English approximation and it errs
 * slightly low on prose, slightly high on ids. `PER_MESSAGE_OVERHEAD` is the
 * role and framing every message carries regardless of its content — without
 * it, a hundred empty messages estimate as free, and they are not.
 */
const CHARS_PER_TOKEN = 4;
const PER_MESSAGE_OVERHEAD = 4;

/** Roughly what this text will cost. Never negative, never fractional. */
export function estimateTokens(text: string): number {
  if (!text) return 0;
  return Math.ceil(text.length / CHARS_PER_TOKEN);
}

/** The text of one message, whatever shape its content arrived in. */
function contentOf(message: ModelMessage): string {
  if (typeof message.content === "string") return message.content;
  if (Array.isArray(message.content)) {
    return message.content
      .map((part) =>
        part.type === "text" ? part.text : JSON.stringify(part),
      )
      .join(" ");
  }
  return "";
}

/** Roughly what these messages will cost to send. */
export function estimateMessageTokens(messages: readonly ModelMessage[]): number {
  let total = 0;
  for (const message of messages) {
    total += PER_MESSAGE_OVERHEAD + estimateTokens(contentOf(message));
  }
  return total;
}

/**
 * Roughly what a set of tool definitions costs to send.
 *
 * ⚠ **This is the largest single item in most prompts and the easiest to
 * forget.** Phase 4.5 measured the coordinator's set at 5,462 tokens — down
 * from 26,391 — and every one of those tokens is re-sent on **every step** of
 * a multi-step answer, before a word of the question. A pre-send count that
 * omitted them would report a "prompt" of two hundred tokens and be wrong by a
 * factor of thirty.
 *
 * Measured the same way `tool-cost.test.ts` measures it: name, description and
 * the shape of the input schema, which is what actually travels.
 */
export function estimateToolTokens(tools: Record<string, unknown>): number {
  let chars = 0;
  for (const [name, tool] of Object.entries(tools)) {
    const built = tool as { description?: string; inputSchema?: { shape?: unknown } };
    chars += name.length + (built?.description ?? "").length;
    try {
      chars += JSON.stringify(built?.inputSchema?.shape ?? {}, (_k, v) =>
        typeof v === "function" ? undefined : v,
      ).length;
    } catch {
      /* a schema that will not serialise still costs its description */
    }
  }
  return Math.ceil(chars / CHARS_PER_TOKEN);
}
