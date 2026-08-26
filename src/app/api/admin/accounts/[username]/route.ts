import { NextResponse } from "next/server";
import { getActingUser } from "@/server/session-guard";
import { findAccount, resetPassword, updateRole } from "@/server/accounts";
import { canAddPeople, canAssignRole } from "@/server/roles";
import type { RbacRole } from "@/domains/shared/people-roster";

export const dynamic = "force-dynamic";

/**
 * Changing somebody's role or password.
 *
 * The role ladder (`canAssignRole`) was enforced on `POST /api/admin/accounts`
 * and **not here**, and `"super-admin"` was an accepted value — so an admin
 * could promote themselves, or anyone, to super-admin in one request. `PUT`
 * likewise let an admin reset the super-admin's password.
 *
 * Three rules now, on both verbs:
 *   1. You may not grant a role above your own.
 *   2. You may not act on somebody who already holds a role above your own —
 *      otherwise "reset their password" is a way to become them.
 *   3. You may not change your own role. Promotion is somebody else's decision.
 */
function mayActOn(
  actorRole: string,
  actorId: string,
  targetUsername: string,
): { ok: true } | { ok: false; error: string; status: 403 | 404 } {
  const target = findAccount(targetUsername);
  if (!target) return { ok: false, error: "Account not found.", status: 404 };
  if (target.personId === actorId) {
    return { ok: false, error: "You cannot change your own account here.", status: 403 };
  }
  if (!canAssignRole(actorRole, target.role)) {
    // They outrank you, so they are not yours to act on.
    return { ok: false, error: "That account is not available.", status: 403 };
  }
  return { ok: true };
}

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ username: string }> },
) {
  const auth = await getActingUser();
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });
  const user = auth.user;
  if (!canAddPeople(user.role))
    return NextResponse.json({ error: "Not available." }, { status: 403 });

  const { username } = await params;
  let body: { role?: string };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON." }, { status: 400 });
  }

  const allowed = mayActOn(user.role, user.id, username);
  if (!allowed.ok) {
    return NextResponse.json({ error: allowed.error }, { status: allowed.status });
  }

  if (!canAssignRole(user.role, body.role ?? "")) {
    return NextResponse.json(
      { error: `You cannot grant the role "${body.role}".` },
      { status: 403 },
    );
  }

  const result = await updateRole(username, body.role as RbacRole, user.id);
  if (!result.ok) {
    return NextResponse.json({ error: result.error }, { status: 404 });
  }
  return NextResponse.json({ ok: true, username, role: body.role });
}

export async function PUT(
  request: Request,
  { params }: { params: Promise<{ username: string }> },
) {
  const auth = await getActingUser();
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });
  const user = auth.user;
  if (!canAddPeople(user.role))
    return NextResponse.json({ error: "Not available." }, { status: 403 });

  const { username } = await params;
  let body: { password?: string };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON." }, { status: 400 });
  }

  // Resetting a password is a way to become that person, so it needs the same
  // ladder check as granting a role.
  const allowed = mayActOn(user.role, user.id, username);
  if (!allowed.ok) {
    return NextResponse.json({ error: allowed.error }, { status: allowed.status });
  }

  const result = await resetPassword(username, body.password ?? "", user.id);
  if (!result.ok) {
    return NextResponse.json({ error: result.error }, { status: 404 });
  }
  return NextResponse.json({ ok: true, username });
}
