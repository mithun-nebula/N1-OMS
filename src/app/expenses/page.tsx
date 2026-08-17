import { redirect } from "next/navigation";
import { getSessionUser } from "@/server/auth";
import { getSpine, getWorld } from "@/server/runtime";
import { directory } from "@/server/directory";
import { Shell } from "../shell";
import { Icon } from "../ui/icons";
import { Empty, SectionTitle } from "../ui/kit";

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
      <header className="rise flex flex-wrap items-center justify-between gap-3 px-4 pt-6 sm:px-6">
        <div>
          <h1 className="text-2xl font-light tracking-tight text-ink sm:text-3xl">
            Expenses <span className="font-extrabold">&amp; travel</span>
          </h1>
          <p className="mt-1 text-sm text-ink-soft">Claims, travel requests and advances.</p>
        </div>
      </header>
      <div className="mx-auto max-w-4xl space-y-5 p-4 sm:p-6">
        <ClaimTable title="Expense claims" rows={claims} index={0} />
        <ClaimTable title="Travel requests" rows={travel} index={1} />
        <ClaimTable title="Employee advances" rows={advances} index={2} />
        <div
          className="rise flex items-center gap-3 rounded-2xl bg-raised px-4 py-3"
          style={{ animationDelay: "260ms" }}
        >
          <span className="grid h-8 w-8 shrink-0 place-items-center rounded-full bg-accent-soft text-accent-strong">
            <Icon name="spark" className="h-4 w-4" />
          </span>
          <p className="text-xs text-ink-faint">
            This page is read-only for now — approval and accounting posting happen in N1.
            Submit via N1 and your records appear here on read-through.
          </p>
        </div>
      </div>
    </Shell>
  );
}

function statusPill(status: string) {
  if (status === "Draft" || status === "Applied") return "bg-peach text-peach-strong";
  if (status === "Unpaid") return "bg-rose text-rose-strong";
  return "bg-mint text-mint-strong";
}

function ClaimTable({
  title,
  rows,
  index,
}: {
  title: string;
  rows: Array<{ id: string; employeeName: string; date: string; amount?: number; status: string; description: string }>;
  index: number;
}) {
  return (
    <section
      className="rise rounded-3xl bg-surface p-5 shadow-card"
      style={{ animationDelay: `${60 + index * 60}ms` }}
    >
      <SectionTitle>
        {title} ({rows.length})
      </SectionTitle>
      {rows.length === 0 ? (
        <Empty icon="booking" text={`No ${title.toLowerCase()} to show yet.`} />
      ) : (
        <div className="mt-3 overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-[10px] uppercase tracking-widest text-ink-faint">
                <th className="px-3 py-2 font-semibold">Employee</th>
                <th className="px-3 py-2 font-semibold">Date</th>
                <th className="px-3 py-2 font-semibold">Description</th>
                <th className="px-3 py-2 font-semibold">Amount</th>
                <th className="px-3 py-2 font-semibold">Status</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.id} className="border-t border-line transition-colors hover:bg-raised">
                  <td className="px-3 py-2.5 text-[13px] font-medium text-ink">{r.employeeName}</td>
                  <td className="px-3 py-2.5 text-[13px] text-ink-soft">{r.date}</td>
                  <td className="px-3 py-2.5 text-[13px] text-ink-soft">{r.description}</td>
                  <td className="px-3 py-2.5 text-[13px] text-ink-soft">
                    {r.amount !== undefined ? `₹${r.amount.toLocaleString()}` : "—"}
                  </td>
                  <td className="px-3 py-2.5">
                    <span className={`rounded-full px-2.5 py-0.5 text-[11px] font-semibold ${statusPill(r.status)}`}>
                      {r.status}
                    </span>
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
