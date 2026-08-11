import { NextResponse } from "next/server";
import { getSessionUser } from "@/server/auth";
import { getSpine, getWorld } from "@/server/runtime";
import { DEMO_PEOPLE } from "@/domains/shared/people-roster";
import { isRestricted } from "@/spine/permission/types";

export const dynamic = "force-dynamic";

function csv(values: unknown[]): string {
  return values
    .map((v) => {
      const s = isRestricted(v) ? "" : String(v ?? "");
      return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
    })
    .join(",");
}

export async function GET(request: Request) {
  const user = await getSessionUser();
  if (!user) {
    return NextResponse.json({ error: "Not authenticated." }, { status: 401 });
  }
  const type = new URL(request.url).searchParams.get("type") ?? "";
  const spine = await getSpine();
  const graph = (await getWorld()).deps.graph;

  if (!spine.canExport(user.id, type)) {
    return NextResponse.json({ error: "Exporting is not available." }, { status: 403 });
  }

  let header: string[];
  let rows: unknown[][];

  if (type === "employee") {
    header = ["id", "name", "role", "team", "contact"];
    const visibleEmployees = await Promise.all(
      Object.entries(DEMO_PEOPLE).map(async ([id, p]) => {
        const r = await spine.read({ actor: user.id, nodeType: "employee", nodeId: id });
        return r.found ? ([id, p] as const) : null;
      }),
    );
    rows = visibleEmployees
      .filter((x): x is NonNullable<typeof x> => x !== null)
      .map(([id, p]) => [id, p.name, p.role, p.team, `${id}@orga.example`]);
  } else if (type === "task") {
    header = ["id", "title", "assignedTo", "status", "priority", "dueDate"];
    rows = (await graph.find("task", () => true)).map((n) => {
      const d = n.data as Record<string, unknown>;
      return [n.id, d.title, d.assignedTo, d.status, d.priority, d.dueDate ?? ""];
    });
  } else if (type === "course") {
    header = ["id", "title", "stage", "owner"];
    rows = (await graph.find("course", () => true)).map((n) => {
      const d = n.data as Record<string, unknown>;
      return [n.id, d.title, d.stage, d.owner ?? ""];
    });
  } else {
    return NextResponse.json({ error: "Unknown export type." }, { status: 400 });
  }

  const body = [csv(header), ...rows.map(csv)].join("\n");
  return new Response(body, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="${type}-export.csv"`,
    },
  });
}
