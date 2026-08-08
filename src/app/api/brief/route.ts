import { NextResponse } from "next/server";
import { getSessionUser } from "@/server/auth";
import { getWorld } from "@/server/runtime";
import { generateBrief } from "@/domains/assistant/briefing";

export const dynamic = "force-dynamic";

export async function GET() {
  const user = await getSessionUser();
  if (!user) {
    return NextResponse.json({ error: "Not authenticated." }, { status: 401 });
  }
  const world = getWorld();
  const brief = generateBrief({
    actor: user.id,
    spine: world.spine,
    graph: world.deps.graph,
    asOf: new Date().toISOString(),
  });
  return NextResponse.json({ brief });
}
