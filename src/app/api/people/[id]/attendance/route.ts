import { NextResponse } from "next/server";
import { getSessionUser } from "@/server/auth";
import { getSpine } from "@/server/runtime";
import { attendanceOwner } from "@/domains/people/attendance";

export const dynamic = "force-dynamic";

/**
 * Somebody's attendance, subject to the attendance rules — not the employee
 * ones.
 *
 * This used to check `view` on `employee:<id>` and then return
 * `PeopleRecordService.listAttendance(id)` straight from the graph. Employees
 * hold `own-team` view on `employee` while attendance is scoped to `self`
 * ("Nobody browses a colleague's day", `server/policy.ts`) — so the check that
 * ran was the permissive one and **any employee could read a team-mate's whole
 * attendance history**. Non-negotiable #1: the permission that governs a record
 * is the one for that record's own type.
 *
 * `readMany` re-checks record scope per row and applies the field policy, so a
 * manager still sees their team and nobody else sees anything but their own.
 */
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const user = await getSessionUser();
  if (!user) {
    return NextResponse.json({ error: "Not authenticated." }, { status: 401 });
  }
  const { id } = await params;
  const spine = await getSpine();

  // The employee read stays: it keeps the refusal opaque for someone who may
  // not know the person exists at all (non-negotiable #2).
  const read = await spine.read({ actor: user.id, nodeType: "employee", nodeId: id });
  if (!read.found) {
    return NextResponse.json(
      { error: "That record is not available." },
      { status: 404 },
    );
  }

  const rows = await spine.readMany({
    actor: user.id,
    nodeType: "attendance",
    // Ownership is encoded in the id — `att_<employee>_<YYYY-MM-DD>`.
    filter: (_data, nodeId) => attendanceOwner(String(nodeId)) === id,
  });

  return NextResponse.json({
    employeeId: id,
    attendance: rows.map((r) => ({ id: r.nodeId, ...r.record })),
  });
}
