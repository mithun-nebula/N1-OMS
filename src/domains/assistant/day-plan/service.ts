import type { ActorId } from "@/spine/operation/types";
import type { RecordStore } from "@/spine/record/types";
import type { QuestionLimiter } from "@/domains/workplace/shared/limiter";
import { generateBrief } from "../briefing";
import {
  DayPlanStore,
  isDropped,
  shortfallOf,
  type DayPlan,
  type MeetingItem,
  type PlanItem,
} from "./store";
import { classifyMiss, restOfDayAtRisk } from "./miss-classifier";
import { applyDayToStreak, assessDay } from "./streak";
import { DAY_MINUTES, byTime, dayWindowStart, localDateOf, overlaps, previousDay } from "./time";

/*
 * `DAY_MINUTES`, the 09:00 opening, "today" and every timestamp comparison now
 * live in `./time`, which computes them in local time rather than UTC.
 */

/**
 * Whether this item's window is the service's to move.
 *
 * `autoScheduled` arrived with the scheduling fix, so every plan already in
 * `orga_day_plans` has it `undefined`. Reading that as "pinned" left legacy
 * days permanently unscheduled — no `start`, so `classifyMiss` short-circuited
 * to "ran-over" exactly as before and the whole fix missed the existing data.
 * An item with no window has nothing to protect, so it is ours to place.
 */
function isMovable(item: PlanItem): boolean {
  if (item.done) return false;
  // Dropped work holds no time in the day — it is neither placed nor anchored.
  if (isDropped(item)) return false;
  if (item.autoScheduled === true) return true;
  if (item.autoScheduled === false) return false;
  return item.start === undefined;
}

/** A hydrated item may carry no estimate; `NaN` minutes would throw on format. */
function lengthOf(item: PlanItem): number {
  const minutes = Number(item.estimateMinutes);
  return (Number.isFinite(minutes) && minutes > 0 ? Math.round(minutes) : 30) * 60_000;
}

/**
 * Give every outstanding item a real place in the day, around the meetings
 * already in it.
 *
 * Without this, plan items carried no `start`/`end` at all — so `classifyMiss`
 * short-circuited to "ran-over" on every miss and the interrupted branch could
 * never fire in production. A6 also depends on it: work can only be *displaced*
 * by a meeting if it occupies a window in the first place.
 *
 * Anything finished, or pinned by the caller, is an anchor rather than
 * something to move — see `isMovable`.
 */
function scheduleWork(plan: DayPlan): void {
  const fixed: Array<{ start: number; end: number }> = [];
  const anchor = (start?: string, end?: string) => {
    if (!start || !end) return;
    const s = Date.parse(start);
    const e = Date.parse(end);
    if (Number.isFinite(s) && Number.isFinite(e) && e > s) fixed.push({ start: s, end: e });
  };

  for (const m of plan.meetings) anchor(m.start, m.end);
  for (const p of plan.plan) {
    // A dropped item must not go on reserving the slot it used to hold, or the
    // rest of the day is laid out around work nobody is doing.
    if (isDropped(p)) continue;
    if (!isMovable(p)) anchor(p.start, p.end);
  }
  fixed.sort((a, b) => a.start - b.start);

  const opensAt = dayWindowStart(plan.date);
  if (!Number.isFinite(opensAt)) return;
  let cursor = opensAt;

  for (const item of plan.plan) {
    if (isDropped(item)) continue;
    if (!isMovable(item)) continue;
    const length = lengthOf(item);
    let start = Math.max(cursor, opensAt);
    let end = start + length;
    // Clearing one booking can land inside the next, so sweep until a whole
    // pass finds no collision. Bounded by the number of blocks in the day.
    for (let pass = 0; pass <= fixed.length; pass += 1) {
      const clash = fixed.find((b) => start < b.end && b.start < end);
      if (!clash) break;
      start = clash.end;
      end = start + length;
    }
    item.start = new Date(start).toISOString();
    item.end = new Date(end).toISOString();
    fixed.push({ start, end });
    fixed.sort((a, b) => a.start - b.start);
    cursor = end;
  }
}

/**
 * What the day actually was — the thing close-out **tells** you.
 *
 * Every field is derived from the plan as it already stands. No new state is
 * recorded to produce it, which is the point: the application is reporting what
 * it knows rather than asking somebody to retype it.
 */
export interface CloseOutSummary {
  committed: number;
  done: number;
  /** Minutes committed to, and minutes actually accounted for. */
  committedMinutes: number;
  workedMinutes: number;
  dropped: number;
  /** A9's shortfall — what was owed and not delivered. */
  shortfallMinutes: number;
  ranOver: Array<{ id: string; label: string; byMinutes: number }>;
  /** Still open, and what each one is owed. Drives the three taps. */
  unfinished: Array<{
    id: string;
    label: string;
    estimateMinutes: number;
    progressMinutes: number;
    shortfallMinutes: number;
    interrupted: boolean;
  }>;
  /** Already settled by the conversation — nothing left to ask about. */
  answered: boolean;
}

