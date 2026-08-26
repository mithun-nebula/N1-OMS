/**
 * The sentence a person actually reads when a meeting or a calendar entry
 * changes.
 *
 * ── Why this exists ─────────────────────────────────────────────────────────
 *
 * Appendix E5: *"The message **always names what changed and who changed it**,
 * never just 'this meeting was updated.'"* Every meeting and calendar operation
 * used to omit `PublishTarget.message` entirely. `message` is optional
 * (`spine/operation/registry.ts`), so nothing caught it, and
 * `Spine.publishResult` fell back to `summarizeChanges` — which delivers
 * `"meeting:meeting_x changed"`. The *who* was computed on every one of them and
 * thrown into the activity record without ever reaching a person.
 *
 * `summarizeChanges` is the shape to beat, not to copy. This is prose for a
 * person, not a diff. The voice to match is `resolvePeople`'s `note` in
 * `./resolve.ts` — plain words, no field names, no ids.
 *
 * ── ⚠ MEETINGS AND THE CALENDAR ONLY ───────────────────────────────────────
 *
 * Everything below names records freely: titles, times, who was added, who was
 * removed. That is safe **because meeting and calendar-entry carry nothing
 * restricted**. Employee and pay records do. Pointing this builder at those —
 * or growing a general-purpose `changeMessage(record)` out of it — would put
 * restricted fields into a notification, which is delivered outside the read
 * path and therefore never passes `filterRecordForActor`
 * (`spine/permission/field-filter.ts`).
 *
 * If a third domain needs sentences, it writes its own and filters first.
 */

import { directory } from "@/server/directory";
import type { ActorId } from "@/spine/operation/types";

// ── the small pieces ────────────────────────────────────────────────────────

const DAYS = [
  "Sunday",
  "Monday",
  "Tuesday",
  "Wednesday",
  "Thursday",
  "Friday",
  "Saturday",
];

const MONTHS = [
  "January",
  "February",
  "March",
  "April",
  "May",
  "June",
  "July",
  "August",
  "September",
  "October",
  "November",
  "December",
];

/** Who did it, by name. Falls back to the id so an unknown actor stays readable. */
export function personName(actor: ActorId): string {
  return directory().nameOf(actor);
}

/** "Priya", "Priya and Arun", "Priya, Arun and Karthik". */
export function nameList(ids: ActorId[]): string {
  const names = ids.map(personName);
  if (names.length === 0) return "";
  if (names.length === 1) return names[0];
  return `${names.slice(0, -1).join(", ")} and ${names[names.length - 1]}`;
}

/**
 * "15:00", in the reader's local day.
 *
 * Local rather than UTC for the reason `day-plan/time.ts` gives at length: an
 * organisation sited for Indian data residency reading its own 15:00 meeting as
 * "20:30" is the bug that made auto-scheduled work display in the evening.
 */
export function clockOf(iso?: string): string {
  const ms = iso ? Date.parse(iso) : NaN;
  if (!Number.isFinite(ms)) return "";
  const at = new Date(ms);
  return `${String(at.getHours()).padStart(2, "0")}:${String(at.getMinutes()).padStart(2, "0")}`;
}

/** "Thursday 10 August", in the reader's local day. */
export function dayOf(iso?: string): string {
  if (!iso) return "";
  // A calendar entry stores a bare `YYYY-MM-DD`; a meeting stores an instant.
  const ms = Date.parse(/^\d{4}-\d{2}-\d{2}$/.test(iso) ? `${iso}T12:00:00` : iso);
  if (!Number.isFinite(ms)) return "";
  const at = new Date(ms);
  return `${DAYS[at.getDay()]} ${at.getDate()} ${MONTHS[at.getMonth()]}`;
}

/** "Thursday 10 August, 15:00–16:00" — or as much of it as is known. */
export function whenPhrase(from?: string, to?: string): string {
  const day = dayOf(from);
  const start = clockOf(from);
  const end = clockOf(to);
  const time = start && end ? `${start}–${end}` : start;
  if (day && time) return `${day}, ${time}`;
  return day || time;
}

/**
 * Join the clauses of a sentence the way a person would speak them:
 * "moved it to 15:00 and added Meena".
 */
function joinClauses(clauses: string[]): string {
  const parts = clauses.filter(Boolean);
  if (parts.length === 0) return "";
  if (parts.length === 1) return parts[0];
  return `${parts.slice(0, -1).join(", ")} and ${parts[parts.length - 1]}`;
}

