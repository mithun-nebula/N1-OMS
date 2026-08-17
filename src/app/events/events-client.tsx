"use client";

import { useState } from "react";
import { Icon } from "../ui/icons";
import { AccentButton, AvatarStack, Bar, ChromeButton, Empty, inputCls, OpFeedback } from "../ui/kit";
import { useOperation } from "@/components/ops/use-operation";

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
  const op = useOperation();
  const busy = op.busy;
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState({ title: "", date: "", capacity: "", budgetLimit: "" });
  const [taskText, setTaskText] = useState<{ [id: string]: string }>({});
  const [closeReport, setCloseReport] = useState<{ [id: string]: string }>({});
  const [closing, setClosing] = useState<string | null>(null);
  const today = new Date().toISOString().slice(0, 10);
  const nowMs = new Date().getTime();

  async function run(name: string, args: Record<string, unknown>) {
    await op.run(name, args);
  }

  async function create() {
    if (!form.title || !form.date) return;
    const outcome = await op.run("event.create", {
      title: form.title,
      date: form.date,
      capacity: form.capacity ? Number(form.capacity) : undefined,
      budgetLimit: form.budgetLimit ? Number(form.budgetLimit) : undefined,
    });
    if (outcome.status === "ran") {
      setShowForm(false);
      setForm({ title: "", date: "", capacity: "", budgetLimit: "" });
    }
  }

  return (
    <div className="mx-auto max-w-4xl space-y-5 p-4 sm:p-6">
      <div className="rise flex items-center justify-between" style={{ animationDelay: "60ms" }}>
        <p className="text-[11px] font-medium text-ink-faint">
          {events.length} event{events.length === 1 ? "" : "s"}
        </p>
        <ChromeButton onClick={() => setShowForm(!showForm)}>
          {showForm ? "Close" : "+ New event"}
        </ChromeButton>
      </div>

      {showForm && (
        <div className="pop-in space-y-3 rounded-3xl bg-surface p-4 shadow-card">
          <input
            value={form.title}
            onChange={(e) => setForm({ ...form, title: e.target.value })}
            placeholder="Event title"
            className={`${inputCls} w-full py-2`}
          />
          <div className="flex flex-wrap gap-2">
            <input type="date" value={form.date} onChange={(e) => setForm({ ...form, date: e.target.value })} className={inputCls} />
            <input type="number" value={form.capacity} onChange={(e) => setForm({ ...form, capacity: e.target.value })} placeholder="Capacity" className={`${inputCls} w-28`} />
            <input type="number" value={form.budgetLimit} onChange={(e) => setForm({ ...form, budgetLimit: e.target.value })} placeholder="Budget ₹" className={`${inputCls} w-32`} />
          </div>
          <AccentButton onClick={create} disabled={busy || !form.title}>
            {busy ? "Creating…" : "Create"}
          </AccentButton>
        </div>
      )}

      {events.length === 0 && (
        <Empty icon="calendar" text="No events yet — plan the first one." />
      )}
      <div className="space-y-3">
        {events.map((e, i) => {
          const overdueTasks = e.tasks.filter((t) => !t.done && t.due && String(t.due) < today).length;
          const daysOut = Math.ceil((new Date(e.date).getTime() - nowMs) / 86400000);
          const doneTasks = e.tasks.filter((t) => t.done).length;
          const statusPill =
            e.status === "closed"
              ? { cls: "bg-raised text-ink-faint", text: "closed" }
              : daysOut < 0
                ? { cls: "bg-rose text-rose-strong", text: "past" }
                : daysOut === 0
                  ? { cls: "bg-peach text-peach-strong", text: "today" }
                  : { cls: "bg-mint text-mint-strong", text: `in ${daysOut}d` };
          return (
            <div
              key={e.id}
              className="rise lift rounded-3xl bg-surface p-5 shadow-card"
              style={{ animationDelay: `${120 + i * 50}ms` }}
            >
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="min-w-0">
                  <span className="text-[14px] font-semibold text-ink">{e.title}</span>
                  <span className="ml-2 inline-flex items-center gap-1 text-[11px] text-ink-soft">
                    <Icon name="calendar" className="h-3 w-3" />
                    {e.date}
                  </span>
                  <span className={`ml-2 rounded-full px-2 py-0.5 text-[10px] font-bold ${statusPill.cls}`}>
                    {statusPill.text}
                  </span>
                </div>
                {e.status !== "closed" && (
                  <button
                    onClick={() => setClosing(closing === e.id ? null : e.id)}
                    className="press text-[11px] font-medium text-accent-strong hover:underline"
                  >
                    Close →
                  </button>
                )}
              </div>

              <div className="mt-3 grid grid-cols-2 gap-2.5 sm:grid-cols-4">
                <div className="rounded-xl bg-raised px-3 py-2">
                  <div className="text-[10px] font-semibold uppercase tracking-widest text-ink-faint">Registrations</div>
                  <div className="mt-0.5 flex items-center gap-2 text-[13px] font-semibold text-ink">
                    {e.registrations.length}{e.capacity ? ` / ${e.capacity}` : ""}
                    {e.registrations.length > 0 && <AvatarStack names={e.registrations} max={3} />}
                  </div>
                </div>
                <div className="rounded-xl bg-raised px-3 py-2">
                  <div className="text-[10px] font-semibold uppercase tracking-widest text-ink-faint">Tasks</div>
                  <div className="mt-0.5 text-[13px] font-semibold text-ink">
                    {doneTasks} / {e.tasks.length}
                    {overdueTasks > 0 && (
                      <span className="ml-1.5 text-[11px] font-semibold text-danger">· {overdueTasks} overdue</span>
                    )}
                  </div>
                  {e.tasks.length > 0 && (
                    <div className="mt-1.5 flex">
                      <Bar pct={(doneTasks / e.tasks.length) * 100} tone="bg-mint-strong" />
                    </div>
                  )}
                </div>
                <div className="rounded-xl bg-raised px-3 py-2">
                  <div className="text-[10px] font-semibold uppercase tracking-widest text-ink-faint">Spent</div>
                  <div className="mt-0.5 text-[13px] font-semibold text-ink">
                    ₹{e.budget?.spent ?? 0}{e.budget?.limit ? ` / ${e.budget.limit}` : ""}
                  </div>
                  {e.budget?.limit ? (
                    <div className="mt-1.5 flex">
                      <Bar pct={((e.budget?.spent ?? 0) / e.budget.limit) * 100} />
                    </div>
                  ) : null}
                </div>
                <div className="flex items-center rounded-xl bg-raised px-3 py-2">
                  {e.status !== "closed" && !e.registrations.includes(actorId) && (
                    <button
                      onClick={() => run("event.register", { eventId: e.id, attendee: actorId })}
                      disabled={busy}
                      className="press rounded-full bg-accent-soft px-3 py-1.5 text-xs font-semibold text-accent-strong disabled:opacity-40"
                    >
                      Register me
                    </button>
                  )}
                  {e.registrations.includes(actorId) && (
                    <span className="rounded-full bg-mint px-2.5 py-0.5 text-[11px] font-semibold text-mint-strong">
                      ✓ registered
                    </span>
                  )}
                </div>
              </div>

              {e.status !== "closed" && (
                <div className="mt-3 border-t border-line pt-3">
                  <div className="mb-1.5 text-[10px] font-semibold uppercase tracking-widest text-ink-faint">Tasks</div>
                  {e.tasks.length > 0 && (
                    <div className="mb-2 space-y-1">
                      {e.tasks.map((t, ti) => (
                        <div key={ti} className="flex items-center gap-1.5 text-xs text-ink-soft">
                          <span className={t.done ? "text-mint-strong" : "text-ink-faint"}>
                            {t.done ? <Icon name="check" className="h-3 w-3" /> : "○"}
                          </span>
                          <span className={t.done ? "line-through opacity-60" : ""}>
                            {String(t.text ?? "")} {t.owner ? `· ${t.owner}` : ""} {t.due ? `· due ${String(t.due)}` : ""}
                          </span>
                          {!t.done && t.due != null && String(t.due) < today && (
                            <span className="font-semibold text-danger">· overdue</span>
                          )}
                        </div>
                      ))}
                    </div>
                  )}
                  <div className="flex gap-2">
                    <input
                      value={taskText[e.id] ?? ""}
                      onChange={(ev) => setTaskText({ ...taskText, [e.id]: ev.target.value })}
                      placeholder="Add a task"
                      className={`${inputCls} flex-1`}
                    />
                    <button
                      onClick={() => { if (taskText[e.id]?.trim()) { run("event.addTask", { eventId: e.id, text: taskText[e.id].trim() }); setTaskText({ ...taskText, [e.id]: "" }); } }}
                      disabled={busy || !taskText[e.id]?.trim()}
                      className="press rounded-lg bg-chrome px-2.5 py-1 text-[11px] font-semibold text-chrome-ink disabled:opacity-40"
                    >
                      Add
                    </button>
                  </div>
                </div>
              )}

              {closing === e.id && (
                <div className="pop-in mt-3 space-y-2 rounded-2xl bg-raised p-3">
                  <textarea
                    value={closeReport[e.id] ?? ""}
                    onChange={(ev) => setCloseReport({ ...closeReport, [e.id]: ev.target.value })}
                    placeholder="Closing report"
                    rows={2}
                    className={`${inputCls} w-full py-2`}
                  />
                  <AccentButton
                    onClick={() => { if (closeReport[e.id]?.trim()) { run("event.close", { eventId: e.id, report: closeReport[e.id].trim() }); setClosing(null); } }}
                    disabled={busy || !closeReport[e.id]?.trim()}
                  >
                    Submit closing report
                  </AccentButton>
                </div>
              )}

              {e.report && (
                <div className="mt-3 rounded-2xl bg-raised p-3 text-xs text-ink-soft">
                  <span className="font-semibold text-ink">Closing report:</span> {e.report}
                </div>
              )}
            </div>
          );
        })}
      </div>

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
