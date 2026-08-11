import { redirect } from "next/navigation";
import { getSessionUser } from "@/server/auth";
import { getWorld } from "@/server/runtime";
import { DEMO_PEOPLE } from "@/domains/shared/people-roster";
import { Shell } from "../shell";
import { DashboardClient } from "./dashboard-client";

export default async function DashboardPage() {
  const user = await getSessionUser();
  if (!user) redirect("/login");
  const { deps, registry } = await getWorld();

  const myTasks = (await deps.graph
    .find("task", (n) => {
      const d = n.data as { assignedTo?: string; status?: string };
      return d.assignedTo === user.id && d.status !== "done";
    }))
    .map((n) => {
      const d = n.data as { title: string; priority: string; dueDate?: string; projectId?: string };
      return { id: n.id, title: d.title, priority: d.priority, dueDate: d.dueDate, projectId: d.projectId };
    });

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

  const isApprover = ["manager", "hr", "admin", "super-admin"].includes(user.role);

  let pendingApprovals: Array<{ id: string; employeeName?: string; fromDate?: string; toDate?: string }> = [];
  if (isApprover) {
    const teamMembers =
      user.role === "manager"
        ? new Set(
            Object.entries(DEMO_PEOPLE)
              .filter(([, p]) => p.team === (DEMO_PEOPLE[user.id]?.team ?? ""))
              .map(([id]) => id),
          )
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
          employeeName: d.employeeName ?? DEMO_PEOPLE[d.employeeId ?? ""]?.name,
          fromDate: d.fromDate,
          toDate: d.toDate,
        };
      });
  }

  const courseCount = (await deps.graph.find("course", () => true)).length;
  const teamSize = Object.keys(DEMO_PEOPLE).length;

  const isHr = user.role === "hr";
  const isAdmin = user.role === "admin" || user.role === "super-admin";

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

  const adminAttention = isAdmin
    ? {
        userCount: teamSize,
        rules: registry.list().length,
        operationCount: registry.list().length,
      }
    : null;

  return (
    <Shell>
      <header className="border-b border-black/[.08] px-6 py-4 dark:border-white/[.1]">
        <h1 className="text-xl font-semibold text-black dark:text-zinc-50">Dashboard</h1>
        <p className="text-sm text-zinc-400">Welcome back, {user.displayName}</p>
      </header>
      <DashboardClient
        role={user.role}
        tasks={myTasks}
        meetings={myMeetings}
        pendingApprovals={pendingApprovals}
        courseCount={courseCount}
        teamSize={teamSize}
        hrAttention={hrAttention}
        adminAttention={adminAttention}
      />
    </Shell>
  );
}
