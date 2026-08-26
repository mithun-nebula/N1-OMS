import { z } from "zod";
import { providers } from "@/config/providers";
import type { ActorId } from "@/spine/operation/types";
import { describeSpec, type RuleSpec, type RuleWhen } from "./spec";

/**
 * Turning a sentence into a rule.
 *
 * ── ⚠ The model runs EXACTLY ONCE — when the rule is written. Never again ───
 *
 * Calling a model on every tick would give cost that scales with the record
 * count, drift between one run and the next, and a rule nobody can audit
 * because it never runs the same way twice. The saved form runs identically
 * forever, for free.
 *
 * ── The model's only job is filling blanks ─────────────────────────────────
 *
 * It never writes code, never invents a condition, and never picks an operation
 * outside the `DO` list. **Anything a model could invent here is something
 * nobody would ever review** — and a rule is reviewed once and then trusted for
 * months.
 *
 * Everything it returns is parsed against the schema below. A shape that does
 * not fit is a refusal, not a best effort.
 *
 * ── Refusing beats guessing ────────────────────────────────────────────────
 *
 * Three ways this says no, and each is better than the alternative:
 *
 *  - **Unmeasurable.** *"Let me know if things seem to be slipping"* — it says
 *    so, and names what it would need instead.
 *  - **Ambiguous.** *"Which courses are in review over 5 days?"* and *"Tell me
 *    when a course sits in review over 5 days"* are nearly the same sentence
 *    and completely different things. **It asks.** Guess "rule" and somebody
 *    has silently signed up for notifications forever; guess "question" and the
 *    rule they meant never exists.
 *  - **Out of reach.** A sentence needing an action outside `DO` is refused
 *    with the reason, not approximated into a notification.
 *
 * **A rule that fires on the wrong thing forever is worse than no rule.**
 */

const WHEN_SCHEMA = z.discriminatedUnion("kind", [
  z.object({
    kind: z.literal("ageing"),
    nodeType: z.literal("course"),
    state: z.string(),
    days: z.number().int().positive(),
  }),
  z.object({
    kind: z.literal("expiring"),
    nodeType: z.literal("document"),
    withinDays: z.number().int().positive(),
  }),
  z.object({
    kind: z.literal("countOver"),
    nodeType: z.literal("task"),
    per: z.string(),
    count: z.number().int().positive(),
    status: z.string().optional(),
  }),
  z.object({ kind: z.literal("absent"), nodeType: z.literal("employee") }),
]);

const FORM_SCHEMA = z.object({
  /** `rule` · `question` · `unmeasurable` · `unsupported-action` */
  verdict: z.enum(["rule", "question", "ambiguous", "unmeasurable", "unsupported-action"]),
  when: WHEN_SCHEMA.optional(),
  /** Why it could not be filled, in words for the person. */
  reason: z.string().optional(),
  /** What it would need instead, when it cannot measure something. */
  couldMeasure: z.string().optional(),
});

export type AuthorOutcome =
  | { ok: true; spec: RuleSpec; readBack: string }
  | {
      ok: false;
      kind: "ambiguous" | "unmeasurable" | "unsupported-action" | "unparsed";
      reason: string;
      /** The question to put to them, when asking is the right answer. */
      ask?: string;
    };

const SYSTEM = [
  "You turn one sentence into a standing rule, by filling a fixed form. You never write code and never invent a condition.",
  "",
  "Return ONLY JSON matching this shape:",
  '{ "verdict": "rule" | "question" | "ambiguous" | "unmeasurable" | "unsupported-action",',
  '  "when": { ... }, "reason": "...", "couldMeasure": "..." }',
  "",
  "`when` must be exactly one of these four and nothing else:",
  '  { "kind":"ageing", "nodeType":"course", "state":"review", "days":5 }',
  '  { "kind":"expiring", "nodeType":"document", "withinDays":30 }',
  '  { "kind":"countOver", "nodeType":"task", "per":"assignedTo", "count":10, "status":"todo" }',
  '  { "kind":"absent", "nodeType":"employee" }',
  "",
  'A rule can ONLY notify somebody. If the sentence asks to create, assign, approve or change anything, return "unsupported-action" and say so in `reason`.',
  'If the sentence describes something you cannot measure with the four kinds above, return "unmeasurable" and put what you WOULD need in `couldMeasure`.',
  'If it could equally be a one-off question or a standing rule, return "ambiguous". Do NOT guess.',
  "",
  "Examples of ambiguity: \"which courses are in review over 5 days\" is a question; \"tell me when a course sits in review over 5 days\" is a rule; \"courses in review over 5 days\" is ambiguous.",
].join("\n");

