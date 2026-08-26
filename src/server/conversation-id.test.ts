import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { assistantConversationId } from "./conversation-id";
import { ConversationStore } from "@/domains/assistant/conversation";

/**
 * Feature 07 — *"remembers earlier conversations, follows you between phone and
 * computer"* — and the id that makes it true.
 *
 * The mechanism has existed since Phase 1a, tested at
 * `store-pg.test.ts:555-599`, and **was reached by nothing**: `assistantAsk`
 * loads history only when handed a `conversationId`, and no screen sent one.
 * These tests hold the two halves of the fix — an id that is the same on every
 * device, and a screen that actually sends it.
 */

describe("the conversation id follows the person, not the device", () => {
  it("is the same string every time for one actor", () => {
    // The whole feature in one assertion. A `localStorage` id or a
    // `useRef(crypto.randomUUID())` fails this, and both are the obvious
    // implementations.
    expect(assistantConversationId("hr-004")).toBe(assistantConversationId("hr-004"));
  });

  it("differs between two people", () => {
    expect(assistantConversationId("hr-004")).not.toBe(assistantConversationId("hr-005"));
  });

  it("discloses nothing guessable about the person", () => {
    // The trap the plan names: the id is caller-supplied and opaque, so one
    // that reads `assistant:priya` is a guess away from naming somebody else.
    const id = assistantConversationId("priya-hr-004");
    expect(id).not.toContain("priya");
    expect(id).not.toContain("hr-004");
    expect(id).toMatch(/^c-[A-Za-z0-9_-]{32}$/);
  });
});

describe("⚠ the actor check is the boundary, not the id", () => {
  it("a stolen id still yields an empty history", async () => {
    const store = new ConversationStore();
    const id = assistantConversationId("hr-004");
    await store.append(id, "hr-004", [
      { role: "user", content: "what is my pay?" },
      { role: "assistant", content: "…" },
    ]);

    expect(await store.historyFor(id, "hr-004")).toHaveLength(2);
    // Somebody else holding the exact string gets nothing — and gets it as
    // EMPTY, not as an error. Non-negotiable #2: a refusal must not disclose
    // that a record exists.
    expect(await store.historyFor(id, "hr-005")).toEqual([]);
  });

  it("the check itself is untouched", () => {
    // Pinned against the source because the temptation this phase creates is
    // to turn the empty array into a friendlier message, and that would be a
    // disclosure.
    const src = readFileSync("src/domains/assistant/conversation.ts", "utf8");
    expect(src).toContain("if (!existing || existing.actor !== actor) return [];");
    expect(src).toContain("existing && existing.actor === actor ? existing.messages : []");
  });
});

/** Source with comments removed, so a warning about a mistake is not read as one. */
function code(path: string): string {
  return readFileSync(path, "utf8")
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/^\s*\/\/.*$/gm, "");
}

describe("⚠ a screen actually sends it — the thing that had never happened", () => {
  const client = code("src/app/assistant/assistant-client.tsx");
  const page = code("src/app/assistant/page.tsx");

  it("the assistant screen posts a conversationId to /api/assistant/ask", () => {
    expect(client).toContain("/api/assistant/ask");
    expect(client).toContain("JSON.stringify({ message, conversationId })");
  });

  it("the id comes from the server, not from the browser", () => {
    // Where it is computed is the difference between "follows you between
    // phone and computer" and "starts again on the other device".
    expect(page).toContain("assistantConversationId(user.id)");
    // Against the code, not the comments: the client's own header names both
    // of these as the wrong answers, so a raw substring match would find the
    // warning rather than the mistake.
    expect(client).not.toContain("localStorage");
    expect(client).not.toContain("randomUUID");
  });
});
