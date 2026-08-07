import type { NodeId } from "../operation/types";
import type { Figure, FigurePart, FigureStore } from "./types";

export class InMemoryFigureStore implements FigureStore {
  private byId = new Map<string, Figure>();
  private byRecord = new Map<string, Figure[]>();
  private seq = 0;

  put(figure: Figure): void {
    this.byId.set(figure.id, figure);
    const key = recordKey(figure.sourceNodeType, figure.sourceNodeId);
    const list = this.byRecord.get(key) ?? [];
    const idx = list.findIndex(
      (f) => f.label === figure.label && f.id === figure.id,
    );
    if (idx === -1) list.push(figure);
    else list[idx] = figure;
    this.byRecord.set(key, list);
  }

  get(id: string): Figure | undefined {
    return this.byId.get(id);
  }

  forRecord(nodeType: string, nodeId: NodeId, label?: string): Figure[] {
    const list = this.byRecord.get(recordKey(nodeType, nodeId)) ?? [];
    if (label) return list.filter((f) => f.label === label);
    return [...list];
  }

  breakdown(id: string): { figure: Figure; parts: FigurePart[] } | undefined {
    const figure = this.byId.get(id);
    if (!figure) return undefined;
    return { figure, parts: figure.computedFrom };
  }

  nextId(): string {
    this.seq += 1;
    return `fig_${this.seq.toString(36)}`;
  }
}

function recordKey(nodeType: string, nodeId: NodeId): string {
  return `${nodeType}:${nodeId}`;
}
