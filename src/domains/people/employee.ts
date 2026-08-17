import type { OperationHandler, OperationResult } from "@/spine/operation/registry";
import type { RecordStore } from "@/spine/record/types";
import type { RbacRole } from "@/domains/shared/people-roster";
import {
  addAccountForPerson,
  accountOfActor,
  findAccount,
  removeAccount,
  roleOfActor,
  setAccountEnabled,
} from "@/server/accounts";
import { directory } from "@/server/directory";
import { canAssignRole } from "@/server/roles";

/**
 * Real employee records.
 *
 * Before this, the roster was a constant in a source file and "adding someone"
 * meant creating a login with no record behind it — the person could sign in
 * and then appear in no directory, no team, no assignment list.
 *
 * `employee.create` makes the record and the login in **one** operation, so the
 * two cannot drift apart.
 */

const VALID_ROLES: RbacRole[] = [
  "super-admin",
  "admin",
  "hr",
  "manager",
  "employee",
  "intern",
];

export interface EmployeeData {
  name: string;
  role: RbacRole;
  team?: string;
  contact?: string;
  joiningDate?: string;
  managerId?: string;
  departmentId?: string;
  designationId?: string;
  status: "active" | "inactive" | "separated";
  pay?: number;
  payEffectiveFrom?: string;
  leaveBalance?: number;
  lastWorkingDay?: string;
  deactivationReason?: string;
  [key: string]: unknown;
}

/** Ids are typed by hand rather than generated — see below. */
const ID_PATTERN = /^[a-z][a-z0-9-]{1,38}$/;

/** Refresh the directory after any change to who works here. */
async function refresh(graph: RecordStore): Promise<void> {
  await directory().hydrate(graph);
}

/**
 * Check a proposed manager before it is stored.
 *
 * Unvalidated, `managerId` can point at somebody who does not exist, somebody
 * who has left, the person themselves, or close a loop. None of those fail
 * loudly — they just quietly break approval routing (leave goes to a manager
 * who cannot sign in) and can make someone impossible to deactivate, because
 * `employee.deactivate` refuses while they still manage people.
 *
 * Returns an error message, or undefined when the assignment is fine.
 */
function managerProblem(
  employeeId: string,
  managerId: string | undefined,
): string | undefined {
  if (!managerId) return undefined;
  const people = directory();

  if (managerId === employeeId) return "Someone cannot manage themselves.";
  const manager = people.get(managerId);
  if (!manager) return `There is no employee "${managerId}".`;
  if (!manager.active) {
    return `${manager.name} has left, so they cannot manage anyone.`;
  }
  if (people.wouldCreateCycle(employeeId, managerId)) {
    return `${manager.name} already reports to ${people.nameOf(employeeId)}, directly or indirectly.`;
  }
  return undefined;
}

// ── create ─────────────────────────────────────────────────────────────────

export interface EmployeeCreateArgs {
  employeeId: string;
  name: string;
  role: string;
  username: string;
  temporaryPassword: string;
  contact?: string;
  team?: string;
  joiningDate?: string;
  managerId?: string;
  departmentId?: string;
  designationId?: string;
}

