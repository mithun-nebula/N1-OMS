import type { ActorId, Operation, NodeId } from "./types";

export type ValidationResult =
  | { ok: true }
  | { ok: false; missing: string[]; detail?: string };

export type PermissionRequirement = {
  action: PermissionAction;
  nodeType: string;
  fields?: string[];
  recordNodeIds?: NodeId[];
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

export interface UndoInfo {
  description: string;
  revert: (ctx: OperationContext) => Promise<void> | void;
}

export interface OperationResult {
  changes: ChangeSummary[];
  undo?: UndoInfo;
  publishedTo?: PublishTarget[];
  response?: unknown;
}

export type PublishTarget =
  | { kind: "actor"; actor: ActorId }
  | { kind: "record"; nodeType: string; nodeId: NodeId }
  | { kind: "broadcast" };

export interface OperationContext {
  actor: ActorId;
  now: () => string;
  graph: {
    get: (nodeType: string, nodeId: NodeId) => unknown | undefined;
  };
}

export interface OperationHandler<
  TArgs = Record<string, unknown>,
  TResult extends OperationResult = OperationResult,
> {
  name: string;
  category?: OperationCategory;
  validate: (args: TArgs) => ValidationResult;
  permission: (args: TArgs) => PermissionRequirement | PermissionRequirement[];
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
