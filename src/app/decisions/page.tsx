import { redirect } from "next/navigation";
import { getSessionUser } from "@/server/auth";
import { getWorld } from "@/server/runtime";
import { Shell } from "../shell";
import { DecisionsClient } from "./decisions-client";

export default async function DecisionsPage() {
  const user = await getSessionUser();
  if (!user) redirect("/login");
  const { deps } = await getWorld();

  const decisions = (await deps.graph
    .find("org-memory", () => true))
    .map((n) => {
      const d = n.data as Record<string, unknown>;
      return {
        id: n.id,
        title: String(d.title ?? n.id),
        decision: String(d.decision ?? ""),
        reason: String(d.reasonAtTime ?? ""),
        decidedBy: String(d.decidedBy ?? ""),
        decidedAt: String(d.decidedAt ?? ""),
        linkedRecords: Array.isArray(d.linkedRecords) ? (d.linkedRecords as Array<{ nodeType: string; nodeId: string }>) : [],
      };
    })
    .sort((a, b) => (a.decidedAt < b.decidedAt ? 1 : -1));

  const canRecord = ["super-admin", "admin", "hr", "manager"].includes(user.role);

  return (
    <Shell>
      <header className="border-b border-black/[.08] px-6 py-4 dark:border-white/[.1]">
        <h1 className="text-xl font-semibold text-black dark:text-zinc-50">Organizational memory</h1>
        <p className="text-sm text-zinc-400">Decisions remembered with the reason given at the time</p>
      </header>
      <DecisionsClient decisions={decisions} canRecord={canRecord} />
    </Shell>
  );
}
