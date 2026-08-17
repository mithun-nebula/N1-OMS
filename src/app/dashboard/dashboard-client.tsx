"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import { isApprover as roleIsApprover } from "@/server/roles";
import { Icon } from "../ui/icons";
import { CountUp, ThreeRings } from "../ui/progress-ring";
import { Empty, OpFeedback, PriorityBadge } from "../ui/kit";
import { useOperation } from "@/components/ops/use-operation";

interface TaskItem {
  id: string;
  title: string;
  priority: string;
  dueDate?: string;
  projectId?: string;
}

interface MeetingItem {
  id: string;
  title: string;
  from?: string;
  to?: string;
  kind?: string;
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
  }>;
  rows: Array<{ kind: "work" | "meeting"; id: string; title: string; start?: string; done?: boolean; tag?: string }>;
  tally: { meetings: number; work: number; free: number };
  streak: { clean: number; bestClean: number; dayPlanned: number };
  overCapacity?: boolean;
  offerNow?: boolean;
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

function fmtClock(iso?: string): string {
  if (!iso) return "";
  return new Date(iso).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
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
  adminAttention,
}: {
  userId: string;
  displayName: string;
  role: string;
  tasks: TaskItem[];
  doneCount: number;
  meetings: MeetingItem[];
  pendingApprovals: PendingLeave[];
  courseCount: number;
  teamSize: number;
  hrAttention: { activeOnboardings: number; outstandingAcks: number; expiringDocs: number } | null;
  adminAttention: { userCount: number; rules: number; operationCount: number } | null;
}) {
  const op = useOperation();
  const [day, setDay] = useState<TodayState | null>(null);
  const [busyLeave, setBusyLeave] = useState<string | null>(null);
  const [customLabel, setCustomLabel] = useState("");
  const [estimate, setEstimate] = useState(60);
  const [taskEstimates, setTaskEstimates] = useState<Record<string, number>>({});
  const [tickFor, setTickFor] = useState<string | null>(null);
  const [missFor, setMissFor] = useState<string | null>(null);
  const [closingOut, setClosingOut] = useState(false);

  const isApprover = roleIsApprover(role);

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

  useEffect(() => {
    void refreshDay();
  }, [refreshDay]);

  async function post(body: Record<string, unknown>): Promise<TodayState | null> {
    try {
      const res = await fetch("/api/today", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      if (!res.ok) return null;
      const state = (await res.json()) as TodayState;
      setDay(state);
      return state;
    } catch {
      return null;
    }
  }

  async function clockIn() {
    const date = new Date().toISOString().slice(0, 10);
    const outcome = await op.run("attendance.checkIn", { employeeId: userId, date }, { refresh: false });
    if (outcome.status === "ran") await post({ action: "start" });
  }

  async function planWithoutClockIn() {
    await post({ action: "start" });
  }

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

  async function addItem(label: string, minutes: number, ref?: { nodeType: string; nodeId: string }) {
    await post({ action: "select", label, estimateMinutes: minutes, ref });
  }

  async function tick(itemId: string, actualMinutes: number | undefined) {
    setTickFor(null);
    const item = day?.plan.find((p) => p.id === itemId);
    const state = await post({ action: "tick", itemId, actualMinutes });
    // A plan item backed by a real task completes the task too — one action,
    // both records, both audited.
    if (item?.ref?.nodeType === "task") {
      await op.run("task.complete", { taskId: item.ref.nodeId }, { refresh: true });
    }
    if (state?.offerNow) setMissFor(itemId);
  }

  async function sendMissReason(itemId: string, reason: string) {
    setMissFor(null);
    await post({ action: "missReason", itemId, reason });
  }

  async function approveLeave(leaveId: string) {
    setBusyLeave(leaveId);
    await op.run("leave.approve", { leaveId });
    setBusyLeave(null);
  }

  const firstName = displayName.split(/\s+/)[0] ?? displayName;
  const dateLine = new Date().toLocaleDateString(undefined, {
    weekday: "long",
    month: "long",
    day: "numeric",
  });

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

  const stagger = (i: number) => ({ animationDelay: `${i * 70}ms` });

  return (
    <div className="mx-auto max-w-6xl space-y-5 p-4 sm:p-6">
      {/* ============ Greeting + clock ============ */}
      <header className="rise flex flex-wrap items-end justify-between gap-3" style={stagger(0)}>
        <div>
          <h1 className="text-3xl font-light tracking-tight text-ink sm:text-4xl">
            {dayOver ? "Good work, " : "Hello, "}
            <span className="font-extrabold">{firstName}</span>
          </h1>
          <p className="mt-1 text-sm text-ink-soft">{dateLine} — here&apos;s your day.</p>
        </div>
        <div className="flex items-center gap-2.5">
          {day && !day.attendance.checkInAt && (
            <button
              onClick={clockIn}
              disabled={op.busy}
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
              <div className="flex items-center gap-1.5 text-[12px] text-chrome-soft">
                <Icon name="spark" className="h-3.5 w-3.5 text-accent" />
                <b className="text-chrome-ink">{day?.streak.clean ?? 0}</b> clean days
                <span className="text-[9px] uppercase tracking-wider">· only you see this</span>
              </div>
            </div>
          </div>

          {/* Phase content */}
          <div className="min-w-0 flex-1">
            {!day || day.phase === "none" ? (
              <div className="fade-in flex h-full min-h-28 flex-col items-start justify-center gap-3 rounded-2xl bg-white/[.04] px-5 py-4">
                <p className="text-sm text-chrome-soft">
                  {dayOver
                    ? "The day is closed. Anything unfinished carries to tomorrow's brief."
                    : "Nothing planned yet. Clock in to get your brief — or plan the day without clocking in."}
                </p>
                {!dayOver && (
                  <button
                    onClick={planWithoutClockIn}
                    className="press rounded-full bg-white/[.08] px-4 py-2 text-xs font-semibold text-chrome-ink transition-colors hover:bg-white/[.14]"
                  >
                    Plan my day
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

                {pickableTasks.length > 0 && (
                  <div className="space-y-1.5">
                    {pickableTasks.slice(0, 4).map((t) => (
                      <div key={t.id} className="flex items-center justify-between gap-2 rounded-xl bg-white/[.04] px-3 py-1.5">
                        <span className="truncate text-[13px] text-chrome-soft">{t.title}</span>
                        <span className="flex shrink-0 items-center gap-1.5">
                          <select
                            value={taskEstimates[t.id] ?? 60}
                            onChange={(e) => setTaskEstimates({ ...taskEstimates, [t.id]: Number(e.target.value) })}
                            className="rounded-lg border border-chrome-line bg-transparent px-1.5 py-0.5 text-[11px] font-medium text-chrome-ink outline-none"
                          >
                            {ESTIMATES.map((m) => <option key={m} value={m} className="text-ink">{fmtMin(m)}</option>)}
                          </select>
                          <button
                            onClick={() => addItem(t.title, taskEstimates[t.id] ?? 60, { nodeType: "task", nodeId: t.id })}
                            className="press rounded-full bg-accent px-2.5 py-0.5 text-[11px] font-bold text-chrome"
                          >
                            Add
                          </button>
                        </span>
                      </div>
                    ))}
                  </div>
                )}

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
                <h3 className="mb-2 text-sm font-bold">Your day</h3>
                {day.rows.length === 0 ? (
                  <p className="text-[13px] text-chrome-soft">Nothing on the plan.</p>
                ) : (
                  day.rows.map((row) => {
                    const planItem = day.plan.find((p) => p.id === row.id);
                    return (
                      <div key={`${row.kind}-${row.id}`} className="rounded-xl bg-white/[.05] px-3 py-2">
                        <div className="flex items-center gap-2.5">
                          {row.kind === "meeting" ? (
                            <Icon name="meetings" className="h-3.5 w-3.5 shrink-0 text-chrome-soft" />
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
                          <span className={`min-w-0 flex-1 truncate text-[13px] ${row.done ? "text-chrome-soft line-through" : ""}`}>
                            {row.title}
                          </span>
                          {row.start && (
                            <span className="shrink-0 text-[11px] text-chrome-soft">{fmtClock(row.start)}</span>
                          )}
                          {planItem && (
                            <span className="shrink-0 text-[11px] font-semibold text-accent">{fmtMin(planItem.estimateMinutes)}</span>
                          )}
                          {row.tag && (
                            <span className="shrink-0 rounded-full bg-peach px-2 py-0.5 text-[9px] font-bold text-peach-strong">
                              {row.tag === "carried-over" ? "carried over — meeting" : row.tag === "ran-over" ? "ran over" : row.tag}
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
                          </div>
                        )}
                        {missFor === row.id && (
                          <div className="pop-in mt-2 flex flex-wrap items-center gap-1.5 pl-7 text-[11px]">
                            <span className="text-chrome-soft">What got in the way?</span>
                            {["Bigger than expected", "Interruptions", "Waiting on someone"].map((r) => (
                              <button key={r} onClick={() => sendMissReason(row.id, r)} className="press rounded-full bg-white/[.08] px-2.5 py-1 font-semibold text-chrome-ink">
                                {r}
                              </button>
                            ))}
                            <button onClick={() => setMissFor(null)} className="text-chrome-soft hover:text-chrome-ink">skip</button>
                          </div>
                        )}
                      </div>
                    );
                  })
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
            <Link href="/meetings" className="press flex items-center gap-1 text-xs font-medium text-accent-strong hover:underline">
              View all <Icon name="arrow" className="h-3 w-3" />
            </Link>
          </div>
          {meetings.length === 0 ? (
            <Empty icon="calendar" text="No meetings ahead — a clear runway." />
          ) : (
            <div className="mt-3 space-y-2">
              {meetings.slice(0, 4).map((m, i) => {
                const s = KIND_STYLE[m.kind ?? ""] ?? KIND_DEFAULT;
                return (
                  <Link
                    key={m.id}
                    href="/meetings"
                    style={{ animationDelay: `${200 + i * 60}ms` }}
                    className={`rise lift flex items-center gap-3 rounded-2xl border-l-[3px] px-3.5 py-2.5 ${s.bg} ${s.edge}`}
                  >
                    <div className="min-w-0 flex-1">
                      <div className="truncate text-[13px] font-semibold text-ink">{m.title}</div>
                      <div className="mt-0.5 flex items-center gap-1.5 text-[11px] text-ink-soft">
                        <Icon name="clock" className="h-3 w-3" />
                        {m.from ?? "unscheduled"}
                        {m.kind && <span className={`font-semibold ${s.text}`}>· {m.kind}</span>}
                      </div>
                    </div>
                  </Link>
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
                    {t.dueDate && <span className="text-[11px] text-ink-faint">{t.dueDate}</span>}
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
                  <div className="text-[11px] text-ink-soft">leave {p.fromDate} → {p.toDate}</div>
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
          <div className="mt-3 grid grid-cols-3 gap-3">
            <AttentionStat href="/hr" tone="text-peach-strong" value={hrAttention.activeOnboardings} label="active onboardings" />
            <AttentionStat href="/announcements" tone="text-mint-strong" value={hrAttention.outstandingAcks} label="outstanding acks" />
            <AttentionStat href="/documents" tone="text-rose-strong" value={hrAttention.expiringDocs} label="required docs" />
          </div>
        </section>
      )}

      {adminAttention && (
        <section className="rise rounded-3xl bg-surface p-5 shadow-card" style={stagger(7)}>
          <div className="flex items-center justify-between">
            <h2 className="text-[11px] font-semibold uppercase tracking-widest text-ink-faint">System</h2>
            <Link href="/admin" className="press flex items-center gap-1 text-xs font-medium text-accent-strong hover:underline">
              Admin panel <Icon name="arrow" className="h-3 w-3" />
            </Link>
          </div>
          <div className="mt-3 grid grid-cols-2 gap-3">
            <AttentionStat tone="text-ink" value={adminAttention.userCount} label="users" />
            <AttentionStat tone="text-ink" value={adminAttention.operationCount} label="registered operations" />
          </div>
        </section>
      )}

      {/* ============ Quick links ============ */}
      <section className="rise flex flex-wrap gap-2 rounded-3xl border border-dashed border-line p-4" style={stagger(8)}>
        <QuickLink href="/leave" label="Leave balance & history" />
        <QuickLink href="/me" label="Profile & payslips" />
        <QuickLink href="/calendar" label="Open calendar" />
      </section>

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
