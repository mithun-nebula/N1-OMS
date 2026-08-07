import type { ISODate, NodeId } from "../operation/types";

export interface FigurePart {
  label: string;
  value: number | string | boolean;
  detail?: string;
  nodeId?: NodeId;
}

export interface Figure {
  id: string;
  label: string;
  value: number | string;
  unit?: string;
  computedFrom: FigurePart[];
  explainer: string;
  computedAt: ISODate;
  sourceNodeType: string;
  sourceNodeId: NodeId;
}

export interface FigureStore {
  put(figure: Figure): void;
  get(id: string): Figure | undefined;
  forRecord(nodeType: string, nodeId: NodeId, label?: string): Figure[];
  breakdown(id: string): { figure: Figure; parts: FigurePart[] } | undefined;
  nextId(): string;
}
