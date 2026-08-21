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

  // Clock-ins write checkInAt/checkOutAt (ISO); N1 rows may carry checkIn/
  // checkOut times and a status. Accept both shapes, render times as HH:MM.
  const asTime = (v: unknown): string | undefined => {
    if (!v) return undefined;
    const s = String(v);
    return s.includes("T") ? s.slice(11, 16) : s;
  };
  const attendance = (await people.listAttendance(user.id))
    .map((a) => {
      const d = a.data as Record<string, unknown>;
      const checkIn = asTime(d.checkInAt ?? d.checkIn);
      const checkOut = asTime(d.checkOutAt ?? d.checkOut);
      return {
        id: a.id,
        date: String(d.date ?? ""),
        status: String(d.status ?? (checkIn ? "Present" : "")),
        checkIn,
        checkOut,
      };
    })
    .sort((a, b) => (a.date < b.date ? 1 : -1));

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
        performance={isRestricted(performanceField) ? undefined : (performanceField as number | string | undefined)}
        leaveBalance={myBalance}
        leaveHistory={myHistory}
        attendance={attendance}
        payRestricted={isRestricted(payField)}
        performanceRestricted={isRestricted(performanceField)}
        canEdit={true}
      />
    </Shell>
  );
}
