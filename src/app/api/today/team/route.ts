import { NextResponse } from "next/server";
import { getSessionUser } from "@/server/auth";
import { getCourseService, getDayPlanService } from "@/server/runtime";
import { directory } from "@/server/directory";
import { isAdminLike, isApprover } from "@/server/roles";
import { localDate } from "@/domains/assistant/day-plan/time";

export const dynamic = "force-dynamic";

/**
 * What a manager may see of their team's day — appendix A8, and nothing more.
 *
 *   |                       | THE PERSON | THEIR MANAGER |
 *   | What was committed    | Yes        | Yes           |
 *   | Whether it was done   | Yes        | Yes           |
 *   | Time estimates        | Yes        | Yes           |
 *   | Streak                | Yes        | **No**        |
 *   | Reason given for a miss | Yes      | **No**        |
 *
 * The last two are the point of the whole feature: "people answer honestly when
 * nobody is reading over their shoulder, and honest answers are the only thing
 * that makes the estimate learning in A5 work at all."
 *
 * `DayPlanService.managerView` already strips `miss` and `interrupted` and
 * reports `streakVisible: false`. It had no route, so there was no team surface
 * at all. This adds one without widening what it returns — the filtering stays
 * in the service, and this route only decides *whose* day may be asked for.
 */

const today = localDate;

export async function GET(request: Request) {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: "Not authenticated." }, { status: 401 });

  // Seeing the team's commitments is a management view, not something every
  // colleague gets. Interns and employees have no team below them.
  if (!isApprover(user.role)) {
    return NextResponse.json({ error: "Not available." }, { status: 403 });
  }

  const url = new URL(request.url);
  const date = url.searchParams.get("date") ?? today();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    return NextResponse.json({ error: "The date must be YYYY-MM-DD." }, { status: 422 });
  }

  // A manager sees their own circle; HR and admin carry the whole organisation,
  // exactly as they do for leave approvals on the dashboard.
  const members = isAdminLike(user.role) || user.role === "hr"
    ? directory().activeIds()
    : directory().teamCircleOf(user.id);

  const service = await getDayPlanService();
  const store = service.getStore();

  // Feature 19 — "knows what the team is building, taken from the work itself
  // rather than status forms". Course progress is already computed per record;
  // this only groups it by whoever owns the stage it is sitting in.
  const courses = await (await getCourseService()).listProgress();
  const ownerOf = (c: (typeof courses)[number]) =>
    c.stageOwners?.[c.stage] ?? c.owner;

  const team = [];
  for (const member of members) {
    if (member === user.id) continue;
    await store.load(member, date);
    const view = service.managerView(user.id, member, date);
    const committed = view.committed.map((item) => ({
      id: item.id,
      label: item.label,
      estimateMinutes: item.estimateMinutes,
      done: Boolean(item.done),
    }));
    const theirs = courses.filter((c) => ownerOf(c) === member);
    team.push({
      actor: member,
      name: directory().nameOf(member),
      planned: committed.length > 0,
      committed,
      committedMinutes: committed.reduce((sum, i) => sum + i.estimateMinutes, 0),
      doneCount: committed.filter((i) => i.done).length,
      building: theirs.map((c) => ({
        id: c.id,
        title: c.title,
        stage: c.stage,
        completion: c.completion?.value ?? null,
        stale: c.stale,
        daysWaiting: c.daysWaiting,
      })),
    });
  }

  team.sort((a, b) => a.name.localeCompare(b.name));
  return NextResponse.json({ date, team, streakVisible: false });
}
