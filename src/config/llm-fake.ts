import { MockLanguageModelV4 } from "ai/test";
import type { LanguageModel } from "ai";
import type {
  LanguageModelV4Content,
  LanguageModelV4FinishReason,
} from "@ai-sdk/provider";

/**
 * A scriptable language model, for tests.
 *
 * The suite must never reach the network — `stub` stays the default provider
 * for exactly that reason — but the agent still has to be exercised end to end:
 * tool selection, tool results coming back, the answer being filtered. This is
 * the model that lets that happen offline and for nothing.
 *
 * Scripted rather than clever. A test says "call `leave_balance` with these
 * arguments, then answer with this sentence", and that is precisely what
 * happens. Nothing here tries to imitate a real model's judgement; asserting
 * against imitated judgement would prove nothing about the real one.
 *
 * Follows the in-file fake convention already in this suite (`FakePersistence`
 * in `assistant.test.ts`, `FakeDays` in `durability.test.ts`). There is no
 * `vi.mock` anywhere in this codebase and this does not introduce one.
 */

export interface FakeStep {
  /** Tool calls this step should make. Empty or absent ends the loop. */
  toolCalls?: Array<{ toolName: string; input: Record<string, unknown> }>;
  /** The text this step emits. */
  text?: string;
}

let script: FakeStep[] = [];
let calls: Array<{ toolName: string; input: Record<string, unknown> }> = [];
let cursor = 0;

/** Queue the steps the fake model will play, in order. */
export function setFakeLlmScript(steps: FakeStep[]): void {
  script = steps;
  calls = [];
  cursor = 0;
}

/** Every tool call the fake made since the script was set. */
export function fakeLlmCalls(): Array<{ toolName: string; input: Record<string, unknown> }> {
  return calls;
}

export function resetFakeLlm(): void {
  script = [];
  calls = [];
  cursor = 0;
}

let idSeq = 0;
function nextId(): string {
  idSeq += 1;
  return `fake_${idSeq}`;
}

export function createFakeLanguageModel(): LanguageModel {
  return new MockLanguageModelV4({
    doGenerate: async () => {
      const step: FakeStep = script[cursor] ?? { text: "" };
      cursor += 1;
      const content: LanguageModelV4Content[] = [];
      for (const call of step.toolCalls ?? []) {
        calls.push(call);
        content.push({
          type: "tool-call",
          toolCallId: nextId(),
          toolName: call.toolName,
          // The wire format is a JSON *string*, as a real provider sends it.
          input: JSON.stringify(call.input),
        });
      }
      if (step.text) content.push({ type: "text", text: step.text });
      // A step that called tools is not finished; one that only spoke is.
      // v4 made both of these structured rather than scalar — `finishReason`
      // carries the provider's raw string beside the unified one, and token
      // counts break down by cache and kind.
      const finishReason: LanguageModelV4FinishReason = {
        unified: step.toolCalls?.length ? "tool-calls" : "stop",
        raw: undefined,
      };
      return {
        finishReason,
        usage: {
          inputTokens: { total: 10, noCache: 10, cacheRead: 0, cacheWrite: 0 },
          outputTokens: { total: 10, text: 10, reasoning: 0 },
        },
        content,
        warnings: [],
      };
    },
  });
}
