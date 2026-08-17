"use client";

import { useState } from "react";
import { AccentButton, Empty, inputCls, OpFeedback, SectionTitle } from "../ui/kit";
import { useOperation } from "@/components/ops/use-operation";

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
  const op = useOperation();
  const busy = op.busy;
  const [limitError, setLimitError] = useState<string | null>(null);
  const [form, setForm] = useState({ subject: "", detail: "", from: "", to: "" });
  const [fromFilter, setFromFilter] = useState("");
  const [toFilter, setToFilter] = useState("");

  async function capture() {
    if (!form.subject || !form.detail) return;
    setLimitError(null);
    const outcome = await op.run("utility.capture", {
      subject: form.subject,
      detail: form.detail,
      from: form.from || undefined,
      to: form.to || undefined,
    });
    if (outcome.status === "ran") {
      const resp = outcome.response as { captured?: boolean; reason?: string } | undefined;
      if (resp?.captured === false) {
        setLimitError(resp.reason ?? "Two-questions-per-day limit reached.");
        return;
      }
      setForm({ subject: "", detail: "", from: "", to: "" });
    }
  }

  const filtered = history.filter((h) => {
    if (fromFilter && h.at.slice(0, 10) < fromFilter) return false;
    if (toFilter && h.at.slice(0, 10) > toFilter) return false;
    return true;
  });

  return (
    <div className="mx-auto max-w-4xl space-y-5 p-4 sm:p-6">
      <section className="rise rounded-3xl bg-surface p-5 shadow-card" style={{ animationDelay: "60ms" }}>
        <div className="flex items-center justify-between">
          <SectionTitle>Capture</SectionTitle>
          <span
            className={`rounded-full px-2.5 py-0.5 text-[11px] font-semibold ${
              remaining > 0 ? "bg-mint text-mint-strong" : "bg-rose text-rose-strong"
            }`}
          >
            {remaining} of 2 remaining today
          </span>
        </div>
        <div className="mt-4 space-y-3">
          <input
            value={form.subject}
            onChange={(e) => setForm({ ...form, subject: e.target.value })}
            placeholder="Room / utility (e.g. “Hall 1 AC”)"
            className={`${inputCls} w-full py-2`}
          />
          <input
            value={form.detail}
            onChange={(e) => setForm({ ...form, detail: e.target.value })}
            placeholder="Detail (e.g. “on, 9 to 6”)"
            className={`${inputCls} w-full py-2`}
          />
          <div className="flex flex-wrap gap-3">
            <input
              type="time"
              value={form.from}
              onChange={(e) => setForm({ ...form, from: e.target.value })}
              placeholder="From"
              className={inputCls}
            />
            <input
              type="time"
              value={form.to}
              onChange={(e) => setForm({ ...form, to: e.target.value })}
              placeholder="To"
              className={inputCls}
            />
          </div>
          {limitError && (
            <p className="fade-in rounded-xl bg-danger-soft px-3 py-2 text-xs font-medium text-danger">
              {limitError}
            </p>
          )}
          <AccentButton
            onClick={capture}
            disabled={busy || !form.subject || !form.detail || remaining === 0}
          >
            {remaining === 0 ? "Daily limit reached" : busy ? "Recording…" : "Record"}
          </AccentButton>
        </div>
      </section>

      <section className="rise rounded-3xl bg-surface p-5 shadow-card" style={{ animationDelay: "130ms" }}>
        <div className="flex flex-wrap items-center gap-3">
          <SectionTitle>History</SectionTitle>
          <div className="ml-auto flex items-center gap-2 text-[11px] font-medium text-ink-faint">
            <span>from</span>
            <input
              type="date"
              value={fromFilter}
              max={today}
              onChange={(e) => setFromFilter(e.target.value)}
              className={inputCls}
            />
            <span>to</span>
            <input
              type="date"
              value={toFilter}
              max={today}
              onChange={(e) => setToFilter(e.target.value)}
              className={inputCls}
            />
          </div>
        </div>
        {filtered.length === 0 ? (
          <Empty icon="clock" text="No captures in this range — nothing recorded yet." />
        ) : (
          <div className="mt-3 space-y-1.5">
            {filtered.map((h, i) => (
              <div
                key={h.id}
                className="rise flex flex-wrap items-center justify-between gap-2 rounded-xl bg-raised px-3 py-2 text-xs"
                style={{ animationDelay: `${180 + i * 40}ms` }}
              >
                <span className="min-w-0 text-ink-soft">
                  <span className="font-semibold text-ink">{h.subject}</span> — {h.detail}
                  {h.from && h.to ? ` (${h.from}–${h.to})` : ""}
                </span>
                <span className="shrink-0 text-[11px] text-ink-faint">
                  {h.by} · {new Date(h.at).toLocaleDateString()}
                </span>
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
