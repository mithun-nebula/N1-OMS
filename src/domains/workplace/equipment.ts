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
    execute: async (args, ctx) => {
      const id = `fault_${Date.now().toString(36)}`;
      const data: FaultData = {
        equipmentId: args.equipmentId,
        fault: args.fault,
        by: ctx.actor,
        at: ctx.now(),
      };
      await graph.putNode("fault", id, data);
      await graph.addEdge({ from: args.equipmentId, to: id, type: "reported-fault" });
      const repeats = await repeatFaults(graph, args.equipmentId, ctx.now().slice(0, 7));
      return {
        changes: [{ nodeType: "fault", nodeId: id, after: data }],
        publishedTo: [{ kind: "actor", actor: "shruti" }],
        response: { faultId: id, repeatCountThisMonth: repeats.length },
      };
    },
  };
}

export async function repeatFaults(
  graph: RecordStore,
  equipmentId: NodeId,
  yearMonth: string,
): Promise<FaultData[]> {
  const faultIds = (await graph.edgesOf(equipmentId, "out"))
    .filter((e) => e.type === "reported-fault")
    .map((e) => e.to);
  const out: FaultData[] = [];
  for (const fid of faultIds) {
    const node = await graph.getNode("fault", fid);
    const f = node?.data as FaultData | undefined;
    if (f && f.at.slice(0, 7) === yearMonth) out.push(f);
  }
  return out;
}
