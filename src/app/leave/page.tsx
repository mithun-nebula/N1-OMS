import { redirect } from "next/navigation";
import { getSessionUser } from "@/server/auth";
import { getSpine, getWorld } from "@/server/runtime";
import { directory } from "@/server/directory";
import { isRestricted } from "@/spine/permission/types";
import { isApprover as roleIsApprover } from "@/server/roles";
import { Shell } from "../shell";
import { LeaveClient } from "./leave-client";

export default async function LeavePage() {
  const user = await getSessionUser();
  if (!user) redirect("/login");
  const spine = await getSpine();
  const graph = (await getWorld()).deps.graph;

  const myRecord = await spine.read({ actor: user.id, nodeType: "employee", nodeId: user.id });
  const balanceField = myRecord.found ? myRecord.record.leaveBalance : undefined;
  const myBalance =
    myRecord.found && !isRestricted(balanceField) ? Number(balanceField ?? 0) : undefined;

  const myHistory = (await graph
    .find("leave", (n) => (n.data as { employeeId?: string }).employeeId === user.id))
    .map((n) => {
      const d = n.data as Record<string, unknown>;
      return {
        id: n.id,
        fromDate: String(d.fromDate ?? ""),
        toDate: String(d.toDate ?? ""),
        type: d.type ? String(d.type) : undefined,
        reason: d.reason ? String(d.reason) : undefined,
        status: String(d.status ?? ""),
        approvedBy: d.approvedBy ? String(d.approvedBy) : undefined,
        declinedBy: d.declinedBy ? String(d.declinedBy) : undefined,
        clashes: Array.isArray(d.clashes) ? d.clashes.length : 0,
      };
    })
    .sort((a, b) => (a.fromDate < b.fromDate ? 1 : -1));

  const isApprover = roleIsApprover(user.role);

  let pendingForApproval: Array<{
    id: string;
    employeeId: string;
    employeeName: string;
    fromDate: string;
    toDate: string;
    type?: string;
    reason?: string;
    clashes: number;
  }> = [];

  if (isApprover) {
    const teamMembers =
      user.role === "manager"
        ? directory().teamCircleOf(user.id).filter((id) => id !== user.id)
        : directory().activeIds();

    pendingForApproval = (await graph
      .find(
        "leave",
        (n) => (n.data as { status?: string }).status === "Pending",
      ))
      .map((n) => {
        const d = n.data as Record<string, unknown>;
        const employeeId = String(d.employeeId ?? "");
        return {
          id: n.id,
          employeeId,
          employeeName: String(d.employeeName ?? directory().nameOf(employeeId)),
          fromDate: String(d.fromDate ?? ""),
          toDate: String(d.toDate ?? ""),
          type: d.type ? String(d.type) : undefined,
          reason: d.reason ? String(d.reason) : undefined,
          clashes: Array.isArray(d.clashes) ? d.clashes.length : 0,
        };
      })
      .filter((l) => teamMembers.includes(l.employeeId))
      .sort((a, b) => (a.fromDate < b.fromDate ? 1 : -1));
  }

  const peopleForSelect = directory().all().filter((p) => p.active).map((p) => ({ id: p.id, name: p.name }));

  return (
    <Shell>
      <header className="rise px-4 pt-6 sm:px-6">
        <h1 className="text-2xl font-light tracking-tight text-ink sm:text-3xl">
          Your <span className="font-extrabold">leave</span>
        </h1>
        <p className="mt-1 text-sm text-ink-soft">Requests, balance and approvals.</p>
      </header>
      <LeaveClient
        currentUserId={user.id}
        currentUserName={user.displayName}
        myBalance={myBalance}
        myHistory={myHistory}
        pendingForApproval={pendingForApproval}
        isApprover={isApprover}
        peopleForSelect={peopleForSelect}
      />
    </Shell>
  );
}
