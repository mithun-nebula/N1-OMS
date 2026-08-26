import type { ModelMessage } from "ai";
import type { ActorId } from "@/spine/operation/types";
import { estimateMessageTokens, estimateTokens } from "./token-budget";

/**
 * The conversation, so it follows a person between their phone and their desk
 * (feature 07) rather than starting again on every page load.
 *
 * Two rules, both about cost rather than tidiness:
 *
 *  - **Keep what fits in a token budget**, with twenty turns as an outer
 *    bound. Every earlier turn is re-sent on every question, so an unbounded
 *    history is a bill that grows quadratically with how much somebody uses
 *    the thing.
 *  - **Summarise what falls off**, into one system note, rather than dropping
 *    it. A conversation that silently forgets what it was told four questions
 *    ago is worse than one that never remembered.
 *
 * The summary is deliberately mechanical — the questions that were asked, in
 * order. Asking the model to summarise would mean a second model call on the
 * hot path, for a line nobody reads.
 *
 * ── ⚠ Two things Phase 4.6 fixed here, and what they were ──────────────────
 *
 * **1. The note grew forever.** It absorbs the previous note rather than
 * stacking, which is right — a summary of summaries is useless — but nothing
 * bounded the result. It was the ONLY uncapped field in this system. It is now
 * capped in tokens, and the oldest fragment is dropped when the cap is hit,
 * with the elision marked rather than hidden.
 *
 * **2. Trimming counted messages.** `MAX_TURNS` applies to the flat array, so
 * ten one-word questions and ten thousand-word ones were indistinguishable to
 * it. Trimming is now by SIZE, with `MAX_TURNS` kept as the outer bound.
 *
 * ⚠ **The size measure is `estimateTokens`, which is where cost already
 * lives.** Not a second private notion of length in this file. The two numbers
 * are an estimate and a bill and they will not agree exactly; what matters is
 * that there is one of them.
 *
 * ⚠ **This did NOT make the note cleverer, and must not.** A model-based
 * summary is a second call on the hot path, and there is measured evidence
 * elsewhere that summarising makes an agent WORSE — around 13-15% longer
 * trajectories, because a summary hides the natural stopping signal. The note
 * stays mechanical. This bounds it; it does not upgrade it.
 */

/**
 * The outer bound, in messages. Kept.
 *
 * It is no longer the thing that usually fires — `MAX_HISTORY_TOKENS` is — but
 * it stays as the backstop that holds when the estimate is wrong, which for a
 * character-count approximation of somebody else's tokeniser it sometimes will
 * be.
 */
export const MAX_TURNS = 20;

/**
 * The bound that usually fires, in estimated tokens.
 *
 * Roughly the size of the coordinator's whole tool set after Phase 4.5 (5,462
 * tokens), which is the right order of magnitude: a conversation that costs
 * more to carry than every tool the assistant owns is not a conversation, it is
 * a bill.
 */
export const MAX_HISTORY_TOKENS = 4_000;

/**
 * The ceiling on the summary note, in estimated tokens.
 *
 * ⚠ **This is the fix for the one uncapped field.** Each fragment is already
 * clipped to 80 characters, so this is about twelve remembered topics. When it
 * is hit the OLDEST fragment goes, because the recent past is what a follow-up
 * question refers to.
 */
export const MAX_NOTE_TOKENS = 250;

export interface Conversation {
  id: string;
  actor: ActorId;
  messages: ModelMessage[];
  updatedAt: string;
}

export interface ConversationPersistence {
  save(conversation: Conversation): Promise<void>;
  load(id: string): Promise<Conversation | undefined>;
}

/** Marks the note we generate, so trimming twice does not nest summaries. */
const SUMMARY_PREFIX = "Earlier in this conversation, they asked about:";

