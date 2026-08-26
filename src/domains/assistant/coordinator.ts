import { sanitizeForAppendixD } from "./appendix-d";
import { SPECIALISTS, type AssistantCtx, type Specialist } from "./specialists";

/**
 * The pre-agent coordinator.
 *
 * **The four-regex router has gone.** It matched on words like "leave", "room"
 * and "doc" to guess which specialist should answer, and that keyword matcher
 * is exactly what feature 01 replaces: the agent reads tool descriptions and
 * decides, which is the whole point of writing the descriptions carefully.
 * Keeping both would mean two different things deciding what a question was
 * about, disagreeing quietly.
 *
 * What remains is the fan-out itself — ask every specialist, merge, filter —
 * because **stage 1b needs the `Specialist` interface** for the real fan-out.
 * `/api/assistant/ask` no longer calls this; it goes through the agent.
 */
export interface AssistantAnswer {
  answer: string;
  specialists: string[];
  blocked?: string;
}

export async function ask(query: string, ctx: AssistantCtx): Promise<AssistantAnswer> {
  const chosen: Specialist[] = [...SPECIALISTS];
  const parts = await Promise.all(chosen.map((s) => s.answer(query, ctx)));
  const merged = parts.join(" ");
  const clean = sanitizeForAppendixD(merged);
  return {
    answer: clean,
    specialists: chosen.map((s) => s.id),
    blocked: clean !== merged ? "appendix-d" : undefined,
  };
}
