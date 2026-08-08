import type { NodeId } from "@/spine/operation/types";
import type { RecordStore, RecordNode } from "@/spine/record/types";

export interface OrgMemoryView {
  id: NodeId;
  title: string;
  decision: string;
  reasonAtTime: string;
  decidedBy: string;
  decidedAt: string;
  linkedRecords: Array<{ nodeType: string; nodeId: NodeId; available: boolean }>;
}

export class OrgMemoryService {
  constructor(private readonly graph: RecordStore) {}

  list(): Array<{ id: NodeId; title: string; decidedBy: string; decidedAt: string }> {
    return this.graph.find("org-memory", () => true).map((n) => {
      const d = n.data as {
        title?: string;
        decidedBy?: string;
        decidedAt?: string;
      };
      return {
        id: n.id,
        title: d.title ?? n.id,
        decidedBy: d.decidedBy ?? "",
        decidedAt: d.decidedAt ?? "",
      };
    });
  }

  retrieve(
    id: NodeId,
    canView: (nodeType: string, nodeId: NodeId) => boolean,
  ): OrgMemoryView | undefined {
    const node = this.graph.getNode("org-memory", id) as RecordNode | undefined;
    if (!node) return undefined;
    const d = node.data as {
      title: string;
      decision: string;
      reasonAtTime: string;
      decidedBy: string;
      decidedAt: string;
      linkedRecords?: Array<{ nodeType: string; nodeId: NodeId }>;
    };
    const linked = (d.linkedRecords ?? []).map((l) => ({
      nodeType: l.nodeType,
      nodeId: l.nodeId,
      available: canView(l.nodeType, l.nodeId),
    }));
    return {
      id: node.id,
      title: d.title,
      decision: d.decision,
      reasonAtTime: d.reasonAtTime,
      decidedBy: d.decidedBy,
      decidedAt: d.decidedAt,
      linkedRecords: linked,
    };
  }
}
