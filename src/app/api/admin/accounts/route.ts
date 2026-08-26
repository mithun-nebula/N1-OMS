import { NextResponse } from "next/server";
import { getSessionUser } from "@/server/auth";
import { getActingUser } from "@/server/session-guard";
import { addAccount, listAccounts } from "@/server/accounts";
import { assignableRoles, canAddPeople, canAssignRole } from "@/server/roles";
import type { RbacRole } from "@/domains/shared/people-roster";

export const dynamic = "force-dynamic";

const ADMIN_ROLES = new Set(["super-admin", "admin"]);

export async function GET() {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: "Not authenticated." }, { status: 401 });
  if (!ADMIN_ROLES.has(user.role))
    return NextResponse.json({ error: "Admin only." }, { status: 403 });
  return NextResponse.json({ accounts: listAccounts() });
}

export async function POST(request: Request) {
  const auth = await getActingUser();
  if (!auth.ok) {
    return NextResponse.json({ error: auth.error }, { status: auth.status });
  }
  const user = auth.user;
  // HR, managers and admins can add people. A manager adding their own team is
  // the common case — but see the role ladder below.
  if (!canAddPeople(user.role))
    return NextResponse.json(
      { error: "You cannot add people." },
      { status: 403 },
    );

  let body: {
    username?: string;
    password?: string;
    displayName?: string;
    role?: string;
    team?: string;
  };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON." }, { status: 400 });
  }

  if (!body.username || !body.password || !body.displayName) {
    return NextResponse.json(
      { error: "username, password and displayName are required." },
      { status: 422 },
    );
  }

  // Nobody may hand out a role above their own. Without this, "managers can
  // add people" would also mean "a manager can create an admin login and sign
  // into it" — escalation in one step.
  const requested = body.role ?? "intern";
  if (!canAssignRole(user.role, requested)) {
    return NextResponse.json(
      {
        error: `You cannot create a ${requested}.`,
        allowed: assignableRoles(user.role),
      },
      { status: 403 },
    );
  }
  const role = requested as RbacRole;

  const result = await addAccount({
    username: body.username,
    password: body.password,
    displayName: body.displayName,
    role,
    team: body.team,
    actor: user.id,
  });

  if (!result.ok) {
    return NextResponse.json({ error: result.error }, { status: 409 });
  }
  return NextResponse.json({ ok: true, username: body.username, role }, { status: 201 });
}
