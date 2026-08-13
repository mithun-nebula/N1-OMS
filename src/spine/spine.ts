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
  type UndoStep,
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
    if (!(await this.mayConfirm(pending.preparedOperation, confirmer))) {
      // Do NOT delete the pending item — an unauthorised attempt must not
      // destroy a confirmation the rightful approver still needs.
      return { status: "forbidden", opaqueMessage: OPAQUE_REFUSAL_MESSAGE };
    }
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

  /**
   * Confirming a parked money/people operation is an authority decision, so it
   * needs the same scrutiny as running one. Without this, knowing a pending id
   * was enough for any signed-in user to release it (non-negotiable #3).
   *
   * Allowed: the rule's own author (they delegated it, they answer for it), or
   * anyone holding `approve` on every record the operation touches.
   */
  private async mayConfirm(
    operation: Operation,
    confirmer: ActorId,
  ): Promise<boolean> {
    const auth = operation.authority;
    // Person-started operations never park here today, but if one ever does,
    // only the person who started it may release it.
    if (auth.kind === "self") return auth.actor === confirmer;
    if (auth.ruleAuthor === confirmer) return true;

    const handler = this.deps.operations.get(operation.name);
    if (!handler) return false;
    const requirements = flattenRequirements(
      await handler.permission(operation.args),
    );
    return requirements.every((req) => {
      const ids: (NodeId | undefined)[] = req.recordNodeIds?.length
        ? req.recordNodeIds
        : [undefined];
      return ids.every(
        (recordNodeId) =>
          this.deps.permissions.can({
            actor: confirmer,
            action: "approve",
            nodeType: req.nodeType,
            recordNodeId,
          }).allowed,
      );
    });
  }

  async undo(
    activityEntryId: string,
    by: ActorId,
  ): Promise<SubmissionResult> {
    const entry = await this.deps.log.get(activityEntryId);
    if (!entry) return { status: "not-found" };
    if (entry.outcome === "undone") {
      return { status: "rejected", detail: "That action was already undone." };
    }
    const undo = this.undos.get(entry.operationId);
    const ctx = this.ctx(by);
    if (undo?.revert) {
      // Same process as the original action — use the richer closure.
      await undo.revert(ctx);
    } else if (entry.undoPlan?.length) {
      // The closure is gone (restart, or a different instance). Replay the
      // serialised plan instead. This is why undo survives a restart at all.
      await this.applyUndoPlan(entry.undoPlan);
    } else {
      return {
        status: "rejected",
        detail: "No undo is available for this action.",
      };
    }
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

  /**
   * `read()` for a whole node type, in one pass.
   *
   * Pages like `/team` and the dashboard currently loop `read()` over every
   * person, which is one database round trip each — fine for nine people, not
   * for two hundred. This does a single `find()` and applies the same
   * permission and field filtering in memory, resolving the field policy once
   * for the actor instead of once per record.
   *
   * Records the actor may not view are simply absent from the result, which is
   * the same non-disclosure `read()` gives with `{ found: false }` — the caller
   * cannot tell "not permitted" from "does not exist".
   */
  async readMany(opts: {
    actor: ActorId;
    nodeType: string;
    filter?: (data: Record<string, unknown>, nodeId: NodeId) => boolean;
  }): Promise<Array<{ nodeId: NodeId; record: FilteredRecord }>> {
    const { actor, nodeType, filter } = opts;

    // Cheap gate first: with no matching rule for this actor and type at all,
    // no record of it can be visible, so skip the query entirely.
    const anyRule = this.deps.permissions.can({ actor, action: "view", nodeType });
    if (!anyRule.allowed) return [];

    const nodes = await this.deps.graph.find(nodeType, (node) =>
      filter ? filter(node.data as Record<string, unknown>, node.id) : true,
    );
    const policy = this.deps.permissions.effectiveFieldPolicy(actor, nodeType);

    const out: Array<{ nodeId: NodeId; record: FilteredRecord }> = [];
    for (const node of nodes) {
      // Record scope still has to be checked per record — `own-team` and `self`
      // depend on which record it is, not just the type.
      const allowed = this.deps.permissions.can({
        actor,
        action: "view",
        nodeType,
        recordNodeId: node.id,
      }).allowed;
      if (!allowed) continue;
      out.push({
        nodeId: node.id,
        record: applyFieldPolicy(node.data as Record<string, unknown>, policy),
      });
    }
    return out;
  }

  canExport(actor: ActorId, nodeType: string): boolean {
    return this.deps.permissions
      .can({ actor, action: "export", nodeType })
      .allowed;
  }

  /** Replays a serialised undo plan against the record store, in order. */
  private async applyUndoPlan(plan: UndoStep[]): Promise<void> {
    for (const step of plan) {
      switch (step.op) {
        case "put":
          await this.deps.graph.putNode(step.nodeType, step.nodeId, step.data);
          break;
        case "patch":
          await this.deps.graph.patchNode(step.nodeType, step.nodeId, step.data);
          break;
        case "remove":
          await this.deps.graph.removeNode(step.nodeType, step.nodeId);
          break;
        case "addEdge":
          await this.deps.graph.addEdge({
            from: step.from,
            to: step.to,
            type: step.edgeType,
            data: step.data,
          });
          break;
        case "removeEdge":
          await this.deps.graph.removeEdge(step.from, step.to, step.edgeType);
          break;
      }
    }
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

    let result: OperationResult;
    try {
      result = await handler.execute(operation.args, ctx);
    } catch (error) {
      // A handler refusing on a business rule — "that id is taken", "they still
      // manage people" — must reach the caller as a refusal, not a 500. Nothing
      // is recorded: the operation did not happen.
      return {
        status: "rejected",
        detail:
          error instanceof Error ? error.message : "That could not be completed.",
      };
    }
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
      undoPlan: result.undo?.plan,
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
    // An operation may supply its own wording and a record to link to; where it
    // does not, fall back to the generic change summary.
    const fallback = () => summarizeChanges(result);
    const firstChange = result.changes[0];
    const defaultRef = firstChange
      ? { nodeType: firstChange.nodeType, nodeId: firstChange.nodeId }
      : undefined;

    for (const target of result.publishedTo ?? []) {
      if (target.kind === "broadcast") {
        this.deps.bus.publish({
          kind: "broadcast",
          message: target.message ?? fallback(),
          ref: target.ref ?? defaultRef,
        });
      } else if (target.kind === "actor") {
        this.deps.bus.publish({
          kind: "actor",
          actor: target.actor,
          message: target.message ?? fallback(),
          ref: target.ref ?? defaultRef,
        });
      } else {
        this.deps.bus.publish({
          kind: "record",
          nodeType: target.nodeType,
          nodeId: target.nodeId,
          message: target.message ?? fallback(),
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
