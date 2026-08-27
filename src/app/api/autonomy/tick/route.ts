import { NextResponse } from "next/server";
import { getActingUser } from "@/server/session-guard";
import { getAutonomyEngine } from "@/server/runtime";
import { emitChange } from "@/server/live";

export const dynamic = "force-dynamic";

/**
 * The one way rules are evaluated.
 *
 * ⚠ **Rules used to run off the publish bus**, so a rule firing re-triggered
 * every rule — and the condition was still true, so it notified forever. Taking
 * them off the bus made this route the only entry point, and that is the point:
 * a rule about "five days" does not need sub-second latency, and evaluating
 * every rule on every unrelated change was never what anybody wanted.
 *
 * **Scheduled, not event-driven.** In production this is called on a timer; in
 * development it is called by hand. Calling it twice in quick succession is
 * safe — the second is skipped by the re-entrancy guard, and fire-once means a
 * finding already reported is not reported again.
 */

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
  // Live updates: a rule may only notify, so the bell is what moved.
  emitChange("notifications");
  return NextResponse.json({ tickedAt: asOf, ...result });
}
