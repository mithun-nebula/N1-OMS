/**
 * Turning "last week" into two dates — in code, never in the model.
 *
 * Rule 4 of 1a's learning log, and the direct descendant of the only real
 * defect that stage found. Asked *"who is off next week?"* the model replied
 * *"No one is on leave next week, **August 11–17, 2025**"* — a range it
 * invented, in a year that was not the current one. The conclusion happened to
 * be right, which is precisely what made it dangerous: a fabricated premise
 * under a correct answer is invisible unless you already know the answer.
 *
 * Every honesty instruction in the system prompt was about not inventing
 * **records**. The model obeyed all of them and invented a **date**, because
 * none of them imagined one.
 *
 * Hence this module, and the rule it enforces: **no tool lets the model do date
 * arithmetic.** A tool takes a named period, resolves it here, and returns the
 * window it used alongside the data — which is also what makes a wrong answer
 * checkable instead of merely wrong.
 */

/** The periods a person actually says. Anything else falls back to 30 days. */
export const PERIODS = [
  "today",
  "yesterday",
  "this-week",
  "last-week",
  "this-month",
  "last-month",
  "last-30-days",
  "last-90-days",
] as const;

export type Period = (typeof PERIODS)[number];

export interface ResolvedWindow {
  /** Inclusive start, `YYYY-MM-DD`. */
  from: string;
  /** Inclusive end, `YYYY-MM-DD`. */
  to: string;
  /**
   * What was asked for, in words, so the answer can repeat it back.
   * "the last 7 days" is checkable; "recently" is not.
   */
  meaning: string;
}

/** Shift a `YYYY-MM-DD` by whole days, in local terms rather than by adding ms. */
function shift(date: string, days: number): string {
  const [y, m, d] = date.split("-").map(Number);
  // Local Date arithmetic handles month and year boundaries, and daylight
  // saving, which adding 86_400_000 ms does not.
  const out = new Date(y ?? 1970, (m ?? 1) - 1, (d ?? 1) + days);
  const mm = String(out.getMonth() + 1).padStart(2, "0");
  const dd = String(out.getDate()).padStart(2, "0");
  return `${out.getFullYear()}-${mm}-${dd}`;
}

function monthStart(date: string): string {
  return `${date.slice(0, 7)}-01`;
}

function lastDayOfPreviousMonth(date: string): string {
  return shift(monthStart(date), -1);
}

/**
 * Resolve a period, or explicit dates, into a window.
 *
 * Explicit dates always win — a caller that knows exactly what it wants is not
 * second-guessed. Everything else is computed from `today`, which the caller
 * takes from `deps.today()` and never from the clock directly, so tests are not
 * hostage to when they run.
 */
export function resolveWindow(
  today: string,
  input: { period?: string; from?: string; to?: string } = {},
): ResolvedWindow {
  if (input.from || input.to) {
    const from = input.from ?? input.to ?? today;
    const to = input.to ?? input.from ?? today;
    return { from, to, meaning: `${from} to ${to}, as asked` };
  }

  switch ((input.period ?? "").toLowerCase().trim()) {
    case "today":
      return { from: today, to: today, meaning: `today, ${today}` };
    case "yesterday": {
      const d = shift(today, -1);
      return { from: d, to: d, meaning: `yesterday, ${d}` };
    }
    case "this-week":
      return { from: shift(today, -6), to: today, meaning: "the last 7 days, ending today" };
    case "last-week":
      return {
        from: shift(today, -13),
        to: shift(today, -7),
        meaning: "the 7 days before the last 7",
      };
    case "this-month":
      return {
        from: monthStart(today),
        to: today,
        meaning: `${today.slice(0, 7)} so far`,
      };
    case "last-month": {
      const end = lastDayOfPreviousMonth(today);
      return { from: monthStart(end), to: end, meaning: `all of ${end.slice(0, 7)}` };
    }
    case "last-90-days":
      return { from: shift(today, -89), to: today, meaning: "the last 90 days, ending today" };
    case "last-30-days":
    default:
      return { from: shift(today, -29), to: today, meaning: "the last 30 days, ending today" };
  }
}

/** Inclusive `YYYY-MM-DD` comparison. Strings sort correctly in this format. */
export function withinWindow(date: string | undefined, w: ResolvedWindow): boolean {
  if (!date) return false;
  const day = date.slice(0, 10);
  return day >= w.from && day <= w.to;
}
