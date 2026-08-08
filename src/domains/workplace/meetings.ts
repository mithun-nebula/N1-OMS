import type { OperationHandler, OperationResult } from "@/spine/operation/registry";
import type { ActorId } from "@/spine/operation/types";
import type { RecordStore } from "@/spine/record/types";
import { providers } from "@/config/providers";

type MeetingKind = "in-person" | "online" | "both";

interface MeetingData {
  title: string;
  kind: MeetingKind;
  from: string;
  to: string;
  roomId?: string;
  linkId: string;
  link?: string;
  organizer: string;
  attendees: ActorId[];
  externals: Array<{ email: string }>;
  cancelled?: boolean;
  [key: string]: unknown;
}

let meetingSeq = 0;
function nextMeetingId(): string {
  meetingSeq += 1;
  return `meeting_${Date.now().toString(36)}_${meetingSeq}`;
}

function readMeeting(graph: RecordStore, id: string): MeetingData | undefined {
  return graph.getNode("meeting", id)?.data as MeetingData | undefined;
}

function busyAt(graph: RecordStore, actor: string, from: string, to: string): boolean {
  const meetings = graph.find(
    "meeting",
    (n) => (n.data as { cancelled?: boolean }).cancelled !== true,
  );
  return meetings.some((m) => {
    const d = m.data as { attendees?: string[]; from?: string; to?: string };
    return (
      d.attendees?.includes(actor) &&
      d.from &&
      d.to &&
      from < d.to &&
      d.from < to
    );
  });
}

export function meetingCreateHandler(
  graph: RecordStore,
): OperationHandler<{
  title: string;
  kind: MeetingKind;
  from: string;
  to: string;
  roomId?: string;
  attendees: ActorId[];
  externals?: Array<{ email: string }>;
}> {
  return {
    name: "meeting.create",
    validate: (args) => {
      const missing: string[] = [];
      if (!args.title) missing.push("title");
      if (!args.kind) missing.push("kind");
      if (!args.from || !args.to) missing.push("from/to");
      return missing.length === 0
        ? { ok: true }
        : { ok: false, missing, detail: "title, kind, from and to are required." };
    },
    permission: () => ({ action: "create", nodeType: "meeting" }),
    involvesMoneyOrPeople: () => false,
    execute: async (args, ctx) => {
      const busy = args.attendees.filter((a) => busyAt(graph, a, args.from, args.to));
      const id = nextMeetingId();
      const linkId = `link_${id}`;
      let link: string | undefined;
      if (args.kind === "online" || args.kind === "both") {
        try {
          link = (await providers().video.createMeeting({ title: args.title })).link;
        } catch {
          link = undefined;
        }
      }
      const data: MeetingData = {
        title: args.title,
        kind: args.kind,
        from: args.from,
        to: args.to,
        roomId: args.roomId,
        linkId,
        link,
        organizer: ctx.actor,
        attendees: args.attendees,
        externals: args.externals ?? [],
      };
      graph.putNode("meeting", id, data);
      const publishTo = args.attendees.map((actor) => ({
        kind: "actor" as const,
        actor,
      }));
      const result: OperationResult = {
        changes: [{ nodeType: "meeting", nodeId: id, after: { ...data, busy } }],
        undo: {
          description: `Cancel meeting ${id}.`,
          revert: () => { graph.removeNode("meeting", id); },
        },
        publishedTo: publishTo,
        response: { meetingId: id, linkId, link, busyAttendees: busy },
      };
      return result;
    },
  };
}

export function meetingUpdateHandler(
  graph: RecordStore,
): OperationHandler<{
  meetingId: string;
  title?: string;
  from?: string;
  to?: string;
}> {
  return {
    name: "meeting.update",
    validate: (args) =>
      args.meetingId
        ? { ok: true }
        : { ok: false, missing: ["meetingId"], detail: "A meeting id is required." },
    permission: (args) => ({
      action: "edit",
      nodeType: "meeting",
      recordNodeIds: [args.meetingId],
    }),
    involvesMoneyOrPeople: () => false,
    execute: (args) => {
      const before = readMeeting(graph, args.meetingId);
      if (!before) throw new Error(`No meeting ${args.meetingId}`);
      const updated: MeetingData = {
        ...before,
        title: args.title ?? before.title,
        from: args.from ?? before.from,
        to: args.to ?? before.to,
      };
      graph.putNode("meeting", args.meetingId, updated);
      return {
        changes: [
          {
            nodeType: "meeting",
            nodeId: args.meetingId,
            before: { title: before.title, from: before.from, to: before.to },
            after: { title: updated.title, from: updated.from, to: updated.to, linkPreserved: before.link },
          },
        ],
        undo: {
          description: `Revert meeting ${args.meetingId}.`,
          revert: () => { graph.putNode("meeting", args.meetingId, before); },
        },
        publishedTo: before.attendees.map((actor) => ({ kind: "actor" as const, actor })),
      };
    },
  };
}

export function meetingAddAttendeeHandler(
  graph: RecordStore,
): OperationHandler<{ meetingId: string; attendee: ActorId }> {
  return {
    name: "meeting.addAttendee",
    validate: (args) => {
      const missing: string[] = [];
      if (!args.meetingId) missing.push("meetingId");
      if (!args.attendee) missing.push("attendee");
      return missing.length === 0
        ? { ok: true }
        : { ok: false, missing, detail: "meetingId and attendee are required." };
    },
    permission: (args) => ({
      action: "edit",
      nodeType: "meeting",
      recordNodeIds: [args.meetingId],
    }),
    involvesMoneyOrPeople: () => false,
    execute: (args) => {
      const before = readMeeting(graph, args.meetingId);
      if (!before) throw new Error(`No meeting ${args.meetingId}`);
      const attendees = before.attendees.includes(args.attendee)
        ? before.attendees
        : [...before.attendees, args.attendee];
      graph.putNode("meeting", args.meetingId, { ...before, attendees });
      return {
        changes: [{ nodeType: "meeting", nodeId: args.meetingId, after: { added: args.attendee } }],
        publishedTo: [{ kind: "actor", actor: args.attendee }],
        response: { sentLinkTo: args.attendee, link: before.link },
      };
    },
  };
}

export function meetingCancelHandler(
  graph: RecordStore,
): OperationHandler<{ meetingId: string }> {
  return {
    name: "meeting.cancel",
    validate: (args) =>
      args.meetingId
        ? { ok: true }
        : { ok: false, missing: ["meetingId"], detail: "A meeting id is required." },
    permission: (args) => ({
      action: "edit",
      nodeType: "meeting",
      recordNodeIds: [args.meetingId],
    }),
    involvesMoneyOrPeople: () => false,
    execute: async (args) => {
      const before = readMeeting(graph, args.meetingId);
      if (!before) throw new Error(`No meeting ${args.meetingId}`);
      graph.putNode("meeting", args.meetingId, { ...before, cancelled: true });
      try {
        await providers().video.cancelMeeting(before.linkId);
      } catch {
        /* stub */
      }
      return {
        changes: [{ nodeType: "meeting", nodeId: args.meetingId, after: { cancelled: true, linkEnded: true } }],
        undo: {
          description: `Un-cancel meeting ${args.meetingId}.`,
          revert: () => { graph.putNode("meeting", args.meetingId, before); },
        },
        publishedTo: before.attendees.map((actor) => ({ kind: "actor" as const, actor })),
      };
    },
  };
}
