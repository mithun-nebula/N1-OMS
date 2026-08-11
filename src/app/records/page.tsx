import { redirect } from "next/navigation";
import { getSessionUser } from "@/server/auth";
import { Shell } from "../shell";
import { RecordsClient } from "./records-client";

export default async function RecordsPage() {
  const user = await getSessionUser();
  if (!user) redirect("/login");
  return (
    <Shell>
      <header className="border-b border-black/[.08] px-6 py-4 dark:border-white/[.1]">
        <h1 className="text-xl font-semibold text-black dark:text-zinc-50">Records (N1)</h1>
        <p className="text-sm text-zinc-400">Browse any mapped N1 DocType · permission-filtered</p>
      </header>
      <RecordsClient actorRole={user.role} />
    </Shell>
  );
}
