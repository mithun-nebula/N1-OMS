"use client";

import { SectionTitle } from "../ui/kit";

export function PayrollClient({
  structures,
  taxSlabs,
}: {
  structures: Array<{ id: string; name: string; status: string; currency: string }>;
  taxSlabs: Array<{ id: string; name: string; status: string }>;
}) {
  return (
    <div className="mx-auto max-w-4xl space-y-5 p-4 sm:p-6">
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