/**
 * One sentence: who, then what they did, full stop.
 *
 * The full stop is only added when the sentence does not already end in one.
 * Found by running it for real, not by a test: half this organisation's people
 * are recorded as "Priya R.", "Arun S.", "James D." — a name that ends in a
 * full stop — so every message that finished on a name read
 * *"…with Priya R. and Arun S.."*.
 */
function sentence(actor: ActorId, clauses: string[]): string {
  const text = `${personName(actor)} ${joinClauses(clauses)}`;
  return /[.!?]$/.test(text) ? text : `${text}.`;
}

/**
 * The join link, appended to a sentence — or nothing at all.
 *
 * ⚠ **The trap E7 sets here.** An `in-person` meeting has no link. Appending an
 * empty string leaves the message trailing `"Join: "`, which reads as a bug to
 * whoever receives it and is worse than saying nothing. So the caller passes
 * `link` through unconditionally and the *absence* is handled once, here, rather
 * than at four call sites that each have to remember.
 */
function withLink(text: string, link?: string): string {
  return link ? `${text} Join: ${link}` : text;
}

// ── meetings ────────────────────────────────────────────────────────────────

export type MeetingKind = "in-person" | "online" | "both";

export function meetingCreatedMessage(input: {
  actor: ActorId;
  title: string;
  kind: MeetingKind;
  from: string;
  to: string;
  /** Everyone invited, so the message says who else is coming. */
  attendees?: ActorId[];
  /**
   * E7: the link is *"sent to everyone invited with the invitation, in one
   * action"*. Undefined for an in-person meeting, and then nothing is appended.
   */
  link?: string;
  /**
   * What happened with the room, for an in-person or `both` meeting.
   *
   * ⚠ A meeting must NOT fail because no room was free — `room.book` returns
   * `{ resolved: false, reason }` rather than throwing, precisely so the caller
   * can decide. The meeting is created either way and the reason travels in the
   * sentence, because "no suitable room available" is something the organiser
   * needs to know rather than grounds for losing the meeting.
   */
  room?: { name?: string; reason?: string };
}): string {
  const where =
    input.kind === "online"
      ? "online"
      : input.kind === "both"
        ? "in person and online"
        : "in person";
  const when = whenPhrase(input.from, input.to);
  // ONE clause, not two. Handing `joinClauses` "…, online" and "with Priya and
  // Arun" separately produced "…, online AND with Priya R. and Arun S." — two
  // "and"s in one breath. Only reading it out loud catches that.
  const others = input.attendees?.length ? `, with ${nameList(input.attendees)}` : "";
  const base = sentence(input.actor, [
    `arranged ${input.title}${when ? ` for ${when}` : ""}, ${where}${others}`,
  ]);
  // Room first, link LAST. A `both` meeting carries both, and reading
  // "Join: https://meet.google.com/ysm-cqrz-gir Room: Hall 1." out loud is the
  // moment it becomes obvious the URL has to end the message: anything after a
  // bare link crowds it, and clients that auto-link tend to swallow it.
  const withRoom = input.room?.name
    ? `${base} Room: ${input.room.name}.`
    : input.room?.reason
      ? `${base} No room was booked — ${input.room.reason}`
      : base;
  return withLink(withRoom, input.link);
}

/**
 * E5's own example is the target here:
 *   "Arun moved Thursday's review from 11:00 to 15:00."
 *
 * Only the parts that actually changed are spoken. A rename that did not move
 * the meeting must not claim it moved.
 */
export function meetingUpdatedMessage(input: {
  actor: ActorId;
  before: { title: string; from: string; to: string };
  after: { title: string; from: string; to: string };
}): string {
  const clauses: string[] = [];
  const moved =
    input.before.from !== input.after.from || input.before.to !== input.after.to;
  const renamed = input.before.title !== input.after.title;

  if (moved) {
    clauses.push(
      `moved ${input.before.title} from ${whenPhrase(input.before.from, input.before.to)} to ${whenPhrase(
        input.after.from,
        input.after.to,
      )}`,
    );
  }
  if (renamed) {
    clauses.push(
      moved
        ? `renamed it ${input.after.title}`
        : `renamed ${input.before.title} to ${input.after.title}`,
    );
  }
  if (clauses.length === 0) {
    // Nothing actually differed. Saying so is still better than the fallback,
    // which would claim a change that did not happen.
    clauses.push(`saved ${input.after.title} with no changes`);
  }
  return sentence(input.actor, clauses);
}

