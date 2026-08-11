import { NextResponse } from "next/server";
import { getSessionUser } from "@/server/auth";
import { getSpine, getPeopleService } from "@/server/runtime";

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
  const read = await (await getSpine()).read({ actor: user.id, nodeType: "employee", nodeId: id });
  if (!read.found) {
    return NextResponse.json(
      { error: "That record is not available." },
      { status: 404 },
    );
  }
  const attendance = await (await getPeopleService()).listAttendance(id);
  return NextResponse.json({
    employeeId: id,
    attendance: attendance.map((a) => ({ id: a.id, ...a.data })),
  });
}