/**
 * How far back the morning brief looks for work still owed.
 *
 * A constant, deliberately, and not something the model is asked to judge. Two
 * working weeks is long enough that nothing quietly falls off the end and short
 * enough that a brief does not become an archive.
 */
export const LOOKBACK_DAYS = 14;

/** One piece of work still owed, and how long it has been owed for. */
export interface CarriedItem {
  key: string;
  label: string;
  ref?: { nodeType: string; nodeId: string };
  /** A9's remainder — what is left, not the whole estimate. */
  minutesLeft: number;
  estimateMinutes: number;
  /** A3 — named as such, so the brief does not read as a reprimand. */
  interrupted: boolean;
  /**
   * Working days this has been carried. 1 means "since yesterday".
   *
   * "Red" is a UI word and does not appear anywhere in the data. The screen may
   * paint this; chat says "four days overdue".
   */
  overdueDays: number;
  firstSeen: string;
  lastSeen: string;
}

/**
 * What makes two occurrences of work across two days the same work.
 *
 * The backing record when there is one — the same task re-picked on Tuesday is
 * the same debt, whatever it was relabelled to. Otherwise the label, which is
 * all a free-text item has.
 */
function keyOf(item: PlanItem): string {
  return item.ref ? `${item.ref.nodeType}:${item.ref.nodeId}` : `label:${item.label}`;
}

/** Exactly the columns appendix A8 grants a manager. Nothing else may leave. */
export interface ManagerVisibleItem {
  id: string;
  label: string;
  estimateMinutes: number;
  done: boolean;
}

export interface DayPlanDeps {
  graph: RecordStore;
  limiter: QuestionLimiter;
  actorLookup: (actor: ActorId) => { spine: import("@/spine/spine").Spine };
}

async function loadMeetings(graph: RecordStore, actor: string, date: string): Promise<MeetingItem[]> {
  const nodes = await graph.find(
    "meeting",
    (n) =>
      (n.data as { cancelled?: boolean }).cancelled !== true &&
      ((n.data as { attendees?: string[] }).attendees ?? []).includes(actor),
  );
  return nodes
    // Compared as local days, not UTC ones.
    .filter((n) => localDateOf(String((n.data as { from?: string }).from ?? "")) === date)
    .map((n) => {
      const d = n.data as { title?: string; from?: string; to?: string; link?: string };
      // A meeting with no time falls back to the hour the working day opens,
      // in local terms like everything else here.
      const opensAt = dayWindowStart(date);
      return {
        id: n.id,
        title: d.title ?? n.id,
        start: d.from ?? new Date(opensAt).toISOString(),
        end: d.to ?? new Date(opensAt + 60 * 60_000).toISOString(),
        // E7's third place: each person's day. Absent for in-person meetings.
        link: d.link,
      };
    });
}

export class DayPlanService {
  constructor(
    private readonly store: DayPlanStore,
    private readonly deps: DayPlanDeps,
  ) {}

  async startDay(actor: ActorId, date: string): Promise<{ open: "brief" | "dashboard" | "resume"; plan?: DayPlan; prompt?: string }> {
    const existing = this.store.get(actor, date);
    if (existing?.phase === "planned") {
      return { open: "dashboard", plan: existing };
    }
    if (existing?.phase === "abandoned") {
      return { open: "resume", prompt: "You were choosing what to do today — shall we finish?" };
    }
    if (existing) {
      return { open: "brief", plan: existing };
    }
    const spine = this.deps.actorLookup(actor).spine;
    const brief = await generateBrief({ actor, spine, graph: this.deps.graph, asOf: `${date}T23:59:59Z` });
    // What changed since you last looked — which, on any day after the first,
    // starts with what you did not get to yesterday. The dashboard's empty
    // state has always promised this ("anything unfinished carries to
    // tomorrow's brief"); nothing implemented it, and `changed` stayed empty.
    brief.changed = [...(await this.carryForward(actor, date)), ...brief.changed];
    const plan: DayPlan = {
      actor,
      date,
      phase: "briefing",
      brief,
      briefStep: 0,
      plan: [],
      meetings: await loadMeetings(this.deps.graph, actor, date),
      streak: this.store.streakFor(actor),
      // What last night's close-out offered up. Offered first in the picker,
      // exactly like a brief item answered "Handle" — and still uncommitted,
      // because A1 keeps planning in the morning.
      suggested: await this.seedsFromYesterday(actor, date),
    };
    this.store.put(plan);
    return { open: "brief", plan };
  }

