/**
 * Turning "Thursday" into a date — in code, never in the model.
 *
 * The same rule as `window.ts`, for the other half of the problem. `window.ts`
 * resolves a *period* to look back over; this resolves a *single day* to look
 * forward to. Both exist because of 1a's date bug: told not to invent records,
 * the model invented a date instead — *"August 11–17, 2025"*, in the wrong
 * year, under a conclusion that happened to be right.
 *
 * A commitment is the worst place for that to happen. "Thursday" resolved to
 * the wrong Thursday means a reminder that never arrives, or one that arrives a
 * week late, and neither is discoverable by the person who asked for it.
 */

/** The days somebody actually says. Anything else is given explicitly. */
export const DUE_WHEN = [
  "today",
  "tomorrow",
  "this-monday",
  "this-tuesday",
  "this-wednesday",
  "this-thursday",
  "this-friday",
  "next-week",
  "next-monday",
] as const;

export type DueWhen = (typeof DUE_WHEN)[number];

export interface ResolvedDue {
  /** `YYYY-MM-DD`. */
  date: string;
  /** How to say it back, so a wrong resolution is visible rather than silent. */
  meaning: string;
}

function shift(date: string, days: number): string {
  const [y, m, d] = date.split("-").map(Number);
  const out = new Date(y ?? 1970, (m ?? 1) - 1, (d ?? 1) + days);
  const mm = String(out.getMonth() + 1).padStart(2, "0");
  const dd = String(out.getDate()).padStart(2, "0");
  return `${out.getFullYear()}-${mm}-${dd}`;
}

function dayOfWeek(date: string): number {
  const [y, m, d] = date.split("-").map(Number);
  return new Date(y ?? 1970, (m ?? 1) - 1, d ?? 1).getDay(); // 0 = Sunday
}

/**
 * The next occurrence of a weekday, counting today as already gone.
 *
 * "Thursday" said on a Thursday means next Thursday, not this morning — a
 * reminder for a moment that has already passed is not a reminder.
 */
function nextWeekday(today: string, target: number): string {
  const current = dayOfWeek(today);
  let ahead = (target - current + 7) % 7;
  if (ahead === 0) ahead = 7;
  return shift(today, ahead);
}

const WEEKDAY: Record<string, number> = {
  "this-monday": 1,
  "this-tuesday": 2,
  "this-wednesday": 3,
  "this-thursday": 4,
  "this-friday": 5,
  "next-monday": 1,
};

export function resolveDueDate(
  today: string,
  input: { when?: string; explicit?: string } = {},
): ResolvedDue {
  if (input.explicit && /^\d{4}-\d{2}-\d{2}$/.test(input.explicit)) {
    return { date: input.explicit, meaning: input.explicit };
  }

  const when = (input.when ?? "").toLowerCase().trim();
  if (when === "today") return { date: today, meaning: `today, ${today}` };
  if (when === "tomorrow") {
    const d = shift(today, 1);
    return { date: d, meaning: `tomorrow, ${d}` };
  }
  if (when === "next-week") {
    const d = nextWeekday(today, 1);
    return { date: d, meaning: `Monday next week, ${d}` };
  }
  if (when in WEEKDAY) {
    const d = nextWeekday(today, WEEKDAY[when]);
    const label = when.replace("this-", "").replace("next-", "");
    return { date: d, meaning: `${label[0].toUpperCase()}${label.slice(1)}, ${d}` };
  }

  // Nothing usable. Tomorrow is the honest default for a reminder — it is soon
  // enough to be useful and it is stated back, so a wrong guess is visible.
  const d = shift(today, 1);
  return { date: d, meaning: `tomorrow, ${d} (no day was given, so this is a guess — check it)` };
}
