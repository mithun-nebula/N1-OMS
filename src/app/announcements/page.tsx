import { redirect } from "next/navigation";
import { getSessionUser } from "@/server/auth";
import { getWorld } from "@/server/runtime";
import { directory } from "@/server/directory";
import { isManagerOrAbove } from "@/server/roles";
import { Shell } from "../shell";
import { AnnouncementsClient } from "./announcements-client";

export default async function AnnouncementsPage() {
  const user = await getSessionUser();
  if (!user) redirect("/login");
  const { deps } = await getWorld();

  const announcements = (await deps.graph
    .find("announcement", () => true))
    .map((n) => {
      const d = n.data as Record<string, unknown>;
      const audience = Array.isArray(d.audience) ? (d.audience as string[]) : [];
      const acknowledged = Array.isArray(d.acknowledged) ? (d.acknowledged as string[]) : [];
      return {
        id: n.id,
        message: String(d.message ?? ""),
        by: String(d.by ?? ""),
        at: String(d.at ?? ""),
        policy: Boolean(d.policy),
        audience,
        acknowledged,
        outstanding: audience.filter((a) => !acknowledged.includes(a)).length,
        ackedByMe: acknowledged.includes(user.id),
        inAudience: audience.includes(user.id),
      };
    })
    .sort((a, b) => (a.at < b.at ? 1 : -1));

  const canSend = isManagerOrAbove(user.role);
  const people = directory().activeIds();

  return (
    <Shell>
      <header className="border-b border-black/[.08] px-6 py-4 dark:border-white/[.1]">
        <h1 className="text-xl font-semibold text-black dark:text-zinc-50">Announcements</h1>
        <p className="text-sm text-zinc-400">Notices & policies · acknowledgement tracking</p>
      </header>
      <AnnouncementsClient
        actorId={user.id}
        announcements={announcements}
        canSend={canSend}
        people={people}
      />
    </Shell>
  );
}
