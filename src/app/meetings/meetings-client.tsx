"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Icon } from "../ui/icons";
import { AccentButton, AvatarStack, ChromeButton, Empty, inputCls } from "../ui/kit";

interface Meeting {
  id: string;
  title: string;
  kind: string;
  from?: string;
  to?: string;
  attendees: string[];
  link?: string;
}

/* Meeting kind owns a pastel, consistent with the dashboard agenda. */
const KIND_STYLE: Record<string, { edge: string; pill: string }> = {
  online: { edge: "border-mint-strong", pill: "bg-mint text-mint-strong" },
  "in-person": { edge: "border-peach-strong", pill: "bg-peach text-peach-strong" },
  both: { edge: "border-lilac-strong", pill: "bg-lilac text-lilac-strong" },
};
const KIND_DEFAULT = KIND_STYLE.online;

export function MeetingsClient({
  meetings,
  people,
}: {
  meetings: Meeting[];
  rooms: Array<{ id: string; name: string }>;
  people: Array<{ id: string; name: string }>;
}) {
  const router = useRouter();
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState({
    title: "",
    kind: "online",
    from: "",
    to: "",
    attendees: [] as string[],
  });
  const [busy, setBusy] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editForm, setEditForm] = useState({ title: "", from: "", to: "" });
  const [addingTo, setAddingTo] = useState<string | null>(null);
  const [addAttendee, setAddAttendee] = useState("");

  function toggleAttendee(id: string) {
    setForm((f) => ({
      ...f,
      attendees: f.attendees.includes(id)
        ? f.attendees.filter((a) => a !== id)
        : [...f.attendees, id],
    }));
  }

  async function createMeeting() {
    if (!form.title || !form.from || !form.to) return;
    setBusy(true);
    const res = await fetch("/api/operations", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        start: "form",
        name: "meeting.create",
        args: {
          title: form.title,
          kind: form.kind,
          from: new Date(form.from).toISOString(),
          to: new Date(form.to).toISOString(),
          attendees: form.attendees,
        },
      }),
    });
    setBusy(false);
    if ((await res.json()).status === "ran") {
      setShowForm(false);
      setForm({ title: "", kind: "online", from: "", to: "", attendees: [] });
      router.refresh();
    }
  }

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

  function startEdit(m: Meeting) {
    setEditingId(m.id);
    const fromLocal = m.from ? new Date(m.from).toISOString().slice(0, 16) : "";
    const toLocal = m.to ? new Date(m.to).toISOString().slice(0, 16) : "";
    setEditForm({ title: m.title, from: fromLocal, to: toLocal });
  }

  async function saveEdit() {
    if (!editingId) return;
    await run("meeting.update", {
      meetingId: editingId,
      title: editForm.title,
      from: editForm.from ? new Date(editForm.from).toISOString() : undefined,
      to: editForm.to ? new Date(editForm.to).toISOString() : undefined,
    });
    setEditingId(null);
  }

  return (
    <div className="mx-auto max-w-4xl p-4 sm:p-6">
      <div className="rise mb-4 flex items-center justify-between" style={{ animationDelay: "60ms" }}>
        <div className="flex items-center gap-3 text-[11px] font-medium text-ink-faint">
          <span className="flex items-center gap-1.5"><span className="h-2 w-2 rounded-full bg-mint-strong" /> online</span>
          <span className="flex items-center gap-1.5"><span className="h-2 w-2 rounded-full bg-peach-strong" /> in person</span>
          <span className="flex items-center gap-1.5"><span className="h-2 w-2 rounded-full bg-lilac-strong" /> both</span>
        </div>
        <ChromeButton onClick={() => setShowForm(!showForm)}>
          {showForm ? "Cancel" : "+ Schedule meeting"}
        </ChromeButton>
      </div>

      {showForm && (
        <div className="pop-in mb-5 space-y-3 rounded-3xl bg-surface p-4 shadow-card">
          <input
            value={form.title}
            onChange={(e) => setForm({ ...form, title: e.target.value })}
            placeholder="Meeting title"
            className={`${inputCls} w-full py-2`}
          />
          <div className="flex flex-wrap gap-2">
            <select value={form.kind} onChange={(e) => setForm({ ...form, kind: e.target.value })} className={inputCls}>
              <option value="online">Online</option>
              <option value="in-person">In person</option>
              <option value="both">Both</option>
            </select>
            <input type="datetime-local" value={form.from} onChange={(e) => setForm({ ...form, from: e.target.value })} className={inputCls} />
            <input type="datetime-local" value={form.to} onChange={(e) => setForm({ ...form, to: e.target.value })} className={inputCls} />
          </div>
          <div className="flex flex-wrap gap-1.5">
            {people.map((p) => (
              <button
                key={p.id}
                onClick={() => toggleAttendee(p.id)}
                className={`press rounded-full px-3 py-1 text-xs font-medium transition-colors ${
                  form.attendees.includes(p.id)
                    ? "bg-chrome text-chrome-ink"
                    : "bg-raised text-ink-soft hover:text-ink"
                }`}
              >
                {p.name}
              </button>
            ))}
          </div>
          <AccentButton onClick={createMeeting} disabled={busy || !form.title}>
            Create meeting
          </AccentButton>
        </div>
      )}

      {meetings.length === 0 ? (
        <Empty icon="meetings" text="No meetings scheduled — the calendar is clear." />
      ) : (
        <div className="space-y-2.5">
          {meetings.map((m, i) => {
            const s = KIND_STYLE[m.kind] ?? KIND_DEFAULT;
            return (
              <div
                key={m.id}
                className={`rise lift rounded-2xl border-l-[3px] bg-surface p-4 shadow-card ${s.edge}`}
                style={{ animationDelay: `${120 + i * 50}ms` }}
              >
                {editingId === m.id ? (
                  <div className="pop-in space-y-2">
                    <input value={editForm.title} onChange={(e) => setEditForm({ ...editForm, title: e.target.value })} className={`${inputCls} w-full`} />
                    <div className="flex flex-wrap gap-2">
                      <input type="datetime-local" value={editForm.from} onChange={(e) => setEditForm({ ...editForm, from: e.target.value })} className={inputCls} />
                      <input type="datetime-local" value={editForm.to} onChange={(e) => setEditForm({ ...editForm, to: e.target.value })} className={inputCls} />
                    </div>
                    <div className="flex items-center gap-2 pt-1">
                      <button onClick={saveEdit} disabled={busy} className="press rounded-lg bg-chrome px-3 py-1.5 text-xs font-semibold text-chrome-ink disabled:opacity-40">
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
                        <span className="text-[14px] font-semibold text-ink">{m.title}</span>
                        <span className={`ml-2 rounded-full px-2 py-0.5 text-[10px] font-bold ${s.pill}`}>{m.kind}</span>
                      </div>
                      <div className="flex shrink-0 gap-2.5 text-[11px] font-medium">
                        <button onClick={() => startEdit(m)} className="press text-accent-strong hover:underline">Edit</button>
                        <button onClick={() => run("meeting.cancel", { meetingId: m.id })} disabled={busy} className="press text-danger hover:underline">
                          Cancel meeting
                        </button>
                      </div>
                    </div>
                    <div className="mt-1 flex items-center gap-1.5 text-[11px] text-ink-soft">
                      <Icon name="clock" className="h-3 w-3" />
                      {m.from && new Date(m.from).toLocaleString([], { dateStyle: "medium", timeStyle: "short" })}
                      {m.to && ` → ${new Date(m.to).toLocaleTimeString([], { timeStyle: "short" })}`}
                      {m.link && <span className="text-mint-strong">· link preserved across edits</span>}
                    </div>
                    <div className="mt-2.5 flex flex-wrap items-center justify-between gap-2">
                      {m.attendees.length > 0 ? (
                        <div className="flex items-center gap-2">
                          <AvatarStack names={m.attendees} />
                          <span className="text-[11px] text-ink-faint">
                            {m.attendees.length} attending
                          </span>
                        </div>
                      ) : (
                        <span className="text-[11px] text-ink-faint">No attendees yet</span>
                      )}
                      {addingTo === m.id ? (
                        <div className="pop-in flex items-center gap-2">
                          <select value={addAttendee} onChange={(e) => setAddAttendee(e.target.value)} className={inputCls}>
                            <option value="">Select…</option>
                            {people.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
                          </select>
                          <button
                            onClick={() => { if (addAttendee) { run("meeting.addAttendee", { meetingId: m.id, attendee: addAttendee }); setAddingTo(null); setAddAttendee(""); } }}
                            disabled={busy || !addAttendee}
                            className="press rounded-lg bg-chrome px-2.5 py-1 text-[11px] font-semibold text-chrome-ink disabled:opacity-40"
                          >
                            Add
                          </button>
                          <button onClick={() => setAddingTo(null)} className="text-[11px] font-medium text-ink-faint hover:text-ink">
                            Close
                          </button>
                        </div>
                      ) : (
                        <button onClick={() => setAddingTo(m.id)} className="press text-[11px] font-medium text-accent-strong hover:underline">
                          + Add attendee (auto-sends link)
                        </button>
                      )}
                    </div>
                  </>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
