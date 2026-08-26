import type { OperationHandler } from "@/spine/operation/registry";
import type { ActorId, NodeId } from "@/spine/operation/types";
import type { RecordStore } from "@/spine/record/types";
import { calendarResult } from "./shared/calendar-result";
import { resolvePeople } from "./shared/resolve";
import {
  calendarCancelledMessage,
  calendarCreatedMessage,
  calendarEditedMessage,
  calendarPeopleAddedMessage,
  calendarPeopleRemovedMessage,
} from "./shared/change-message";

interface CalendarEntry {
  title: string;
  kind: "meeting" | "event";
  date: string;
  from?: string;
  to?: string;
  detail?: string;
  people: ActorId[];
  cancelled?: boolean;
  [key: string]: unknown;
}

let entrySeq = 0;
/**
 * Exported because `meeting.create` writes a calendar entry too. Ids come from
 * one counter so a meeting-derived entry is indistinguishable from a hand-made
 * one on the common calendar — which is the point of section 6.
 */
export function nextEntryId(): string {
  entrySeq += 1;
  return `cal_${Date.now().toString(36)}_${entrySeq}`;
}

/**
 * The edge from a meeting to the calendar entry that shows it.
 *
 * ⚠ **An edge, not a merge.** Merging `meeting` into `calendar-entry` would
 * drag meetings inside `OPEN_NODE_TYPES` (`server/policy.ts`), which is
 * deliberately ONE type wide and is asserted to be by `security.test.ts`
 * ("the open-node bypass is one type wide, not twelve"). Meetings keep their
 * own permission rules; the calendar entry is a projection of them.
 */
export const SHOWN_ON_CALENDAR = "shown-on";

async function readEntry(graph: RecordStore, id: string): Promise<CalendarEntry | undefined> {
  const node = await graph.getNode("calendar-entry", id);
  return node?.data as CalendarEntry | undefined;
}

export function calendarCreateHandler(
  graph: RecordStore,
): OperationHandler<{
  title: string;
  kind: "meeting" | "event";
  date: string;
  from?: string;
  to?: string;
  detail?: string;
  people?: ActorId[] | string;
}> {
  return {
    name: "calendar.create",
    validate: (args) => {
      const missing: string[] = [];
      if (!args.title) missing.push("title");
      if (!args.kind) missing.push("kind");
      if (!args.date) missing.push("date");
      return missing.length === 0
        ? { ok: true }
        : { ok: false, missing, detail: "title, kind and date are required." };
    },
    permission: () => ({ action: "create", nodeType: "calendar-entry" }),
    involvesMoneyOrPeople: () => false,
    execute: async (args, ctx) => {
      const id = nextEntryId();
      const { picks } = resolvePeople(args.people);
      const data: CalendarEntry = {
        title: args.title,
        kind: args.kind,
        date: args.date,
        from: args.from,
        to: args.to,
        detail: args.detail,
        people: picks,
      };
      await graph.putNode("calendar-entry", id, data);
      // E5: what changed, and who changed it. Without this the spine falls back
      // to summarizeChanges and delivers "calendar-entry:cal_x changed".
      const message = calendarCreatedMessage({
        actor: ctx.actor,
        title: data.title,
        kind: data.kind,
        date: data.date,
        from: data.from,
        to: data.to,
        people: picks,
      });
      return calendarResult({
        changes: [{ nodeType: "calendar-entry", nodeId: id, after: data }],
        notify: [
          { kind: "actor", actor: ctx.actor, message },
          ...picks.map((a) => ({ kind: "actor" as const, actor: a, message })),
        ],
        undo: {
          description: `Cancel calendar entry ${id}.`,
          revert: async () => { await graph.removeNode("calendar-entry", id); },
          // Serialisable, so undo still works after a restart — the closure
          // above dies with the process (registry.ts, `UndoInfo.plan`).
          plan: [{ op: "remove", nodeType: "calendar-entry", nodeId: id }],
        },
        response: { entryId: id, picks },
      });
    },
  };
}

