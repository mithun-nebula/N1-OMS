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
  append(entry: ActivityEntry): Promise<void>;
  get(id: string): Promise<ActivityEntry | undefined>;
  query(q?: ActivityQuery): Promise<ActivityEntry[]>;
  markUndone(entryId: string, byUndoEntryId: string): Promise<void>;
  forRecord(nodeType: string, nodeId: string): Promise<ActivityEntry[]>;
  nextId(): Promise<string>;
}
