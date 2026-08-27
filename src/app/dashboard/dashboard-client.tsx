"use client";

import Link from "next/link";
import { firstAtRisk } from "@/domains/assistant/day-plan/miss-classifier";
import { at } from "@/domains/assistant/day-plan/time";
import type { PlanItem } from "@/domains/assistant/day-plan/store";
import { useCallback, useEffect, useMemo, useState } from "react";
import { isApprover as roleIsApprover } from "@/server/roles";
import { Icon } from "../ui/icons";
import { CountUp, ThreeRings } from "../ui/progress-ring";
import { Empty, OpFeedback, PriorityBadge } from "../ui/kit";
import { useOperation } from "@/components/ops/use-operation";
import { useLiveEvent } from "../chrome/live";
import { fmtDate, fmtDateTime, fmtDayDate, fmtMonthYear, fmtTime } from "../ui/dates";
import { DayChat } from "./day-chat";

interface TaskItem {
  id: string;
  title: string;
  priority: string;
  /** "todo" | "in-progress" | … — the picker separates started from not. */
  status?: string;
  dueDate?: string;
  projectId?: string;
  estimateMinutes?: number;
}

interface MeetingItem {
  id: string;
  title: string;
  from?: string;
  to?: string;
  kind?: string;
  /** E7: the link is visible in each person's day. Absent for in-person. */
  link?: string;
}

interface PendingLeave {
  id: string;
  employeeName?: string;
  fromDate?: string;
  toDate?: string;
}

/** Mirror of /api/today's response. */
interface TodayState {
  date: string;
  attendance: { checkInAt?: string; checkOutAt?: string; workedMinutes?: number };
  phase: "none" | "briefing" | "planning" | "planned" | "abandoned";
  briefItem: { text: string; replies: string[]; index: number; total: number } | null;
  plan: Array<{
    id: string;
    label: string;
    estimateMinutes: number;
    done?: boolean;
    tag?: string;
    ref?: { nodeType: string; nodeId: string };
    missOffered?: boolean;
    /** A9 — dropped mid-day: still listed, off the day's account. */
    dropped?: { at: string; reason?: string };
    /** A9 — minutes done on unfinished work, and what is still owed. */
    progressMinutes?: number;
    shortfallMinutes?: number;
    /** The window this item holds in the day (A4's live overrun check). */
    start?: string;
    end?: string;
    /** Answered before the window ended — its presence stops a re-ask. */
    check?: { status: "on-time" | "more-time" | "blocked"; at: string; note?: string };
  }>;
  rows: Array<{ kind: "work" | "meeting"; id: string; title: string; start?: string; done?: boolean; tag?: string }>;
  tally: { meetings: number; work: number; free: number };
  streak: { clean: number; bestClean: number; dayPlanned: number };
  /** Brief items you said you would handle — offered first when choosing. */
  suggested: string[];
  resumePrompt?: string;
  /** What past runs of a record actually took, keyed `nodeType:nodeId`. */
  estimateHints: Record<string, number>;
  /** The close-out conversation, present once clocking out has opened it. */
  /** Work assigned after the day was committed — offered, not inserted. */
  newWork?: Array<{
    id: string;
    title: string;
    priority?: string;
    dueDate?: string;
    learnedMinutes?: number;
  }>;
  closeOut?: {
    committed: number;
    done: number;
    committedMinutes: number;
    workedMinutes: number;
    dropped: number;
    shortfallMinutes: number;
    ranOver: Array<{ id: string; label: string; byMinutes: number }>;
    unfinished: Array<{
      id: string;
      label: string;
      estimateMinutes: number;
      progressMinutes: number;
      shortfallMinutes: number;
      interrupted: boolean;
    }>;
    answered: boolean;
    finished: boolean;
  };
  seeded?: string[];
  overCapacity?: boolean;
  offerNow?: boolean;
  asked?: boolean;
  learnedEstimate?: number;
}

/* Category coding: every meeting kind owns a pastel, consistently. */
const KIND_STYLE: Record<string, { bg: string; edge: string; text: string }> = {
  "one-on-one": { bg: "bg-mint", edge: "border-mint-strong", text: "text-mint-strong" },
  standup: { bg: "bg-mint", edge: "border-mint-strong", text: "text-mint-strong" },
  review: { bg: "bg-lilac", edge: "border-lilac-strong", text: "text-lilac-strong" },
  training: { bg: "bg-lilac", edge: "border-lilac-strong", text: "text-lilac-strong" },
  external: { bg: "bg-peach", edge: "border-peach-strong", text: "text-peach-strong" },
};
const KIND_DEFAULT = { bg: "bg-mint", edge: "border-mint-strong", text: "text-mint-strong" };

const ESTIMATES = [15, 30, 45, 60, 90, 120, 180, 240];

function fmtMin(min: number): string {
  const h = Math.floor(min / 60);
  const m = min % 60;
  if (h === 0) return `${m}m`;
  if (m === 0) return `${h}h`;
  return `${h}h ${m}m`;
}

/** The clock, from the one place dates are written. */
const fmtClock = fmtTime;

/**
 * Snap a figure onto the picker's own scale (appendix A5).
 *
 * Preference order is what the work has actually taken before, then whatever
 * estimate the task itself carries, then an hour — the default this had before
 * either was available.
 */
function nearestEstimate(...candidates: Array<number | undefined>): number {
  const minutes = candidates.find((m) => typeof m === "number" && m > 0);
  if (!minutes) return 60;
  return ESTIMATES.reduce((best, m) =>
    Math.abs(m - minutes) < Math.abs(best - minutes) ? m : best,
  );
}

