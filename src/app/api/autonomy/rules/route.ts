import { NextResponse } from "next/server";
import { getSessionUser } from "@/server/auth";
import { getActingUser } from "@/server/session-guard";
import { getAutonomyEngine } from "@/server/runtime";

export const dynamic = "force-dynamic";

export async function GET() {
  const user = await getSessionUser();
  if (!user) {
    return NextResponse.json({ error: "Not authenticated." }, { status: 401 });
  }
  const engine = await getAutonomyEngine();
  return NextResponse.json({
    rules: engine.listRules(),
    suggestions: engine.listSuggestions(),
  });
}

export async function POST(request: Request) {
  const auth = await getActingUser();
  if (!auth.ok) {
    return NextResponse.json({ error: auth.error }, { status: auth.status });
  }
  const user = auth.user;
  let body: { action?: string; ruleId?: string; suggestionId?: string };
  try {
    body = (await request.json()) as typeof body;
  } catch {
    return NextResponse.json({ error: "Invalid JSON body." }, { status: 400 });
  }
  const engine = await getAutonomyEngine();
  switch (body.action) {
    case "accept-graduation":
      return NextResponse.json({ ok: engine.acceptGraduation(body.ruleId!, user.id) });
    case "revoke":
      return NextResponse.json({ ok: engine.revoke(body.ruleId!, user.id) });
    case "accept-suggestion":
      return NextResponse.json({ ok: engine.acceptSuggestion(body.suggestionId!) });
    case "detect-routines":
      return NextResponse.json({ suggestions: engine.detectRoutines() });
    default:
      return NextResponse.json({ error: `Unknown action: ${body.action}` }, { status: 400 });
  }
}
