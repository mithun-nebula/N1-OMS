import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { readFileSync } from "node:fs";
import type { LanguageModel } from "ai";
import { resetProviders, providers } from "@/config/providers";
import { resetEnvCache } from "@/config/env";
import { setFakeLlmScript, resetFakeLlm } from "@/config/llm-fake";
import { extractFacts, rememberFromTurn } from "./extract";
import { MemoryStore } from "./store";

/**
 * What may be remembered, and — much more importantly — what may not.
 *
 * ⚠ **The rule is about SOURCE, not about wording.** Every example appendix D
 * forbids is derived from watching; every one it permits is a fact the
 * application could already see. So the guarantee is that the extractor is
 * shown **only the person's own words** — never the answer, never a tool
 * result — and therefore has nothing to draw a conclusion from.
 *
 * The tests below hold both halves: the guarantee, asserted against the
 * source; and the second line, asserted by feeding it a conclusion and
 * watching it be dropped rather than softened.
 */

function model(): LanguageModel {
  return providers().llm.languageModel();
}

beforeEach(() => {
  process.env.ORG_LLM_PROVIDER = "fake";
  resetEnvCache();
  resetProviders();
  resetFakeLlm();
});

afterEach(() => {
  delete process.env.ORG_LLM_PROVIDER;
  resetEnvCache();
  resetProviders();
  resetFakeLlm();
});

describe("what it keeps", () => {
  it("keeps a stated preference, in the person's words", async () => {
    setFakeLlmScript([{ text: "day|I prefer afternoon reviews" }]);
    expect(await extractFacts(model(), "book the review — I prefer afternoon reviews")).toEqual([
      { domain: "day", text: "I prefer afternoon reviews" },
    ]);
  });

  it("keeps nothing when there is nothing to keep", async () => {
    setFakeLlmScript([{ text: "NOTHING" }]);
    expect(await extractFacts(model(), "what is on me today?")).toEqual([]);
  });

  it("keeps nothing from an empty question, without asking the model", async () => {
    setFakeLlmScript([{ text: "day|invented from nothing" }]);
    expect(await extractFacts(model(), "   ")).toEqual([]);
  });
});

describe("⚠ what it must never keep", () => {
  it("drops a conclusion about the person, rather than softening it", async () => {
    // `sanitizeForAppendixD` replaces a bad sentence with an apology, which is
    // right on the way to a person and WRONG on the way into a table: a stored
    // apology is a fact that says nothing and can never be corrected.
    setFakeLlmScript([{ text: "day|they work more slowly in the afternoons" }]);
    const facts = await extractFacts(model(), "I had a slow afternoon");
    expect(facts).toEqual([]);
  });

  it("drops a comparison between two people", async () => {
    setFakeLlmScript([{ text: "tasks|they are behind compared to Priya" }]);
    expect(await extractFacts(model(), "how am I doing?")).toEqual([]);
  });

  it("drops a fact tagged with an area that does not exist", async () => {
    // No new vocabulary: the areas are the existing DomainId union and nothing
    // else can be written into the `domain` column.
    setFakeLlmScript([{ text: "productivity|I prefer afternoon reviews" }]);
    expect(await extractFacts(model(), "I prefer afternoon reviews")).toEqual([]);
  });

  it("drops a fact too long to be one fact", async () => {
    setFakeLlmScript([{ text: `day|${"x".repeat(400)}` }]);
    expect(await extractFacts(model(), "something")).toEqual([]);
  });

  it("keeps at most two from one turn", async () => {
    setFakeLlmScript([{ text: "day|one\ntasks|two\nmeetings|three\ncourses|four" }]);
    expect(await extractFacts(model(), "several things")).toHaveLength(2);
  });

  it("ignores a reply that is not in the shape it asked for", async () => {
    setFakeLlmScript([{ text: "Sure! Here is what I found for you." }]);
    expect(await extractFacts(model(), "anything")).toEqual([]);
  });
});

describe("⚠ it is shown only what the person said", () => {
  it("takes no answer, no tool result and no record — by signature", () => {
    // The guarantee that makes "never store what the agent concluded" true by
    // CONSTRUCTION rather than by filtering. If the answer were passed in, the
    // model would have the agent's own conclusions in front of it and would
    // eventually write one down as though the person had said it.
    const src = readFileSync("src/domains/assistant/memory/extract.ts", "utf8");
    const signature = src.slice(
      src.indexOf("export async function extractFacts("),
      src.indexOf("): Promise<ExtractedFact[]> {"),
    );
    expect(signature).toContain("question: string");
    expect(signature).not.toContain("answer");
    expect(signature).not.toContain("read");
    expect(signature).not.toContain("ReadRef");
  });

  it("sends the question and nothing else as the prompt", () => {
    const src = readFileSync("src/domains/assistant/memory/extract.ts", "utf8");
    expect(src).toContain("generateText({ model, system: SYSTEM, prompt: said })");
  });
});

describe("⚠ it runs behind the answer, and cannot damage it", () => {
  it("swallows a model failure", async () => {
    const store = await MemoryStore.create();
    // No script queued: the fake runs out and throws.
    setFakeLlmScript([]);
    await expect(
      rememberFromTurn({
        store,
        model: model(),
        actor: "hr-004",
        question: "I prefer afternoon reviews",
      }),
    ).resolves.toBeUndefined();
    expect(await store.allFor("hr-004")).toEqual([]);
  });

  it("writes what it found, tagged with where it came from", async () => {
    const store = await MemoryStore.create();
    setFakeLlmScript([{ text: "day|I prefer afternoon reviews" }]);
    await rememberFromTurn({
      store,
      model: model(),
      actor: "hr-004",
      question: "I prefer afternoon reviews",
      conversationId: "c-abc",
    });
    const facts = await store.allFor("hr-004");
    expect(facts.map((f) => f.text)).toEqual(["I prefer afternoon reviews"]);
    expect(facts[0].source).toBe("c-abc");
  });

  it("the runtime does not await it", () => {
    // The property is an ORDER, and only the source shows it: the answer is
    // returned on the same path whether or not extraction ever finishes.
    const src = readFileSync("src/server/runtime.ts", "utf8");
    expect(src).toContain("void rememberFrom(actor, message, conversationId);");
    expect(src).not.toContain("await rememberFrom(actor");
  });

  it("is skipped entirely when the model was unreachable", () => {
    // Nothing to learn from a turn that did not run — and a model that has just
    // failed to answer is not the one to ask something else.
    const src = readFileSync("src/server/runtime.ts", "utf8");
    expect(src).toContain('if (result.source === "llm") {');
  });
});
