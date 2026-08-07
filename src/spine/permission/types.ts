import type { ActorId, NodeId, RoleId } from "../operation/types";
import type { PermissionAction } from "../operation/registry";

export type RecordScope =
  | { kind: "all" }
  | { kind: "self" }
  | { kind: "own-team" }
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
