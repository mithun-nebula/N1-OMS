/**
 * One way to write a date, everywhere.
 *
 * Screens had four: `toLocaleString({dateStyle:"medium"})` on meetings and
 * bookings, a bare `toLocaleDateString()` on equipment and utilities, a raw
 * `YYYY-MM-DD` straight out of the record on leave and tasks, and a full
 * `toLocaleString()` in the activity log. The same meeting could read
 * "27 Aug 2026", "8/27/2026" and "2026-08-27" on three screens.
 *
 * ── ⚠ Why these are built by hand rather than by `toLocaleDateString` ────────
 *
 * The order is the point. `{day, month, year}` still renders **"Aug 27, 2026"**
 * under `en-US` and **"27 Aug 2026"** under `en-GB` — the locale decides, so the
 * format would follow whatever machine the browser is on and the server would
 * disagree with the client during hydration. Composing the parts ourselves
 * makes day-month-year mean day-month-year, on every machine.
 *
 * Times are left to the locale on purpose: 24-hour versus am/pm is a genuine
 * regional preference and carries no ambiguity either way, unlike 03/04.
 */

const MONTHS = [
  "Jan", "Feb", "Mar", "Apr", "May", "Jun",
  "Jul", "Aug", "Sep", "Oct", "Nov", "Dec",
] as const;

const DAYS = [
  "Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday",
] as const;

/**
 * Accepts either an instant (`2026-08-27T09:00:00.000Z`) or a plain calendar
 * date (`2026-08-27`).
 *
 * A plain date is parsed as **local midnight**, never through `new Date(iso)`:
 * that reads a bare `YYYY-MM-DD` as UTC, so anywhere behind UTC a leave date or
 * a due date rendered as the day before.
 */
function parse(value?: string): Date | null {
  if (!value) return null;
  const plain = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (plain) {
    return new Date(Number(plain[1]), Number(plain[2]) - 1, Number(plain[3]));
  }
  const at = new Date(value);
  return Number.isNaN(at.getTime()) ? null : at;
}

/** `27 Aug 2026` — the one date format. */
export function fmtDate(value?: string): string {
  const d = parse(value);
  if (!d) return "";
  return `${d.getDate()} ${MONTHS[d.getMonth()]} ${d.getFullYear()}`;
}

/** `27 Aug` — same order, for somewhere the year is already obvious. */
export function fmtDateShort(value?: string): string {
  const d = parse(value);
  if (!d) return "";
  return `${d.getDate()} ${MONTHS[d.getMonth()]}`;
}

/** `Thursday, 27 Aug 2026` — for a greeting, where the weekday earns its place. */
export function fmtDayDate(value?: string | Date): string {
  const d = value instanceof Date ? value : parse(value) ?? new Date();
  return `${DAYS[d.getDay()]}, ${d.getDate()} ${MONTHS[d.getMonth()]} ${d.getFullYear()}`;
}

/**
 * `14:30` — the clock only, 24-hour, on every machine.
 *
 * ── ⚠ This used to be `toLocaleTimeString`, and the reasoning above was wrong ─
 *
 * The header argues that dates must be composed by hand because the ORDER is
 * ambiguous, while times could be left to the locale because 24-hour versus
 * am/pm "carries no ambiguity either way". True of a person reading it, and
 * irrelevant to the machine: Node's locale renders `2:30 PM` where the browser
 * renders `14:30`, the two strings differ, and React throws a **hydration
 * mismatch** on any screen that server-renders a time.
 *
 * Which is every screen that shows one — the dashboard's next meeting, the
 * booking list, the activity log, notifications.
 *
 * So the same rule the dates already follow: compose it, and both halves agree.
 * 24-hour because that is what this organisation reads, and because a format
 * that changes with the machine is the thing being fixed.
 */
export function fmtTime(value?: string): string {
  const d = parse(value);
  if (!d) return "";
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

/** `27 Aug 2026, 14:30` — a date and its time, in that order. */
export function fmtDateTime(value?: string): string {
  const d = parse(value);
  if (!d) return "";
  return `${fmtDate(value)}, ${fmtTime(value)}`;
}

/**
 * `August 2026` — a month heading.
 *
 * Composed for the same reason as everything else here: `toLocaleDateString`
 * returns the month name in whatever language the machine is set to, so a
 * server in one locale and a browser in another disagree during hydration.
 */
const MONTHS_FULL = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
] as const;

export function fmtMonthYear(year: number, month1to12: number): string {
  return `${MONTHS_FULL[month1to12 - 1] ?? ""} ${year}`;
}
