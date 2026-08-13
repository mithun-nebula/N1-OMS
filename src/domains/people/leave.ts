import type { NodeId } from "@/spine/operation/types";
import type { RecordStore } from "@/spine/record/types";
import { directory } from "@/server/directory";

export interface LeaveClash {
  nodeId: NodeId;
  type: "leave" | "attendance";
  fromDate: string;
  toDate: string;
  status?: string;
}

export async function findLeaveClashes(
  graph: RecordStore,
  employeeId: string,
  fromDate: string,
  toDate: string,
): Promise<LeaveClash[]> {
  const clashes: LeaveClash[] = [];
  const leaves = await graph.find("leave", (n) => {
    const d = n.data as { employeeId?: string; status?: string };
    return (
      d.employeeId === employeeId &&
      (d.status === "Pending" || d.status === "Approved")
    );
  });
  for (const node of leaves) {
    const d = node.data as { fromDate?: string; toDate?: string };
    if (overlaps(fromDate, toDate, d.fromDate, d.toDate)) {
      clashes.push({
        nodeId: node.id,
        type: "leave",
        fromDate: d.fromDate ?? "",
        toDate: d.toDate ?? "",
        status: (node.data as { status?: string }).status,
      });
    }
  }
  const attendance = await graph.find("attendance", (n) => {
    const d = n.data as { employee?: string };
    return d.employee === employeeId;
  });
  for (const node of attendance) {
    const d = node.data as { date?: string };
    if (d.date && within(d.date, fromDate, toDate)) {
      clashes.push({
        nodeId: node.id,
        type: "attendance",
        fromDate: d.date,
        toDate: d.date,
      });
    }
  }
  return clashes;
}

/**
 * Who approves this person's leave. Reads the directory, so someone added today
 * routes to their manager immediately. Block 2 replaces this with real
 * reporting lines.
 */
export function teamLeadOf(employeeId: string): string | undefined {
  return directory().managerOf(employeeId);
}

let leaveSeq = 0;
export function nextLeaveId(): string {
  leaveSeq += 1;
  return `leave_${Date.now().toString(36)}_${leaveSeq.toString(36)}`;
}

function overlaps(aFrom: string, aTo: string, bFrom?: string, bTo?: string): boolean {
  if (!bFrom || !bTo) return false;
  return aFrom <= bTo && bFrom <= aTo;
}

function within(d: string, from: string, to: string): boolean {
  return d >= from && d <= to;
}
