"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

interface LeaveRow {
  id: string;
  fromDate: string;
  toDate: string;
  type?: string;
  status: string;
}

interface AttendanceRow {
  id: string;
  date: string;
  status: string;
  checkIn?: string;
  checkOut?: string;
}

interface PayslipRow {
  id: string;
  period: string;
  amount?: number;
}

export function ProfileClient({
  employeeId,
  name,
  role,
  team,
  contact,
  pay,
  leaveBalance,
  leaveHistory,
  attendance,
  payslips,
  payRestricted,
  performanceRestricted,
  canEdit,
}: {
  employeeId: string;
  name: string;
  role: string;
  team?: string;
  contact?: string;
  pay?: number | string;
  leaveBalance?: number;
  leaveHistory: LeaveRow[];
  attendance: AttendanceRow[];
  payslips: PayslipRow[];
  payRestricted: boolean;
  performanceRestricted: boolean;
  canEdit: boolean;
}) {
  const router = useRouter();
  const [editing, setEditing] = useState(false);
  const [contactValue, setContactValue] = useState(contact ?? "");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function saveContact() {
    if (!contactValue.trim()) return;
    setBusy(true);
    setError(null);
    const res = await fetch("/api/operations", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        start: "form",
        name: "employee.updateContact",
        args: { employeeId, contact: contactValue.trim() },
      }),
    });
    const data = await res.json();
    setBusy(false);
    if (data.status === "ran") {
      setEditing(false);
      router.refresh();
    } else {
      setError(data.detail ?? data.opaqueMessage ?? "Could not update contact.");
    }
  }

  return (
    <div className="space-y-6 p-6">
      <section className="rounded-2xl border border-black/[.08] bg-white p-5 dark:border-white/[.12] dark:bg-black">
        <h2 className="mb-4 text-sm font-medium uppercase tracking-wide text-zinc-500">Employee record</h2>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <Field label="Name" value={name} />
          <Field label="Role" value={role} />
          <Field label="Team" value={team ?? "—"} />
          <div>
            <div className="text-xs uppercase tracking-wide text-zinc-400">Contact</div>
            {editing ? (
              <div className="mt-1 flex items-center gap-2">
                <input
                  value={contactValue}
                  onChange={(e) => setContactValue(e.target.value)}
                  className="flex-1 rounded-lg border border-black/[.12] px-3 py-1.5 text-sm dark:border-white/[.2] dark:bg-black dark:text-zinc-50"
                />
                <button
                  onClick={saveContact}
                  disabled={busy || !contactValue.trim()}
                  className="rounded-lg bg-teal-700 px-3 py-1.5 text-xs font-medium text-white disabled:opacity-40"
                >
                  Save
                </button>
                <button onClick={() => { setEditing(false); setContactValue(contact ?? ""); }} className="text-xs text-zinc-500">
                  Cancel
                </button>
              </div>
            ) : (
              <div className="mt-1 flex items-center gap-2">
                <span className="text-sm text-black dark:text-zinc-100">{contact ?? "—"}</span>
                {canEdit && (
                  <button onClick={() => setEditing(true)} className="text-xs text-teal-700 dark:text-teal-400">
                    Edit
                  </button>
                )}
              </div>
            )}
            {error && <p className="mt-1 text-xs text-rose-600">{error}</p>}
          </div>
          <Field label="Pay" value={payRestricted ? undefined : pay !== undefined ? String(pay) : undefined} restricted={payRestricted} />
          <Field label="Performance" value={undefined} restricted={performanceRestricted} />
        </div>
      </section>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        <section className="rounded-2xl border border-black/[.08] bg-white p-5 dark:border-white/[.12] dark:bg-black">
          <h2 className="mb-3 text-sm font-medium uppercase tracking-wide text-zinc-500">Leave</h2>
          <div className="mb-3 flex items-baseline gap-2">
            <span className="text-3xl font-semibold text-teal-700 dark:text-teal-400">{leaveBalance ?? "—"}</span>
            <span className="text-xs text-zinc-400">days remaining</span>
          </div>
          {leaveHistory.length === 0 ? (
            <p className="text-sm text-zinc-400">No leave requests.</p>
          ) : (
            <div className="space-y-1">
              {leaveHistory.slice(0, 6).map((l) => (
                <div key={l.id} className="flex items-center justify-between rounded-lg bg-zinc-50 px-3 py-1.5 text-xs dark:bg-zinc-900">
                  <span className="text-zinc-600 dark:text-zinc-300">{l.fromDate} → {l.toDate}{l.type ? ` · ${l.type}` : ""}</span>
                  <StatusBadge status={l.status} />
                </div>
              ))}
            </div>
          )}
        </section>

        <section className="rounded-2xl border border-black/[.08] bg-white p-5 dark:border-white/[.12] dark:bg-black">
          <h2 className="mb-3 text-sm font-medium uppercase tracking-wide text-zinc-500">Payslips</h2>
          {payslips.length === 0 ? (
            <p className="text-sm text-zinc-400">No payslips on file.</p>
          ) : (
            <div className="space-y-1">
              {payslips.map((p) => (
                <div key={p.id} className="flex items-center justify-between rounded-lg bg-zinc-50 px-3 py-1.5 text-xs dark:bg-zinc-900">
                  <span className="text-zinc-600 dark:text-zinc-300">{p.period}</span>
                  {p.amount !== undefined && <span className="font-medium text-black dark:text-zinc-100">₹{p.amount.toLocaleString()}</span>}
                </div>
              ))}
            </div>
          )}
        </section>
      </div>

      <section className="rounded-2xl border border-black/[.08] bg-white p-5 dark:border-white/[.12] dark:bg-black">
        <h2 className="mb-3 text-sm font-medium uppercase tracking-wide text-zinc-500">Attendance</h2>
        {attendance.length === 0 ? (
          <p className="text-sm text-zinc-400">No attendance records.</p>
        ) : (
          <div className="overflow-hidden rounded-xl border border-black/[.06] dark:border-white/[.08]">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-black/[.06] bg-zinc-50 text-left text-xs uppercase tracking-wide text-zinc-400 dark:border-white/[.1] dark:bg-zinc-900">
                  <th className="px-4 py-2">Date</th>
                  <th className="px-4 py-2">Status</th>
                  <th className="px-4 py-2">In</th>
                  <th className="px-4 py-2">Out</th>
                </tr>
              </thead>
              <tbody>
                {attendance.map((a) => (
                  <tr key={a.id} className="border-b border-black/[.04] last:border-0 dark:border-white/[.04]">
                    <td className="px-4 py-2 text-zinc-600 dark:text-zinc-300">{a.date}</td>
                    <td className="px-4 py-2"><StatusBadge status={a.status} /></td>
                    <td className="px-4 py-2 text-zinc-500">{a.checkIn ?? "—"}</td>
                    <td className="px-4 py-2 text-zinc-500">{a.checkOut ?? "—"}</td>
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

function Field({ label, value, restricted }: { label: string; value?: string; restricted?: boolean }) {
  return (
    <div>
      <div className="text-xs uppercase tracking-wide text-zinc-400">{label}</div>
      {restricted ? (
        <div className="mt-1 text-sm text-zinc-400">🔒 Restricted</div>
      ) : (
        <div className="mt-1 text-sm text-black dark:text-zinc-100">{value ?? "—"}</div>
      )}
    </div>
  );
}

function StatusBadge({ status }: { status: string }) {
  const colors: Record<string, string> = {
    Pending: "bg-amber-100 text-amber-700",
    Approved: "bg-teal-100 text-teal-700",
    Declined: "bg-rose-100 text-rose-700",
    Present: "bg-teal-100 text-teal-700",
    Absent: "bg-rose-100 text-rose-700",
    "Half Day": "bg-amber-100 text-amber-700",
    "Work From Home": "bg-zinc-100 text-zinc-600",
  };
  return (
    <span className={`rounded-full px-2 py-0.5 text-xs ${colors[status] ?? "bg-zinc-100 text-zinc-500"}`}>
      {status}
    </span>
  );
}
