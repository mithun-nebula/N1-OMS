"use client";

import { useState, useRef } from "react";
import type { DayPlan } from "@/domains/assistant/day-plan/store";

interface BriefItem {
  text: string;
  replies: string[];
  index: number;
  total: number;
}

interface Dashboard {
  rows: Array<{
    kind: "work" | "meeting";
    id: string;
    title: string;
    start?: string;
    done?: boolean;
    tag?: string;
  }>;
  tally: { meetings: number; work: number; free: number };
}

interface NewsItem {
  title: string;
  summary: string;
  affectsCourse?: string;
}

interface Initial {
  open: "brief" | "dashboard" | "resume";
  prompt?: string;
  briefItem: BriefItem | null;
  dashboard: Dashboard | null;
  plan: DayPlan | null;
  news: NewsItem[];
}

const TIME_CHIPS = [30, 60, 120, 180];

export function TodayClient({
  date,
  initial,
}: {
  date: string;
  initial: Initial;
}) {
  const [mode, setMode] = useState<"brief" | "planning" | "dashboard" | "resume">(
    initial.open === "dashboard"
      ? "dashboard"
      : initial.open === "resume"
        ? "resume"
        : initial.briefItem
          ? "brief"
          : "planning",
  );
  const [briefItem, setBriefItem] = useState<BriefItem | null>(initial.briefItem);
  const [plan, setPlan] = useState<DayPlan | null>(initial.plan);
  const [dashboard, setDashboard] = useState<Dashboard | null>(initial.dashboard);
  const [news] = useState<NewsItem[]>(initial.news);
  const [draftLabel, setDraftLabel] = useState("");
  const [draftMinutes, setDraftMinutes] = useState<number | null>(null);
  const [overCapacity, setOverCapacity] = useState(false);
  const [assistant, setAssistant] = useState<{ open: boolean; input: string; messages: string[] }>({
    open: false,
    input: "",
    messages: [],
  });
  const [busy, setBusy] = useState(false);

  async function postDay(action: string, payload: Record<string, unknown> = {}) {
    setBusy(true);
    const res = await fetch("/api/day", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action, date, ...payload }),
    });
    setBusy(false);
    return res.json();
  }

  async function refreshState() {
    const res = await fetch(`/api/day?date=${date}`);
    return res.json();
  }

  async function onBriefReply(reply: string) {
    await postDay("answer", { reply });
    const state = await refreshState();
    if (state.briefItem) {
      setBriefItem(state.briefItem);
    } else {
      setMode("planning");
    }
  }

  async function addItem() {
    if (!draftLabel || !draftMinutes) return;
    const res = await postDay("select", {
      item: { label: draftLabel, estimateMinutes: draftMinutes },
    });
    setOverCapacity(Boolean(res.overCapacity));
    setDraftLabel("");
    setDraftMinutes(null);
  }

  async function commit() {
    await postDay("commit");
    const state = await refreshState();
    setPlan(state.plan);
    setDashboard(state.dashboard);
    setMode("dashboard");
  }

  async function resume() {
    const state = await refreshState();
    setPlan(state.plan);
    setBriefItem(state.briefItem);
    setMode(state.briefItem ? "brief" : "planning");
  }

  async function tick(itemId: string) {
    const state = plan;
    if (!state) return;
    await postDay("tick", { itemId });
    const refreshed = await refreshState();
    setPlan(refreshed.plan);
    setDashboard(refreshed.dashboard);
  }

  const dragIndex = useRef<number | null>(null);
  function onDrop(target: number) {
    if (!dashboard || dragIndex.current === null || dragIndex.current === target) return;
    const workRows = dashboard.rows.filter((r) => r.kind === "work");
    const moved = [...workRows];
    const [it] = moved.splice(dragIndex.current, 1);
    moved.splice(target, 0, it);
    postDay("reorder", { order: moved.map((r) => r.id) }).then(() => refreshState().then((s) => setDashboard(s.dashboard)));
    dragIndex.current = null;
  }

  async function askAssistant() {
    if (!assistant.input) return;
    const res = await fetch("/api/assistant/ask", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ message: assistant.input }),
    });
    const data = await res.json();
    setAssistant({ open: true, input: "", messages: [...assistant.messages, data.answer ?? "No answer."] });
  }

  return (
    <main className="mx-auto max-w-5xl space-y-6 px-6 py-8">
      {mode === "brief" && briefItem && (
        <BriefModal
          item={briefItem}
          onReply={onBriefReply}
          busy={busy}
        />
      )}

      {mode === "resume" && (
        <div className="rounded-2xl border border-amber-300 bg-amber-50 p-6 text-amber-900">
          <p className="text-lg">{initial.prompt}</p>
          <button
            onClick={resume}
            className="mt-3 rounded-lg bg-amber-600 px-4 py-2 text-sm font-medium text-white"
          >
            Let&apos;s finish
          </button>
        </div>
      )}

      {mode === "planning" && (
        <section className="rounded-2xl border border-black/[.08] bg-white p-6 dark:border-white/[.12] dark:bg-black">
          <h2 className="text-lg font-semibold text-black dark:text-zinc-50">What are you doing today?</h2>
          <p className="mt-1 text-sm text-zinc-500">A time for each item is required.</p>
          <div className="mt-4 space-y-3">
            {plan?.plan.map((p) => (
              <div key={p.id} className="flex items-center justify-between rounded-lg bg-zinc-50 px-4 py-2 text-sm dark:bg-zinc-900">
                <span className="text-black dark:text-zinc-100">{p.label}</span>
                <span className="font-mono text-zinc-500">{formatMinutes(p.estimateMinutes)}</span>
              </div>
            ))}
          </div>
          <div className="mt-4 flex flex-wrap items-center gap-2">
            <input
              value={draftLabel}
              onChange={(e) => setDraftLabel(e.target.value)}
              placeholder="e.g. Review Arun's draft"
              className="flex-1 rounded-lg border border-black/[.12] bg-white px-3 py-2 text-sm text-black dark:border-white/[.2] dark:bg-black dark:text-zinc-50"
            />
            <div className="flex gap-1">
              {TIME_CHIPS.map((m) => (
                <button
                  key={m}
                  onClick={() => setDraftMinutes(m)}
                  className={`rounded-full px-3 py-1 text-xs font-medium ${draftMinutes === m ? "bg-teal-700 text-white" : "bg-zinc-100 text-zinc-600 dark:bg-zinc-900 dark:text-zinc-300"}`}
                >
                  {formatMinutes(m)}
                </button>
              ))}
            </div>
            <button
              onClick={addItem}
              disabled={!draftLabel || !draftMinutes || busy}
              className="rounded-lg bg-black px-4 py-2 text-sm font-medium text-white disabled:opacity-40 dark:bg-white dark:text-black"
            >
              Add
            </button>
          </div>
          {overCapacity && (
            <p className="mt-3 text-sm text-amber-600">
              That is more than the day holds once meetings are counted.
            </p>
          )}
          <button
            onClick={commit}
            disabled={busy}
            className="mt-5 w-full rounded-lg bg-teal-700 px-4 py-2 font-medium text-white"
          >
            Plan my day
          </button>
        </section>
      )}

      {mode === "dashboard" && dashboard && plan && (
        <>
          <section className="grid grid-cols-1 gap-4 sm:grid-cols-3">
            <div className="sm:col-span-2 rounded-2xl border border-black/[.08] bg-white p-5 dark:border-white/[.12] dark:bg-black">
              <div className="flex items-center justify-between">
                <h2 className="text-sm font-medium uppercase tracking-wide text-zinc-500">Your day</h2>
                <span className="text-xs text-zinc-400">
                  Meetings {formatMinutes(dashboard.tally.meetings)} · Work {formatMinutes(dashboard.tally.work)} · Free {formatMinutes(dashboard.tally.free)}
                </span>
              </div>
              <div className="mt-4 space-y-2">
                {dashboard.rows.map((row, i) => (
                  <div
                    key={row.id}
                    draggable={row.kind === "work"}
                    onDragStart={() => {
                      dragIndex.current = i;
                    }}
                    onDragOver={(e) => e.preventDefault()}
                    onDrop={() => onDrop(i)}
                    className={`flex items-center gap-3 rounded-lg px-3 py-2 text-sm ${
                      row.kind === "meeting"
                        ? "bg-zinc-100 text-zinc-700 dark:bg-zinc-900 dark:text-zinc-300"
                        : row.done
                          ? "bg-teal-50 text-teal-800 line-through dark:bg-teal-950"
                          : "bg-white text-black dark:bg-black dark:text-zinc-100"
                    }`}
                  >
                    {row.kind === "work" && (
                      <input
                        type="checkbox"
                        checked={Boolean(row.done)}
                        onChange={() => tick(row.id)}
                        className="h-4 w-4 accent-teal-700"
                      />
                    )}
                    <span className="flex-1">{row.title}</span>
                    {row.tag === "carried-over" && <span className="text-xs text-zinc-400">carried over</span>}
                    {row.tag === "ran-over" && <span className="text-xs text-rose-500">ran over</span>}
                    {row.tag === "interrupted" && <span className="text-xs text-zinc-400">interrupted</span>}
                  </div>
                ))}
              </div>
            </div>
            <StreakCard streak={plan.streak} />
          </section>

          <section className="rounded-2xl border border-black/[.08] bg-white p-5 dark:border-white/[.12] dark:bg-black">
            <h2 className="text-sm font-medium uppercase tracking-wide text-zinc-500">Technology &amp; AI news</h2>
            <ul className="mt-3 space-y-2">
              {news.map((n) => (
                <li key={n.title} className="text-sm">
                  <span className="font-medium text-black dark:text-zinc-100">{n.title}</span>
                  <span className="text-zinc-500"> — {n.summary}</span>
                  {n.affectsCourse && (
                    <span className="ml-2 rounded bg-amber-100 px-2 py-0.5 text-xs text-amber-800">Affects {n.affectsCourse}</span>
                  )}
                </li>
              ))}
            </ul>
          </section>
        </>
      )}

      <button
        onClick={() => setAssistant({ ...assistant, open: !assistant.open })}
        className="fixed bottom-6 right-6 h-14 w-14 rounded-full bg-teal-700 text-2xl text-white shadow-lg"
        aria-label="Assistant"
      >
        ✦
      </button>
      {assistant.open && (
        <div className="fixed bottom-24 right-6 w-80 rounded-2xl border border-black/[.1] bg-white p-4 shadow-xl dark:border-white/[.2] dark:bg-black">
          <div className="max-h-48 space-y-2 overflow-auto text-sm">
            {assistant.messages.length === 0 && (
              <p className="italic text-zinc-400">Ask me anything about your work.</p>
            )}
            {assistant.messages.map((m, i) => (
              <p key={i} className="text-black dark:text-zinc-100">{m}</p>
            ))}
          </div>
          <div className="mt-3 flex gap-2">
            <input
              value={assistant.input}
              onChange={(e) => setAssistant({ ...assistant, input: e.target.value })}
              onKeyDown={(e) => e.key === "Enter" && askAssistant()}
              placeholder="Type a question"
              className="flex-1 rounded-lg border border-black/[.12] px-2 py-1 text-sm text-black dark:border-white/[.2] dark:bg-black dark:text-zinc-50"
            />
            <button onClick={askAssistant} className="rounded-lg bg-teal-700 px-3 py-1 text-sm text-white">Ask</button>
          </div>
        </div>
      )}
    </main>
  );
}

