import { describe, it, expect } from "vitest";
import type { ModelMessage } from "ai";
import {
  ConversationStore,
  MAX_HISTORY_TOKENS,
  MAX_NOTE_TOKENS,
  MAX_TURNS,
  trimHistory,
} from "./conversation";
import { estimateMessageTokens, estimateTokens } from "./token-budget";

/**
 * ⚠ **Before Phase 4.6 there was no test in this file at all**, and that is
 * not incidental — it is how the summary note stayed the only uncapped field
 * in the system for four phases. `trimHistory` appeared in exactly two places
 * in the whole repository: its own definition, and nothing.
 *
 * Two defects are pinned here:
 *
 *  1. the note absorbed its own predecessor and grew forever
 *  2. trimming counted MESSAGES, so ten one-word questions and ten
 *     thousand-word ones were the same number to it
 */

const NOTE = "Earlier in this conversation, they asked about:";

/**
 * The fixed wrapper around the fragments: the prefix, and the label that keeps
 * a recap in the user channel from reading as a fresh question.
 *
 * `MAX_NOTE_TOKENS` caps the FRAGMENTS. Stating the envelope separately is what
 * keeps these assertions about the thing that can grow -- a single fudge factor
 * would have to be widened every time the wording changed, and would hide a
 * real leak the day it was.
 */
const ENVELOPE = `${NOTE} (Context from earlier, not a new question.)`;
const NOTE_CEILING = MAX_NOTE_TOKENS + estimateTokens(ENVELOPE) + 4;

/**
 * One exchange, with a FIXED-WIDTH counter.
 *
 * `question 999` is three characters wider than `question 99`, and a note that
 * remembers the same NUMBER of topics at turn 1,000 as at turn 100 is then a
 * few characters longer. That is the width of the counter, not growth — and
 * padding it here is what lets the tests below compare sizes directly instead
 * of carrying a tolerance that would also hide a real leak.
 */
function exchange(n: number, size = 10): ModelMessage[] {
  const id = String(n).padStart(4, "0");
  return [
    { role: "user", content: `question ${id} ${"q".repeat(size)}` },
    { role: "assistant", content: `answer ${id} ${"a".repeat(size)}` },
  ];
}

/**
 * Found by its PREFIX, not by its role.
 *
 * ⚠ The note was a `system` message until Phase 4.6 found — live, on the
 * twenty-first turn of the first real conversation — that the provider refuses
 * one inside `messages`. It is a labelled `user` message now. Matching on the
 * prefix is what the production code does too, so a test and the thing it
 * tests agree about what a note is.
 */
function isNote(m: ModelMessage): boolean {
  return typeof m.content === "string" && m.content.startsWith(NOTE);
}

function noteIn(messages: ModelMessage[]): string | undefined {
  const found = messages.find(isNote);
  return found && typeof found.content === "string" ? found.content : undefined;
}

/** Drive a conversation the way the store does: append, trim, feed back in. */
function converse(turns: number, size = 10, max = MAX_TURNS, maxTokens = MAX_HISTORY_TOKENS) {
  let history: ModelMessage[] = [];
  for (let i = 1; i <= turns; i++) {
    history = trimHistory([...history, ...exchange(i, size)], max, maxTokens);
  }
  return history;
}

describe("⚠ the summary note stops growing", () => {
  it("is bounded after a hundred turns", () => {
    const history = converse(100);
    const note = noteIn(history);
    expect(note).toBeDefined();
    // The assertion the old code could not have passed: every question ever
    // asked was carried into the next note, forever.
    expect(estimateTokens(note!)).toBeLessThanOrEqual(NOTE_CEILING);
  });

  it("a thousand turns is no larger than a hundred", () => {
    // The shape of the defect, stated directly: growth with usage. The note
    // fills up to its ceiling and then STOPS — so the comparison has to be
    // between two conversations that have both reached it. Against a
    // conversation short enough not to have filled it yet, growth and a
    // working cap look identical.
    const hundred = noteIn(converse(100))!;
    const thousand = noteIn(converse(1_000))!;
    expect(thousand.length).toBeLessThanOrEqual(hundred.length);
    expect(estimateTokens(thousand)).toBeLessThanOrEqual(NOTE_CEILING);
  });

  it("says so when it has forgotten something, rather than quietly dropping it", () => {
    const note = noteIn(converse(100))!;
    expect(note).toContain("…");
  });

  it("keeps the most recent topics, not the oldest", () => {
    const note = noteIn(converse(60))!;
    // A follow-up refers to the recent past, so that is the half kept.
    expect(note).toContain("question 0050 ");
    expect(note).not.toContain("question 0001 ");
    expect(note).not.toContain("question 0009 ");
  });

  it("never nests a summary inside a summary", () => {
    const history = converse(50);
    const notes = history.filter(isNote);
    expect(notes).toHaveLength(1);
    expect(notes[0].content).not.toContain(`${NOTE} ${NOTE}`);
  });

  it("caps a note carried in from elsewhere even when nothing new falls off", () => {
    // The escape hatch that would otherwise exist: a note is only rebuilt when
    // something is dropped, so an oversized one could ride along untouched.
    const huge: ModelMessage = {
      role: "system",
      content: `${NOTE} ${Array.from({ length: 200 }, (_, i) => `topic ${i}`).join("; ")}.`,
    };
    const trimmed = trimHistory([huge, ...exchange(1)]);
    expect(estimateTokens(noteIn(trimmed)!)).toBeLessThanOrEqual(NOTE_CEILING);
  });
});

