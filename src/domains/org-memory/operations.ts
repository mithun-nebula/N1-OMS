import type { OperationHandler, OperationResult } from "@/spine/operation/registry";
import type { NodeId } from "@/spine/operation/types";
import type { RecordStore } from "@/spine/record/types";

export interface LinkedRecord {
  nodeType: string;
  nodeId: NodeId;
}

interface OrgMemoryData {
  title: string;
  decision: string;
  reasonAtTime: string;
  decidedBy: string;
  decidedAt: string;
  linkedRecords: LinkedRecord[];
  [key: string]: unknown;
}

let memSeq = 0;
export function nextMemoryId(): string {
  memSeq += 1;
  return `memory_${Date.now().toString(36)}_${memSeq.toString(36)}`;
}

export function orgMemoryRecordHandler(
  graph: RecordStore,
): OperationHandler<{
  title: string;
  decision: string;
  reason: string;
  linkedRecords?: LinkedRecord[];
}> {
  return {
    name: "orgMemory.record",
    validate: (args) => {
      const missing: string[] = [];
      if (!args.title) missing.push("title");
      if (!args.decision) missing.push("decision");
      if (!args.reason) missing.push("reason");
      return missing.length === 0
        ? { ok: true }
        : {
            ok: false,
            missing,
            detail: "title, decision and reason are required.",
          };
    },
    permission: () => ({ action: "create", nodeType: "org-memory" }),
    involvesMoneyOrPeople: () => false,
    execute: async (args, ctx) => {
      const id = nextMemoryId();
      const linked = args.linkedRecords ?? [];
      const data: OrgMemoryData = {
        title: args.title,
        decision: args.decision,
        reasonAtTime: args.reason,
        decidedBy: ctx.actor,
        decidedAt: ctx.now(),
        linkedRecords: linked,
      };
      await graph.putNode("org-memory", id, data);
      for (const link of linked) {
        await graph.addEdge({ from: id, to: link.nodeId, type: "references" });
      }
      const result: OperationResult = {
        changes: [{ nodeType: "org-memory", nodeId: id, after: data }],
        publishedTo: [{ kind: "broadcast" }],
        // Recording a decision had no undo at all. It is broadcast to everyone,
        // so a decision minuted against the wrong thing is exactly what somebody
        // wants back. A create, so the undo is a delete — plus the reference
        // edges, or the records it linked keep pointing at nothing.
        undo: {
          description: `Withdraw recorded decision ${id}.`,
          revert: async () => {
            for (const link of linked) {
              await graph.removeEdge(id, link.nodeId, "references");
            }
            await graph.removeNode("org-memory", id);
          },
          plan: [
            ...linked.map((link) => ({
              op: "removeEdge" as const,
              from: id,
              to: link.nodeId,
              edgeType: "references",
            })),
            { op: "remove" as const, nodeType: "org-memory", nodeId: id },
          ],
        },
        response: { memoryId: id },
      };
      return result;
    },
  };
}
