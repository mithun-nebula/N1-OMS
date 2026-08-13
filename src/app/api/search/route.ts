import { NextResponse } from "next/server";
import { getSessionUser } from "@/server/auth";
import { getSpine, getWorld } from "@/server/runtime";
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
  const graph = (await getWorld()).deps.graph;
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

  for (const { type, labelField, extra } of SEARCH_TYPES) {
    for (const node of await graph.find(type as never, () => true)) {
      const d = node.data as Record<string, unknown>;
      const label = String(d[labelField] ?? node.id);
      const haystack = [label, ...(extra ?? []).map((f) => String(d[f] ?? ""))].join(" ").toLowerCase();
      if (haystack.includes(q)) {
        results.push({
          nodeType: type,
          nodeId: node.id,
          label,
          sub: type === "course" && d.owner ? directory().nameOf(String(d.owner)) : type,
        });
      }
    }
  }

  return NextResponse.json({ results: results.slice(0, 20) });
}