export function DashboardClient({
  userId,
  displayName,
  role,
  tasks,
  meetings,
  pendingApprovals,
  courseCount,
  teamSize,
  hrAttention,
  people,
}: {
  userId: string;
  displayName: string;
  role: string;
  tasks: TaskItem[];
  meetings: MeetingItem[];
  pendingApprovals: PendingLeave[];
  courseCount: number;
  teamSize: number;
  hrAttention: { activeOnboardings: number; expiringDocs: number } | null;
  /** Who can be invited — active people, from the same directory `/meetings` reads. */
  people: Array<{ id: string; name: string }>;
}) {
  const op = useOperation();
  const [day, setDay] = useState<TodayState | null>(null);
  const [busyLeave, setBusyLeave] = useState<string | null>(null);
  const [customLabel, setCustomLabel] = useState("");
  const [estimate, setEstimate] = useState(60);
  const [taskEstimates, setTaskEstimates] = useState<Record<string, number>>({});
  const [tickFor, setTickFor] = useState<string | null>(null);
  const [missFor, setMissFor] = useState<string | null>(null);
  const [dropFor, setDropFor] = useState<string | null>(null);
  /** Ticks every minute so A4's overrun check runs against the wall clock. */
  const [nowMs, setNowMs] = useState<number>(() => Date.now());
  const [dismissTick, setDismissTick] = useState(0);
  /** Named by the server when an early "I need longer" displaces later work. */
  const [atRisk, setAtRisk] = useState<string | null>(null);
  /** Which way the person chose to start the day, once the prompt is answered. */
  const [startingDay, setStartingDay] = useState(false);
  /**
   * The conversation dialog, waved away for now.
   *
   * A4: an ignored question "lapses quietly. No reminder, no second ask." So
   * "Later" closes it for this visit rather than queueing it to reappear.
   */
  const [chatWavedOff, setChatWavedOff] = useState(false);
  const [openChat, setOpenChat] = useState<
    "plan" | "newWork" | "check" | "miss" | "closeout" | null
  >(null);
  /**
   * Which way they chose at clock-in. "form" keeps the old on-screen brief;
   * "chat" and "voice" hand the morning to the assistant, which then runs it.
   */
  const [planInChat, setPlanInChat] = useState(false);
  const [chatMiss, setChatMiss] = useState<{
    id: string;
    label: string;
    estimateMinutes: number;
  } | null>(null);

  /**
   * Arranging a meeting without leaving the dashboard.
   *
   * `/meetings` has had this form for a while; the dashboard only ever showed
   * what was already booked and a link to go elsewhere. Most meetings are
   * arranged while looking at the day they land in, so the form belongs beside
   * the day rather than one navigation away.
   *
   * `kind` starts EMPTY on purpose. The chat tool used to default to "both" and
   * quietly reserved a room for people who had only ever asked for a link — so
   * here the choice is made rather than inherited.
   */
  const [showMeetingForm, setShowMeetingForm] = useState(false);
  const [meetingForm, setMeetingForm] = useState({
    title: "",
    kind: "" as "" | "online" | "in-person" | "both",
    from: "",
    to: "",
    attendees: [] as string[],
  });
  const [learned, setLearned] = useState<{ label: string; planned: number; suggested: number } | null>(null);
  const [closingOut, setClosingOut] = useState(false);

  const isApprover = roleIsApprover(role);

  /*
   * ── A4: tell me while it is happening ────────────────────────────────────
   *
   * "The moment it runs over — an offer. No question is asked… 'Module 4 is
   * running over. Your 12:00 session will not fit. [Move it] [Drop the Friday
   * prep] [Leave it]'"
   *
   * A client poll, not a server job. A4 makes this a *dashboard prompt* and
   * says plainly that "the chat never opens by itself while you are working" —
   * a scan that fires when nobody is looking produces a stale notification, not
   * help. Phase 2's question scheduler is the thing that genuinely needs a
   * server tick; this is not.
   */
  useEffect(() => {
    const id = setInterval(() => setNowMs(Date.now()), 60_000);
    return () => clearInterval(id);
  }, []);

  const seenKey = day ? `orga.overrunSeen.${userId}.${day.date}` : null;
  const checkKey = day ? `orga.checkSeen.${userId}.${day.date}` : null;

  /**
   * Which items have already had their say today — once per item per day.
   *
   * A warning that repeats every minute is an alarm clock, so a dismissal has
   * to survive a reload. Kept in `localStorage` rather than on the item: it is
   * a per-viewer courtesy, not a fact about the day, and it must not travel to
   * a manager through any projection of the plan.
   *
   * Read where it is used rather than hydrated into state by an effect —
   * `dismissTick` is what makes a dismissal recompute this.
   */
  /**
   * Book it, through the same operation `/meetings` submits.
   *
   * ⚠ `new Date(local).toISOString()` is doing real work here, not ceremony.
   * A `datetime-local` value carries no zone, so `new Date` reads it in this
   * machine's — which is what the person meant — and `toISOString` turns it
   * into the instant. Passing the raw string through would send a wall-clock
   * time as though it were UTC, which is the same mistake `time.ts` records
   * being fixed once for the calendar and again for the chat tool.
   */
  async function createMeeting() {
    const f = meetingForm;
    if (!f.title.trim() || !f.kind || !f.from || !f.to) return;
    const outcome = await op.run("meeting.create", {
      title: f.title.trim(),
      kind: f.kind,
      from: new Date(f.from).toISOString(),
      to: new Date(f.to).toISOString(),
      attendees: f.attendees,
    });
    // Only clear on success. A rejection — no room free, a clash, a refused
    // permission — leaves everything typed where it was, because retyping a
    // meeting you already described is the fastest way to stop using a form.
    if (outcome.status === "ran") {
      setShowMeetingForm(false);
      setMeetingForm({ title: "", kind: "", from: "", to: "", attendees: [] });
    }
  }

  function toggleMeetingAttendee(id: string) {
    setMeetingForm((f) => ({
      ...f,
      attendees: f.attendees.includes(id)
        ? f.attendees.filter((a) => a !== id)
        : [...f.attendees, id],
    }));
  }

  function seenOverruns(): Set<string> {
    if (!seenKey) return new Set();
    try {
      const raw = window.localStorage.getItem(seenKey);
      return new Set(raw ? (JSON.parse(raw) as string[]) : []);
    } catch {
      // A browser refusing storage costs at most a repeated warning.
      return new Set();
    }
  }

  function dismissOverrun(itemId: string) {
    try {
      if (seenKey) {
        const next = seenOverruns().add(itemId);
        window.localStorage.setItem(seenKey, JSON.stringify([...next]));
      }
    } catch {}
    setDismissTick((n) => n + 1);
  }

  /*
   * The same courtesy for the before-the-end check, in its own key. Answering
   * it writes `check` on the item and that alone stops the re-ask everywhere;
   * this only covers the person who waves it away without answering, and must
   * not silence the overrun warning that may follow it.
   */
  function seenChecks(): Set<string> {
    if (!checkKey) return new Set();
    try {
      const raw = window.localStorage.getItem(checkKey);
      return new Set(raw ? (JSON.parse(raw) as string[]) : []);
    } catch {
      return new Set();
    }
  }

  function dismissCheck(itemId: string) {
    try {
      if (checkKey) {
        const next = seenChecks().add(itemId);
        window.localStorage.setItem(checkKey, JSON.stringify([...next]));
      }
    } catch {}
    setDismissTick((n) => n + 1);
  }

  /**
   * All four conditions, or say nothing:
   *   1 committed and not done · 2 past its planned end
   *   3 something later is genuinely displaced · 4 not already shown today
   *
   * Condition 3 is the one that keeps it quiet. A4: "if nothing later is at
   * risk, it says nothing at all." `firstAtRisk` is the same predicate the
   * post-hoc question uses, so the two can never disagree about that.
   */
  const overrun = ((): { item: PlanItem; displaced: PlanItem } | null => {
    void dismissTick;
    if (!day || day.phase !== "planned") return null;
    // Not while the day is being closed — that conversation asks its own way.
    if (day.closeOut) return null;
    const seen = seenOverruns();
    const nowIso = new Date(nowMs).toISOString();
    const live: PlanItem[] = day.plan
      .filter((p) => !p.done && !p.dropped)
      .map((p) => ({
        id: p.id,
        label: p.label,
        estimateMinutes: p.estimateMinutes,
        start: p.start,
        end: p.end,
        done: p.done,
        dropped: p.dropped,
      }));
    for (const item of live) {
      if (seen.has(item.id)) continue;
      const end = at(item.end);
      if (!Number.isFinite(end) || end >= nowMs) continue;
      const displaced = firstAtRisk(item, live, nowIso);
      if (!displaced) continue;
      return { item, displaced };
    }
    return null;
  })();

  /**
   * The check made shortly BEFORE a slot ends — "still on track?"
   *
   * The mirror image of `overrun` above, and the distinction is the whole
   * point: that one fires once the time has gone, this one fires while the work
   * can still be rescued. A4 allows the interruption on exactly that basis —
   * *"interrupt to help, never to interrogate"* — so this asks about the work
   * ahead, never about a failure behind.
   *
   * Four conditions, or say nothing:
   *   1 committed, not done, not dropped
   *   2 inside the last `CHECK_LEAD_MINUTES` of its own window
   *   3 not already answered — by this screen, by chat, or by voice (`check`)
   *   4 not already dismissed on this screen today
   *
   * It never opens the chat by itself (appendix A1c); it is the small
   * dashboard prompt that section explicitly allows.
   */
  const CHECK_LEAD_MINUTES = 10;
  const endingSoon = ((): PlanItem | null => {
    void dismissTick;
    if (!day || day.phase !== "planned") return null;
    if (day.closeOut) return null;
    const seen = seenChecks();
    for (const p of day.plan) {
      if (p.done || p.dropped || p.check) continue;
      if (seen.has(p.id)) continue;
      const end = at(p.end);
      if (!Number.isFinite(end)) continue;
      const minutesLeft = (end - nowMs) / 60000;
      // Inside the lead window, and not yet past it — once it is past, the
      // overrun strip above owns the moment instead.
      if (minutesLeft <= CHECK_LEAD_MINUTES && minutesLeft > 0) {
        return {
          id: p.id,
          label: p.label,
          estimateMinutes: p.estimateMinutes,
          start: p.start,
          end: p.end,
        } as PlanItem;
      }
    }
    return null;
  })();

  /**
   * The next piece of work still owed, and when its slot ends.
   *
   * What the watch line counts down to, so the loop is something a person can
   * see running rather than something that only appears when it interrupts.
   */
  const nextUp = ((): { label: string; end?: string } | null => {
    if (!day || day.phase !== "planned" || day.closeOut) return null;
    const live = day.plan
      .filter((p) => !p.done && !p.dropped && p.end)
      .sort((a, b) => at(a.end) - at(b.end));
    const next = live.find((p) => at(p.end) > nowMs) ?? live[0];
    return next ? { label: next.label, end: next.end } : null;
  })();

  /**
   * Which conversation is open, if any.
   *
   * ⚠ **Latched.** It was derived straight from the day, and that read well
   * until somebody answered: recording the reason clears `missOffered`, the
   * derivation went to `null` on the very next render, and the dialog was
   * unmounted before the assistant's own reply could be seen. The person's
   * answer vanished along with the acknowledgement of it.
   *
   * So the day decides when a conversation may OPEN; only the dialog decides
   * when it closes.
   *
   * Only the two after-the-fact moments — never mid-task (see `day-chat.tsx`).
   * Close-out wins when both are true: it asks about every open item anyway, so
   * a separate why-question first would be two dialogs deep.
   */
  useEffect(() => {
    if (openChat || chatWavedOff || !day) return;
    const ranOver = day.plan.find((p) => p.missOffered);
    const closing = Boolean(day.closeOut && !day.closeOut.finished);
    const soon = endingSoon;
    const arrived = day.newWork?.[0];
    if (!closing && !ranOver && !soon && !arrived) return;
    // Deferred a task so no state is written synchronously inside the effect.
    const t = setTimeout(() => {
      // Ordered by how little time is left to act on it.
      if (closing) {
        setOpenChat("closeout");
        return;
      }
      if (ranOver) {
        setChatMiss({
          id: ranOver.id,
          label: ranOver.label,
          estimateMinutes: ranOver.estimateMinutes,
        });
        setOpenChat("miss");
        return;
      }
      if (soon) {
        setOpenChat("check");
        return;
      }
      // Last: new work can wait a few minutes, a slot about to close cannot.
      if (arrived) setOpenChat("newWork");
    }, 0);
    return () => clearTimeout(t);
  }, [day, openChat, chatWavedOff, endingSoon]);

  /**
   * Closing it lapses that question quietly (A4) — but only that one.
   *
   * A blanket "no more conversations today" would mean waving away one
   * check-in also silenced the close-out. So each kind is silenced its own way:
   * a check by item, the morning by falling back to the on-screen brief, and
   * the two after-the-fact questions for the rest of the visit.
   */
  function dismissChat() {
    if (openChat === "check" && endingSoon) {
      dismissCheck(endingSoon.id);
    } else if (openChat === "newWork" && day?.newWork?.[0]) {
      // "Later" is not "no" — it lapses for this visit, like every other
      // question, and the task itself is untouched.
      void post({ action: "declineWork", taskId: day.newWork[0].id });
    } else if (openChat === "plan") {
      // Not a refusal to plan — just a preference to do it on screen.
      setPlanInChat(false);
    } else {
      setChatWavedOff(true);
    }
    setOpenChat(null);
    setChatMiss(null);
  }

  /** A4's "[Move it]" — the displaced work goes to the end and is re-placed. */
  async function moveLater(itemId: string) {
    if (!day) return;
    const rest = day.plan.filter((p) => p.id !== itemId).map((p) => p.id);
    dismissOverrun(overrun?.item.id ?? itemId);
    await post({ action: "reorder", orderedIds: [...rest, itemId] });
  }

  const refreshDay = useCallback(() => {
    // Promise-chained (not awaited) so the state write happens in a later
    // task — the static dashboard below still works if this never resolves.
    return fetch("/api/today")
      .then((res) => (res.ok ? res.json() : null))
      .then((state) => {
        if (state) setDay(state as TodayState);
      })
      .catch(() => {});
  }, []);

  // Live: a day change made anywhere — a chip tapped here, a chat "commit my
  // day", a voice tick, a meeting displacing work — lands on this panel.
  useLiveEvent(() => {
    void refreshDay();
  }, { areas: ["day-plan", "meeting", "calendar", "leave", "task"] });

  useEffect(() => {
    void refreshDay();
  }, [refreshDay]);

  const [dayError, setDayError] = useState<string | null>(null);

  async function post(body: Record<string, unknown>): Promise<TodayState | null> {
    setDayError(null);
    try {
      const res = await fetch("/api/today", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      if (!res.ok) {
        // /api/today sends back a useful message on 422 — show it, don't eat it.
        let message = "That did not work — try again.";
        try {
          const data = (await res.json()) as { error?: string };
          if (data.error) message = data.error;
        } catch {}
        setDayError(message);
        return null;
      }
      const state = (await res.json()) as TodayState;
      setDay(state);
      return state;
    } catch {
      setDayError("Couldn't reach the server — check your connection and try again.");
      return null;
    }
  }

  /**
   * Clocking in, and then the brief — in whichever of the three ways they
   * chose (feature 03: "every task can be done by filling a form, typing a
   * message, or speaking. All three do exactly the same thing").
   *
   * The clock-in itself is identical in all three: one `attendance.checkIn`
   * through the gate. Only what happens next differs, and even that is two
   * surfaces over one set of brief items, not two implementations.
   */
  async function clockIn(how: "form" | "chat" | "voice" = "form") {
    if (startingDay) return;
    setStartingDay(true);
    try {
      const date = new Date().toISOString().slice(0, 10);
      const outcome = await op.run(
        "attendance.checkIn",
        { employeeId: userId, date },
        { refresh: false },
      );
      if (outcome.status !== "ran") return;
      // The day is opened the same way whichever they chose — one brief, one
      // set of items. What differs is who walks them through it.
      await post({ action: "start" });
      if (how === "form") return;
      // Chat and voice hand the morning to the assistant: it raises each brief
      // item itself, asks what they are taking on and how long each will take,
      // and commits when they say so.
      setPlanInChat(true);
      setOpenChat("plan");
      if (how === "voice") {
        // The same conversation, spoken. The voice tools write to the same day,
        // so the window fills in as they talk.
        window.dispatchEvent(new CustomEvent("n1:start-voice"));
      }
    } finally {
      setStartingDay(false);
    }
  }

  /**
   * Clocking out opens the close-out conversation — it does not end the day.
   *
   * The day is folded into the streak by `finishCloseOut`, once the answers are
   * in. `finalizeDay` is idempotent, so assessing here would mean every answer
   * that followed arrived too late to count.
   */
  async function clockOut() {
    setClosingOut(true);
    const date = new Date().toISOString().slice(0, 10);
    const outcome = await op.run("attendance.checkOut", { employeeId: userId, date }, { refresh: false });
    if (outcome.status === "ran" && day && day.phase !== "none") {
      await post({ action: "closeOut" });
    } else {
      await refreshDay();
    }
    setClosingOut(false);
  }

  /** A9 — "I mean to do this, just not today." Offered back tomorrow. */
  async function carryOver(itemId: string) {
    await post({ action: "carryOver", itemId });
  }

  /** The conversation is over: seed tomorrow, then assess the day once. */
  async function finishCloseOut() {
    setClosingOut(true);
    await post({ action: "finishCloseOut" });
    setClosingOut(false);
  }

  /**
   * A9 — "item dropped mid-day: allowed. Asked once why, does not break the
   * streak."
   *
   * Asked *once*: the strip closes on the first answer and does not come back
   * for that item. Skipping is a real option — the reason is a courtesy, not a
   * toll on deciding you are not doing something.
   */
  async function dropItem(itemId: string, reason?: string) {
    setDropFor(null);
    await post({ action: "drop", itemId, reason });
  }

  /**
   * A9 — "half done: progress recorded, remainder carried forward."
   *
   * Not a tick: the item stays open, the backing task stays open, and no
   * why-question is asked. Only the remainder is owed tomorrow.
   */
  async function recordProgress(itemId: string, progressMinutes: number) {
    setTickFor(null);
    await post({ action: "tick", itemId, progressMinutes });
  }

  async function addItem(label: string, minutes: number, ref?: { nodeType: string; nodeId: string }) {
    await post({ action: "select", label, estimateMinutes: minutes, ref });
  }

  /**
   * A9 — "planning abandoned halfway… next time the application is opened it
   * resumes where it stopped."
   *
   * Abandonment is not something anybody clicks; it is what leaving mid-plan
   * *means*. `startDay` has always had the resume branch and nothing could put
   * a day into the state that triggers it. Reporting it when the tab goes away
   * is what closes that loop. `sendBeacon` because the page may be unloading —
   * a normal fetch is cancelled and would report nothing.
   */
  useEffect(() => {
    const phase = day?.phase;
    if (phase !== "briefing" && phase !== "planning") return;
    const mark = () => {
      if (document.visibilityState !== "hidden") return;
      navigator.sendBeacon?.(
        "/api/today",
        new Blob([JSON.stringify({ action: "abandon" })], { type: "application/json" }),
      );
    };
    document.addEventListener("visibilitychange", mark);
    return () => document.removeEventListener("visibilitychange", mark);
  }, [day?.phase]);

  /**
   * A1b — "the morning plan is a starting point, not a contract. People
   * reorder their day as it goes, and the application should follow rather
   * than object." The reorder action existed on the API and no client ever
   * called it; the day rearranges itself around meetings on the way back.
   */
  async function move(itemId: string, delta: number) {
    const plan = day?.plan ?? [];
    // Only work still owed reorders. Something finished or dropped holds the
    // place it actually occupied, so swapping past it would either claim you
    // did it at a different time or hand its slot to live work.
    const live = plan.filter((p) => !p.done && !p.dropped).map((p) => p.id);
    const from = live.indexOf(itemId);
    const to = from + delta;
    if (from < 0 || to < 0 || to >= live.length) return;
    [live[from], live[to]] = [live[to], live[from]];
    // Put the new order back into the full list, leaving the anchors alone.
    let next = 0;
    const orderedIds = plan.map((p) => (!p.done && !p.dropped ? live[next++] : p.id));
    await post({ action: "reorder", orderedIds });
  }

  async function tick(itemId: string, actualMinutes: number | undefined) {
    setTickFor(null);
    // Completing the backing task now happens server-side inside this one
    // request, so a refusal cannot leave a ticked item beside an open task.
    const state = await post({ action: "tick", itemId, actualMinutes });
    if (state?.offerNow) setMissFor(itemId);
  }

  /**
   * Record the reason, and hand back what was learned from it.
   *
   * Returns rather than only setting state, because the conversation says the
   * learned figure in its own next line — A5's "shall I plan for four next
   * time?" belongs in the sentence that follows the answer, not in a toast
   * beside it.
   */
  async function answerMiss(itemId: string, reason: string): Promise<{ learnedEstimate?: number }> {
    setMissFor(null);
    const state = await post({ action: "missReason", itemId, reason });
    return { learnedEstimate: state?.asked ? state.learnedEstimate : undefined };
  }

  async function sendMissReason(itemId: string, reason: string) {
    const item = day?.plan.find((p) => p.id === itemId);
    const { learnedEstimate } = await answerMiss(itemId, reason);
    // A5: "a miss becomes better planning, not a black mark." Offer the figure
    // back rather than filing it away silently.
    if (learnedEstimate && item) {
      setLearned({
        label: item.label,
        planned: item.estimateMinutes,
        suggested: learnedEstimate,
      });
    }
  }

  /**
   * What they said about the day, kept where it will be remembered.
   *
   * Sent into their own assistant conversation rather than dropped: feature 07
   * is "remembers your earlier conversations", and a line about how a day went
   * is exactly the kind of thing worth having tomorrow. Fire-and-forget — the
   * reply is not needed here, and waiting for a model at clock-out would make
   * closing the day feel slow.
   */
  async function noteDay(text: string): Promise<void> {
    void fetch("/api/assistant/ask", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ message: text }),
    }).catch(() => {});
  }

  async function approveLeave(leaveId: string) {
    setBusyLeave(leaveId);
    await op.run("leave.approve", { leaveId });
    setBusyLeave(null);
  }

  const firstName = displayName.split(/\s+/)[0] ?? displayName;
  const dateLine = fmtDayDate(new Date());

  /* ── Ring math: the rings measure TODAY, not history. ── */
  const rings = useMemo(() => {
    const plan = day?.plan ?? [];
    const done = plan.filter((p) => p.done);
    const within = done.filter((p) => p.tag !== "ran-over");
    const outer = plan.length === 0 ? 0 : (done.length / plan.length) * 100;
    const middle = done.length === 0 ? 0 : (within.length / done.length) * 100;
    const used = (day?.tally.meetings ?? 0) + (day?.tally.work ?? 0);
    const inner = Math.min(100, (used / (8 * 60)) * 100);
    return { outer, middle, inner };
  }, [day]);

  const committed = day?.plan.length ?? 0;
  const doneToday = day?.plan.filter((p) => p.done).length ?? 0;
  const checkedIn = Boolean(day?.attendance.checkInAt) && !day?.attendance.checkOutAt;
  const dayOver = Boolean(day?.attendance.checkOutAt);
  const plannedMin = day?.tally.work ?? 0;
  const freeMin = day?.tally.free ?? 8 * 60;

  const pickableTasks = useMemo(() => {
    const inPlan = new Set((day?.plan ?? []).map((p) => p.ref?.nodeId).filter(Boolean));
    return tasks.filter((t) => !inPlan.has(t.id));
  }, [tasks, day]);

  /*
   * Work already underway is a different decision from work never started —
   * "carry on with this" versus "take this on" — so the picker separates them
   * rather than showing one undifferentiated list.
   */
  const inProgressTasks = useMemo(
    () => pickableTasks.filter((t) => t.status === "in-progress"),
    [pickableTasks],
  );
  const pendingTasks = useMemo(
    () => pickableTasks.filter((t) => t.status !== "in-progress"),
    [pickableTasks],
  );

  /**
   * One list of everything still takeable, for the conversation's picker.
   *
   * Same three sources the on-screen picker uses and in the same order — what
   * the brief turned up first, then work already underway, then work not
   * started — so choosing chat or voice offers exactly what choosing the form
   * would have. Two surfaces over one set of options, never two lists.
   */
  const pickableForChat = useMemo(() => {
    const already = new Set((day?.plan ?? []).map((p) => p.label));
    const out: Array<{
      label: string;
      ref?: { nodeType: string; nodeId: string };
      origin: string;
      learnedMinutes?: number;
    }> = [];
    for (const s of day?.suggested ?? []) {
      if (!already.has(s)) out.push({ label: s, origin: "from your brief" });
    }
    for (const t of inProgressTasks) {
      if (!already.has(t.title)) {
        out.push({
          label: t.title,
          ref: { nodeType: "task", nodeId: t.id },
          origin: "in progress",
          learnedMinutes: day?.estimateHints[`task:${t.id}`] ?? t.estimateMinutes,
        });
      }
    }
    for (const t of pendingTasks) {
      if (!already.has(t.title)) {
        out.push({
          label: t.title,
          ref: { nodeType: "task", nodeId: t.id },
          origin: "not started",
          learnedMinutes: day?.estimateHints[`task:${t.id}`] ?? t.estimateMinutes,
        });
      }
    }
    return out;
  }, [day, inProgressTasks, pendingTasks]);

  /**
   * The day has not begun until they clock in.
   *
   * Appendix A1 puts the brief at "the first time the application is opened
   * each day", and nothing downstream — the plan, the windows, the miss
   * classification, the streak — means anything without a start time to measure
   * from. So this is a gate rather than a suggestion, and it offers all three
   * ways in (feature 03) rather than making the form the privileged one.
   */
  const mustClockIn = Boolean(day) && !day?.attendance.checkInAt && !dayOver;

  /** Work still owed, in plan order — the only rows that reorder. */
  const movableIds = useMemo(
    () => (day?.plan ?? []).filter((p) => !p.done && !p.dropped).map((p) => p.id),
    [day],
  );

  const stagger = (i: number) => ({ animationDelay: `${i * 70}ms` });

  return (
    <div className="mx-auto max-w-6xl space-y-5 p-4 sm:p-6">
      {mustClockIn && (
        <div
          className="fade-in fixed inset-0 z-50 flex items-end justify-center bg-chrome-deep/70 p-4 backdrop-blur-sm sm:items-center"
          role="dialog"
          aria-modal
          aria-label="Start your day"
        >
          <div className="pop-in w-full max-w-md rounded-3xl bg-surface p-6 shadow-lift">
            <p className="text-[10px] font-semibold uppercase tracking-widest text-ink-faint">
              {dateLine}
            </p>
            <h2 className="mt-1 text-2xl font-light tracking-tight text-ink">
              Good morning, <span className="font-extrabold">{firstName}</span>
            </h2>
            <p className="mt-2 text-sm text-ink-soft">
              Clock in to start the day. You&apos;ll get your brief, then pick what
              you&apos;re taking on — whichever way suits you.
            </p>

            <div className="mt-5 space-y-2.5">
              <button
                onClick={() => clockIn("form")}
                disabled={startingDay || op.busy}
                className="press flex w-full items-center gap-3 rounded-2xl bg-accent-strong px-4 py-3 text-left text-white transition-colors hover:bg-accent disabled:opacity-40"
              >
                <Icon name="check" className="h-4 w-4 shrink-0" />
                <span className="min-w-0 flex-1">
                  <span className="block text-sm font-bold">Clock in &amp; tap through it</span>
                  <span className="block text-[11px] text-white/80">
                    The brief on screen, answered with buttons
                  </span>
                </span>
              </button>

              <button
                onClick={() => clockIn("chat")}
                disabled={startingDay || op.busy}
                className="press flex w-full items-center gap-3 rounded-2xl bg-raised px-4 py-3 text-left transition-colors hover:bg-accent-soft disabled:opacity-40"
              >
                <Icon name="chat" className="h-4 w-4 shrink-0 text-accent-strong" />
                <span className="min-w-0 flex-1">
                  <span className="block text-sm font-bold text-ink">Clock in &amp; do it in chat</span>
                  <span className="block text-[11px] text-ink-faint">
                    The same brief as a conversation
                  </span>
                </span>
              </button>

              <button
                onClick={() => clockIn("voice")}
                disabled={startingDay || op.busy}
                className="press flex w-full items-center gap-3 rounded-2xl bg-raised px-4 py-3 text-left transition-colors hover:bg-accent-soft disabled:opacity-40"
              >
                <Icon name="spark" className="h-4 w-4 shrink-0 text-accent-strong" />
                <span className="min-w-0 flex-1">
                  <span className="block text-sm font-bold text-ink">Clock in &amp; speak it</span>
                  <span className="block text-[11px] text-ink-faint">
                    Talk it through — same brief, out loud
                  </span>
                </span>
              </button>
            </div>

            {startingDay && (
              <p className="mt-4 text-center text-xs text-ink-faint">Starting your day…</p>
            )}
          </div>
        </div>
      )}
      {/* ============ Greeting + clock ============ */}
      <header className="rise flex flex-wrap items-end justify-between gap-3" style={stagger(0)}>
        <div>
          <h1 className="text-3xl font-light tracking-tight text-ink sm:text-4xl">
            {dayOver ? "Good work, " : "Hello, "}
            <span className="font-extrabold">{firstName}</span>
          </h1>
          <p className="mt-1 text-sm text-ink-soft" suppressHydrationWarning>{dateLine} — here&apos;s your day.</p>
        </div>
        <div className="flex items-center gap-2.5">
          {day && !day.attendance.checkInAt && (
            <button
              onClick={() => clockIn("form")}
              disabled={op.busy || startingDay}
              className="press rounded-full bg-accent-strong px-5 py-2.5 text-sm font-bold text-white shadow-card transition-colors hover:bg-accent disabled:opacity-40"
            >
              Clock in
            </button>
          )}
          {checkedIn && (
            <>
              <span className="rounded-full bg-mint px-3.5 py-1.5 text-xs font-semibold text-mint-strong">
                Clocked in {fmtClock(day?.attendance.checkInAt)}
              </span>
              <button
                onClick={clockOut}
                disabled={op.busy || closingOut}
                className="press rounded-full bg-chrome px-4 py-2 text-xs font-semibold text-chrome-ink transition-colors hover:bg-chrome-card disabled:opacity-40"
              >
                {closingOut ? "Closing out…" : "Clock out"}
              </button>
            </>
          )}
          {dayOver && (
            <span className="rounded-full bg-lilac px-3.5 py-1.5 text-xs font-semibold text-lilac-strong">
              Day closed · worked {fmtMin(day?.attendance.workedMinutes ?? 0)}
            </span>
          )}
        </div>
      </header>

      {/*
        The check-in that used to live here is now the same centre-screen
        conversation as the clock-out and the delay question — one place the
        assistant speaks, so every moment it does looks alike.
      */}

      {/* What an early "I need longer" costs the rest of the day (A4). */}
      {atRisk && (
        <section
          className="pop-in flex flex-wrap items-center gap-2 rounded-2xl border border-peach-strong/40 bg-peach/[.14] px-4 py-3 text-[13px]"
          role="status"
        >
          <span className="min-w-0 flex-1 text-ink">
            Noted — the time you committed still stands, so{" "}
            <span className="font-semibold">{atRisk}</span> is now at risk.
          </span>
          <button
            onClick={() => setAtRisk(null)}
            className="press shrink-0 rounded-full bg-white/70 px-2.5 py-1 text-[11px] font-semibold text-ink"
          >
            OK
          </button>
        </section>
      )}

      {/* ============ A4 — interrupt to help, never to interrogate ============ */}
      {overrun && (
        <section
          className="pop-in flex flex-wrap items-center gap-2 rounded-2xl border border-peach-strong/40 bg-peach/[.14] px-4 py-3 text-[13px]"
          role="status"
        >
          {/*
            An OFFER about what to do next — never "why haven't you finished?".
            A4: "Asking 'why didn't you finish?' while somebody is still doing
            the work is the fastest way to make the application feel like a
            supervisor. Saying 'this is overrunning and your afternoon will not
            fit' at that same moment is genuinely helpful. Same timing, opposite
            effect."
          */}
          <span className="min-w-0 flex-1 text-ink">
            <span className="font-semibold">{overrun.item.label}</span> is running over.{" "}
            {overrun.displaced.start ? (
              <>
                Your {fmtClock(overrun.displaced.start)}{" "}
                <span className="font-semibold">{overrun.displaced.label}</span> will not fit.
              </>
            ) : (
              <>
                <span className="font-semibold">{overrun.displaced.label}</span> will not fit.
              </>
            )}
          </span>
          <span className="flex shrink-0 flex-wrap items-center gap-1.5 text-[11px]">
            <button
              onClick={() => moveLater(overrun.displaced.id)}
              className="press rounded-full bg-accent px-2.5 py-1 font-bold text-white"
            >
              Move it
            </button>
            <button
              onClick={() => {
                dismissOverrun(overrun.item.id);
                void dropItem(overrun.displaced.id, "No time");
              }}
              className="press rounded-full bg-white/70 px-2.5 py-1 font-semibold text-ink"
            >
              Drop {overrun.displaced.label}
            </button>
            <Link
              href={`/assistant?ask=${encodeURIComponent(
                `"${overrun.item.label}" has run over and "${overrun.displaced.label}" no longer fits. What are my options?`,
              )}`}
              onClick={() => dismissOverrun(overrun.item.id)}
              className="press rounded-full bg-white/70 px-2.5 py-1 font-semibold text-ink"
            >
              Explain in chat
            </Link>
            <button
              onClick={() => dismissOverrun(overrun.item.id)}
              className="press px-2 py-1 font-semibold text-ink-soft hover:text-ink"
            >
              Leave it
            </button>
          </span>
        </section>
      )}

      {/* ============ Close-out (A2/A9) — it TELLS you, then asks what it cannot know ============ */}
      {day?.closeOut && !day.closeOut.finished && (
        <section className="rise rounded-3xl bg-chrome-card p-5 text-chrome-ink shadow-card sm:p-6" style={stagger(1)}>
          <h2 className="text-lg font-bold">How today went</h2>

          {/*
            The summary is a STATEMENT, never "what did you do today?".
            The application has every ticked item, estimate and actual — A2:
            asking what it already knows is what makes people stop trusting it.
          */}
          <p className="mt-1.5 text-sm text-chrome-soft">
            <span className="font-semibold text-chrome-ink">
              {day.closeOut.done} of {day.closeOut.committed} done.
            </span>{" "}
            {fmtMin(day.closeOut.workedMinutes)} of {fmtMin(day.closeOut.committedMinutes)} committed
            work.
            {day.closeOut.dropped > 0 && ` ${day.closeOut.dropped} dropped.`}
            {day.closeOut.ranOver.map((r) => (
              <span key={r.id}>
                {" "}
                {r.label} ran over by {fmtMin(r.byMinutes)}.
              </span>
            ))}
          </p>

          {day.closeOut.unfinished.length > 0 ? (
            <>
              <p className="mt-4 text-[13px] font-semibold">
                Still open — what should happen to {day.closeOut.unfinished.length === 1 ? "it" : "these"}?
              </p>
              <div className="mt-2 space-y-2">
                {day.closeOut.unfinished.map((u) => (
                  <div key={u.id} className="rounded-xl bg-white/[.05] px-3 py-2.5">
                    <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                      <span className="min-w-0 flex-1 truncate text-[13px]">{u.label}</span>
                      {u.progressMinutes > 0 && (
                        <span className="shrink-0 text-[11px] text-chrome-soft">
                          {fmtMin(u.progressMinutes)} done · {fmtMin(u.shortfallMinutes)} left
                        </span>
                      )}
                      {u.interrupted && (
                        <span className="shrink-0 rounded-full bg-peach px-2 py-0.5 text-[9px] font-bold text-peach-strong">
                          interrupted
                        </span>
                      )}
                    </div>
                    {/* Buttons, never typing. A1: "chat-first must never mean
                        typing-first" — which holds at six in the evening more
                        than it does at nine in the morning. */}
                    <div className="mt-2 flex flex-wrap items-center gap-1.5 text-[11px]">
                      <button
                        onClick={() => carryOver(u.id)}
                        className="press rounded-full bg-mint px-2.5 py-1 font-bold text-mint-strong"
                      >
                        Carry over
                      </button>
                      <button
                        onClick={() => dropItem(u.id)}
                        className="press rounded-full bg-white/[.08] px-2.5 py-1 font-semibold text-chrome-ink"
                      >
                        Drop it
                      </button>
                      <button
                        onClick={() => recordProgress(u.id, Math.round(u.estimateMinutes / 2))}
                        className="press rounded-full bg-lilac px-2.5 py-1 font-bold text-lilac-strong"
                      >
                        Part done
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            </>
          ) : (
            <p className="mt-4 text-[13px] text-chrome-soft">
              Nothing left open. {day.closeOut.shortfallMinutes === 0 ? "A clean day." : ""}
            </p>
          )}

          {/*
            Seeds, not a plan. The requirement asked for "what is your next day
            plan?" here; A1 puts planning in the morning, once a day, with
            mandatory time estimates. Two planning conversations would either
            contradict each other or make the morning one pointless.
            Clock-out seeds; morning commits.
          */}
          <div className="mt-4 flex flex-wrap items-center gap-2 border-t border-white/10 pt-3">
            <p className="flex-1 text-[11px] text-chrome-soft">
              Anything carried over is offered again tomorrow morning — you will still choose it,
              and give it a time, then.
            </p>
            <button
              onClick={finishCloseOut}
              disabled={closingOut}
              className="press shrink-0 rounded-full bg-accent px-4 py-2 text-xs font-bold text-chrome disabled:opacity-40"
            >
              {closingOut ? "Finishing…" : "That's the day"}
            </button>
          </div>
        </section>
      )}

      {/* ============ The day card — rings + flow ============ */}
      <section
        className="rise rounded-3xl bg-chrome-card p-5 text-chrome-ink shadow-card sm:p-6"
        style={stagger(1)}
      >
        <div className="flex flex-col gap-6 lg:flex-row lg:items-start">
          {/* Rings + streak + tally */}
          <div className="flex shrink-0 items-center gap-5">
            <ThreeRings outer={rings.outer} middle={rings.middle} inner={rings.inner} />
            <div className="space-y-2 text-[13px]">
              <div>
                <b className="text-lg font-extrabold text-accent"><CountUp value={doneToday} /></b>
                <span className="text-chrome-soft"> of </span>
                <b className="text-lg font-extrabold">{committed}</b>
                <span className="text-chrome-soft"> done</span>
              </div>
              <div className="text-[11px] text-chrome-soft">
                <span className="mr-1 inline-block h-2 w-2 rounded-full bg-accent" /> finished
                <span className="mx-1 ml-2.5 inline-block h-2 w-2 rounded-full" style={{ background: "var(--mint-strong)" }} /> on time
                <span className="mx-1 ml-2.5 inline-block h-2 w-2 rounded-full" style={{ background: "var(--lilac-strong)" }} /> day full
              </div>
              <div className="text-[13px] font-medium">
                {fmtMin(plannedMin)} committed · {fmtMin(freeMin)} free
              </div>
              <div className="flex flex-wrap items-center gap-x-1.5 gap-y-0.5 text-[12px] text-chrome-soft">
                <Icon name="spark" className="h-3.5 w-3.5 text-accent" />
                <b className="tabular-nums text-chrome-ink">{day?.streak.clean ?? 0}</b> clean days
                {/* A7: a broken streak is not the whole story — the best run
                    and the number of days planned were both being sent to the
                    client and never shown. */}
                {(day?.streak.bestClean ?? 0) > (day?.streak.clean ?? 0) && (
                  <span className="tabular-nums">· best {day?.streak.bestClean}</span>
                )}
                {(day?.streak.dayPlanned ?? 0) > 0 && (
                  <span className="tabular-nums">· {day?.streak.dayPlanned} days planned</span>
                )}
                <span className="text-[9px] uppercase tracking-wider">· only you see this</span>
              </div>
              <DayHistory />
            </div>
          </div>

          {/* Phase content */}
          <div className="min-w-0 flex-1">
            {dayError && (
              <div
                role="alert"
                className="shake mb-3 flex items-center justify-between gap-3 rounded-xl bg-rose/15 px-4 py-2.5 text-[13px] font-medium text-rose-strong"
              >
                <span>{dayError}</span>
                <button
                  onClick={() => setDayError(null)}
                  aria-label="Dismiss"
                  className="press rounded-full px-1.5 text-chrome-soft hover:text-chrome-ink"
                >
                  ✕
                </button>
              </div>
            )}
            {!day || day.phase === "none" ? (
              <div className="fade-in flex h-full min-h-28 flex-col items-start justify-center gap-3 rounded-2xl bg-white/[.04] px-5 py-4">
                <p className="text-sm text-chrome-soft">
                  {dayOver
                    ? "The day is closed. Anything unfinished carries to tomorrow's brief."
                    : "Nothing planned yet. Clock in to get your brief."}
                </p>
                {!dayOver && (
                  <button
                    onClick={() => clockIn("form")}
                    disabled={startingDay}
                    className="press rounded-full bg-white/[.08] px-4 py-2 text-xs font-semibold text-chrome-ink transition-colors hover:bg-white/[.14] disabled:opacity-40"
                  >
                    Clock in &amp; plan my day
                  </button>
                )}
              </div>
            ) : day.phase === "briefing" ? (
              <BriefCard
                item={day.briefItem}
                onReply={(reply) => post({ action: "answerBrief", reply })}
              />
            ) : day.phase === "planning" || day.phase === "abandoned" ? (
              <div className="pop-in space-y-3">
                <div className="flex flex-wrap items-baseline justify-between gap-2">
                  <h3 className="text-sm font-bold">Pick today&apos;s work</h3>
                  <span className="text-[11px] text-chrome-soft">
                    a time on each — that&apos;s how the rings know
                  </span>
                </div>

                {/* A9 — picked up where you left off, rather than starting again. */}
                {day.resumePrompt && (
                  <p className="pop-in rounded-xl border border-accent/40 bg-accent/[.08] px-3 py-2 text-[12px] text-chrome-ink">
                    {day.resumePrompt}
                  </p>
                )}

                {day.plan.length > 0 && (
                  <div className="space-y-1.5">
                    {day.plan.map((p) => (
                      <div key={p.id} className="pop-in flex items-center justify-between rounded-xl bg-white/[.08] px-3 py-1.5 text-[13px]">
                        <span className="truncate">{p.label}</span>
                        <span className="shrink-0 font-semibold text-accent">{fmtMin(p.estimateMinutes)}</span>
                      </div>
                    ))}
                  </div>
                )}

                {/* What you said you'd handle during the brief (A1). */}
                {day.suggested.filter((s) => !day.plan.some((p) => p.label === s)).length > 0 && (
                  <div className="space-y-1.5">
                    <p className="text-[11px] text-chrome-soft">From your brief — you said you&apos;d handle these:</p>
                    {day.suggested
                      .filter((s) => !day.plan.some((p) => p.label === s))
                      .map((s) => (
                        <div key={s} className="flex items-center justify-between gap-2 rounded-xl border border-accent/40 bg-accent/[.08] px-3 py-1.5">
                          <span className="truncate text-[13px] text-chrome-ink">{s}</span>
                          <button
                            onClick={() => addItem(s, estimate)}
                            className="press shrink-0 rounded-full bg-accent px-2.5 py-0.5 text-[11px] font-bold text-chrome"
                          >
                            Add {fmtMin(estimate)}
                          </button>
                        </div>
                      ))}
                  </div>
                )}

                {/*
                  Already underway first, then what has not been started.
                  Picking up something in progress is a different decision from
                  taking on something new, and the label is what makes it one.
                */}
                {[
                  { title: "Already in progress", list: inProgressTasks, accent: true },
                  { title: "Not started yet", list: pendingTasks, accent: false },
                ]
                  .filter((g) => g.list.length > 0)
                  .map((group) => (
                    <div key={group.title} className="space-y-1.5">
                      <p className="text-[11px] text-chrome-soft">{group.title}</p>
                      {group.list.slice(0, 4).map((t) => (
                        <div
                          key={t.id}
                          className={`flex items-center justify-between gap-2 rounded-xl px-3 py-1.5 ${
                            group.accent ? "border border-accent/30 bg-accent/[.06]" : "bg-white/[.04]"
                          }`}
                        >
                          <span className="truncate text-[13px] text-chrome-soft">{t.title}</span>
                          <span className="flex shrink-0 items-center gap-1.5">
                            {day.estimateHints[`task:${t.id}`] !== undefined && (
                              <span className="text-[10px] text-chrome-soft" title="What this took last time">
                                took {fmtMin(day.estimateHints[`task:${t.id}`])}
                              </span>
                            )}
                            <select
                              value={taskEstimates[t.id] ?? nearestEstimate(day.estimateHints[`task:${t.id}`], t.estimateMinutes)}
                              onChange={(e) => setTaskEstimates({ ...taskEstimates, [t.id]: Number(e.target.value) })}
                              className="rounded-lg border border-chrome-line bg-transparent px-1.5 py-0.5 text-[11px] font-medium text-chrome-ink outline-none"
                            >
                              {ESTIMATES.map((m) => <option key={m} value={m} className="text-ink">{fmtMin(m)}</option>)}
                            </select>
                            <button
                              onClick={() =>
                                addItem(
                                  t.title,
                                  taskEstimates[t.id] ?? nearestEstimate(day.estimateHints[`task:${t.id}`], t.estimateMinutes),
                                  { nodeType: "task", nodeId: t.id },
                                )
                              }
                              className="press rounded-full bg-accent px-2.5 py-0.5 text-[11px] font-bold text-chrome"
                            >
                              Add
                            </button>
                          </span>
                        </div>
                      ))}
                    </div>
                  ))}

                <div className="flex flex-wrap items-center gap-2">
                  <input
                    value={customLabel}
                    onChange={(e) => setCustomLabel(e.target.value)}
                    placeholder="Something else…"
                    className="min-w-32 flex-1 rounded-xl border border-chrome-line bg-white/[.06] px-3 py-1.5 text-xs text-chrome-ink outline-none placeholder:text-chrome-soft focus:border-accent"
                  />
                  <select
                    value={estimate}
                    onChange={(e) => setEstimate(Number(e.target.value))}
                    className="rounded-lg border border-chrome-line bg-transparent px-1.5 py-1.5 text-[11px] font-medium text-chrome-ink outline-none"
                  >
                    {ESTIMATES.map((m) => <option key={m} value={m} className="text-ink">{fmtMin(m)}</option>)}
                  </select>
                  <button
                    onClick={() => { if (customLabel.trim()) { addItem(customLabel.trim(), estimate); setCustomLabel(""); } }}
                    disabled={!customLabel.trim()}
                    className="press rounded-full bg-accent px-3 py-1.5 text-[11px] font-bold text-chrome disabled:opacity-40"
                  >
                    Add
                  </button>
                </div>

                {plannedMin + (day.tally.meetings ?? 0) > 8 * 60 && (
                  <p className="fade-in text-[11px] font-semibold" style={{ color: "var(--peach-strong)" }}>
                    ⚠ That&apos;s more than the day holds — meetings already take {fmtMin(day.tally.meetings)}.
                  </p>
                )}

                <button
                  onClick={() => post({ action: "commit" })}
                  disabled={day.plan.length === 0}
                  className="press rounded-full bg-accent-strong px-5 py-2 text-sm font-bold text-white transition-colors hover:bg-accent disabled:opacity-40"
                >
                  Commit my day
                </button>
              </div>
            ) : (
              /* planned — your day, time-ordered */
              <div className="pop-in space-y-1.5">
                <div className="mb-2 flex flex-wrap items-baseline justify-between gap-2">
                  <h3 className="text-sm font-bold">Your day</h3>
                  {movableIds.length > 1 && (
                    <span className="text-[11px] text-chrome-soft">
                      ▲▼ to reorder — the times move with it
                    </span>
                  )}
                </div>
                {day.rows.length === 0 ? (
                  <p className="text-[13px] text-chrome-soft">Nothing on the plan.</p>
                ) : (
                  day.rows.map((row) => {
                    const planItem = day.plan.find((p) => p.id === row.id);
                    const movableAt = movableIds.indexOf(row.id);
                    return (
                      <div key={`${row.kind}-${row.id}`} className="rounded-xl bg-white/[.05] px-3 py-2">
                        <div className="flex items-center gap-2.5">
                          {/*
                            The time leads the row, because it is what moving a
                            task changes. With it at the end, reordering looked
                            like nothing had happened; here the whole column
                            visibly re-flows.
                          */}
                          <span
                            className={`w-11 shrink-0 tabular-nums text-[11px] ${
                              planItem?.dropped ? "text-chrome-soft/50 line-through" : "text-chrome-soft"
                            }`}
                          >
                            {row.start ? fmtClock(row.start) : "—"}
                          </span>
                          {row.kind === "meeting" ? (
                            <Icon name="meetings" className="h-3.5 w-3.5 shrink-0 text-chrome-soft" />
                          ) : planItem?.dropped ? (
                            <span
                              className="grid h-5 w-5 shrink-0 place-items-center rounded-md border-[1.5px] border-chrome-soft/40 text-[11px] text-chrome-soft"
                              title="Dropped"
                            >
                              &times;
                            </span>
                          ) : row.done ? (
                            <span className="grid h-5 w-5 shrink-0 place-items-center rounded-md bg-accent text-chrome">
                              <Icon name="check" className="h-3 w-3" />
                            </span>
                          ) : (
                            <button
                              onClick={() => setTickFor(tickFor === row.id ? null : row.id)}
                              className="press grid h-5 w-5 shrink-0 place-items-center rounded-md border-[1.5px] border-chrome-soft text-transparent transition-colors hover:border-accent hover:text-accent"
                              title="Mark done"
                            >
                              <Icon name="check" className="h-3 w-3" />
                            </button>
                          )}
                          <span
                            className={`min-w-0 flex-1 truncate text-[13px] ${
                              row.done || planItem?.dropped ? "text-chrome-soft line-through" : ""
                            }`}
                          >
                            {row.title}
                          </span>
                          {planItem && (
                            <span className="shrink-0 text-[11px] font-semibold text-accent">{fmtMin(planItem.estimateMinutes)}</span>
                          )}
                          {/*
                            A1b — "items can be dragged into any order, at any
                            time. The morning plan is a starting point, not a
                            contract." The service re-lays the day out around
                            the meetings on the way back, so the times above
                            move with the order.
                          */}
                          {planItem && movableAt >= 0 && movableIds.length > 1 && (
                            <span className="flex shrink-0 items-center gap-0.5">
                              <button
                                onClick={() => move(row.id, -1)}
                                disabled={movableAt === 0}
                                title="Move earlier — the times shift to match"
                                aria-label={`Move ${row.title} earlier`}
                                className="press grid h-6 w-6 place-items-center rounded-md text-[11px] leading-none text-chrome-soft transition-colors hover:bg-white/[.10] hover:text-accent disabled:opacity-20 disabled:hover:bg-transparent"
                              >
                                ▲
                              </button>
                              <button
                                onClick={() => move(row.id, 1)}
                                disabled={movableAt === movableIds.length - 1}
                                title="Move later — the times shift to match"
                                aria-label={`Move ${row.title} later`}
                                className="press grid h-6 w-6 place-items-center rounded-md text-[11px] leading-none text-chrome-soft transition-colors hover:bg-white/[.10] hover:text-accent disabled:opacity-20 disabled:hover:bg-transparent"
                              >
                                ▼
                              </button>
                            </span>
                          )}
                          {planItem && !row.done && !planItem.dropped && (
                            <button
                              onClick={() => setDropFor(dropFor === row.id ? null : row.id)}
                              title="Not doing this today"
                              aria-label={`Drop ${row.title}`}
                              className="press grid h-6 w-6 shrink-0 place-items-center rounded-md text-[13px] leading-none text-chrome-soft transition-colors hover:bg-white/[.10] hover:text-peach-strong"
                            >
                              &times;
                            </button>
                          )}
                          {row.tag && (
                            <span className="shrink-0 rounded-full bg-peach px-2 py-0.5 text-[9px] font-bold text-peach-strong">
                              {row.tag === "carried-over"
                                ? "carried over — meeting"
                                : row.tag === "ran-over"
                                  ? "ran over"
                                  : row.tag === "dropped"
                                    ? "dropped"
                                    : row.tag}
                            </span>
                          )}
                        </div>
                        {tickFor === row.id && planItem && (
                          <div className="pop-in mt-2 flex flex-wrap items-center gap-1.5 pl-7 text-[11px]">
                            <span className="text-chrome-soft">Took:</span>
                            <button onClick={() => tick(row.id, planItem.estimateMinutes)} className="press rounded-full bg-mint px-2.5 py-1 font-bold text-mint-strong">
                              On time
                            </button>
                            <button onClick={() => tick(row.id, Math.round(planItem.estimateMinutes * 1.5))} className="press rounded-full bg-peach px-2.5 py-1 font-bold text-peach-strong">
                              Ran long
                            </button>
                            <button onClick={() => tick(row.id, undefined)} className="press rounded-full bg-white/[.08] px-2.5 py-1 font-semibold text-chrome-ink">
                              Just done
                            </button>
                            {/* A9 — half done is a real outcome, not a failure. */}
                            <span className="ml-1 text-chrome-soft">or part done:</span>
                            <button
                              onClick={() => recordProgress(row.id, Math.round(planItem.estimateMinutes / 2))}
                              className="press rounded-full bg-lilac px-2.5 py-1 font-bold text-lilac-strong"
                            >
                              Half
                            </button>
                            <button
                              onClick={() => recordProgress(row.id, Math.round(planItem.estimateMinutes * 0.75))}
                              className="press rounded-full bg-lilac px-2.5 py-1 font-bold text-lilac-strong"
                            >
                              Most of it
                            </button>
                          </div>
                        )}
                        {dropFor === row.id && (
                          <div className="pop-in mt-2 flex flex-wrap items-center gap-1.5 pl-7 text-[11px]">
                            <span className="text-chrome-soft">Not doing this today —</span>
                            {["Not needed", "No time", "Blocked", "Doing it another day"].map((r) => (
                              <button
                                key={r}
                                onClick={() => dropItem(row.id, r)}
                                className="press rounded-full bg-white/[.08] px-2.5 py-1 font-semibold text-chrome-ink"
                              >
                                {r}
                              </button>
                            ))}
                            <button
                              onClick={() => dropItem(row.id)}
                              className="text-chrome-soft hover:text-chrome-ink"
                            >
                              skip
                            </button>
                          </div>
                        )}
                        {planItem &&
                          !row.done &&
                          !planItem.dropped &&
                          (planItem.progressMinutes ?? 0) > 0 && (
                            <p className="mt-1 pl-7 text-[11px] text-chrome-soft">
                              {fmtMin(planItem.progressMinutes ?? 0)} done —{" "}
                              <span className="font-semibold text-lilac-strong">
                                {fmtMin(planItem.shortfallMinutes ?? 0)} left
                              </span>
                              , carried to tomorrow.
                            </p>
                          )}
                        {planItem?.dropped?.reason && (
                          <p className="mt-1 pl-7 text-[11px] text-chrome-soft">
                            Dropped — {planItem.dropped.reason.toLowerCase()}
                          </p>
                        )}
                        {missFor === row.id && (
                          <div className="pop-in mt-2 flex flex-wrap items-center gap-1.5 pl-7 text-[11px]">
                            <span className="text-chrome-soft">What got in the way?</span>
                            {["Bigger than expected", "Interruptions", "Waiting on someone"].map((r) => (
                              <button key={r} onClick={() => sendMissReason(row.id, r)} className="press rounded-full bg-white/[.08] px-2.5 py-1 font-semibold text-chrome-ink">
                                {r}
                              </button>
                            ))}
                            {/* A1c's own example carries this option. */}
                            <Link
                              href={`/assistant?ask=${encodeURIComponent(
                                `"${row.title}" took longer than I planned. Can we talk about it?`,
                              )}`}
                              onClick={() => setMissFor(null)}
                              className="press rounded-full bg-white/[.08] px-2.5 py-1 font-semibold text-chrome-ink"
                            >
                              Explain in chat
                            </Link>
                            <button onClick={() => setMissFor(null)} className="text-chrome-soft hover:text-chrome-ink">skip</button>
                          </div>
                        )}
                      </div>
                    );
                  })
                )}

                {/* A5 — the answer becomes better planning, not a black mark. */}
                {learned && (
                  <div className="pop-in mt-3 flex flex-wrap items-center gap-2 rounded-xl border border-accent/40 bg-accent/[.08] px-3 py-2 text-[11px]">
                    <span className="text-chrome-ink">
                      {learned.label} took {fmtMin(learned.suggested)} against the {fmtMin(learned.planned)} you
                      planned. Shall I plan for {fmtMin(nearestEstimate(learned.suggested))} next time?
                    </span>
                    <span className="ml-auto flex shrink-0 items-center gap-1.5">
                      <button
                        onClick={() => setLearned(null)}
                        className="press rounded-full bg-accent px-2.5 py-1 font-bold text-chrome"
                      >
                        Yes, do that
                      </button>
                      <button onClick={() => setLearned(null)} className="text-chrome-soft hover:text-chrome-ink">
                        no thanks
                      </button>
                    </span>
                  </div>
                )}
              </div>
            )}
          </div>
        </div>
      </section>

      {/* ============ Stat tiles + agenda + tasks ============ */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
        <section className="rise grid grid-cols-2 gap-3" style={stagger(2)}>
          <StatTile href="/tasks" tone="bg-peach text-peach-strong" label="Open tasks" value={tasks.length} />
          <StatTile href="/meetings" tone="bg-mint text-mint-strong" label="Meetings" value={meetings.length} />
          <StatTile href="/courses" tone="bg-lilac text-lilac-strong" label="Projects" value={courseCount} />
          <StatTile href="/team" tone="bg-rose text-rose-strong" label="Team" value={teamSize} />
        </section>

        <section className="rise rounded-3xl bg-surface p-5 shadow-card" style={stagger(3)}>
          <div className="flex items-center justify-between">
            <h2 className="text-[11px] font-semibold uppercase tracking-widest text-ink-faint">Up next</h2>
            <div className="flex items-center gap-3">
              <button
                type="button"
                onClick={() => setShowMeetingForm((v) => !v)}
                className="press flex items-center gap-1 text-xs font-medium text-accent-strong hover:underline"
              >
                {showMeetingForm ? "Cancel" : "New meeting"}
              </button>
              <Link href="/meetings" className="press flex items-center gap-1 text-xs font-medium text-accent-strong hover:underline">
                View all <Icon name="arrow" className="h-3 w-3" />
              </Link>
            </div>
          </div>

          {showMeetingForm && (
            <div className="mt-3 space-y-2.5 rounded-2xl bg-chrome/40 p-3.5">
              <input
                value={meetingForm.title}
                onChange={(e) => setMeetingForm((f) => ({ ...f, title: e.target.value }))}
                placeholder="What is the meeting?"
                className="w-full rounded-xl border border-hairline bg-surface px-3 py-2 text-[13px] text-ink outline-none focus:border-accent"
              />

              {/* No preselection. Choosing between a room and a link is the
                  decision this form exists to capture, and a default answers it
                  for people who never noticed the control. */}
              <div className="flex gap-1.5">
                {(["online", "in-person", "both"] as const).map((k) => (
                  <button
                    key={k}
                    type="button"
                    onClick={() => setMeetingForm((f) => ({ ...f, kind: k }))}
                    className={`press flex-1 rounded-xl px-2 py-1.5 text-[11px] font-semibold capitalize ${
                      meetingForm.kind === k
                        ? "bg-accent text-white"
                        : "bg-surface text-ink-soft hover:text-ink"
                    }`}
                  >
                    {k === "online" ? "Link only" : k === "in-person" ? "Room only" : "Both"}
                  </button>
                ))}
              </div>

              <div className="grid grid-cols-2 gap-2">
                <label className="block">
                  <span className="text-[10px] uppercase tracking-wide text-ink-faint">Starts</span>
                  <input
                    type="datetime-local"
                    value={meetingForm.from}
                    onChange={(e) => setMeetingForm((f) => ({ ...f, from: e.target.value }))}
                    className="mt-0.5 w-full rounded-xl border border-hairline bg-surface px-2.5 py-1.5 text-[12px] text-ink outline-none focus:border-accent"
                  />
                </label>
                <label className="block">
                  <span className="text-[10px] uppercase tracking-wide text-ink-faint">Ends</span>
                  <input
                    type="datetime-local"
                    value={meetingForm.to}
                    onChange={(e) => setMeetingForm((f) => ({ ...f, to: e.target.value }))}
                    className="mt-0.5 w-full rounded-xl border border-hairline bg-surface px-2.5 py-1.5 text-[12px] text-ink outline-none focus:border-accent"
                  />
                </label>
              </div>

              {people.length > 0 && (
                <div>
                  <span className="text-[10px] uppercase tracking-wide text-ink-faint">Who</span>
                  <div className="mt-1 flex flex-wrap gap-1.5">
                    {people
                      .filter((pp) => pp.id !== userId)
                      .map((pp) => (
                        <button
                          key={pp.id}
                          type="button"
                          onClick={() => toggleMeetingAttendee(pp.id)}
                          className={`press rounded-lg px-2 py-1 text-[11px] font-medium ${
                            meetingForm.attendees.includes(pp.id)
                              ? "bg-accent text-white"
                              : "bg-surface text-ink-soft hover:text-ink"
                          }`}
                        >
                          {pp.name}
                        </button>
                      ))}
                  </div>
                </div>
              )}

              <button
                type="button"
                onClick={createMeeting}
                disabled={
                  op.busy ||
                  !meetingForm.title.trim() ||
                  !meetingForm.kind ||
                  !meetingForm.from ||
                  !meetingForm.to
                }
                className="press w-full rounded-xl bg-ink px-3 py-2 text-[12px] font-semibold text-surface disabled:opacity-40"
              >
                {op.busy ? "Arranging…" : "Arrange it"}
              </button>

              {/* A room clash or a refused permission comes back here rather
                  than as silence — the form keeps what was typed either way. */}
              {op.error && <p className="text-[11px] text-rose-strong">{op.error}</p>}
            </div>
          )}

          {meetings.length === 0 ? (
            <Empty icon="calendar" text="No meetings ahead — a clear runway." />
          ) : (
            <div className="mt-3 space-y-2">
              {meetings.slice(0, 4).map((m, i) => {
                const s = KIND_STYLE[m.kind ?? ""] ?? KIND_DEFAULT;
                return (
                  // The whole row used to be one <Link>. The join link has to
                  // sit outside it — an anchor inside an anchor is invalid, and
                  // the browser drops one of them.
                  <div
                    key={m.id}
                    style={{ animationDelay: `${200 + i * 60}ms` }}
                    className={`rise lift flex items-center gap-3 rounded-2xl border-l-[3px] px-3.5 py-2.5 ${s.bg} ${s.edge}`}
                  >
                    <Link href="/meetings" className="min-w-0 flex-1">
                      <div className="truncate text-[13px] font-semibold text-ink">{m.title}</div>
                      <div className="mt-0.5 flex items-center gap-1.5 text-[11px] text-ink-soft">
                        <Icon name="clock" className="h-3 w-3" />
                        {/* Was the raw ISO instant — "2026-08-27T09:00:00.000Z"
                            printed straight onto the card. */}
                        <span suppressHydrationWarning>
                          {m.from ? fmtDateTime(m.from) : "unscheduled"}
                          {m.to ? ` – ${fmtTime(m.to)}` : ""}
                        </span>
                        {m.kind && <span className={`font-semibold ${s.text}`}>· {m.kind}</span>}
                      </div>
                    </Link>
                    {/* Only when there is one. An in-person meeting renders no
                        "Join" at all rather than a dead one. */}
                    {m.link && (
                      <a
                        href={m.link}
                        target="_blank"
                        rel="noreferrer"
                        className="press shrink-0 rounded-lg bg-chrome px-2.5 py-1 text-[11px] font-semibold text-chrome-ink"
                      >
                        Join
                      </a>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </section>

        <section className="rise rounded-3xl bg-surface p-5 shadow-card sm:col-span-2 lg:col-span-1" style={stagger(4)}>
          <div className="flex items-center justify-between">
            <h2 className="text-[11px] font-semibold uppercase tracking-widest text-ink-faint">
              My tasks <span className="ml-1 text-accent-strong">{tasks.length}</span>
            </h2>
            <Link href="/tasks" className="press flex items-center gap-1 text-xs font-medium text-accent-strong hover:underline">
              Open board <Icon name="arrow" className="h-3 w-3" />
            </Link>
          </div>
          {tasks.length === 0 ? (
            <Empty icon="check" text="Nothing assigned to you. Enjoy the calm." />
          ) : (
            <div className="mt-3 space-y-1">
              {tasks.slice(0, 5).map((t, i) => (
                <div
                  key={t.id}
                  className="rise flex items-center justify-between gap-2 rounded-xl px-2.5 py-1.5 transition-colors hover:bg-raised"
                  style={{ animationDelay: `${240 + i * 45}ms` }}
                >
                  <span className="truncate text-[13px] font-medium text-ink">{t.title}</span>
                  <span className="flex shrink-0 items-center gap-1.5">
                    {t.dueDate && <span className="text-[11px] text-ink-faint">{fmtDate(t.dueDate)}</span>}
                    <PriorityBadge priority={t.priority} />
                  </span>
                </div>
              ))}
            </div>
          )}
        </section>
      </div>

      {/* ============ Waiting on you (approvers) ============ */}
      {isApprover && pendingApprovals.length > 0 && (
        <section className="rise rounded-3xl border-l-[3px] border-rose-strong bg-rose p-5 shadow-card" style={stagger(5)}>
          <div className="flex items-center justify-between">
            <h2 className="text-[11px] font-semibold uppercase tracking-widest text-rose-strong">Waiting on you</h2>
            <Link href="/leave" className="press text-xs font-medium text-rose-strong hover:underline">Open leave</Link>
          </div>
          <div className="mt-3 space-y-2">
            {pendingApprovals.map((p, i) => (
              <div
                key={p.id}
                style={{ animationDelay: `${280 + i * 60}ms` }}
                className="rise flex flex-wrap items-center justify-between gap-2 rounded-2xl bg-surface/80 px-3.5 py-2.5"
              >
                <div className="min-w-0 text-[13px]">
                  <div className="truncate font-semibold text-ink">{p.employeeName}</div>
                  <div className="text-[11px] text-ink-soft">
                    leave {fmtDate(p.fromDate)} → {fmtDate(p.toDate)}
                  </div>
                </div>
                <button
                  onClick={() => approveLeave(p.id)}
                  disabled={busyLeave === p.id}
                  className="press rounded-full bg-chrome px-3.5 py-1.5 text-xs font-semibold text-chrome-ink transition-colors hover:bg-chrome-card disabled:opacity-40"
                >
                  {busyLeave === p.id ? "…" : "Approve"}
                </button>
              </div>
            ))}
          </div>
        </section>
      )}

      {/* ============ Role attention strips ============ */}
      {hrAttention && (
        <section className="rise rounded-3xl bg-surface p-5 shadow-card" style={stagger(6)}>
          <h2 className="text-[11px] font-semibold uppercase tracking-widest text-ink-faint">HR attention</h2>
          <div className="mt-3 grid grid-cols-2 gap-3">
            <AttentionStat href="/hr" tone="text-peach-strong" value={hrAttention.activeOnboardings} label="active onboardings" />
            <AttentionStat href="/documents" tone="text-rose-strong" value={hrAttention.expiringDocs} label="required docs" />
          </div>
        </section>
      )}

      {/* ============ The team's day (appendix A8) ============ */}
      {isApprover && <TeamDay />}

      {/* ============ The loop, made visible ============ */}
      <WatchLine
        checkedIn={checkedIn}
        dayOver={dayOver}
        phase={day?.phase}
        nowMs={nowMs}
        next={nextUp}
        leadMinutes={CHECK_LEAD_MINUTES}
      />

      {/* ============ This month (the common calendar, at a glance) ============ */}
      <MonthGlance />

      {/* ============ Quick links ============ */}
      <section className="rise flex flex-wrap gap-2 rounded-3xl border border-dashed border-line p-4" style={stagger(8)}>
        <QuickLink href="/me" label="Profile" />
        <QuickLink href="/approvals" label="Approvals" />
      </section>

      {/*
        The conversation, for the two moments that need one. Not while they are
        working — see the header of `day-chat.tsx` for why these two may open
        themselves when A1c says the chat may not.
      */}
      {/* The morning, run by the assistant — chosen at clock-in. */}
      {openChat === "plan" && planInChat && day && day.phase !== "planned" && (
        <DayChat
          firstName={firstName}
          plan={{
            phase: day.phase === "none" ? "briefing" : (day.phase as "briefing" | "planning" | "abandoned"),
            briefItem: day.briefItem,
            pickable: pickableForChat,
            committed: day.plan
              .filter((p) => !p.dropped)
              .map((p) => ({ id: p.id, label: p.label, estimateMinutes: p.estimateMinutes })),
            tally: day.tally,
          }}
          onClose={dismissChat}
          onAnswerBrief={async (reply) => {
            await post({ action: "answerBrief", reply });
          }}
          onSelect={async (label, minutes, ref) => {
            await post({ action: "select", label, estimateMinutes: minutes, ref });
          }}
          onCommit={async () => {
            await post({ action: "commit" });
          }}
          onMissReason={answerMiss}
          onCarryOver={carryOver}
          onDrop={(id) => dropItem(id)}
          onPartDone={recordProgress}
          onFinish={finishCloseOut}
          onNote={noteDay}
        />
      )}

      {/* Work that landed after the day was settled — offered, never inserted. */}
      {openChat === "newWork" && day?.newWork?.[0] && (
        <DayChat
          firstName={firstName}
          newWork={day.newWork[0]}
          onClose={dismissChat}
          onSelect={async (label, minutes, ref) => {
            await post({ action: "select", label, estimateMinutes: minutes, ref });
          }}
          onDeclineWork={async (taskId) => {
            await post({ action: "declineWork", taskId });
          }}
          onMissReason={answerMiss}
          onCarryOver={carryOver}
          onDrop={(id) => dropItem(id)}
          onPartDone={recordProgress}
          onFinish={finishCloseOut}
          onNote={noteDay}
        />
      )}

      {/* A slot about to end — asked where it can still be acted on. */}
      {openChat === "check" && endingSoon && (
        <DayChat
          firstName={firstName}
          check={{ id: endingSoon.id, label: endingSoon.label, end: endingSoon.end }}
          onClose={dismissChat}
          onStatusCheck={async (itemId, status) => {
            dismissCheck(itemId);
            const state = await post({ action: "statusCheck", itemId, status });
            return { atRisk: (state as (TodayState & { atRisk?: string }) | null)?.atRisk };
          }}
          onMissReason={answerMiss}
          onCarryOver={carryOver}
          onDrop={(id) => dropItem(id)}
          onPartDone={recordProgress}
          onFinish={finishCloseOut}
          onNote={noteDay}
        />
      )}

      {openChat === "miss" && chatMiss && (
        <DayChat
          firstName={firstName}
          miss={chatMiss}
          onClose={dismissChat}
          onMissReason={answerMiss}
          onCarryOver={carryOver}
          onDrop={(id) => dropItem(id)}
          onPartDone={recordProgress}
          onFinish={finishCloseOut}
          onNote={noteDay}
        />
      )}
      {openChat === "closeout" && day?.closeOut && (
        <DayChat
          firstName={firstName}
          closeOut={day.closeOut}
          onClose={dismissChat}
          onMissReason={answerMiss}
          onCarryOver={carryOver}
          onDrop={(id) => dropItem(id)}
          onPartDone={recordProgress}
          onFinish={finishCloseOut}
          onNote={noteDay}
        />
      )}

      <OpFeedback
        error={op.error}
        confirmation={op.confirmation}
        busy={op.busy}
        onConfirm={() => op.confirm()}
        onCancel={op.cancel}
        onDismiss={op.reset}
      />
    </div>
  );
}

/* ============ pieces ============ */

/**
 * The loop, made visible.
 *
 * The day plan has always been a loop — it watches the clock, decides when a
 * question is worth asking, and speaks when it is. All of that was invisible
 * until the moment it interrupted, which makes an agentic application feel
 * inert between interruptions and startling during them.
 *
 * So it says what it is doing: what it is watching, when that slot ends, and
 * when it will next check in. Nothing here decides anything — it reports the
 * same numbers the check-in itself is derived from, so the two cannot disagree.
 */
function WatchLine({
  checkedIn,
  dayOver,
  phase,
  nowMs,
  next,
  leadMinutes,
}: {
  checkedIn: boolean;
  dayOver: boolean;
  phase?: string;
  nowMs: number;
  next: { label: string; end?: string } | null;
  leadMinutes: number;
}) {
  if (dayOver || !checkedIn) return null;

  let line: string;
  if (phase !== "planned") {
    line = "Waiting for your plan — nothing is being tracked yet.";
  } else if (!next?.end) {
    line = "Watching your day. Nothing due soon.";
  } else {
    const minsLeft = Math.round((at(next.end) - nowMs) / 60000);
    if (minsLeft <= 0) {
      line = `${next.label} is past its slot.`;
    } else if (minsLeft <= leadMinutes) {
      line = `${next.label} ends in ${minsLeft}m — I'll check in.`;
    } else {
      line = `Watching ${next.label} · ends ${fmtClock(next.end)} · next check in ${minsLeft - leadMinutes}m`;
    }
  }

  return (
    <section
      className="rise flex items-center gap-2.5 rounded-2xl border border-dashed border-line px-4 py-2.5"
      aria-live="polite"
    >
      <span className="pulse-dot h-2 w-2 shrink-0 rounded-full bg-accent-strong" />
      <span className="min-w-0 flex-1 text-[12px] text-ink-soft" suppressHydrationWarning>
        {line}
      </span>
      <span className="shrink-0 text-[10px] uppercase tracking-wider text-ink-faint">
        assistant
      </span>
    </section>
  );
}

function BriefCard({
  item,
  onReply,
}: {
  item: { text: string; replies: string[]; index: number; total: number } | null;
  onReply: (reply: string) => void;
}) {
  if (!item) {
    // Brief list exhausted but the phase flips on the next answer.
    return (
      <div className="pop-in rounded-2xl bg-white/[.04] px-5 py-4">
        <p className="text-sm text-chrome-soft">Brief done — over to planning.</p>
        <button
          onClick={() => onReply("Got it")}
          className="press mt-2 rounded-full bg-accent px-4 py-1.5 text-xs font-bold text-chrome"
        >
          Plan my day
        </button>
      </div>
    );
  }
  return (
    <div key={item.index} className="pop-in rounded-2xl bg-white/[.04] px-5 py-4">
      <div className="text-[10px] font-semibold uppercase tracking-widest text-accent">
        Your brief · {item.index + 1} of {item.total}
      </div>
      <p className="mt-1.5 text-sm">{item.text}</p>
      <div className="mt-3 flex flex-wrap gap-2">
        {item.replies.map((r) => (
          <button
            key={r}
            onClick={() => onReply(r)}
            className="press rounded-full bg-white/[.08] px-4 py-1.5 text-xs font-semibold text-chrome-ink transition-colors hover:bg-white/[.14]"
          >
            {r}
          </button>
        ))}
      </div>
    </div>
  );
}

function StatTile({
  href,
  tone,
  label,
  value,
}: {
  href: string;
  tone: string;
  label: string;
  value: number;
}) {
  return (
    <Link href={href} className={`lift press flex flex-col justify-between rounded-3xl p-4 ${tone}`}>
      <span className="text-2xl font-extrabold">
        <CountUp value={value} />
      </span>
      <span className="mt-1 text-[11px] font-semibold opacity-80">{label}</span>
    </Link>
  );
}

/**
 * The last four weeks of your own days — one mark per day.
 *
 * Strictly personal, like the streak it sits beside (A7: "not visible to the
 * team, not compared between people, not shown to a manager"). It exists so a
 * broken streak has context: the run behind it is still visible.
 *
 * `/api/today/history` was built with no caller at all, which is the same
 * defect this round set out to remove. This is it.
 */
function DayHistory() {
  const [days, setDays] = useState<
    Array<{ date: string; committed: number; done: number; ranOver: number; interrupted: number; onLeave: boolean }>
  >([]);
  const [tick, setTick] = useState(0);
  useLiveEvent(() => setTick((t) => t + 1), { areas: ["day-plan"] });

  useEffect(() => {
    let live = true;
    fetch("/api/today/history")
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => {
        if (live && d) setDays(d.days ?? []);
      })
      .catch(() => {});
    return () => {
      live = false;
    };
  }, [tick]);

  const planned = days.filter((d) => d.committed > 0 || d.onLeave);
  if (planned.length < 2) return null;

  const toneOf = (d: (typeof planned)[number]) => {
    if (d.onLeave) return { bg: "bg-line/50", label: "on leave" };
    if (d.ranOver > 0) return { bg: "bg-peach-strong", label: `${d.ranOver} ran over` };
    if (d.done === d.committed) return { bg: "bg-accent", label: "all done" };
    return { bg: "bg-lilac-strong", label: `${d.done} of ${d.committed} done` };
  };

  return (
    <div className="mt-3 flex flex-col gap-1.5">
      <div className="flex items-center gap-1">
        {planned.slice(-28).map((d) => {
          const tone = toneOf(d);
          return (
            <span
              key={d.date}
              className={`h-3 w-3 rounded-[3px] ${tone.bg}`}
              title={`${d.date} · ${tone.label}`}
            />
          );
        })}
      </div>
      <span className="text-[10px] text-chrome-soft">
        your last {Math.min(planned.length, 28)} planned days · only you see this
      </span>
    </div>
  );
}

/**
 * What the team committed to today, and whether it is done.
 *
 * Appendix A8 draws the line and the server enforces it: no streak, and no
 * reason anybody gave for a miss. Those stay between a person and the
 * application — "people answer honestly when nobody is reading over their
 * shoulder." Everything rendered here comes from `managerView`, which strips
 * both before the data leaves the service.
 */
function TeamDay() {
  const [team, setTeam] = useState<
    Array<{
      actor: string;
      name: string;
      planned: boolean;
      committed: Array<{ id: string; label: string; estimateMinutes: number; done: boolean }>;
      committedMinutes: number;
      doneCount: number;
      building: Array<{
        id: string;
        title: string;
        stage: string;
        completion: number | null;
        stale: boolean;
        daysWaiting?: number;
      }>;
    }>
  >([]);
  const [loaded, setLoaded] = useState(false);
  const [tick, setTick] = useState(0);
  useLiveEvent(() => setTick((t) => t + 1), { areas: ["day-plan", "task", "course"] });

  useEffect(() => {
    let live = true;
    fetch("/api/today/team")
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => {
        if (!live || !d) return;
        setTeam(d.team ?? []);
        setLoaded(true);
      })
      .catch(() => {});
    return () => {
      live = false;
    };
  }, [tick]);

  // Somebody with nothing planned and nothing in the pipeline has nothing to
  // show — an empty row per colleague would be noise, not information.
  const shown = team.filter((m) => m.planned || m.building.length > 0);
  if (!loaded || shown.length === 0) return null;

  return (
    <section className="rise rounded-3xl bg-surface p-5 shadow-card">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 className="text-[11px] font-semibold uppercase tracking-widest text-ink-faint">
          Your team today
        </h2>
        <span className="text-[11px] text-ink-faint">what was committed, and what is done</span>
      </div>
      <div className="mt-3 space-y-2">
        {shown.map((m) => (
          <div key={m.actor} className="rounded-2xl border border-line p-3">
            <div className="flex flex-wrap items-baseline justify-between gap-2">
              <span className="text-sm font-semibold text-ink">{m.name}</span>
              {m.planned ? (
                <span className="text-[11px] tabular-nums text-ink-faint">
                  {m.doneCount} of {m.committed.length} done · {fmtMin(m.committedMinutes)} committed
                </span>
              ) : (
                <span className="text-[11px] text-ink-faint">no plan today</span>
              )}
            </div>
            {m.committed.length > 0 && (
              <div className="mt-2 flex flex-wrap gap-1.5">
                {m.committed.map((item) => (
                  <span
                    key={item.id}
                    className={`rounded-full px-2.5 py-1 text-[11px] ${
                      item.done ? "bg-mint font-semibold text-mint-strong" : "bg-line/40 text-ink-soft"
                    }`}
                  >
                    {item.label} · {fmtMin(item.estimateMinutes)}
                  </span>
                ))}
              </div>
            )}
            {/* What they are building, taken from the work itself (feature 19). */}
            {m.building.length > 0 && (
              <div className="mt-2 flex flex-wrap gap-1.5">
                {m.building.map((c) => (
                  <Link
                    key={c.id}
                    href="/courses"
                    className={`press rounded-full px-2.5 py-1 text-[11px] ${
                      c.stale ? "bg-peach font-semibold text-peach-strong" : "bg-lilac text-lilac-strong"
                    }`}
                    title={
                      c.stale
                        ? `In ${c.stage} for ${c.daysWaiting} days`
                        : `In ${c.stage}`
                    }
                  >
                    {c.title} · {c.stage}
                    {c.completion !== null && ` · ${c.completion}%`}
                    {c.stale && ` · ${c.daysWaiting}d`}
                  </Link>
                ))}
              </div>
            )}
          </div>
        ))}
      </div>
    </section>
  );
}

function AttentionStat({
  href,
  tone,
  value,
  label,
}: {
  href?: string;
  tone: string;
  value: number;
  label: string;
}) {
  const inner = (
    <div className="rounded-2xl bg-raised px-3 py-3 text-center transition-colors hover:bg-accent-soft/50">
      <div className={`text-2xl font-extrabold ${tone}`}>
        <CountUp value={value} />
      </div>
      <div className="mt-0.5 text-[11px] text-ink-faint">{label}</div>
    </div>
  );
  return href ? <Link href={href}>{inner}</Link> : inner;
}

function QuickLink({ href, label }: { href: string; label: string }) {
  return (
    <Link
      href={href}
      className="press group flex items-center gap-1.5 rounded-full bg-surface px-3.5 py-1.5 text-xs font-medium text-ink-soft shadow-card transition-colors hover:text-accent-strong"
    >
      {label}
      <Icon name="arrow" className="h-3 w-3 transition-transform duration-200 group-hover:translate-x-0.5" />
    </Link>
  );
}

/**
 * The common calendar's current month, on the dashboard. Density, not detail
 * (E2): a dot per meeting, events named by count, today ringed. Every day
 * links to /calendar, where the full month view and day panel live.
 */
function MonthGlance() {
  const today = new Date().toISOString().slice(0, 10);
  const year = Number(today.slice(0, 4));
  const month = Number(today.slice(5, 7));
  const [cells, setCells] = useState<
    Array<{ date: string; meetings: number; events: Array<{ id: string; title: string }> }>
  >([]);
  const [loaded, setLoaded] = useState(false);
  const [tick, setTick] = useState(0);
  useLiveEvent(() => setTick((t) => t + 1), { areas: ["calendar", "meeting", "event", "room"] });

  useEffect(() => {
    let live = true;
    fetch(`/api/calendar/${year}/${month}`)
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => {
        if (!live || !d) return;
        setCells(d.cells ?? []);
        setLoaded(true);
      })
      .catch(() => {});
    return () => {
      live = false;
    };
  }, [year, month, tick]);

  if (!loaded) return null;

  const monthName = fmtMonthYear(year, month);
  // Monday-first offset for the first cell of the month.
  const firstDay = new Date(year, month - 1, 1).getDay(); // 0 = Sunday
  const lead = (firstDay + 6) % 7;
  const busiest = cells.filter((c) => c.meetings > 0 || c.events.length > 0).length;

  return (
    <section className="rise rounded-3xl bg-surface p-5 shadow-card" style={{ animationDelay: "60ms" }}>
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 className="text-[11px] font-semibold uppercase tracking-widest text-ink-faint">
          This month · {monthName}
        </h2>
        <Link href="/calendar" className="press text-xs font-medium text-accent-strong hover:underline">
          Open calendar
        </Link>
      </div>
      <div className="mt-3 grid grid-cols-7 gap-1 text-center">
        {["M", "T", "W", "T", "F", "S", "S"].map((d, i) => (
          <span key={i} className="pb-1 text-[10px] font-semibold uppercase text-ink-faint">
            {d}
          </span>
        ))}
        {Array.from({ length: lead }, (_, i) => (
          <span key={`lead-${i}`} />
        ))}
        {cells.map((c) => {
          const isToday = c.date === today;
          const has = c.meetings > 0 || c.events.length > 0;
          return (
            <Link
              key={c.date}
              href="/calendar"
              title={
                has
                  ? [
                      c.meetings > 0 ? `${c.meetings} meeting${c.meetings === 1 ? "" : "s"}` : "",
                      ...c.events.map((e) => e.title),
                    ]
                      .filter(Boolean)
                      .join(" · ")
                  : undefined
              }
              className={`press flex min-h-11 flex-col items-center justify-start gap-0.5 rounded-xl px-0.5 pt-1.5 text-[11px] transition-colors ${
                isToday
                  ? "bg-accent-soft font-bold text-accent-strong ring-1 ring-accent-strong"
                  : has
                    ? "bg-raised font-medium text-ink hover:bg-accent-soft/50"
                    : "text-ink-faint hover:bg-raised"
              }`}
            >
              {Number(c.date.slice(8, 10))}
              <span className="flex items-center gap-0.5">
                {Array.from({ length: Math.min(c.meetings, 3) }, (_, i) => (
                  <span key={i} className="h-1 w-1 rounded-full bg-accent-strong" />
                ))}
                {c.events.length > 0 && <span className="h-1 w-1 rounded-full bg-mint-strong" />}
              </span>
            </Link>
          );
        })}
      </div>
      <div className="mt-3 flex flex-wrap gap-x-4 gap-y-1 text-[10px] text-ink-faint">
        <span className="flex items-center gap-1.5">
          <span className="h-1.5 w-1.5 rounded-full bg-accent-strong" /> meeting
        </span>
        <span className="flex items-center gap-1.5">
          <span className="h-1.5 w-1.5 rounded-full bg-mint-strong" /> event
        </span>
        <span className="ml-auto">{busiest} busy day{busiest === 1 ? "" : "s"} this month</span>
      </div>
    </section>
  );
}