describe("⚠ trimming responds to size, not to message count", () => {
  it("ten short exchanges and ten long ones are no longer the same thing", () => {
    const short = converse(10, 10);
    const long = converse(10, 4_000);
    // Both are ten exchanges. MAX_TURNS cannot tell them apart; this can.
    expect(short.length).toBeGreaterThan(long.length);
    expect(noteIn(short)).toBeUndefined();
    expect(noteIn(long)).toBeDefined();
  });

  it("what is sent stays under the token bound", () => {
    for (const size of [10, 500, 4_000]) {
      const history = converse(40, size);
      expect(
        estimateMessageTokens(history),
        `a conversation of ${size}-character turns came back at ${estimateMessageTokens(history)}`,
      ).toBeLessThanOrEqual(MAX_HISTORY_TOKENS + MAX_NOTE_TOKENS);
    }
  });

  it("MAX_TURNS remains as the outer bound", () => {
    // Tiny messages: the token bound never fires, so the message bound must.
    const history = converse(200, 1);
    expect(history.filter((m) => !isNote(m)).length).toBeLessThanOrEqual(MAX_TURNS);
  });

  it("uses the same measure cost does, not a private one of its own", async () => {
    // The plan's instruction, pinned against the source: DO NOT INTRODUCE A
    // SECOND NOTION OF SIZE. `estimateTokens` lives in token-budget.ts beside
    // the charge from `result.usage`, so the number that trims and the number
    // that bills cannot drift apart.
    const { readFileSync } = await import("node:fs");
    const src = readFileSync("src/domains/assistant/conversation.ts", "utf8");
    expect(src).toContain('from "./token-budget"');
    // A local character-count would be the drift starting. There is one
    // division in this file and it is not this.
    expect(src).not.toMatch(/length\s*\/\s*4/);
  });

  it("never trims away the question that was just asked", () => {
    // One enormous message must not leave the model with nothing at all.
    const enormous: ModelMessage[] = [
      { role: "user", content: "x".repeat(200_000) },
      { role: "assistant", content: "y".repeat(200_000) },
    ];
    const trimmed = trimHistory(enormous);
    expect(trimmed.filter((m) => !isNote(m))).toHaveLength(2);
  });
});

describe("⚠ nothing the provider refuses ever reaches the messages array", () => {
  /**
   * **The bug this phase found live, and the only one tests could not have.**
   *
   * The note was a `system` message. The provider answers a `system` message
   * inside `messages` with
   *
   *     Invalid prompt: System messages are not allowed in the prompt or
   *     messages fields. Use the instructions option instead.
   *
   * so from the TWENTY-FIRST TURN onward, every question failed with "The
   * assistant could not answer that just now."
   *
   * It survived four phases because the history was never sent: the store, the
   * trimming and the actor check were all built, tested against themselves, and
   * reached by nothing. Switching feature 07 on is what ran it for the first
   * time — and a twenty-turn conversation is what it takes to reach.
   */
  it("a trimmed history contains no system message", () => {
    const history = converse(60);
    expect(history.filter((m) => m.role === "system")).toEqual([]);
  });

  it("the note is still there, as a labelled user message", () => {
    const history = converse(60);
    const note = history.find(isNote);
    expect(note).toBeDefined();
    expect(note!.role).toBe("user");
    // Labelled, so a recap in the user channel does not read as a question.
    expect(note!.content).toContain("not a new question");
  });

  it("a note stored under the old shape is recognised and migrated", () => {
    // A conversation written before this fix holds a system-role note. It must
    // be absorbed like any other note — not mistaken for a real question and
    // re-sent forever.
    const old: ModelMessage = { role: "system", content: `${NOTE} something old.` };
    const trimmed = trimHistory([old, ...exchange(1)]);
    expect(trimmed.filter((m) => m.role === "system")).toEqual([]);
    expect(noteIn(trimmed)).toContain("something old");
  });

  it("the agent drops a system message even so", async () => {
    // Belt and braces, asserted against the source: `trimHistory` no longer
    // produces one, and the send path would survive it if something did.
    const { readFileSync } = await import("node:fs");
    const src = readFileSync("src/domains/assistant/agent.ts", "utf8");
    expect(src).toContain('history.filter((m) => m.role !== "system")');
  });
});

describe("the note is still mechanical", () => {
  it("is the questions that were asked, in order — no model call", () => {
    const note = noteIn(converse(40))!;
    const topics = note.slice(NOTE.length).split(";").map((t) => t.trim());
    const numbered = topics.filter((t) => t.startsWith("question ")).map((t) => Number(t.split(" ")[1]));
    expect(numbered.length).toBeGreaterThan(1);
    expect([...numbered].sort((a, b) => a - b)).toEqual(numbered);
  });
});

describe("the store still belongs to one person", () => {
  it("trimming did not disturb the actor check", async () => {
    const store = new ConversationStore();
    for (let i = 1; i <= 40; i++) {
      await store.append("c-1", "hr-004", exchange(i));
    }
    expect((await store.historyFor("c-1", "hr-004")).length).toBeGreaterThan(0);
    expect(await store.historyFor("c-1", "hr-005")).toEqual([]);
  });

  it("a long conversation still ends with the last thing said", async () => {
    const store = new ConversationStore();
    for (let i = 1; i <= 40; i++) {
      await store.append("c-1", "hr-004", exchange(i));
    }
    const history = await store.historyFor("c-1", "hr-004");
    expect(history[history.length - 1].content).toContain("answer 0040");
  });
});