export function meetingAttendeeAddedMessage(input: {
  actor: ActorId;
  title: string;
  attendee: ActorId;
  from?: string;
  to?: string;
  /**
   * The person being added reads a different sentence from everyone else: they
   * are being told they are now in a meeting, not that somebody joined one.
   */
  forNewAttendee: boolean;
  /**
   * E7's ★ rule: *"Anyone added later is sent the link automatically — adding a
   * person to an online meeting without the link is the most common way this
   * goes wrong."* This is the one place that rule lives.
   */
  link?: string;
}): string {
  const when = whenPhrase(input.from, input.to);
  if (input.forNewAttendee) {
    return withLink(
      sentence(input.actor, [
        `added you to ${input.title}${when ? ` — ${when}` : ""}`,
      ]),
      input.link,
    );
  }
  return sentence(input.actor, [
    `added ${personName(input.attendee)} to ${input.title}${when ? ` — ${when}` : ""}`,
  ]);
}

export function meetingCancelledMessage(input: {
  actor: ActorId;
  title: string;
  from?: string;
  to?: string;
}): string {
  const when = whenPhrase(input.from, input.to);
  return sentence(input.actor, [
    `cancelled ${input.title}${when ? ` — ${when}` : ""}`,
  ]);
}

// ── the common calendar ─────────────────────────────────────────────────────

export function calendarCreatedMessage(input: {
  actor: ActorId;
  title: string;
  kind: "meeting" | "event";
  date: string;
  from?: string;
  to?: string;
  people?: ActorId[];
}): string {
  const day = dayOf(input.date);
  const start = clockOf(input.from);
  const end = clockOf(input.to);
  const time = start && end ? `, ${start}–${end}` : start ? `, ${start}` : "";
  const others = input.people?.length ? `, with ${nameList(input.people)}` : "";
  return sentence(input.actor, [
    `put ${input.title} on the calendar${day ? ` for ${day}${time}` : ""}${others}`,
  ]);
}

export function calendarEditedMessage(input: {
  actor: ActorId;
  before: { title: string; date: string; from?: string; to?: string };
  after: { title: string; date: string; from?: string; to?: string };
}): string {
  const clauses: string[] = [];
  const movedDay = input.before.date !== input.after.date;
  const movedTime =
    input.before.from !== input.after.from || input.before.to !== input.after.to;
  const renamed = input.before.title !== input.after.title;

  if (movedDay || movedTime) {
    const beforeWhen = calendarWhen(input.before.date, input.before.from, input.before.to);
    const afterWhen = calendarWhen(input.after.date, input.after.from, input.after.to);
    clauses.push(`moved ${input.before.title} from ${beforeWhen} to ${afterWhen}`);
  }
  if (renamed) {
    clauses.push(
      movedDay || movedTime
        ? `renamed it ${input.after.title}`
        : `renamed ${input.before.title} to ${input.after.title}`,
    );
  }
  if (clauses.length === 0) {
    clauses.push(`saved ${input.after.title} with no changes`);
  }
  return sentence(input.actor, clauses);
}

function calendarWhen(date: string, from?: string, to?: string): string {
  const day = dayOf(date);
  const start = clockOf(from);
  const end = clockOf(to);
  const time = start && end ? `${start}–${end}` : start;
  if (day && time) return `${day}, ${time}`;
  return day || time || date;
}

export function calendarPeopleAddedMessage(input: {
  actor: ActorId;
  title: string;
  added: ActorId[];
  date?: string;
  /** The people being added are told they are in it, not that others joined. */
  forAddedPerson: boolean;
}): string {
  const day = dayOf(input.date);
  const when = day ? ` — ${day}` : "";
  if (input.forAddedPerson) {
    return sentence(input.actor, [`added you to ${input.title}${when}`]);
  }
  return sentence(input.actor, [
    `added ${nameList(input.added)} to ${input.title}${when}`,
  ]);
}

/**
 * E4: *"Removing someone tells them, and says who removed them — being dropped
 * silently is the single worst thing an open calendar can do."*
 */
export function calendarPeopleRemovedMessage(input: {
  actor: ActorId;
  title: string;
  removed: ActorId[];
  date?: string;
  forRemovedPerson: boolean;
}): string {
  const day = dayOf(input.date);
  const when = day ? ` — ${day}` : "";
  if (input.forRemovedPerson) {
    return sentence(input.actor, [`took you off ${input.title}${when}`]);
  }
  return sentence(input.actor, [
    `took ${nameList(input.removed)} off ${input.title}${when}`,
  ]);
}

export function calendarCancelledMessage(input: {
  actor: ActorId;
  title: string;
  date?: string;
}): string {
  const day = dayOf(input.date);
  return sentence(input.actor, [
    `cancelled ${input.title}${day ? ` — ${day}` : ""}`,
  ]);
}
