import { NextResponse } from "next/server";
import { getSessionUser } from "@/server/auth";
import { getSpine } from "@/server/runtime";
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
  const user = await getSessionUser();
  if (!user) {
    return NextResponse.json({ error: "Not authenticated." }, { status: 401 });
  }
  let body: SubmitBody;
  try {
    body = (await request.json()) as SubmitBody;
  } catch {
    return NextResponse.json({ error: "Invalid JSON body." }, { status: 400 });
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
  const result = await getSpine().submit(op);
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