function BriefModal({ item, onReply, busy }: { item: BriefItem; onReply: (r: string) => void; busy: boolean }) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
      <div className="w-full max-w-md rounded-2xl bg-white p-6 dark:bg-zinc-950">
        <div className="mb-3 text-xs font-medium uppercase tracking-widest text-zinc-400">
          Your morning brief · {item.total - item.index} of {item.total} left
        </div>
        <p className="font-serif text-lg italic text-amber-600">{item.text}</p>
        <div className="mt-5 flex flex-wrap gap-2">
          {item.replies.map((r) => (
            <button
              key={r}
              onClick={() => onReply(r)}
              disabled={busy}
              className="rounded-full bg-zinc-900 px-4 py-2 text-sm font-medium text-white disabled:opacity-50 dark:bg-zinc-100 dark:text-black"
            >
              {r}
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}

function StreakCard({ streak }: { streak: { clean: number; bestClean: number; finishedWithinTime: number; dayPlanned: number } }) {
  const rings = [
    { label: "clean", value: streak.clean, max: Math.max(12, streak.bestClean), color: "#5eead4" },
    { label: "on time", value: streak.finishedWithinTime, max: 12, color: "#fbbf24" },
    { label: "planned", value: streak.dayPlanned, max: 12, color: "#fb7185" },
  ];
  return (
    <div className="rounded-2xl bg-zinc-900 p-5 text-white dark:bg-black">
      <h2 className="text-sm font-medium uppercase tracking-wide text-zinc-400">Streak</h2>
      <p className="text-xs text-zinc-500">Only you can see this.</p>
      <div className="mt-3 flex items-center gap-4">
        <svg viewBox="0 0 120 120" className="h-28 w-28">
          {rings.map((r, i) => {
            const radius = 50 - i * 14;
            const circ = 2 * Math.PI * radius;
            const frac = Math.min(1, r.value / r.max);
            return (
              <circle
                key={r.label}
                cx="60"
                cy="60"
                r={radius}
                fill="none"
                stroke={r.color}
                strokeWidth="6"
                strokeDasharray={`${circ * frac} ${circ}`}
                strokeLinecap="round"
                transform="rotate(-90 60 60)"
              />
            );
          })}
        </svg>
        <div>
          <div className="text-3xl font-semibold">{streak.clean}</div>
          <div className="text-xs text-zinc-400">clean days</div>
        </div>
      </div>
    </div>
  );
}

function formatMinutes(m: number): string {
  if (m < 60) return `${m}m`;
  const h = Math.floor(m / 60);
  const rem = m % 60;
  return rem ? `${h}h ${rem}m` : `${h}h`;
}
