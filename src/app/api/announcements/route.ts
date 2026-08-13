import { NextResponse } from "next/server";
import { getSessionUser } from "@/server/auth";
import { getActingUser } from "@/server/session-guard";
import { getWorld } from "@/server/runtime";
import { nonAcknowledgers } from "@/domains/workplace/announcements";
import * as adapters from "@/spine/adapters";

export const dynamic = "force-dynamic";

export async function GET() {
  const user = await getSessionUser();
  if (!user) {
    return NextResponse.json({ error: "Not authenticated." }, { status: 401 });
  }
  const { deps } = await getWorld();
  const nodes = await deps.graph.find("announcement", () => true);
  const announcements = await Promise.all(
    nodes.map(async (n) => ({
      id: n.id,
      message: (n.data as { message?: string }).message,
      outstanding: (await nonAcknowledgers(deps.graph, n.id)).length,
    })),
  );
  return NextResponse.json({ announcements });
}

export async function POST(request: Request) {
  const auth = await getActingUser();
  if (!auth.ok) {
    return NextResponse.json({ error: auth.error }, { status: auth.status });
  }
  const user = auth.user;
  let body: { message?: string; to?: string[]; policy?: boolean };
  try {
    body = (await request.json()) as { message?: string; to?: string[]; policy?: boolean };
  } catch {
    return NextResponse.json({ error: "Invalid JSON body." }, { status: 400 });
  }
  const res = await (await getWorld()).spine.submit(
    adapters.fromForm({
      actor: user.id,
      name: "announcement.send",
      args: { message: body.message ?? "", to: body.to ?? [], policy: body.policy },
    }),
  );
  const status = res.status === "ran" ? 201 : res.status === "forbidden" ? 403 : 422;
  return NextResponse.json(res, { status });
}
