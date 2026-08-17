"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { isApprover as roleIsApprover } from "@/server/roles";
import { Icon } from "../ui/icons";
import { CountUp, ProgressRing } from "../ui/progress-ring";

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

type Filter = "all" | "high" | "today";

/* Category coding: every meeting kind owns a pastel, consistently. */
const KIND_STYLE: Record<string, { bg: string; edge: string; text: string }> = {
  "one-on-one": { bg: "bg-mint", edge: "border-mint-strong", text: "text-mint-strong" },
  standup: { bg: "bg-mint", edge: "border-mint-strong", text: "text-mint-strong" },
  review: { bg: "bg-lilac", edge: "border-lilac-strong", text: "text-lilac-strong" },
  training: { bg: "bg-lilac", edge: "border-lilac-strong", text: "text-lilac-strong" },
  external: { bg: "bg-peach", edge: "border-peach-strong", text: "text-peach-strong" },
};
const KIND_DEFAULT = { bg: "bg-mint", edge: "border-mint-strong", text: "text-mint-strong" };

export function DashboardClient({
  displayName,
  role,
  tasks,
  doneCount,
  meetings,
  pendingApprovals,
  courseCount,
  teamSize,
  hrAttention,
  adminAttention,
}: {
  displayName: string;
  role: string;
  tasks: TaskItem[];
  doneCount: number;
  meetings: MeetingItem[];
  pendingApprovals: PendingLeave[];
  courseCount: number;
  teamSize: number;
  hrAttention: { activeOnboardings: number; outstandingAcks: number; expiringDocs: number } | null;
  adminAttention: { userCount: number; rules: number; operationCount: number } | null;
}) {
  const router = useRouter();
  const [busyTask, setBusyTask] = useState<string | null>(null);
  const [leaving, setLeaving] = useState<Set<string>>(new Set());
  const [busyLeave, setBusyLeave] = useState<string | null>(null);
  const [filter, setFilter] = useState<Filter>("all");

  const isApprover = roleIsApprover(role);
  const today = new Date().toISOString().slice(0, 10);

  const openCount = tasks.length;
  const total = openCount + doneCount;
  const percent = total === 0 ? 100 : Math.round((doneCount / total) * 100);

  const highCount = useMemo(() => tasks.filter((t) => t.priority === "high").length, [tasks]);
  const dueTodayCount = useMemo(
    () => tasks.filter((t) => t.dueDate && t.dueDate <= today).length,
    [tasks, today],
  );

  const visibleTasks = useMemo(() => {
    if (filter === "high") return tasks.filter((t) => t.priority === "high");
    if (filter === "today") return tasks.filter((t) => t.dueDate && t.dueDate <= today);
    return tasks;
  }, [tasks, filter, today]);

  const firstName = displayName.split(/\s+/)[0] ?? displayName;
  const dateLine = new Date().toLocaleDateString(undefined, {
    weekday: "long",
    month: "long",
    day: "numeric",
  });

  async function completeTask(taskId: string) {
    setBusyTask(taskId);
    setLeaving((s) => new Set(s).add(taskId)); // start the collapse right away
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

  // Stagger: each top-level card enters 70ms after the previous one.
  const stagger = (i: number) => ({ animationDelay: `${i * 70}ms` });

  return (
    <div className="mx-auto max-w-6xl space-y-5 p-4 sm:p-6">
      {/* ============ Greeting ============ */}
      <header className="rise flex flex-wrap items-end justify-between gap-3" style={stagger(0)}>
        <div>
          <h1 className="text-3xl font-light tracking-tight text-ink sm:text-4xl">
            Hello, <span className="font-extrabold">{firstName}</span>
          </h1>
          <p className="mt-1 text-sm text-ink-soft">{dateLine} — here&apos;s your day.</p>
        </div>
        <div className="flex gap-2">
          <FilterPill active={filter === "all"} onClick={() => setFilter("all")}>
            All <b>{openCount}</b>
          </FilterPill>
          <FilterPill active={filter === "high"} onClick={() => setFilter("high")}>
            High priority <b>{highCount}</b>
          </FilterPill>
          <FilterPill active={filter === "today"} onClick={() => setFilter("today")}>
            Due today <b>{dueTodayCount}</b>
          </FilterPill>
        </div>
      </header>

      {/* ============ Bento row: day arc · stats · agenda ============ */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {/* The day arc — signature card. */}
        <section
          className="rise rounded-3xl bg-chrome-card p-5 text-chrome-ink shadow-card"
          style={stagger(1)}
        >
          <h2 className="text-[11px] font-semibold uppercase tracking-widest text-chrome-soft">
            Today&apos;s progress
          </h2>
          <div className="mt-4 flex items-center gap-5">
            <ProgressRing percent={percent}>
              <span className="text-xl font-extrabold text-accent">
                <CountUp value={percent} />
                <span className="text-xs font-semibold">%</span>
              </span>
            </ProgressRing>
            <div className="space-y-1.5 text-[13px]">
              <div>
                <b className="text-base font-bold"><CountUp value={total} /></b>{" "}
                <span className="text-chrome-soft">total tasks</span>
              </div>
              <div>
                <b className="text-base font-bold text-accent"><CountUp value={doneCount} /></b>{" "}
                <span className="text-chrome-soft">completed</span>
              </div>
              <div>
                <b className="text-base font-bold"><CountUp value={openCount} /></b>{" "}
                <span className="text-chrome-soft">open</span>
              </div>
            </div>
          </div>
        </section>

        {/* Stat tiles. */}
        <section className="rise grid grid-cols-2 gap-3" style={stagger(2)}>
          <StatTile href="/tasks" tone="bg-peach text-peach-strong" label="Open tasks" value={openCount} />
          <StatTile href="/meetings" tone="bg-mint text-mint-strong" label="Meetings" value={meetings.length} />
          <StatTile href="/courses" tone="bg-lilac text-lilac-strong" label="Projects" value={courseCount} />
          <StatTile href="/team" tone="bg-rose text-rose-strong" label="Team" value={teamSize} />
        </section>

        {/* Agenda. */}
        <section
          className="rise rounded-3xl bg-surface p-5 shadow-card sm:col-span-2 lg:col-span-1"
          style={stagger(3)}
        >
          <div className="flex items-center justify-between">
            <h2 className="text-[11px] font-semibold uppercase tracking-widest text-ink-faint">
              Up next
            </h2>
            <Link href="/meetings" className="press flex items-center gap-1 text-xs font-medium text-accent-strong hover:underline">
              View all <Icon name="arrow" className="h-3 w-3" />
            </Link>
          </div>
          {meetings.length === 0 ? (
            <Empty icon="calendar" text="No meetings ahead — a clear runway." />
          ) : (
            <div className="mt-3 space-y-2">
              {meetings.map((m, i) => {
                const s = KIND_STYLE[m.kind ?? ""] ?? KIND_DEFAULT;
                return (
                  <Link
                    key={m.id}
                    href="/meetings"
                    style={{ animationDelay: `${200 + i * 60}ms` }}
                    className={`rise lift flex items-center gap-3 rounded-2xl border-l-[3px] px-3.5 py-2.5 ${s.bg} ${s.edge}`}
                  >
                    <div className="min-w-0 flex-1">
                      <div className="truncate text-[13px] font-semibold text-ink">{m.title}</div>
                      <div className="mt-0.5 flex items-center gap-1.5 text-[11px] text-ink-soft">
                        <Icon name="clock" className="h-3 w-3" />
                        {m.from ?? "unscheduled"}
                        {m.kind && <span className={`font-semibold ${s.text}`}>· {m.kind}</span>}
                      </div>
                    </div>
                  </Link>
                );
              })}
            </div>
          )}
        </section>
      </div>

      {/* ============ Tasks + approvals ============ */}
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
        <section
          className={`rise rounded-3xl bg-surface p-5 shadow-card ${isApprover && pendingApprovals.length > 0 ? "lg:col-span-2" : "lg:col-span-3"}`}
          style={stagger(4)}
        >
          <div className="flex items-center justify-between">
            <h2 className="text-[11px] font-semibold uppercase tracking-widest text-ink-faint">
              My tasks
            </h2>
            <Link href="/tasks" className="press flex items-center gap-1 text-xs font-medium text-accent-strong hover:underline">
              Open board <Icon name="arrow" className="h-3 w-3" />
            </Link>
          </div>
          {visibleTasks.length === 0 ? (
            <Empty
              icon="check"
              text={
                filter === "all"
                  ? "Nothing assigned to you. Enjoy the calm."
                  : "No tasks match this filter."
              }
            />
          ) : (
            <div className="mt-3">
              {visibleTasks.map((t, i) => (
                <div key={t.id} className="row-collapse" data-leaving={leaving.has(t.id)}>
                  <div>
                    <div
                      className="rise group flex items-center justify-between gap-3 rounded-2xl px-3 py-2.5 transition-colors hover:bg-raised"
                      style={{ animationDelay: `${240 + i * 45}ms` }}
                    >
                      <div className="flex min-w-0 items-center gap-3">
                        <button
                          onClick={() => completeTask(t.id)}
                          disabled={busyTask === t.id}
                          title="Mark complete"
                          className="press grid h-5 w-5 shrink-0 place-items-center rounded-md border-[1.5px] border-ink-faint text-transparent transition-all hover:border-accent-strong hover:bg-accent-soft hover:text-accent-strong"
                        >
                          <Icon name="check" className="h-3 w-3" />
                        </button>
                        <span className="truncate text-sm font-medium text-ink">{t.title}</span>
                      </div>
                      <div className="flex shrink-0 items-center gap-2">
                        {t.dueDate && (
                          <span
                            className={`text-[11px] ${t.dueDate <= today ? "font-semibold text-danger" : "text-ink-faint"}`}
                          >
                            {t.dueDate}
                          </span>
                        )}
                        <PriorityBadge priority={t.priority} />
                      </div>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </section>

        {isApprover && pendingApprovals.length > 0 && (
          <section
            className="rise rounded-3xl border-l-[3px] border-rose-strong bg-rose p-5 shadow-card"
            style={stagger(5)}
          >
            <div className="flex items-center justify-between">
              <h2 className="text-[11px] font-semibold uppercase tracking-widest text-rose-strong">
                Waiting on you
              </h2>
              <Link href="/leave" className="press text-xs font-medium text-rose-strong hover:underline">
                Open leave
              </Link>
            </div>
            <div className="mt-3 space-y-2">
              {pendingApprovals.map((p, i) => (
                <div
                  key={p.id}
                  style={{ animationDelay: `${280 + i * 60}ms` }}
                  className="rise flex flex-wrap items-center justify-between gap-2 rounded-2xl bg-surface/80 px-3.5 py-2.5"
                >
                  <div className="min-w-0 text-[13px]">
                    <div className="truncate font-semibold text-ink">{p.employeeName}</div>
                    <div className="text-[11px] text-ink-soft">
                      leave {p.fromDate} → {p.toDate}
                    </div>
                  </div>
                  <button
                    onClick={() => approveLeave(p.id)}
                    disabled={busyLeave === p.id}
                    className="press rounded-full bg-chrome px-3.5 py-1.5 text-xs font-semibold text-chrome-ink transition-colors hover:bg-chrome-card disabled:opacity-40"
                  >
                    {busyLeave === p.id ? <Spinner /> : "Approve"}
                  </button>
                </div>
              ))}
            </div>
          </section>
        )}
      </div>

      {/* ============ Role attention strips ============ */}
      {hrAttention && (
        <section className="rise rounded-3xl bg-surface p-5 shadow-card" style={stagger(6)}>
          <h2 className="text-[11px] font-semibold uppercase tracking-widest text-ink-faint">
            HR attention
          </h2>
          <div className="mt-3 grid grid-cols-3 gap-3">
            <AttentionStat href="/hr" tone="text-peach-strong" value={hrAttention.activeOnboardings} label="active onboardings" />
            <AttentionStat href="/announcements" tone="text-mint-strong" value={hrAttention.outstandingAcks} label="outstanding acks" />
            <AttentionStat href="/documents" tone="text-rose-strong" value={hrAttention.expiringDocs} label="required docs" />
          </div>
        </section>
      )}

      {adminAttention && (
        <section className="rise rounded-3xl bg-surface p-5 shadow-card" style={stagger(7)}>
          <div className="flex items-center justify-between">
            <h2 className="text-[11px] font-semibold uppercase tracking-widest text-ink-faint">
              System
            </h2>
            <Link href="/admin" className="press flex items-center gap-1 text-xs font-medium text-accent-strong hover:underline">
              Admin panel <Icon name="arrow" className="h-3 w-3" />
            </Link>
          </div>
          <div className="mt-3 grid grid-cols-2 gap-3">
            <AttentionStat tone="text-ink" value={adminAttention.userCount} label="users" />
            <AttentionStat tone="text-ink" value={adminAttention.operationCount} label="registered operations" />
          </div>
        </section>
      )}

      {/* ============ Quick links ============ */}
      <section
        className="rise flex flex-wrap gap-2 rounded-3xl border border-dashed border-line p-4"
        style={stagger(8)}
      >
        <QuickLink href="/leave" label="Leave balance & history" />
        <QuickLink href="/me" label="Profile & payslips" />
        <QuickLink href="/calendar" label="Open calendar" />
      </section>
    </div>
  );
}

/* ============ pieces ============ */

function FilterPill({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      onClick={onClick}
      className={`press rounded-full px-3.5 py-1.5 text-xs font-medium transition-all duration-200 ${
        active
          ? "bg-chrome text-chrome-ink shadow-card"
          : "bg-surface text-ink-soft shadow-card hover:text-ink"
      }`}
    >
      {children}
    </button>
  );
}

function StatTile({
  href,
  tone,
  label,
  value,
}: {
  href: string;
  tone: string;
  label: string;
  value: number;
}) {
  return (
    <Link href={href} className={`lift press flex flex-col justify-between rounded-3xl p-4 ${tone}`}>
      <span className="text-2xl font-extrabold">
        <CountUp value={value} />
      </span>
      <span className="mt-1 text-[11px] font-semibold opacity-80">{label}</span>
    </Link>
  );
}

function AttentionStat({
  href,
  tone,
  value,
  label,
}: {
  href?: string;
  tone: string;
  value: number;
  label: string;
}) {
  const inner = (
    <div className="rounded-2xl bg-raised px-3 py-3 text-center transition-colors hover:bg-accent-soft/50">
      <div className={`text-2xl font-extrabold ${tone}`}>
        <CountUp value={value} />
      </div>
      <div className="mt-0.5 text-[11px] text-ink-faint">{label}</div>
    </div>
  );
  return href ? <Link href={href}>{inner}</Link> : inner;
}

function QuickLink({ href, label }: { href: string; label: string }) {
  return (
    <Link
      href={href}
      className="press group flex items-center gap-1.5 rounded-full bg-surface px-3.5 py-1.5 text-xs font-medium text-ink-soft shadow-card transition-colors hover:text-accent-strong"
    >
      {label}
      <Icon name="arrow" className="h-3 w-3 transition-transform duration-200 group-hover:translate-x-0.5" />
    </Link>
  );
}

function Empty({ icon, text }: { icon: "check" | "calendar"; text: string }) {
  return (
    <div className="fade-in mt-3 flex flex-col items-center gap-2 rounded-2xl bg-raised px-4 py-7 text-center">
      <span className="grid h-9 w-9 place-items-center rounded-full bg-accent-soft text-accent-strong">
        <Icon name={icon} className="h-4 w-4" />
      </span>
      <p className="text-xs text-ink-faint">{text}</p>
    </div>
  );
}

function Spinner() {
  return (
    <span className="inline-block h-3 w-3 animate-spin rounded-full border-[2px] border-chrome-ink/30 border-t-chrome-ink align-middle" />
  );
}

function PriorityBadge({ priority }: { priority: string }) {
  const styles: Record<string, string> = {
    high: "bg-rose text-rose-strong",
    medium: "bg-peach text-peach-strong",
    low: "bg-raised text-ink-faint",
  };
  return (
    <span className={`rounded-full px-2.5 py-0.5 text-[11px] font-semibold ${styles[priority] ?? styles.low}`}>
      {priority}
    </span>
  );
}
