"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

interface Capture {
  id: string;
  subject: string;
  detail: string;
  from?: string;
  to?: string;
  by: string;
  at: string;
}

export function UtilitiesClient({
  remaining,
  today,
  history,
}: {
  actorId: string;
  remaining: number;
  today: string;
  history: Capture[];
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [form, setForm] = useState({ subject: "", detail: "", from: "", to: "" });
  const [fromFilter, setFromFilter] = useState("");
  const [toFilter, setToFilter] = useState("");

  async function capture() {
    if (!form.subject || !form.detail) return;
    setBusy(true);
    setError(null);
    const res = await fetch("/api/operations", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        start: "form",
        name: "utility.capture",
        args: {
          subject: form.subject,
          detail: form.detail,
          from: form.from || undefined,
          to: form.to || undefined,
        },
      }),
    });
    const data = await res.json();
    setBusy(false);
    const captured = data.result?.response?.captured;
    if (data.status === "ran" && captured === false) {
      setError(data.result.response.reason ?? "Two-questions-per-day limit reached.");
      return;
    }
    if (data.status === "ran") {
      setForm({ subject: "", detail: "", from: "", to: "" });
      router.refresh();
    } else {
      setError(data.detail ?? data.opaqueMessage ?? "Could not capture.");
    }
  }

  const filtered = history.filter((h) => {
    if (fromFilter && h.at.slice(0, 10) < fromFilter) return false;
    if (toFilter && h.at.slice(0, 10) > toFilter) return false;
    return true;
  });

  return (
    <div className="space-y-6 p-6">
      <section className="rounded-2xl border border-black/[.08] bg-white p-5 dark:border-white/[.12] dark:bg-black">
        <div className="mb-3 flex items-center justify-between">
          <h2 className="text-sm font-medium uppercase tracking-wide text-zinc-500">Capture</h2>
          <span className={`rounded-full px-3 py-1 text-xs ${remaining > 0 ? "bg-teal-100 text-teal-700" : "bg-rose-100 text-rose-700"}`}>
            {remaining} of 2 remaining today
          </span>
        </div>
        <div className="space-y-3">
          <input value={form.subject} onChange={(e) => setForm({ ...form, subject: e.target.value })} placeholder="Room / utility (e.g. “Hall 1 AC”)" className="w-full rounded-lg border border-black/[.12] px-3 py-2 text-sm dark:border-white/[.2] dark:bg-black dark:text-zinc-50" />
          <input value={form.detail} onChange={(e) => setForm({ ...form, detail: e.target.value })} placeholder="Detail (e.g. “on, 9 to 6”)" className="w-full rounded-lg border border-black/[.12] px-3 py-2 text-sm dark:border-white/[.2] dark:bg-black dark:text-zinc-50" />
          <div className="flex gap-3">
            <input type="time" value={form.from} onChange={(e) => setForm({ ...form, from: e.target.value })} placeholder="From" className="rounded-lg border border-black/[.12] px-3 py-1.5 text-sm dark:border-white/[.2] dark:bg-black dark:text-zinc-50" />
            <input type="time" value={form.to} onChange={(e) => setForm({ ...form, to: e.target.value })} placeholder="To" className="rounded-lg border border-black/[.12] px-3 py-1.5 text-sm dark:border-white/[.2] dark:bg-black dark:text-zinc-50" />
          </div>
          {error && <p className="text-xs text-rose-600">{error}</p>}
          <button onClick={capture} disabled={busy || !form.subject || !form.detail || remaining === 0} className="rounded-lg bg-teal-700 px-4 py-1.5 text-sm font-medium text-white disabled:opacity-40">
            {remaining === 0 ? "Daily limit reached" : "Record"}
          </button>
        </div>
      </section>

      <section className="rounded-2xl border border-black/[.08] bg-white p-5 dark:border-white/[.12] dark:bg-black">
        <div className="mb-3 flex flex-wrap items-center gap-3">
          <h2 className="text-sm font-medium uppercase tracking-wide text-zinc-500">History</h2>
          <div className="ml-auto flex items-center gap-2 text-xs text-zinc-400">
            <span>from</span>
            <input type="date" value={fromFilter} max={today} onChange={(e) => setFromFilter(e.target.value)} className="rounded border border-black/[.12] px-2 py-1 dark:border-white/[.2] dark:bg-black dark:text-zinc-50" />
            <span>to</span>
            <input type="date" value={toFilter} max={today} onChange={(e) => setToFilter(e.target.value)} className="rounded border border-black/[.12] px-2 py-1 dark:border-white/[.2] dark:bg-black dark:text-zinc-50" />
          </div>
        </div>
        {filtered.length === 0 ? (
          <p className="text-sm text-zinc-400">No captures in this range.</p>
        ) : (
          <div className="space-y-1">
            {filtered.map((h) => (
              <div key={h.id} className="flex items-center justify-between rounded-lg bg-zinc-50 px-3 py-1.5 text-xs dark:bg-zinc-900">
                <span className="text-zinc-600 dark:text-zinc-300"><span className="font-medium">{h.subject}</span> — {h.detail}{h.from && h.to ? ` (${h.from}–${h.to})` : ""}</span>
                <span className="text-zinc-400">{h.by} · {new Date(h.at).toLocaleDateString()}</span>
              </div>
            ))}
          </div>
        )}
      </section>
    </div>
  );
}
