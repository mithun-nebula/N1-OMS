import { NextResponse } from "next/server";
import { getSessionUser } from "@/server/auth";
import { getSpine } from "@/server/runtime";
import { getPeopleService } from "@/server/runtime";

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
  await getPeopleService().getEmployee(id);
  const read = getSpine().read({ actor: user.id, nodeType: "employee", nodeId: id });
  if (!read.found) {
    return NextResponse.json(
      { error: "That record is not available." },
      { status: 404 },
    );
  }
  return NextResponse.json({
    nodeType: "employee",
    nodeId: id,
    record: read.record,
    readBy: { id: user.id, role: user.role },
  });
}
