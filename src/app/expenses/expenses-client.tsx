"use client";

import { useState } from "react";
import { AccentButton, ChromeButton, Empty, inputCls, OpFeedback, SectionTitle, StatusBadge } from "../ui/kit";
import { useOperation } from "@/components/ops/use-operation";
import { fmtDate } from "../ui/dates";

export interface ExpenseRow {
  id: string;
  employee: string;
  employeeName: string;
  date: string;
  amount: number;
  category?: string;
  description: string;
  status: string;
  reason?: string;
  approvedBy?: string;
  declinedBy?: string;
}

const CATEGORIES = ["Travel", "Food", "Accommodation", "Equipment", "Miscellaneous"];

export function ExpensesClient({
  currentUserId,
  myClaims,
  pendingForApproval,
  isApprover,
}: {
  currentUserId: string;
  myClaims: ExpenseRow[];
  pendingForApproval: ExpenseRow[];
  isApprover: boolean;
}) {
  const op = useOperation();
  const busy = op.busy;
  const [showForm, setShowForm] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [form, setForm] = useState({
    amount: "",
    category: "Travel",
    description: "",
    date: "",
  });
  const [decliningId, setDecliningId] = useState<string | null>(null);
  const [declineReason, setDeclineReason] = useState("");

  const pendingTotal = myClaims
    .filter((c) => c.status === "Pending")
    .reduce((sum, c) => sum + c.amount, 0);

  async function submitClaim() {
    const amount = Number(form.amount);
    if (!form.date || !form.description.trim()) return;
    if (!Number.isFinite(amount) || amount <= 0) {
      setError("The amount must be greater than zero.");
      return;
    }
    setError(null);
    const outcome = await op.run("expense.claim", {
      employeeId: currentUserId,
      amount,
      category: form.category,
      description: form.description.trim(),
      date: form.date,
    });
    if (outcome.status === "ran") {
      setShowForm(false);
      setForm({ ...form, amount: "", description: "", date: "" });
    }
  }

  async function approve(claimId: string) {
    await op.run("expense.approve", { claimId });
  }

  async function decline(claimId: string, reason: string) {
    if (!reason.trim()) return;
    const outcome = await op.run("expense.decline", { claimId, reason });
    if (outcome.status === "ran") {
      setDecliningId(null);
      setDeclineReason("");
    }
  }

  const labelCls = "block text-[10px] font-semibold uppercase tracking-widest text-ink-faint";

  return (
    <div className="mx-auto max-w-4xl space-y-5 p-4 sm:p-6">
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
        {/* Awaiting reimbursement — dark emphasis card. */}
        <section className="rise rounded-3xl bg-chrome-card p-5 text-chrome-ink shadow-card" style={{ animationDelay: "60ms" }}>
          <h2 className="text-[11px] font-semibold uppercase tracking-widest text-chrome-soft">Awaiting approval</h2>
          <div className="mt-3 flex items-baseline gap-2">
            <span className="text-5xl font-extrabold text-accent">
              ₹{pendingTotal.toLocaleString("en-IN")}
            </span>
          </div>
          <p className="mt-1 text-sm text-chrome-soft">
            across {myClaims.filter((c) => c.status === "Pending").length} pending claim
            {myClaims.filter((c) => c.status === "Pending").length === 1 ? "" : "s"}
          </p>
        </section>

        {/* New claim form. */}
        <section className="rise rounded-3xl bg-surface p-5 shadow-card lg:col-span-2" style={{ animationDelay: "130ms" }}>
          <div className="flex items-center justify-between">
            <SectionTitle>Claim an expense</SectionTitle>
            <ChromeButton onClick={() => setShowForm(!showForm)}>
              {showForm ? "Close" : "+ New claim"}
            </ChromeButton>
          </div>
          {showForm && (
            <div className="pop-in mt-4 space-y-3">
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
                <label className={labelCls}>
                  Amount (₹)
                  <input
                    type="number"
                    min="0"
                    step="0.01"
                    value={form.amount}
                    onChange={(e) => setForm({ ...form, amount: e.target.value })}
                    placeholder="0.00"
                    className={`${inputCls} mt-1.5 w-full py-2`}
                  />
                </label>
                <label className={labelCls}>
                  Category
                  <select value={form.category} onChange={(e) => setForm({ ...form, category: e.target.value })} className={`${inputCls} mt-1.5 w-full py-2`}>
                    {CATEGORIES.map((c) => <option key={c} value={c}>{c}</option>)}
                  </select>
                </label>
                <label className={labelCls}>
                  Date
                  <input type="date" value={form.date} onChange={(e) => setForm({ ...form, date: e.target.value })} className={`${inputCls} mt-1.5 w-full py-2`} />
                </label>
              </div>
              <textarea
                value={form.description}
                onChange={(e) => setForm({ ...form, description: e.target.value })}
                placeholder="What was this for?"
                rows={2}
                className={`${inputCls} w-full py-2`}
              />
              {error && (
                <p className="fade-in rounded-xl bg-danger-soft px-3 py-2 text-xs font-medium text-danger">{error}</p>
              )}
              <AccentButton
                onClick={submitClaim}
                disabled={busy || !form.amount || !form.date || !form.description.trim()}
              >
                {busy ? "Submitting…" : "Submit claim"}
              </AccentButton>
            </div>
          )}
        </section>
      </div>

      {/* Approvals — rose "waiting on you", same as the dashboard and leave. */}
      {isApprover && (
        <section className="rise rounded-3xl border-l-[3px] border-rose-strong bg-rose p-5 shadow-card" style={{ animationDelay: "200ms" }}>
          <h2 className="text-[11px] font-semibold uppercase tracking-widest text-rose-strong">
            Waiting on you
          </h2>
          {pendingForApproval.length === 0 ? (
            <p className="mt-3 text-sm text-ink-soft">Nothing waiting on you.</p>
          ) : (
            <div className="mt-3 space-y-2">
              {pendingForApproval.map((c, i) => (
                <div
                  key={c.id}
                  style={{ animationDelay: `${240 + i * 55}ms` }}
                  className="rise flex flex-wrap items-center justify-between gap-2 rounded-2xl bg-surface/80 px-3.5 py-2.5"
                >
                  <div className="min-w-0 text-[13px]">
                    <span className="font-semibold text-ink">{c.employeeName}</span>
                    <span className="text-ink-soft"> · {fmtDate(c.date)} · ₹{c.amount.toLocaleString("en-IN")}</span>
                    {c.category && <span className="ml-2 rounded-full bg-peach px-2 py-0.5 text-[10px] font-bold text-peach-strong">{c.category}</span>}
                    {c.description && <div className="text-[11px] text-ink-faint">“{c.description}”</div>}
                  </div>
                  {decliningId === c.id ? (
                    <div className="pop-in flex items-center gap-2">
                      <input
                        autoFocus
                        value={declineReason}
                        onChange={(e) => setDeclineReason(e.target.value)}
                        placeholder="Reason for declining"
                        className={inputCls}
                      />
                      <button
                        onClick={() => decline(c.id, declineReason)}
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
                        onClick={() => approve(c.id)}
                        disabled={busy}
                        className="press rounded-full bg-chrome px-3.5 py-1.5 text-xs font-semibold text-chrome-ink transition-colors hover:bg-chrome-card disabled:opacity-40"
                      >
                        Approve
                      </button>
                      <button
                        onClick={() => { setDecliningId(c.id); setDeclineReason(""); }}
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

      {/* My claims. */}
      <section className="rise rounded-3xl bg-surface p-5 shadow-card" style={{ animationDelay: "260ms" }}>
        <SectionTitle>My claims</SectionTitle>
        {myClaims.length === 0 ? (
          <Empty icon="booking" text="No expense claims yet." />
        ) : (
          <div className="mt-3 overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-[10px] uppercase tracking-widest text-ink-faint">
                  <th className="px-3 py-2 font-semibold">Date</th>
                  <th className="px-3 py-2 font-semibold">Category</th>
                  <th className="px-3 py-2 font-semibold">Description</th>
                  <th className="px-3 py-2 font-semibold">Amount</th>
                  <th className="px-3 py-2 font-semibold">Status</th>
                  <th className="px-3 py-2 font-semibold">Notes</th>
                </tr>
              </thead>
              <tbody>
                {myClaims.map((c) => (
                  <tr key={c.id} className="border-t border-line transition-colors hover:bg-raised">
                    <td className="px-3 py-2.5 text-[13px] text-ink">{fmtDate(c.date)}</td>
                    <td className="px-3 py-2.5 text-[13px] text-ink-soft">{c.category ?? "—"}</td>
                    <td className="px-3 py-2.5 text-[13px] text-ink-soft">{c.description}</td>
                    <td className="px-3 py-2.5 text-[13px] font-medium text-ink">
                      ₹{c.amount.toLocaleString("en-IN")}
                    </td>
                    <td className="px-3 py-2.5"><StatusBadge status={c.status} /></td>
                    <td className="px-3 py-2.5 text-xs text-ink-faint">
                      {c.status === "Declined" && c.reason ? `“${c.reason}”` : ""}
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
