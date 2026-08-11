"use client";

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
    <div className="space-y-6 p-6">
      <section className="rounded-2xl border border-black/[.08] bg-white p-5 dark:border-white/[.12] dark:bg-black">
        <h2 className="mb-3 text-sm font-medium uppercase tracking-wide text-zinc-500">Payslips ({payslips.length})</h2>
        {payslips.length === 0 ? (
          <p className="text-sm text-zinc-400">No payslips on file. Connect N1 for live payroll.</p>
        ) : (
          <div className="overflow-hidden rounded-xl border border-black/[.06] dark:border-white/[.08]">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-black/[.06] bg-zinc-50 text-left text-xs uppercase tracking-wide text-zinc-400 dark:border-white/[.1] dark:bg-zinc-900">
                  <th className="px-4 py-2">Employee</th>
                  <th className="px-4 py-2">Period</th>
                  <th className="px-4 py-2">Gross</th>
                  <th className="px-4 py-2">Net</th>
                  <th className="px-4 py-2">Status</th>
                </tr>
              </thead>
              <tbody>
                {payslips.map((p) => (
                  <tr key={p.id} className="border-b border-black/[.04] last:border-0 dark:border-white/[.04]">
                    <td className="px-4 py-2 font-medium text-black dark:text-zinc-50">{p.employeeName}</td>
                    <td className="px-4 py-2 text-zinc-500">{p.month}</td>
                    <td className="px-4 py-2 text-zinc-500">{p.grossPay !== undefined ? `₹${p.grossPay.toLocaleString()}` : "—"}</td>
                    <td className="px-4 py-2 font-medium text-black dark:text-zinc-100">{p.netPay !== undefined ? `₹${p.netPay.toLocaleString()}` : "—"}</td>
                    <td className="px-4 py-2"><span className="rounded-full bg-teal-100 px-2 py-0.5 text-xs text-teal-700">{p.status}</span></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        <section className="rounded-2xl border border-black/[.08] bg-white p-5 dark:border-white/[.12] dark:bg-black">
          <h2 className="mb-3 text-sm font-medium uppercase tracking-wide text-zinc-500">Salary structures ({structures.length})</h2>
          {structures.length === 0 ? <p className="text-sm text-zinc-400">None.</p> : (
            <div className="space-y-1">
              {structures.map((s) => (
                <div key={s.id} className="flex items-center justify-between rounded-lg bg-zinc-50 px-3 py-1.5 text-xs dark:bg-zinc-900">
                  <span className="text-zinc-600 dark:text-zinc-300">{s.name}</span>
                  <span className="text-zinc-400">{s.currency} · {s.status}</span>
                </div>
              ))}
            </div>
          )}
        </section>

        <section className="rounded-2xl border border-black/[.08] bg-white p-5 dark:border-white/[.12] dark:bg-black">
          <h2 className="mb-3 text-sm font-medium uppercase tracking-wide text-zinc-500">Income-tax slabs ({taxSlabs.length})</h2>
          {taxSlabs.length === 0 ? <p className="text-sm text-zinc-400">None.</p> : (
            <div className="space-y-1">
              {taxSlabs.map((s) => (
                <div key={s.id} className="flex items-center justify-between rounded-lg bg-zinc-50 px-3 py-1.5 text-xs dark:bg-zinc-900">
                  <span className="text-zinc-600 dark:text-zinc-300">{s.name}</span>
                  <span className="text-zinc-400">{s.status}</span>
                </div>
              ))}
            </div>
          )}
        </section>
      </div>

      <p className="text-xs text-zinc-400">
        Payroll runs, gratuity, benefits and statutory compliance (PF/ESI/TDS) flow through N1 directly —
        browse any DocType in <a href="/records" className="text-teal-700 dark:text-teal-400">Records</a>.
      </p>
    </div>
  );
}
