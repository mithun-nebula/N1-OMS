import { NextResponse } from "next/server";
import { getSessionUser } from "@/server/auth";
import { getCourseService, getSpine } from "@/server/runtime";

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
  const read = getSpine().read({ actor: user.id, nodeType: "course", nodeId: id });
  if (!read.found) {
    return NextResponse.json({ error: "That course is not available." }, { status: 404 });
  }
  const progress = getCourseService().getProgress(id);
  return NextResponse.json({
    nodeType: "course",
    nodeId: id,
    record: read.record,
    progress,
    readBy: { id: user.id, role: user.role },
  });
}
