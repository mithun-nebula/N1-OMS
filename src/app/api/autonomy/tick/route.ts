import { NextResponse } from "next/server";
import { getActingUser } from "@/server/session-guard";
import { getAutonomyEngine } from "@/server/runtime";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  const auth = await getActingUser();
  if (!auth.ok) {
    return NextResponse.json({ error: auth.error }, { status: auth.status });
  }
  const user = auth.user;
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
