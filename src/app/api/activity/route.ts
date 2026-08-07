import { NextResponse } from "next/server";
import { getSessionUser } from "@/server/auth";
import { getWorld } from "@/server/runtime";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const user = await getSessionUser();
  if (!user) {
    return NextResponse.json({ error: "Not authenticated." }, { status: 401 });
  }
  const params = new URL(request.url).searchParams;
  const nodeType = params.get("nodeType") ?? undefined;
  const nodeId = params.get("nodeId") ?? undefined;
  const operationName = params.get("operation") ?? undefined;
  const actor = params.get("actor") ?? undefined;
  const limit = params.get("limit")
    ? Number(params.get("limit"))
    : undefined;
  const entries = getWorld().deps.log.query({
    nodeType,
    nodeId,
    operationName,
    actor,
    limit,
  });
  return NextResponse.json({ entries, viewedBy: user.id });
}
