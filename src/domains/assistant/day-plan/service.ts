import type { ActorId } from "@/spine/operation/types";
import type { RecordStore } from "@/spine/record/types";
import type { QuestionLimiter } from "@/domains/workplace/shared/limiter";
import { generateBrief } from "../briefing";
import {
  DayPlanStore,
  type DayPlan,
  type MeetingItem,
  type PlanItem,
} from "./store";
import { classifyMiss, restOfDayAtRisk } from "./miss-classifier";
import { applyDayToStreak } from "./streak";
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
    if (!isMovable(p)) anchor(p.start, p.end);
  }
  fixed.sort((a, b) => a.start - b.start);

  const opensAt = dayWindowStart(plan.date);
  if (!Number.isFinite(opensAt)) return;
  let cursor = opensAt;

  for (const item of plan.plan) {
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
      const d = n.data as { title?: string; from?: string; to?: string };
      // A meeting with no time falls back to the hour the working day opens,
      // in local terms like everything else here.
      const opensAt = dayWindowStart(date);
      return {
        id: n.id,
        title: d.title ?? n.id,
        start: d.from ?? new Date(opensAt).toISOString(),
        end: d.to ?? new Date(opensAt + 60 * 60_000).toISOString(),
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
    };
    this.store.put(plan);
    return { open: "brief", plan };
  }

  /**
   * Yesterday's unfinished work and anything the person pushed to "Later".
   *
   * Interrupted work is named as such: the time was taken from them, and the
   * brief must not read as a reprimand for it (appendix A3).
   */
  private async carryForward(actor: ActorId, date: string): Promise<string[]> {
    const previous = previousDay(date);
    await this.store.load(actor, previous);
    const yesterday = this.store.get(actor, previous);
    if (!yesterday || yesterday.onLeave) return [];
    const lines: string[] = [];
    for (const item of yesterday.plan) {
      if (item.done) continue;
      lines.push(
        item.miss?.kind === "interrupted" || item.interrupted
          ? `${item.label} was interrupted yesterday and is still open.`
          : `${item.label} is still open from yesterday.`,
      );
    }
    for (const text of yesterday.deferred ?? []) {
      lines.push(`${text} (you left this for today)`);
    }
    return lines;
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
        tag: p.miss?.kind === "interrupted" ? "carried-over" : p.miss?.kind === "ran-over" ? "ran-over" : undefined,
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

  async tick(
    actor: ActorId,
    date: string,
    itemId: string,
    input: { actualMinutes?: number; at?: string },
  ): Promise<{ item?: PlanItem; miss?: PlanItem["miss"]; offerNow?: boolean }> {
    const plan = this.require(actor, date);
    const item = plan.plan.find((p) => p.id === itemId);
    if (!item) return {};
    item.done = true;
    item.doneAt = input.at ?? new Date().toISOString();
    item.actualMinutes = input.actualMinutes;
    if (item.actualMinutes && item.actualMinutes > item.estimateMinutes) {
      const live = await loadMeetings(this.deps.graph, actor, date);
      const byId = new Map<string, MeetingItem>();
      for (const m of [...plan.meetings, ...live]) byId.set(m.id, m);
      const classification = classifyMiss(item, [...byId.values()]);
      item.miss = { kind: classification.kind, cause: classification.cause };
      if (classification.kind === "interrupted") {
        item.interrupted = true;
      } else {
        const remaining = plan.plan.filter((p) => !p.done);
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
    return { item, miss: item.miss, offerNow: item.miss?.offerNow };
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