export function calendarEditHandler(
  graph: RecordStore,
): OperationHandler<{
  entryId: string;
  title?: string;
  date?: string;
  from?: string;
  to?: string;
  detail?: string;
}> {
  return {
    name: "calendar.edit",
    validate: (args) =>
      args.entryId
        ? { ok: true }
        : { ok: false, missing: ["entryId"], detail: "An entry id is required." },
    permission: (args) => ({
      action: "edit",
      nodeType: "calendar-entry",
      recordNodeIds: [args.entryId],
    }),
    involvesMoneyOrPeople: () => false,
    execute: async (args, ctx) => {
      const before = await readEntry(graph, args.entryId);
      if (!before) throw new Error(`No calendar entry ${args.entryId}`);
      const updated: CalendarEntry = {
        ...before,
        title: args.title ?? before.title,
        date: args.date ?? before.date,
        from: args.from ?? before.from,
        to: args.to ?? before.to,
        detail: args.detail ?? before.detail,
      };
      await graph.putNode("calendar-entry", args.entryId, updated);
      // `editedBy` was already computed and then thrown into the activity
      // record. E5 wants it in the sentence the person reads.
      const message = calendarEditedMessage({
        actor: ctx.actor,
        before: { title: before.title, date: before.date, from: before.from, to: before.to },
        after: { title: updated.title, date: updated.date, from: updated.from, to: updated.to },
      });
      return calendarResult({
        changes: [
          {
            nodeType: "calendar-entry",
            nodeId: args.entryId,
            before: { title: before.title, date: before.date },
            after: { title: updated.title, date: updated.date, editedBy: ctx.actor },
          },
        ],
        notify: before.people.map((a) => ({ kind: "actor" as const, actor: a, message })),
        undo: {
          description: `Revert calendar entry ${args.entryId}.`,
          revert: async () => { await graph.putNode("calendar-entry", args.entryId, before); },
          // Serialisable, so undo still works after a restart — the closure
          // above dies with the process (registry.ts, `UndoInfo.plan`).
          plan: [{ op: "put", nodeType: "calendar-entry", nodeId: args.entryId, data: before }],
        },
      });
    },
  };
}

export function calendarAddPeopleHandler(
  graph: RecordStore,
): OperationHandler<{ entryId: string; people: ActorId[] | string }> {
  return {
    name: "calendar.addPeople",
    validate: (args) => {
      const missing: string[] = [];
      if (!args.entryId) missing.push("entryId");
      if (!args.people) missing.push("people");
      return missing.length === 0
        ? { ok: true }
        : { ok: false, missing, detail: "entryId and people are required." };
    },
    permission: (args) => ({
      action: "edit",
      nodeType: "calendar-entry",
      recordNodeIds: [args.entryId],
    }),
    involvesMoneyOrPeople: () => false,
    execute: async (args, ctx) => {
      const before = await readEntry(graph, args.entryId);
      if (!before) throw new Error(`No calendar entry ${args.entryId}`);
      const { picks, note } = resolvePeople(args.people);
      const added = picks.filter((p) => !before.people.includes(p));
      const people = [...before.people, ...added];
      await graph.putNode("calendar-entry", args.entryId, { ...before, people });
      // Only the added people are notified, so each of them reads the "added
      // you" form rather than being told that somebody else joined.
      const message = calendarPeopleAddedMessage({
        actor: ctx.actor,
        title: before.title,
        added,
        date: before.date,
        forAddedPerson: true,
      });
      return calendarResult({
        changes: [{ nodeType: "calendar-entry", nodeId: args.entryId, after: { added } }],
        notify: added.map((a) => ({ kind: "actor" as const, actor: a, message })),
        undo: {
          description: `Remove added people from ${args.entryId}.`,
          revert: async () => { await graph.putNode("calendar-entry", args.entryId, before); },
          // Serialisable, so undo still works after a restart — the closure
          // above dies with the process (registry.ts, `UndoInfo.plan`).
          plan: [{ op: "put", nodeType: "calendar-entry", nodeId: args.entryId, data: before }],
        },
        response: { picks: added, resolvedFrom: note, addedBy: ctx.actor },
      });
    },
  };
}

