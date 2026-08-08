import { redirect } from "next/navigation";
import { getSessionUser } from "@/server/auth";
import { getWorld } from "@/server/runtime";
import { DEMO_PEOPLE } from "@/domains/shared/people-roster";
import { Shell } from "../shell";

export default async function DashboardPage() {
  const user = await getSessionUser();
  if (!user) redirect("/login");
  const { deps } = getWorld();

  const myTasks = deps.graph
    .find("task", (n) => (n.data as { assignedTo?: string }).assignedTo === user.id && (n.data as { status?: string }).status !== "done")
    .map((n) => n.data as { title: string; priority: string; dueDate?: string; projectId?: string });

  const myMeetings = deps.graph
    .find("meeting", (n) => {
      const d = n.data as { cancelled?: boolean; attendees?: string[]; from?: string };
      return !d.cancelled && (d.attendees ?? []).includes(user.id);
    })
    .map((n) => n.data as { title: string; from?: string; to?: string; kind?: string })
    .slice(0, 5);

  const pendingApprovals = deps.graph
    .find("leave", (n) => (n.data as { status?: string }).status === "Pending")
    .map((n) => n.data as { employeeName?: string; fromDate?: string; toDate?: string });

  const courseCount = deps.graph.find("course", () => true).length;
  const teamSize = Object.keys(DEMO_PEOPLE).length;

  return (
    <Shell>
      <header className="border-b border-black/[.08] px-6 py-4 dark:border-white/[.1]">
        <h1 className="text-xl font-semibold text-black dark:text-zinc-50">Dashboard</h1>
        <p className="text-sm text-zinc-400">Welcome back, {user.displayName}</p>
      </header>

      <div className="space-y-6 p-6">
        <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
          <StatCard label="My open tasks" value={myTasks.length} />
          <StatCard label="Upcoming meetings" value={myMeetings.length} />
          <StatCard label="Active projects" value={courseCount} />
          <StatCard label="Team size" value={teamSize} />
        </div>

        <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
          <section className="rounded-2xl border border-black/[.08] bg-white p-5 dark:border-white/[.12] dark:bg-black">
            <h2 className="mb-3 text-sm font-medium uppercase tracking-wide text-zinc-500">My tasks</h2>
            {myTasks.length === 0 ? (
              <p className="text-sm text-zinc-400">No tasks assigned to you.</p>
            ) : (
              <div className="space-y-2">
                {myTasks.map((t, i) => (
                  <div key={i} className="flex items-center justify-between rounded-lg bg-zinc-50 px-3 py-2 text-sm dark:bg-zinc-900">
                    <span className="text-black dark:text-zinc-100">{t.title}</span>
                    <div className="flex items-center gap-2">
                      {t.dueDate && <span className="text-xs text-zinc-400">{t.dueDate}</span>}
                      <PriorityBadge priority={t.priority} />
                    </div>
                  </div>
                ))}
              </div>
            )}
          </section>

          <section className="rounded-2xl border border-black/[.08] bg-white p-5 dark:border-white/[.12] dark:bg-black">
            <h2 className="mb-3 text-sm font-medium uppercase tracking-wide text-zinc-500">Upcoming meetings</h2>
            {myMeetings.length === 0 ? (
              <p className="text-sm text-zinc-400">No upcoming meetings.</p>
            ) : (
              <div className="space-y-2">
                {myMeetings.map((m, i) => (
                  <div key={i} className="rounded-lg bg-zinc-50 px-3 py-2 text-sm dark:bg-zinc-900">
                    <span className="font-medium text-black dark:text-zinc-100">{m.title}</span>
                    {m.from && <span className="ml-3 text-xs text-zinc-400">{m.from}</span>}
                    {m.kind && <span className="ml-2 text-xs text-teal-600">{m.kind}</span>}
                  </div>
                ))}
              </div>
            )}
          </section>
        </div>

        {pendingApprovals.length > 0 && (
          <section className="rounded-2xl border border-amber-300 bg-amber-50 p-5">
            <h2 className="mb-2 text-sm font-medium uppercase tracking-wide text-amber-700">Pending approvals</h2>
            <div className="space-y-1">
              {pendingApprovals.map((p, i) => (
                <div key={i} className="text-sm text-amber-800">
                  {p.employeeName} — leave {p.fromDate} to {p.toDate}
                </div>
              ))}
            </div>
          </section>
        )}
      </div>
    </Shell>
  );
}

function StatCard({ label, value }: { label: string; value: number }) {
  return (
    <div className="rounded-xl border border-black/[.08] bg-white p-4 dark:border-white/[.12] dark:bg-black">
      <div className="text-2xl font-semibold text-black dark:text-zinc-50">{value}</div>
      <div className="text-xs text-zinc-400">{label}</div>
    </div>
  );
}

function PriorityBadge({ priority }: { priority: string }) {
  const colors: Record<string, string> = {
    high: "bg-rose-100 text-rose-700",
    medium: "bg-amber-100 text-amber-700",
    low: "bg-zinc-100 text-zinc-500",
  };
  return (
    <span className={`rounded-full px-2 py-0.5 text-xs ${colors[priority] ?? colors.low}`}>
      {priority}
    </span>
  );
}
