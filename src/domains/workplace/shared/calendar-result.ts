import type {
  OperationResult,
  PublishTarget,
  UndoInfo,
  ChangeSummary,
} from "@/spine/operation/registry";

export function calendarResult(input: {
  changes: ChangeSummary[];
  notify: PublishTarget[];
  undo: UndoInfo;
  response?: unknown;
}): OperationResult {
  return {
    changes: input.changes,
    publishedTo: input.notify,
    undo: input.undo,
    response: input.response,
  };
}

export function assertAtomic(result: OperationResult): void {
  if (!result.publishedTo || result.publishedTo.length === 0) {
    throw new Error("Calendar op missing notify (publishedTo).");
  }
  if (!result.undo) {
    throw new Error("Calendar op missing undo.");
  }
}