export function employeeCreateHandler(
  graph: RecordStore,
): OperationHandler<EmployeeCreateArgs> {
  return {
    name: "employee.create",
    category: "people",
    validate: async (args) => {
      const missing: string[] = [];
      if (!args.employeeId) missing.push("employeeId");
      if (!args.name) missing.push("name");
      if (!args.role) missing.push("role");
      if (!args.username) missing.push("username");
      if (!args.temporaryPassword) missing.push("temporaryPassword");
      if (missing.length > 0) return { ok: false, missing };

      if (!ID_PATTERN.test(args.employeeId)) {
        return {
          ok: false,
          missing: ["employeeId"],
          detail:
            "An employee id must be lowercase letters, numbers or hyphens, and start with a letter.",
        };
      }
      if (!VALID_ROLES.includes(args.role as RbacRole)) {
        return { ok: false, missing: ["role"], detail: `Unknown role: ${args.role}.` };
      }
      if (args.temporaryPassword.length < 6) {
        return {
          ok: false,
          missing: ["temporaryPassword"],
          detail: "The temporary password must be at least 6 characters.",
        };
      }

      // Uniqueness is checked here, not in execute, so a clash comes back as a
      // named argument the caller can correct rather than a thrown error.
      // The employee node id IS the actor id the permission layer keys on, so a
      // collision would quietly hand one person another's records.
      if (await graph.getNode("employee", args.employeeId)) {
        return {
          ok: false,
          missing: ["employeeId"],
          detail: `Someone already has the id "${args.employeeId}".`,
        };
      }
      if (accountOfActor(args.employeeId)) {
        return {
          ok: false,
          missing: ["employeeId"],
          detail: `The id "${args.employeeId}" is already in use by a login.`,
        };
      }
      if (findAccount(args.username)) {
        return {
          ok: false,
          missing: ["username"],
          detail: `The username "${args.username}" is taken.`,
        };
      }
      const badManager = managerProblem(args.employeeId, args.managerId);
      if (badManager) {
        return { ok: false, missing: ["managerId"], detail: badManager };
      }
      return { ok: true };
    },
    permission: () => ({ action: "create", nodeType: "employee" }),
    involvesMoneyOrPeople: () => true,
    execute: async (args, ctx) => {
      const id = args.employeeId;

      // Nobody may create a role above their own — otherwise "managers can add
      // people" is a one-step privilege escalation.
      //
      // Read the role from `roleOfActor`, which asks the **account** first. This
      // used to read the directory first, which is rebuilt from employee records
      // — so writing `role: "super-admin"` onto your own employee record and
      // waiting for a refresh was enough to mint a super-admin login. The rule
      // split now refuses that write, and this makes the escalation impossible
      // even if some other path ever allows it.
      const creatorRole = roleOfActor(ctx.actor);
      if (!canAssignRole(creatorRole, args.role)) {
        throw new Error(`You cannot create a ${args.role}.`);
      }

      const data: EmployeeData = {
        name: args.name,
        role: args.role as RbacRole,
        team: args.team,
        contact: args.contact ?? `${id}@orga.example`,
        joiningDate: args.joiningDate ?? ctx.now().slice(0, 10),
        managerId: args.managerId,
        departmentId: args.departmentId,
        designationId: args.designationId,
        status: "active",
        leaveBalance: 0,
      };

      await graph.putNode("employee", id, data);

      const account = await addAccountForPerson({
        personId: id,
        username: args.username,
        temporaryPassword: args.temporaryPassword,
        displayName: args.name,
        role: args.role as RbacRole,
        team: args.team,
      });
      if (!account.ok) {
        // Do not leave a record with no way to sign in.
        await graph.removeNode("employee", id);
        throw new Error(account.error ?? "Could not create the login.");
      }

      if (args.managerId) {
        await graph.addEdge({ from: id, to: args.managerId, type: "reports-to" });
      }
      await refresh(graph);

      const result: OperationResult = {
        changes: [{ nodeType: "employee", nodeId: id, after: data }],
        undo: {
          description: `Remove ${args.name} and their login.`,
          revert: async () => {
            await graph.removeNode("employee", id);
            await removeAccount(args.username);
            if (args.managerId) {
              await graph.removeEdge(id, args.managerId, "reports-to");
            }
            await refresh(graph);
          },
          plan: [{ op: "remove", nodeType: "employee", nodeId: id }],
        },
        publishedTo: [
          {
            kind: "actor",
            actor: ctx.actor,
            message: `${args.name} was added. Their temporary password must be changed at first sign-in.`,
            ref: { nodeType: "employee", nodeId: id },
          },
        ],
        response: { employeeId: id, username: args.username },
      };
      return result;
    },
  };
}

// ── update ─────────────────────────────────────────────────────────────────

