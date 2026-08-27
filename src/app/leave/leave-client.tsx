"use client";

import { useState } from "react";
import { AccentButton, ChromeButton, Empty, inputCls, OpFeedback, SectionTitle, StatusBadge } from "../ui/kit";
import { useOperation } from "@/components/ops/use-operation";
import { fmtDate } from "../ui/dates";

interface LeaveEntry {
  id: string;
  fromDate: string;
  toDate: string;
  type?: string;
  reason?: string;
  status: string;
  approvedBy?: string;
  declinedBy?: string;
  clashes: number;
}

interface PendingLeave {
  id: string;
  employeeId: string;
  employeeName: string;
  fromDate: string;
  toDate: string;
  type?: string;
  reason?: string;
  clashes: number;
}

const LEAVE_TYPES = ["Casual", "Sick", "Earned", "Compensatory", "Unpaid"];

export function LeaveClient({
  currentUserId,
  myBalance,
  myHistory,
  pendingForApproval,
  isApprover,
  peopleForSelect,
}: {
  currentUserId: string;
  myBalance?: number;
  myHistory: LeaveEntry[];
  pendingForApproval: PendingLeave[];
  isApprover: boolean;
  peopleForSelect: Array<{ id: string; name: string }>;
}) {
  const op = useOperation();
  const busy = op.busy;
  const [showForm, setShowForm] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [form, setForm] = useState({
    employeeId: currentUserId,
    fromDate: "",
    toDate: "",
    type: "Casual",
    reason: "",
  });
  const [decliningId, setDecliningId] = useState<string | null>(null);
  const [declineReason, setDeclineReason] = useState("");

  async function submitLeave() {
    if (!form.employeeId || !form.fromDate || !form.toDate) return;
    if (form.toDate < form.fromDate) {
      setError("End date must be on or after the start date.");
      return;
    }
    setError(null);
    const outcome = await op.run("leave.request", {
      employeeId: form.employeeId,
      fromDate: form.fromDate,
      toDate: form.toDate,
      type: form.type,
      reason: form.reason || undefined,
    });
    if (outcome.status === "ran") {
      setShowForm(false);
      setForm({ ...form, fromDate: "", toDate: "", reason: "" });
    }
  }

  async function approve(leaveId: string) {
    await op.run("leave.approve", { leaveId });
  }

  async function decline(leaveId: string, reason: string) {
    if (!reason.trim()) return;
    const outcome = await op.run("leave.decline", { leaveId, reason });
    if (outcome.status === "ran") {
      setDecliningId(null);
      setDeclineReason("");
    }
  }

  const labelCls = "block text-[10px] font-semibold uppercase tracking-widest text-ink-faint";

  return (
    <div className="mx-auto max-w-4xl space-y-5 p-4 sm:p-6">
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
        {/* Balance — dark emphasis card. */}
        <section className="rise rounded-3xl bg-chrome-card p-5 text-chrome-ink shadow-card" style={{ animationDelay: "60ms" }}>
          <h2 className="text-[11px] font-semibold uppercase tracking-widest text-chrome-soft">My balance</h2>
          {myBalance === undefined ? (
            <p className="mt-3 text-sm text-chrome-soft">Leave balance is not available.</p>
          ) : (
            <div className="mt-3 flex items-baseline gap-2">
              <span className="text-5xl font-extrabold text-accent">{myBalance}</span>
              <span className="text-sm text-chrome-soft">days remaining</span>
            </div>
          )}
        </section>

        {/* Request form. */}
        <section className="rise rounded-3xl bg-surface p-5 shadow-card lg:col-span-2" style={{ animationDelay: "130ms" }}>
          <div className="flex items-center justify-between">
            <SectionTitle>Request leave</SectionTitle>
            <ChromeButton onClick={() => setShowForm(!showForm)}>
              {showForm ? "Close" : "+ New request"}
            </ChromeButton>
          </div>
          {showForm && (
            <div className="pop-in mt-4 space-y-3">
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                <label className={labelCls}>
                  For
                  <select value={form.employeeId} onChange={(e) => setForm({ ...form, employeeId: e.target.value })} className={`${inputCls} mt-1.5 w-full py-2`}>
                    {peopleForSelect.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
                  </select>
                </label>
                <label className={labelCls}>
                  Type
                  <select value={form.type} onChange={(e) => setForm({ ...form, type: e.target.value })} className={`${inputCls} mt-1.5 w-full py-2`}>
                    {LEAVE_TYPES.map((t) => <option key={t} value={t}>{t}</option>)}
                  </select>
                </label>
                <label className={labelCls}>
                  From
                  <input type="date" value={form.fromDate} onChange={(e) => setForm({ ...form, fromDate: e.target.value })} className={`${inputCls} mt-1.5 w-full py-2`} />
                </label>
                <label className={labelCls}>
                  To
                  <input type="date" value={form.toDate} onChange={(e) => setForm({ ...form, toDate: e.target.value })} className={`${inputCls} mt-1.5 w-full py-2`} />
                </label>
              </div>
              <textarea
                value={form.reason}
                onChange={(e) => setForm({ ...form, reason: e.target.value })}
                placeholder="Reason (optional)"
                rows={2}
                className={`${inputCls} w-full py-2`}
              />
              {error && (
                <p className="fade-in rounded-xl bg-danger-soft px-3 py-2 text-xs font-medium text-danger">{error}</p>
              )}
              <AccentButton onClick={submitLeave} disabled={busy || !form.fromDate || !form.toDate}>
                {busy ? "Submitting…" : "Submit request"}
              </AccentButton>
            </div>
          )}
        </section>
      </div>

      {/* Approvals — rose "waiting on you", same as the dashboard. */}
      {isApprover && (
        <section className="rise rounded-3xl border-l-[3px] border-rose-strong bg-rose p-5 shadow-card" style={{ animationDelay: "200ms" }}>
          <h2 className="text-[11px] font-semibold uppercase tracking-widest text-rose-strong">
            Waiting on you
          </h2>
          {pendingForApproval.length === 0 ? (
            <p className="mt-3 text-sm text-ink-soft">Nothing waiting on you.</p>
          ) : (
            <div className="mt-3 space-y-2">
              {pendingForApproval.map((l, i) => (
                <div
                  key={l.id}
                  style={{ animationDelay: `${240 + i * 55}ms` }}
                  className="rise flex flex-wrap items-center justify-between gap-2 rounded-2xl bg-surface/80 px-3.5 py-2.5"
                >
                  <div className="min-w-0 text-[13px]">
                    <span className="font-semibold text-ink">{l.employeeName}</span>
                    <span className="text-ink-soft"> · {fmtDate(l.fromDate)} → {fmtDate(l.toDate)}</span>
                    {l.type && <span className="ml-2 rounded-full bg-peach px-2 py-0.5 text-[10px] font-bold text-peach-strong">{l.type}</span>}
                    {l.clashes > 0 && (
                      <span className="ml-2 text-[11px] font-semibold text-danger">⚠ {l.clashes} clash{l.clashes === 1 ? "" : "es"}</span>
                    )}
                    {l.reason && <div className="text-[11px] text-ink-faint">“{l.reason}”</div>}
                  </div>
                  {decliningId === l.id ? (
                    <div className="pop-in flex items-center gap-2">
                      <input
                        autoFocus
                        value={declineReason}
                        onChange={(e) => setDeclineReason(e.target.value)}
                        placeholder="Reason for declining"
                        className={inputCls}
                      />
                      <button
                        onClick={() => decline(l.id, declineReason)}
                        disabled={busy || !declineReason.trim()}
                        className="press rounded-full bg-danger px-3 py-1.5 text-[11px] font-semibold text-white disabled:opacity-40"
                      >
                        Confirm decline
                      </button>
                      <button onClick={() => setDecliningId(null)} className="text-[11px] font-medium text-ink-faint hover:text-ink">
                        Cancel
                      </button>
                    </div>
                  ) : (
                    <div className="flex gap-2">
                      <button
                        onClick={() => approve(l.id)}
                        disabled={busy}
                        className="press rounded-full bg-chrome px-3.5 py-1.5 text-xs font-semibold text-chrome-ink transition-colors hover:bg-chrome-card disabled:opacity-40"
                      >
                        Approve
                      </button>
                      <button
                        onClick={() => { setDecliningId(l.id); setDeclineReason(""); }}
                        disabled={busy}
                        className="press rounded-full bg-surface px-3.5 py-1.5 text-xs font-semibold text-danger shadow-card disabled:opacity-40"
                      >
                        Decline
                      </button>
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}
        </section>
      )}

      {/* History. */}
      <section className="rise rounded-3xl bg-surface p-5 shadow-card" style={{ animationDelay: "260ms" }}>
        <SectionTitle>My history</SectionTitle>
        {myHistory.length === 0 ? (
          <Empty icon="leave" text="No leave requests yet." />
        ) : (
          <div className="mt-3 overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-[10px] uppercase tracking-widest text-ink-faint">
                  <th className="px-3 py-2 font-semibold">From</th>
                  <th className="px-3 py-2 font-semibold">To</th>
                  <th className="px-3 py-2 font-semibold">Type</th>
                  <th className="px-3 py-2 font-semibold">Status</th>
                  <th className="px-3 py-2 font-semibold">Notes</th>
                </tr>
              </thead>
              <tbody>
                {myHistory.map((l) => (
                  <tr key={l.id} className="border-t border-line transition-colors hover:bg-raised">
                    <td className="px-3 py-2.5 text-[13px] text-ink">{l.fromDate}</td>
                    <td className="px-3 py-2.5 text-[13px] text-ink">{l.toDate}</td>
                    <td className="px-3 py-2.5 text-[13px] text-ink-soft">{l.type ?? "—"}</td>
                    <td className="px-3 py-2.5"><StatusBadge status={l.status} /></td>
                    <td className="px-3 py-2.5 text-xs text-ink-faint">
                      {l.clashes > 0 && <span className="font-semibold text-danger">clash flagged</span>}
                      {l.reason && l.clashes > 0 && " · "}
                      {l.reason && `“${l.reason}”`}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
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
