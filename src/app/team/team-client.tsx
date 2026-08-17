"use client";

import { useState } from "react";
import { Avatar, Bar, Empty, Modal, PriorityBadge, SectionTitle, StatusBadge } from "../ui/kit";

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
    <div className="mx-auto max-w-5xl space-y-5 p-4 sm:p-6">
      {/* ============ Directory as cards ============ */}
      <section className="rise" style={{ animationDelay: "60ms" }}>
        <SectionTitle>Directory</SectionTitle>
        <div className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {rows.map((r, i) => (
            <button
              key={r.id}
              onClick={() => setSelected(r.id)}
              style={{ animationDelay: `${100 + i * 40}ms` }}
              className="rise lift press flex items-center gap-3 rounded-2xl bg-surface p-3.5 text-left shadow-card"
            >
              <Avatar name={r.name} size={38} />
              <div className="min-w-0 flex-1">
                <div className="truncate text-sm font-semibold text-ink">{r.name}</div>
                <div className="truncate text-[11px] capitalize text-ink-soft">
                  {r.role}
                  {r.contact ? ` · ${r.contact}` : ""}
                </div>
              </div>
              {r.payRestricted && (
                <span className="rounded-full bg-raised px-2 py-0.5 text-[9px] font-bold uppercase tracking-wider text-ink-faint" title="Pay details restricted">
                  pay 🔒
                </span>
              )}
            </button>
          ))}
        </div>
        <p className="mt-2 text-[11px] text-ink-faint">Select a person for their courses, tasks and leave.</p>
      </section>

      {/* ============ Building now ============ */}
      <section className="rise rounded-3xl bg-surface p-5 shadow-card" style={{ animationDelay: "180ms" }}>
        <SectionTitle>Building now</SectionTitle>
        {coursesByOwner.length === 0 ? (
          <Empty icon="projects" text="Nothing in build right now." />
        ) : (
          <div className="mt-3 space-y-4">
            {coursesByOwner.map(({ ownerId, ownerName, courses }) => (
              <div key={ownerId}>
                <div className="mb-1.5 flex items-center gap-2">
                  <Avatar name={ownerName} size={22} />
                  <span className="text-[13px] font-semibold text-ink">{ownerName}</span>
                </div>
                <div className="space-y-1.5">
                  {courses.map((c) => (
                    <div key={c.title} className="flex items-center gap-3">
                      <span className="w-44 truncate text-xs text-ink-soft">{c.title}</span>
                      <Bar pct={c.pct} />
                      <span className="w-9 text-right text-xs font-semibold text-ink-soft">{c.pct}%</span>
                    </div>
                  ))}
                </div>
              </div>
            ))}
          </div>
        )}
      </section>

      {/* ============ Person detail ============ */}
      {sel && selRow && (
        <Modal onClose={() => setSelected(null)}>
          <div className="mb-5 flex items-start justify-between">
            <div className="flex items-center gap-3">
              <Avatar name={selRow.name} size={44} />
              <div>
                <h2 className="text-lg font-extrabold text-ink">{selRow.name}</h2>
                <p className="text-xs capitalize text-ink-soft">
                  {selRow.role}
                  {selRow.contact ? ` · ${selRow.contact}` : ""}
                </p>
              </div>
            </div>
            <button onClick={() => setSelected(null)} className="press text-xs font-medium text-ink-faint hover:text-ink">
              Close
            </button>
          </div>

          <section className="mb-5">
            <SectionTitle>Courses ({sel.courses.length})</SectionTitle>
            {sel.courses.length === 0 ? (
              <p className="mt-2 text-xs text-ink-faint">None.</p>
            ) : (
              <div className="mt-2 space-y-1.5">
                {sel.courses.map((c) => (
                  <div key={c.title} className="flex items-center gap-3">
                    <span className="w-36 truncate text-xs text-ink-soft">{c.title}</span>
                    <Bar pct={c.pct} />
                    <span className="text-xs font-semibold text-ink-soft">{c.pct}%</span>
                  </div>
                ))}
              </div>
            )}
          </section>

          <section className="mb-5">
            <SectionTitle>Open tasks ({sel.tasks.length})</SectionTitle>
            {sel.tasks.length === 0 ? (
              <p className="mt-2 text-xs text-ink-faint">None.</p>
            ) : (
              <div className="mt-2 space-y-1.5">
                {sel.tasks.map((t, i) => (
                  <div key={i} className="flex items-center justify-between gap-2 rounded-xl bg-raised px-3 py-2">
                    <span className="truncate text-xs font-medium text-ink">{t.title}</span>
                    <span className="flex shrink-0 items-center gap-2 text-[11px] text-ink-faint">
                      {t.dueDate}
                      <PriorityBadge priority={t.priority} />
                    </span>
                  </div>
                ))}
              </div>
            )}
          </section>

          <section>
            <SectionTitle>Leave ({sel.leave.length})</SectionTitle>
            {sel.leave.length === 0 ? (
              <p className="mt-2 text-xs text-ink-faint">No leave requests.</p>
            ) : (
              <div className="mt-2 space-y-1.5">
                {sel.leave.map((l, i) => (
                  <div key={i} className="flex items-center justify-between rounded-xl bg-raised px-3 py-2 text-xs">
                    <span className="text-ink-soft">{l.fromDate} → {l.toDate}</span>
                    <StatusBadge status={l.status} />
                  </div>
                ))}
              </div>
            )}
          </section>
        </Modal>
      )}
    </div>
  );
}
