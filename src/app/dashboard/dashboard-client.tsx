"use client";

import Link from "next/link";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { isApprover as roleIsApprover } from "@/server/roles";

interface TaskItem {
  id: string;
  title: string;
  priority: string;
  dueDate?: string;
  projectId?: string;
}

interface MeetingItem {
  id: string;
  title: string;
  from?: string;
  to?: string;
  kind?: string;
}

interface PendingLeave {
  id: string;
  employeeName?: string;
  fromDate?: string;
  toDate?: string;
}

export function DashboardClient({
  role,
  tasks,
  meetings,
  pendingApprovals,
  courseCount,
  teamSize,
  hrAttention,
  adminAttention,
}: {
  role: string;
  tasks: TaskItem[];
  meetings: MeetingItem[];
  pendingApprovals: PendingLeave[];
  courseCount: number;
  teamSize: number;
  hrAttention: { activeOnboardings: number; outstandingAcks: number; expiringDocs: number } | null;
  adminAttention: { userCount: number; rules: number; operationCount: number } | null;
}) {
  const router = useRouter();
  const [busyTask, setBusyTask] = useState<string | null>(null);
  const [busyLeave, setBusyLeave] = useState<string | null>(null);

  const isApprover = roleIsApprover(role);

  async function completeTask(taskId: string) {
    setBusyTask(taskId);
    await fetch("/api/operations", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ start: "form", name: "task.complete", args: { taskId } }),
    });
    setBusyTask(null);
    router.refresh();
  }

  async function approveLeave(leaveId: string) {
    setBusyLeave(leaveId);
    await fetch("/api/operations", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ start: "form", name: "leave.approve", args: { leaveId } }),
    });
    setBusyLeave(null);
    router.refresh();
  }

  return (
    <div className="space-y-6 p-6">
      <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
        <Link href="/tasks" className="block rounded-xl border border-black/[.08] bg-white p-4 transition-colors hover:border-teal-700/40 dark:border-white/[.12] dark:bg-black">
          <div className="text-2xl font-semibold text-black dark:text-zinc-50">{tasks.length}</div>
          <div className="text-xs text-zinc-400">My open tasks</div>
        </Link>
        <Link href="/meetings" className="block rounded-xl border border-black/[.08] bg-white p-4 transition-colors hover:border-teal-700/40 dark:border-white/[.12] dark:bg-black">
          <div className="text-2xl font-semibold text-black dark:text-zinc-50">{meetings.length}</div>
          <div className="text-xs text-zinc-400">Upcoming meetings</div>
        </Link>
        <Link href="/courses" className="block rounded-xl border border-black/[.08] bg-white p-4 transition-colors hover:border-teal-700/40 dark:border-white/[.12] dark:bg-black">
          <div className="text-2xl font-semibold text-black dark:text-zinc-50">{courseCount}</div>
          <div className="text-xs text-zinc-400">Active projects</div>
        </Link>
        <Link href="/team" className="block rounded-xl border border-black/[.08] bg-white p-4 transition-colors hover:border-teal-700/40 dark:border-white/[.12] dark:bg-black">
          <div className="text-2xl font-semibold text-black dark:text-zinc-50">{teamSize}</div>
          <div className="text-xs text-zinc-400">Team size</div>
        </Link>
      </div>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        <section className="rounded-2xl border border-black/[.08] bg-white p-5 dark:border-white/[.12] dark:bg-black">
          <div className="mb-3 flex items-center justify-between">
            <h2 className="text-sm font-medium uppercase tracking-wide text-zinc-500">My tasks</h2>
            <Link href="/tasks" className="text-xs text-teal-700 dark:text-teal-400">View all →</Link>
          </div>
          {tasks.length === 0 ? (
            <p className="text-sm text-zinc-400">No tasks assigned to you.</p>
          ) : (
            <div className="space-y-2">
              {tasks.map((t) => (
                <div key={t.id} className="flex items-center justify-between rounded-lg bg-zinc-50 px-3 py-2 text-sm dark:bg-zinc-900">
                  <div className="flex items-center gap-2">
                    <input
                      type="checkbox"
                      title="Mark complete"
                      disabled={busyTask === t.id}
                      onChange={() => completeTask(t.id)}
                      className="h-4 w-4 accent-teal-700"
                    />
                    <span className="text-black dark:text-zinc-100">{t.title}</span>
                  </div>
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
          <div className="mb-3 flex items-center justify-between">
            <h2 className="text-sm font-medium uppercase tracking-wide text-zinc-500">Upcoming meetings</h2>
            <Link href="/meetings" className="text-xs text-teal-700 dark:text-teal-400">View all →</Link>
          </div>
          {meetings.length === 0 ? (
            <p className="text-sm text-zinc-400">No upcoming meetings.</p>
          ) : (
            <div className="space-y-2">
              {meetings.map((m) => (
                <Link
                  key={m.id}
                  href="/meetings"
                  className="block rounded-lg bg-zinc-50 px-3 py-2 text-sm transition-colors hover:bg-zinc-100 dark:bg-zinc-900 dark:hover:bg-zinc-800"
                >
                  <span className="font-medium text-black dark:text-zinc-100">{m.title}</span>
                  {m.from && <span className="ml-3 text-xs text-zinc-400">{m.from}</span>}
                  {m.kind && <span className="ml-2 text-xs text-teal-600">{m.kind}</span>}
                </Link>
              ))}
            </div>
          )}
        </section>
      </div>

      {isApprover && pendingApprovals.length > 0 && (
        <section className="rounded-2xl border border-amber-300 bg-amber-50 p-5 dark:border-amber-900 dark:bg-amber-950">
          <div className="mb-2 flex items-center justify-between">
            <h2 className="text-sm font-medium uppercase tracking-wide text-amber-700 dark:text-amber-400">Pending approvals</h2>
            <Link href="/leave" className="text-xs text-amber-700 dark:text-amber-400">Open leave →</Link>
          </div>
          <div className="space-y-2">
            {pendingApprovals.map((p) => (
              <div key={p.id} className="flex flex-wrap items-center justify-between gap-2 rounded-lg bg-white/70 px-3 py-2 dark:bg-black/40">
                <span className="text-sm text-amber-800 dark:text-amber-200">
                  {p.employeeName} — leave {p.fromDate} to {p.toDate}
                </span>
                <button
                  onClick={() => approveLeave(p.id)}
                  disabled={busyLeave === p.id}
                  className="rounded-lg bg-teal-700 px-3 py-1 text-xs font-medium text-white disabled:opacity-40"
                >
                  {busyLeave === p.id ? "…" : "Approve"}
                </button>
              </div>
            ))}
          </div>
        </section>
      )}

      {hrAttention && (
        <section className="rounded-2xl border border-black/[.08] bg-white p-5 dark:border-white/[.12] dark:bg-black">
          <h2 className="mb-3 text-sm font-medium uppercase tracking-wide text-zinc-500">HR attention</h2>
          <div className="grid grid-cols-3 gap-4 text-center">
            <div>
              <div className="text-2xl font-semibold text-amber-600">{hrAttention.activeOnboardings}</div>
              <div className="text-xs text-zinc-400"><Link href="/hr">active onboardings</Link></div>
            </div>
            <div>
              <div className="text-2xl font-semibold text-teal-700 dark:text-teal-400">{hrAttention.outstandingAcks}</div>
              <div className="text-xs text-zinc-400"><Link href="/announcements">outstanding acks</Link></div>
            </div>
            <div>
              <div className="text-2xl font-semibold text-rose-600">{hrAttention.expiringDocs}</div>
              <div className="text-xs text-zinc-400"><Link href="/documents">required docs</Link></div>
            </div>
          </div>
        </section>
      )}

      {adminAttention && (
        <section className="rounded-2xl border border-black/[.08] bg-white p-5 dark:border-white/[.12] dark:bg-black">
          <h2 className="mb-3 text-sm font-medium uppercase tracking-wide text-zinc-500">System</h2>
          <div className="grid grid-cols-3 gap-4 text-center">
            <div>
              <div className="text-2xl font-semibold text-black dark:text-zinc-50">{adminAttention.userCount}</div>
              <div className="text-xs text-zinc-400">users</div>
            </div>
            <div>
              <div className="text-2xl font-semibold text-black dark:text-zinc-50">{adminAttention.operationCount}</div>
              <div className="text-xs text-zinc-400">registered operations</div>
            </div>
            <div>
              <Link href="/admin" className="text-xs text-teal-700 dark:text-teal-400">Admin panel →</Link>
            </div>
          </div>
        </section>
      )}

      <section className="rounded-2xl border border-dashed border-black/[.1] p-4 dark:border-white/[.15]">
        <div className="flex items-center justify-between">
          <span className="text-sm text-zinc-500">Your leave balance & history</span>
          <Link href="/leave" className="text-xs text-teal-700 dark:text-teal-400">Open →</Link>
        </div>
        <div className="mt-1 flex items-center justify-between">
          <span className="text-sm text-zinc-500">Your profile & payslips</span>
          <Link href="/me" className="text-xs text-teal-700 dark:text-teal-400">Open →</Link>
        </div>
      </section>
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
