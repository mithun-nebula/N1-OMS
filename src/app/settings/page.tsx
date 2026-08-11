import { redirect } from "next/navigation";
import { getSessionUser } from "@/server/auth";
import { getSpine } from "@/server/runtime";
import { isRestricted } from "@/spine/permission/types";
import { Shell } from "../shell";
import { SettingsClient } from "./settings-client";

export default async function SettingsPage() {
  const user = await getSessionUser();
  if (!user) redirect("/login");
  const spine = await getSpine();
  const read = await spine.read({ actor: user.id, nodeType: "employee", nodeId: user.id });
  const contact = read.found && !isRestricted(read.record.contact) ? String(read.record.contact ?? "") : undefined;

  return (
    <Shell>
      <header className="border-b border-black/[.08] px-6 py-4 dark:border-white/[.1]">
        <h1 className="text-xl font-semibold text-black dark:text-zinc-50">Settings</h1>
      </header>
      <SettingsClient
        employeeId={user.id}
        displayName={user.displayName}
        username={user.username}
        contact={contact}
      />
    </Shell>
  );
}
