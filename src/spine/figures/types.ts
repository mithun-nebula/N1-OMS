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
  put(figure: Figure): Promise<void>;
  replace(figure: Figure): Promise<void>;
  get(id: string): Promise<Figure | undefined>;
  forRecord(nodeType: string, nodeId: NodeId, label?: string): Promise<Figure[]>;
  breakdown(id: string): Promise<{ figure: Figure; parts: FigurePart[] } | undefined>;
  nextId(): string;
}
