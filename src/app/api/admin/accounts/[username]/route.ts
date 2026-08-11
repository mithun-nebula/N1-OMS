import { NextResponse } from "next/server";
import { getSessionUser } from "@/server/auth";
import { resetPassword, updateRole } from "@/server/accounts";
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

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ username: string }> },
) {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: "Not authenticated." }, { status: 401 });
  if (!ADMIN_ROLES.has(user.role))
    return NextResponse.json({ error: "Admin only." }, { status: 403 });

  const { username } = await params;
  let body: { role?: string };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON." }, { status: 400 });
  }

  if (!(VALID_ROLES as string[]).includes(body.role ?? "")) {
    return NextResponse.json({ error: "Invalid role." }, { status: 422 });
  }

  const result = await updateRole(username, body.role as RbacRole);
  if (!result.ok) {
    return NextResponse.json({ error: result.error }, { status: 404 });
  }
  return NextResponse.json({ ok: true, username, role: body.role });
}

export async function PUT(
  request: Request,
  { params }: { params: Promise<{ username: string }> },
) {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: "Not authenticated." }, { status: 401 });
  if (!ADMIN_ROLES.has(user.role))
    return NextResponse.json({ error: "Admin only." }, { status: 403 });

  const { username } = await params;
  let body: { password?: string };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON." }, { status: 400 });
  }

  const result = await resetPassword(username, body.password ?? "");
  if (!result.ok) {
    return NextResponse.json({ error: result.error }, { status: 404 });
  }
  return NextResponse.json({ ok: true, username });
}
