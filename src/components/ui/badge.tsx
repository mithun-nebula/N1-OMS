import type { ReactNode } from "react";

export type BadgeTone = "neutral" | "info" | "good" | "warn" | "bad";

/**
 * Every tone carries a dark variant. The `PriorityBadge` this replaces did not,
 * so priority pills were unreadable in dark mode.
 */
const TONE: Record<BadgeTone, string> = {
  neutral: "bg-raised text-ink-faint",
  info: "bg-lilac text-lilac-strong",
  good: "bg-mint text-mint-strong",
  warn: "bg-peach text-peach-strong",
  bad: "bg-rose text-rose-strong",
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
      className={`inline-block rounded-full px-2 py-0.5 text-[11px] font-semibold ${TONE[tone]}`}
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
