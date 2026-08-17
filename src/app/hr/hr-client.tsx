"use client";

import { useState } from "react";
import { Icon } from "../ui/icons";
import { AccentButton, Empty, inputCls, OpFeedback, SectionTitle } from "../ui/kit";
import { useOperation } from "@/components/ops/use-operation";

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
  const op = useOperation();
  const busy = op.busy;
  const [joinFor, setJoinFor] = useState("");
  const [leaveFor, setLeaveFor] = useState("");
  const [sepDate, setSepDate] = useState("");

  async function run(name: string, args: Record<string, unknown>) {
    await op.run(name, args);
  }

  async function startOnboarding() {
    if (!joinFor) return;
    const outcome = await op.run("joining.start", { employeeId: joinFor });
    if (outcome.status === "ran") setJoinFor("");
  }

  async function startOffboarding() {
    if (!leaveFor || !sepDate) return;
    const outcome = await op.run("leaving.start", { employeeId: leaveFor, separationDate: sepDate });
    if (outcome.status === "ran") {
      setLeaveFor("");
      setSepDate("");
    }
  }

  return (
    <div className="mx-auto max-w-4xl space-y-5 p-4 sm:p-6">
      {/* Overdue — rose "chase these" card, same tone as leave approvals. */}
      {overdue.length > 0 && (
        <section className="rise rounded-3xl border-l-[3px] border-rose-strong bg-rose p-5 shadow-card" style={{ animationDelay: "60ms" }}>
          <h2 className="text-[11px] font-semibold uppercase tracking-widest text-rose-strong">
            Overdue steps — chase these
          </h2>
          <div className="mt-3 space-y-2">
            {overdue.map((o, i) => (
              <div
                key={i}
                className="rise rounded-2xl bg-surface/80 px-3.5 py-2.5 text-[13px]"
                style={{ animationDelay: `${100 + i * 55}ms` }}
              >
                <span className="font-semibold text-ink">{o.employeeName}</span>
                <span className="text-ink-soft"> — “{o.title}”</span>
                <span className="text-ink-faint"> (owner: {o.owner})</span>
              </div>
            ))}
          </div>
        </section>
      )}

      {/* Start onboarding. */}
      <section className="rise rounded-3xl bg-surface p-5 shadow-card" style={{ animationDelay: "110ms" }}>
        <SectionTitle>Start onboarding</SectionTitle>
        <div className="mt-4 flex flex-wrap items-center gap-2.5">
          <select value={joinFor} onChange={(e) => setJoinFor(e.target.value)} className={`${inputCls} py-2`}>
            <option value="">Select employee…</option>
            {people.map((p) => (
              <option key={p.id} value={p.id}>{p.name}</option>
            ))}
          </select>
          <AccentButton onClick={startOnboarding} disabled={busy || !joinFor}>
            Start onboarding
          </AccentButton>
        </div>
      </section>

      {/* Onboardings. */}
      <section className="rise rounded-3xl bg-surface p-5 shadow-card" style={{ animationDelay: "160ms" }}>
        <SectionTitle>Onboarding ({onboardings.length})</SectionTitle>
        {onboardings.length === 0 ? (
          <Empty icon="team" text="No active onboardings." />
        ) : (
          <div className="mt-3 space-y-2.5">
            {onboardings.map((o, i) => (
              <div
                key={o.id}
                className={`rise rounded-2xl p-3.5 ${o.status === "complete" ? "bg-mint" : "bg-raised"}`}
                style={{ animationDelay: `${200 + i * 50}ms` }}
              >
                <div className="mb-2 flex items-center justify-between gap-2">
                  <span className="text-[13px] font-semibold text-ink">{o.employeeName}</span>
                  <span
                    className={`rounded-full px-2.5 py-0.5 text-[11px] font-semibold ${
                      o.status === "complete" ? "bg-surface text-mint-strong" : "bg-peach text-peach-strong"
                    }`}
                  >
                    {o.status}
                  </span>
                </div>
                <div className="space-y-1.5">
                  {o.steps.map((s) => (
                    <div key={s.id} className="flex items-center justify-between gap-2 text-xs">
                      <span
                        className={`flex min-w-0 items-center gap-1.5 ${
                          s.status === "done" ? "text-ink-faint line-through" : "text-ink-soft"
                        }`}
                      >
                        {s.status === "done" ? (
                          <Icon name="check" className="h-3 w-3 shrink-0 text-mint-strong" />
                        ) : (
                          <span className="h-3 w-3 shrink-0 rounded-full border border-line" />
                        )}
                        <span className="truncate">
                          {s.title} <span className="text-ink-faint">(owner: {s.ownerName})</span>
                        </span>
                      </span>
                      {s.status !== "done" && (
                        <button
                          onClick={() => run("joining.completeStep", { employeeId: o.employeeId, stepId: s.id })}
                          disabled={busy}
                          className="press shrink-0 text-[11px] font-semibold text-accent-strong hover:underline disabled:opacity-40"
                        >
                          complete
                        </button>
                      )}
                    </div>
                  ))}
                </div>
              </div>
            ))}
          </div>
        )}
      </section>

      {/* Start offboarding. */}
      <section className="rise rounded-3xl bg-surface p-5 shadow-card" style={{ animationDelay: "210ms" }}>
        <SectionTitle>Start offboarding</SectionTitle>
        <div className="mt-4 flex flex-wrap items-center gap-2.5">
          <select value={leaveFor} onChange={(e) => setLeaveFor(e.target.value)} className={`${inputCls} py-2`}>
            <option value="">Select employee…</option>
            {people.map((p) => (
              <option key={p.id} value={p.id}>{p.name}</option>
            ))}
          </select>
          <input type="date" value={sepDate} onChange={(e) => setSepDate(e.target.value)} className={`${inputCls} py-2`} />
          <AccentButton onClick={startOffboarding} disabled={busy || !leaveFor || !sepDate}>
            Start offboarding
          </AccentButton>
        </div>
      </section>

      {/* Offboardings. */}
      <section className="rise rounded-3xl bg-surface p-5 shadow-card" style={{ animationDelay: "260ms" }}>
        <SectionTitle>Offboarding ({offboardings.length})</SectionTitle>
        {offboardings.length === 0 ? (
          <Empty icon="logout" text="No active offboardings." />
        ) : (
          <div className="mt-3 space-y-2.5">
            {offboardings.map((o, i) => (
              <div
                key={o.id}
                className={`rise rounded-2xl bg-raised p-3.5 ${o.separated ? "opacity-70" : ""}`}
                style={{ animationDelay: `${300 + i * 50}ms` }}
              >
                <div className="mb-2 flex items-center justify-between gap-2">
                  <span className="text-[13px] font-semibold text-ink">{o.employeeName}</span>
                  <span className="flex items-center gap-1 text-[11px] text-ink-faint">
                    <Icon name="clock" className="h-3 w-3" />
                    separation date {o.separationDate}
                  </span>
                </div>
                <div className="space-y-1.5">
                  {o.handovers.map((h) => (
                    <div key={h.id} className="flex items-center justify-between gap-2 text-xs">
                      <span
                        className={`flex min-w-0 items-center gap-1.5 ${
                          h.status === "done" ? "text-ink-faint line-through" : "text-ink-soft"
                        }`}
                      >
                        {h.status === "done" ? (
                          <Icon name="check" className="h-3 w-3 shrink-0 text-mint-strong" />
                        ) : (
                          <span className="h-3 w-3 shrink-0 rounded-full border border-line" />
                        )}
                        <span className="truncate">
                          {h.title} <span className="text-ink-faint">→ {h.toName}</span>
                        </span>
                      </span>
                      {h.status !== "done" && (
                        <button
                          onClick={() => run("leaving.completeHandover", { employeeId: o.employeeId, handoverId: h.id })}
                          disabled={busy}
                          className="press shrink-0 text-[11px] font-semibold text-accent-strong hover:underline disabled:opacity-40"
                        >
                          handover done
                        </button>
                      )}
                    </div>
                  ))}
                </div>
                {o.status === "complete" && !o.separated && (
                  <button
                    onClick={() => run("leaving.applySeparation", { employeeId: o.employeeId })}
                    disabled={busy}
                    className="press mt-2.5 rounded-full bg-danger px-3.5 py-1.5 text-[11px] font-semibold text-white disabled:opacity-40"
                  >
                    Apply separation
                  </button>
                )}
                {o.separated && <div className="mt-2 text-[11px] text-ink-faint">Separated — rules suspended.</div>}
              </div>
            ))}
          </div>
        )}
      </section>

      <OpFeedback
        error={op.error}
        confirmation={op.confirmation}
        busy={op.busy}
        onConfirm={() => op.confirm()}
        onCancel={op.cancel}
        onDismiss={op.reset}
      />
    </div>
  );
}