export function calendarRemovePeopleHandler(
  graph: RecordStore,
): OperationHandler<{ entryId: string; people: ActorId[] }> {
  return {
    name: "calendar.removePeople",
    validate: (args) => {
      const missing: string[] = [];
      if (!args.entryId) missing.push("entryId");
      if (!args.people || args.people.length === 0) missing.push("people");
      return missing.length === 0
        ? { ok: true }
        : { ok: false, missing, detail: "entryId and people are required." };
    },
    permission: (args) => ({
      action: "edit",
      nodeType: "calendar-entry",
      recordNodeIds: [args.entryId],
    }),
    involvesMoneyOrPeople: () => false,
    execute: async (args, ctx) => {
      const before = await readEntry(graph, args.entryId);
      if (!before) throw new Error(`No calendar entry ${args.entryId}`);
      const removed = before.people.filter((p) => args.people.includes(p));
      const people = before.people.filter((p) => !args.people.includes(p));
      await graph.putNode("calendar-entry", args.entryId, { ...before, people });
      // E4: being dropped silently is the worst thing an open calendar can do,
      // so the person removed is told, and told who removed them.
      const message = calendarPeopleRemovedMessage({
        actor: ctx.actor,
        title: before.title,
        removed,
        date: before.date,
        forRemovedPerson: true,
      });
      return calendarResult({
        changes: [{ nodeType: "calendar-entry", nodeId: args.entryId, after: { removed } }],
        notify: removed.map((a) => ({
          kind: "actor" as const,
          actor: a,
          message,
        })),
        undo: {
          description: `Restore removed people to ${args.entryId}.`,
          revert: async () => { await graph.putNode("calendar-entry", args.entryId, before); },
          // Serialisable, so undo still works after a restart — the closure
          // above dies with the process (registry.ts, `UndoInfo.plan`).
          plan: [{ op: "put", nodeType: "calendar-entry", nodeId: args.entryId, data: before }],
        },
        response: { removed, removedBy: ctx.actor },
      });
    },
  };
}

export function calendarCancelHandler(
  graph: RecordStore,
): OperationHandler<{ entryId: string }> {
  return {
    name: "calendar.cancel",
    validate: (args) =>
      args.entryId
        ? { ok: true }
        : { ok: false, missing: ["entryId"], detail: "An entry id is required." },
    permission: (args) => ({
      action: "edit",
      nodeType: "calendar-entry",
      recordNodeIds: [args.entryId],
    }),
    involvesMoneyOrPeople: () => false,
    execute: async (args, ctx) => {
      const before = await readEntry(graph, args.entryId);
      if (!before) throw new Error(`No calendar entry ${args.entryId}`);
      await graph.putNode("calendar-entry", args.entryId, { ...before, cancelled: true });
      const message = calendarCancelledMessage({
        actor: ctx.actor,
        title: before.title,
        date: before.date,
      });
      return calendarResult({
        changes: [{ nodeType: "calendar-entry", nodeId: args.entryId, after: { cancelled: true, cancelledBy: ctx.actor } }],
        notify: before.people.map((a) => ({ kind: "actor" as const, actor: a, message })),
        undo: {
          description: `Un-cancel ${args.entryId}.`,
          revert: async () => { await graph.putNode("calendar-entry", args.entryId, before); },
          // Serialisable, so undo still works after a restart — the closure
          // above dies with the process (registry.ts, `UndoInfo.plan`).
          plan: [{ op: "put", nodeType: "calendar-entry", nodeId: args.entryId, data: before }],
        },
      });
    },
  };
}

export interface CalendarCell {
  date: string;
  /** How many meetings fall on this day. `meetingEntries` is the detail. */
  meetings: number;
  events: Array<{ id: NodeId; title: string }>;
  /**
   * The meetings themselves, carrying the join link where there is one.
   *
   * E7 names the common calendar as one of the three places the link must be
   * visible. Before section 6 a meeting never reached this view at all —
   * `meeting` and `calendar-entry` were unrelated node types and
   * `calendar-entry.kind === "meeting"` was a label, not a reference.
   */
  meetingEntries: Array<{ id: NodeId; title: string; link?: string }>;
}

export async function monthView(graph: RecordStore, year: number, month: number): Promise<CalendarCell[]> {
  const prefix = `${year}-${String(month).padStart(2, "0")}`;
  const days = new Date(year, month, 0).getDate();
  const cells: CalendarCell[] = Array.from({ length: days }, (_, i) => ({
    date: `${prefix}-${String(i + 1).padStart(2, "0")}`,
    meetings: 0,
    events: [],
    meetingEntries: [],
  }));
  const entries = await graph.find("calendar-entry", () => true);
  for (const node of entries) {
    const d = node.data as CalendarEntry;
    if (d.cancelled || !d.date.startsWith(prefix)) continue;
    const day = Number(d.date.slice(8, 10));
    if (day < 1 || day > days) continue;
    if (d.kind === "meeting") {
      cells[day - 1].meetings += 1;
      cells[day - 1].meetingEntries.push({
        id: node.id,
        title: d.title,
        // Present only for an online or `both` meeting. An in-person one gets
        // no link field at all rather than an empty one.
        link: typeof d.link === "string" ? d.link : undefined,
      });
    } else cells[day - 1].events.push({ id: node.id, title: d.title });
  }
  return cells;
}
