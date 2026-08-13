import type { ActorId, Operation, NodeId } from "./types";

export type ValidationResult =
  | { ok: true }
  | { ok: false; missing: string[]; detail?: string };

export type PermissionRequirement = {
  action: PermissionAction;
  nodeType: string;
  fields?: string[];
  recordNodeIds?: NodeId[];
  allowedActors?: ActorId[];
};

export type PermissionAction =
  | "view"
  | "create"
  | "edit"
  | "approve"
  | "export"
  | "delete";

export type OperationCategory = "money" | "people" | "leaving-org" | "routine";

export interface ChangeSummary {
  nodeType: string;
  nodeId: NodeId;
  before?: unknown;
  after?: unknown;
}

/**
 * A serialisable reversal step. Stored on the activity entry so an undo still
 * works after a restart, when the in-process `revert` closure is gone.
 */
export type UndoStep =
  | { op: "put"; nodeType: string; nodeId: NodeId; data: Record<string, unknown> }
  | { op: "patch"; nodeType: string; nodeId: NodeId; data: Record<string, unknown> }
  | { op: "remove"; nodeType: string; nodeId: NodeId }
  | { op: "addEdge"; from: NodeId; to: NodeId; edgeType: string; data?: Record<string, unknown> }
  | { op: "removeEdge"; from: NodeId; to: NodeId; edgeType: string };

export interface UndoInfo {
  description: string;
  /** In-process reversal. Preferred when available — richer than a plan. */
  revert?: (ctx: OperationContext) => Promise<void> | void;
  /**
   * Serialisable fallback, persisted on the activity entry. Supply this on any
   * operation whose undo must survive a restart — which, for an operation an
   * agent may run unattended, is all of them.
   */
  plan?: UndoStep[];
}

export interface OperationResult {
  changes: ChangeSummary[];
  undo?: UndoInfo;
  publishedTo?: PublishTarget[];
  response?: unknown;
}

/**
 * `message` and `ref` are optional: without them the spine falls back to
 * `summarizeChanges()`, which reads like "leave:lv_3 changed". Supplying them
 * is what turns a notification into something a person can act on — real text
 * plus a record to deep-link to.
 */
export type PublishTarget =
  | {
      kind: "actor";
      actor: ActorId;
      message?: string;
      ref?: { nodeType: string; nodeId: NodeId };
    }
  | {
      kind: "record";
      nodeType: string;
      nodeId: NodeId;
      message?: string;
    }
  | {
      kind: "broadcast";
      message?: string;
      ref?: { nodeType: string; nodeId: NodeId };
    };

export interface OperationContext {
  actor: ActorId;
  now: () => string;
  graph: {
    get: (nodeType: string, nodeId: NodeId) => Promise<unknown | undefined>;
  };
}

export interface OperationHandler<
  TArgs = Record<string, unknown>,
  TResult extends OperationResult = OperationResult,
> {
  name: string;
  category?: OperationCategory;
  validate: (args: TArgs) => Promise<ValidationResult> | ValidationResult;
  permission: (args: TArgs) => Promise<PermissionRequirement | PermissionRequirement[]> | PermissionRequirement | PermissionRequirement[];
  involvesMoneyOrPeople: (args: TArgs) => boolean;
  execute: (args: TArgs, ctx: OperationContext) => Promise<TResult> | TResult;
}

export class OperationRegistry {
  private handlers = new Map<string, OperationHandler>();

  register<TArgs, TResult extends OperationResult>(
    handler: OperationHandler<TArgs, TResult>,
  ): void {
    if (this.handlers.has(handler.name)) {
      throw new Error(`Operation already registered: ${handler.name}`);
    }
    this.handlers.set(handler.name, handler as OperationHandler);
  }

  get(name: string): OperationHandler | undefined {
    return this.handlers.get(name);
  }

  require(name: string): OperationHandler {
    const handler = this.handlers.get(name);
    if (!handler) {
      throw new UnknownOperationError(name);
    }
    return handler;
  }

  list(): string[] {
    return [...this.handlers.keys()];
  }
}

export class UnknownOperationError extends Error {
  constructor(public readonly operationName: string) {
    super(`Unknown operation: ${operationName}`);
    this.name = "UnknownOperationError";
  }
}

export function flattenRequirements(
  req: PermissionRequirement | PermissionRequirement[],
): PermissionRequirement[] {
  return Array.isArray(req) ? req : [req];
}

export type AnyOperation = Operation;
