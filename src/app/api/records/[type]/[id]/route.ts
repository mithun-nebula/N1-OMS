import { NextResponse } from "next/server";
import { getSessionUser } from "@/server/auth";
import { getSpine } from "@/server/runtime";

export const dynamic = "force-dynamic";

export async function GET(
  request: Request,
  { params }: { params: Promise<{ type: string; id: string }> },
) {
  const user = await getSessionUser();
  if (!user) {
    return NextResponse.json({ error: "Not authenticated." }, { status: 401 });
  }
  const { type, id } = await params;
  const read = await (await getSpine()).read({ actor: user.id, nodeType: type, nodeId: id });
  if (!read.found) {
    return NextResponse.json(
      { error: "That record is not available." },
      { status: 404 },
    );
  }
  return NextResponse.json({
    nodeType: type,
    nodeId: id,
    record: read.record,
    readBy: { id: user.id, role: user.role },
  });
}
