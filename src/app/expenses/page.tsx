import { redirect } from "next/navigation";
import { getSessionUser } from "@/server/auth";
import { getSpine } from "@/server/runtime";
import { directory } from "@/server/directory";
import { isApprover as roleIsApprover } from "@/server/roles";
import { Shell } from "../shell";
import { ExpensesClient } from "./expenses-client";

export default async function ExpensesPage() {
  const user = await getSessionUser();
  if (!user) redirect("/login");
  const spine = await getSpine();

  // The gate decides what is visible: your own claims, your team's if you are
  // a manager, everyone's if you are HR/admin. Never the raw graph.
  const visible = await spine.readMany({ actor: user.id, nodeType: "expense-claim" });

  const rows = visible.map(({ nodeId, record }) => {
    const d = record as Record<string, unknown>;
    const employee = String(d.employee ?? "");
    return {
      id: nodeId,
      employee,
      employeeName: String(d.employeeName ?? directory().nameOf(employee) ?? employee),
      date: String(d.expenseDate ?? ""),
      amount: Number(d.totalAmount ?? 0),
      category: d.category ? String(d.category) : undefined,
      description: String(d.description ?? ""),
      status: String(d.status ?? ""),
      reason: d.reason ? String(d.reason) : undefined,
      approvedBy: d.approvedBy ? String(d.approvedBy) : undefined,
      declinedBy: d.declinedBy ? String(d.declinedBy) : undefined,
    };
  });

  const byDateDesc = (a: { date: string }, b: { date: string }) => (a.date < b.date ? 1 : -1);
  const myClaims = rows.filter((r) => r.employee === user.id).sort(byDateDesc);
  // Everything else Pending that scoping let this person see. The buttons are
  // rendered and the gate refuses opaquely if approval is outside their reach.
  const pendingForApproval = rows
    .filter((r) => r.employee !== user.id && r.status === "Pending")
    .sort(byDateDesc);

  return (
    <Shell>
      <header className="rise px-4 pt-6 sm:px-6">
        <h1 className="text-2xl font-light tracking-tight text-ink sm:text-3xl">
          Your <span className="font-extrabold">expenses</span>
        </h1>
        <p className="mt-1 text-sm text-ink-soft">Claims, reimbursements and approvals.</p>
      </header>
      <ExpensesClient
        currentUserId={user.id}
        myClaims={myClaims}
        pendingForApproval={pendingForApproval}
        isApprover={roleIsApprover(user.role)}
      />
    </Shell>
  );
}
