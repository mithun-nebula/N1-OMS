"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

interface EventItem {
  id: string;
  title: string;
  date: string;
  status: string;
  capacity?: number;
  tasks: Array<Record<string, unknown>>;
  registrations: string[];
  budget?: { spent: number; limit?: number };
  report?: string;
}

export function EventsClient({
  events,
  actorId,
}: {
  events: EventItem[];
  people: Array<{ id: string; name: string }>;
  actorId: string;
}) {
  const router = useRouter();
  const [showForm, setShowForm] = useState(false);
  const [busy, setBusy] = useState(false);
  const [form, setForm] = useState({ title: "", date: "", capacity: "", budgetLimit: "" });
  const [taskText, setTaskText] = useState<{ [id: string]: string }>({});
  const [closeReport, setCloseReport] = useState<{ [id: string]: string }>({});
  const [closing, setClosing] = useState<string | null>(null);
  const today = new Date().toISOString().slice(0, 10);
  const nowMs = new Date().getTime();

  async function run(name: string, args: Record<string, unknown>) {
    setBusy(true);
    await fetch("/api/operations", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ start: "form", name, args }),
    });
    setBusy(false);
    router.refresh();
  }

  async function create() {
    if (!form.title || !form.date) return;
    await run("event.create", {
      title: form.title,
      date: form.date,
      capacity: form.capacity ? Number(form.capacity) : undefined,
      budgetLimit: form.budgetLimit ? Number(form.budgetLimit) : undefined,
    });
    setShowForm(false);
    setForm({ title: "", date: "", capacity: "", budgetLimit: "" });
  }

  return (
    <div className="space-y-6 p-6">
      <div className="flex items-center justify-between">
        <p className="text-sm text-zinc-400">{events.length} events</p>
        <button onClick={() => setShowForm(!showForm)} className="rounded-lg bg-teal-700 px-4 py-1.5 text-sm font-medium text-white">
          {showForm ? "Close" : "+ New event"}
        </button>
      </div>

      {showForm && (
        <div className="space-y-3 rounded-xl border border-dashed border-black/[.12] p-4 dark:border-white/[.15]">
          <div className="flex flex-wrap gap-3">
            <input value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} placeholder="Event title" className="flex-1 rounded-lg border border-black/[.12] px-3 py-1.5 text-sm dark:border-white/[.2] dark:bg-black dark:text-zinc-50" />
            <input type="date" value={form.date} onChange={(e) => setForm({ ...form, date: e.target.value })} className="rounded-lg border border-black/[.12] px-3 py-1.5 text-sm dark:border-white/[.2] dark:bg-black dark:text-zinc-50" />
            <input type="number" value={form.capacity} onChange={(e) => setForm({ ...form, capacity: e.target.value })} placeholder="Capacity" className="w-28 rounded-lg border border-black/[.12] px-3 py-1.5 text-sm dark:border-white/[.2] dark:bg-black dark:text-zinc-50" />
            <input type="number" value={form.budgetLimit} onChange={(e) => setForm({ ...form, budgetLimit: e.target.value })} placeholder="Budget ₹" className="w-32 rounded-lg border border-black/[.12] px-3 py-1.5 text-sm dark:border-white/[.2] dark:bg-black dark:text-zinc-50" />
          </div>
          <button onClick={create} disabled={busy || !form.title} className="rounded-lg bg-black px-4 py-1.5 text-sm font-medium text-white disabled:opacity-40 dark:bg-white dark:text-black">Create</button>
        </div>
      )}

      <div className="space-y-4">
        {events.length === 0 && <p className="text-sm text-zinc-400">No events yet.</p>}
        {events.map((e) => {
          const overdueTasks = e.tasks.filter((t) => !t.done && t.due && String(t.due) < today).length;
          const daysOut = Math.ceil((new Date(e.date).getTime() - nowMs) / 86400000);
          return (
            <div key={e.id} className="rounded-2xl border border-black/[.08] bg-white p-5 dark:border-white/[.12] dark:bg-black">
              <div className="flex items-center justify-between">
                <div>
                  <span className="font-medium text-black dark:text-zinc-50">{e.title}</span>
                  <span className="ml-3 text-xs text-zinc-400">{e.date}</span>
                  <span className={`ml-2 rounded-full px-2 py-0.5 text-xs ${e.status === "closed" ? "bg-zinc-100 text-zinc-500" : daysOut < 0 ? "bg-rose-100 text-rose-700" : "bg-teal-100 text-teal-700"}`}>
                    {e.status === "closed" ? "closed" : daysOut < 0 ? "past" : daysOut === 0 ? "today" : `in ${daysOut}d`}
                  </span>
                </div>
                {e.status !== "closed" && (
                  <button onClick={() => setClosing(closing === e.id ? null : e.id)} className="text-xs text-zinc-500">Close →</button>
                )}
              </div>

              <div className="mt-3 grid grid-cols-2 gap-4 text-xs text-zinc-500 sm:grid-cols-4">
                <div><span className="text-zinc-400">Registrations</span><br />{e.registrations.length}{e.capacity ? ` / ${e.capacity}` : ""}</div>
                <div><span className="text-zinc-400">Tasks</span><br />{e.tasks.filter((t) => t.done).length} / {e.tasks.length}{overdueTasks > 0 && <span className="text-rose-500"> · {overdueTasks} overdue</span>}</div>
                <div><span className="text-zinc-400">Spent</span><br />₹{e.budget?.spent ?? 0}{e.budget?.limit ? ` / ${e.budget.limit}` : ""}</div>
                <div className="flex items-end">
                  {e.status !== "closed" && !e.registrations.includes(actorId) && (
                    <button onClick={() => run("event.register", { eventId: e.id, attendee: actorId })} disabled={busy} className="rounded-lg border border-teal-700 px-3 py-1 text-teal-700 disabled:opacity-40">Register me</button>
                  )}
                  {e.registrations.includes(actorId) && <span className="text-teal-600">✓ registered</span>}
                </div>
              </div>

              {e.status !== "closed" && (
                <div className="mt-3 border-t border-black/[.06] pt-3 dark:border-white/[.06]">
                  <div className="mb-1 text-xs font-medium uppercase tracking-wide text-zinc-400">Tasks</div>
                  {e.tasks.length > 0 && (
                    <div className="mb-2 space-y-1">
                      {e.tasks.map((t, i) => (
                        <div key={i} className="text-xs text-zinc-600 dark:text-zinc-300">
                          {t.done ? "✓" : "○"} {String(t.text ?? "")} {t.owner ? `· ${t.owner}` : ""} {t.due ? `· due ${String(t.due)}` : ""}
                          {!t.done && t.due != null && String(t.due) < today && <span className="text-rose-500"> · overdue</span>}
                        </div>
                      ))}
                    </div>
                  )}
                  <div className="flex gap-2">
                    <input
                      value={taskText[e.id] ?? ""}
                      onChange={(ev) => setTaskText({ ...taskText, [e.id]: ev.target.value })}
                      placeholder="Add a task"
                      className="flex-1 rounded-lg border border-black/[.12] px-2 py-1 text-xs dark:border-white/[.2] dark:bg-black dark:text-zinc-50"
                    />
                    <button
                      onClick={() => { if (taskText[e.id]?.trim()) { run("event.addTask", { eventId: e.id, text: taskText[e.id].trim() }); setTaskText({ ...taskText, [e.id]: "" }); } }}
                      disabled={busy || !taskText[e.id]?.trim()}
                      className="rounded-lg bg-black px-2 py-1 text-xs font-medium text-white disabled:opacity-40 dark:bg-white dark:text-black"
                    >Add</button>
                  </div>
                </div>
              )}

              {closing === e.id && (
                <div className="mt-3 space-y-2 rounded-lg bg-zinc-50 p-3 dark:bg-zinc-900">
                  <textarea value={closeReport[e.id] ?? ""} onChange={(ev) => setCloseReport({ ...closeReport, [e.id]: ev.target.value })} placeholder="Closing report" rows={2} className="w-full rounded-lg border border-black/[.12] px-2 py-1 text-xs dark:border-white/[.2] dark:bg-black dark:text-zinc-50" />
                  <button
                    onClick={() => { if (closeReport[e.id]?.trim()) { run("event.close", { eventId: e.id, report: closeReport[e.id].trim() }); setClosing(null); } }}
                    disabled={busy || !closeReport[e.id]?.trim()}
                    className="rounded-lg bg-zinc-800 px-3 py-1 text-xs font-medium text-white disabled:opacity-40"
                  >Submit closing report</button>
                </div>
              )}

              {e.report && <div className="mt-3 rounded-lg bg-zinc-50 p-3 text-xs text-zinc-600 dark:bg-zinc-900 dark:text-zinc-300"><span className="font-medium">Closing report:</span> {e.report}</div>}
            </div>
          );
        })}
      </div>
    </div>
  );
}
