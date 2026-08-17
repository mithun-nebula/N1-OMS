"use client";

import { useState } from "react";
import { AccentButton, ChromeButton, Empty, inputCls, OpFeedback } from "../ui/kit";
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

export function DecisionsClient({
  decisions,
  canRecord,
}: {
  decisions: Decision[];
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