export interface EmployeeUpdateArgs {
  employeeId: string;
  patch: Partial<
    Pick<
      EmployeeData,
      "name" | "contact" | "team" | "managerId" | "departmentId" | "designationId"
    >
  >;
}

const UPDATABLE = new Set([
  "name",
  "contact",
  "team",
  "managerId",
  "departmentId",
  "designationId",
]);

export function employeeUpdateHandler(
  graph: RecordStore,
): OperationHandler<EmployeeUpdateArgs> {
  return {
    name: "employee.update",
    category: "people",
    validate: (args) => {
      const missing: string[] = [];
      if (!args.employeeId) missing.push("employeeId");
      if (!args.patch || Object.keys(args.patch).length === 0) missing.push("patch");
      if (missing.length > 0) return { ok: false, missing };

      const unknown = Object.keys(args.patch).filter((k) => !UPDATABLE.has(k));
      if (unknown.length > 0) {
        return {
          ok: false,
          missing: unknown,
          detail: `These cannot be changed here: ${unknown.join(", ")}. Pay has its own operation.`,
        };
      }
      if ("managerId" in args.patch) {
        const badManager = managerProblem(args.employeeId, args.patch.managerId);
        if (badManager) {
          return { ok: false, missing: ["managerId"], detail: badManager };
        }
      }
      return { ok: true };
    },
    // Declaring the fields lets the field-permission layer stop, say, an
    // employee editing something they can only view.
    permission: (args) => ({
      action: "edit",
      nodeType: "employee",
      recordNodeIds: [args.employeeId],
      fields: Object.keys(args.patch ?? {}),
    }),
    involvesMoneyOrPeople: () => false,
    execute: async (args, ctx) => {
      const node = await graph.getNode("employee", args.employeeId);
      const before = node?.data as EmployeeData | undefined;
      if (!before) throw new Error(`No employee ${args.employeeId}.`);

      const after = { ...before, ...args.patch };
      await graph.putNode("employee", args.employeeId, after);
      await refresh(graph);

      // Only the fields that actually changed, so undo cannot resurrect a stale
      // value for something this operation never touched.
      const restore: Record<string, unknown> = {};
      for (const key of Object.keys(args.patch)) {
        restore[key] = (before as Record<string, unknown>)[key];
      }

      return {
        changes: [{ nodeType: "employee", nodeId: args.employeeId, after: args.patch }],
        undo: {
          description: `Undo changes to ${before.name}.`,
          revert: async () => {
            await graph.putNode("employee", args.employeeId, before);
            await refresh(graph);
          },
          plan: [
            {
              op: "patch",
              nodeType: "employee",
              nodeId: args.employeeId,
              data: restore,
            },
          ],
        },
        publishedTo: [
          {
            kind: "actor",
            actor: ctx.actor,
            message: `${before.name}'s details were updated.`,
            ref: { nodeType: "employee", nodeId: args.employeeId },
          },
        ],
      };
    },
  };
}

// ── deactivate / reactivate ────────────────────────────────────────────────

export interface EmployeeDeactivateArgs {
  employeeId: string;
  lastWorkingDay: string;
  reason: string;
}

