import type { ActorId } from "@/spine/operation/types";
import type { RecordStore } from "@/spine/record/types";
import type { Spine } from "@/spine/spine";
import { findStaleCourses } from "@/domains/course/versioning";
import { findExpiringDocuments, nonAcknowledgers } from "@/domains/workplace";

export interface AssistantCtx {
  actor: ActorId;
  spine: Spine;
  graph: RecordStore;
  asOf: string;
}

export interface Specialist {
  id: "people" | "courses" | "rooms" | "documents";
  answer(query: string, ctx: AssistantCtx): string;
}

function canView(ctx: AssistantCtx, nodeType: string, nodeId: string): boolean {
  return ctx.spine.read({ actor: ctx.actor, nodeType, nodeId }).found;
}

export const peopleSpecialist: Specialist = {
  id: "people",
  answer(_query, ctx) {
    const pending = ctx.graph
      .find("leave", (n) => (n.data as { status?: string }).status === "Pending")
      .filter((n) => canView(ctx, "employee", (n.data as { employeeId?: string }).employeeId ?? ""))
      .map((n) => n.data as { employeeName?: string; fromDate?: string; toDate?: string });
    if (pending.length === 0) return "Nothing is waiting on you for approval.";
    return (
      "Waiting on you: " +
      pending
        .map((p) => `${p.employeeName ?? "someone"}'s leave (${p.fromDate}→${p.toDate})`)
        .join("; ") +
      "."
    );
  },
};

export const coursesSpecialist: Specialist = {
  id: "courses",
  answer(_query, ctx) {
    const stale = findStaleCourses(ctx.graph, ctx.asOf).filter((s) =>
      canView(ctx, "course", s.courseId),
    );
    if (stale.length === 0) return "No courses are behind where they should be.";
    return (
      "At risk: " +
      stale.map((s) => `${s.title} has been in ${s.stage} for ${s.daysWaiting} days`).join("; ") +
      "."
    );
  },
};

export const roomsSpecialist: Specialist = {
  id: "rooms",
  answer(_query, ctx) {
    const mine = ctx.graph.find("booking", (n) => (n.data as { by?: string }).by === ctx.actor);
    if (mine.length === 0) return "You have no room bookings.";
    return (
      "Your bookings: " +
      mine
        .map((b) => {
          const d = b.data as { title?: string; from?: string };
          return `${d.title ?? b.id} at ${d.from ?? "?"}`;
        })
        .join("; ") +
      "."
    );
  },
};

export const documentsSpecialist: Specialist = {
  id: "documents",
  answer(_query, ctx) {
    const expiring = findExpiringDocuments(ctx.graph, ctx.asOf, 30).filter((d) =>
      canView(ctx, "document", d.id),
    );
    const unacked = ctx.graph
      .find("announcement", () => true)
      .filter((n) => nonAcknowledgers(ctx.graph, n.id).includes(ctx.actor));
    const parts: string[] = [];
    if (expiring.length > 0)
      parts.push(
        expiring.map((d) => `${d.name} expires in ${d.daysLeft} day(s)`).join("; "),
      );
    if (unacked.length > 0) parts.push(`${unacked.length} announcement(s) need your acknowledgement`);
    return parts.length > 0 ? "Needs attention: " + parts.join("; ") + "." : "Nothing documents-wise needs you.";
  },
};

export const SPECIALISTS: Specialist[] = [
  peopleSpecialist,
  coursesSpecialist,
  documentsSpecialist,
  roomsSpecialist,
];
