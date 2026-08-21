import { NextResponse } from "next/server";
import { getSessionUser } from "@/server/auth";
import { getSpine } from "@/server/runtime";

export const dynamic = "force-dynamic";

/**
 * Reference data the voice widget needs to complete an intent: who am I,
 * which rooms/equipment exist. Everything flows through spine.readMany, so
 * the viewer only sees what their own permissions allow. ("Announce" posts
 * to the Everyone chat, so no recipient list is needed here.)
 */
export async function GET() {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: "Not authenticated." }, { status: 401 });
  const spine = await getSpine();
  const [rooms, equipment] = await Promise.all([
    spine.readMany({ actor: user.id, nodeType: "room" }),
    spine.readMany({ actor: user.id, nodeType: "equipment" }),
  ]);
  const named = (rows: Array<{ nodeId: string; record: Record<string, unknown> }>) =>
    rows.map(({ nodeId, record }) => ({ id: nodeId, name: String(record.name ?? nodeId) }));
  return NextResponse.json({
    self: { id: user.id },
    rooms: named(rooms),
    equipment: named(equipment),
  });
}