/** What asks-for-a-rule looks like, and what asks-a-question looks like. */
const RULE_MARKERS =
  /\b(tell me when|let me know when|notify me when|alert me when|remind me when|whenever|every time|from now on|watch for|keep an eye|ping me|flag it|give me a shout|drop me a line|heads[-\s]?up|tell me|let me know|notify me|alert me)\b/i;

/**
 * ⚠ "when" is deliberately NOT in this list.
 *
 * *"When a course sits in review more than 5 days, tell me"* is the canonical
 * way somebody writes a rule, and an earlier version treated a leading "when"
 * as interrogative — so that sentence came back as *"that reads like a
 * question"*, which is both wrong and baffling to the person who wrote it.
 *
 * A genuine question opening with "when" — *"when is the review?"* — ends in a
 * question mark, which the second alternative catches.
 */
const QUESTION_MARKERS = /^(which|what|who|how many|show me|list|are there)\b|\?\s*$/i;

/**
 * The same refusal from every branch.
 *
 * It used to live in the course branch alone, which meant *"cancel the
 * certificate when it is a month from expiring"* would have been authored as a
 * notification. Every branch that can now read a duration has to be able to
 * refuse one.
 */
function unsupportedAction(): z.infer<typeof FORM_SCHEMA> {
  return {
    verdict: "unsupported-action",
    reason: "A rule can only notify somebody — it cannot create, assign or change anything.",
  };
}

const NUMBER_WORDS: Record<string, number> = {
  a: 1,
  an: 1,
  one: 1,
  two: 2,
  three: 3,
  four: 4,
  five: 5,
  six: 6,
  seven: 7,
  eight: 8,
  nine: 9,
  ten: 10,
  fourteen: 14,
  thirty: 30,
};

/**
 * How long, in days — read from English rather than from digits.
 *
 * ⚠ A live run said *"say within a fortnight"*. There is no digit in that
 * sentence, so this returned nothing, the model was asked instead, and it came
 * back **"I cannot measure that"** — for a rule this system can express
 * exactly. The person was told no for a sentence that was perfectly clear.
 *
 * Nobody writes "14 days" when they mean a fortnight. Reading the words costs
 * a lookup table and removes a whole class of refusal that was never about
 * capability, only about spelling.
 */
function durationDays(text: string): number | undefined {
  if (/\bfortnight\b/.test(text)) return 14;
  const m = text.match(
    /\b(\d+|a|an|one|two|three|four|five|six|seven|eight|nine|ten|fourteen|thirty)\s*(day|week|month)s?\b/,
  );
  if (!m) return undefined;
  const n = /^\d+$/.test(m[1]) ? Number(m[1]) : NUMBER_WORDS[m[1]];
  if (n === undefined) return undefined;
  return m[2] === "week" ? n * 7 : m[2] === "month" ? n * 30 : n;
}

/**
 * The offline path — no model.
 *
 * Not a fallback bolted on: `generateDeck` established this shape for every
 * model call in this codebase, and it is what lets the whole test suite run
 * without a provider. It handles the sentence shapes the four kinds cover, and
 * defers to the model for anything else rather than guessing.
 */
export function fillFormOffline(sentence: string): z.infer<typeof FORM_SCHEMA> | undefined {
  const text = sentence.toLowerCase();

  const asksForRule = RULE_MARKERS.test(text);
  const asksQuestion = QUESTION_MARKERS.test(sentence.trim());
  if (asksQuestion && !asksForRule) return { verdict: "question" };

  // ⚠ "reassign" is on this list because of a live run, and it is the most
  // dangerous entry here. The sentence was *"when a course has been in review a
  // week, reassign it to Karthik"*, and `\bassign\b` does NOT match inside
  // "reassign" — there is no word boundary after "re". While the parser could
  // not read "a week" that sentence fell through to the model, which refused it
  // correctly. The moment `durationDays` above learned to read it, the sentence
  // would have been authored offline as a **notification** instead: the person
  // asks for work to be moved, and silently signs up to be told about it
  // forever. Widening what this file understands widens what it can quietly get
  // wrong — so the action list had to widen first.
  //
  // ⚠ And the idioms come out first. *"give me a shout"* is how half the
  // organisation asks to be notified, and `\bgive\b` read it as an action — so
  // the fortnight sentence above was refused as "a rule cannot give things",
  // which is both wrong and impossible to argue with. These phrases are
  // notification, never a change to a record.
  const forActs = text.replace(
    /\b(give|drop|shoot|send)\s+me\s+a\s+(shout|heads[-\s]?up|nudge|line|note|message|ping)\b/g,
    " ",
  );
  const acts =
    /\b(re-?assign|assign|create|approve|decline|delete|cancel|book|give|set|move|hand over)\b/.test(
      forActs,
    );

  const days = (re: RegExp): number | undefined => {
    const m = text.match(re);
    return m ? Number(m[1] ?? m[2]) : undefined;
  };

  if (text.includes("course") && /review|draft|build|sign-?off/.test(text)) {
    const n = durationDays(text);
    if (n === undefined) return undefined;
    const state = /draft/.test(text) ? "draft" : /build/.test(text) ? "build" : "review";
    if (acts) return unsupportedAction();
    return {
      verdict: asksForRule ? "rule" : "ambiguous",
      when: { kind: "ageing", nodeType: "course", state, days: n },
    };
  }

  if (/expir|certificate|renewal/.test(text)) {
    const n = durationDays(text);
    if (n === undefined) return undefined;
    if (acts) return unsupportedAction();
    return {
      verdict: asksForRule ? "rule" : "ambiguous",
      when: { kind: "expiring", nodeType: "document", withinDays: n },
    };
  }

  if (/task/.test(text) && /more than|over|at least/.test(text)) {
    const n = days(/(?:more than|over|at least)\s*(\d+)/);
    if (n === undefined) return undefined;
    if (acts) return unsupportedAction();
    return {
      verdict: asksForRule ? "rule" : "ambiguous",
      when: { kind: "countOver", nodeType: "task", per: "assignedTo", count: n, status: "todo" },
    };
  }

  if (/(never supplied|not supplied|missing|outstanding).*(document|paperwork|proof)|document.*(never|missing)/.test(text)) {
    if (acts) return unsupportedAction();
    return {
      verdict: asksForRule ? "rule" : "ambiguous",
      when: { kind: "absent", nodeType: "employee" },
    };
  }

  return undefined;
}