  /**
   * Work still owed, walking back further than yesterday.
   *
   * ── Why this had to widen ───────────────────────────────────────────────
   *
   * `carryForward` reached back exactly one day. So an item committed on
   * Monday and not re-picked on Tuesday **vanished** — Wednesday's brief looked
   * at Tuesday, found nothing, and the work was simply gone. And something
   * pending four days read identically to something pending since yesterday,
   * when the four-day one is the whole point of a brief.
   *
   * Walks back `LOOKBACK_DAYS`, newest first, and carries three rules with it:
   *
   *  - **Dropped ends it.** `isDropped` is skipped in the old code on purpose —
   *    "dropped is a decision, not a debt". Seeing the drop on the newest day
   *    first is what stops a wider window resurrecting a decision made on
   *    Wednesday from an unfinished copy on Monday.
   *  - **Done ends it too**, for the same reason and by the same mechanism.
   *  - **A day on leave is skipped, not counted.** A3 — the time was taken from
   *    them. Being away must not accrue overdue days.
   */
  /**
   * Public because the chat brief needs the numbers, not the sentences.
   *
   * `carryForward` renders these into `brief.changed` for the existing
   * dashboard slideshow. The chat brief wants `overdueDays` itself, so it can
   * say "four days overdue" rather than parsing it back out of prose.
   */
  async carriedWork(actor: ActorId, date: string): Promise<CarriedItem[]> {
    return this.carriedItems(actor, date);
  }

  private async carriedItems(actor: ActorId, date: string): Promise<CarriedItem[]> {
    const carried = new Map<string, CarriedItem>();
    // Newest first, so a later "done" or "dropped" settles the item before an
    // older unfinished copy of it is ever considered.
    const settled = new Set<string>();

    let cursor = previousDay(date);
    for (let back = 0; back < LOOKBACK_DAYS; back += 1, cursor = previousDay(cursor)) {
      await this.store.load(actor, cursor);
      const day = this.store.get(actor, cursor);
      if (!day) continue;
      // Skipped entirely: not read, and not counted toward `overdueDays`.
      if (day.onLeave) continue;

      for (const item of day.plan) {
        const key = keyOf(item);
        if (item.done || isDropped(item)) {
          settled.add(key);
          continue;
        }
        if (settled.has(key)) continue;

        const existing = carried.get(key);
        if (existing) {
          // Seen on an earlier day too: one more day it has been owed.
          existing.overdueDays += 1;
          existing.firstSeen = cursor;
          // A3 is sticky across the window. If a meeting ate the slot on any
          // of these days, the time was taken from them, and a flat "three
          // days overdue" is exactly the reprimand A3 forbids. Interrupted
          // once is interrupted in the telling.
          if (item.miss?.kind === "interrupted" || item.interrupted === true) {
            existing.interrupted = true;
          }
          continue;
        }
        carried.set(key, {
          key,
          label: item.label,
          ref: item.ref,
          // A9: the *remainder*, not the whole item. Taken from the most
          // recent day, which is the one that knows how much is left.
          minutesLeft: shortfallOf(item),
          estimateMinutes: item.estimateMinutes,
          interrupted: item.miss?.kind === "interrupted" || item.interrupted === true,
          overdueDays: 1,
          firstSeen: cursor,
          lastSeen: cursor,
        });
      }
    }
    // Oldest debt first — it is the one a person needs to see.
    return [...carried.values()].sort((a, b) => b.overdueDays - a.overdueDays);
  }

  /**
   * Yesterday's unfinished work and anything pushed to "Later", as brief lines.
   *
   * Interrupted work is named as such: the time was taken from them, and the
   * brief must not read as a reprimand for it (appendix A3).
   *
   * The one-day wording is preserved exactly. "Overdue" language only appears
   * once something has genuinely been carried more than once — saying "1 day
   * overdue" about yesterday's work would be technically true and read as
   * nagging.
   */
  private async carryForward(actor: ActorId, date: string): Promise<string[]> {
    const lines: string[] = [];
    for (const item of await this.carriedItems(actor, date)) {
      const partly = item.minutesLeft > 0 && item.minutesLeft < item.estimateMinutes;
      const overdue = item.overdueDays > 1;

      if (item.interrupted) {
        lines.push(
          overdue
            ? `${item.label} was interrupted and is ${item.overdueDays} days overdue${partly ? ` — ${item.minutesLeft}m left` : ""}.`
            : partly
              ? `${item.label} was interrupted yesterday — ${item.minutesLeft}m of it is still left.`
              : `${item.label} was interrupted yesterday and is still open.`,
        );
      } else {
        lines.push(
          overdue
            ? `${item.label} is ${item.overdueDays} days overdue${partly ? ` — ${item.minutesLeft}m left` : ""}.`
            : partly
              ? `${item.label} is part done — ${item.minutesLeft}m left from yesterday.`
              : `${item.label} is still open from yesterday.`,
        );
      }
    }

    // Deferred stays a one-day thing: "you left this for today" is only true
    // of yesterday, and carrying it further would nag about a brief item
    // somebody dismissed a week ago.
    const previous = previousDay(date);
    await this.store.load(actor, previous);
    const yesterday = this.store.get(actor, previous);
    if (yesterday && !yesterday.onLeave) {
      for (const text of yesterday.deferred ?? []) {
        lines.push(`${text} (you left this for today)`);
      }
    }
    return lines;
  }

