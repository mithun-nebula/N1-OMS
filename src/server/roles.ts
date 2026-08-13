import type { RbacRole } from "@/domains/shared/people-roster";

/**
 * One place for "which roles may do this" checks.
 *
 * These sets were previously re-typed inline across ~10 pages
 * (`dashboard/page.tsx`, `dashboard-client.tsx`, `shell.tsx`, `leave/page.tsx`,
 * `hr/page.tsx`, `announcements`, `decisions`, `documents`, `payroll`,
 * `records`, `rbac`, `admin`), which meant a role change had to be found and
 * repeated in every one of them.
 *
 * This is a **UI convenience only**. It is not the permission system — the gate
 * (`src/spine/gate/gate.ts`) is the only thing that decides what may actually
 * happen. These helpers decide what to *show*; the gate decides what to *allow*.
 * A page that forgets a check is a cosmetic bug, not a security hole.
 *
 * Deliberately free of server-only imports so client components can use it too.
 */

/** Roles that can approve other people's requests. */
const APPROVER_ROLES: ReadonlySet<string> = new Set([
  "manager",
  "hr",
  "admin",
  "super-admin",
]);

/** Roles with people/payroll reach across the organisation. */
const HR_LIKE_ROLES: ReadonlySet<string> = new Set([
  "hr",
  "admin",
  "super-admin",
]);

/** Roles that can configure the system. */
const ADMIN_LIKE_ROLES: ReadonlySet<string> = new Set(["admin", "super-admin"]);

/** Roles that may publish org-wide content — announcements, decisions, documents. */
const MANAGER_OR_ABOVE_ROLES: ReadonlySet<string> = APPROVER_ROLES;

/** Roles that cannot create or change anything. */
const READ_ONLY_ROLES: ReadonlySet<string> = new Set(["intern"]);

export function isApprover(role: string | undefined): boolean {
  return role !== undefined && APPROVER_ROLES.has(role);
}

export function isHrLike(role: string | undefined): boolean {
  return role !== undefined && HR_LIKE_ROLES.has(role);
}

export function isAdminLike(role: string | undefined): boolean {
  return role !== undefined && ADMIN_LIKE_ROLES.has(role);
}

export function isSuperAdmin(role: string | undefined): boolean {
  return role === "super-admin";
}

export function isManagerOrAbove(role: string | undefined): boolean {
  return role !== undefined && MANAGER_OR_ABOVE_ROLES.has(role);
}

export function isReadOnly(role: string | undefined): boolean {
  return role !== undefined && READ_ONLY_ROLES.has(role);
}

/**
 * Which roles each role may hand out when creating a person.
 *
 * Without a ladder, "managers can add people" also means "a manager can create
 * an admin login and sign into it" — a one-step privilege escalation. Nobody
 * can create a role above their own, and only a super-admin can mint an admin.
 */
const ASSIGNABLE_ROLES: Record<string, readonly RbacRole[]> = {
  "super-admin": ["super-admin", "admin", "hr", "manager", "employee", "intern"],
  admin: ["hr", "manager", "employee", "intern"],
  hr: ["manager", "employee", "intern"],
  manager: ["employee", "intern"],
  employee: [],
  intern: [],
};

/** Roles allowed to add a new person at all. */
export function canAddPeople(role: string | undefined): boolean {
  return assignableRoles(role).length > 0;
}

/** The roles `role` is permitted to give someone it creates. */
export function assignableRoles(role: string | undefined): readonly RbacRole[] {
  if (role === undefined) return [];
  return ASSIGNABLE_ROLES[role] ?? [];
}

/** Whether `creator` may create a person holding `target`. */
export function canAssignRole(
  creator: string | undefined,
  target: string,
): boolean {
  return (assignableRoles(creator) as readonly string[]).includes(target);
}

/**
 * How long a temporary password stays usable. After this the holder must ask
 * for another reset — an unused login handed out and forgotten should not stay
 * open indefinitely.
 */
export const TEMPORARY_PASSWORD_DAYS = 7;

export function temporaryPasswordExpiry(now: Date = new Date()): string {
  return new Date(
    now.getTime() + TEMPORARY_PASSWORD_DAYS * 24 * 60 * 60 * 1000,
  ).toISOString();
}

/**
 * Where a role lands after signing in.
 *
 * Everyone goes to `/dashboard` today. In Block 10, employee / manager / intern
 * will land on `/today` instead — that page does not exist yet, and pointing at
 * it now would 404 (which is exactly the bug this replaces: `admin/page.tsx`
 * redirected non-admins to `/today`).
 */
export function homeRouteFor(_role: string | undefined): string {
  return "/dashboard";
}

export type { RbacRole };
