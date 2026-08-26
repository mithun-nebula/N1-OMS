import type { ActorId } from "@/spine/operation/types";
import type { RecordStore } from "@/spine/record/types";
import type { DayPlanService } from "./service";
import type { MeetingItem } from "./store";
import { localDate, localDateOf, localTimeOn, nextDay } from "./time";

/**
 * What a completed operation does to somebody's already-planned day.
 *
 * `arriveDuringDay` and `markLeave` were built and tested, and then nothing
 * ever called them: a meeting booked mid-day never touched anyone's plan, and
 * being on leave still counted as a day you failed to finish. This module is
 * the missing wire.
 *
 * It lives at the route layer rather than inside the operation handlers on
 * purpose. A day plan is personal planning state, not an org record — it sits
 * outside the gate — so `workplace/meetings.ts` has no business importing the
 * assistant domain. `/api/operations` is the one door every write already
 * passes through, which makes it the honest place to hang this.
 *
 * Nothing here may fail the operation that triggered it. The write has already
 * been gated, executed, recorded and published by the time we run; a planning
 * side effect that throws must not turn a successful booking into an error.
 */

export interface DayPlanReactionDeps {
  service: DayPlanService;
  graph: RecordStore;
  /** The day being reacted to. Defaults to today; injected by the tests. */
  asOf?: string;
}

interface MeetingRecord {
  title?: string;
  from?: string;
  to?: string;
  attendees?: ActorId[];
  cancelled?: boolean;
  link?: string;
}

interface CalendarRecord {
  title?: string;
  date?: string;
  from?: string;
  to?: string;
  people?: ActorId[];
}

interface LeaveRecord {
  employeeId?: string;
  fromDate?: string;
  toDate?: string;
}

export async function applyDayPlanReactions(
  operationName: string,
  args: Record<string, unknown>,
  deps: DayPlanReactionDeps,
): Promise<void> {
  try {
    switch (operationName) {
      case "meeting.create":
      case "meeting.update":
      case "meeting.addAttendee":
        await meetingChanged(String(args.meetingId ?? ""), args, deps);
        break;
      case "calendar.create":
      case "calendar.edit":
      case "calendar.addPeople":
        await calendarChanged(String(args.entryId ?? ""), args, deps);
        break;
      case "leave.approve":
        await leaveApproved(String(args.leaveId ?? ""), deps);
        break;
      case "task.complete":
        await taskCompleted(String(args.taskId ?? ""), deps);
        break;
      default:
        break;
    }
  } catch {
    // Planning is a courtesy on top of the operation, never a condition of it.
  }
}

/**
 * A6 — "booked during the day: simply accepted. It appears in your day,
 * displaced work is marked interrupted, and nothing is negotiated."
 *
 * Only a day that has actually been planned can be clashed with, so anything
 * else is left alone. A meeting booked for next week cannot displace work
 * nobody has committed to yet.
 */
async function meetingChanged(
  meetingId: string,
  args: Record<string, unknown>,
  deps: DayPlanReactionDeps,
): Promise<void> {
  // Read the record rather than trusting the arguments: `meeting.addAttendee`
  // carries only the one person, and `meeting.update` only the changed fields.
  const node = meetingId ? await deps.graph.getNode("meeting", meetingId) : undefined;
  const record = (node?.data as MeetingRecord | undefined) ?? {};
  const from = record.from ?? asString(args.from);
  const to = record.to ?? asString(args.to);
  if (!from || !to || record.cancelled) return;

  const attendees = record.attendees ?? toActorList(args.attendees);
  const meeting: MeetingItem = {
    id: meetingId || `meeting_${from}`,
    title: record.title ?? asString(args.title) ?? "A meeting",
    start: from,
    end: to,
    // A meeting that lands in the middle of somebody's day is exactly when they
    // most need the link without going to look for it.
    link: record.link,
  };
  // The local day the meeting falls on — a UTC slice files a late-evening
  // meeting under the wrong date for anyone east of Greenwich.
  await displace(attendees, localDateOf(from), meeting, deps);
}

