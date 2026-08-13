import { NextResponse } from "next/server";
import { getLiveSessionUser } from "@/server/session-guard";

export const dynamic = "force-dynamic";

export async function GET() {
  // Live account state, so a password reset that happened after this session
  // started is visible to the client (which redirects on it in `shell.tsx`).
  const user = await getLiveSessionUser();
  if (!user) {
    return NextResponse.json({ error: "Not authenticated." }, { status: 401 });
  }
  return NextResponse.json({ user });
}
