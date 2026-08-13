import { NextResponse } from "next/server";
import {
  createSessionToken,
  getSessionUser,
  SESSION_COOKIE,
  SESSION_MAX_AGE,
} from "@/server/auth";
import { changePassword } from "@/server/accounts";
import { ensureAccountsReady } from "@/server/runtime";
import { env } from "@/config/env";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  const user = await getSessionUser();
  if (!user) {
    return NextResponse.json({ error: "Not authenticated." }, { status: 401 });
  }
  let body: { current?: string; next?: string };
  try {
    body = (await request.json()) as { current?: string; next?: string };
  } catch {
    return NextResponse.json({ error: "Invalid JSON body." }, { status: 400 });
  }
  await ensureAccountsReady();
  const result = await changePassword(user.username, body.current ?? "", body.next ?? "");
  if (!result.ok) {
    return NextResponse.json({ error: result.error }, { status: 400 });
  }
  // Re-issue the cookie. The old token still says mustChangePassword, and
  // middleware reads the flag from the token — without this the user stays
  // locked to the password page even though the change succeeded.
  const res = NextResponse.json({ ok: true });
  res.cookies.set(
    SESSION_COOKIE,
    createSessionToken({ ...user, mustChangePassword: false }),
    {
      httpOnly: true,
      sameSite: "lax",
      secure: env().isProduction,
      path: "/",
      maxAge: SESSION_MAX_AGE,
    },
  );
  return res;
}
