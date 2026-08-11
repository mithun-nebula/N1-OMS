import type { ActivityEntry } from "./activity-log/types";
import type { ActivityLog } from "./activity-log/types";
import { applyFieldPolicy, type FilteredRecord } from "./permission/field-filter";
import type { PermissionPolicy } from "./permission/policy";
import type { PublishBus } from "./bus";
import {
  flattenRequirements,
  type OperationContext,
  type OperationRegistry,
  type OperationResult,
  type UndoInfo,
} from "./operation/registry";
import type { ActorId, NodeId, Operation, RoleId } from "./operation/types";
import type { RecordStore } from "./record/types";
import type { FigureStore } from "./figures/types";
import { GateEngine, effectiveActor } from "./gate/gate";
import {
  OPAQUE_REFUSAL_MESSAGE,
  type ConfirmationReason,
} from "./gate/result";
import type { AutonomyPolicy } from "./gate/autonomy";

export interface SpineDeps {
  operations: OperationRegistry;
  permissions: PermissionPolicy;
  autonomy: AutonomyPolicy;
  log: ActivityLog;
  graph: RecordStore;
  figures: FigureStore;
  bus: PublishBus;
}

export interface SubmissionResult {
  status:
    | "ran"
    | "rejected"
    | "forbidden"
    | "awaiting-confirmation"
    | "undone"
    | "not-found";
  missing?: string[];
  detail?: string;
  opaqueMessage?: string;
  pendingId?: string;
  prompt?: string;
  reason?: ConfirmationReason;
  graduationOffer?: { ruleId: string; cleanCount: number };
  activityEntry?: ActivityEntry;
  result?: OperationResult;
}

interface PendingConfirmation {
  id: string;
  preparedOperation: Operation;
  reason: ConfirmationReason;
  prompt: string;
}

export class Spine {
  readonly gate: GateEngine;
  private pending = new Map<string, PendingConfirmation>();
  private undos = new Map<string, UndoInfo>();
  private seq = 0;

  constructor(private readonly deps: SpineDeps) {
    this.gate = new GateEngine(deps.operations, deps.permissions, deps.autonomy);
  }

  async submit(operation: Operation): Promise<SubmissionResult> {
    const outcome = await this.gate.evaluate(operation);
    switch (outcome.status) {
      case "rejected":
        return {
          status: "rejected",
          missing: outcome.missing,
          detail: outcome.detail,
        };
      case "forbidden":
        return { status: "forbidden", opaqueMessage: OPAQUE_REFUSAL_MESSAGE };
      case "awaiting-confirmation": {
        const id = this.nextPendingId();
        const pending: PendingConfirmation = {
          id,
          preparedOperation: outcome.preparedOperation,
          reason: outcome.reason,
          prompt: outcome.prompt,
        };
        this.pending.set(id, pending);
        return {
          status: "awaiting-confirmation",
          pendingId: id,
          prompt: outcome.prompt,
          reason: outcome.reason,
        };
      }
      case "run":
        return this.executeAndRecord(operation);
    }
  }

  async confirm(
    pendingId: string,
    confirmer: ActorId,
    opts?: { editedArgs?: Record<string, unknown> },
  ): Promise<SubmissionResult> {
    const pending = this.pending.get(pendingId);
    if (!pending) return { status: "not-found" };
    this.pending.delete(pendingId);
    const operation = pending.preparedOperation;
    const edited = Boolean(opts?.editedArgs);
    const runOperation = edited
      ? { ...operation, args: { ...operation.args, ...opts!.editedArgs } }
      : operation;
    const result = await this.executeAndRecord(runOperation, {
      approvedBy: confirmer,
      confirmationReason: pending.reason,
    });
    if (operation.authority.kind === "delegated" && result.status === "ran") {
      const handler = this.deps.operations.require(operation.name);
      const ruleId = operation.authority.ruleId;
      const author = operation.authority.ruleAuthor;
      this.deps.autonomy.recordOutcome(ruleId, operation.name, {
        approved: true,
        edited,
        category: handler.category,
        author,
      });
      const offer = this.deps.autonomy.offerGraduation(ruleId, operation.name);
      if (offer.due) {
        this.deps.bus.publish({
          kind: "actor",
          actor: author,
          message: `Rule "${ruleId}" has been approved unchanged ${offer.cleanCount} times — shall I run it on my own from now on?`,
        });
        result.graduationOffer = { ruleId, cleanCount: offer.cleanCount };
      }
    }
    return result;
  }

