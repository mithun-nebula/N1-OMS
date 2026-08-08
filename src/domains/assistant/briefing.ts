import type { AssistantCtx } from "./specialists";
import { findStaleCourses } from "@/domains/course/versioning";
import { findExpiringDocuments, nonAcknowledgers } from "@/domains/workplace";

export interface BriefBand {
  changed: string[];
  needsYou: string[];
  atRisk: string[];
}

function canView(ctx: AssistantCtx, nodeType: string, nodeId: string): boolean {
  return ctx.spine.read({ actor: ctx.actor, nodeType, nodeId }).found;
}

export function generateBrief(ctx: AssistantCtx): BriefBand {
  const changed: string[] = [];
  const needsYou: string[] = [];
  const atRisk: string[] = [];

  const pendingLeaves = ctx.graph
    .find("leave", (n) => (n.data as { status?: string }).status === "Pending")
    .filter((n) => canView(ctx, "employee", (n.data as { employeeId?: string }).employeeId ?? ""));
  for (const n of pendingLeaves) {
    const d = n.data as { employeeName?: string };
    if (d.employeeName) needsYou.push(`${d.employeeName}'s leave needs your approval`);
  }

  const stale = findStaleCourses(ctx.graph, ctx.asOf).filter((s) => canView(ctx, "course", s.courseId));
  for (const s of stale) atRisk.push(`${s.title} has been in ${s.stage} for ${s.daysWaiting} days`);

  const expiring = findExpiringDocuments(ctx.graph, ctx.asOf, 30).filter((d) => canView(ctx, "document", d.id));
  for (const d of expiring) atRisk.push(`${d.name} expires in ${d.daysLeft} day(s)`);

  const unacked = ctx.graph
    .find("announcement", () => true)
    .filter((n) => nonAcknowledgers(ctx.graph, n.id).includes(ctx.actor));
  if (unacked.length > 0) needsYou.push(`${unacked.length} announcement(s) to acknowledge`);

  return { changed, needsYou, atRisk };
}
