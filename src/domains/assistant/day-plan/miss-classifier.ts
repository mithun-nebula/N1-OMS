import type { PlanItem, MeetingItem } from "./store";

export interface MissClassification {
  kind: "interrupted" | "ran-over";
  cause?: string;
}

function overlap(aStart: string, aEnd: string, bStart?: string, bEnd?: string): boolean {
  if (!bStart || !bEnd) return false;
  return aStart < bEnd && bStart < aEnd;
}

export function classifyMiss(
  item: PlanItem,
  meetings: MeetingItem[],
): MissClassification {
  const start = item.start;
  const end = item.end ?? (start ? `${start}` : undefined);
  if (!start || !end) {
    return { kind: "ran-over" };
  }
  const conflicting = meetings.filter((m) => overlap(start, end, m.start, m.end));
  if (conflicting.length > 0) {
    return { kind: "interrupted", cause: conflicting[0].title };
  }
  return { kind: "ran-over" };
}

export function restOfDayAtRisk(
  item: PlanItem,
  remaining: PlanItem[],
  asOf: string,
): boolean {
  return remaining
    .filter((p) => !p.done && p.id !== item.id && p.start && p.start >= asOf)
    .some((p) => Boolean(p.start) && p.start! < (item.end ?? asOf));
}
