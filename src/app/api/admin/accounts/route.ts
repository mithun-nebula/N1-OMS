import { NextResponse } from "next/server";
import { getSessionUser } from "@/server/auth";
import { addAccount, listAccounts } from "@/server/accounts";
import type { RbacRole } from "@/domains/shared/people-roster";

export const dynamic = "force-dynamic";

const ADMIN_ROLES = new Set(["super-admin", "admin"]);
const VALID_ROLES: RbacRole[] = [
  "super-admin",
  "admin",
  "hr",
  "manager",
  "employee",
  "intern",
];

export async function GET() {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: "Not authenticated." }, { status: 401 });
  if (!ADMIN_ROLES.has(user.role))
    return NextResponse.json({ error: "Admin only." }, { status: 403 });
  return NextResponse.json({ accounts: listAccounts() });
}

export async function POST(request: Request) {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: "Not authenticated." }, { status: 401 });
  if (!ADMIN_ROLES.has(user.role))
    return NextResponse.json({ error: "Admin only." }, { status: 403 });

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

  const role = (VALID_ROLES as string[]).includes(body.role ?? "")
    ? (body.role as RbacRole)
    : "intern";

  const result = await addAccount({
    username: body.username,
    password: body.password,
    displayName: body.displayName,
    role,
    team: body.team,
  });

  if (!result.ok) {
    return NextResponse.json({ error: result.error }, { status: 409 });
  }
  return NextResponse.json({ ok: true, username: body.username, role }, { status: 201 });
}
