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

const DAY_MINUTES = 8 * 60;

export interface DayPlanDeps {
  graph: RecordStore;
  limiter: QuestionLimiter;
  actorLookup: (actor: ActorId) => { spine: import("@/spine/spine").Spine };
}

function loadMeetings(graph: RecordStore, actor: string, date: string): MeetingItem[] {
  return graph
    .find(
      "meeting",
      (n) =>
        (n.data as { cancelled?: boolean }).cancelled !== true &&
        ((n.data as { attendees?: string[] }).attendees ?? []).includes(actor),
    )
    .filter((n) => String((n.data as { from?: string }).from ?? "").slice(0, 10) === date)
    .map((n) => {
      const d = n.data as { title?: string; from?: string; to?: string };
      return {
        id: n.id,
        title: d.title ?? n.id,
        start: d.from ?? `${date}T09:00:00Z`,
        end: d.to ?? `${date}T10:00:00Z`,
      };
    });
}

export class DayPlanService {
  constructor(
    private readonly store: DayPlanStore,
    private readonly deps: DayPlanDeps,
  ) {}

  startDay(actor: ActorId, date: string): { open: "brief" | "dashboard" | "resume"; plan?: DayPlan; prompt?: string } {
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
    const brief = generateBrief({ actor, spine, graph: this.deps.graph, asOf: `${date}T23:59:59Z` });
    const plan: DayPlan = {
      actor,
      date,
      phase: "briefing",
      brief,
      briefStep: 0,
      plan: [],
      meetings: loadMeetings(this.deps.graph, actor, date),
      streak: this.store.streakFor(actor),
    };
    this.store.put(plan);
    return { open: "brief", plan };
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

  answerBrief(actor: ActorId, date: string, _reply: string): DayPlan {
    const plan = this.require(actor, date);
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
    const plan = this.require(actor, date);
    const meetingMinutes = plan.meetings.reduce(
      (sum, m) => sum + minutesBetween(m.start, m.end),
      0,
    );
    const workMinutes = plan.plan.reduce((s, p) => s + p.estimateMinutes, 0) + input.estimateMinutes;
    const overCapacity = meetingMinutes + workMinutes > DAY_MINUTES;
    const item: PlanItem = {
      id: `item_${Date.now().toString(36)}_${plan.plan.length + 1}`,
      label: input.label,
      ref: input.ref,
      estimateMinutes: input.estimateMinutes,
      start: input.start,
      end: input.end,
    };
    plan.plan.push(item);
    this.store.put(plan);
    return { item, overCapacity };
  }

  commitPlan(actor: ActorId, date: string): DayPlan {
    const plan = this.require(actor, date);
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
    rows.sort((a, b) => String(a.start ?? "").localeCompare(String(b.start ?? "")));
    const meetingMin = plan.meetings.reduce((s, m) => s + minutesBetween(m.start, m.end), 0);
    const workMin = plan.plan.reduce((s, p) => s + p.estimateMinutes, 0);
    return { rows, tally: { meetings: meetingMin, work: workMin, free: Math.max(0, DAY_MINUTES - meetingMin - workMin) } };
  }

  reorder(actor: ActorId, date: string, orderedIds: string[]): DayPlan {
    const plan = this.require(actor, date);
    const byId = new Map(plan.plan.map((p) => [p.id, p]));
    plan.plan = orderedIds.map((id) => byId.get(id)).filter((p): p is PlanItem => Boolean(p));
    this.store.put(plan);
    return plan;
  }

  tick(
    actor: ActorId,
    date: string,
    itemId: string,
    input: { actualMinutes?: number; at?: string },
  ): { item?: PlanItem; miss?: PlanItem["miss"]; offerNow?: boolean } {
    const plan = this.require(actor, date);
    const item = plan.plan.find((p) => p.id === itemId);
    if (!item) return {};
    item.done = true;
    item.doneAt = input.at ?? new Date().toISOString();
    item.actualMinutes = input.actualMinutes;
    if (item.actualMinutes && item.actualMinutes > item.estimateMinutes) {
      const live = loadMeetings(this.deps.graph, actor, date);
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
    }
    this.store.put(plan);
    return { item, miss: item.miss, offerNow: item.miss?.offerNow };
  }

  recordMissReason(actor: ActorId, date: string, itemId: string, reason: string): { asked: boolean; learnedEstimate?: number } {
    const plan = this.require(actor, date);
    const item = plan.plan.find((p) => p.id === itemId);
    if (!item?.miss || item.miss.kind !== "ran-over") return { asked: false };
    const day = (item.doneAt ?? plan.date).slice(0, 10);
    if (!this.deps.limiter.tryConsume(actor, day)) {
      item.miss.lapsed = true;
      this.store.put(plan);
      return { asked: false };
    }
    item.miss.reason = reason;
    item.miss.asked = true;
    if (item.ref) {
      const key = `${item.ref.nodeType}:${item.ref.nodeId}`;
      this.store.recordEstimate(key, item.estimateMinutes, item.actualMinutes ?? item.estimateMinutes);
    }
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
      if (overlap(item.start, item.end, arrived.start, arrived.end)) {
        item.interrupted = true;
        item.miss = { kind: "interrupted", cause: arrived.title };
      }
    }
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

  managerView(
    _manager: ActorId,
    teamMember: ActorId,
    date: string,
  ): { committed: PlanItem[]; streakVisible: false } {
    const plan = this.store.get(teamMember, date);
    return {
      committed: plan ? plan.plan.map(({ miss, interrupted, ...rest }) => {
        void miss;
        void interrupted;
        return rest;
      }) : [],
      streakVisible: false,
    };
  }

  getStore(): DayPlanStore {
    return this.store;
  }

  private require(actor: ActorId, date: string): DayPlan {
    const plan = this.store.get(actor, date);
    if (!plan) {
      this.startDay(actor, date);
      return this.store.get(actor, date)!;
    }
    return plan;
  }
}

function minutesBetween(start?: string, end?: string): number {
  if (!start || !end) return 0;
  return Math.max(0, Math.round((new Date(end).getTime() - new Date(start).getTime()) / 60000));
}

function overlap(aStart?: string, aEnd?: string, bStart?: string, bEnd?: string): boolean {
  if (!aStart || !aEnd || !bStart || !bEnd) return false;
  return aStart < bEnd && bStart < aEnd;
}
