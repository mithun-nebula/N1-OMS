import { NextResponse } from "next/server";
import { getActingUser } from "@/server/session-guard";
import { assistantAsk } from "@/server/runtime";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  // A read rather than a write, but it returns organisation data, so an account
  // still holding a temporary password should not reach it either.
  const auth = await getActingUser();
  if (!auth.ok) {
    return NextResponse.json({ error: auth.error }, { status: auth.status });
  }
  const user = auth.user;
  let body: { message?: string };
  try {
    body = (await request.json()) as { message?: string };
  } catch {
    return NextResponse.json({ error: "Invalid JSON body." }, { status: 400 });
  }
  const answer = await assistantAsk(user.id, body.message ?? "");
  return NextResponse.json(answer);
}
