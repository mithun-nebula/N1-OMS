"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

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
  currentUserName: string;
  myBalance?: number;
  myHistory: LeaveEntry[];
  pendingForApproval: PendingLeave[];
  isApprover: boolean;
  peopleForSelect: Array<{ id: string; name: string }>;
}) {
  const router = useRouter();
  const [showForm, setShowForm] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [form, setForm] = useState({
    employeeId: currentUserId,
    fromDate: "",
    toDate: "",
    type: "Casual",
    reason: "",
  });

  async function submitLeave() {
    if (!form.employeeId || !form.fromDate || !form.toDate) return;
    if (form.toDate < form.fromDate) {
      setError("End date must be on or after the start date.");
      return;
    }
    setBusy(true);
    setError(null);
    const res = await fetch("/api/operations", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        start: "form",
        name: "leave.request",
        args: {
          employeeId: form.employeeId,
          fromDate: form.fromDate,
          toDate: form.toDate,
          type: form.type,
          reason: form.reason || undefined,
        },
      }),
    });
    const data = await res.json();
    setBusy(false);
    if (data.status === "ran") {
      setShowForm(false);
      setForm({ ...form, fromDate: "", toDate: "", reason: "" });
      router.refresh();
    } else {
      setError(data.detail ?? data.opaqueMessage ?? "Could not submit that request.");
    }
  }

  async function approve(leaveId: string) {
    setBusy(true);
    const res = await fetch("/api/operations", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ start: "form", name: "leave.approve", args: { leaveId } }),
    });
    await res.json();
    setBusy(false);
    router.refresh();
  }

  async function decline(leaveId: string, reason: string) {
    if (!reason.trim()) return;
    setBusy(true);
    const res = await fetch("/api/operations", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        start: "form",
        name: "leave.decline",
        args: { leaveId, reason },
      }),
    });
    await res.json();
    setBusy(false);
    setDecliningId(null);
    setDeclineReason("");
    router.refresh();
  }

  const [decliningId, setDecliningId] = useState<string | null>(null);
  const [declineReason, setDeclineReason] = useState("");

  return (
    <div className="space-y-6 p-6">
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
        <section className="rounded-2xl border border-black/[.08] bg-white p-5 dark:border-white/[.12] dark:bg-black">
          <h2 className="mb-2 text-sm font-medium uppercase tracking-wide text-zinc-500">My balance</h2>
          {myBalance === undefined ? (
            <p className="text-sm text-zinc-400">Leave balance is not available.</p>
          ) : (
            <div className="flex items-baseline gap-2">
              <span className="text-4xl font-semibold text-teal-700 dark:text-teal-400">{myBalance}</span>
              <span className="text-sm text-zinc-400">days remaining</span>
            </div>
          )}
        </section>

        <section className="lg:col-span-2 rounded-2xl border border-black/[.08] bg-white p-5 dark:border-white/[.12] dark:bg-black">
          <div className="flex items-center justify-between">
            <h2 className="text-sm font-medium uppercase tracking-wide text-zinc-500">Request leave</h2>
            <button
              onClick={() => setShowForm(!showForm)}
              className="rounded-lg bg-teal-700 px-4 py-1.5 text-sm font-medium text-white"
            >
              {showForm ? "Close" : "+ New request"}
            </button>
          </div>
          {showForm && (
            <div className="mt-4 space-y-3">
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                <label className="text-xs text-zinc-500">
                  For
                  <select
                    value={form.employeeId}
                    onChange={(e) => setForm({ ...form, employeeId: e.target.value })}
                    className="mt-1 w-full rounded-lg border border-black/[.12] px-3 py-2 text-sm dark:border-white/[.2] dark:bg-black dark:text-zinc-50"
                  >
                    {peopleForSelect.map((p) => (
                      <option key={p.id} value={p.id}>
                        {p.name}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="text-xs text-zinc-500">
                  Type
                  <select
                    value={form.type}
                    onChange={(e) => setForm({ ...form, type: e.target.value })}
                    className="mt-1 w-full rounded-lg border border-black/[.12] px-3 py-2 text-sm dark:border-white/[.2] dark:bg-black dark:text-zinc-50"
                  >
                    {LEAVE_TYPES.map((t) => (
                      <option key={t} value={t}>
                        {t}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="text-xs text-zinc-500">
                  From
                  <input
                    type="date"
                    value={form.fromDate}
                    onChange={(e) => setForm({ ...form, fromDate: e.target.value })}
                    className="mt-1 w-full rounded-lg border border-black/[.12] px-3 py-2 text-sm dark:border-white/[.2] dark:bg-black dark:text-zinc-50"
                  />
                </label>
                <label className="text-xs text-zinc-500">
                  To
                  <input
                    type="date"
                    value={form.toDate}
                    onChange={(e) => setForm({ ...form, toDate: e.target.value })}
                    className="mt-1 w-full rounded-lg border border-black/[.12] px-3 py-2 text-sm dark:border-white/[.2] dark:bg-black dark:text-zinc-50"
                  />
                </label>
              </div>
              <textarea
                value={form.reason}
                onChange={(e) => setForm({ ...form, reason: e.target.value })}
                placeholder="Reason (optional)"
                rows={2}
                className="w-full rounded-lg border border-black/[.12] px-3 py-2 text-sm dark:border-white/[.2] dark:bg-black dark:text-zinc-50"
              />
              {error && <p className="text-xs text-rose-600">{error}</p>}
              <button
                onClick={submitLeave}
                disabled={busy || !form.fromDate || !form.toDate}
                className="rounded-lg bg-black px-4 py-1.5 text-sm font-medium text-white disabled:opacity-40 dark:bg-white dark:text-black"
              >
                {busy ? "Submitting…" : "Submit request"}
              </button>
            </div>
          )}
        </section>
      </div>

      {isApprover && (
        <section className="rounded-2xl border border-amber-300 bg-amber-50 p-5 dark:border-amber-900 dark:bg-amber-950">
          <h2 className="mb-3 text-sm font-medium uppercase tracking-wide text-amber-700 dark:text-amber-400">
            Pending approvals
          </h2>
          {pendingForApproval.length === 0 ? (
            <p className="text-sm text-amber-800/70 dark:text-amber-300/70">Nothing waiting on you.</p>
          ) : (
            <div className="space-y-2">
              {pendingForApproval.map((l) => (
                <div
                  key={l.id}
                  className="flex flex-wrap items-center justify-between gap-2 rounded-lg bg-white/70 px-3 py-2 dark:bg-black/40"
                >
                  <div className="text-sm">
                    <span className="font-medium text-black dark:text-zinc-50">{l.employeeName}</span>
                    <span className="text-zinc-500"> · {l.fromDate} to {l.toDate}</span>
                    {l.type && <span className="ml-2 rounded-full bg-amber-100 px-2 py-0.5 text-xs text-amber-700">{l.type}</span>}
                    {l.clashes > 0 && (
                      <span className="ml-2 text-xs text-rose-600">⚠ {l.clashes} clash{clashes(l)}</span>
                    )}
                    {l.reason && <div className="text-xs text-zinc-400">“{l.reason}”</div>}
                  </div>
                  {decliningId === l.id ? (
                    <div className="flex items-center gap-2">
                      <input
                        autoFocus
                        value={declineReason}
                        onChange={(e) => setDeclineReason(e.target.value)}
                        placeholder="Reason for declining"
                        className="rounded-lg border border-black/[.12] px-2 py-1 text-xs dark:border-white/[.2] dark:bg-black dark:text-zinc-50"
                      />
                      <button
                        onClick={() => decline(l.id, declineReason)}
                        disabled={busy || !declineReason.trim()}
                        className="rounded-lg bg-rose-600 px-2 py-1 text-xs font-medium text-white disabled:opacity-40"
                      >
                        Confirm decline
                      </button>
                      <button onClick={() => setDecliningId(null)} className="text-xs text-zinc-500">
                        Cancel
                      </button>
                    </div>
                  ) : (
                    <div className="flex gap-2">
                      <button
                        onClick={() => approve(l.id)}
                        disabled={busy}
                        className="rounded-lg bg-teal-700 px-3 py-1 text-xs font-medium text-white disabled:opacity-40"
                      >
                        Approve
                      </button>
                      <button
                        onClick={() => {
                          setDecliningId(l.id);
                          setDeclineReason("");
                        }}
                        disabled={busy}
                        className="rounded-lg border border-rose-300 px-3 py-1 text-xs font-medium text-rose-600"
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

      <section>
        <h2 className="mb-3 text-sm font-medium uppercase tracking-wide text-zinc-500">My history</h2>
        {myHistory.length === 0 ? (
          <p className="text-sm text-zinc-400">No leave requests yet.</p>
        ) : (
          <div className="overflow-hidden rounded-xl border border-black/[.08] dark:border-white/[.12]">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-black/[.08] bg-zinc-50 text-left text-xs uppercase tracking-wide text-zinc-400 dark:border-white/[.1] dark:bg-zinc-900">
                  <th className="px-4 py-2">From</th>
                  <th className="px-4 py-2">To</th>
                  <th className="px-4 py-2">Type</th>
                  <th className="px-4 py-2">Status</th>
                  <th className="px-4 py-2">Notes</th>
                </tr>
              </thead>
              <tbody>
                {myHistory.map((l) => (
                  <tr key={l.id} className="border-b border-black/[.04] last:border-0 dark:border-white/[.04]">
                    <td className="px-4 py-2 text-zinc-600 dark:text-zinc-300">{l.fromDate}</td>
                    <td className="px-4 py-2 text-zinc-600 dark:text-zinc-300">{l.toDate}</td>
                    <td className="px-4 py-2 text-zinc-500">{l.type ?? "—"}</td>
                    <td className="px-4 py-2">
                      <StatusBadge status={l.status} />
                    </td>
                    <td className="px-4 py-2 text-xs text-zinc-400">
                      {l.clashes > 0 && <span className="text-rose-500">clash flagged</span>}
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
    </div>
  );
}

function clashes(l: PendingLeave) {
  return l.clashes === 1 ? "" : "es";
}

function StatusBadge({ status }: { status: string }) {
  const colors: Record<string, string> = {
    Pending: "bg-amber-100 text-amber-700",
    Approved: "bg-teal-100 text-teal-700",
    Declined: "bg-rose-100 text-rose-700",
  };
  return (
    <span className={`rounded-full px-2 py-0.5 text-xs ${colors[status] ?? "bg-zinc-100 text-zinc-500"}`}>
      {status}
    </span>
  );
}
