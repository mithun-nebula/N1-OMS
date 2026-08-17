"use client";

import { useState } from "react";
import { Icon } from "../ui/icons";
import { AccentButton, Empty, inputCls, OpFeedback } from "../ui/kit";
import { useOperation } from "@/components/ops/use-operation";

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
  const op = useOperation();
  const busy = op.busy;
  const [faultFor, setFaultFor] = useState<{ [id: string]: string }>({});

  async function reportFault(equipmentId: string, fault: string) {
    if (!fault.trim()) return;
    const outcome = await op.run("equipment.reportFault", { equipmentId, fault });
    if (outcome.status === "ran") {
      setFaultFor({ ...faultFor, [equipmentId]: "" });
    }
  }

  return (
    <div className="mx-auto max-w-4xl space-y-5 p-4 sm:p-6">
      <p className="rise text-[11px] font-semibold uppercase tracking-widest text-ink-faint" style={{ animationDelay: "60ms" }}>
        {equipment.length} item{equipment.length === 1 ? "" : "s"} in the register
      </p>

      {equipment.length === 0 && (
        <Empty icon="grid" text="No equipment registered yet — the register is empty." />
      )}

      {equipment.map((e, i) => (
        <div
          key={e.id}
          className="rise lift rounded-3xl bg-surface p-5 shadow-card"
          style={{ animationDelay: `${110 + i * 50}ms` }}
        >
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="min-w-0">
              <span className="text-[14px] font-semibold text-ink">{e.name}</span>
              <span className="ml-2 text-[11px] text-ink-faint">{e.id}</span>
            </div>
            <div className="flex shrink-0 items-center gap-2">
              <span className="text-[11px] text-ink-soft">
                {e.assigneeName ? `held by ${e.assigneeName}` : "unassigned"}
              </span>
              <span
                className={`rounded-full px-2.5 py-0.5 text-[11px] font-semibold ${
                  e.status === "assigned" ? "bg-mint text-mint-strong" : "bg-raised text-ink-faint"
                }`}
              >
                {e.status}
              </span>
            </div>
          </div>

          {e.repeatsThisMonth > 0 && (
            <div className="mt-2.5 rounded-xl bg-danger-soft px-3 py-2 text-xs font-medium text-danger">
              ⚠ Reported faulty {e.repeatsThisMonth} time{e.repeatsThisMonth === 1 ? "" : "s"} this month
            </div>
          )}

          <div className="mt-3 flex gap-2">
            <input
              value={faultFor[e.id] ?? ""}
              onChange={(ev) => setFaultFor({ ...faultFor, [e.id]: ev.target.value })}
              placeholder="Report a fault (e.g. “projector flickering”)"
              className={`${inputCls} w-full flex-1 py-2`}
            />
            <AccentButton
              onClick={() => reportFault(e.id, faultFor[e.id] ?? "")}
              disabled={busy || !faultFor[e.id]?.trim()}
            >
              Report
            </AccentButton>
          </div>

          {e.faults.length > 0 && (
            <div className="mt-3.5">
              <div className="text-[10px] font-semibold uppercase tracking-widest text-ink-faint">
                Fault history
              </div>
              <div className="mt-2 space-y-1.5">
                {e.faults.map((f, j) => (
                  <div
                    key={j}
                    className="flex flex-wrap items-center justify-between gap-2 rounded-xl bg-raised px-3 py-2 text-xs"
                  >
                    <span className="flex min-w-0 items-center gap-1.5 text-ink-soft">
                      {f.resolved ? (
                        <span className="text-mint-strong"><Icon name="check" className="h-3.5 w-3.5" /></span>
                      ) : (
                        <span className="text-peach-strong"><Icon name="clock" className="h-3.5 w-3.5" /></span>
                      )}
                      {f.fault}
                    </span>
                    <span className="shrink-0 text-[11px] text-ink-faint">
                      {f.byName} · {new Date(f.at).toLocaleDateString()}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      ))}
      <OpFeedback
        error={op.error}
        confirmation={op.confirmation}
        busy={op.busy}
        onConfirm={() => op.confirm()}
        onCancel={op.cancel}
        onDismiss={op.reset}
      />
    </div>
  );
}
