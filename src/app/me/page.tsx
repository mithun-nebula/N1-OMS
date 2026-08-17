import { redirect } from "next/navigation";
import { getSessionUser } from "@/server/auth";
import { getSpine, getWorld, getPeopleService } from "@/server/runtime";
import { directory } from "@/server/directory";
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
      <header className="rise flex flex-wrap items-center justify-between gap-3 px-4 pt-6 sm:px-6">
        <h1 className="text-2xl font-light tracking-tight text-ink sm:text-3xl">
          Your <span className="font-extrabold">profile</span>
        </h1>
      </header>

      <ProfileClient
        employeeId={user.id}
        name={String(record.name ?? user.displayName)}
        role={String(record.role ?? user.role)}
        team={directory().teamNameOf(user.id)}
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
