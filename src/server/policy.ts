import type { ActorId, NodeId } from "@/spine/operation/types";
import type { PermissionAction } from "@/spine/operation/registry";
import { PermissionPolicy } from "@/spine/permission/policy";
import type { PermissionRule, RoleProvider } from "@/spine/permission/types";
import { SUPPORTED_DOCTYPES } from "@/domains/people/n1-doctypes";
import { roleOfActor } from "./accounts";
import { directory } from "./directory";

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
  // ── A manager's reach over their team, split three ways ───────────────────
  //
  // This was one rule: view + edit + approve, `own-team`, all fields visible.
  // Two problems followed from it. `teamCircleOf` includes the actor, so
  // "my team" included themselves — and with every field visible, a manager
  // could set **their own pay** and **their own role**. Writing your own role
  // then mattered twice over, because `employee.create` read the directory
  // before the account when deciding what you may hand out.
  //
  // Reads stay wide, writes narrow.
  {
    // Reads: the whole team, including themselves, every field. Keeping ONE
    // all-visible rule here is deliberate — `effectiveFieldPolicy` merges to
    // all-visible if any applicable rule is, which is what keeps pay readable
    // on /team and in readMany. Do not "tidy" this into per-field.
    role: "manager",
    nodeType: "employee",
    actions: ["view"],
    recordScope: { kind: "own-team" },
    fields: { kind: "all-visible" },
  },
  {
    // Approving is always about somebody else. A manager approving their own
    // leave was possible before and should not be.
    role: "manager",
    nodeType: "employee",
    actions: ["approve"],
    recordScope: { kind: "team-others" },
    fields: { kind: "all-visible" },
  },
  {
    // Writes: their reports only, and only the fields a manager has business
    // changing. `restricted` here is not cosmetic — `fieldsVisible` requires
    // every written field to appear in `visible`, so pay, performance and role
    // are refused outright rather than masked.
    //
    // `leaveBalance` is visible because `leave.approve` decrements it.
    role: "manager",
    nodeType: "employee",
    actions: ["edit"],
    recordScope: { kind: "team-others" },
    fields: {
      kind: "per-field",
      visible: [
        "name",
        "contact",
        "team",
        "managerId",
        "departmentId",
        "designationId",
        "leaveBalance",
        "pendingLeave",
        "status",
        "lastWorkingDay",
        "deactivationReason",
      ],
      restricted: ["pay", "performance", "role", "password"],
    },
  },
  {
    // Managers add their own team members. Scope is `all` because there is no
    // record yet to scope against — *which* roles they may hand out is enforced
    // separately by the role ladder in `employee.create` (`canAssignRole`), so
    // a manager can create an employee or an intern but never an admin.
    role: "manager",
    nodeType: "employee",
    actions: ["create"],
    recordScope: { kind: "all" },
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
    // What somebody may change on their own record.
    //
    // `leaveBalance` used to be in `visible` here, which made it **writable**:
    // `record.update` on your own record with `{leaveBalance: 365}` passed the
    // gate. A whitelist meant for a read filter was being honoured as a write
    // grant. Your balance is a consequence of approved leave, never something
    // you set — so it is restricted, and `leave.approve` changes it instead.
    role: "employee",
    nodeType: "employee",
    actions: ["edit"],
    recordScope: { kind: "self" },
    fields: {
      kind: "per-field",
      visible: ["contact", "pendingLeave"],
      restricted: ["pay", "performance", "role", "leaveBalance", "status", "team"],
    },
  },
  {
    // Interns can request their own leave. They had no `edit` rule on
    // `employee` at all, so `leave.request` was refused for them — invisible,
    // because the leave form lists everyone and the refusal is opaque.
    role: "intern",
    nodeType: "employee",
    actions: ["edit"],
    recordScope: { kind: "self" },
    fields: {
      kind: "per-field",
      visible: ["contact", "pendingLeave"],
      restricted: ["pay", "performance", "role", "leaveBalance", "status", "team"],
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

  // ── Attendance: personal by default ──────────────────────────────────────
  //
  // Everyone clocks themselves in and out (`self` scope; the operations also
  // refuse acting-for-others outright). HR and admins see the org, a manager
  // sees their team — nobody else sees anyone's day but their own.
  ...(["super-admin", "admin", "hr", "manager", "employee", "intern"] as const).map(
    (role) => ({
      role,
      nodeType: "attendance",
      actions: ["view", "create", "edit"] as PermissionAction[],
      recordScope: { kind: "self" } as const,
      fields: { kind: "all-visible" } as const,
    }),
  ),
  {
    role: "manager",
    nodeType: "attendance",
    actions: ["view"],
    recordScope: { kind: "own-team" },
    fields: { kind: "all-visible" },
  },
  ...(["super-admin", "admin", "hr"] as const).map((role) => ({
    role,
    nodeType: "attendance",
    actions: ["view", "export"] as PermissionAction[],
    recordScope: { kind: "all" } as const,
    fields: { kind: "all-visible" } as const,
  })),
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

  /**
   * The `own-team` scope: everyone whose records this actor may reach.
   *
   * Reads the people directory rather than the old hardcoded roster, so someone
   * added today is in their manager's scope immediately. `teams` is still
   * honoured as an override for anything set outside the directory.
   */
  teamOf(actor: ActorId): ActorId[] {
    const fromDirectory = directory().teamCircleOf(actor);
    if (fromDirectory.length > 0) return fromDirectory;

    const team = this.teams.get(actor);
    if (!team) return [];
    return [...this.teams.entries()]
      .filter(([, t]) => t === team)
      .map(([id]) => id);
  }

  ownerOf(nodeType: string, recordNodeId: NodeId): ActorId | undefined {
    if (nodeType === "employee") return recordNodeId;
    if (nodeType === "onboarding" || nodeType === "offboarding") {
      const sep = recordNodeId.indexOf(":");
      return sep >= 0 ? recordNodeId.slice(sep + 1) : recordNodeId;
    }
    if (nodeType === "attendance") {
      // att_<employee>_<YYYY-MM-DD> — the owner travels in the id because the
      // gate is synchronous and cannot look the record up.
      const m = /^att_(.+)_(\d{4}-\d{2}-\d{2})$/.exec(recordNodeId);
      return m?.[1];
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
