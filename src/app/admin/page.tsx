import { redirect } from "next/navigation";
import { getSessionUser } from "@/server/auth";
import { listAccounts } from "@/server/accounts";
import { getAutonomyEngine, getWorld } from "@/server/runtime";
import { providerModes } from "@/config/providers";
import { Shell } from "../shell";
import { AdminClient } from "./admin-client";

export default async function AdminPage() {
  const user = await getSessionUser();
  if (!user) redirect("/login");
  if (user.role !== "super-admin" && user.role !== "admin") redirect("/today");

  const accounts = listAccounts();
  const engine = await getAutonomyEngine();
  const rules = engine.listRules();
  const suggestions = engine.listSuggestions();
  const modes = providerModes();
  const operations = (await getWorld()).registry.list();

  return (
    <Shell>
      <header className="border-b border-black/[.08] px-6 py-4 dark:border-white/[.1]">
        <h1 className="text-xl font-semibold text-black dark:text-zinc-50">Admin</h1>
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
