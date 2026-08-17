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
      <header className="rise flex flex-wrap items-center justify-between gap-3 px-4 pt-6 sm:px-6">
        <div>
          <h1 className="text-2xl font-light tracking-tight text-ink sm:text-3xl">
            Quick <span className="font-extrabold">questions</span>
          </h1>
          <p className="mt-1 text-sm text-ink-soft">
            Rooms and utilities used — short-question capture, max two per day.
          </p>
        </div>
      </header>
      <UtilitiesClient actorId={user.id} remaining={remaining} today={today} history={history} />
    </Shell>
  );
}
