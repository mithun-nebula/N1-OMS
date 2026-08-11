import { NextResponse } from "next/server";
import { getSessionUser } from "@/server/auth";
import { changePassword } from "@/server/accounts";

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
  const result = await changePassword(user.username, body.current ?? "", body.next ?? "");
  if (!result.ok) {
    return NextResponse.json({ error: result.error }, { status: 400 });
  }
  return NextResponse.json({ ok: true });
}
