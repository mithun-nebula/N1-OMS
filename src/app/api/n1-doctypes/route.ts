import { NextResponse } from "next/server";
import { getSessionUser } from "@/server/auth";
import { getN1ReadThrough } from "@/server/runtime";

export const dynamic = "force-dynamic";

export async function GET() {
  const user = await getSessionUser();
  if (!user) {
    return NextResponse.json({ error: "Not authenticated." }, { status: 401 });
  }
  const groups = await (await getN1ReadThrough()).mappingsByCategory();
  const catalog = Object.entries(groups).map(([category, mappings]) => ({
    category,
    doctypes: mappings.map((m) => ({
      doctype: m.doctype,
      nodeType: m.nodeType,
      sensitive: Boolean(m.sensitive),
    })),
  }));
  return NextResponse.json({ catalog, n1Mode: process.env.N1_BASE_URL ? "live" : "stub" });
}