  /**
   * Carried-over work offered back by last night's close-out.
   *
   * Also the safety net for a conversation nobody finished: if yesterday was
   * never assessed, fold it in now. Without this, closing the tab halfway
   * through close-out would lose that day's streak effect permanently —
   * `finishCloseOut` would be the only path to assessment and nothing would
   * ever call it. `applyDayToStreak` is idempotent, so a day already assessed
   * is left exactly as it was.
   */
  private async seedsFromYesterday(actor: ActorId, date: string): Promise<string[]> {
    const previous = previousDay(date);
    await this.store.load(actor, previous);
    const yesterday = this.store.get(actor, previous);
    if (!yesterday) return [];
    if (yesterday.plan.length > 0 && yesterday.streak.lastAssessedDate !== previous) {
      applyDayToStreak(yesterday, this.store.streakFor(actor));
      this.store.put(yesterday);
    }
    return [...(yesterday.seeded ?? [])];
  }

  briefItems(plan: DayPlan): Array<{ text: string; replies: string[] }> {
    const items: Array<{ text: string; replies: string[] }> = [];
    for (const c of plan.brief.changed) items.push({ text: c, replies: ["Got it"] });
    for (const n of plan.brief.needsYou) items.push({ text: n, replies: ["Handle", "Later"] });
    for (const a of plan.brief.atRisk) items.push({ text: a, replies: ["Open", "Dismiss"] });
    return items;
  }

  currentBriefItem(plan: DayPlan): { text: string; replies: string[]; index: number; total: number } | null {
    const items = this.briefItems(plan);
    if (plan.briefStep >= items.length) return null;
    return { ...items[plan.briefStep], index: plan.briefStep, total: items.length };
  }

  /**
   * Advance the morning conversation, acting on what was said.
   *
   * The reply used to be discarded entirely, so "Handle" and "Later" did
   * exactly the same thing as "Got it" — the brief was a slideshow. A1 has it
   * feeding the plan: what you agree to handle is offered first when you come
   * to choose the day, and what you defer comes back tomorrow.
   */
  answerBrief(actor: ActorId, date: string, reply: string): DayPlan {
    const plan = this.requirePlanning(actor, date, "answer the brief");
    const current = this.currentBriefItem(plan);
    if (current) {
      switch (reply.trim().toLowerCase()) {
        case "handle":
        case "open":
          if (!(plan.suggested ?? []).includes(current.text)) {
            plan.suggested = [...(plan.suggested ?? []), current.text];
          }
          break;
        case "later":
          if (!(plan.deferred ?? []).includes(current.text)) {
            plan.deferred = [...(plan.deferred ?? []), current.text];
          }
          break;
        default:
          // "Got it" / "Dismiss" — acknowledged, nothing carried.
          break;
      }
    }
    plan.briefStep += 1;
    const items = this.briefItems(plan);
    if (plan.briefStep >= items.length) {
      plan.phase = "planning";
    }
    this.store.put(plan);
    return plan;
  }

  /**
   * The brief has been delivered, all of it, in one go.
   *
   * ── Why this exists ─────────────────────────────────────────────────────
   *
   * A1 is conversation-first and `selectItem` enforces it: nothing can be
   * chosen while the day is still in `briefing`. The slideshow satisfied that
   * by stepping — each `answerBrief` advanced `briefStep`, and the phase moved
   * to `planning` once the last item was acknowledged.
   *
   * The chat brief has no steps. It says everything at once and asks what the
   * person is taking on, which means **presenting it is answering it** — but
   * nothing was telling the engine that, so the phase stayed at `briefing` and
   * every `selectItem` from chat was refused. Found by running a real morning:
   * three items were named, all three were refused, and the day stayed empty.
   *
   * Idempotent, and it does not touch a day already planned.
   */
  markBriefDelivered(actor: ActorId, date: string): DayPlan {
    const plan = this.require(actor, date);
    if (plan.phase !== "briefing") return plan;
    // Straight past the steps rather than looping `answerBrief`: the replies
    // it records ("Handle" / "Later") are the slideshow's, and inventing them
    // here would put words in somebody's mouth.
    plan.briefStep = this.briefItems(plan).length;
    plan.phase = "planning";
    this.store.put(plan);
    return plan;
  }

  selectItem(
    actor: ActorId,
    date: string,
    input: { label: string; estimateMinutes: number; ref?: { nodeType: string; nodeId: string }; start?: string; end?: string },
  ): { item?: PlanItem; error?: string; overCapacity?: boolean } {
    if (!input.estimateMinutes || input.estimateMinutes <= 0) {
      return { error: "A time for each item is required — otherwise I cannot tell later whether it ran over." };
    }
    const plan = this.requireBriefDone(actor, date, "choose today's work");
    // The same record cannot be committed to twice in one day. Nothing stopped
    // it, and "add to today" on `/tasks` tracks its own success in local state
    // only — so a reload lost the tick and a second click silently produced a
    // duplicate item for one task.
    if (input.ref) {
      const already = plan.plan.find(
        (p) => p.ref?.nodeType === input.ref!.nodeType && p.ref?.nodeId === input.ref!.nodeId,
      );
      if (already) return { item: already };
    }
    const meetingMinutes = plan.meetings.reduce(
      (sum, m) => sum + minutesBetween(m.start, m.end),
      0,
    );
    const workMinutes = plan.plan.reduce((s, p) => s + p.estimateMinutes, 0) + input.estimateMinutes;
    const overCapacity = meetingMinutes + workMinutes > DAY_MINUTES;
    const explicit = input.start !== undefined;
    const item: PlanItem = {
      id: `item_${Date.now().toString(36)}_${plan.plan.length + 1}`,
      label: input.label,
      ref: input.ref,
      estimateMinutes: input.estimateMinutes,
      start: input.start,
      // A caller that names a start but no end still gets a real window, so
      // the item can be judged interrupted or overrun like any other.
      end:
        input.end ??
        (input.start
          ? new Date(Date.parse(input.start) + input.estimateMinutes * 60_000).toISOString()
          : undefined),
      autoScheduled: !explicit,
    };
    plan.plan.push(item);
    scheduleWork(plan);
    this.store.put(plan);
    return { item, overCapacity };
  }

