import { NextResponse } from "next/server";
import { getSessionUser } from "@/server/auth";
import { getSpine, getWorld } from "@/server/runtime";
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
    // Export the real records, permission-filtered in one pass. The contact
    // column comes from the record rather than being rebuilt from the id.
    const visibleEmployees = await spine.readMany({
      actor: user.id,
      nodeType: "employee",
    });
    rows = visibleEmployees.map(({ nodeId, record }) => [
      nodeId,
      String(record.name ?? ""),
      String(record.role ?? ""),
      String(record.team ?? ""),
      isRestricted(record.contact) ? "" : String(record.contact ?? ""),
    ]);
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
