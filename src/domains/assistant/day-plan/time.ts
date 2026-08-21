/**
 * One place for what "today" and "nine o'clock" mean.
 *
 * The day flow used to compute both in UTC: `dayWindowStart` parsed
 * `${date}T09:00:00.000Z` and every route took `new Date().toISOString()
 * .slice(0,10)`. For an organisation whose region was chosen for Indian data
 * residency that is wrong twice over — auto-scheduled work displayed as
 * starting at 2:30 PM, and between midnight and 05:30 local the application
 * was still on yesterday's plan.
 *
 * Everything here is **local to the server**, which is what a working day is.
 * Deployment must set `TZ` (Node honours it); a container defaulting to UTC
 * will behave as it did before, which is the honest failure mode — visibly
 * shifted rather than subtly wrong.
 */

/** The working day opens at 09:00 local. */
export const DAY_START_HOUR = 9;

/** Minutes in a working day — what "more than the day holds" is measured against. */
export const DAY_MINUTES = 8 * 60;

/** `YYYY-MM-DD` for a local instant, not a UTC one. */
export function localDate(now: Date = new Date()): string {
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, "0");
  const d = String(now.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

/**
 * Which local day an instant falls on.
 *
 * `iso.slice(0, 10)` reads the *UTC* day out of a timestamp, which is a
 * different day from the one the person is living in for part of every 24
 * hours. Used for filing a meeting under a day, and for the question
 * allowance — both of which must agree with `localDate`.
 */
export function localDateOf(iso: string): string {
  const parsed = Date.parse(iso);
  return Number.isFinite(parsed) ? localDate(new Date(parsed)) : iso.slice(0, 10);
}

/** The instant the working day opens, for a `YYYY-MM-DD`. */
export function dayWindowStart(date: string): number {
  const [y, m, d] = date.split("-").map(Number);
  if (!y || !m || !d) return NaN;
  return new Date(y, m - 1, d, DAY_START_HOUR, 0, 0, 0).getTime();
}

/** The day before, in local terms. */
export function previousDay(date: string): string {
  return shiftDay(date, -1);
}

/** The day after, in local terms. */
export function nextDay(date: string): string {
  return shiftDay(date, 1);
}

/**
 * Walk by calendar day, not by 86,400,000 milliseconds — adding a fixed span
 * drifts across a daylight-saving boundary and skips or repeats a date.
 */
export function shiftDay(date: string, days: number): string {
  const [y, m, d] = date.split("-").map(Number);
  const at = new Date(y, m - 1, d);
  at.setDate(at.getDate() + days);
  return localDate(at);
}

/**
 * A local wall-clock time on a given date, as an instant.
 *
 * Calendar entries store a date and a clock time separately. Stamping `Z` on
 * "14:00" claimed two o'clock UTC — half past seven in the evening for an
 * India-resident organisation — and shifted every calendar-driven displacement
 * by the offset.
 */
export function localTimeOn(date: string, time: string): string {
  if (time.includes("T")) return time;
  const [y, m, d] = date.split("-").map(Number);
  const [hh, mm] = time.split(":").map(Number);
  if (!y || !m || !d || !Number.isFinite(hh)) return time;
  return new Date(y, m - 1, d, hh, mm || 0, 0, 0).toISOString();
}

/**
 * Epoch milliseconds for a timestamp, or `NaN`.
 *
 * Timestamps in this system arrive in at least three shapes — `…T09:00:00Z`
 * from `loadMeetings`' fallback, `…T09:00:00.000Z` from `toISOString`, and
 * whatever a caller sent to `meeting.create`. Comparing those as strings is
 * wrong: `"…T09:00:00Z"` and `"…T09:00:00.000Z"` are the same instant and
 * compare unequal, and an offset like `+05:30` compares as nonsense. Parse,
 * then compare numbers.
 */
export function at(iso?: string): number {
  return iso ? Date.parse(iso) : NaN;
}

/** Half-open interval overlap, on instants rather than strings. */
export function overlaps(
  aStart?: string,
  aEnd?: string,
  bStart?: string,
  bEnd?: string,
): boolean {
  const as = at(aStart);
  const ae = at(aEnd);
  const bs = at(bStart);
  const be = at(bEnd);
  if (![as, ae, bs, be].every(Number.isFinite)) return false;
  return as < be && bs < ae;
}

/** Chronological comparator for possibly-absent, possibly-mixed timestamps. */
export function byTime(a?: string, b?: string): number {
  const av = at(a);
  const bv = at(b);
  // Anything without a real time sorts last: an unscheduled row led the day
  // when this compared `String(a.start ?? "")`, because "" is minimal.
  if (!Number.isFinite(av)) return Number.isFinite(bv) ? 1 : 0;
  if (!Number.isFinite(bv)) return -1;
  return av - bv;
}