  /**
   * Idempotent: committing an already-committed day changes nothing.
   *
   * `dayPlanned` used to increment on every call, so posting `commit` ten times
   * claimed ten planned days. The phase itself is the guard — a day can only be
   * committed once, however many times it is asked for.
   */
  commitPlan(actor: ActorId, date: string): DayPlan {
    const plan = this.requireBriefDone(actor, date, "commit the day");
    if (plan.phase === "planned") return plan;
    plan.phase = "planned";
    const streak = this.store.streakFor(actor);
    streak.dayPlanned += 1;
    this.store.put(plan);
    return plan;
  }

  abandon(actor: ActorId, date: string): DayPlan {
    const plan = this.require(actor, date);
    if (plan.phase !== "planned") plan.phase = "abandoned";
    this.store.put(plan);
    return plan;
  }

  dashboard(actor: ActorId, date: string): {
    rows: Array<{ kind: "work" | "meeting"; id: string; title: string; start?: string; done?: boolean; tag?: string }>;
    tally: { meetings: number; work: number; free: number };
  } {
    const plan = this.require(actor, date);
    const rows: Array<{ kind: "work" | "meeting"; id: string; title: string; start?: string; done?: boolean; tag?: string }> = [];
    for (const m of plan.meetings) {
      rows.push({ kind: "meeting", id: m.id, title: m.title, start: m.start, tag: m.arrivedDuringDay ? "interrupted" : undefined });
    }
    for (const p of plan.plan) {
      rows.push({
        kind: "work",
        id: p.id,
        title: p.label,
        start: p.start,
        done: p.done,
        tag: isDropped(p)
          ? "dropped"
          : p.miss?.kind === "interrupted"
            ? "carried-over"
            : p.miss?.kind === "ran-over"
              ? "ran-over"
              : undefined,
      });
    }
    // Chronological, and tolerant of the several timestamp formats in play.
    // This compared strings, so "…T09:00:00Z" and "…T09:00:00.000Z" sorted
    // apart and an unscheduled row led the day.
    rows.sort((a, b) => byTime(a.start, b.start));
    const meetingMin = plan.meetings.reduce((s, m) => s + minutesBetween(m.start, m.end), 0);
    const workMin = plan.plan.reduce((s, p) => s + p.estimateMinutes, 0);
    return { rows, tally: { meetings: meetingMin, work: workMin, free: Math.max(0, DAY_MINUTES - meetingMin - workMin) } };
  }

  reorder(actor: ActorId, date: string, orderedIds: string[]): DayPlan {
    const plan = this.require(actor, date);
    const byId = new Map(plan.plan.map((p) => [p.id, p]));
    const moved = orderedIds.map((id) => byId.get(id)).filter((p): p is PlanItem => Boolean(p));
    // Anything the caller left out keeps its place at the end rather than
    // vanishing — a partial list used to silently delete the rest of the day.
    const rest = plan.plan.filter((p) => !orderedIds.includes(p.id));
    plan.plan = [...moved, ...rest];
    scheduleWork(plan);
    this.store.put(plan);
    return plan;
  }

