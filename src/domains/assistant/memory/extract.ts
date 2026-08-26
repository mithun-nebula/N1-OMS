import { generateText, type LanguageModel } from "ai";
import type { ActorId } from "@/spine/operation/types";
import { enforceAppendixD } from "../appendix-d";
import { DOMAIN_IDS, type DomainId } from "../specialists/domain-ids";
import type { MemoryStore } from "./store";

/**
 * What, if anything, to remember from a turn that has already been answered.
 *
 * ── ⚠ THE RULE, AND WHY IT IS A RULE ABOUT SOURCE RATHER THAN CONTENT ──────
 *
 * Appendix D (`docs/CONTEXT.md:401-422`) forbids precisely the class of
 * statement a longitudinal memory produces:
 *
 *     "You work more slowly in the afternoons"    forbidden
 *     "You should take a break"                   forbidden
 *     "You are behind compared to Priya"          forbidden
 *
 * **Every forbidden example is derived from watching. Every permitted one is a
 * fact the application can already see.** So the rule here is not a list of
 * banned sentences — it is a rule about where a sentence came from:
 *
 *     STORE WHAT THE PERSON TOLD IT.
 *     NEVER STORE WHAT THE AGENT CONCLUDED ABOUT THEM.
 *
 *     "I prefer afternoon reviews"     -> stored. They said it.
 *     "reviews seem to take them 4h"   -> NOT stored. The agent inferred it.
 *
 * Habits, pace and character are then excluded **by construction**: the model
 * is shown only the person's own words, so there is nothing to infer them
 * from. A filter you can argue with is a filter that will eventually be argued
 * with; this one has nothing to argue about, because the material an inference
 * would need was never in front of it.
 *
 * ── ⚠ WHAT THE LOGS SHOWED, HONESTLY ──────────────────────────────────────
 *
 * `prompts.md` says to read real conversations before writing these rules,
 * because rules written earlier would be guesses. **The logs do not contain
 * what that instruction assumed they would.** Every live sentence recorded
 * across Phases 2, 2.5, 3, 4 and 4.5 is a question or a command — *"remind me
 * to send the deck on Thursday"*, *"who is off next week?"*, *"forget the Arun
 * prep"*. **Not one is somebody stating a preference**, and that is not
 * surprising: memory had never run, so there was never any reason to tell it
 * anything.
 *
 * That is a real finding and it decides the design rather than blocking it.
 * **Hand-written phrase patterns are exactly the guess the plan forbids** —
 * `/^I prefer/`, `/from now on/` and the rest would be somebody's imagination
 * of how people talk, pinned into code and wrong in a way nothing would
 * report. So the recognition is done by the model, off the hot path, and the
 * hard guarantees are the two things below, which are code:
 *
 *   1. it sees ONLY the person's own words -- never the answer, never a tool
 *      result, never a record. There is nothing to conclude from.
 *   2. every candidate goes through `enforceAppendixD` and anything it flags
 *      is DROPPED, not softened.
 *
 * ⚠ **When the filter collides with something correct, the precedent is to
 * RENAME THE FIELD, NEVER TO LOOSEN THE FILTER.** Set twice already:
 * `rankedOn` -> `orderedBy` (`phase 1b/outcome.md:450-472`), restated at
 * `phase 2/outcome.md:272-273`.
 *
 * ── Off the hot path, always ──────────────────────────────────────────────
 *
 * The turn returns first; this runs behind it. A slow extraction must never
 * delay an answer, and a failed one must never lose one.
 */

/** Long enough to be a statement, short enough to be one fact. */
const MAX_FACT_LENGTH = 160;

/** Nothing is remembered from more than this many facts in one turn. */
const MAX_FACTS_PER_TURN = 2;

export interface ExtractedFact {
  domain: DomainId;
  text: string;
}

const SYSTEM = [
  "You decide whether a person said something about how they work that is worth remembering for next time.",
  "",
  "You are shown ONE sentence: the person's own words. You are not shown the answer they got, and you never will be.",
  "",
  "Remember only a STANDING FACT THEY STATED about their own work — a preference, a correction, a constraint that will still be true next week.",
  '  "I prefer afternoon reviews"                     -> remember',
  '  "always put me down for the late session"        -> remember',
  '  "I do not take meetings before 10"               -> remember',
  "",
  "Remember NOTHING from a question, a one-off instruction, or a fact about today.",
  '  "what is on me today?"                           -> nothing',
  '  "book the room for Thursday"                     -> nothing',
  '  "I am out on Friday"                             -> nothing, that is leave',
  "",
  "NEVER write a conclusion ABOUT THE PERSON. Not their pace, their habits, their character, or any comparison with anybody else. If they did not say it in this sentence, it does not exist.",
  "",
  "Write what they said, in their words, as one short line. Do not rephrase it into a judgement.",
  "",
  `Reply with one line per fact, at most ${MAX_FACTS_PER_TURN}, each as: area|the fact`,
  `The area must be one of: ${DOMAIN_IDS.join(", ")}`,
  "If there is nothing to remember, reply with exactly: NOTHING",
].join("\n");

/**
 * Ask the model what, if anything, the person stated.
 *
 * ⚠ **`question` only.** Passing the answer as well would be the whole defect
 * in one line: the model would have the agent's own conclusions in front of it
 * and would eventually write one of them down as though the person had said it.
 */
export async function extractFacts(
  model: LanguageModel,
  question: string,
): Promise<ExtractedFact[]> {
  const said = question.trim();
  if (said.length === 0) return [];

  const result = await generateText({ model, system: SYSTEM, prompt: said });
  const reply = result.text.trim();
  if (reply.length === 0 || reply.toUpperCase().startsWith("NOTHING")) return [];

  const out: ExtractedFact[] = [];
  for (const line of reply.split("\n")) {
    if (out.length >= MAX_FACTS_PER_TURN) break;
    const at = line.indexOf("|");
    if (at < 0) continue;
    const domain = line.slice(0, at).trim().toLowerCase();
    const text = line.slice(at + 1).trim();
    if (!isDomain(domain)) continue;
    if (text.length === 0 || text.length > MAX_FACT_LENGTH) continue;

    // ⚠ The second line, and it DROPS rather than softens. `sanitizeForAppendixD`
    // replaces a bad sentence with an apology, which is right for something on
    // its way to a person and wrong for something on its way into a table: a
    // stored apology is a fact that says nothing and can never be corrected.
    //
    // "coaching" — the strict surface. The scheduling relaxation exists for
    // diary facts the assistant composes, and nothing here is composed.
    if (!enforceAppendixD(text, "coaching").ok) continue;

    out.push({ domain, text });
  }
  return out;
}

function isDomain(value: string): value is DomainId {
  return (DOMAIN_IDS as readonly string[]).includes(value);
}

/**
 * Extract and store, behind an answer that has already gone out.
 *
 * ⚠ **Never awaited by the request.** Returns a promise so a test can wait for
 * it; `runtime.ts` deliberately does not. Every failure is swallowed — memory
 * is an improvement to the next answer, never a reason to lose this one.
 */
export async function rememberFromTurn(input: {
  store: MemoryStore;
  model: LanguageModel;
  actor: ActorId;
  question: string;
  conversationId?: string;
}): Promise<void> {
  try {
    const facts = await extractFacts(input.model, input.question);
    for (const fact of facts) {
      await input.store.remember({
        actor: input.actor,
        domain: fact.domain,
        text: fact.text,
        source: input.conversationId,
      });
    }
  } catch {
    /* an answer was already delivered; nothing here may undo that */
  }
}
