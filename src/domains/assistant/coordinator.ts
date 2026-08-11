import { sanitizeForAppendixD } from "./appendix-d";
import { SPECIALISTS, type AssistantCtx, type Specialist } from "./specialists";

function pickSpecialists(query: string): Specialist[] {
  const q = query.toLowerCase();
  const matches: Specialist[] = [];
  if (/(wait|approv|leave)/.test(q)) matches.push(...SPECIALISTS.filter((s) => s.id === "people"));
  if (/(course|behind|review|stale)/.test(q)) matches.push(...SPECIALISTS.filter((s) => s.id === "courses"));
  if (/(room|hall|book)/.test(q)) matches.push(...SPECIALISTS.filter((s) => s.id === "rooms"));
  if (/(doc|expir|announce|polic)/.test(q)) matches.push(...SPECIALISTS.filter((s) => s.id === "documents"));
  return matches.length > 0 ? matches : SPECIALISTS;
}

export interface AssistantAnswer {
  answer: string;
  specialists: string[];
  blocked?: string;
}

export async function ask(query: string, ctx: AssistantCtx): Promise<AssistantAnswer> {
  const chosen = pickSpecialists(query);
  const parts = await Promise.all(chosen.map((s) => s.answer(query, ctx)));
  const merged = parts.join(" ");
  const clean = sanitizeForAppendixD(merged);
  return {
    answer: clean,
    specialists: chosen.map((s) => s.id),
    blocked: clean !== merged ? "appendix-d" : undefined,
  };
}
