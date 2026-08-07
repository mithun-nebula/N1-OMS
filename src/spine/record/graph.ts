import type { NodeId } from "../operation/types";
import type {
  EdgeType,
  GraphQuery,
  NodeType,
  RecordData,
  RecordEdge,
  RecordNode,
  RecordStore,
  TraversalDirection,
  TraversalStep,
} from "./types";

export class InMemoryRecordStore implements RecordStore {
  private nodes = new Map<string, RecordNode>();
  private nodesById = new Map<NodeId, RecordNode>();
  private outEdges = new Map<string, RecordEdge[]>();
  private inEdges = new Map<string, RecordEdge[]>();
  private clock = 0;

  putNode(type: NodeType, id: NodeId, data: RecordData): RecordNode {
    const key = nodeKey(type, id);
    const existing = this.nodes.get(key);
    const node: RecordNode = {
      id,
      type,
      data: { ...data },
      version: existing ? existing.version + 1 : 1,
      updatedAt: this.now(),
    };
    this.nodes.set(key, node);
    this.nodesById.set(id, node);
    return node;
  }

  getNode(type: NodeType, id: NodeId): RecordNode | undefined {
    return this.nodes.get(nodeKey(type, id));
  }

  patchNode(
    type: NodeType,
    id: NodeId,
    patch: RecordData,
  ): RecordNode | undefined {
    const existing = this.nodes.get(nodeKey(type, id));
    if (!existing) return undefined;
    const merged = { ...existing.data, ...patch };
    return this.putNode(type, id, merged);
  }

  removeNode(type: NodeType, id: NodeId): boolean {
    const key = nodeKey(type, id);
    const existed = this.nodes.delete(key);
    if (existed) {
      this.nodesById.delete(id);
      this.outEdges.delete(id);
      this.inEdges.delete(id);
    }
    return existed;
  }

  addEdge(edge: RecordEdge): void {
    const out = this.outEdges.get(edge.from) ?? [];
    out.push(edge);
    this.outEdges.set(edge.from, out);
    const inc = this.inEdges.get(edge.to) ?? [];
    inc.push(edge);
    this.inEdges.set(edge.to, inc);
  }

  removeEdge(from: NodeId, to: NodeId, type: EdgeType): boolean {
    const out = this.outEdges.get(from) ?? [];
    const idx = out.findIndex((e) => e.to === to && e.type === type);
    if (idx === -1) return false;
    out.splice(idx, 1);
    const inc = this.inEdges.get(to) ?? [];
    const iidx = inc.findIndex((e) => e.from === from && e.type === type);
    if (iidx !== -1) inc.splice(iidx, 1);
    return true;
  }

  edgesOf(nodeId: NodeId, direction: TraversalDirection = "out"): RecordEdge[] {
    const result: RecordEdge[] = [];
    if (direction === "out" || direction === "both") {
      result.push(...(this.outEdges.get(nodeId) ?? []));
    }
    if (direction === "in" || direction === "both") {
      result.push(...(this.inEdges.get(nodeId) ?? []));
    }
    return result;
  }

  traverse(query: GraphQuery): RecordNode[] {
    const starts = Array.isArray(query.start) ? query.start : [query.start];
    let frontier = new Set<NodeId>(starts);
    for (const step of query.steps) {
      frontier = this.advance(frontier, step);
    }
    const result: RecordNode[] = [];
    const seen = new Set<string>();
    for (const id of frontier) {
      const node = this.nodeById(id);
      if (node && !seen.has(nodeKey(node.type, node.id))) {
        seen.add(nodeKey(node.type, node.id));
        result.push(node);
      }
    }
    return result;
  }

  find(
    type: NodeType,
    predicate: (node: RecordNode) => boolean,
  ): RecordNode[] {
    const result: RecordNode[] = [];
    for (const node of this.nodes.values()) {
      if (node.type === type && predicate(node)) {
        result.push(node);
      }
    }
    return result;
  }

  private advance(frontier: Set<NodeId>, step: TraversalStep): Set<NodeId> {
    const next = new Set<NodeId>();
    const allowed = step.edgeType
      ? new Set(Array.isArray(step.edgeType) ? step.edgeType : [step.edgeType])
      : undefined;
    for (const nodeId of frontier) {
      const edges = this.edgesOf(nodeId, step.direction ?? "out");
      for (const edge of edges) {
        if (allowed && !allowed.has(edge.type)) continue;
        const target = this.resolveTarget(nodeId, edge, step.direction ?? "out");
        if (!target) continue;
        const node = this.nodeById(target);
        if (!node) continue;
        if (step.toNodeType && node.type !== step.toNodeType) continue;
        next.add(target);
      }
    }
    return next;
  }

  private resolveTarget(
    nodeId: NodeId,
    edge: RecordEdge,
    direction: TraversalDirection,
  ): NodeId | undefined {
    if (direction === "out") return edge.to;
    if (direction === "in") return edge.from;
    return edge.from === nodeId ? edge.to : edge.from;
  }

  private nodeById(id: NodeId): RecordNode | undefined {
    return this.nodesById.get(id);
  }

  private now(): string {
    this.clock += 1;
    return new Date(this.clock).toISOString();
  }
}

function nodeKey(type: NodeType, id: NodeId): string {
  return `${type}:${id}`;
}
