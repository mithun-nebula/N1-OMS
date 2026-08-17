import { NextResponse } from "next/server";
import { getSessionUser } from "@/server/auth";
import { getSpine } from "@/server/runtime";
import { directory } from "@/server/directory";

export const dynamic = "force-dynamic";

const SEARCH_TYPES: Array<{ type: string; labelField: string; extra?: string[] }> = [
  { type: "course", labelField: "title", extra: ["owner"] },
  { type: "task", labelField: "title", extra: ["assignedTo"] },
  { type: "meeting", labelField: "title" },
  { type: "event", labelField: "title" },
  { type: "announcement", labelField: "message" },
  { type: "org-memory", labelField: "title", extra: ["decision"] },
];

export async function GET(request: Request) {
  const user = await getSessionUser();
  if (!user) {
    return NextResponse.json({ error: "Not authenticated." }, { status: 401 });
  }
  const q = new URL(request.url).searchParams.get("q")?.toLowerCase().trim() ?? "";
  if (q.length < 2) return NextResponse.json({ results: [] });

  const spine = await getSpine();
  const results: Array<{ nodeType: string; nodeId: string; label: string; sub?: string }> = [];

  // Match on the real records, and only return the ones this actor may see.
  const matchedPeople = await spine.readMany({
    actor: user.id,
    nodeType: "employee",
    filter: (data, nodeId) =>
      String(data.name ?? "").toLowerCase().includes(q) || nodeId.includes(q),
  });
  for (const { nodeId, record } of matchedPeople) {
    results.push({
      nodeType: "employee",
      nodeId,
      label: String(record.name ?? nodeId),
      sub: String(record.role ?? ""),
    });
  }

  // Same non-disclosure as everywhere else: a record the actor may not view is
  // simply not a search result. This used to read the graph directly.
  for (const { type, labelField, extra } of SEARCH_TYPES) {
    const visible = await spine.readMany({
      actor: user.id,
      nodeType: type,
      filter: (d, nodeId) => {
        const label = String(d[labelField] ?? nodeId);
        const haystack = [label, ...(extra ?? []).map((f) => String(d[f] ?? ""))].join(" ").toLowerCase();
        return haystack.includes(q);
      },
    });
    for (const { nodeId, record } of visible) {
      const d = record as Record<string, unknown>;
      results.push({
        nodeType: type,
        nodeId,
        label: String(d[labelField] ?? nodeId),
        sub: type === "course" && d.owner ? directory().nameOf(String(d.owner)) : type,
      });
    }
  }

  return NextResponse.json({ results: results.slice(0, 20) });
}
