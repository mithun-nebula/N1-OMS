import { redirect } from "next/navigation";
import { getSessionUser } from "@/server/auth";
import { getSpine, getWorld, getPeopleService } from "@/server/runtime";
import { DEMO_PEOPLE } from "@/domains/shared/people-roster";
import { isRestricted } from "@/spine/permission/types";
import { Shell } from "../shell";
import { ProfileClient } from "./profile-client";

export default async function ProfilePage() {
  const user = await getSessionUser();
  if (!user) redirect("/login");
  const spine = await getSpine();
  const { deps } = await getWorld();
  const people = await getPeopleService();

  const read = await spine.read({ actor: user.id, nodeType: "employee", nodeId: user.id });
  const record = read.found ? read.record : {};
  const contactField = record.contact;
  const leaveBalanceField = record.leaveBalance;
  const payField = record.pay;
  const performanceField = record.performance;

  const myBalance =
    read.found && !isRestricted(leaveBalanceField)
      ? Number(leaveBalanceField ?? 0)
      : undefined;

  const myHistory = (await deps.graph
    .find("leave", (n) => (n.data as { employeeId?: string }).employeeId === user.id))
    .map((n) => {
      const d = n.data as Record<string, unknown>;
      return {
        id: n.id,
        fromDate: String(d.fromDate ?? ""),
        toDate: String(d.toDate ?? ""),
        type: d.type ? String(d.type) : undefined,
        status: String(d.status ?? ""),
      };
    })
    .sort((a, b) => (a.fromDate < b.fromDate ? 1 : -1));

  const attendance = (await people.listAttendance(user.id)).map((a) => {
    const d = a.data as Record<string, unknown>;
    return {
      id: a.id,
      date: String(d.date ?? ""),
      status: String(d.status ?? ""),
      checkIn: d.checkIn ? String(d.checkIn) : undefined,
      checkOut: d.checkOut ? String(d.checkOut) : undefined,
    };
  });

  const payslips = (await people.listPaySlips(user.id)).map((p) => {
    const d = p.data as Record<string, unknown>;
    return {
      id: p.id,
      period: d.posting_date ? String(d.posting_date) : d.month ? String(d.month) : p.id,
      amount: d.net_pay ? Number(d.net_pay) : d.gross_pay ? Number(d.gross_pay) : undefined,
    };
  });

  return (
    <Shell>
      <header className="border-b border-black/[.08] px-6 py-4 dark:border-white/[.1]">
        <h1 className="text-xl font-semibold text-black dark:text-zinc-50">Profile</h1>
        <p className="text-sm text-zinc-400">{user.displayName}</p>
      </header>

      <ProfileClient
        employeeId={user.id}
        name={String(record.name ?? user.displayName)}
        role={String(record.role ?? user.role)}
        team={DEMO_PEOPLE[user.id]?.team}
        contact={isRestricted(contactField) ? undefined : String(contactField ?? "")}
        pay={isRestricted(payField) ? undefined : (payField as number | string | undefined)}
        leaveBalance={myBalance}
        leaveHistory={myHistory}
        attendance={attendance}
        payslips={payslips}
        payRestricted={isRestricted(payField)}
        performanceRestricted={isRestricted(performanceField)}
        canEdit={true}
      />
    </Shell>
  );
}
