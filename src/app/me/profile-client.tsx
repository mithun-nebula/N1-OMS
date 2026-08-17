"use client";

import { useState } from "react";
import { Avatar, Empty, inputCls, OpFeedback, SectionTitle, StatusBadge } from "../ui/kit";
import { useOperation } from "@/components/ops/use-operation";

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
  const op = useOperation();
  const busy = op.busy;
  const [editing, setEditing] = useState(false);
  const [contactValue, setContactValue] = useState(contact ?? "");

  async function saveContact() {
    if (!contactValue.trim()) return;
    const outcome = await op.run("employee.updateContact", {
      employeeId,
      contact: contactValue.trim(),
    });
    if (outcome.status === "ran") setEditing(false);
  }

  return (
    <div className="mx-auto max-w-4xl space-y-5 p-4 sm:p-6">
      {/* Employee record. */}
      <section className="rise rounded-3xl bg-surface p-5 shadow-card" style={{ animationDelay: "60ms" }}>
        <SectionTitle>Employee record</SectionTitle>
        <div className="mt-4 flex items-center gap-3">
          <Avatar name={name} size={44} />
          <div className="min-w-0">
            <div className="text-[15px] font-semibold text-ink">{name}</div>
            <div className="text-xs text-ink-soft">
              {role}
              {team ? ` · ${team}` : ""}
            </div>
          </div>
        </div>
        <div className="mt-4 grid grid-cols-1 gap-2.5 sm:grid-cols-2">
          <div className="rounded-xl bg-raised px-3.5 py-2.5">
            <div className="text-[10px] font-semibold uppercase tracking-widest text-ink-faint">Contact</div>
            {editing ? (
              <div className="pop-in mt-1.5 flex items-center gap-2">
                <input
                  value={contactValue}
                  onChange={(e) => setContactValue(e.target.value)}
                  className={`${inputCls} flex-1`}
                />
                <button
                  onClick={saveContact}
                  disabled={busy || !contactValue.trim()}
                  className="press rounded-lg bg-chrome px-2.5 py-1.5 text-[11px] font-semibold text-chrome-ink disabled:opacity-40"
                >
                  Save
                </button>
                <button
                  onClick={() => { setEditing(false); setContactValue(contact ?? ""); }}
                  className="text-[11px] font-medium text-ink-faint hover:text-ink"
                >
                  Cancel
                </button>
              </div>
            ) : (
              <div className="mt-1 flex items-center gap-2">
                <span className="text-[13px] text-ink">{contact ?? "—"}</span>
                {canEdit && (
                  <button
                    onClick={() => setEditing(true)}
                    className="press text-[11px] font-medium text-accent-strong hover:underline"
                  >
                    Edit
                  </button>
                )}
              </div>
            )}
          </div>
          <Field
            label="Pay"
            value={payRestricted ? undefined : pay !== undefined ? String(pay) : undefined}
            restricted={payRestricted}
          />
          <Field label="Performance" value={undefined} restricted={performanceRestricted} />
        </div>
      </section>

      <div className="grid grid-cols-1 gap-5 lg:grid-cols-2">
        {/* Leave — the one dark emphasis card on the page. */}
        <section className="rise rounded-3xl bg-chrome-card p-5 text-chrome-ink shadow-card" style={{ animationDelay: "110ms" }}>
          <h2 className="text-[11px] font-semibold uppercase tracking-widest text-chrome-soft">Leave</h2>
          <div className="mt-3 flex items-baseline gap-2">
            <span className="text-5xl font-extrabold text-accent">{leaveBalance ?? "—"}</span>
            <span className="text-sm text-chrome-soft">days remaining</span>
          </div>
          {leaveHistory.length === 0 ? (
            <p className="mt-4 text-sm text-chrome-soft">No leave requests.</p>
          ) : (
            <div className="mt-4 space-y-1.5">
              {leaveHistory.slice(0, 6).map((l) => (
                <div key={l.id} className="flex items-center justify-between gap-2 rounded-xl bg-chrome px-3 py-2 text-xs">
                  <span className="min-w-0 truncate text-chrome-soft">
                    {l.fromDate} → {l.toDate}
                    {l.type ? ` · ${l.type}` : ""}
                  </span>
                  <StatusBadge status={l.status} />
                </div>
              ))}
            </div>
          )}
        </section>

        {/* Payslips. */}
        <section className="rise rounded-3xl bg-surface p-5 shadow-card" style={{ animationDelay: "160ms" }}>
          <SectionTitle>Payslips</SectionTitle>
          {payslips.length === 0 ? (
            <Empty icon="grid" text="No payslips on file." />
          ) : (
            <div className="mt-3 space-y-1.5">
              {payslips.map((p) => (
                <div key={p.id} className="flex items-center justify-between gap-2 rounded-xl bg-raised px-3 py-2 text-xs">
                  <span className="text-ink-soft">{p.period}</span>
                  {p.amount !== undefined && (
                    <span className="font-semibold text-ink">₹{p.amount.toLocaleString()}</span>
                  )}
                </div>
              ))}
            </div>
          )}
        </section>
      </div>

      {/* Attendance. */}
      <section className="rise rounded-3xl bg-surface p-5 shadow-card" style={{ animationDelay: "210ms" }}>
        <SectionTitle>Attendance</SectionTitle>
        {attendance.length === 0 ? (
          <Empty icon="clock" text="No attendance records." />
        ) : (
          <div className="mt-3 overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-[10px] uppercase tracking-widest text-ink-faint">
                  <th className="px-3 py-2 font-semibold">Date</th>
                  <th className="px-3 py-2 font-semibold">Status</th>
                  <th className="px-3 py-2 font-semibold">In</th>
                  <th className="px-3 py-2 font-semibold">Out</th>
                </tr>
              </thead>
              <tbody>
                {attendance.map((a) => (
                  <tr key={a.id} className="border-t border-line transition-colors hover:bg-raised">
                    <td className="px-3 py-2.5 text-[13px] text-ink">{a.date}</td>
                    <td className="px-3 py-2.5"><AttendanceBadge status={a.status} /></td>
                    <td className="px-3 py-2.5 text-[13px] text-ink-soft">{a.checkIn ?? "—"}</td>
                    <td className="px-3 py-2.5 text-[13px] text-ink-soft">{a.checkOut ?? "—"}</td>
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

function Field({ label, value, restricted }: { label: string; value?: string; restricted?: boolean }) {
  return (
    <div className="rounded-xl bg-raised px-3.5 py-2.5">
      <div className="text-[10px] font-semibold uppercase tracking-widest text-ink-faint">{label}</div>
      {restricted ? (
        <div className="mt-1 text-[13px] text-ink-faint">🔒 Restricted</div>
      ) : (
        <div className="mt-1 text-[13px] text-ink">{value ?? "—"}</div>
      )}
    </div>
  );
}

/** Attendance has its own status vocabulary — map it onto the category pastels. */
function AttendanceBadge({ status }: { status: string }) {
  const styles: Record<string, string> = {
    Present: "bg-mint text-mint-strong",
    Absent: "bg-rose text-rose-strong",
    "Half Day": "bg-peach text-peach-strong",
    "Work From Home": "bg-lilac text-lilac-strong",
  };
  return (
    <span className={`rounded-full px-2.5 py-0.5 text-[11px] font-semibold ${styles[status] ?? "bg-raised text-ink-faint"}`}>
      {status}
    </span>
  );
}
