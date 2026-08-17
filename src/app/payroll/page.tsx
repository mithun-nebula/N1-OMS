import { redirect } from "next/navigation";
import { getSessionUser } from "@/server/auth";
import { getSpine, getWorld } from "@/server/runtime";
import { directory } from "@/server/directory";
import { isHrLike } from "@/server/roles";
import { Shell } from "../shell";
import { PayrollClient } from "./payroll-client";

export default async function PayrollPage() {
  const user = await getSessionUser();
  if (!user) redirect("/login");
  if (!isHrLike(user.role)) redirect("/dashboard");

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
    employeeName:
      directory().get(String(d.employee ?? ""))?.name ??
      String(d.employeeName ?? d.employee ?? ""),
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
      <header className="rise flex flex-wrap items-center justify-between gap-3 px-4 pt-6 sm:px-6">
        <h1 className="text-2xl font-light tracking-tight text-ink sm:text-3xl">
          Payroll <span className="font-extrabold">runs</span>
        </h1>
        <p className="text-sm text-ink-soft">Payslips · salary structures · income-tax slabs</p>
      </header>
      <PayrollClient payslips={payslips} structures={structures} taxSlabs={taxSlabs} />
    </Shell>
  );
}
