import type { NodeId } from "../operation/types";

export type NodeType = string;
export type EdgeType = string;
export type RecordData = Record<string, unknown>;

export interface RecordNode {
  id: NodeId;
  type: NodeType;
  data: RecordData;
  version: number;
  updatedAt: string;
}

export interface RecordEdge {
  from: NodeId;
  to: NodeId;
  type: EdgeType;
  data?: RecordData;
}

export type TraversalDirection = "out" | "in" | "both";

export interface TraversalStep {
  edgeType?: EdgeType | EdgeType[];
  toNodeType?: NodeType;
  direction?: TraversalDirection;
}

export interface GraphQuery {
  start: NodeId | NodeId[];
  steps: TraversalStep[];
}

export interface RecordStore {
  putNode(type: NodeType, id: NodeId, data: RecordData): Promise<RecordNode>;
  getNode(type: NodeType, id: NodeId): Promise<RecordNode | undefined>;
  patchNode(type: NodeType, id: NodeId, patch: RecordData): Promise<RecordNode | undefined>;
  removeNode(type: NodeType, id: NodeId): Promise<boolean>;
  addEdge(edge: RecordEdge): Promise<void>;
  removeEdge(from: NodeId, to: NodeId, type: EdgeType): Promise<boolean>;
  edgesOf(nodeId: NodeId, direction?: TraversalDirection): Promise<RecordEdge[]>;
  traverse(query: GraphQuery): Promise<RecordNode[]>;
  find(type: NodeType, predicate: (node: RecordNode) => boolean): Promise<RecordNode[]>;
}
