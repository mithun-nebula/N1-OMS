import type { ActorId, NodeId, RoleId } from "../operation/types";
import type { PermissionAction } from "../operation/registry";

export type RecordScope =
  | { kind: "all" }
  | { kind: "self" }
  /** My team, **including me**. Right for reads: "my team's records". */
  | { kind: "own-team" }
  /**
   * You are named ON the record — an assignee, not its owner.
   *
   * `own-team` resolves a record's single owner and asks whether the actor's
   * circle contains them. That is right for a person's own records and wrong
   * for shared work: a course assigned to somebody outside the owner's circle
   * was invisible to the very person told to do it. They received the task and
   * could not open the course it was for.
   *
   * Deliberately narrow. It grants nothing about a record you were not put on,
   * and it is granted by an operation that already passed the gate.
   */
  | { kind: "assigned" }
  /**
   * My team, **excluding me**. Right for writes.
   *
   * `own-team` on a write is how a manager came to be able to set their own pay
   * and their own role: the team circle includes the actor, so "edit my team's
   * employee records" silently included their own.
   */
  | { kind: "team-others" }
  | { kind: "explicit"; nodeIds: NodeId[] };

export type FieldPolicy =
  | { kind: "all-visible" }
  | { kind: "per-field"; visible: string[]; restricted: string[] };

export interface PermissionRule {
  role: RoleId;
  nodeType: string;
  actions: PermissionAction[];
  recordScope: RecordScope;
  fields: FieldPolicy;
}

export interface RestrictedField {
  __restricted: true;
  label: string;
}

export const RESTRICTED: RestrictedField = { __restricted: true, label: "Restricted" };

export function isRestricted(value: unknown): value is RestrictedField {
  return (
    typeof value === "object" &&
    value !== null &&
    (value as RestrictedField).__restricted === true
  );
}

export type ScopeResolver = (input: {
  actor: ActorId;
  scope: RecordScope;
  nodeType: string;
  recordNodeId: NodeId;
}) => boolean;

export interface RoleProvider {
  rolesFor(actor: ActorId): RoleId[];
  teamOf(actor: ActorId): ActorId[];
  ownerOf(nodeType: string, recordNodeId: NodeId): ActorId | undefined;
  /** Everyone named on the record, for the `assigned` scope. Empty when none. */
  assigneesOf(nodeType: string, recordNodeId: NodeId): ActorId[];
}

export interface PermissionCheckInput {
  actor: ActorId;
  action: PermissionAction;
  nodeType: string;
  recordNodeId?: NodeId;
  requiredFields?: string[];
}

export type PermissionDecision =
  | { allowed: true }
  | { allowed: false };
