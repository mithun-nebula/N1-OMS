"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Icon } from "../ui/icons";
import { inputCls, OpFeedback } from "../ui/kit";
import { useOperation } from "@/components/ops/use-operation";

interface CalendarCell {
  date: string;
  meetings: number;
  events: Array<{ id: string; title: string }>;
}

interface CalendarEntry {
  id: string;
  title: string;
  kind: string;
  date: string;
  from?: string;
  to?: string;
  detail?: string;
  peopleIds: string[];
  people: string[];
  cancelled: boolean;
}

interface UndoableAction {
  message: string;
  activityId: string;
}

/* Category coding shared with the dashboard: meetings mint, events peach. */
const KIND_STYLE: Record<string, { bg: string; edge: string; text: string; pill: string }> = {
  meeting: { bg: "bg-mint", edge: "border-mint-strong", text: "text-mint-strong", pill: "bg-mint text-mint-strong" },
  event: { bg: "bg-peach", edge: "border-peach-strong", text: "text-peach-strong", pill: "bg-peach text-peach-strong" },
};
const KIND_DEFAULT = KIND_STYLE.meeting;


export function CalendarClient({
  year,
  month,
  days,
  firstDow,
  cells,
  entries,
  people,
}: {
  year: number;
  month: number;
  days: string[];
  firstDow: number;
  cells: CalendarCell[];
  entries: CalendarEntry[];
  people: Array<{ id: string; name: string }>;
}) {
  const router = useRouter();
  const op = useOperation();
  const busy = op.busy;
  const today = new Date().toISOString().slice(0, 10);
  const [selectedDate, setSelectedDate] = useState<string | null>(
    cells.some((c) => c.date === today) ? today : null,
  );
  const [editingId, setEditingId] = useState<string | null>(null);
  const [showCreate, setShowCreate] = useState(false);
  const [undo, setUndo] = useState<UndoableAction | null>(null);
  const [undoBusy, setUndoBusy] = useState(false);

  const [createForm, setCreateForm] = useState({
    title: "",
    kind: "meeting",
    date: `${year}-${String(month).padStart(2, "0")}-01`,
    from: "",
    to: "",
    detail: "",
    peopleText: "",
  });

  const [editForm, setEditForm] = useState({ title: "", date: "", from: "", to: "", detail: "" });
  const [addPeopleText, setAddPeopleText] = useState<{ [entryId: string]: string }>({});

  const dayEntries = selectedDate
    ? entries.filter((e) => e.date === selectedDate)
    : [];

  function flashUndo(message: string, activityId: string) {
    setUndo({ message, activityId });
    router.refresh();
  }

  async function runOp(name: string, args: Record<string, unknown>, okMsg: string) {
    const outcome = await op.run(name, args);
    if (outcome.status === "ran") {
      if (outcome.activityEntryId) flashUndo(okMsg, outcome.activityEntryId);
      return true;
    }
    return false;
  }

  async function undoLast() {
    if (!undo) return;
    setUndoBusy(true);
    await fetch(`/api/activity/${undo.activityId}/undo`, { method: "POST" });
    setUndoBusy(false);
    setUndo(null);
    router.refresh();
  }

  async function createEntry() {
    if (!createForm.title || !createForm.date) return;
    const people = createForm.peopleText.trim()
      ? createForm.peopleText.trim()
      : undefined;
    const ok = await runOp(
      "calendar.create",
      {
        title: createForm.title,
        kind: createForm.kind,
        date: createForm.date,
        from: createForm.from || undefined,
        to: createForm.to || undefined,
        detail: createForm.detail || undefined,
        people,
      },
      `Created “${createForm.title}”.`,
    );
    if (ok) {
      setShowCreate(false);
      setCreateForm({ ...createForm, title: "", from: "", to: "", detail: "", peopleText: "" });
    }
  }

  function startEdit(e: CalendarEntry) {
    setEditingId(e.id);
    setEditForm({
      title: e.title,
      date: e.date,
      from: e.from ?? "",
      to: e.to ?? "",
      detail: e.detail ?? "",
    });
  }

  async function saveEdit(entryId: string) {
    const ok = await runOp(
      "calendar.edit",
      {
        entryId,
        title: editForm.title,
        date: editForm.date,
        from: editForm.from || undefined,
        to: editForm.to || undefined,
        detail: editForm.detail || undefined,
      },
      `Edited entry.`,
    );
    if (ok) setEditingId(null);
  }

  async function cancelEntry(e: CalendarEntry) {
    await runOp("calendar.cancel", { entryId: e.id }, `Cancelled “${e.title}”. Everyone was told.`);
  }

  async function addPeople(entryId: string) {
    const text = (addPeopleText[entryId] ?? "").trim();
    if (!text) return;
    const ok = await runOp(
      "calendar.addPeople",
      { entryId, people: text },
      `Added people to the entry.`,
    );
    if (ok) setAddPeopleText({ ...addPeopleText, [entryId]: "" });
  }

  async function removePerson(entryId: string, personId: string) {
    await runOp("calendar.removePeople", { entryId, people: [personId] }, `Removed a person — they were told.`);
  }

  function clashPreview(entry: CalendarEntry, text: string): string[] {
    const lower = text.toLowerCase();
    const picks = people.filter((p) => {
      if (lower.includes("course") && p.id !== "james" && p.id !== "shruti" && p.id !== "ravi" && p.id !== "naveen") return true;
      if (lower.includes(p.name.toLowerCase().split(" ")[0])) return true;
      return false;
    });
    const notes: string[] = [];
    for (const p of picks) {
      const busy = entries.filter(
        (e) =>
          e.id !== entry.id &&
          !e.cancelled &&
          e.date === entry.date &&
          (e.peopleIds.includes(p.id)),
      );
      if (busy.length > 0) {
        notes.push(`${p.name} already has: ${busy.map((b) => b.title).join(", ")}`);
      }
    }
    return notes;
  }

  const selectedDayNum = selectedDate ? Number(selectedDate.slice(8, 10)) : null;
  const selectedWeekday = selectedDate
    ? new Date(`${selectedDate}T00:00:00`).toLocaleDateString(undefined, { weekday: "long" })
    : null;

  return (
    <div className="mx-auto max-w-6xl p-4 sm:p-6">
      <div className="rise mb-4 flex items-center justify-between" style={{ animationDelay: "60ms" }}>
        <div className="flex items-center gap-3 text-[11px] font-medium text-ink-faint">
          <span className="flex items-center gap-1.5">
            <span className="h-2 w-2 rounded-full bg-mint-strong" /> meetings
          </span>
          <span className="flex items-center gap-1.5">
            <span className="h-2 w-2 rounded-full bg-peach-strong" /> events
          </span>
        </div>
        <button
          onClick={() => setShowCreate(!showCreate)}
          className="press rounded-full bg-chrome px-4 py-2 text-xs font-semibold text-chrome-ink transition-colors hover:bg-chrome-card"
        >
          {showCreate ? "Close" : "+ New entry"}
        </button>
      </div>

      {showCreate && (
        <div className="pop-in mb-5 space-y-2.5 rounded-3xl bg-surface p-4 shadow-card">
          <input value={createForm.title} onChange={(e) => setCreateForm({ ...createForm, title: e.target.value })} placeholder="Title" className={`${inputCls} w-full py-2`} />
          <div className="flex flex-wrap gap-2">
            <select value={createForm.kind} onChange={(e) => setCreateForm({ ...createForm, kind: e.target.value })} className={inputCls}>
              <option value="meeting">Meeting</option>
              <option value="event">Event</option>
            </select>
            <input type="date" value={createForm.date} onChange={(e) => setCreateForm({ ...createForm, date: e.target.value })} className={inputCls} />
            <input type="time" value={createForm.from} onChange={(e) => setCreateForm({ ...createForm, from: e.target.value })} className={inputCls} />
            <input type="time" value={createForm.to} onChange={(e) => setCreateForm({ ...createForm, to: e.target.value })} className={inputCls} />
          </div>
          <input value={createForm.detail} onChange={(e) => setCreateForm({ ...createForm, detail: e.target.value })} placeholder="Detail (optional)" className={`${inputCls} w-full`} />
          <input value={createForm.peopleText} onChange={(e) => setCreateForm({ ...createForm, peopleText: e.target.value })} placeholder="People — names or “course team”, “everyone”" className={`${inputCls} w-full`} />
          <button
            onClick={createEntry}
            disabled={busy || !createForm.title}
            className="press rounded-xl bg-accent-strong px-4 py-2 text-xs font-semibold text-white transition-colors hover:bg-accent disabled:opacity-40"
          >
            Create entry
          </button>
        </div>
      )}

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-[1.35fr_1fr]">
        {/* ============ Month grid — circular date cells ============ */}
        <section className="rise rounded-3xl bg-surface p-4 shadow-card sm:p-5" style={{ animationDelay: "120ms" }}>
          <div className="grid grid-cols-7 gap-1">
            {days.map((d) => (
              <div key={d} className="pb-2 text-center text-[10px] font-semibold uppercase tracking-widest text-ink-faint">
                {d}
              </div>
            ))}
            {Array.from({ length: firstDow }).map((_, i) => (
              <div key={`pad-${i}`} />
            ))}
            {cells.map((cell, i) => {
              const day = i + 1;
              const isSel = selectedDate === cell.date;
              const isToday = cell.date === today;
              const hasEvent = cell.events.length > 0;
              return (
                <button
                  key={day}
                  onClick={() => setSelectedDate(isSel ? null : cell.date)}
                  className="press group flex flex-col items-center gap-1 rounded-2xl py-1.5 transition-colors hover:bg-raised"
                >
                  <span
                    className={`grid h-9 w-9 place-items-center rounded-full text-sm font-semibold transition-all duration-200 ${
                      isSel
                        ? "scale-105 bg-chrome text-chrome-ink shadow-card"
                        : isToday
                          ? "border-2 border-accent-strong text-ink"
                          : "text-ink-soft group-hover:text-ink"
                    }`}
                  >
                    {day}
                  </span>
                  <span className="flex h-1.5 items-center gap-0.5">
                    {Array.from({ length: Math.min(cell.meetings, 3) }).map((_, j) => (
                      <span key={j} className="h-1.5 w-1.5 rounded-full bg-mint-strong" />
                    ))}
                    {hasEvent && <span className="h-1.5 w-1.5 rounded-full bg-peach-strong" />}
                  </span>
                </button>
              );
            })}
          </div>
        </section>

        {/* ============ Day panel ============ */}
        <section className="rise rounded-3xl bg-surface p-5 shadow-card" style={{ animationDelay: "180ms" }}>
          {!selectedDate ? (
            <div className="fade-in flex h-full min-h-40 flex-col items-center justify-center gap-2 text-center">
              <span className="grid h-10 w-10 place-items-center rounded-full bg-accent-soft text-accent-strong">
                <Icon name="calendar" className="h-4.5 w-4.5" />
              </span>
              <p className="text-xs text-ink-faint">Pick a day to see its schedule.</p>
            </div>
          ) : (
            <div className="pop-in" key={selectedDate}>
              <div className="flex items-start justify-between">
                <div className="flex items-baseline gap-2.5">
                  <span className="text-4xl font-extrabold tracking-tight text-ink">{selectedDayNum}</span>
                  <div>
                    <div className="text-xs font-semibold uppercase tracking-widest text-ink-faint">{selectedWeekday}</div>
                    <div className="text-[11px] text-ink-soft">
                      {dayEntries.length === 0
                        ? "free day"
                        : `${dayEntries.length} ${dayEntries.length === 1 ? "entry" : "entries"}`}
                    </div>
                  </div>
                </div>
                <button onClick={() => setSelectedDate(null)} className="press text-xs font-medium text-ink-faint hover:text-ink">
                  Close
                </button>
              </div>

              {dayEntries.length === 0 ? (
                <p className="fade-in mt-6 rounded-2xl bg-raised px-4 py-6 text-center text-xs text-ink-faint">
                  Nothing scheduled — the day is yours.
                </p>
              ) : (
                <div className="mt-4 space-y-2.5">
                  {dayEntries.map((e, i) => {
                    const s = KIND_STYLE[e.kind] ?? KIND_DEFAULT;
                    return (
                      <div
                        key={e.id}
                        style={{ animationDelay: `${i * 55}ms` }}
                        className={`rise rounded-2xl border-l-[3px] p-3.5 ${
                          e.cancelled ? "border-line bg-raised opacity-60" : `${s.edge} ${s.bg}`
                        }`}
                      >
                        {editingId === e.id ? (
                          <div className="pop-in space-y-2">
                            <input value={editForm.title} onChange={(ev) => setEditForm({ ...editForm, title: ev.target.value })} className={`${inputCls} w-full bg-surface`} />
                            <div className="flex flex-wrap gap-2">
                              <input type="date" value={editForm.date} onChange={(ev) => setEditForm({ ...editForm, date: ev.target.value })} className={`${inputCls} bg-surface`} />
                              <input type="time" value={editForm.from} onChange={(ev) => setEditForm({ ...editForm, from: ev.target.value })} className={`${inputCls} bg-surface`} />
                              <input type="time" value={editForm.to} onChange={(ev) => setEditForm({ ...editForm, to: ev.target.value })} className={`${inputCls} bg-surface`} />
                            </div>
                            <input value={editForm.detail} onChange={(ev) => setEditForm({ ...editForm, detail: ev.target.value })} placeholder="Detail" className={`${inputCls} w-full bg-surface`} />
                            <div className="flex items-center gap-2 pt-1">
                              <button onClick={() => saveEdit(e.id)} disabled={busy} className="press rounded-lg bg-chrome px-3 py-1.5 text-xs font-semibold text-chrome-ink disabled:opacity-40">
                                Save changes
                              </button>
                              <button onClick={() => setEditingId(null)} className="text-xs font-medium text-ink-faint hover:text-ink">
                                Cancel
                              </button>
                            </div>
                          </div>
                        ) : (
                          <>
                            <div className="flex items-start justify-between gap-2">
                              <div className="min-w-0">
                                <span className="text-[13px] font-semibold text-ink">{e.title}</span>
                                <span className={`ml-2 rounded-full px-2 py-0.5 text-[10px] font-bold ${e.cancelled ? "bg-line text-ink-faint" : s.pill}`}>
                                  {e.cancelled ? "cancelled" : e.kind}
                                </span>
                              </div>
                              {!e.cancelled && (
                                <div className="flex shrink-0 gap-2 text-[11px] font-medium">
                                  <button onClick={() => startEdit(e)} className={`press ${s.text} hover:underline`}>Edit</button>
                                  <button onClick={() => cancelEntry(e)} disabled={busy} className="press text-danger hover:underline">Cancel</button>
                                </div>
                              )}
                            </div>
                            <div className="mt-1 flex items-center gap-1.5 text-[11px] text-ink-soft">
                              {(e.from || e.to) && <Icon name="clock" className="h-3 w-3" />}
                              {e.from && e.from}
                              {e.to && ` → ${e.to}`}
                              {e.detail && <span className="text-ink-faint">· {e.detail}</span>}
                            </div>
                            {e.people.length > 0 && (
                              <div className="mt-2 flex flex-wrap gap-1">
                                {e.peopleIds.map((pid, idx) => (
                                  <span key={pid} className="inline-flex items-center gap-1 rounded-full bg-surface/80 px-2 py-0.5 text-[11px] font-medium text-ink-soft">
                                    {e.people[idx]}
                                    {!e.cancelled && (
                                      <button
                                        onClick={() => removePerson(e.id, pid)}
                                        className="text-ink-faint transition-colors hover:text-danger"
                                        title={`Remove ${e.people[idx]} — they will be told`}
                                      >
                                        ×
                                      </button>
                                    )}
                                  </span>
                                ))}
                              </div>
                            )}
                            {!e.cancelled && (
                              <div className="mt-2.5">
                                <div className="flex items-center gap-2">
                                  <input
                                    value={addPeopleText[e.id] ?? ""}
                                    onChange={(ev) => setAddPeopleText({ ...addPeopleText, [e.id]: ev.target.value })}
                                    placeholder="Add people — names or “course team”"
                                    className="flex-1 rounded-lg border border-line/50 bg-surface/70 px-2 py-1 text-[11px] text-ink outline-none placeholder:text-ink-faint focus:border-accent-strong"
                                  />
                                  <button
                                    onClick={() => addPeople(e.id)}
                                    disabled={busy || !(addPeopleText[e.id] ?? "").trim()}
                                    className="press rounded-lg bg-chrome px-2.5 py-1 text-[11px] font-semibold text-chrome-ink disabled:opacity-40"
                                  >
                                    Add
                                  </button>
                                </div>
                                {(addPeopleText[e.id] ?? "").trim() && clashPreview(e, addPeopleText[e.id]).length > 0 && (
                                  <div className="fade-in mt-1.5 space-y-0.5">
                                    {clashPreview(e, addPeopleText[e.id]).map((n, i) => (
                                      <div key={i} className="text-[11px] font-medium text-peach-strong">⚠ {n}</div>
                                    ))}
                                  </div>
                                )}
                              </div>
                            )}
                          </>
                        )}
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          )}
        </section>
      </div>

      {/* ============ Undo toast ============ */}
      {undo && (
        <div className="sheet-up fixed bottom-20 left-1/2 z-50 flex -translate-x-1/2 items-center gap-3 rounded-2xl bg-chrome px-4 py-3 text-sm text-chrome-ink shadow-lift md:bottom-6">
          <span className="text-[13px]">{undo.message}</span>
          <button
            onClick={undoLast}
            disabled={undoBusy}
            className="press rounded-full bg-accent px-3.5 py-1 text-xs font-bold text-chrome transition-colors hover:bg-accent-strong disabled:opacity-40"
          >
            Undo
          </button>
          <button onClick={() => setUndo(null)} className="text-xs text-chrome-soft transition-colors hover:text-chrome-ink">
            OK
          </button>
        </div>
      )}
      {!undo && (
        <OpFeedback
          error={op.error}
          confirmation={op.confirmation}
          busy={op.busy}
          onConfirm={() => op.confirm()}
          onCancel={op.cancel}
          onDismiss={op.reset}
        />
      )}
    </div>
  );
}
