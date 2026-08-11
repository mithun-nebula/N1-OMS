import { NextResponse } from "next/server";
import { getSessionUser } from "@/server/auth";
import { getN1ReadThrough, getSpine } from "@/server/runtime";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const user = await getSessionUser();
  if (!user) {
    return NextResponse.json({ error: "Not authenticated." }, { status: 401 });
  }
  const nodeType = new URL(request.url).searchParams.get("type") ?? "";
  if (!nodeType) {
    return NextResponse.json({ error: "Missing ?type=." }, { status: 400 });
  }

  const service = await getN1ReadThrough();
  const mapping = service.mapping(nodeType);
  if (!mapping) {
    return NextResponse.json({ error: "Unknown record type." }, { status: 404 });
  }

  const records = await service.list(nodeType);
  const spine = await getSpine();
  // Apply the gate's field permission + opaque-refusal: a record the actor can't
  // view is simply absent from the list (non-negotiable #2).
  const visible = (
    await Promise.all(
      records.map(async (n) => {
        const read = await spine.read({ actor: user.id, nodeType, nodeId: n.id });
        return read.found ? { id: n.id, data: read.record } : null;
      }),
    )
  )
    .filter((r): r is NonNullable<typeof r> => r !== null)
    .slice(0, 100);

  return NextResponse.json({
    nodeType,
    doctype: mapping.doctype,
    category: mapping.category,
    sensitive: Boolean(mapping.sensitive),
    count: visible.length,
    records: visible,
  });
}