  listPending(): PendingConfirmation[] {
    return [...this.pending.values()];
  }

  async undo(
    activityEntryId: string,
    by: ActorId,
  ): Promise<SubmissionResult> {
    const entry = await this.deps.log.get(activityEntryId);
    if (!entry) return { status: "not-found" };
    const undo = this.undos.get(entry.operationId);
    if (!undo) {
      return {
        status: "rejected",
        detail: "No undo is available for this action.",
      };
    }
    const ctx = this.ctx(by);
    await undo.revert(ctx);
    const undoEntry: ActivityEntry = {
      id: await this.deps.log.nextId(),
      operationId: `undo_${entry.operationId}`,
      operationName: `undo:${entry.operationName}`,
      actor: by,
      authority: { kind: "self", actor: by },
      startedBy: { kind: "form", at: ctx.now(), actor: by },
      at: ctx.now(),
      changes: [],
      outcome: "ran",
    };
    await this.deps.log.append(undoEntry);
    await this.deps.log.markUndone(entry.id, undoEntry.id);
    return { status: "undone", activityEntry: undoEntry };
  }

  async read(opts: {
    actor: ActorId;
    nodeType: string;
    nodeId: NodeId;
  }): Promise<
    | { found: true; record: FilteredRecord }
    | { found: false }
  > {
    const { actor, nodeType, nodeId } = opts;
    const decision = this.deps.permissions.can({
      actor,
      action: "view",
      nodeType,
      recordNodeId: nodeId,
    });
    if (!decision.allowed) {
      return { found: false };
    }
    const node = await this.deps.graph.getNode(nodeType, nodeId);
    if (!node) {
      return { found: false };
    }
    const policy = this.deps.permissions.effectiveFieldPolicy(actor, nodeType);
    const filtered = applyFieldPolicy(node.data as Record<string, unknown>, policy);
    return { found: true, record: filtered };
  }

  canExport(actor: ActorId, nodeType: string): boolean {
    return this.deps.permissions
      .can({ actor, action: "export", nodeType })
      .allowed;
  }

  private async executeAndRecord(
    operation: Operation,
    confirmation?: {
      approvedBy: ActorId;
      confirmationReason: ConfirmationReason;
    },
  ): Promise<SubmissionResult> {
    const handler = this.deps.operations.require(operation.name);
    const actor = effectiveActor(operation.authority);
    const ctx = this.ctx(actor);
    const result = await handler.execute(operation.args, ctx);
    const entry: ActivityEntry = {
      id: await this.deps.log.nextId(),
      operationId: operation.id,
      operationName: operation.name,
      actor,
      authority: operation.authority,
      startedBy: operation.startedBy,
      at: ctx.now(),
      changes: result.changes,
      undoDescription: result.undo?.description,
      approvedBy: confirmation?.approvedBy,
      confirmationReason: confirmation?.confirmationReason,
      outcome: "ran",
    };
    await this.deps.log.append(entry);
    if (result.undo) this.undos.set(operation.id, result.undo);
    this.publishResult(operation, result);
    return { status: "ran", activityEntry: entry, result };
  }

  private publishResult(_operation: Operation, result: OperationResult): void {
    for (const target of result.publishedTo ?? []) {
      if (target.kind === "broadcast") {
        this.deps.bus.publish({
          kind: "broadcast",
          message: summarizeChanges(result),
        });
      } else if (target.kind === "actor") {
        this.deps.bus.publish({
          kind: "actor",
          actor: target.actor,
          message: summarizeChanges(result),
        });
      } else {
        this.deps.bus.publish({
          kind: "record",
          nodeType: target.nodeType,
          nodeId: target.nodeId,
          message: summarizeChanges(result),
        });
      }
    }
  }

  private ctx(actor: ActorId): OperationContext {
    return {
      actor,
      now: () => new Date().toISOString(),
      graph: {
        get: (nodeType: string, nodeId: NodeId) =>
          this.deps.graph.getNode(nodeType, nodeId).then((n) => n?.data),
      },
    };
  }

  private nextPendingId(): string {
    this.seq += 1;
    return `pending_${this.seq.toString(36)}`;
  }
}

export function summarizeChanges(result: OperationResult): string {
  if (result.changes.length === 0) return "Updated.";
  return result.changes
    .map((c) => `${c.nodeType}:${c.nodeId} changed`)
    .join("; ");
}

export type { RoleId };
export { flattenRequirements };