  /**
   * Tick an item off — or, with `progressMinutes`, record that some of it got
   * done without claiming it is finished.
   *
   * Appendix A9: "half done: progress recorded, remainder carried forward.
   * Only the shortfall counts against the day." Before this, an item was done
   * or not done, so finishing 90% of something counted exactly the same as
   * never starting it.
   *
   * The partial path deliberately does **not** classify a miss. A miss is a
   * judgement about finished work, and A4 is explicit that asking "why didn't
   * you finish?" while somebody is still doing the work is the fastest way to
   * make the application feel like a supervisor. Recording progress is not
   * finishing; the question, if there is one, comes at close-out.
   */
  async tick(
    actor: ActorId,
    date: string,
    itemId: string,
    input: { actualMinutes?: number; at?: string; progressMinutes?: number },
  ): Promise<{ item?: PlanItem; miss?: PlanItem["miss"]; offerNow?: boolean; shortfallMinutes?: number }> {
    const plan = this.require(actor, date);
    const item = plan.plan.find((p) => p.id === itemId);
    if (!item) return {};

    if (input.progressMinutes !== undefined) {
      const added = Number(input.progressMinutes);
      if (!Number.isFinite(added) || added <= 0) {
        return { item, shortfallMinutes: shortfallOf(item) };
      }
      if (item.done || isDropped(item)) return { item, shortfallMinutes: 0 };
      // Several sittings add up — 20 minutes now and 20 later is 40 done.
      item.progressMinutes = (item.progressMinutes ?? 0) + Math.round(added);
      this.store.put(plan);
      return { item, shortfallMinutes: shortfallOf(item) };
    }

    item.done = true;
    item.doneAt = input.at ?? new Date().toISOString();
    item.actualMinutes = input.actualMinutes;
    // Finished: whatever was part-done is now simply done, and `shortfallOf`
    // returns zero regardless. The recorded progress stays for the history.
    if (item.actualMinutes && item.actualMinutes > item.estimateMinutes) {
      const live = await loadMeetings(this.deps.graph, actor, date);
      const byId = new Map<string, MeetingItem>();
      for (const m of [...plan.meetings, ...live]) byId.set(m.id, m);
      const classification = classifyMiss(item, [...byId.values()]);
      item.miss = { kind: classification.kind, cause: classification.cause };
      if (classification.kind === "interrupted") {
        item.interrupted = true;
      } else {
        const remaining = plan.plan.filter((p) => !p.done && !isDropped(p));
        const offerNow = restOfDayAtRisk(item, remaining, item.doneAt ?? "");
        item.miss.offerNow = offerNow;
      }
      // Learn from what it actually took, here rather than in
      // `recordMissReason`. Learning used to depend on the person answering a
      // question they are free to ignore — and A4 says an ignored question
      // "lapses quietly" — so the table stayed empty in exactly the cases it
      // most needed filling. The answer improves the *reason*; the minutes are
      // a fact either way.
      if (item.ref) {
        this.store.recordEstimate(
          `${item.ref.nodeType}:${item.ref.nodeId}`,
          item.estimateMinutes,
          item.actualMinutes,
        );
      }
    }
    this.store.put(plan);
    return { item, miss: item.miss, offerNow: item.miss?.offerNow, shortfallMinutes: 0 };
  }

  /**
   * Appendix A9 — "item dropped mid-day: allowed. Asked once why, does not
   * break the streak."
   *
   * Nothing implemented this: there was no drop path anywhere, so the only way
   * to abandon a committed item was to leave it open and let it fail the day.
   *
   * Three deliberate choices:
   *
   *  - It works on a **committed** day. `require`, not `requirePlanning` —
   *    dropping mid-day is the entire point, and A1b already has the morning
   *    plan as "a starting point, not a contract".
   *  - The item is **marked**, never removed, so the day stays an honest record
   *    and `assessDay` can see it was dropped rather than simply missing.
   *  - The reason is **optional**, and asking for it does not spend the
   *    two-a-day question budget. That budget exists to stop the application
   *    interrupting *you*; this prompt is part of an action you started. A drop
   *    that silently refuses to hear why, because a miss question was asked
   *    earlier, would be worse than not asking.
   *
   * Idempotent: dropping twice keeps the first decision and its reason.
   */
  dropItem(
    actor: ActorId,
    date: string,
    itemId: string,
    reason?: string,
    at?: string,
  ): { item?: PlanItem; error?: string } {
    const plan = this.require(actor, date);
    const item = plan.plan.find((p) => p.id === itemId);
    if (!item) return { error: "No such item on today's plan." };
    if (item.done) {
      return { error: "That is already finished — there is nothing to drop." };
    }
    if (!isDropped(item)) {
      item.dropped = {
        at: at ?? new Date().toISOString(),
        reason: reason?.trim() || undefined,
      };
    } else if (reason?.trim() && !item.dropped!.reason) {
      // Asked once, answered late — keep the answer.
      item.dropped!.reason = reason.trim();
    }
    // The day closes up around it, so later work is not left sitting behind a
    // slot nobody is working.
    scheduleWork(plan);
    this.store.put(plan);
    return { item };
  }

  recordMissReason(actor: ActorId, date: string, itemId: string, reason: string): { asked: boolean; learnedEstimate?: number } {
    const plan = this.require(actor, date);
    const item = plan.plan.find((p) => p.id === itemId);
    if (!item?.miss || item.miss.kind !== "ran-over") return { asked: false };
    // The plan's own date, not `doneAt`. `doneAt` is a UTC instant, so slicing
    // it gave the UTC day — the allowance then rolled over at the wrong
    // midnight and was filed under a key the local-time hydration at boot
    // would never look up.
    if (!this.deps.limiter.tryConsume(actor, plan.date)) {
      item.miss.lapsed = true;
      this.store.put(plan);
      return { asked: false };
    }
    item.miss.reason = reason;
    item.miss.asked = true;
    // The minutes were already recorded by `tick` — recording them again here
    // would count one overrun twice and drag every future estimate upward.
    this.store.put(plan);
    const learned = item.ref ? this.store.learnedAdjustment(`${item.ref.nodeType}:${item.ref.nodeId}`) : undefined;
    return { asked: true, learnedEstimate: learned };
  }

