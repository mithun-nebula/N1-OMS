"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

interface Meeting {
  id: string;
  title: string;
  kind: string;
  from?: string;
  to?: string;
  attendees: string[];
  link?: string;
}

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

  return (
    <div className="p-6">
      <div className="mb-4">
        <button onClick={() => setShowForm(!showForm)} className="rounded-lg bg-teal-700 px-4 py-1.5 text-sm font-medium text-white">
          {showForm ? "Cancel" : "+ Schedule meeting"}
        </button>
      </div>

      {showForm && (
        <div className="mb-6 space-y-3 rounded-xl border border-dashed border-black/[.12] p-4 dark:border-white/[.15]">
          <input value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} placeholder="Meeting title" className="w-full rounded-lg border border-black/[.12] px-3 py-2 text-sm dark:border-white/[.2] dark:bg-black dark:text-zinc-50" />
          <div className="flex gap-3">
            <select value={form.kind} onChange={(e) => setForm({ ...form, kind: e.target.value })} className="rounded-lg border border-black/[.12] px-3 py-1.5 text-sm dark:border-white/[.2] dark:bg-black dark:text-zinc-50">
              <option value="online">Online</option>
              <option value="in-person">In person</option>
              <option value="both">Both</option>
            </select>
            <input type="datetime-local" value={form.from} onChange={(e) => setForm({ ...form, from: e.target.value })} className="rounded-lg border border-black/[.12] px-3 py-1.5 text-sm dark:border-white/[.2] dark:bg-black dark:text-zinc-50" />
            <input type="datetime-local" value={form.to} onChange={(e) => setForm({ ...form, to: e.target.value })} className="rounded-lg border border-black/[.12] px-3 py-1.5 text-sm dark:border-white/[.2] dark:bg-black dark:text-zinc-50" />
          </div>
          <div className="flex flex-wrap gap-1">
            {people.map((p) => (
              <button key={p.id} onClick={() => toggleAttendee(p.id)} className={`rounded-full px-3 py-1 text-xs ${form.attendees.includes(p.id) ? "bg-teal-700 text-white" : "bg-zinc-100 text-zinc-500 dark:bg-zinc-900"}`}>
                {p.name}
              </button>
            ))}
          </div>
          <button onClick={createMeeting} disabled={busy || !form.title} className="rounded-lg bg-black px-4 py-1.5 text-sm font-medium text-white disabled:opacity-40 dark:bg-white dark:text-black">Create</button>
        </div>
      )}

      <div className="space-y-2">
        {meetings.length === 0 && <p className="text-sm text-zinc-400">No meetings scheduled.</p>}
        {meetings.map((m) => (
          <div key={m.id} className="rounded-xl border border-black/[.08] bg-white p-4 dark:border-white/[.12] dark:bg-black">
            <div className="flex items-center justify-between">
              <span className="font-medium text-black dark:text-zinc-50">{m.title}</span>
              <span className="rounded-full bg-teal-700/10 px-2 py-0.5 text-xs text-teal-700">{m.kind}</span>
            </div>
            <div className="mt-1 text-xs text-zinc-400">
              {m.from && new Date(m.from).toLocaleString()} {m.to && `→ ${new Date(m.to).toLocaleTimeString()}`}
            </div>
            {m.attendees.length > 0 && (
              <div className="mt-2 text-xs text-zinc-500">
                {m.attendees.join(", ")}
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}
