import { NextResponse } from "next/server";
import { getSessionUser } from "@/server/auth";
import { getWorld } from "@/server/runtime";

export const dynamic = "force-dynamic";

/**
 * The bell.
 *
 * Ids used to be the array index, so an id meant nothing between two requests
 * and `unread` was simply the total — everything was always unread and nothing
 * could be dismissed. Notifications now carry their own id and read state, and
 * survive a restart when a database is configured.
 */
export async function GET() {
  const user = await getSessionUser();
  if (!user) {
    return NextResponse.json({ error: "Not authenticated." }, { status: 401 });
  }
  const bus = (await getWorld()).deps.bus;
  // Recover what was delivered before the restart. No-op once hydrated, and a
  // no-op entirely without a database.
  await bus.load();

  const mine = bus.deliveredTo(user.id);
  const broadcasts = bus.delivered().filter((n) => n.payload.kind === "broadcast");
  const notifications = [...mine, ...broadcasts]
    .sort((a, b) => a.at.localeCompare(b.at))
    .slice(-50)
    .reverse()
    .map((n) => ({
      id: n.id,
      at: n.at,
      read: Boolean(n.readAt),
      message:
        n.payload.kind === "record"
          ? `${n.payload.nodeType}:${n.payload.nodeId} — ${n.payload.message}`
          : n.payload.message,
      kind: n.payload.kind,
    }));

  return NextResponse.json({
    notifications,
    unread: notifications.filter((n) => !n.read).length,
  });
}

/** Mark notifications read. Ids only — the body cannot reach anyone else's. */
export async function POST(request: Request) {
  const user = await getSessionUser();
  if (!user) {
    return NextResponse.json({ error: "Not authenticated." }, { status: 401 });
  }
  let body: { ids?: unknown } = {};
  try {
    body = (await request.json()) as { ids?: unknown };
  } catch {
    return NextResponse.json({ error: "A JSON body with ids is required." }, { status: 422 });
  }
  const bus = (await getWorld()).deps.bus;
  await bus.load();

  const asked = new Set(
    Array.isArray(body.ids) ? body.ids.filter((v): v is string => typeof v === "string") : [],
  );
  // Only this person's own notifications, plus broadcasts they can see. Marking
  // somebody else's as read would be someone else's bell going quiet.
  const allowed = bus
    .delivered()
    .filter(
      (n) =>
        asked.has(n.id) &&
        (n.payload.kind === "broadcast" ||
          (n.payload.kind === "actor" && n.payload.actor === user.id)),
    )
    .map((n) => n.id);

  bus.markRead(allowed);
  return NextResponse.json({ marked: allowed.length });
}
