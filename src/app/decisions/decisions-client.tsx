"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

interface Decision {
  id: string;
  title: string;
  decision: string;
  reason: string;
  decidedBy: string;
  decidedAt: string;
  linkedRecords: Array<{ nodeType: string; nodeId: string }>;
}

export function DecisionsClient({
  decisions,
  canRecord,
}: {
  decisions: Decision[];
  canRecord: boolean;
}) {
  const router = useRouter();
  const [query, setQuery] = useState("");
  const [showForm, setShowForm] = useState(false);
  const [busy, setBusy] = useState(false);
  const [form, setForm] = useState({ title: "", decision: "", reason: "" });

  const filtered = query.trim()
    ? decisions.filter((d) => {
        const q = query.toLowerCase();
        return d.title.toLowerCase().includes(q) || d.decision.toLowerCase().includes(q) || d.reason.toLowerCase().includes(q);
      })
    : decisions;

  async function record() {
    if (!form.title || !form.decision || !form.reason) return;
    setBusy(true);
    const res = await fetch("/api/operations", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ start: "form", name: "orgMemory.record", args: { title: form.title, decision: form.decision, reason: form.reason } }),
    });
    const data = await res.json();
    setBusy(false);
    if (data.status === "ran") {
      setShowForm(false);
      setForm({ title: "", decision: "", reason: "" });
      router.refresh();
    }
  }

  return (
    <div className="space-y-6 p-6">
      <div className="flex items-center gap-3">
        <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search decisions…" className="flex-1 rounded-lg border border-black/[.12] px-3 py-1.5 text-sm dark:border-white/[.2] dark:bg-black dark:text-zinc-50" />
        {canRecord && (
          <button onClick={() => setShowForm(!showForm)} className="rounded-lg bg-teal-700 px-4 py-1.5 text-sm font-medium text-white">
            {showForm ? "Close" : "+ Record decision"}
          </button>
        )}
      </div>

      {showForm && (
        <div className="space-y-3 rounded-xl border border-dashed border-black/[.12] p-4 dark:border-white/[.15]">
          <input value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} placeholder="Title" className="w-full rounded-lg border border-black/[.12] px-3 py-2 text-sm dark:border-white/[.2] dark:bg-black dark:text-zinc-50" />
          <textarea value={form.decision} onChange={(e) => setForm({ ...form, decision: e.target.value })} placeholder="What was decided" rows={2} className="w-full rounded-lg border border-black/[.12] px-3 py-2 text-sm dark:border-white/[.2] dark:bg-black dark:text-zinc-50" />
          <textarea value={form.reason} onChange={(e) => setForm({ ...form, reason: e.target.value })} placeholder="The reason at the time" rows={2} className="w-full rounded-lg border border-black/[.12] px-3 py-2 text-sm dark:border-white/[.2] dark:bg-black dark:text-zinc-50" />
          <button onClick={record} disabled={busy || !form.title || !form.decision || !form.reason} className="rounded-lg bg-black px-4 py-1.5 text-sm font-medium text-white disabled:opacity-40 dark:bg-white dark:text-black">Record</button>
        </div>
      )}

      <div className="space-y-3">
        {filtered.length === 0 && <p className="text-sm text-zinc-400">No decisions recorded.</p>}
        {filtered.map((d) => (
          <div key={d.id} className="rounded-2xl border border-black/[.08] bg-white p-5 dark:border-white/[.12] dark:bg-black">
            <div className="font-medium text-black dark:text-zinc-50">{d.title}</div>
            <div className="mt-1 text-sm text-zinc-600 dark:text-zinc-300">{d.decision}</div>
            <div className="mt-1 text-xs text-zinc-400">Reason: {d.reason}</div>
            <div className="mt-1 text-xs text-zinc-400">
              decided by {d.decidedBy} · {new Date(d.decidedAt).toLocaleDateString()}
              {d.linkedRecords.length > 0 && ` · links: ${d.linkedRecords.map((l) => `${l.nodeType}:${l.nodeId}`).join(", ")}`}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
