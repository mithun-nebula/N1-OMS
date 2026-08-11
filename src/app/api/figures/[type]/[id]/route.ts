import { NextResponse } from "next/server";
import { getSessionUser } from "@/server/auth";
import { getWorld } from "@/server/runtime";

export const dynamic = "force-dynamic";

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ type: string; id: string }> },
) {
  const user = await getSessionUser();
  if (!user) {
    return NextResponse.json({ error: "Not authenticated." }, { status: 401 });
  }
  const { type, id } = await params;
  const { deps } = await getWorld();
  const figures = await deps.figures.forRecord(type, id);
  return NextResponse.json({
    nodeType: type,
    nodeId: id,
    figures: figures.map((f) => ({
      id: f.id,
      label: f.label,
      value: f.value,
      unit: f.unit,
      explainer: f.explainer,
      computedFrom: f.computedFrom,
    })),
  });
}