export function employeeDeactivateHandler(
  graph: RecordStore,
): OperationHandler<EmployeeDeactivateArgs> {
  return {
    name: "employee.deactivate",
    // Someone leaving is the one category that can never be automated.
    category: "leaving-org",
    validate: async (args) => {
      const missing: string[] = [];
      if (!args.employeeId) missing.push("employeeId");
      if (!args.lastWorkingDay) missing.push("lastWorkingDay");
      if (!args.reason) missing.push("reason");
      if (missing.length > 0) return { ok: false, missing };

      const node = await graph.getNode("employee", args.employeeId);
      const person = node?.data as EmployeeData | undefined;
      if (!person) {
        return {
          ok: false,
          missing: ["employeeId"],
          detail: `No employee ${args.employeeId}.`,
        };
      }
      if (person.status !== "active") {
        return {
          ok: false,
          missing: ["employeeId"],
          detail: `${person.name} is already inactive.`,
        };
      }

      // Refuse while they still manage people: their reports would be left
      // pointing at someone who no longer works here, and approvals routed to
      // them would go nowhere.
      const reports = directory().reportsOf(args.employeeId);
      if (reports.length > 0) {
        const names = reports.map((r) => directory().nameOf(r)).join(", ");
        return {
          ok: false,
          missing: ["reassignReports"],
          detail: `${person.name} still manages ${reports.length} ${
            reports.length === 1 ? "person" : "people"
          } (${names}). Reassign them first.`,
        };
      }
      return { ok: true };
    },
    permission: (args) => ({
      action: "edit",
      nodeType: "employee",
      recordNodeIds: [args.employeeId],
    }),
    involvesMoneyOrPeople: () => true,
    execute: async (args) => {
      const node = await graph.getNode("employee", args.employeeId);
      const before = node?.data as EmployeeData | undefined;
      if (!before) throw new Error(`No employee ${args.employeeId}.`);

      const after: EmployeeData = {
        ...before,
        status: "inactive",
        lastWorkingDay: args.lastWorkingDay,
        deactivationReason: args.reason,
      };
      // The record and its whole history stay — only the login stops working.
      await graph.putNode("employee", args.employeeId, after);
      await setAccountEnabled(args.employeeId, false);
      await refresh(graph);

      return {
        changes: [
          {
            nodeType: "employee",
            nodeId: args.employeeId,
            after: { status: "inactive", lastWorkingDay: args.lastWorkingDay },
          },
        ],
        undo: {
          description: `Bring ${before.name} back. Their login needs a new password.`,
          revert: async () => {
            await graph.putNode("employee", args.employeeId, before);
            await refresh(graph);
          },
          plan: [
            {
              op: "patch",
              nodeType: "employee",
              nodeId: args.employeeId,
              data: {
                status: before.status,
                lastWorkingDay: null,
                deactivationReason: null,
              },
            },
          ],
        },
        publishedTo: [
          {
            kind: "broadcast",
            message: `${before.name} left on ${args.lastWorkingDay}.`,
            ref: { nodeType: "employee", nodeId: args.employeeId },
          },
        ],
      };
    },
  };
}

export interface EmployeeReactivateArgs {
  employeeId: string;
  temporaryPassword: string;
}

