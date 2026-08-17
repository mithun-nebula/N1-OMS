import { redirect } from "next/navigation";
import { getSessionUser } from "@/server/auth";
import { getWorld } from "@/server/runtime";
import { directory } from "@/server/directory";
import { isAdminLike, isApprover as roleIsApprover } from "@/server/roles";
import { Shell } from "../shell";
import { DashboardClient } from "./dashboard-client";

export default async function DashboardPage() {
  const user = await getSessionUser();
  if (!user) redirect("/login");
  const { deps } = await getWorld();

  const myTasks = (await deps.graph
    .find("task", (n) => {
      const d = n.data as { assignedTo?: string; status?: string };
      return d.assignedTo === user.id && d.status !== "done";
    }))
    .map((n) => {
      const d = n.data as { title: string; priority: string; dueDate?: string; projectId?: string };
      return { id: n.id, title: d.title, priority: d.priority, dueDate: d.dueDate, projectId: d.projectId };
    });

  const doneCount = (await deps.graph
    .find("task", (n) => {
      const d = n.data as { assignedTo?: string; status?: string };
      return d.assignedTo === user.id && d.status === "done";
    })).length;

  const myMeetings = (await deps.graph
    .find("meeting", (n) => {
      const d = n.data as { cancelled?: boolean; attendees?: string[]; from?: string };
      return !d.cancelled && (d.attendees ?? []).includes(user.id);
    }))
    .map((n) => {
      const d = n.data as { title: string; from?: string; to?: string; kind?: string };
      return { id: n.id, title: d.title, from: d.from, to: d.to, kind: d.kind };
    })
    .slice(0, 5);

  const isApprover = roleIsApprover(user.role);

  let pendingApprovals: Array<{ id: string; employeeName?: string; fromDate?: string; toDate?: string }> = [];
  if (isApprover) {
    // A manager sees their own team's requests; HR and admin see all of them.
    const teamMembers =
      user.role === "manager"
        ? new Set(directory().teamCircleOf(user.id))
        : null;
    pendingApprovals = (await deps.graph
      .find("leave", (n) => (n.data as { status?: string }).status === "Pending"))
      .filter((n) => {
        if (!teamMembers) return true;
        return teamMembers.has((n.data as { employeeId?: string }).employeeId ?? "");
      })
      .map((n) => {
        const d = n.data as { employeeName?: string; fromDate?: string; toDate?: string; employeeId?: string };
        return {
          id: n.id,
          employeeName: d.employeeName ?? directory().nameOf(d.employeeId ?? ""),
          fromDate: d.fromDate,
          toDate: d.toDate,
        };
      });
  }

  const courseCount = (await deps.graph.find("course", () => true)).length;
  const teamSize = directory().activeIds().length;

  // Admins and HR both carry the people block; there is deliberately no
  // system-health block here — "admin" is the head of the organisation, not a
  // sysadmin. Provider status stays on /admin.
  const isHr = user.role === "hr" || isAdminLike(user.role);

  const hrAttention = isHr
    ? {
        activeOnboardings: (await deps.graph.find("onboarding", (n) => (n.data as { status?: string }).status === "active")).length,
        outstandingAcks: (await deps.graph.find("announcement", () => true)).reduce((sum, n) => {
          const d = n.data as { audience?: string[]; acknowledged?: string[] };
          return sum + (d.audience ?? []).filter((a) => !(d.acknowledged ?? []).includes(a)).length;
        }, 0),
        expiringDocs: (await deps.graph.find("document", (n) => Boolean((n.data as { required?: boolean }).required))).length,
      }
    : null;

  return (
    <Shell>
      <DashboardClient
        userId={user.id}
        displayName={user.displayName}
        role={user.role}
        tasks={myTasks}
        doneCount={doneCount}
        meetings={myMeetings}
        pendingApprovals={pendingApprovals}
        courseCount={courseCount}
        teamSize={teamSize}
        hrAttention={hrAttention}
      />
    </Shell>
  );
}
