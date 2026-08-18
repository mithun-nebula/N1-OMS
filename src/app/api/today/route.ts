import { NextResponse } from "next/server";
import { getSessionUser } from "@/server/auth";
import { getDayPlanService, getWorld } from "@/server/runtime";
import { attendanceId, type AttendanceData } from "@/domains/people/attendance";
import type { DayPlan } from "@/domains/assistant/day-plan/store";

export const dynamic = "force-dynamic";

/**
 * The day flow. GET peeks at today's state; POST advances it.
 *
 * Clock in/out are NOT here — they are real operations (`attendance.checkIn` /
 * `attendance.checkOut`) submitted through `/api/operations` so they pass the
 * gate and land in the audit log. This route only drives the personal day plan
 * (brief → plan → commit → tick → close out), which is planning state, not an
 * org record.
 */

function today(): string {
  return new Date().toISOString().slice(0, 10);
}

interface TodayState {
  date: string;
  attendance: { checkInAt?: string; checkOutAt?: string; workedMinutes?: number };
  phase: DayPlan["phase"] | "none";
  briefItem: { text: string; replies: string[]; index: number; total: number } | null;
  plan: Array<{
    id: string;
    label: string;
    estimateMinutes: number;
    done?: boolean;
    tag?: string;
    ref?: { nodeType: string; nodeId: string };
    missOffered?: boolean;
  }>;
  rows: Array<{ kind: "work" | "meeting"; id: string; title: string; start?: string; done?: boolean; tag?: string }>;
  tally: { meetings: number; work: number; free: number };
  streak: { clean: number; bestClean: number; dayPlanned: number };
}

async function stateFor(actor: string): Promise<TodayState> {
  const date = today();
  const { deps } = await getWorld();
  const service = await getDayPlanService();
  // Recover this person's day (and streak) after a restart. No-op once
  // hydrated, and a no-op entirely in stub mode.
  await service.getStore().load(actor, date);

  const attNode = await deps.graph.getNode("attendance", attendanceId(actor, date));
  const att: Partial<AttendanceData> = (attNode?.data as AttendanceData | undefined) ?? {};

  const plan = service.getStore().get(actor, date);
  const streakRec = service.getStore().streakFor(actor);
  const streak = {
    clean: streakRec.clean,
    bestClean: streakRec.bestClean,
    dayPlanned: streakRec.dayPlanned,
  };

  if (!plan) {
    return {
      date,
      attendance: { checkInAt: att.checkInAt, checkOutAt: att.checkOutAt, workedMinutes: att.workedMinutes },
      phase: "none",
      briefItem: null,
      plan: [],
      rows: [],
      tally: { meetings: 0, work: 0, free: 8 * 60 },
      streak,
    };
  }

  const briefItem = plan.phase === "briefing" ? service.currentBriefItem(plan) : null;
  const { rows, tally } = service.dashboard(actor, date);
  return {
    date,
    attendance: { checkInAt: att.checkInAt, checkOutAt: att.checkOutAt, workedMinutes: att.workedMinutes },
    phase: plan.phase,
    briefItem,
    plan: plan.plan.map((p) => ({
      id: p.id,
      label: p.label,
      estimateMinutes: p.estimateMinutes,
      done: p.done,
      tag: p.miss?.kind === "interrupted" ? "carried-over" : p.miss?.kind === "ran-over" ? "ran-over" : undefined,
      ref: p.ref,
      missOffered: p.miss?.offerNow && !p.miss?.asked && !p.miss?.lapsed,
    })),
    rows,
    tally,
    streak,
  };
}

export async function GET() {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: "Not authenticated." }, { status: 401 });
  return NextResponse.json(await stateFor(user.id));
}

export async function POST(request: Request) {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: "Not authenticated." }, { status: 401 });
  const service = await getDayPlanService();
  const date = today();
  await service.getStore().load(user.id, date);

  let body: Record<string, unknown> = {};
  try {
    body = (await request.json()) as Record<string, unknown>;
  } catch {
    return NextResponse.json({ error: "A JSON body with an action is required." }, { status: 422 });
  }

  const action = String(body.action ?? "");
  try {
    switch (action) {
      case "start":
        await service.startDay(user.id, date);
        break;
      case "answerBrief":
        service.answerBrief(user.id, date, String(body.reply ?? "Got it"));
        break;
      case "select": {
        const result = service.selectItem(user.id, date, {
          label: String(body.label ?? ""),
          estimateMinutes: Number(body.estimateMinutes ?? 0),
          ref: body.ref as { nodeType: string; nodeId: string } | undefined,
        });
        if (result.error) {
          return NextResponse.json({ error: result.error }, { status: 422 });
        }
        return NextResponse.json({ ...(await stateFor(user.id)), overCapacity: result.overCapacity });
      }
      case "reorder":
        service.reorder(user.id, date, (body.orderedIds as string[]) ?? []);
        break;
      case "commit":
        service.commitPlan(user.id, date);
        break;
      case "tick": {
        const result = await service.tick(user.id, date, String(body.itemId ?? ""), {
          actualMinutes: body.actualMinutes === undefined ? undefined : Number(body.actualMinutes),
        });
        return NextResponse.json({ ...(await stateFor(user.id)), offerNow: result.offerNow });
      }
      case "missReason":
        service.recordMissReason(user.id, date, String(body.itemId ?? ""), String(body.reason ?? ""));
        break;
      case "closeOut":
        service.finalizeDay(user.id, date);
        break;
      default:
        return NextResponse.json({ error: `Unknown action “${action}”.` }, { status: 422 });
    }
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "That did not work." },
      { status: 422 },
    );
  }
  return NextResponse.json(await stateFor(user.id));
}
