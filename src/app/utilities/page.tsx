import { redirect } from "next/navigation";
import { getSessionUser } from "@/server/auth";
import { getWorld } from "@/server/runtime";
import { getQuestionLimiter } from "@/server/limiter";
import { Shell } from "../shell";
import { UtilitiesClient } from "./utilities-client";

export default async function UtilitiesPage() {
  const user = await getSessionUser();
  if (!user) redirect("/login");
  const { deps } = await getWorld();
  const today = new Date().toISOString().slice(0, 10);
  const remaining = getQuestionLimiter().remaining(user.id, today);

  const history = (await deps.graph
    .find("utility-capture", () => true))
    .map((n) => {
      const d = n.data as Record<string, unknown>;
      return {
        id: n.id,
        subject: String(d.subject ?? ""),
        detail: String(d.detail ?? ""),
        from: d.from ? String(d.from) : undefined,
        to: d.to ? String(d.to) : undefined,
        by: String(d.by ?? ""),
        at: String(d.at ?? ""),
      };
    })
    .sort((a, b) => (a.at < b.at ? 1 : -1));

  return (
    <Shell>
      <header className="border-b border-black/[.08] px-6 py-4 dark:border-white/[.1]">
        <h1 className="text-xl font-semibold text-black dark:text-zinc-50">Rooms & utilities used</h1>
        <p className="text-sm text-zinc-400">Short-question capture · max two per day</p>
      </header>
      <UtilitiesClient actorId={user.id} remaining={remaining} today={today} history={history} />
    </Shell>
  );
}
