import { NextResponse } from "next/server";
import { getSessionUser } from "@/server/auth";
import { getOrgMemoryService, getSpine } from "@/server/runtime";

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
  const spine = getSpine();
  const memory = getOrgMemoryService().retrieve(id, (nodeType, nodeId) =>
    spine.read({ actor: user.id, nodeType, nodeId }).found,
  );
  if (!memory) {
    return NextResponse.json(
      { error: "That memory is not available." },
      { status: 404 },
    );
  }
  return NextResponse.json({ memory, viewedBy: user.id });
}
