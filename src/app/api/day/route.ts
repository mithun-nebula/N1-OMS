import { NextResponse } from "next/server";
import { getSessionUser } from "@/server/auth";
import { getDayPlanService } from "@/server/runtime";

export const dynamic = "force-dynamic";

function today(): string {
  return new Date().toISOString().slice(0, 10);
}

export async function GET(request: Request) {
  const user = await getSessionUser();
  if (!user) {
    return NextResponse.json({ error: "Not authenticated." }, { status: 401 });
  }
  const date = new URL(request.url).searchParams.get("date") ?? today();
  const service = getDayPlanService();
  const start = service.startDay(user.id, date);
  const plan = start.plan ?? service.getStore().get(user.id, date);
  const briefItem = plan ? service.currentBriefItem(plan) : null;
  const dashboard =
    plan?.phase === "planned" ? service.dashboard(user.id, date) : null;
  return NextResponse.json({ ...start, briefItem, dashboard, plan });
}

export async function POST(request: Request) {
  const user = await getSessionUser();
  if (!user) {
    return NextResponse.json({ error: "Not authenticated." }, { status: 401 });
  }
  let body: {
    action: string;
    date?: string;
    reply?: string;
    item?: { label: string; estimateMinutes: number; ref?: { nodeType: string; nodeId: string }; start?: string; end?: string };
    itemId?: string;
    actualMinutes?: number;
    reason?: string;
    order?: string[];
    meeting?: { id: string; title: string; start: string; end: string };
  };
  try {
    body = (await request.json()) as typeof body;
  } catch {
    return NextResponse.json({ error: "Invalid JSON body." }, { status: 400 });
  }
  const date = body.date ?? today();
  const service = getDayPlanService();
  switch (body.action) {
    case "answer":
      return NextResponse.json({ plan: service.answerBrief(user.id, date, body.reply ?? "") });
    case "select":
      return NextResponse.json(service.selectItem(user.id, date, body.item!));
    case "commit":
      return NextResponse.json({ plan: service.commitPlan(user.id, date) });
    case "abandon":
      return NextResponse.json({ plan: service.abandon(user.id, date) });
    case "tick":
      return NextResponse.json(service.tick(user.id, date, body.itemId!, { actualMinutes: body.actualMinutes }));
    case "reason":
      return NextResponse.json(service.recordMissReason(user.id, date, body.itemId!, body.reason ?? ""));
    case "reorder":
      return NextResponse.json({ plan: service.reorder(user.id, date, body.order ?? []) });
    case "arrive":
      return NextResponse.json({ plan: service.arriveDuringDay(user.id, date, body.meeting!) });
    default:
      return NextResponse.json({ error: `Unknown action: ${body.action}` }, { status: 400 });
  }
}
