import { NextResponse } from "next/server";
import { getSessionUser } from "@/server/auth";
import { getPeopleService, getWorld } from "@/server/runtime";

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
  // Ask the gate, not a private role list: whoever may view payslips in the
  // permission policy may view them here — one authority, not two.
  const { deps } = await getWorld();
  const selfOrPay =
    user.id === id ||
    deps.permissions.can({ actor: user.id, action: "view", nodeType: "payslip" }).allowed;
  if (!selfOrPay) {
    return NextResponse.json(
      { error: "Pay information is not available." },
      { status: 403 },
    );
  }
  const payslips = await (await getPeopleService()).listPaySlips(id);
  return NextResponse.json({
    employeeId: id,
    payslips: payslips.map((p) => ({ id: p.id, ...p.data })),
    viewedBy: { id: user.id, role: user.role },
  });
}
