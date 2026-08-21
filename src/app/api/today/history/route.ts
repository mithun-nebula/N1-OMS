import { NextResponse } from "next/server";
import { getSessionUser } from "@/server/auth";
import { getDayPlanService } from "@/server/runtime";
import { localDate } from "@/domains/assistant/day-plan/time";

export const dynamic = "force-dynamic";

/**
 * Look back over your own days.
 *
 * The store could only ever be asked for a single (actor, date), so there was
 * no way to see a week — no streak timeline, no sense of whether estimates are
 * getting better. This is the range query behind that.
 *
 * Strictly personal. A9's streak is "not visible to the team, not compared
 * between people, not shown to a manager", and the same reasoning covers the
 * run of days behind it: a manager gets `/api/today/team`, which is scoped to
 * commitments and completion for a single day and never the streak.
 */

const MAX_DAYS = 92;

function isoDate(value: string | null): string | undefined {
  return value && /^\d{4}-\d{2}-\d{2}$/.test(value) ? value : undefined;
}

function shift(date: string, days: number): string {
  const [y, m, d] = date.split("-").map(Number);
  const at = new Date(y, m - 1, d);
  at.setDate(at.getDate() + days);
  return localDate(at);
}

export async function GET(request: Request) {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: "Not authenticated." }, { status: 401 });

  const url = new URL(request.url);
  const to = isoDate(url.searchParams.get("to")) ?? localDate();
  const from = isoDate(url.searchParams.get("from")) ?? shift(to, -29);
  if (from > to) {
    return NextResponse.json({ error: "“from” must not be after “to”." }, { status: 422 });
  }
  // A range is cheap to ask for and expensive to serve unbounded.
  const capped = shift(to, -(MAX_DAYS - 1));
  const start = from < capped ? capped : from;

  const service = await getDayPlanService();
  const store = service.getStore();
  // `history` hydrates plans through `loadRange`, but never touches the streak
  // — it lives in its own row. Without this the route reported a zero streak
  // to everyone after a restart.
  await store.load(user.id, to);
  const days = await store.history(user.id, start, to);
  const streak = store.streakFor(user.id);

  const planned = days.filter((d) => d.committed > 0 && !d.onLeave);
  return NextResponse.json({
    from: start,
    to,
    days,
    totals: {
      daysPlanned: planned.length,
      itemsCommitted: planned.reduce((s, d) => s + d.committed, 0),
      itemsDone: planned.reduce((s, d) => s + d.done, 0),
      daysRanOver: planned.filter((d) => d.ranOver > 0).length,
      daysInterrupted: planned.filter((d) => d.interrupted > 0).length,
    },
    streak: { clean: streak.clean, bestClean: streak.bestClean, dayPlanned: streak.dayPlanned },
  });
}