export function employeeReactivateHandler(
  graph: RecordStore,
): OperationHandler<EmployeeReactivateArgs> {
  return {
    name: "employee.reactivate",
    category: "people",
    validate: async (args) => {
      const missing: string[] = [];
      if (!args.employeeId) missing.push("employeeId");
      if (!args.temporaryPassword) missing.push("temporaryPassword");
      if (missing.length > 0) return { ok: false, missing };
      if (args.temporaryPassword.length < 6) {
        return {
          ok: false,
          missing: ["temporaryPassword"],
          detail: "The temporary password must be at least 6 characters.",
        };
      }

      // This operation sets the account's password to a value the caller chose.
      // Without this guard, calling it on an ACTIVE colleague was account
      // takeover — and a manager holds `edit` on `employee` across their own
      // team, so it was reachable by every manager.
      const person = (await graph.getNode("employee", args.employeeId))?.data as
        | EmployeeData
        | undefined;
      if (!person) {
        return {
          ok: false,
          missing: ["employeeId"],
          detail: `No employee ${args.employeeId}.`,
        };
      }
      if (person.status === "active") {
        return {
          ok: false,
          missing: ["employeeId"],
          detail:
            "That person is already active. Reactivate only applies to someone who left — use a password reset instead.",
        };
      }
      return { ok: true };
    },
    // Two requirements: bringing someone back edits their status, and it also
    // sets a password. Declaring `password` separately means a role whose
    // field policy does not include it is refused — so the ability to restore
    // an ex-colleague does not carry the ability to choose their password.
    permission: (args) => [
      {
        action: "edit",
        nodeType: "employee",
        recordNodeIds: [args.employeeId],
        fields: ["status"],
      },
      {
        action: "edit",
        nodeType: "employee",
        recordNodeIds: [args.employeeId],
        fields: ["password"],
      },
    ],
    involvesMoneyOrPeople: () => true,
    execute: async (args) => {
      const node = await graph.getNode("employee", args.employeeId);
      const before = node?.data as EmployeeData | undefined;
      if (!before) throw new Error(`No employee ${args.employeeId}.`);

      const account = accountOfActor(args.employeeId);
      if (!account) throw new Error(`${before.name} has no login to restore.`);

      const after: EmployeeData = { ...before, status: "active" };
      await graph.putNode("employee", args.employeeId, after);
      // Coming back means a fresh temporary password, changed at first sign-in.
      const { resetPassword } = await import("@/server/accounts");
      await resetPassword(account.username, args.temporaryPassword);
      await refresh(graph);

      return {
        changes: [
          { nodeType: "employee", nodeId: args.employeeId, after: { status: "active" } },
        ],
        undo: {
          description: `Make ${before.name} inactive again.`,
          revert: async () => {
            await graph.putNode("employee", args.employeeId, before);
            await setAccountEnabled(args.employeeId, false);
            await refresh(graph);
          },
          plan: [
            {
              op: "patch",
              nodeType: "employee",
              nodeId: args.employeeId,
              data: { status: before.status },
            },
          ],
        },
        response: { username: account.username },
      };
    },
  };
}

// ── pay ────────────────────────────────────────────────────────────────────

export interface EmployeeSetPayArgs {
  employeeId: string;
  pay: number;
  effectiveFrom: string;
}

/**
 * Pay is separate from `employee.update` on purpose: it is money, so it gets
 * `category: "money"` (which can never be automated), its own audit entry, and
 * its own permission check — rather than hiding inside a general edit.
 */
export function employeeSetPayHandler(
  graph: RecordStore,
): OperationHandler<EmployeeSetPayArgs> {
  return {
    name: "employee.setPay",
    category: "money",
    validate: (args) => {
      const missing: string[] = [];
      if (!args.employeeId) missing.push("employeeId");
      if (args.pay === undefined || args.pay === null) missing.push("pay");
      if (!args.effectiveFrom) missing.push("effectiveFrom");
      if (missing.length > 0) return { ok: false, missing };
      if (typeof args.pay !== "number" || Number.isNaN(args.pay) || args.pay < 0) {
        return { ok: false, missing: ["pay"], detail: "Pay must be a positive number." };
      }
      return { ok: true };
    },
    permission: (args) => ({
      action: "edit",
      nodeType: "employee",
      recordNodeIds: [args.employeeId],
      fields: ["pay"],
    }),
    involvesMoneyOrPeople: () => true,
    execute: async (args) => {
      const node = await graph.getNode("employee", args.employeeId);
      const before = node?.data as EmployeeData | undefined;
      if (!before) throw new Error(`No employee ${args.employeeId}.`);

      await graph.putNode("employee", args.employeeId, {
        ...before,
        pay: args.pay,
        payEffectiveFrom: args.effectiveFrom,
      });

      return {
        changes: [
          {
            nodeType: "employee",
            nodeId: args.employeeId,
            before: { pay: before.pay },
            after: { pay: args.pay, payEffectiveFrom: args.effectiveFrom },
          },
        ],
        undo: {
          description: `Restore ${before.name}'s previous pay.`,
          revert: async () => {
            await graph.putNode("employee", args.employeeId, before);
          },
          plan: [
            {
              op: "patch",
              nodeType: "employee",
              nodeId: args.employeeId,
              data: {
                pay: before.pay ?? null,
                payEffectiveFrom: before.payEffectiveFrom ?? null,
              },
            },
          ],
        },
      };
    },
  };
}
