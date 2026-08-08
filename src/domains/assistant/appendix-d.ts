export interface AppendixDCheck {
  ok: boolean;
  reason?: string;
  kind?: "person" | "comparison";
}

const PERSON_PATTERNS = [
  /\byou (work|are) (more )?slow/i,
  /\btake a break/i,
  /\byou (always|never|tend to|seem to)\b/i,
  /\byour (habits|pace|character|attitude|energy)\b/i,
  /\b(procrastinat|lazy|distracted|unfocused|burnout|tired)\b/i,
  /\bwork(s)? more slowly\b/i,
  /\bin the (afternoon|morning|evening) you\b/i,
];

const COMPARISON_PATTERNS = [
  /\bcompared (to|with) /i,
  /\bslower than\b/i,
  /\bfaster than\b/i,
  /\bbetter than\b/i,
  /\bworse than\b/i,
  /\bbehind (compared|relative) /i,
  /\branked\b/i,
  /\bvs\.? .*(vs\.? )/i,
];

export function enforceAppendixD(text: string): AppendixDCheck {
  for (const re of PERSON_PATTERNS) {
    if (re.test(text)) {
      return {
        ok: false,
        kind: "person",
        reason: "Reflexively blocked: comments on the person, not the work (appendix D).",
      };
    }
  }
  for (const re of COMPARISON_PATTERNS) {
    if (re.test(text)) {
      return {
        ok: false,
        kind: "comparison",
        reason: "Reflexively blocked: compares people (appendix D).",
      };
    }
  }
  return { ok: true };
}

export function sanitizeForAppendixD(text: string): string {
  const check = enforceAppendixD(text);
  if (check.ok) return text;
  return "I can only comment on your work, not on you.";
}
