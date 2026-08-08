import { NextResponse } from "next/server";
import { getSessionUser } from "@/server/auth";
import { getSpine, getPeopleService } from "@/server/runtime";
import { isRestricted } from "@/spine/permission/types";

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
  const read = getSpine().read({ actor: user.id, nodeType: "employee", nodeId: id });
  if (!read.found) {
    return NextResponse.json(
      { error: "That record is not available." },
      { status: 404 },
    );
  }
  const balanceField = read.record.leaveBalance;
  if (balanceField === undefined || isRestricted(balanceField)) {
    return NextResponse.json(
      { error: "Leave balance is not available." },
      { status: 403 },
    );
  }
  const balance = await getPeopleService().getLeaveBalance(id);
  return NextResponse.json({ employeeId: id, leaveBalance: balance ?? 0 });
}