export interface AuthorOptions {
  /** Injected for tests, and so the offline path is reachable deliberately. */
  complete?: (prompt: string, opts?: { system?: string }) => Promise<string>;
  /** The person has already said whether they meant a rule. Skips the ask. */
  confirmedStanding?: boolean;
  now?: () => string;
}

export async function authorRule(
  sentence: string,
  author: ActorId,
  ruleId: string,
  options: AuthorOptions = {},
): Promise<AuthorOutcome> {
  const now = options.now ?? (() => new Date().toISOString());

  let form = fillFormOffline(sentence);

  if (!form) {
    // Only now is the model asked, and only to fill blanks in a fixed shape.
    const complete = options.complete ?? ((p, o) => providers().llm.complete(p, o));
    try {
      const raw = await complete(sentence, { system: SYSTEM });
      const json = raw.slice(raw.indexOf("{"), raw.lastIndexOf("}") + 1);
      form = FORM_SCHEMA.parse(JSON.parse(json));
    } catch {
      return {
        ok: false,
        kind: "unmeasurable",
        reason:
          "I could not turn that into something I can watch for. Tell me what to look at and what number counts as too long — for example, a course sitting in review more than five days.",
      };
    }
  }

  if (form.verdict === "unsupported-action") {
    return {
      ok: false,
      kind: "unsupported-action",
      reason:
        form.reason ??
        "A rule can only tell somebody something. It cannot create, assign, approve or change anything — that would be acting on another person with nobody there to check it.",
    };
  }

  if (form.verdict === "unmeasurable") {
    return {
      ok: false,
      kind: "unmeasurable",
      reason: form.reason ?? "I cannot measure that.",
      ask: form.couldMeasure
        ? `I can't measure that. Did you mean ${form.couldMeasure}?`
        : undefined,
    };
  }

  if (form.verdict === "question" && !options.confirmedStanding) {
    return {
      ok: false,
      kind: "ambiguous",
      reason: "That reads like a question about right now, not something to watch for.",
      ask: "Do you want that as a standing rule, or just the answer for now?",
    };
  }

  if (!form.when) {
    return {
      ok: false,
      kind: "unparsed",
      reason: "I could not work out what to watch for.",
    };
  }

  if (form.verdict === "ambiguous" && !options.confirmedStanding) {
    // ⚠ It does not guess. The read-back has to happen anyway, so asking costs
    // one exchange and buys the difference between a rule and an answer.
    return {
      ok: false,
      kind: "ambiguous",
      reason: "That could be a one-off question or something to watch for from now on.",
      ask: `Do you want that as a standing rule, or just the answer for now? As a rule it would be: ${describeSpec(
        draft(ruleId, author, sentence, form.when, now()),
      )}`,
    };
  }

  const spec = draft(ruleId, author, sentence, form.when, now());
  return { ok: true, spec, readBack: describeSpec(spec) };
}

function draft(
  id: string,
  author: ActorId,
  plainLanguage: string,
  when: RuleWhen,
  createdAt: string,
): RuleSpec {
  return {
    id,
    author,
    plainLanguage,
    when,
    do: { opName: "notify.send", to: "author" },
    createdAt,
  };
}
