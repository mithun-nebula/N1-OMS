import { NextResponse } from "next/server";
import { getActingUser } from "@/server/session-guard";
import { getDayPlanService, getSpine, getWorld } from "@/server/runtime";
import { applyDayPlanReactions } from "@/domains/assistant/day-plan/reactions";
import * as adapters from "@/spine/adapters";
import {
  isApplicationStart,
  isPersonStart,
  type StartKind,
} from "@/spine/operation/types";

export const dynamic = "force-dynamic";

interface SubmitBody {
  start: StartKind;
  name: string;
  args: Record<string, unknown>;
  ruleId?: string;
  ruleAuthor?: string;
  scheduleId?: string;
  transcript?: string;
  nodeType?: string;
  nodeId?: string;
}

export async function POST(request: Request) {
  // The single write door for all seven starts. Checked against the live
  // account, not the session token — an account still holding a temporary
  // password cannot act here even if it reached the page some other way.
  const auth = await getActingUser();
  if (!auth.ok) {
    return NextResponse.json({ error: auth.error }, { status: auth.status });
  }
  const user = auth.user;
  let body: SubmitBody;
  try {
    body = (await request.json()) as SubmitBody;
  } catch {
    return NextResponse.json({ error: "Invalid JSON body." }, { status: 400 });
  }
  // ── Application starts cannot be forged ───────────────────────────────────
  //
  // `ruleAuthor` used to be taken from the request body and never compared to
  // the session, and `effectiveActor` runs a delegated operation AS that
  // person. So any signed-in user could act as anyone — and the activity log
  // recorded the impersonated actor, not them.
  //
  // Two conditions now: you may only name yourself, and only against a rule
  // that already exists. Rules are created deliberately, not by submitting
  // against an id nobody has heard of.
  if (isApplicationStart(body.start)) {
    if (body.ruleAuthor !== user.id) {
      return NextResponse.json(
        { error: "An application start can only run under your own authority." },
        { status: 403 },
      );
    }
    const known = (await getWorld()).autonomy.get(body.ruleId ?? "");
    if (!known) {
      return NextResponse.json(
        { error: "No such rule." },
        { status: 403 },
      );
    }
  }

  const op = buildOperation(body, user.id);
  if (!op) {
    return NextResponse.json(
      {
        error:
          "Incomplete start. Person starts use the signed-in actor; app starts need 'ruleId' + 'ruleAuthor'.",
      },
      { status: 400 },
    );
  }
  const result = await (await getSpine()).submit(op);
  if (result.status === "ran") {
    // Personal planning state reacts to the write — a meeting displaces
    // committed work, approved leave pauses the streak (appendix A6/A9). It
    // sits here rather than in the handlers because a day plan is not an org
    // record and never passes the gate. It cannot fail the operation.
    await applyDayPlanReactions(op.name, op.args, {
      service: await getDayPlanService(),
      graph: (await getWorld()).deps.graph,
    });
  }
  const status =
    result.status === "ran"
      ? 200
      : result.status === "awaiting-confirmation"
        ? 202
        : result.status === "forbidden"
          ? 403
          : result.status === "rejected"
            ? 422
            : 200;
  return NextResponse.json(result, { status });
}

function buildOperation(body: SubmitBody, sessionActor: string) {
  if (isPersonStart(body.start)) {
    if (body.start === "voice") {
      return adapters.fromVoice({
        actor: sessionActor,
        name: body.name,
        args: body.args,
        transcript: body.transcript ?? "",
      });
    }
    const factory = body.start === "form" ? adapters.fromForm : adapters.fromTyped;
    return factory({ actor: sessionActor, name: body.name, args: body.args });
  }

  if (!isApplicationStart(body.start)) return null;
  if (!body.ruleId || !body.ruleAuthor) return null;

  switch (body.start) {
    case "schedule":
      if (!body.scheduleId) return null;
      return adapters.fromSchedule({
        scheduleId: body.scheduleId,
        ruleId: body.ruleId,
        ruleAuthor: body.ruleAuthor,
        name: body.name,
        args: body.args,
      });
    case "record-change":
      if (!body.nodeType || !body.nodeId) return null;
      return adapters.fromRecordChange({
        nodeType: body.nodeType,
        nodeId: body.nodeId,
        ruleId: body.ruleId,
        ruleAuthor: body.ruleAuthor,
        name: body.name,
        args: body.args,
      });
    case "standing-rule":
      return adapters.fromStandingRule({
        ruleId: body.ruleId,
        ruleAuthor: body.ruleAuthor,
        name: body.name,
        args: body.args,
      });
    case "routine":
      return adapters.fromRoutine({
        ruleId: body.ruleId,
        ruleAuthor: body.ruleAuthor,
        name: body.name,
        args: body.args,
      });
  }
}
