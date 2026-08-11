"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

interface OnboardingStep {
  id: string;
  title: string;
  owner: string;
  ownerName: string;
  dueAt: string;
  status: string;
}

interface Onboarding {
  id: string;
  employeeId: string;
  employeeName: string;
  status: string;
  steps: OnboardingStep[];
}

interface Handover {
  id: string;
  type: string;
  title: string;
  from: string;
  to: string;
  toName: string;
  status: string;
}

interface Offboarding {
  id: string;
  employeeId: string;
  employeeName: string;
  separationDate: string;
  status: string;
  separated: boolean;
  handovers: Handover[];
}

export function HrClient({
  onboardings,
  offboardings,
  overdue,
  people,
}: {
  onboardings: Onboarding[];
  offboardings: Offboarding[];
  overdue: Array<{ employeeId: string; employeeName: string; title: string; owner: string }>;
  people: Array<{ id: string; name: string }>;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [joinFor, setJoinFor] = useState("");
  const [leaveFor, setLeaveFor] = useState("");
  const [sepDate, setSepDate] = useState("");

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

  return (
    <div className="space-y-6 p-6">
      {overdue.length > 0 && (
        <section className="rounded-2xl border border-rose-300 bg-rose-50 p-5 dark:border-rose-900 dark:bg-rose-950">
          <h2 className="mb-2 text-sm font-medium uppercase tracking-wide text-rose-700 dark:text-rose-400">Overdue steps — chase these</h2>
          <div className="space-y-1">
            {overdue.map((o, i) => (
              <div key={i} className="text-sm text-rose-800 dark:text-rose-200">{o.employeeName} — “{o.title}” (owner: {o.owner})</div>
            ))}
          </div>
        </section>
      )}

      <section className="rounded-2xl border border-black/[.08] bg-white p-5 dark:border-white/[.12] dark:bg-black">
        <h2 className="mb-3 text-sm font-medium uppercase tracking-wide text-zinc-500">Start onboarding</h2>
        <div className="flex flex-wrap items-end gap-3">
          <select value={joinFor} onChange={(e) => setJoinFor(e.target.value)} className="rounded-lg border border-black/[.12] px-3 py-1.5 text-sm dark:border-white/[.2] dark:bg-black dark:text-zinc-50">
            <option value="">Select employee…</option>
            {people.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
          </select>
          <button onClick={() => { if (joinFor) run("joining.start", { employeeId: joinFor }); setJoinFor(""); }} disabled={busy || !joinFor} className="rounded-lg bg-teal-700 px-4 py-1.5 text-sm font-medium text-white disabled:opacity-40">
            Start onboarding
          </button>
        </div>
      </section>

      <section className="rounded-2xl border border-black/[.08] bg-white p-5 dark:border-white/[.12] dark:bg-black">
        <h2 className="mb-3 text-sm font-medium uppercase tracking-wide text-zinc-500">Onboarding ({onboardings.length})</h2>
        {onboardings.length === 0 ? (
          <p className="text-sm text-zinc-400">No active onboardings.</p>
        ) : (
          <div className="space-y-3">
            {onboardings.map((o) => (
              <div key={o.id} className={`rounded-xl border p-3 ${o.status === "complete" ? "border-teal-200 bg-teal-50/40 dark:border-teal-900" : "border-black/[.08] dark:border-white/[.1]"}`}>
                <div className="mb-2 flex items-center justify-between">
                  <span className="font-medium text-black dark:text-zinc-50">{o.employeeName}</span>
                  <span className={`rounded-full px-2 py-0.5 text-xs ${o.status === "complete" ? "bg-teal-100 text-teal-700" : "bg-amber-100 text-amber-700"}`}>{o.status}</span>
                </div>
                <div className="space-y-1">
                  {o.steps.map((s) => (
                    <div key={s.id} className="flex items-center justify-between text-xs">
                      <span className={s.status === "done" ? "text-zinc-400 line-through" : "text-zinc-600 dark:text-zinc-300"}>
                        {s.status === "done" ? "✓" : "○"} {s.title} <span className="text-zinc-400">(owner: {s.ownerName})</span>
                      </span>
                      {s.status !== "done" && (
                        <button onClick={() => run("joining.completeStep", { employeeId: o.employeeId, stepId: s.id })} disabled={busy} className="text-teal-600 underline disabled:opacity-40">complete</button>
                      )}
                    </div>
                  ))}
                </div>
              </div>
            ))}
          </div>
        )}
      </section>

      <section className="rounded-2xl border border-black/[.08] bg-white p-5 dark:border-white/[.12] dark:bg-black">
        <h2 className="mb-3 text-sm font-medium uppercase tracking-wide text-zinc-500">Start offboarding</h2>
        <div className="flex flex-wrap items-end gap-3">
          <select value={leaveFor} onChange={(e) => setLeaveFor(e.target.value)} className="rounded-lg border border-black/[.12] px-3 py-1.5 text-sm dark:border-white/[.2] dark:bg-black dark:text-zinc-50">
            <option value="">Select employee…</option>
            {people.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
          </select>
          <input type="date" value={sepDate} onChange={(e) => setSepDate(e.target.value)} className="rounded-lg border border-black/[.12] px-3 py-1.5 text-sm dark:border-white/[.2] dark:bg-black dark:text-zinc-50" />
          <button onClick={() => { if (leaveFor && sepDate) { run("leaving.start", { employeeId: leaveFor, separationDate: sepDate }); setLeaveFor(""); setSepDate(""); } }} disabled={busy || !leaveFor || !sepDate} className="rounded-lg bg-teal-700 px-4 py-1.5 text-sm font-medium text-white disabled:opacity-40">
            Start offboarding
          </button>
        </div>
      </section>

      <section className="rounded-2xl border border-black/[.08] bg-white p-5 dark:border-white/[.12] dark:bg-black">
        <h2 className="mb-3 text-sm font-medium uppercase tracking-wide text-zinc-500">Offboarding ({offboardings.length})</h2>
        {offboardings.length === 0 ? (
          <p className="text-sm text-zinc-400">No active offboardings.</p>
        ) : (
          <div className="space-y-3">
            {offboardings.map((o) => (
              <div key={o.id} className={`rounded-xl border p-3 ${o.separated ? "border-zinc-200 bg-zinc-50 dark:border-zinc-800" : "border-black/[.08] dark:border-white/[.1]"}`}>
                <div className="mb-2 flex items-center justify-between">
                  <span className="font-medium text-black dark:text-zinc-50">{o.employeeName}</span>
                  <span className="text-xs text-zinc-400">separation date {o.separationDate}</span>
                </div>
                <div className="space-y-1">
                  {o.handovers.map((h) => (
                    <div key={h.id} className="flex items-center justify-between text-xs">
                      <span className={h.status === "done" ? "text-zinc-400 line-through" : "text-zinc-600 dark:text-zinc-300"}>
                        {h.status === "done" ? "✓" : "○"} {h.title} <span className="text-zinc-400">→ {h.toName}</span>
                      </span>
                      {h.status !== "done" && (
                        <button onClick={() => run("leaving.completeHandover", { employeeId: o.employeeId, handoverId: h.id })} disabled={busy} className="text-teal-600 underline disabled:opacity-40">handover done</button>
                      )}
                    </div>
                  ))}
                </div>
                {o.status === "complete" && !o.separated && (
                  <button onClick={() => run("leaving.applySeparation", { employeeId: o.employeeId })} disabled={busy} className="mt-2 rounded-lg bg-rose-600 px-3 py-1 text-xs font-medium text-white disabled:opacity-40">
                    Apply separation
                  </button>
                )}
                {o.separated && <div className="mt-2 text-xs text-zinc-400">Separated — rules suspended.</div>}
              </div>
            ))}
          </div>
        )}
      </section>
    </div>
  );
}
