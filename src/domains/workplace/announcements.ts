import type { OperationHandler, OperationResult } from "@/spine/operation/registry";
import type { ActorId } from "@/spine/operation/types";
import type { RecordStore } from "@/spine/record/types";

interface AnnouncementData {
  message: string;
  by: ActorId;
  at: string;
  policy?: boolean;
  audience: ActorId[];
  acknowledged: ActorId[];
  [key: string]: unknown;
}

let annSeq = 0;
function nextAnnouncementId(): string {
  annSeq += 1;
  return `announcement_${Date.now().toString(36)}_${annSeq}`;
}

export function announcementSendHandler(
  graph: RecordStore,
): OperationHandler<{ message: string; to: ActorId[]; policy?: boolean }> {
  return {
    name: "announcement.send",
    validate: (args) => {
      const missing: string[] = [];
      if (!args.message) missing.push("message");
      if (!args.to || args.to.length === 0) missing.push("to");
      return missing.length === 0 ? { ok: true } : { ok: false, missing, detail: "message and at least one recipient are required." };
    },
    permission: () => ({ action: "create", nodeType: "announcement" }),
    involvesMoneyOrPeople: () => false,
    execute: (args, ctx) => {
      const id = nextAnnouncementId();
      const data: AnnouncementData = {
        message: args.message,
        by: ctx.actor,
        at: ctx.now(),
        policy: args.policy,
        audience: args.to,
        acknowledged: [],
      };
      graph.putNode("announcement", id, data);
      const result: OperationResult = {
        changes: [{ nodeType: "announcement", nodeId: id, after: data }],
        publishedTo: args.to.map((actor) => ({ kind: "actor" as const, actor })),
        response: { announcementId: id, sentTo: args.to.length },
      };
      return result;
    },
  };
}

export function announcementAckHandler(
  graph: RecordStore,
): OperationHandler<{ announcementId: string }> {
  return {
    name: "announcement.ack",
    validate: (args) =>
      args.announcementId ? { ok: true } : { ok: false, missing: ["announcementId"], detail: "An announcement id is required." },
    permission: (args) => ({ action: "edit", nodeType: "announcement", recordNodeIds: [args.announcementId] }),
    involvesMoneyOrPeople: () => false,
    execute: (args, ctx) => {
      const before = graph.getNode("announcement", args.announcementId)?.data as AnnouncementData | undefined;
      if (!before) throw new Error(`No announcement ${args.announcementId}`);
      const acknowledged = before.acknowledged.includes(ctx.actor)
        ? before.acknowledged
        : [...before.acknowledged, ctx.actor];
      graph.putNode("announcement", args.announcementId, { ...before, acknowledged });
      return {
        changes: [{ nodeType: "announcement", nodeId: args.announcementId, after: { ackedBy: ctx.actor, remaining: before.audience.filter((a) => !acknowledged.includes(a)).length } }],
        publishedTo: [{ kind: "actor", actor: before.by }],
        response: { acknowledgedBy: ctx.actor, outstanding: before.audience.filter((a) => !acknowledged.includes(a)) },
      };
    },
  };
}

export function nonAcknowledgers(graph: RecordStore, announcementId: string): ActorId[] {
  const data = graph.getNode("announcement", announcementId)?.data as AnnouncementData | undefined;
  if (!data) return [];
  return data.audience.filter((a) => !data.acknowledged.includes(a));
}
