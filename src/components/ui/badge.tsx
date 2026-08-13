import type { ReactNode } from "react";

export type BadgeTone = "neutral" | "info" | "good" | "warn" | "bad";

/**
 * Every tone carries a dark variant. The `PriorityBadge` this replaces did not,
 * so priority pills were unreadable in dark mode.
 */
const TONE: Record<BadgeTone, string> = {
  neutral: "bg-zinc-100 text-zinc-600 dark:bg-zinc-800 dark:text-zinc-300",
  info: "bg-teal-100 text-teal-800 dark:bg-teal-950 dark:text-teal-300",
  good: "bg-emerald-100 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-300",
  warn: "bg-amber-100 text-amber-800 dark:bg-amber-950 dark:text-amber-300",
  bad: "bg-rose-100 text-rose-800 dark:bg-rose-950 dark:text-rose-300",
};

export function Badge({
  children,
  tone = "neutral",
}: {
  children: ReactNode;
  tone?: BadgeTone;
}) {
  return (
    <span
      className={`inline-block rounded-full px-2 py-0.5 text-xs font-medium ${TONE[tone]}`}
    >
      {children}
    </span>
  );
}

const PRIORITY_TONE: Record<string, BadgeTone> = {
  high: "bad",
  medium: "warn",
  low: "neutral",
};

export function PriorityBadge({ priority }: { priority: string }) {
  return <Badge tone={PRIORITY_TONE[priority] ?? "neutral"}>{priority}</Badge>;
}

const STATUS_TONE: Record<string, BadgeTone> = {
  // Work
  todo: "neutral",
  "in-progress": "info",
  done: "good",
  // Requests
  Pending: "warn",
  pending: "warn",
  Approved: "good",
  approved: "good",
  Declined: "bad",
  rejected: "bad",
  withdrawn: "neutral",
  // Attendance
  Present: "good",
  Absent: "bad",
  "On Leave": "info",
  "Half Day": "warn",
};

export function StatusBadge({ status }: { status: string }) {
  return <Badge tone={STATUS_TONE[status] ?? "neutral"}>{status}</Badge>;
}
