import type { ActorId, NodeId } from "@/spine/operation/types";
import type { PermissionAction } from "@/spine/operation/registry";
import { PermissionPolicy } from "@/spine/permission/policy";
import type { PermissionRule, RoleProvider } from "@/spine/permission/types";
import { DEMO_PEOPLE, DEMO_TEAM_LEADS } from "@/domains/shared/people-roster";
import { roleOfActor } from "./accounts";

const ALL_ACTIONS: PermissionAction[] = [
  "view",
  "create",
  "edit",
  "approve",
  "export",
  "delete",
];

const ADMIN_ACTIONS: PermissionAction[] = [
  "view",
  "create",
  "edit",
  "approve",
  "export",
];

const MANAGED_NODE_TYPES = ["employee", "course"];

function superAdminRules(): PermissionRule[] {
  return MANAGED_NODE_TYPES.map((nodeType) => ({
    role: "super-admin",
    nodeType,
    actions: ALL_ACTIONS,
    recordScope: { kind: "all" },
    fields: { kind: "all-visible" },
  }));
}

function adminRules(): PermissionRule[] {
  return MANAGED_NODE_TYPES.map((nodeType) => ({
    role: "admin",
    nodeType,
    actions: ADMIN_ACTIONS,
    recordScope: { kind: "all" },
    fields: { kind: "all-visible" },
  }));
}

export const DEMO_PERMISSION_RULES: PermissionRule[] = [
  ...superAdminRules(),
  ...adminRules(),
  {
    role: "hr",
    nodeType: "employee",
    actions: ["view", "create", "edit", "approve", "export"],
    recordScope: { kind: "all" },
    fields: { kind: "all-visible" },
  },
  {
    role: "manager",
    nodeType: "employee",
    actions: ["view", "edit", "approve"],
    recordScope: { kind: "own-team" },
    fields: { kind: "all-visible" },
  },
  {
    role: "manager",
    nodeType: "course",
    actions: ["view", "edit", "approve"],
    recordScope: { kind: "all" },
    fields: { kind: "all-visible" },
  },
  {
    role: "employee",
    nodeType: "employee",
    actions: ["view"],
    recordScope: { kind: "own-team" },
    fields: {
      kind: "per-field",
      visible: ["name", "role", "contact"],
      restricted: ["pay", "performance"],
    },
  },
  {
    role: "employee",
    nodeType: "employee",
    actions: ["edit"],
    recordScope: { kind: "self" },
    fields: {
      kind: "per-field",
      visible: ["leaveBalance", "pendingLeave"],
      restricted: ["pay", "performance"],
    },
  },
  {
    role: "employee",
    nodeType: "course",
    actions: ["view", "edit"],
    recordScope: { kind: "own-team" },
    fields: { kind: "all-visible" },
  },
  {
    role: "intern",
    nodeType: "employee",
    actions: ["view"],
    recordScope: { kind: "own-team" },
    fields: {
      kind: "per-field",
      visible: ["name", "role", "contact"],
      restricted: ["pay", "performance"],
    },
  },
  {
    role: "intern",
    nodeType: "course",
    actions: ["view"],
    recordScope: { kind: "own-team" },
    fields: { kind: "all-visible" },
  },
];

export class DemoRoleProvider implements RoleProvider {
  constructor(
    private readonly owners: Map<string, ActorId>,
    private readonly teams: Map<ActorId, string>,
  ) {}

  rolesFor(actor: ActorId): string[] {
    const role = roleOfActor(actor);
    return role ? [role] : [];
  }

  teamOf(actor: ActorId): ActorId[] {
    const team = this.teams.get(actor);
    if (!team) return [];
    const lead = DEMO_TEAM_LEADS[team];
    const members = Object.entries(DEMO_PEOPLE)
      .filter(([, p]) => p.team === team)
      .map(([id]) => id);
    return lead ? [lead, ...members] : members;
  }

  ownerOf(nodeType: string, recordNodeId: NodeId): ActorId | undefined {
    if (nodeType === "employee") return recordNodeId;
    return this.owners.get(`${nodeType}:${recordNodeId}`);
  }
}

export function buildDemoPermissionPolicy(
  owners: Map<string, ActorId>,
  teams: Map<ActorId, string>,
): PermissionPolicy {
  return new PermissionPolicy(
    DEMO_PERMISSION_RULES,
    new DemoRoleProvider(owners, teams),
  );
}
