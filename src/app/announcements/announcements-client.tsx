"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

interface Announcement {
  id: string;
  message: string;
  by: string;
  at: string;
  policy: boolean;
  audience: string[];
  acknowledged: string[];
  outstanding: number;
  ackedByMe: boolean;
  inAudience: boolean;
}

export function AnnouncementsClient({
  announcements,
  canSend,
  people,
}: {
  actorId: string;
  announcements: Announcement[];
  canSend: boolean;
  people: string[];
}) {
  const router = useRouter();
  const [showForm, setShowForm] = useState(false);
  const [busy, setBusy] = useState(false);
  const [form, setForm] = useState({ message: "", policy: false, audience: [] as string[] });

  function toggleAudee(id: string) {
    setForm((f) => ({
      ...f,
      audience: f.audience.includes(id) ? f.audience.filter((a) => a !== id) : [...f.audience, id],
    }));
  }

  async function send() {
    if (!form.message || form.audience.length === 0) return;
    setBusy(true);
    const res = await fetch("/api/operations", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        start: "form",
        name: "announcement.send",
        args: { message: form.message, to: form.audience, policy: form.policy || undefined },
      }),
    });
    const data = await res.json();
    setBusy(false);
    if (data.status === "ran") {
      setShowForm(false);
      setForm({ message: "", policy: false, audience: [] });
      router.refresh();
    }
  }

  async function ack(id: string) {
    setBusy(true);
    await fetch("/api/operations", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ start: "form", name: "announcement.ack", args: { announcementId: id } }),
    });
    setBusy(false);
    router.refresh();
  }

  return (
    <div className="space-y-6 p-6">
      {canSend && (
        <section className="rounded-2xl border border-black/[.08] bg-white p-5 dark:border-white/[.12] dark:bg-black">
          <div className="mb-3 flex items-center justify-between">
            <h2 className="text-sm font-medium uppercase tracking-wide text-zinc-500">Send</h2>
            <button onClick={() => setShowForm(!showForm)} className="rounded-lg bg-teal-700 px-4 py-1.5 text-sm font-medium text-white">
              {showForm ? "Close" : "+ New announcement"}
            </button>
          </div>
          {showForm && (
            <div className="space-y-3">
              <textarea value={form.message} onChange={(e) => setForm({ ...form, message: e.target.value })} placeholder="Message" rows={3} className="w-full rounded-lg border border-black/[.12] px-3 py-2 text-sm dark:border-white/[.2] dark:bg-black dark:text-zinc-50" />
              <label className="flex items-center gap-2 text-sm text-zinc-500">
                <input type="checkbox" checked={form.policy} onChange={(e) => setForm({ ...form, policy: e.target.checked })} className="accent-teal-700" />
                Mark as a policy
              </label>
              <div>
                <div className="mb-1 text-xs text-zinc-400">To</div>
                <div className="flex flex-wrap gap-1">
                  <button onClick={() => setForm({ ...form, audience: [...people] })} className="rounded-full bg-zinc-100 px-3 py-1 text-xs text-zinc-600 dark:bg-zinc-900">Everyone</button>
                  {people.map((id) => (
                    <button key={id} onClick={() => toggleAudee(id)} className={`rounded-full px-3 py-1 text-xs ${form.audience.includes(id) ? "bg-teal-700 text-white" : "bg-zinc-100 text-zinc-500 dark:bg-zinc-900"}`}>
                      {id}
                    </button>
                  ))}
                </div>
              </div>
              <button onClick={send} disabled={busy || !form.message || form.audience.length === 0} className="rounded-lg bg-black px-4 py-1.5 text-sm font-medium text-white disabled:opacity-40 dark:bg-white dark:text-black">Send</button>
            </div>
          )}
        </section>
      )}

      <section className="space-y-3">
        {announcements.length === 0 && <p className="text-sm text-zinc-400">No announcements yet.</p>}
        {announcements.map((a) => (
          <div key={a.id} className={`rounded-2xl border p-5 ${a.policy ? "border-amber-300 bg-amber-50/50 dark:border-amber-900 dark:bg-amber-950/30" : "border-black/[.08] bg-white dark:border-white/[.12] dark:bg-black"}`}>
            <div className="flex items-start justify-between gap-3">
              <div>
                {a.policy && <span className="mr-2 rounded-full bg-amber-200 px-2 py-0.5 text-xs font-medium text-amber-800">POLICY</span>}
                <span className="text-sm text-black dark:text-zinc-50">{a.message}</span>
              </div>
              {a.inAudience && !a.ackedByMe && (
                <button onClick={() => ack(a.id)} disabled={busy} className="shrink-0 rounded-lg bg-teal-700 px-3 py-1 text-xs font-medium text-white disabled:opacity-40">
                  Acknowledge
                </button>
              )}
              {a.ackedByMe && <span className="shrink-0 text-xs text-teal-600">✓ acknowledged</span>}
            </div>
            <div className="mt-2 text-xs text-zinc-400">
              by {a.by} · {new Date(a.at).toLocaleString()} · {a.outstanding} of {a.audience.length} outstanding
            </div>
          </div>
        ))}
      </section>
    </div>
  );
}
