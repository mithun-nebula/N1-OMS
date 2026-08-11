import { redirect } from "next/navigation";
import { getSessionUser } from "@/server/auth";
import { getSpine, getWorld } from "@/server/runtime";
import { DEMO_PEOPLE } from "@/domains/shared/people-roster";
import { Shell } from "../shell";
import { PayrollClient } from "./payroll-client";

export default async function PayrollPage() {
  const user = await getSessionUser();
  if (!user) redirect("/login");
  if (!["super-admin", "admin", "hr"].includes(user.role)) redirect("/dashboard");

  const { deps } = await getWorld();
  const spine = await getSpine();

  const readVisible = async (nodeType: string): Promise<Array<Record<string, unknown>>> => {
    const nodes = await deps.graph.find(nodeType as never, () => true);
    const out: Array<Record<string, unknown>> = [];
    for (const n of nodes) {
      const r = await spine.read({ actor: user.id, nodeType, nodeId: n.id });
      if (r.found) out.push({ id: n.id, ...(n.data as Record<string, unknown>) });
    }
    return out;
  };

  const payslips = (await readVisible("payslip")).map((d) => ({
    id: String(d.id),
    employee: String(d.employee ?? ""),
    employeeName: DEMO_PEOPLE[String(d.employee ?? "")]?.name ?? String(d.employeeName ?? ""),
    month: String(d.month ?? d.postingDate ?? ""),
    grossPay: d.grossPay as number | undefined,
    netPay: d.netPay as number | undefined,
    status: String(d.status ?? ""),
  }));

  const structures = (await readVisible("salary-structure")).map((d) => ({
    id: String(d.id),
    name: String(d.name ?? ""),
    status: String(d.status ?? ""),
    currency: String(d.currency ?? "INR"),
  }));

  const taxSlabs = (await readVisible("income-tax-slab")).map((d) => ({
    id: String(d.id),
    name: String(d.name ?? ""),
    status: String(d.status ?? ""),
  }));

  return (
    <Shell>
      <header className="border-b border-black/[.08] px-6 py-4 dark:border-white/[.1]">
        <h1 className="text-xl font-semibold text-black dark:text-zinc-50">Payroll</h1>
        <p className="text-sm text-zinc-400">Payslips · salary structures · income-tax slabs (HR/admin)</p>
      </header>
      <PayrollClient payslips={payslips} structures={structures} taxSlabs={taxSlabs} />
    </Shell>
  );
}
