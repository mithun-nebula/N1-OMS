"use client";

import { useState } from "react";

interface PersonRow {
  id: string;
  name: string;
  role: string;
  contact?: string;
  payRestricted: boolean;
}

interface PerPerson {
  id: string;
  courses: Array<{ title: string; pct: number }>;
  tasks: Array<{ title: string; priority: string; dueDate?: string }>;
  leave: Array<{ fromDate: string; toDate: string; status: string }>;
}

export function TeamClient({
  rows,
  perPerson,
  coursesByOwner,
}: {
  rows: PersonRow[];
  perPerson: PerPerson[];
  coursesByOwner: Array<{ ownerId: string; ownerName: string; courses: Array<{ title: string; pct: number }> }>;
}) {
  const [selected, setSelected] = useState<string | null>(null);
  const sel = perPerson.find((p) => p.id === selected);
  const selRow = rows.find((r) => r.id === selected);

  return (
    <div className="space-y-6 p-6">
      <section>
        <h2 className="mb-3 text-sm font-medium uppercase tracking-wide text-zinc-500">Directory</h2>
        <div className="overflow-hidden rounded-xl border border-black/[.08] dark:border-white/[.12]">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-black/[.08] bg-zinc-50 text-left text-xs uppercase tracking-wide text-zinc-400 dark:border-white/[.1] dark:bg-zinc-900">
                <th className="px-4 py-2">Name</th>
                <th className="px-4 py-2">Role</th>
                <th className="px-4 py-2">Contact</th>
                <th className="px-4 py-2">Pay</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.id} onClick={() => setSelected(r.id)} className="cursor-pointer border-b border-black/[.04] last:border-0 hover:bg-teal-700/5 dark:border-white/[.04]">
                  <td className="px-4 py-2 font-medium text-teal-700 dark:text-teal-400">{r.name}</td>
                  <td className="px-4 py-2 text-zinc-500">{r.role}</td>
                  <td className="px-4 py-2 text-zinc-500">{r.contact ?? "—"}</td>
                  <td className="px-4 py-2">{r.payRestricted ? <span className="text-xs text-zinc-400">🔒 Restricted</span> : <span className="text-zinc-400">visible</span>}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="mt-2 text-xs text-zinc-400">Click a person for their courses, tasks and leave.</p>
      </section>

      <section>
        <h2 className="mb-3 text-sm font-medium uppercase tracking-wide text-zinc-500">Building now</h2>
        <div className="space-y-2">
          {coursesByOwner.map(({ ownerId, ownerName, courses }) => (
            <div key={ownerId} className="rounded-lg border border-black/[.08] p-3 dark:border-white/[.12]">
              <div className="mb-2 text-sm font-medium text-black dark:text-zinc-50">{ownerName}</div>
              {courses.map((c) => (
                <div key={c.title} className="mb-1.5 flex items-center gap-3">
                  <span className="w-40 truncate text-xs text-zinc-500">{c.title}</span>
                  <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-zinc-200 dark:bg-zinc-800">
                    <div className="h-full rounded-full bg-teal-600" style={{ width: `${c.pct}%` }} />
                  </div>
                  <span className="w-8 text-right text-xs text-zinc-400">{c.pct}%</span>
                </div>
              ))}
            </div>
          ))}
        </div>
      </section>

      {sel && selRow && (
        <div className="fixed inset-0 z-40 flex items-end justify-center bg-black/40 p-4 sm:items-center" onClick={() => setSelected(null)}>
          <div className="max-h-[85vh] w-full max-w-xl overflow-y-auto rounded-2xl bg-white p-6 dark:bg-black" onClick={(e) => e.stopPropagation()}>
            <div className="mb-4 flex items-start justify-between">
              <div>
                <h2 className="text-lg font-semibold text-black dark:text-zinc-50">{selRow.name}</h2>
                <p className="text-xs text-zinc-400">{selRow.role}{selRow.contact ? ` · ${selRow.contact}` : ""}</p>
              </div>
              <button onClick={() => setSelected(null)} className="text-xs text-zinc-400">Close</button>
            </div>

            <section className="mb-4">
              <h3 className="mb-2 text-xs font-medium uppercase tracking-wide text-zinc-400">Courses ({sel.courses.length})</h3>
              {sel.courses.length === 0 ? <p className="text-xs text-zinc-400">None.</p> : (
                <div className="space-y-1">
                  {sel.courses.map((c) => (
                    <div key={c.title} className="flex items-center gap-2 text-xs">
                      <span className="w-32 truncate text-zinc-600 dark:text-zinc-300">{c.title}</span>
                      <div className="h-1 flex-1 overflow-hidden rounded-full bg-zinc-200 dark:bg-zinc-800">
                        <div className="h-full rounded-full bg-teal-600" style={{ width: `${c.pct}%` }} />
                      </div>
                      <span className="text-zinc-400">{c.pct}%</span>
                    </div>
                  ))}
                </div>
              )}
            </section>

            <section className="mb-4">
              <h3 className="mb-2 text-xs font-medium uppercase tracking-wide text-zinc-400">Open tasks ({sel.tasks.length})</h3>
              {sel.tasks.length === 0 ? <p className="text-xs text-zinc-400">None.</p> : (
                <div className="space-y-1">
                  {sel.tasks.map((t, i) => (
                    <div key={i} className="flex items-center justify-between text-xs">
                      <span className="text-zinc-600 dark:text-zinc-300">{t.title}</span>
                      <span className="text-zinc-400">{t.priority}{t.dueDate ? ` · ${t.dueDate}` : ""}</span>
                    </div>
                  ))}
                </div>
              )}
            </section>

            <section>
              <h3 className="mb-2 text-xs font-medium uppercase tracking-wide text-zinc-400">Leave ({sel.leave.length})</h3>
              {sel.leave.length === 0 ? <p className="text-xs text-zinc-400">No leave requests.</p> : (
                <div className="space-y-1">
                  {sel.leave.map((l, i) => (
                    <div key={i} className="flex items-center justify-between text-xs">
                      <span className="text-zinc-600 dark:text-zinc-300">{l.fromDate} → {l.toDate}</span>
                      <span className={`rounded-full px-2 py-0.5 ${l.status === "Approved" ? "bg-teal-100 text-teal-700" : l.status === "Declined" ? "bg-rose-100 text-rose-700" : "bg-amber-100 text-amber-700"}`}>{l.status}</span>
                    </div>
                  ))}
                </div>
              )}
            </section>
          </div>
        </div>
      )}
    </div>
  );
}
