import { NextResponse } from "next/server";
import { getSessionUser } from "@/server/auth";
import { getAutonomyEngine } from "@/server/runtime";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  const user = await getSessionUser();
  if (!user) {
    return NextResponse.json({ error: "Not authenticated." }, { status: 401 });
  }
  if (user.role !== "super-admin" && user.role !== "admin") {
    return NextResponse.json({ error: "Not permitted." }, { status: 403 });
  }
  let body: { asOf?: string };
  try {
    body = (await request.json()) as { asOf?: string };
  } catch {
    body = {};
  }
  const asOf = body.asOf ?? new Date().toISOString();
  const result = await (await getAutonomyEngine()).tick(asOf);
  return NextResponse.json({ tickedAt: asOf, ...result });
}