  arriveDuringDay(actor: ActorId, date: string, meeting: MeetingItem): DayPlan {
    const plan = this.require(actor, date);
    const arrived = { ...meeting, arrivedDuringDay: true };
    plan.meetings.push(arrived);
    for (const item of plan.plan) {
      if (item.done || item.interrupted) continue;
      if (overlaps(item.start, item.end, arrived.start, arrived.end)) {
        item.interrupted = true;
        item.miss = { kind: "interrupted", cause: arrived.title };
      }
    }
    // A6: "displaced work is rescheduled automatically and marked interrupted."
    // The marking was already here; the rescheduling was not, so displaced work
    // kept a window the meeting now occupies.
    scheduleWork(plan);
    this.store.put(plan);
    return plan;
  }

  markLeave(actor: ActorId, date: string): DayPlan {
    const plan = this.require(actor, date);
    plan.onLeave = true;
    this.store.put(plan);
    return plan;
  }

  /**
   * What you did today — **told**, not asked.
   *
   * The requirement behind this phase says clock-out should "ask what have you
   * done today". Deliberately not doing that. The application has every ticked
   * item, every estimate and every actual; A2 is explicit that asking what it
   * already knows is what destroys trust in it. So this reports the day, and
   * the only questions are about the part it genuinely cannot know — what to
   * do with work that is still open.
   */
  closeOutSummary(actor: ActorId, date: string): CloseOutSummary {
    const plan = this.require(actor, date);
    const outcome = assessDay(plan);
    const open = plan.plan.filter((p) => !p.done && !isDropped(p) && !p.carriedOver);
    return {
      committed: plan.plan.length,
      done: plan.plan.filter((p) => p.done).length,
      committedMinutes: plan.plan.reduce((sum, p) => sum + (Number(p.estimateMinutes) || 0), 0),
      // What the day actually absorbed: finished work at what it really took,
      // plus recorded progress on what is still open.
      workedMinutes: plan.plan.reduce((sum, p) => {
        if (isDropped(p)) return sum;
        if (p.done) return sum + (Number(p.actualMinutes) || Number(p.estimateMinutes) || 0);
        return sum + (Number(p.progressMinutes) || 0);
      }, 0),
      dropped: plan.plan.filter(isDropped).length,
      shortfallMinutes: outcome.shortfallMinutes,
      ranOver: plan.plan
        .filter((p) => p.miss?.kind === "ran-over" && !isDropped(p))
        .map((p) => ({
          id: p.id,
          label: p.label,
          byMinutes: Math.max(
            0,
            Math.round((Number(p.actualMinutes) || 0) - (Number(p.estimateMinutes) || 0)),
          ),
        })),
      unfinished: open.map((p) => ({
        id: p.id,
        label: p.label,
        estimateMinutes: Number(p.estimateMinutes) || 0,
        progressMinutes: Number(p.progressMinutes) || 0,
        shortfallMinutes: shortfallOf(p),
        interrupted: p.miss?.kind === "interrupted" || p.interrupted === true,
      })),
      answered: open.length === 0,
    };
  }

  /**
   * Open the close-out conversation. **Does not fold the day into the streak.**
   *
   * That is the trap here: `finalizeDay` is idempotent by design, so assessing
   * the day now and taking the answers afterwards would mean every answer
   * arrives too late to change anything — the conversation would be theatre.
   * `finishCloseOut` is what assesses.
   */
  beginCloseOut(actor: ActorId, date: string): CloseOutSummary {
    const plan = this.require(actor, date);
    if (!plan.closeOut) {
      plan.closeOut = { startedAt: new Date().toISOString() };
      this.store.put(plan);
    }
    return this.closeOutSummary(actor, date);
  }

  /**
   * "I mean to do this, just not today."
   *
   * Note what this deliberately does **not** do: excuse the item from the day.
   * The plan for this phase describes carrying over as "does not count against
   * the day", and read as "excused like a dropped item" that would make the
   * streak trivially gameable — tap carry-over on everything and every day is
   * clean. A7 says a day is clean "when every committed item was finished
   * within its time", so an item you did not finish keeps the day from being
   * clean.
   *
   * What it does mean is the thing that actually matters to somebody: carrying
   * work over does not *break* a streak the way a ran-over miss does. That is
   * already how `applyDayToStreak` behaves — not clean, not ran-over, count
   * untouched — so carrying over needs no streak change at all. What it needs
   * is to be offered back tomorrow, which is what the seed does.
   */
  carryOverItem(actor: ActorId, date: string, itemId: string): { item?: PlanItem; error?: string } {
    const plan = this.require(actor, date);
    const item = plan.plan.find((p) => p.id === itemId);
    if (!item) return { error: "No such item on today's plan." };
    if (item.done) return { error: "That is already finished." };
    if (isDropped(item)) return { error: "That was dropped." };
    item.carriedOver = { at: new Date().toISOString() };
    this.seed(plan, item.label);
    this.store.put(plan);
    return { item };
  }

  /** Offer something up for tomorrow without committing to it. */
  private seed(plan: DayPlan, label: string): void {
    const text = label.trim();
    if (!text) return;
    if ((plan.seeded ?? []).includes(text)) return;
    plan.seeded = [...(plan.seeded ?? []), text];
  }

