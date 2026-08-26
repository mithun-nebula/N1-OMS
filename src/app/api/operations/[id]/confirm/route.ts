import { NextResponse } from "next/server";
import { getActingUser } from "@/server/session-guard";
import {
  getAutonomyEngine,
  getDayPlanService,
  getSpine,
  getWorld,
} from "@/server/runtime";
import { applyDayPlanReactionsFromEntry } from "@/domains/assistant/day-plan/reactions";
import { applyAutonomyReactionsFromEntry } from "@/domains/autonomy/reactions";

export const dynamic = "force-dynamic";

export async function POST(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const auth = await getActingUser();
  if (!auth.ok) {
    return NextResponse.json({ error: auth.error }, { status: auth.status });
  }
  const user = auth.user;
  const { id } = await params;
  const result = await (await getSpine()).confirm(id, user.id);
  // Releasing a parked operation lands the same write as running one directly,
  // so it must reach a planned day the same way (appendix A6/A9).
  if (result.status === "ran" && result.activityEntry) {
    await applyDayPlanReactionsFromEntry(result.activityEntry, {
      service: await getDayPlanService(),
      graph: (await getWorld()).deps.graph,
    });
    // The other half. A rule-driven `employee.deactivate` is parked by the
    // gate ("leaving-org", and `involvesMoneyOrPeople`), so it never reaches
    // the direct route — it is released here. Hooking only that route would
    // leave a departed person's graduated rules running.
    await applyAutonomyReactionsFromEntry(result.activityEntry, {
      engine: await getAutonomyEngine(),
    });
  }
  const status =
    result.status === "ran" ? 200 : result.status === "not-found" ? 404 : 400;
  return NextResponse.json(result, { status });
}