async function calendarChanged(
  entryId: string,
  args: Record<string, unknown>,
  deps: DayPlanReactionDeps,
): Promise<void> {
  const node = entryId ? await deps.graph.getNode("calendar-entry", entryId) : undefined;
  const record = (node?.data as CalendarRecord | undefined) ?? {};
  const date = record.date ?? asString(args.date);
  const from = record.from ?? asString(args.from);
  const to = record.to ?? asString(args.to);
  // An all-day entry with no times cannot displace a specific window, so it is
  // shown on the calendar and left out of the day plan.
  if (!date || !from || !to) return;

  const meeting: MeetingItem = {
    id: entryId || `entry_${date}`,
    title: record.title ?? asString(args.title) ?? "A calendar entry",
    start: localTimeOn(date, from),
    end: localTimeOn(date, to),
  };
  await displace(record.people ?? [], date, meeting, deps);
}

async function displace(
  people: ActorId[],
  date: string,
  meeting: MeetingItem,
  deps: DayPlanReactionDeps,
): Promise<void> {
  const store = deps.service.getStore();
  for (const actor of new Set(people)) {
    await store.load(actor, date);
    const plan = store.get(actor, date);
    if (plan?.phase !== "planned") continue;
    if (plan.meetings.some((m) => m.id === meeting.id)) continue;
    deps.service.arriveDuringDay(actor, date, meeting);
  }
}

/**
 * A9 — "someone is on leave: no commitments expected, nothing asked, streak
 * paused rather than broken."
 */
async function leaveApproved(leaveId: string, deps: DayPlanReactionDeps): Promise<void> {
  if (!leaveId) return;
  const node = await deps.graph.getNode("leave", leaveId);
  const leave = node?.data as LeaveRecord | undefined;
  if (!leave?.employeeId || !leave.fromDate) return;

  const store = deps.service.getStore();
  for (const date of datesBetween(leave.fromDate, leave.toDate ?? leave.fromDate)) {
    await store.load(leave.employeeId, date);
    // Only a day that exists can be paused. A future day is simply never
    // started, which already has no streak effect.
    if (!store.get(leave.employeeId, date)) continue;
    deps.service.markLeave(leave.employeeId, date);
  }
}

/**
 * The same reactions, recovered from an activity entry rather than the
 * original arguments — the confirmation path has the entry but not the call.
 *
 * Every reaction reads the record itself, so the record's id is all that is
 * needed to rebuild the trigger.
 */
export async function applyDayPlanReactionsFromEntry(
  entry: { operationName: string; changes: Array<{ nodeType: string; nodeId: string }> },
  deps: DayPlanReactionDeps,
): Promise<void> {
  const ID_FIELD: Record<string, string> = {
    meeting: "meetingId",
    "calendar-entry": "entryId",
    leave: "leaveId",
  };
  for (const change of entry.changes) {
    const field = ID_FIELD[change.nodeType];
    if (!field) continue;
    await applyDayPlanReactions(entry.operationName, { [field]: change.nodeId }, deps);
  }
}

/**
 * Finishing a task on the board ticks the item that was committed to it.
 *
 * The link used to run one way only, from the dashboard outwards, so a task
 * completed on `/tasks` left the day plan still showing it as outstanding —
 * and that item then counted against the day at close-out.
 *
 * No `actualMinutes` is supplied: nobody said how long it took, so there is
 * nothing to judge and no question to ask. That is the correct reading of A4 —
 * only ask when the application genuinely does not know, and here it has not
 * even been told the work overran.
 */
async function taskCompleted(taskId: string, deps: DayPlanReactionDeps): Promise<void> {
  if (!taskId) return;
  const node = await deps.graph.getNode("task", taskId);
  const owner = (node?.data as { assignedTo?: ActorId } | undefined)?.assignedTo;
  if (!owner) return;

  const date = deps.asOf ?? localDate();
  const store = deps.service.getStore();
  await store.load(owner, date);
  const plan = store.get(owner, date);
  if (!plan) return;

  const item = plan.plan.find((p) => !p.done && p.ref?.nodeType === "task" && p.ref.nodeId === taskId);
  if (!item) return;
  await deps.service.tick(owner, date, item.id, {});
}

/** Inclusive, and capped so a mistyped range cannot walk forever. */
function datesBetween(from: string, to: string): string[] {
  const out: string[] = [];
  let cursor = from;
  // Walk by calendar day in local terms; adding 86,400,000 ms drifts across a
  // daylight-saving boundary and would skip or repeat a date.
  for (let i = 0; i < 366; i += 1) {
    out.push(cursor);
    if (cursor >= to) break;
    cursor = nextDay(cursor);
  }
  return out;
}

function asString(value: unknown): string | undefined {
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

function toActorList(value: unknown): ActorId[] {
  return Array.isArray(value) ? value.filter((v): v is string => typeof v === "string") : [];
}
