"use client";

import { Empty, SectionTitle } from "../ui/kit";

interface Payslip {
  id: string;
  employee: string;
  employeeName: string;
  month: string;
  grossPay?: number;
  netPay?: number;
  status: string;
}

export function PayrollClient({
  payslips,
  structures,
  taxSlabs,
}: {
  payslips: Payslip[];
  structures: Array<{ id: string; name: string; status: string; currency: string }>;
  taxSlabs: Array<{ id: string; name: string; status: string }>;
}) {
  return (
    <div className="mx-auto max-w-4xl space-y-5 p-4 sm:p-6">
      <section className="rise rounded-3xl bg-surface p-5 shadow-card" style={{ animationDelay: "60ms" }}>
        <SectionTitle>Payslips ({payslips.length})</SectionTitle>
        {payslips.length === 0 ? (
          <Empty icon="grid" text="No payslips on file. Connect N1 for live payroll." />
        ) : (
          <div className="mt-3 overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-[10px] uppercase tracking-widest text-ink-faint">
                  <th className="px-3 py-2 font-semibold">Employee</th>
                  <th className="px-3 py-2 font-semibold">Period</th>
                  <th className="px-3 py-2 font-semibold">Gross</th>
                  <th className="px-3 py-2 font-semibold">Net</th>
                  <th className="px-3 py-2 font-semibold">Status</th>
                </tr>
              </thead>
              <tbody>
                {payslips.map((p) => (
                  <tr key={p.id} className="border-t border-line transition-colors hover:bg-raised">
                    <td className="px-3 py-2.5 text-[13px] font-semibold text-ink">{p.employeeName}</td>
                    <td className="px-3 py-2.5 text-[13px] text-ink-soft">{p.month}</td>
                    <td className="px-3 py-2.5 text-[13px] text-ink-soft">
                      {p.grossPay !== undefined ? `₹${p.grossPay.toLocaleString()}` : "—"}
                    </td>
                    <td className="px-3 py-2.5 text-[13px] font-semibold text-ink">
                      {p.netPay !== undefined ? `₹${p.netPay.toLocaleString()}` : "—"}
                    </td>
                    <td className="px-3 py-2.5">
                      <span className="rounded-full bg-mint px-2.5 py-0.5 text-[11px] font-semibold text-mint-strong">
                        {p.status}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <div className="grid grid-cols-1 gap-5 lg:grid-cols-2">
        <section className="rise rounded-3xl bg-surface p-5 shadow-card" style={{ animationDelay: "110ms" }}>
          <SectionTitle>Salary structures ({structures.length})</SectionTitle>
          {structures.length === 0 ? (
            <p className="mt-3 text-xs text-ink-faint">None.</p>
          ) : (
            <div className="mt-3 space-y-1.5">
              {structures.map((s) => (
                <div key={s.id} className="flex items-center justify-between gap-2 rounded-xl bg-raised px-3 py-2 text-xs">
                  <span className="text-ink">{s.name}</span>
                  <span className="text-ink-faint">{s.currency} · {s.status}</span>
                </div>
              ))}
            </div>
          )}
        </section>

        <section className="rise rounded-3xl bg-surface p-5 shadow-card" style={{ animationDelay: "160ms" }}>
          <SectionTitle>Income-tax slabs ({taxSlabs.length})</SectionTitle>
          {taxSlabs.length === 0 ? (
            <p className="mt-3 text-xs text-ink-faint">None.</p>
          ) : (
            <div className="mt-3 space-y-1.5">
              {taxSlabs.map((s) => (
                <div key={s.id} className="flex items-center justify-between gap-2 rounded-xl bg-raised px-3 py-2 text-xs">
                  <span className="text-ink">{s.name}</span>
                  <span className="text-ink-faint">{s.status}</span>
                </div>
              ))}
            </div>
          )}
        </section>
      </div>

      <p className="rise text-xs text-ink-faint" style={{ animationDelay: "210ms" }}>
        Payroll runs, gratuity, benefits and statutory compliance (PF/ESI/TDS) flow through N1 directly —
        browse any DocType in <a href="/records" className="font-medium text-accent-strong hover:underline">Records</a>.
      </p>
    </div>
  );
}
