import { redirect } from "next/navigation";
import { getSessionUser } from "@/server/auth";
import { listAccounts } from "@/server/accounts";
import { getAutonomyEngine, getWorld } from "@/server/runtime";
import { providerModes } from "@/config/providers";
import { homeRouteFor, isAdminLike } from "@/server/roles";
import { Shell } from "../shell";
import { AdminClient } from "./admin-client";

export default async function AdminPage() {
  const user = await getSessionUser();
  if (!user) redirect("/login");
  if (!isAdminLike(user.role)) redirect(homeRouteFor(user.role));

  const accounts = listAccounts();
  const engine = await getAutonomyEngine();
  const rules = engine.listRules();
  const suggestions = engine.listSuggestions();
  const modes = providerModes();
  const operations = (await getWorld()).registry.list();

  return (
    <Shell>
      <header className="rise px-4 pt-6 sm:px-6">
        <h1 className="text-2xl font-light tracking-tight text-ink sm:text-3xl">
          Admin <span className="font-extrabold">panel</span>
        </h1>
        <p className="mt-1 text-sm text-ink-soft">Accounts, autonomy rules, activity and system status.</p>
      </header>
      <AdminClient
        initial={{
          accounts,
          rules,
          suggestions,
          modes,
          operations,
        }}
      />
    </Shell>
  );
}
