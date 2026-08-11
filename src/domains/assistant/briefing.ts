import type { AssistantCtx } from "./specialists";
import { findStaleCourses } from "@/domains/course/versioning";
import { findExpiringDocuments, nonAcknowledgers } from "@/domains/workplace";

export interface BriefBand {
  changed: string[];
  needsYou: string[];
  atRisk: string[];
}

async function canView(ctx: AssistantCtx, nodeType: string, nodeId: string): Promise<boolean> {
  const read = await ctx.spine.read({ actor: ctx.actor, nodeType, nodeId });
  return read.found;
}

export async function generateBrief(ctx: AssistantCtx): Promise<BriefBand> {
  const changed: string[] = [];
  const needsYou: string[] = [];
  const atRisk: string[] = [];

  const allLeaves = await ctx.graph.find("leave", (n) => (n.data as { status?: string }).status === "Pending");
  const pendingLeaves: typeof allLeaves = [];
  for (const n of allLeaves) {
    if (await canView(ctx, "employee", (n.data as { employeeId?: string }).employeeId ?? "")) {
      pendingLeaves.push(n);
    }
  }
  for (const n of pendingLeaves) {
    const d = n.data as { employeeName?: string };
    if (d.employeeName) needsYou.push(`${d.employeeName}'s leave needs your approval`);
  }

  const staleAll = await findStaleCourses(ctx.graph, ctx.asOf);
  const stale: typeof staleAll = [];
  for (const s of staleAll) {
    if (await canView(ctx, "course", s.courseId)) stale.push(s);
  }
  for (const s of stale) atRisk.push(`${s.title} has been in ${s.stage} for ${s.daysWaiting} days`);

  const expiringAll = await findExpiringDocuments(ctx.graph, ctx.asOf, 30);
  const expiring: typeof expiringAll = [];
  for (const d of expiringAll) {
    if (await canView(ctx, "document", d.id)) expiring.push(d);
  }
  for (const d of expiring) atRisk.push(`${d.name} expires in ${d.daysLeft} day(s)`);

  const announcements = await ctx.graph.find("announcement", () => true);
  const unacked: typeof announcements = [];
  for (const n of announcements) {
    if ((await nonAcknowledgers(ctx.graph, n.id)).includes(ctx.actor)) unacked.push(n);
  }
  if (unacked.length > 0) needsYou.push(`${unacked.length} announcement(s) to acknowledge`);

  return { changed, needsYou, atRisk };
}
