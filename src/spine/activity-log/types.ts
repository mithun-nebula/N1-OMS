import type {
  ActorId,
  Authority,
  ISODate,
  OperationId,
  StartSource,
} from "../operation/types";
import type { ChangeSummary } from "../operation/registry";

export interface ActivityEntry {
  id: string;
  operationId: OperationId;
  operationName: string;
  actor: ActorId;
  authority: Authority;
  startedBy: StartSource;
  at: ISODate;
  changes: ChangeSummary[];
  undoDescription?: string;
  approvedBy?: ActorId;
  confirmationReason?: "money-or-people" | "never-graduate" | "not-earned";
  outcome: "ran" | "undone";
  undoneBy?: string;
}

export interface ActivityQuery {
  nodeType?: string;
  nodeId?: string;
  operationName?: string;
  actor?: ActorId;
  since?: ISODate;
  limit?: number;
}

export interface ActivityLog {
  append(entry: ActivityEntry): void;
  get(id: string): ActivityEntry | undefined;
  query(q?: ActivityQuery): ActivityEntry[];
  markUndone(entryId: string, byUndoEntryId: string): void;
  forRecord(nodeType: string, nodeId: string): ActivityEntry[];
  nextId(): string;
}
