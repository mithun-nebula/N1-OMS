import { NextResponse } from "next/server";
import { getSessionUser } from "@/server/auth";
import { getDayPlanService, getSpine, getWorld } from "@/server/runtime";
import { attendanceId, type AttendanceData } from "@/domains/people/attendance";
import type { DayPlan } from "@/domains/assistant/day-plan/store";
import * as adapters from "@/spine/adapters";
import { localDate } from "@/domains/assistant/day-plan/time";
import { getQuestionLimiter } from "@/server/limiter";

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

// Local, not UTC. Between midnight and the UTC offset the application was
// otherwise still serving yesterday's plan.
const today = localDate;

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
  /** Brief items the person said they would handle — offered first (A1). */
  suggested: string[];
  /** A9's resume line, when planning was left half-finished. */
  resumePrompt?: string;
  /**
   * Learned minutes per record, keyed `nodeType:nodeId` (appendix A5). Only
   * covers records this person already has open, so it discloses nothing.
   */
  estimateHints: Record<string, number>;
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

  // Appendix A5 — what past runs of this work actually took. Scoped to the
  // person's own tasks, so the hint set never names a record they could not
  // already open.
  //
  // Deliberately *not* filtered to `status !== "done"`. A learned figure is
  // only ever written for work that was ticked, which completes the backing
  // task — so filtering out done tasks removed every key the table could
  // possibly hold, and the hint could never appear. The picker does its own
  // filtering; an extra key here costs nothing.
  const myTasks = await deps.graph.find("task", (n) => {
    return (n.data as { assignedTo?: string }).assignedTo === actor;
  });
  const estimateHints = service
    .getStore()
    .learnedFor(myTasks.map((n) => `task:${n.id}`));

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
      suggested: [],
      estimateHints,
    };
  }

  const briefItem = plan.phase === "briefing" ? service.currentBriefItem(plan) : null;
  const { rows, tally } = service.dashboard(actor, date);
  const questionsLeft = getQuestionLimiter().remaining(actor, date);
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
      // A4 counts the *question*, not the answer. This checked only whether an
      // answer had been given, so a third and fourth overrun prompt still
      // appeared once the budget was spent — the limit capped replies rather
      // than asks. `recordMissReason` still consumes on answer; this stops the
      // ask being made at all.
      missOffered:
        p.miss?.offerNow && !p.miss?.asked && !p.miss?.lapsed && questionsLeft > 0,
    })),
    rows,
    tally,
    streak,
    suggested: plan.suggested ?? [],
    // A9: "you were choosing what to do today — shall we finish?" `startDay`
    // has always produced this line and the route discarded its return value,
    // so it was never delivered to anyone.
    resumePrompt:
      plan.phase === "abandoned"
        ? "You were choosing what to do today — shall we finish?"
        : undefined,
    estimateHints,
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
        const ref = body.ref as { nodeType: string; nodeId: string } | undefined;

        // Committing to a task today puts it in progress on the board, so the
        // two views agree without anyone dragging a card.
        //
        // This runs BEFORE the plan item is written. It used to run after, so a
        // throw here — a stale task id is enough — returned a 422 to someone
        // who already had an invisible item on their day, and retrying gave
        // them two. Ordering it first means a failure leaves nothing behind.
        let startWarning: string | undefined;
        if (ref?.nodeType === "task") {
          try {
            const node = await (await getWorld()).deps.graph.getNode("task", ref.nodeId);
            if ((node?.data as { status?: string } | undefined)?.status === "todo") {
              const started = await (await getSpine()).submit(
                adapters.fromTyped({ actor: user.id, name: "task.start", args: { taskId: ref.nodeId } }),
              );
              if (started.status !== "ran") {
                // Not fatal — the plan is personal and the task record is not
                // its master. But it is never silent: it used to vanish with
                // no signal and not even a log line.
                startWarning = "Added to today, but the task could not be moved to in progress.";
                console.warn(
                  `[today] task.start ${ref.nodeId} for ${user.id}: ${started.status}`,
                );
              }
            }
          } catch (err) {
            startWarning = "Added to today, but the task could not be moved to in progress.";
            console.warn(
              `[today] task.start ${ref.nodeId} for ${user.id} threw: ${err instanceof Error ? err.message : String(err)}`,
            );
          }
        }

        const result = service.selectItem(user.id, date, {
          label: String(body.label ?? ""),
          estimateMinutes: Number(body.estimateMinutes ?? 0),
          ref,
          // Optional. Left out, the service places the item in the day itself
          // around the meetings already there — which is what gives it a
          // window, and what lets a miss be told apart from an interruption.
          start: body.start === undefined ? undefined : String(body.start),
          end: body.end === undefined ? undefined : String(body.end),
        });
        if (result.error) {
          return NextResponse.json({ error: result.error }, { status: 422 });
        }
        return NextResponse.json({
          ...(await stateFor(user.id)),
          overCapacity: result.overCapacity,
          warning: startWarning,
        });
      }
      case "reorder":
        service.reorder(user.id, date, (body.orderedIds as string[]) ?? []);
        break;
      case "abandon":
        // A9: "planning abandoned halfway — nothing is committed… next time the
        // application is opened it resumes where it stopped." `startDay` has
        // always had the resume branch; nothing could ever put a day into the
        // state that triggers it.
        service.abandon(user.id, date);
        break;
      case "commit":
        service.commitPlan(user.id, date);
        break;
      case "tick": {
        const itemId = String(body.itemId ?? "");
        // An item backed by a real task completes the task too — one action,
        // both records, both audited.
        //
        // The task write is gated and the plan is not, so the gated half goes
        // first. This used to run on the client *after* the tick, which meant a
        // refused `task.complete` left a ticked plan item and an open task with
        // no way back.
        const item = service.getStore().get(user.id, date)?.plan.find((p) => p.id === itemId);
        if (item?.ref?.nodeType === "task" && !item.done) {
          const submitted = await (await getSpine()).submit(
            adapters.fromTyped({
              actor: user.id,
              name: "task.complete",
              args: { taskId: item.ref.nodeId },
            }),
          );
          if (submitted.status !== "ran") {
            return NextResponse.json(
              {
                error:
                  submitted.opaqueMessage ??
                  submitted.detail ??
                  "That task could not be completed, so the item is still open.",
              },
              { status: submitted.status === "forbidden" ? 403 : 422 },
            );
          }
        }
        const result = await service.tick(user.id, date, itemId, {
          actualMinutes: body.actualMinutes === undefined ? undefined : Number(body.actualMinutes),
        });
        return NextResponse.json({ ...(await stateFor(user.id)), offerNow: result.offerNow });
      }
      case "missReason": {
        // A5: the answer becomes better planning, not a black mark. The
        // learned figure was computed and then dropped on the floor here, so
        // "shall I plan for four next time?" could never be offered.
        const result = service.recordMissReason(
          user.id,
          date,
          String(body.itemId ?? ""),
          String(body.reason ?? ""),
        );
        return NextResponse.json({
          ...(await stateFor(user.id)),
          asked: result.asked,
          learnedEstimate: result.learnedEstimate,
        });
      }
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