  /**
   * The conversation is over: seed tomorrow, then fold the day in.
   *
   * Anything still open that was never answered is treated as carried over —
   * walking away from the conversation should not silently lose the work.
   */
  finishCloseOut(actor: ActorId, date: string): { plan: DayPlan; seeded: string[] } {
    const plan = this.require(actor, date);
    for (const item of plan.plan) {
      if (item.done || isDropped(item)) continue;
      if (!item.carriedOver) item.carriedOver = { at: new Date().toISOString() };
      this.seed(plan, item.label);
    }
    plan.closeOut = {
      startedAt: plan.closeOut?.startedAt ?? new Date().toISOString(),
      finishedAt: new Date().toISOString(),
    };
    this.store.put(plan);
    // Only now. Every answer above is already on the plan being assessed.
    this.finalizeDay(actor, date);
    return { plan, seeded: plan.seeded ?? [] };
  }

  finalizeDay(actor: ActorId, date: string): DayPlan {
    const plan = this.store.get(actor, date);
    if (!plan) throw new Error(`No plan for ${actor} on ${date}`);
    const streak = this.store.streakFor(actor);
    applyDayToStreak(plan, streak);
    this.store.put(plan);
    return plan;
  }

  /**
   * What a manager may see of one person's day — appendix A8, and no more:
   * what was committed, whether it was done, and the time estimate. Never the
   * streak, and never the reason given for a miss.
   *
   * This is a **whitelist** on purpose. It used to spread `...rest` after
   * removing `miss` and `interrupted`, which still handed back `actualMinutes`
   * and `doneAt` — and `actualMinutes > estimateMinutes` *is* the ran-over
   * miss, reconstructible in one subtraction. A8's whole point is that the
   * reason stays between a person and the application, "because people answer
   * honestly when nobody is reading over their shoulder". Naming the four
   * fields that may leave means a new field on `PlanItem` is private by
   * default rather than exposed by accident.
   */
  managerView(
    _manager: ActorId,
    teamMember: ActorId,
    date: string,
  ): { committed: ManagerVisibleItem[]; streakVisible: false } {
    const plan = this.store.get(teamMember, date);
    return {
      committed: (plan?.plan ?? []).map((item) => ({
        id: item.id,
        label: item.label,
        estimateMinutes: item.estimateMinutes,
        done: Boolean(item.done),
      })),
      streakVisible: false,
    };
  }

  getStore(): DayPlanStore {
    return this.store;
  }

  /**
   * The day must already exist.
   *
   * This used to call `startDay` without awaiting it and then non-null-assert
   * the result. `startDay` awaits `generateBrief`, so the store was still empty
   * when the assertion ran and every caller received `undefined` typed as a
   * `DayPlan` — a crash on the next property access. Failing loudly is both
   * honest and recoverable: the route turns it into a 422, and the dashboard
   * only offers planning actions once the day has been started.
   */
  private require(actor: ActorId, date: string): DayPlan {
    const plan = this.store.get(actor, date);
    if (!plan) {
      throw new Error("No day has been started yet — start the day first.");
    }
    return plan;
  }

  /**
   * The day must exist *and* the morning conversation must still be running.
   *
   * Without this, `answerBrief` walked straight through a committed day —
   * `currentBriefItem` returned `null`, the switch was skipped, and `briefStep`
   * still advanced past the end, pushing `phase` from `planned` back to
   * `planning`. The dashboard then re-rendered the picker over a day already
   * under way.
   *
   * Only the brief is guarded. `selectItem` and `reorder` stay open on a
   * committed day on purpose — A9 allows an item to be added mid-day ("it needs
   * a time estimate like anything else") and A1b allows reordering "at any
   * time", because "the morning plan is a starting point, not a contract".
   */
  private requirePlanning(actor: ActorId, date: string, what: string): DayPlan {
    const plan = this.require(actor, date);
    if (plan.phase === "planned") {
      throw new Error(`Today is already planned — you cannot ${what} now.`);
    }
    return plan;
  }

  /**
   * The brief comes first — A1's "conversation-first", enforced here rather
   * than only in the screen that happens to render it.
   *
   * `selectItem` and `commitPlan` both took any existing day, so
   * `start` → `select` → `commit` committed a plan while still in `briefing`
   * with not one brief item answered, and `commitPlan` flipped the phase
   * straight to `planned`. Only the dashboard's own sequencing prevented it,
   * which is not enforcement.
   *
   * Choosing work *after* the brief stays open for the rest of the day: A9
   * allows an item to be added mid-day, so `planned` is fine here — it is
   * `briefing` that is too early.
   */
  private requireBriefDone(actor: ActorId, date: string, what: string): DayPlan {
    const plan = this.require(actor, date);
    if (plan.phase === "briefing") {
      throw new Error(`Your brief comes first — finish it before you ${what}.`);
    }
    return plan;
  }
}

function minutesBetween(start?: string, end?: string): number {
  if (!start || !end) return 0;
  return Math.max(0, Math.round((new Date(end).getTime() - new Date(start).getTime()) / 60000));
}


