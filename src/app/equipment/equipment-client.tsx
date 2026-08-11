"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

interface Fault {
  fault: string;
  by: string;
  byName: string;
  at: string;
  resolved: boolean;
}

interface EquipmentItem {
  id: string;
  name: string;
  assigneeId?: string;
  assigneeName?: string;
  status: string;
  faults: Fault[];
  repeatsThisMonth: number;
}

export function EquipmentClient({
  equipment,
}: {
  equipment: EquipmentItem[];
  actorId: string;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [faultFor, setFaultFor] = useState<{ [id: string]: string }>({});

  async function reportFault(equipmentId: string, fault: string) {
    if (!fault.trim()) return;
    setBusy(true);
    await fetch("/api/operations", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ start: "form", name: "equipment.reportFault", args: { equipmentId, fault } }),
    });
    setBusy(false);
    setFaultFor({ ...faultFor, [equipmentId]: "" });
    router.refresh();
  }

  return (
    <div className="space-y-4 p-6">
      <p className="text-sm text-zinc-400">{equipment.length} items in the register</p>
      {equipment.length === 0 && <p className="text-sm text-zinc-400">No equipment registered.</p>}
      {equipment.map((e) => (
        <div key={e.id} className="rounded-2xl border border-black/[.08] bg-white p-5 dark:border-white/[.12] dark:bg-black">
          <div className="flex items-center justify-between">
            <div>
              <span className="font-medium text-black dark:text-zinc-50">{e.name}</span>
              <span className="ml-2 text-xs text-zinc-400">{e.id}</span>
            </div>
            <div className="flex items-center gap-2">
              <span className="text-xs text-zinc-500">{e.assigneeName ? `held by ${e.assigneeName}` : "unassigned"}</span>
              <span className={`rounded-full px-2 py-0.5 text-xs ${e.status === "assigned" ? "bg-teal-100 text-teal-700" : "bg-zinc-100 text-zinc-500"}`}>{e.status}</span>
            </div>
          </div>

          {e.repeatsThisMonth > 0 && (
            <div className="mt-2 text-xs font-medium text-rose-600">⚠ Reported faulty {e.repeatsThisMonth} time{e.repeatsThisMonth === 1 ? "" : "s"} this month</div>
          )}

          <div className="mt-3 flex gap-2">
            <input
              value={faultFor[e.id] ?? ""}
              onChange={(ev) => setFaultFor({ ...faultFor, [e.id]: ev.target.value })}
              placeholder="Report a fault (e.g. “projector flickering”)"
              className="flex-1 rounded-lg border border-black/[.12] px-3 py-1.5 text-sm dark:border-white/[.2] dark:bg-black dark:text-zinc-50"
            />
            <button
              onClick={() => reportFault(e.id, faultFor[e.id] ?? "")}
              disabled={busy || !faultFor[e.id]?.trim()}
              className="rounded-lg bg-rose-600 px-3 py-1.5 text-xs font-medium text-white disabled:opacity-40"
            >
              Report
            </button>
          </div>

          {e.faults.length > 0 && (
            <div className="mt-3 border-t border-black/[.06] pt-2 dark:border-white/[.06]">
              <div className="mb-1 text-xs font-medium uppercase tracking-wide text-zinc-400">Fault history</div>
              <div className="space-y-1">
                {e.faults.map((f, i) => (
                  <div key={i} className="text-xs text-zinc-600 dark:text-zinc-300">
                    {f.resolved ? "✓" : "○"} {f.fault} <span className="text-zinc-400">— {f.byName} · {new Date(f.at).toLocaleDateString()}</span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      ))}
    </div>
  );
}
