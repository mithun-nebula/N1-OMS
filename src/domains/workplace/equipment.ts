import type { OperationHandler } from "@/spine/operation/registry";
import type { NodeId } from "@/spine/operation/types";
import type { RecordStore } from "@/spine/record/types";

interface FaultData {
  equipmentId: string;
  fault: string;
  by: string;
  at: string;
  resolved?: boolean;
  [key: string]: unknown;
}

export function equipmentReportFaultHandler(
  graph: RecordStore,
): OperationHandler<{ equipmentId: string; fault: string }> {
  return {
    name: "equipment.reportFault",
    validate: (args) => {
      const missing: string[] = [];
      if (!args.equipmentId) missing.push("equipmentId");
      if (!args.fault) missing.push("fault");
      return missing.length === 0 ? { ok: true } : { ok: false, missing, detail: "equipmentId and fault are required." };
    },
    permission: () => ({ action: "create", nodeType: "fault" }),
    involvesMoneyOrPeople: () => false,
    execute: (args, ctx) => {
      const id = `fault_${Date.now().toString(36)}`;
      const data: FaultData = {
        equipmentId: args.equipmentId,
        fault: args.fault,
        by: ctx.actor,
        at: ctx.now(),
      };
      graph.putNode("fault", id, data);
      graph.addEdge({ from: args.equipmentId, to: id, type: "reported-fault" });
      const repeats = repeatFaults(graph, args.equipmentId, ctx.now().slice(0, 7));
      return {
        changes: [{ nodeType: "fault", nodeId: id, after: data }],
        publishedTo: [{ kind: "actor", actor: "shruti" }],
        response: { faultId: id, repeatCountThisMonth: repeats.length },
      };
    },
  };
}

export function repeatFaults(
  graph: RecordStore,
  equipmentId: NodeId,
  yearMonth: string,
): FaultData[] {
  const faultIds = graph
    .edgesOf(equipmentId, "out")
    .filter((e) => e.type === "reported-fault")
    .map((e) => e.to);
  return faultIds
    .map((fid) => graph.getNode("fault", fid)?.data as FaultData | undefined)
    .filter((f): f is FaultData => f !== undefined && f.at.slice(0, 7) === yearMonth);
}
