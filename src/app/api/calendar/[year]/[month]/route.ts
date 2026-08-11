import { NextResponse } from "next/server";
import { getSessionUser } from "@/server/auth";
import { getWorld } from "@/server/runtime";
import { monthView } from "@/domains/workplace/calendar";

export const dynamic = "force-dynamic";

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ year: string; month: string }> },
) {
  const user = await getSessionUser();
  if (!user) {
    return NextResponse.json({ error: "Not authenticated." }, { status: 401 });
  }
  const { year, month } = await params;
  const cells = await monthView((await getWorld()).deps.graph, Number(year), Number(month));
  return NextResponse.json({ year: Number(year), month: Number(month), cells });
}
