import type { NodeId } from "../operation/types";
import type {
  ActivityEntry,
  ActivityLog,
  ActivityQuery,
} from "./types";

export class InMemoryActivityLog implements ActivityLog {
  private entries: ActivityEntry[] = [];
  private byId = new Map<string, ActivityEntry>();
  private byRecord = new Map<string, ActivityEntry[]>();
  private seq = 0;

  append(entry: ActivityEntry): void {
    if (this.byId.has(entry.id)) {
      throw new Error(`Activity entry already exists: ${entry.id}`);
    }
    this.entries.push(entry);
    this.byId.set(entry.id, entry);
    for (const change of entry.changes) {
      const key = recordKey(change.nodeType, change.nodeId);
      const list = this.byRecord.get(key) ?? [];
      list.push(entry);
      this.byRecord.set(key, list);
    }
  }

  get(id: string): ActivityEntry | undefined {
    return this.byId.get(id);
  }

  query(q: ActivityQuery = {}): ActivityEntry[] {
    let result = this.entries;
    if (q.operationName) {
      result = result.filter((e) => e.operationName === q.operationName);
    }
    if (q.actor) {
      result = result.filter((e) => e.actor === q.actor);
    }
    if (q.since) {
      result = result.filter((e) => e.at >= (q.since as string));
    }
    if (q.nodeType && q.nodeId) {
      const key = recordKey(q.nodeType, q.nodeId as NodeId);
      const scoped = new Set((this.byRecord.get(key) ?? []).map((e) => e.id));
      result = result.filter((e) => scoped.has(e.id));
    }
    const limit = q.limit ?? result.length;
    return result.slice(-limit);
  }

  forRecord(nodeType: string, nodeId: string): ActivityEntry[] {
    return [...(this.byRecord.get(recordKey(nodeType, nodeId)) ?? [])];
  }

  markUndone(entryId: string, byUndoEntryId: string): void {
    const entry = this.byId.get(entryId);
    if (!entry) return;
    entry.outcome = "undone";
    entry.undoneBy = byUndoEntryId;
  }
  nextId(): string {
    this.seq += 1;
    return `act_${this.seq.toString(36)}`;
  }
}

function recordKey(nodeType: string, nodeId: string): string {
  return `${nodeType}:${nodeId}`;
}