/**
 * ⚠ **The note is a `user` message, and it used to be a `system` one.**
 *
 * Found live, in Phase 4.6, the first time a conversation ever got past twenty
 * turns through a real screen:
 *
 *     Invalid prompt: System messages are not allowed in the prompt or
 *     messages fields. Use the instructions option instead.
 *
 * The provider rejects a `system` message inside `messages`, so from the
 * twenty-first turn onwards **every question failed**. Nothing had caught it in
 * four phases because nothing had ever sent a history at all — the mechanism
 * was built, tested against itself, and never called.
 *
 * ⚠ **And `instructions` is the wrong home for it, whatever the error says.**
 * The note is built from sentences the person typed. Moving typed text into the
 * system channel would give it the authority of an instruction, which is the
 * one thing `tools/context.ts` and the untrusted-record envelope exist to
 * prevent. A recap of what somebody said belongs in the same channel they said
 * it in.
 *
 * `isSummary` still recognises a `system`-role note, so a conversation stored
 * before this migrates the next time it is trimmed rather than having its note
 * mistaken for a real question.
 */
const SUMMARY_ROLE = "user" as const;

function isSummary(message: ModelMessage): boolean {
  return (
    (message.role === SUMMARY_ROLE || message.role === "system") &&
    typeof message.content === "string" &&
    message.content.startsWith(SUMMARY_PREFIX)
  );
}

function textOf(message: ModelMessage): string {
  if (typeof message.content === "string") return message.content;
  if (Array.isArray(message.content)) {
    return message.content
      .map((part) => (part.type === "text" ? part.text : ""))
      .join(" ")
      .trim();
  }
  return "";
}

/**
 * Marks that the note itself has forgotten something.
 *
 * A capped summary that quietly drops its oldest line is a summary that lies
 * about being complete. One character says otherwise, and it costs one token.
 */
const ELISION = "…";

/**
 * How many messages, from the end, still fit inside both bounds.
 *
 * Walks backwards because the recent past is what a follow-up refers to. Always
 * returns at least the last exchange: a single enormous question must not trim
 * the conversation to nothing, and the question that has just been asked is not
 * optional.
 */
function fitFromEnd(real: ModelMessage[], max: number, maxTokens: number): number {
  const floor = Math.min(2, real.length);
  let count = 0;
  let tokens = 0;
  for (let i = real.length - 1; i >= 0; i--) {
    const next = tokens + estimateMessageTokens([real[i]]);
    if (count >= floor && (count + 1 > max || next > maxTokens)) break;
    tokens = next;
    count++;
  }
  return count;
}

/**
 * Trim the note to its ceiling by dropping the oldest fragments.
 *
 * ⚠ **The fix for the only uncapped field in this system.** The note absorbs
 * its own predecessor rather than stacking — which is correct, a summary of
 * summaries is useless — and before this nothing bounded the result: every
 * fragment ever added stayed forever.
 */
function capFragments(fragments: string[], maxTokens: number): string[] {
  const kept = fragments.filter((f) => f !== ELISION).map(clip);
  let elided = kept.length < fragments.length;
  while (kept.length > 1 && estimateTokens(kept.join("; ")) > maxTokens) {
    kept.shift();
    elided = true;
  }
  // A marker with nothing after it is not a summary of anything.
  if (kept.length === 0) return [];
  return elided ? [ELISION, ...kept] : kept;
}

/**
 * One fragment, clipped.
 *
 * Applied on the way IN as well as on the way out, because a fragment parsed
 * back out of a carried note is only as short as whoever wrote it — and the
 * ceiling has to hold even when the note is one very long fragment.
 */
function clip(topic: string): string {
  return topic.length > 80 ? `${topic.slice(0, 77)}…` : topic;
}

/**
 * Trim to what fits, folding anything older into one system note.
 *
 * Two bounds, and the tighter one wins: `maxTokens` is what usually fires, and
 * `max` is the outer backstop for when a character-count estimate of somebody
 * else's tokeniser is wrong.
 *
 * An existing note is absorbed rather than stacked — otherwise a long-running
 * conversation accumulates a summary of summaries, which is both useless and
 * unbounded, which is the thing being avoided. The absorbed result is then
 * CAPPED, which is what stops "unbounded" being true of the note as well.
 */
