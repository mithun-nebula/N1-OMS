import type { OperationHandler, OperationResult } from "@/spine/operation/registry";
import type { ActorId } from "@/spine/operation/types";
import type { RecordStore } from "@/spine/record/types";

export interface MeetingDecision {
  id: string;
  text: string;
  owner?: ActorId;
}

export interface MeetingAction {
  id: string;
  text: string;
  owner: ActorId;
  due?: string;
  done?: boolean;
  completedAt?: string;
}

interface DecisionSet {
  meetingId: string;
  decisions: MeetingDecision[];
  actions: MeetingAction[];
  [key: string]: unknown;
}

function decisionIdFor(meetingId: string): string {
  return `decisions:${meetingId}`;
}

async function readSet(graph: RecordStore, meetingId: string): Promise<DecisionSet | undefined> {
  const node = await graph.getNode("meeting-decision", decisionIdFor(meetingId));
  return node?.data as DecisionSet | undefined;
}

export function meetingRecordDecisionsHandler(
  graph: RecordStore,
): OperationHandler<{
  meetingId: string;
  decisions?: Array<{ text: string; owner?: ActorId }>;
  actions?: Array<{ text: string; owner: ActorId; due?: string }>;
}> {
  return {
    name: "meeting.recordDecisions",
    validate: (args) =>
      args.meetingId
        ? { ok: true }
        : { ok: false, missing: ["meetingId"], detail: "A meeting id is required." },
    permission: () => ({ action: "create", nodeType: "meeting-decision" }),
    involvesMoneyOrPeople: () => false,
    execute: async (args) => {
      const before = await readSet(graph, args.meetingId);
      const decisions = [
        ...(before?.decisions ?? []),
        ...(args.decisions ?? []).map((d, i) => ({
          id: `dec_${Date.now().toString(36)}_${i}`,
          text: d.text,
          owner: d.owner,
        })),
      ];
      const actions = [
        ...(before?.actions ?? []),
        ...(args.actions ?? []).map((a, i) => ({
          id: `act_${Date.now().toString(36)}_${i}`,
          text: a.text,
          owner: a.owner,
          due: a.due,
        })),
      ];
      const data: DecisionSet = { meetingId: args.meetingId, decisions, actions };
      await graph.putNode("meeting-decision", decisionIdFor(args.meetingId), data);
      const owners = new Set(actions.map((a) => a.owner));
      const result: OperationResult = {
        changes: [{ nodeType: "meeting-decision", nodeId: decisionIdFor(args.meetingId), after: data }],
        publishedTo: [...owners].map((actor) => ({ kind: "actor" as const, actor })),
        response: { decisionCount: decisions.length, actionCount: actions.length },
      };
      return result;
    },
  };
}

export function meetingCompleteActionHandler(
  graph: RecordStore,
): OperationHandler<{ meetingId: string; actionId: string }> {
  return {
    name: "meeting.completeAction",
    validate: (args) => {
      const missing: string[] = [];
      if (!args.meetingId) missing.push("meetingId");
      if (!args.actionId) missing.push("actionId");
      return missing.length === 0
        ? { ok: true }
        : { ok: false, missing, detail: "meetingId and actionId are required." };
    },
    permission: (args) => ({
      action: "edit",
      nodeType: "meeting-decision",
      recordNodeIds: [decisionIdFor(args.meetingId)],
    }),
    involvesMoneyOrPeople: () => false,
    execute: async (args, ctx) => {
      const before = await readSet(graph, args.meetingId);
      if (!before) throw new Error(`No decisions for ${args.meetingId}`);
      const actions = before.actions.map((a) =>
        a.id === args.actionId
          ? { ...a, done: true, completedAt: ctx.now() }
          : a,
      );
      await graph.putNode("meeting-decision", decisionIdFor(args.meetingId), { ...before, actions });
      return {
        changes: [{ nodeType: "meeting-decision", nodeId: decisionIdFor(args.meetingId), after: { action: args.actionId, done: true } }],
        publishedTo: [{ kind: "actor", actor: ctx.actor }],
      };
    },
  };
}
