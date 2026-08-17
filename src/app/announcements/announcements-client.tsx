"use client";

import { useState } from "react";
import { Avatar, AccentButton, ChromeButton, Empty, inputCls, OpFeedback, SectionTitle } from "../ui/kit";
import { useOperation } from "@/components/ops/use-operation";

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
  const op = useOperation();
  const busy = op.busy;
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState({ message: "", policy: false, audience: [] as string[] });

  function toggleAudee(id: string) {
    setForm((f) => ({
      ...f,
      audience: f.audience.includes(id) ? f.audience.filter((a) => a !== id) : [...f.audience, id],
    }));
  }

  async function send() {
    if (!form.message || form.audience.length === 0) return;
    const outcome = await op.run("announcement.send", {
      message: form.message,
      to: form.audience,
      policy: form.policy || undefined,
    });
    if (outcome.status === "ran") {
      setShowForm(false);
      setForm({ message: "", policy: false, audience: [] });
    }
  }

  async function ack(id: string) {
    await op.run("announcement.ack", { announcementId: id });
  }

  return (
    <div className="mx-auto max-w-4xl space-y-5 p-4 sm:p-6">
      {canSend && (
        <section className="rise rounded-3xl bg-surface p-5 shadow-card" style={{ animationDelay: "60ms" }}>
          <div className="flex flex-wrap items-center justify-between gap-3">
            <SectionTitle>Send</SectionTitle>
            <ChromeButton onClick={() => setShowForm(!showForm)}>
              {showForm ? "Close" : "+ New announcement"}
            </ChromeButton>
          </div>
          {showForm && (
            <div className="pop-in mt-4 space-y-3">
              <textarea
                value={form.message}
                onChange={(e) => setForm({ ...form, message: e.target.value })}
                placeholder="Message"
                rows={3}
                className={`${inputCls} w-full py-2`}
              />
              <label className="flex items-center gap-2 text-xs font-medium text-ink-soft">
                <input
                  type="checkbox"
                  checked={form.policy}
                  onChange={(e) => setForm({ ...form, policy: e.target.checked })}
                  className="accent-accent-strong"
                />
                Mark as a policy
              </label>
              <div>
                <div className="mb-1.5 text-[10px] font-semibold uppercase tracking-widest text-ink-faint">To</div>
                <div className="flex flex-wrap gap-1.5">
                  <button
                    onClick={() => setForm({ ...form, audience: [...people] })}
                    className="press rounded-full bg-accent-soft px-3 py-1 text-xs font-semibold text-accent-strong"
                  >
                    Everyone
                  </button>
                  {people.map((id) => (
                    <button
                      key={id}
                      onClick={() => toggleAudee(id)}
                      className={`press rounded-full px-3 py-1 text-xs font-medium transition-colors ${
                        form.audience.includes(id)
                          ? "bg-chrome text-chrome-ink"
                          : "bg-raised text-ink-soft hover:text-ink"
                      }`}
                    >
                      {id}
                    </button>
                  ))}
                </div>
              </div>
              <AccentButton onClick={send} disabled={busy || !form.message || form.audience.length === 0}>
                {busy ? "Sending…" : "Send"}
              </AccentButton>
            </div>
          )}
        </section>
      )}

      <section className="space-y-2.5">
        {announcements.length === 0 && (
          <Empty icon="bell" text="No announcements yet — it's all quiet." />
        )}
        {announcements.map((a, i) => (
          <div
            key={a.id}
            className={`rise lift rounded-2xl border-l-[3px] bg-surface p-4 shadow-card ${
              a.policy ? "border-peach-strong" : "border-line"
            }`}
            style={{ animationDelay: `${120 + i * 50}ms` }}
          >
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                {a.policy && (
                  <span className="mr-2 rounded-full bg-peach px-2 py-0.5 text-[10px] font-bold text-peach-strong">
                    POLICY
                  </span>
                )}
                <span className="text-[13px] text-ink">{a.message}</span>
              </div>
              {a.inAudience && !a.ackedByMe && (
                <button
                  onClick={() => ack(a.id)}
                  disabled={busy}
                  className="press shrink-0 rounded-full bg-chrome px-3.5 py-1.5 text-xs font-semibold text-chrome-ink transition-colors hover:bg-chrome-card disabled:opacity-40"
                >
                  Acknowledge
                </button>
              )}
              {a.ackedByMe && (
                <span className="shrink-0 rounded-full bg-mint px-2.5 py-0.5 text-[11px] font-semibold text-mint-strong">
                  ✓ acknowledged
                </span>
              )}
            </div>
            <div className="mt-2.5 flex flex-wrap items-center gap-2 text-[11px] text-ink-faint">
              <Avatar name={a.by} size={20} />
              <span className="font-medium text-ink-soft">{a.by}</span>
              <span>· {new Date(a.at).toLocaleString([], { dateStyle: "medium", timeStyle: "short" })}</span>
              <span>· {a.outstanding} of {a.audience.length} outstanding</span>
            </div>
          </div>
        ))}
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
