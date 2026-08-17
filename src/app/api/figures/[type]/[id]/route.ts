import { NextResponse } from "next/server";
import { getLiveSessionUser } from "@/server/session-guard";
import { getSpine, getWorld } from "@/server/runtime";

export const dynamic = "force-dynamic";

/**
 * A figure and the parts it was computed from (non-negotiable #13).
 *
 * This route had **no permission check at all** — any signed-in session could
 * read any figure for any record. A figure is derived from a record, and
 * `computedFrom` carries the underlying numbers, so the right to see the figure
 * is the right to see the record it came from.
 *
 * Only course-completion figures exist today, so the exposure was small. The
 * route is type-agnostic, though, so it would have leaked whatever figure was
 * recorded next — headcount, hours worked, leave balance.
 */
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ type: string; id: string }> },
) {
  const user = await getLiveSessionUser();
  if (!user) {
    return NextResponse.json({ error: "Not authenticated." }, { status: 401 });
  }
  const { type, id } = await params;

  // Same refusal shape as a missing record, so this cannot be used to discover
  // which records exist (non-negotiable #2).
  const record = await (await getSpine()).read({
    actor: user.id,
    nodeType: type,
    nodeId: id,
  });
  if (!record.found) {
    return NextResponse.json({ error: "Not found." }, { status: 404 });
  }

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
