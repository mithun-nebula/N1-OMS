import { NextResponse } from "next/server";
import { getSessionUser } from "@/server/auth";
import { getWorld } from "@/server/runtime";

export const dynamic = "force-dynamic";

export async function GET() {
  const user = await getSessionUser();
  if (!user) {
    return NextResponse.json({ error: "Not authenticated." }, { status: 401 });
  }
  const bus = (await getWorld()).deps.bus;
  const direct = bus.forActor(user.id);
  const broadcasts = bus.published().filter((p) => p.kind === "broadcast");
  const seen = new Set<string>();
  const notifications = [...direct, ...broadcasts]
    .filter((p) => {
      const key = JSON.stringify(p);
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .slice(-50)
    .reverse()
    .map((p, i) => ({
      id: i,
      message: p.kind === "record" ? `${p.nodeType}:${p.nodeId} — ${p.message}` : p.message,
      kind: p.kind,
    }));
  return NextResponse.json({ notifications, unread: notifications.length });
}
