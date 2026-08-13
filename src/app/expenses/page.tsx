import { redirect } from "next/navigation";
import { getSessionUser } from "@/server/auth";
import { getSpine, getWorld } from "@/server/runtime";
import { directory } from "@/server/directory";
import { Shell } from "../shell";

export default async function ExpensesPage() {
  const user = await getSessionUser();
  if (!user) redirect("/login");
  const { deps } = await getWorld();
  const spine = await getSpine();

  const mine = async (
    nodeType: string,
  ): Promise<Array<{ id: string } & Record<string, unknown>>> => {
    const nodes = await deps.graph.find(nodeType as never, () => true);
    const out: Array<{ id: string } & Record<string, unknown>> = [];
    for (const n of nodes) {
      const r = await spine.read({ actor: user.id, nodeType, nodeId: n.id });
      if (r.found) out.push({ id: n.id, ...(n.data as Record<string, unknown>) });
    }
    return out;
  };

  const claimRows = (d: Record<string, unknown>) => ({
    id: String(d.id),
    employeeName:
      directory().get(String(d.employee ?? ""))?.name ??
      String(d.employeeName ?? d.employee ?? ""),
    date: String(d.expenseDate ?? d.fromDate ?? ""),
    amount: (d.totalAmount ?? d.estimatedAmount ?? d.advanceAmount) as number | undefined,
    status: String(d.status ?? ""),
    description: String(d.description ?? d.purpose ?? ""),
  });

  const claims = (await mine("expense-claim")).map(claimRows);
  const travel = (await mine("travel-request")).map(claimRows);
  const advances = (await mine("employee-advance")).map(claimRows);

  return (
    <Shell>
      <header className="border-b border-black/[.08] px-6 py-4 dark:border-white/[.1]">
        <h1 className="text-xl font-semibold text-black dark:text-zinc-50">Expenses & travel</h1>
        <p className="text-sm text-zinc-400">Claims · travel requests · advances</p>
      </header>
      <div className="space-y-6 p-6">
        <ClaimTable title="Expense claims" rows={claims} />
        <ClaimTable title="Travel requests" rows={travel} />
        <ClaimTable title="Employee advances" rows={advances} />
        <p className="text-xs text-zinc-400">
          Approval and accounting posting happen in N1 — submit via N1 and they appear here on read-through.
        </p>
      </div>
    </Shell>
  );
}

function ClaimTable({
  title,
  rows,
}: {
  title: string;
  rows: Array<{ id: string; employeeName: string; date: string; amount?: number; status: string; description: string }>;
}) {
  return (
    <section className="rounded-2xl border border-black/[.08] bg-white p-5 dark:border-white/[.12] dark:bg-black">
      <h2 className="mb-3 text-sm font-medium uppercase tracking-wide text-zinc-500">{title} ({rows.length})</h2>
      {rows.length === 0 ? (
        <p className="text-sm text-zinc-400">None.</p>
      ) : (
        <div className="overflow-hidden rounded-xl border border-black/[.06] dark:border-white/[.08]">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-black/[.06] bg-zinc-50 text-left text-xs uppercase tracking-wide text-zinc-400 dark:border-white/[.1] dark:bg-zinc-900">
                <th className="px-4 py-2">Employee</th>
                <th className="px-4 py-2">Date</th>
                <th className="px-4 py-2">Description</th>
                <th className="px-4 py-2">Amount</th>
                <th className="px-4 py-2">Status</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.id} className="border-b border-black/[.04] last:border-0 dark:border-white/[.04]">
                  <td className="px-4 py-2 font-medium text-black dark:text-zinc-50">{r.employeeName}</td>
                  <td className="px-4 py-2 text-zinc-500">{r.date}</td>
                  <td className="px-4 py-2 text-zinc-500">{r.description}</td>
                  <td className="px-4 py-2 text-zinc-500">{r.amount !== undefined ? `₹${r.amount.toLocaleString()}` : "—"}</td>
                  <td className="px-4 py-2">
                    <span className={`rounded-full px-2 py-0.5 text-xs ${r.status === "Draft" || r.status === "Applied" ? "bg-amber-100 text-amber-700" : r.status === "Unpaid" ? "bg-rose-100 text-rose-700" : "bg-teal-100 text-teal-700"}`}>{r.status}</span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}