export function trimHistory(
  messages: ModelMessage[],
  max: number = MAX_TURNS,
  maxTokens: number = MAX_HISTORY_TOKENS,
): ModelMessage[] {
  const previousNotes = messages.filter(isSummary);
  const real = messages.filter((m) => !isSummary(m));

  const carried = previousNotes.length > 0 ? textOf(previousNotes[previousNotes.length - 1]) : "";
  const earlier = carried
    .replace(SUMMARY_PREFIX, "")
    .replace(" (Context from earlier, not a new question.)", "")
    .replace(/\.\s*$/, "")
    .split(";")
    .map((t) => t.trim())
    .filter(Boolean);

  // The note is part of what gets sent, so it is part of what has to fit.
  const noteBudget = Math.min(MAX_NOTE_TOKENS, maxTokens);
  const keep = fitFromEnd(real, max, Math.max(0, maxTokens - noteBudget));

  if (keep >= real.length) {
    // Nothing new falls off, but a note carried in from a previous trim still
    // has to obey the ceiling — otherwise the cap could be escaped by never
    // trimming again.
    const capped = capFragments(earlier, noteBudget);
    return capped.length > 0 ? [noteOf(capped), ...real] : real;
  }

  const dropped = real.slice(0, real.length - keep);
  const kept = real.slice(real.length - keep);

  const topics = dropped
    .filter((m) => m.role === "user")
    .map((m) => textOf(m).replace(/\s+/g, " ").trim())
    .filter((t) => t.length > 0)
    .map((t) => (t.length > 80 ? `${t.slice(0, 77)}…` : t));

  const all = capFragments([...earlier, ...topics], noteBudget);
  if (all.length === 0) return kept;

  return [noteOf(all), ...kept];
}

function noteOf(fragments: string[]): ModelMessage {
  return {
    role: SUMMARY_ROLE,
    // Labelled, because a recap in the user channel would otherwise read as a
    // fresh question. Mechanical, as it has always been -- no model call.
    content: `${SUMMARY_PREFIX} ${fragments.join("; ")}. (Context from earlier, not a new question.)`,
  };
}

/**
 * In-memory conversations, with optional durable backing.
 *
 * The same shape as `DayPlanStore`: reads stay synchronous after an awaited
 * `load`, and persistence is optional so every existing test is untouched.
 * Writes differ — see `writes` below for why they are chained rather than
 * fired and forgotten.
 */
export class ConversationStore {
  private readonly conversations = new Map<string, Conversation>();
  /**
   * One in-flight write per conversation, chained.
   *
   * `DayPlanStore` fires its saves and forgets them, which is fine there: a
   * plan is written a handful of times a day. A conversation is written on
   * every single turn, and two writes for the same id racing means the row can
   * end up holding an *older* history than the one in memory — the newest
   * question silently missing after a restart. Chaining costs nothing and
   * makes last-write-wins actually mean the last write.
   */
  private readonly writes = new Map<string, Promise<void>>();

  constructor(private readonly persistence?: ConversationPersistence) {}

  /** Resolves when everything queued for this conversation has been written. */
  async flush(id: string): Promise<void> {
    await this.writes.get(id);
  }

  async load(id: string): Promise<Conversation | undefined> {
    const held = this.conversations.get(id);
    if (held) return held;
    if (!this.persistence) return undefined;
    const loaded = await this.persistence.load(id);
    if (loaded) this.conversations.set(id, loaded);
    return loaded;
  }

  /** Append a turn and trim. Returns the history to send with the next question. */
  async append(
    id: string,
    actor: ActorId,
    turns: ModelMessage[],
    now: string = new Date().toISOString(),
  ): Promise<Conversation> {
    const existing = await this.load(id);
    // A conversation belongs to one person. Somebody else's id is a new one,
    // never a way into their history.
    const base = existing && existing.actor === actor ? existing.messages : [];
    const conversation: Conversation = {
      id,
      actor,
      messages: trimHistory([...base, ...turns]),
      updatedAt: now,
    };
    this.conversations.set(id, conversation);
    if (this.persistence) {
      const previous = this.writes.get(id) ?? Promise.resolve();
      const next = previous
        .catch(() => {})
        .then(() => this.persistence!.save(conversation))
        .catch(() => {});
      this.writes.set(id, next);
    }
    return conversation;
  }

  /** What to send with the next question. Empty for an unknown conversation. */
  async historyFor(id: string, actor: ActorId): Promise<ModelMessage[]> {
    const existing = await this.load(id);
    if (!existing || existing.actor !== actor) return [];
    return existing.messages;
  }
}
