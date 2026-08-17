import { redirect } from "next/navigation";
import { getSessionUser } from "@/server/auth";
import { getWorld } from "@/server/runtime";
import { isManagerOrAbove } from "@/server/roles";
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

  const canRecord = isManagerOrAbove(user.role);

  return (
    <Shell>
      <header className="rise flex flex-wrap items-center justify-between gap-3 px-4 pt-6 sm:px-6">
        <div>
          <h1 className="text-2xl font-light tracking-tight text-ink sm:text-3xl">
            Decision <span className="font-extrabold">log</span>
          </h1>
          <p className="mt-1 text-sm text-ink-soft">
            Decisions remembered with the reason given at the time.
          </p>
        </div>
      </header>
      <DecisionsClient decisions={decisions} canRecord={canRecord} />
    </Shell>
  );
}
