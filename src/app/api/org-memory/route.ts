import { NextResponse } from "next/server";
import { getSessionUser } from "@/server/auth";
import { getActingUser } from "@/server/session-guard";
import { getOrgMemoryService, getSpine } from "@/server/runtime";
import * as adapters from "@/spine/adapters";

export const dynamic = "force-dynamic";

export async function GET() {
  const user = await getSessionUser();
  if (!user) {
    return NextResponse.json({ error: "Not authenticated." }, { status: 401 });
  }
  const memories = await (await getOrgMemoryService()).list();
  return NextResponse.json({ memories });
}

export async function POST(request: Request) {
  const auth = await getActingUser();
  if (!auth.ok) {
    return NextResponse.json({ error: auth.error }, { status: auth.status });
  }
  const user = auth.user;
  let body: {
    title?: string;
    decision?: string;
    reason?: string;
    linkedRecords?: Array<{ nodeType: string; nodeId: string }>;
  };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body." }, { status: 400 });
  }
  const op = adapters.fromTyped({
    actor: user.id,
    name: "orgMemory.record",
    args: {
      title: body.title ?? "",
      decision: body.decision ?? "",
      reason: body.reason ?? "",
      linkedRecords: body.linkedRecords ?? [],
    },
  });
  const res = await (await getSpine()).submit(op);
  const status = res.status === "ran" ? 201 : res.status === "forbidden" ? 403 : 422;
  return NextResponse.json(res, { status });
}
