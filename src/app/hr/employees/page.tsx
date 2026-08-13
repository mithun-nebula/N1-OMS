import { redirect } from "next/navigation";
import { getSessionUser } from "@/server/auth";
import { getSpine } from "@/server/runtime";
import { directory } from "@/server/directory";
import { assignableRoles, canAddPeople } from "@/server/roles";
import { listAccounts } from "@/server/accounts";
import { Shell } from "../../shell";
import { EmployeesClient } from "./employees-client";

export const dynamic = "force-dynamic";

export default async function EmployeesPage() {
  const user = await getSessionUser();
  if (!user) redirect("/login");
  if (!canAddPeople(user.role)) redirect("/dashboard");

  const spine = await getSpine();

  // Permission-filtered in one pass. Inactive people are included so their
  // records stay reachable after they leave.
  const visible = await spine.readMany({ actor: user.id, nodeType: "employee" });
  const usernames = new Map(listAccounts().map((a) => [a.personId, a.username]));

  const people = visible
    .map(({ nodeId, record }) => {
      const person = directory().get(nodeId);
      return {
        id: nodeId,
        name: String(record.name ?? nodeId),
        role: String(record.role ?? ""),
        team: String(record.team ?? ""),
        contact: String(record.contact ?? ""),
        username: usernames.get(nodeId) ?? "",
        managerName: person?.managerId
          ? directory().nameOf(person.managerId)
          : directory().managerOf(nodeId)
            ? directory().nameOf(directory().managerOf(nodeId) as string)
            : "",
        active: person?.active !== false,
        joiningDate: String(record.joiningDate ?? ""),
        lastWorkingDay: String(record.lastWorkingDay ?? ""),
      };
    })
    .sort((a, b) => Number(b.active) - Number(a.active) || a.name.localeCompare(b.name));

  return (
    <Shell>
      <EmployeesClient
        people={people}
        teams={directory().teams()}
        assignableRoles={[...assignableRoles(user.role)]}
      />
    </Shell>
  );
}
