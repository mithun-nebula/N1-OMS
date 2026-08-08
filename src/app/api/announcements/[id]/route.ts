import { NextResponse } from "next/server";
import { getSessionUser } from "@/server/auth";
import { getWorld } from "@/server/runtime";
import { nonAcknowledgers } from "@/domains/workplace/announcements";

export const dynamic = "force-dynamic";

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const user = await getSessionUser();
  if (!user) {
    return NextResponse.json({ error: "Not authenticated." }, { status: 401 });
  }
  const { id } = await params;
  const node = getWorld().deps.graph.getNode("announcement", id);
  if (!node) {
    return NextResponse.json({ error: "That announcement is not available." }, { status: 404 });
  }
  return NextResponse.json({
    announcement: { id, ...node.data },
    nonAcknowledgers: nonAcknowledgers(getWorld().deps.graph, id),
  });
}
