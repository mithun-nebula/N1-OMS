import { redirect } from "next/navigation";
import { getSessionUser } from "@/server/auth";
import { Shell } from "../shell";
import { RecordsClient } from "./records-client";

export default async function RecordsPage() {
  const user = await getSessionUser();
  if (!user) redirect("/login");
  return (
    <Shell>
      <header className="rise px-4 pt-6 sm:px-6">
        <h1 className="text-2xl font-light tracking-tight text-ink sm:text-3xl">
          Record <span className="font-extrabold">browser</span>
        </h1>
        <p className="mt-1 text-sm text-ink-soft">
          An admin tool over every mapped N1 DocType · permission-filtered.
        </p>
      </header>
      <RecordsClient actorRole={user.role} />
    </Shell>
  );
}
