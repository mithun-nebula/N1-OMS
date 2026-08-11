import type { ActorId, NodeId } from "@/spine/operation/types";
import type { PermissionAction } from "@/spine/operation/registry";
import { PermissionPolicy } from "@/spine/permission/policy";
import type { PermissionRule, RoleProvider } from "@/spine/permission/types";
import { DEMO_PEOPLE, DEMO_TEAM_LEADS } from "@/domains/shared/people-roster";
import { SUPPORTED_DOCTYPES } from "@/domains/people/n1-doctypes";
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

const MANAGED_NODE_TYPES = [
  "employee",
  "course",
  "onboarding",
  "offboarding",
  "org-memory",
  "room",
  "booking",
  "meeting",
  "calendar-entry",
  "event",
  "document",
  "announcement",
];

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

/**
 * Permission rules generated from the N1 DocType registry.
 * - Sensitive node types (payroll/payslip/appraisal/tax…): hr/admin/super-admin view+export.
 * - Non-sensitive node types: all six roles view; hr/admin/super-admin edit.
 * Employees still reach their own pay/payslips via the dedicated PeopleRecordService
 * (self-scoped API), not via a generic graph rule.
 */
function n1GeneratedRules(): PermissionRule[] {
  const rules: PermissionRule[] = [];
  for (const m of SUPPORTED_DOCTYPES) {
    if (m.sensitive) {
      for (const role of ["hr", "admin", "super-admin"] as const) {
        rules.push({
          role,
          nodeType: m.nodeType,
          actions:
            role === "hr"
              ? ["view", "export"]
              : role === "super-admin"
                ? ["view", "create", "edit", "delete", "export", "approve"]
                : ["view", "create", "edit", "export", "approve"],
          recordScope: { kind: "all" },
          fields: { kind: "all-visible" },
        });
      }
    } else {
      for (const role of ["super-admin", "admin", "hr", "manager", "employee", "intern"] as const) {
        const canManage = role === "super-admin" || role === "admin" || role === "hr";
        const canDelete = role === "super-admin" || role === "admin";
        rules.push({
          role,
          nodeType: m.nodeType,
          actions: canManage
            ? canDelete
              ? ["view", "create", "edit", "delete", "export"]
              : ["view", "create", "edit", "export"]
            : ["view"],
          recordScope: { kind: "all" },
          fields: { kind: "all-visible" },
        });
      }
    }
  }
  return rules;
}

export const DEMO_PERMISSION_RULES: PermissionRule[] = [
  ...superAdminRules(),
  ...adminRules(),
  ...n1GeneratedRules(),
  {
    role: "super-admin",
    nodeType: "task",
    actions: ["delete", "export"],
    recordScope: { kind: "all" },
    fields: { kind: "all-visible" },
  },
  {
    role: "admin",
    nodeType: "task",
    actions: ["delete", "export"],
    recordScope: { kind: "all" },
    fields: { kind: "all-visible" },
  },
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
  {
    role: "hr",
    nodeType: "onboarding",
    actions: ["view", "create", "edit", "approve"],
    recordScope: { kind: "all" },
    fields: { kind: "all-visible" },
  },
  {
    role: "hr",
    nodeType: "offboarding",
    actions: ["view", "create", "edit"],
    recordScope: { kind: "all" },
    fields: { kind: "all-visible" },
  },
  {
    role: "manager",
    nodeType: "onboarding",
    actions: ["view", "create", "edit"],
    recordScope: { kind: "own-team" },
    fields: { kind: "all-visible" },
  },
  {
    role: "manager",
    nodeType: "offboarding",
    actions: ["view", "create", "edit"],
    recordScope: { kind: "own-team" },
    fields: { kind: "all-visible" },
  },
  {
    role: "employee",
    nodeType: "onboarding",
    actions: ["view"],
    recordScope: { kind: "self" },
    fields: { kind: "all-visible" },
  },
  {
    role: "employee",
    nodeType: "offboarding",
    actions: ["view"],
    recordScope: { kind: "self" },
    fields: { kind: "all-visible" },
  },
  {
    role: "hr",
    nodeType: "org-memory",
    actions: ["view", "create"],
    recordScope: { kind: "all" },
    fields: { kind: "all-visible" },
  },
  {
    role: "manager",
    nodeType: "org-memory",
    actions: ["view", "create"],
    recordScope: { kind: "all" },
    fields: { kind: "all-visible" },
  },
  {
    role: "employee",
    nodeType: "org-memory",
    actions: ["view"],
    recordScope: { kind: "all" },
    fields: { kind: "all-visible" },
  },
  {
    role: "intern",
    nodeType: "org-memory",
    actions: ["view"],
    recordScope: { kind: "all" },
    fields: { kind: "all-visible" },
  },
];

export class DemoRoleProvider implements RoleProvider {
  constructor(
    private readonly owners: Map<string, ActorId>,
    private readonly teams: Map<ActorId, string>,
  ) {
    for (const [id, p] of Object.entries(DEMO_PEOPLE)) {
      if (!teams.has(id)) teams.set(id, p.team);
    }
  }

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
    if (nodeType === "onboarding" || nodeType === "offboarding") {
      const sep = recordNodeId.indexOf(":");
      return sep >= 0 ? recordNodeId.slice(sep + 1) : recordNodeId;
    }
    return this.owners.get(`${nodeType}:${recordNodeId}`);
  }
}

export const OPEN_NODE_TYPES = new Set([
  "room",
  "booking",
  "meeting",
  "calendar-entry",
  "meeting-decision",
  "event",
  "event-task",
  "document",
  "announcement",
  "utility-capture",
  "fault",
  "task",
]);

export function buildDemoPermissionPolicy(
  owners: Map<string, ActorId>,
  teams: Map<ActorId, string>,
): PermissionPolicy {
  return new PermissionPolicy(
    DEMO_PERMISSION_RULES,
    new DemoRoleProvider(owners, teams),
    OPEN_NODE_TYPES,
  );
}
