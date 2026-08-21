"use client";

import { useState } from "react";
import { AccentButton, ChromeButton, Empty, inputCls, OpFeedback, SectionTitle } from "../ui/kit";
import { useOperation } from "@/components/ops/use-operation";

interface Decision {
  id: string;
  title: string;
  decision: string;
  reason: string;
  decidedBy: string;
  decidedAt: string;
  linkedRecords: Array<{ nodeType: string; nodeId: string }>;
}

interface MeetingDecisionSet {
  meetingId: string;
  meetingTitle: string;
  decisions: Array<{ id: string; text: string; ownerName?: string }>;
  actions: Array<{ id: string; text: string; ownerName: string; due?: string; done: boolean }>;
}

export function DecisionsClient({
  decisions,
  meetingDecisions,
  canRecord,
}: {
  decisions: Decision[];
  meetingDecisions: MeetingDecisionSet[];
  canRecord: boolean;
}) {
  const op = useOperation();
  const busy = op.busy;
  const [query, setQuery] = useState("");
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState({ title: "", decision: "", reason: "" });

  const filtered = query.trim()
    ? decisions.filter((d) => {
        const q = query.toLowerCase();
        return d.title.toLowerCase().includes(q) || d.decision.toLowerCase().includes(q) || d.reason.toLowerCase().includes(q);
      })
    : decisions;

  async function record() {
    if (!form.title || !form.decision || !form.reason) return;
    const outcome = await op.run("orgMemory.record", {
      title: form.title,
      decision: form.decision,
      reason: form.reason,
    });
    if (outcome.status === "ran") {
      setShowForm(false);
      setForm({ title: "", decision: "", reason: "" });
    }
  }

  return (
    <div className="mx-auto max-w-4xl space-y-5 p-4 sm:p-6">
      <div className="rise flex items-center gap-3" style={{ animationDelay: "60ms" }}>
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search decisions…"
          className={`${inputCls} w-full flex-1 py-2`}
        />
        {canRecord && (
          <ChromeButton onClick={() => setShowForm(!showForm)}>
            {showForm ? "Close" : "+ Record decision"}
          </ChromeButton>
        )}
      </div>

      {showForm && (
        <div className="pop-in space-y-3 rounded-3xl bg-surface p-5 shadow-card">
          <input
            value={form.title}
            onChange={(e) => setForm({ ...form, title: e.target.value })}
            placeholder="Title"
            className={`${inputCls} w-full py-2`}
          />
          <textarea
            value={form.decision}
            onChange={(e) => setForm({ ...form, decision: e.target.value })}
            placeholder="What was decided"
            rows={2}
            className={`${inputCls} w-full py-2`}
          />
          <textarea
            value={form.reason}
            onChange={(e) => setForm({ ...form, reason: e.target.value })}
            placeholder="The reason at the time"
            rows={2}
            className={`${inputCls} w-full py-2`}
          />
          <AccentButton
            onClick={record}
            disabled={busy || !form.title || !form.decision || !form.reason}
          >
            {busy ? "Recording…" : "Record decision"}
          </AccentButton>
        </div>
      )}

      {filtered.length === 0 ? (
        <Empty icon="spark" text="No decisions recorded yet — the memory is waiting for its first entry." />
      ) : (
        <div className="space-y-2.5">
          {filtered.map((d, i) => (
            <div
              key={d.id}
              className="rise lift rounded-2xl border-l-[3px] border-lilac-strong bg-surface p-5 shadow-card"
              style={{ animationDelay: `${120 + i * 50}ms` }}
            >
              <div className="text-[14px] font-semibold text-ink">{d.title}</div>
              <div className="mt-1 text-sm text-ink-soft">{d.decision}</div>
              <div className="mt-2 rounded-xl bg-raised px-3 py-2 text-xs text-ink-soft">
                <span className="font-semibold text-ink-faint">Reason at the time: </span>
                {d.reason}
              </div>
              <div className="mt-2 text-[11px] text-ink-faint">
                decided by {d.decidedBy} · {String(d.decidedAt).slice(0, 10)}
                {d.linkedRecords.length > 0 &&
                  ` · links: ${d.linkedRecords.map((l) => `${l.nodeType}:${l.nodeId}`).join(", ")}`}
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Decisions captured against a meeting, with their action items. */}
      {meetingDecisions.length > 0 && (
        <section className="rise space-y-2.5" style={{ animationDelay: "180ms" }}>
          <SectionTitle>Meeting decisions</SectionTitle>
          {meetingDecisions.map((set, i) => (
            <div
              key={set.meetingId}
              className="rise lift rounded-2xl border-l-[3px] border-mint-strong bg-surface p-5 shadow-card"
              style={{ animationDelay: `${220 + i * 50}ms` }}
            >
              <div className="text-[14px] font-semibold text-ink">{set.meetingTitle}</div>
              {set.decisions.length > 0 && (
                <ul className="mt-2 space-y-1.5">
                  {set.decisions.map((d) => (
                    <li key={d.id} className="text-sm text-ink-soft">
                      {d.text}
                      {d.ownerName && (
                        <span className="ml-2 rounded-full bg-lilac px-2 py-0.5 text-[10px] font-bold text-lilac-strong">
                          {d.ownerName}
                        </span>
                      )}
                    </li>
                  ))}
                </ul>
              )}
              {set.actions.length > 0 && (
                <div className="mt-3 space-y-1.5">
                  <div className="text-[10px] font-semibold uppercase tracking-widest text-ink-faint">
                    Action items
                  </div>
                  {set.actions.map((a) => (
                    <div
                      key={a.id}
                      className="flex flex-wrap items-center justify-between gap-2 rounded-xl bg-raised px-3 py-2"
                    >
                      <div className="min-w-0 text-xs">
                        <span className={a.done ? "text-ink-faint line-through" : "font-medium text-ink"}>
                          {a.text}
                        </span>
                        <span className="ml-2 rounded-full bg-peach px-2 py-0.5 text-[10px] font-bold text-peach-strong">
                          {a.ownerName}
                        </span>
                        {a.due && (
                          <span className="ml-2 text-[11px] text-ink-faint">due {String(a.due).slice(0, 10)}</span>
                        )}
                      </div>
                      {a.done ? (
                        <span className="rounded-full bg-mint px-2.5 py-0.5 text-[11px] font-semibold text-mint-strong">
                          Done
                        </span>
                      ) : (
                        <button
                          onClick={() =>
                            op.run("meeting.completeAction", {
                              meetingId: set.meetingId,
                              actionId: a.id,
                            })
                          }
                          disabled={busy}
                          className="press rounded-lg bg-chrome px-2.5 py-1 text-[11px] font-semibold text-chrome-ink disabled:opacity-40"
                        >
                          Done
                        </button>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </div>
          ))}
        </section>
      )}
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
