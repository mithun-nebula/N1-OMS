import { NextResponse } from "next/server";
import { getSessionUser } from "@/server/auth";
import { getPeopleService } from "@/server/runtime";

export const dynamic = "force-dynamic";

const PAY_ALLOWED_ROLES = new Set(["super-admin", "admin", "hr"]);

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const user = await getSessionUser();
  if (!user) {
    return NextResponse.json({ error: "Not authenticated." }, { status: 401 });
  }
  const { id } = await params;
  const selfOrPay =
    user.id === id || PAY_ALLOWED_ROLES.has(user.role);
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
