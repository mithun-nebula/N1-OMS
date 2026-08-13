import { NextResponse } from "next/server";
import { getLiveSessionUser } from "@/server/session-guard";
import { getWorld } from "@/server/runtime";
import type { ActivityEntry } from "@/spine/activity-log/types";

export const dynamic = "force-dynamic";

/**
 * The audit log, filtered to what the reader is entitled to see.
 *
 * This used to return **every** entry to any signed-in session — including the
 * `before`/`after` payloads from `employee.setPay`, so an intern could read the
 * whole organisation's pay history. It was also half of the undo attack: read
 * the log, find the pay change, reverse it.
 *
 * The rule: you may see an entry if you could view every record it touched, or
 * if it is your own action. Entries that changed nothing are visible only to
 * their actor.
 *
 * The `before`/`after` payloads are stripped for everyone except those who can
 * view the fields they contain — seeing that pay changed is a different right
 * from seeing what it changed to.
 */
export async function GET(request: Request) {
  const user = await getLiveSessionUser();
  if (!user) {
    return NextResponse.json({ error: "Not authenticated." }, { status: 401 });
  }

  const params = new URL(request.url).searchParams;
  const limit = params.get("limit") ? Number(params.get("limit")) : undefined;

  const { deps } = await getWorld();
  const entries = await deps.log.query({
    nodeType: params.get("nodeType") ?? undefined,
    nodeId: params.get("nodeId") ?? undefined,
    operationName: params.get("operation") ?? undefined,
    actor: params.get("actor") ?? undefined,
    // Filtering happens after the query, so ask for more than we will return.
    limit: limit ? limit * 4 : undefined,
  });

  const canView = (nodeType: string, nodeId: string, fields?: string[]) =>
    deps.permissions.can({
      actor: user.id,
      action: "view",
      nodeType,
      recordNodeId: nodeId,
      requiredFields: fields,
    }).allowed;

  const visible: ActivityEntry[] = [];
  for (const entry of entries) {
    if (entry.changes.length === 0) {
      if (entry.actor === user.id) visible.push(entry);
      continue;
    }
    const readable = entry.changes.every((c) => canView(c.nodeType, c.nodeId));
    if (!readable && entry.actor !== user.id) continue;

    // Strip the values unless the reader may see those particular fields.
    visible.push({
      ...entry,
      changes: entry.changes.map((c) => {
        const fields = [
          ...new Set(
            [c.before, c.after].flatMap((side) =>
              side && typeof side === "object" && !Array.isArray(side)
                ? Object.keys(side as Record<string, unknown>)
                : [],
            ),
          ),
        ];
        if (fields.length > 0 && canView(c.nodeType, c.nodeId, fields)) return c;
        return { nodeType: c.nodeType, nodeId: c.nodeId };
      }),
    });
    if (limit && visible.length >= limit) break;
  }

  return NextResponse.json({ entries: visible, viewedBy: user.id });
}
