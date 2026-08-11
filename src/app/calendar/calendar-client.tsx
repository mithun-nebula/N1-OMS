"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

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
  const [selectedDate, setSelectedDate] = useState<string | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [showCreate, setShowCreate] = useState(false);
  const [undo, setUndo] = useState<UndoableAction | null>(null);
  const [busy, setBusy] = useState(false);

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
    setBusy(true);
    const res = await fetch("/api/operations", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ start: "form", name, args }),
    });
    const data = await res.json();
    setBusy(false);
    if (data.status === "ran") {
      const id = data.activityEntry?.id as string | undefined;
      if (id) flashUndo(okMsg, id);
      else router.refresh();
      return true;
    }
    return false;
  }

  async function undoLast() {
    if (!undo) return;
    setBusy(true);
    await fetch(`/api/activity/${undo.activityId}/undo`, { method: "POST" });
    setBusy(false);
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

  return (
    <div className="p-6">
      <div className="mb-4">
        <button onClick={() => setShowCreate(!showCreate)} className="rounded-lg bg-teal-700 px-4 py-1.5 text-sm font-medium text-white">
          {showCreate ? "Close" : "+ New entry"}
        </button>
      </div>

      {showCreate && (
        <div className="mb-6 space-y-3 rounded-xl border border-dashed border-black/[.12] p-4 dark:border-white/[.15]">
          <input value={createForm.title} onChange={(e) => setCreateForm({ ...createForm, title: e.target.value })} placeholder="Title" className="w-full rounded-lg border border-black/[.12] px-3 py-2 text-sm dark:border-white/[.2] dark:bg-black dark:text-zinc-50" />
          <div className="flex flex-wrap gap-3">
            <select value={createForm.kind} onChange={(e) => setCreateForm({ ...createForm, kind: e.target.value })} className="rounded-lg border border-black/[.12] px-3 py-1.5 text-sm dark:border-white/[.2] dark:bg-black dark:text-zinc-50">
              <option value="meeting">Meeting</option>
              <option value="event">Event</option>
            </select>
            <input type="date" value={createForm.date} onChange={(e) => setCreateForm({ ...createForm, date: e.target.value })} className="rounded-lg border border-black/[.12] px-3 py-1.5 text-sm dark:border-white/[.2] dark:bg-black dark:text-zinc-50" />
            <input type="time" value={createForm.from} onChange={(e) => setCreateForm({ ...createForm, from: e.target.value })} placeholder="From" className="rounded-lg border border-black/[.12] px-3 py-1.5 text-sm dark:border-white/[.2] dark:bg-black dark:text-zinc-50" />
            <input type="time" value={createForm.to} onChange={(e) => setCreateForm({ ...createForm, to: e.target.value })} placeholder="To" className="rounded-lg border border-black/[.12] px-3 py-1.5 text-sm dark:border-white/[.2] dark:bg-black dark:text-zinc-50" />
          </div>
          <input value={createForm.detail} onChange={(e) => setCreateForm({ ...createForm, detail: e.target.value })} placeholder="Detail (optional)" className="w-full rounded-lg border border-black/[.12] px-3 py-2 text-sm dark:border-white/[.2] dark:bg-black dark:text-zinc-50" />
          <input value={createForm.peopleText} onChange={(e) => setCreateForm({ ...createForm, peopleText: e.target.value })} placeholder="People — names or “course team”, “everyone”" className="w-full rounded-lg border border-black/[.12] px-3 py-2 text-sm dark:border-white/[.2] dark:bg-black dark:text-zinc-50" />
          <button onClick={createEntry} disabled={busy || !createForm.title} className="rounded-lg bg-black px-4 py-1.5 text-sm font-medium text-white disabled:opacity-40 dark:bg-white dark:text-black">Create</button>
        </div>
      )}

      <div className="grid grid-cols-7 gap-1">
        {days.map((d) => (
          <div key={d} className="pb-2 text-center text-xs font-medium uppercase tracking-wide text-zinc-400">
            {d}
          </div>
        ))}
        {Array.from({ length: firstDow }).map((_, i) => (
          <div key={`pad-${i}`} />
        ))}
        {cells.map((cell, i) => {
          const day = i + 1;
          const has = cell.meetings > 0 || cell.events.length > 0;
          const isSel = selectedDate === cell.date;
          return (
            <button
              key={day}
              onClick={() => setSelectedDate(isSel ? null : cell.date)}
              className={`min-h-20 rounded-lg border p-2 text-left transition-colors ${
                isSel
                  ? "border-teal-700 bg-teal-700/5 dark:border-teal-400"
                  : has
                    ? "border-black/[.1] bg-white hover:border-teal-700/40 dark:border-white/[.15] dark:bg-black"
                    : "border-transparent hover:bg-black/[.02] dark:hover:bg-white/[.03]"
              }`}
            >
              <div className="text-xs font-medium text-zinc-400">{day}</div>
              {cell.meetings > 0 && (
                <div className="mt-1 flex gap-0.5">
                  {Array.from({ length: Math.min(cell.meetings, 5) }).map((_, j) => (
                    <div key={j} className="h-1.5 w-1.5 rounded-full bg-teal-500" />
                  ))}
                </div>
              )}
              {cell.events.map((e) => (
                <div key={e.id} className="mt-1 truncate text-xs font-medium text-amber-600">
                  {e.title}
                </div>
              ))}
            </button>
          );
        })}
      </div>

      {selectedDate && (
        <section className="mt-6 rounded-2xl border border-black/[.08] bg-white p-5 dark:border-white/[.12] dark:bg-black">
          <div className="mb-3 flex items-center justify-between">
            <h2 className="text-sm font-medium uppercase tracking-wide text-zinc-500">{selectedDate}</h2>
            <button onClick={() => setSelectedDate(null)} className="text-xs text-zinc-400">Close</button>
          </div>
          {dayEntries.length === 0 ? (
            <p className="text-sm text-zinc-400">Nothing scheduled.</p>
          ) : (
            <div className="space-y-3">
              {dayEntries.map((e) => (
                <div key={e.id} className={`rounded-xl border p-3 ${e.cancelled ? "border-rose-200 bg-rose-50/50 opacity-60 dark:border-rose-900" : "border-black/[.08] dark:border-white/[.1]"}`}>
                  {editingId === e.id ? (
                    <div className="space-y-2">
                      <input value={editForm.title} onChange={(ev) => setEditForm({ ...editForm, title: ev.target.value })} className="w-full rounded-lg border border-black/[.12] px-3 py-1.5 text-sm dark:border-white/[.2] dark:bg-black dark:text-zinc-50" />
                      <div className="flex flex-wrap gap-2">
                        <input type="date" value={editForm.date} onChange={(ev) => setEditForm({ ...editForm, date: ev.target.value })} className="rounded-lg border border-black/[.12] px-2 py-1.5 text-xs dark:border-white/[.2] dark:bg-black dark:text-zinc-50" />
                        <input type="time" value={editForm.from} onChange={(ev) => setEditForm({ ...editForm, from: ev.target.value })} className="rounded-lg border border-black/[.12] px-2 py-1.5 text-xs dark:border-white/[.2] dark:bg-black dark:text-zinc-50" />
                        <input type="time" value={editForm.to} onChange={(ev) => setEditForm({ ...editForm, to: ev.target.value })} className="rounded-lg border border-black/[.12] px-2 py-1.5 text-xs dark:border-white/[.2] dark:bg-black dark:text-zinc-50" />
                      </div>
                      <input value={editForm.detail} onChange={(ev) => setEditForm({ ...editForm, detail: ev.target.value })} placeholder="Detail" className="w-full rounded-lg border border-black/[.12] px-3 py-1.5 text-xs dark:border-white/[.2] dark:bg-black dark:text-zinc-50" />
                      <div className="flex gap-2">
                        <button onClick={() => saveEdit(e.id)} disabled={busy} className="rounded-lg bg-teal-700 px-3 py-1 text-xs font-medium text-white disabled:opacity-40">Save</button>
                        <button onClick={() => setEditingId(null)} className="text-xs text-zinc-500">Cancel</button>
                      </div>
                    </div>
                  ) : (
                    <>
                      <div className="flex items-center justify-between">
                        <div>
                          <span className="font-medium text-black dark:text-zinc-50">{e.title}</span>
                          {e.cancelled && <span className="ml-2 text-xs text-rose-600">cancelled</span>}
                          <span className="ml-2 rounded-full bg-teal-700/10 px-2 py-0.5 text-xs text-teal-700">{e.kind}</span>
                        </div>
                        {!e.cancelled && (
                          <div className="flex gap-2">
                            <button onClick={() => startEdit(e)} className="text-xs text-teal-700 dark:text-teal-400">Edit</button>
                            <button onClick={() => cancelEntry(e)} disabled={busy} className="text-xs text-rose-600">Cancel</button>
                          </div>
                        )}
                      </div>
                      <div className="mt-1 text-xs text-zinc-400">
                        {e.from && `${e.from}`} {e.to && `→ ${e.to}`}
                        {e.detail && <span className="ml-2 text-zinc-500">{e.detail}</span>}
                      </div>
                      {e.people.length > 0 && (
                        <div className="mt-2 flex flex-wrap gap-1">
                          {e.peopleIds.map((pid, idx) => (
                            <span key={pid} className="inline-flex items-center gap-1 rounded-full bg-zinc-100 px-2 py-0.5 text-xs text-zinc-600 dark:bg-zinc-900 dark:text-zinc-300">
                              {e.people[idx]}
                              {!e.cancelled && (
                                <button onClick={() => removePerson(e.id, pid)} className="text-zinc-400 hover:text-rose-600" title={`Remove ${e.people[idx]} — they will be told`}>×</button>
                              )}
                            </span>
                          ))}
                        </div>
                      )}
                      {!e.cancelled && (
                        <div className="mt-2">
                          <div className="flex items-center gap-2">
                            <input
                              value={addPeopleText[e.id] ?? ""}
                              onChange={(ev) => setAddPeopleText({ ...addPeopleText, [e.id]: ev.target.value })}
                              placeholder="Add people — names or “course team”"
                              className="flex-1 rounded-lg border border-black/[.12] px-2 py-1 text-xs dark:border-white/[.2] dark:bg-black dark:text-zinc-50"
                            />
                            <button onClick={() => addPeople(e.id)} disabled={busy || !(addPeopleText[e.id] ?? "").trim()} className="rounded-lg bg-black px-2 py-1 text-xs font-medium text-white disabled:opacity-40 dark:bg-white dark:text-black">Add</button>
                          </div>
                          {(addPeopleText[e.id] ?? "").trim() && clashPreview(e, addPeopleText[e.id]).length > 0 && (
                            <div className="mt-1 space-y-0.5">
                              {clashPreview(e, addPeopleText[e.id]).map((n, i) => (
                                <div key={i} className="text-xs text-amber-600">⚠ {n}</div>
                              ))}
                            </div>
                          )}
                        </div>
                      )}
                    </>
                  )}
                </div>
              ))}
            </div>
          )}
        </section>
      )}

      {undo && (
        <div className="fixed bottom-6 left-1/2 z-50 flex -translate-x-1/2 items-center gap-3 rounded-xl bg-zinc-900 px-4 py-3 text-sm text-white shadow-lg dark:bg-zinc-100 dark:text-black">
          <span>{undo.message}</span>
          <button onClick={undoLast} disabled={busy} className="rounded-lg bg-white px-3 py-1 text-xs font-medium text-zinc-900 disabled:opacity-40 dark:bg-zinc-900 dark:text-white">
            Undo
          </button>
          <button onClick={() => setUndo(null)} className="text-xs opacity-70 hover:opacity-100">OK</button>
        </div>
      )}
    </div>
  );
}
