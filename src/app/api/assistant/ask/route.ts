import { NextResponse } from "next/server";
import { getSessionUser } from "@/server/auth";
import { assistantAsk } from "@/server/runtime";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  const user = await getSessionUser();
  if (!user) {
    return NextResponse.json({ error: "Not authenticated." }, { status: 401 });
  }
  let body: { message?: string };
  try {
    body = (await request.json()) as { message?: string };
  } catch {
    return NextResponse.json({ error: "Invalid JSON body." }, { status: 400 });
  }
  const answer = assistantAsk(user.id, body.message ?? "");
  return NextResponse.json(answer);
}
