import { redirect } from "next/navigation";
import { getSessionUser } from "@/server/auth";
import { getWorld } from "@/server/runtime";
import { directory } from "@/server/directory";
import { repeatFaults } from "@/domains/workplace/equipment";
import { Shell } from "../shell";
import { EquipmentClient } from "./equipment-client";

export default async function EquipmentPage() {
  const user = await getSessionUser();
  if (!user) redirect("/login");
  const { deps } = await getWorld();
  const yearMonth = new Date().toISOString().slice(0, 7);

  const equipmentNodes = await deps.graph.find("equipment", () => true);
  const equipment = [];
  for (const n of equipmentNodes) {
    const d = n.data as Record<string, unknown>;
    const assigneeId = d.assignee ? String(d.assignee) : undefined;
    const faultEdges = (await deps.graph.edgesOf(n.id, "out")).filter((e) => e.type === "reported-fault");
    const faults = [];
    for (const e of faultEdges) {
      const fnode = await deps.graph.getNode("fault", e.to);
      const f = fnode?.data as Record<string, unknown> | undefined;
      if (f) {
        faults.push({
          fault: String(f.fault ?? ""),
          by: String(f.by ?? ""),
          byName: directory().nameOf(String(f.by ?? "")),
          at: String(f.at ?? ""),
          resolved: Boolean(f.resolved),
        });
      }
    }
    faults.sort((a, b) => (a.at < b.at ? 1 : -1));
    equipment.push({
      id: n.id,
      name: String(d.name ?? n.id),
      assigneeId,
      assigneeName: assigneeId ? directory().nameOf(assigneeId) : undefined,
      status: String(d.status ?? ""),
      faults,
      repeatsThisMonth: (await repeatFaults(deps.graph, n.id, yearMonth)).length,
    });
  }

  return (
    <Shell>
      <header className="rise flex flex-wrap items-center justify-between gap-3 px-4 pt-6 sm:px-6">
        <div>
          <h1 className="text-2xl font-light tracking-tight text-ink sm:text-3xl">
            Equipment <span className="font-extrabold">&amp; faults</span>
          </h1>
          <p className="mt-1 text-sm text-ink-soft">
            Register, fault reporting and repeat-fault detection.
          </p>
        </div>
      </header>
      <EquipmentClient equipment={equipment} actorId={user.id} />
    </Shell>
  );
}
