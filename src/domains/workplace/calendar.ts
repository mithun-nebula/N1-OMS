import type { OperationHandler } from "@/spine/operation/registry";
import type { ActorId, NodeId } from "@/spine/operation/types";
import type { RecordStore } from "@/spine/record/types";
import { calendarResult } from "./shared/calendar-result";
import { resolvePeople } from "./shared/resolve";

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
function nextEntryId(): string {
  entrySeq += 1;
  return `cal_${Date.now().toString(36)}_${entrySeq}`;
}

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
      return calendarResult({
        changes: [{ nodeType: "calendar-entry", nodeId: id, after: data }],
        notify: [{ kind: "actor", actor: ctx.actor }, ...picks.map((a) => ({ kind: "actor" as const, actor: a }))],
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
      return calendarResult({
        changes: [
          {
            nodeType: "calendar-entry",
            nodeId: args.entryId,
            before: { title: before.title, date: before.date },
            after: { title: updated.title, date: updated.date, editedBy: ctx.actor },
          },
        ],
        notify: before.people.map((a) => ({ kind: "actor" as const, actor: a })),
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
      return calendarResult({
        changes: [{ nodeType: "calendar-entry", nodeId: args.entryId, after: { added } }],
        notify: added.map((a) => ({ kind: "actor" as const, actor: a })),
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
      return calendarResult({
        changes: [{ nodeType: "calendar-entry", nodeId: args.entryId, after: { removed } }],
        notify: removed.map((a) => ({
          kind: "actor" as const,
          actor: a,
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
      return calendarResult({
        changes: [{ nodeType: "calendar-entry", nodeId: args.entryId, after: { cancelled: true, cancelledBy: ctx.actor } }],
        notify: before.people.map((a) => ({ kind: "actor" as const, actor: a })),
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
  meetings: number;
  events: Array<{ id: NodeId; title: string }>;
}

export async function monthView(graph: RecordStore, year: number, month: number): Promise<CalendarCell[]> {
  const prefix = `${year}-${String(month).padStart(2, "0")}`;
  const days = new Date(year, month, 0).getDate();
  const cells: CalendarCell[] = Array.from({ length: days }, (_, i) => ({
    date: `${prefix}-${String(i + 1).padStart(2, "0")}`,
    meetings: 0,
    events: [],
  }));
  const entries = await graph.find("calendar-entry", () => true);
  for (const node of entries) {
    const d = node.data as CalendarEntry;
    if (d.cancelled || !d.date.startsWith(prefix)) continue;
    const day = Number(d.date.slice(8, 10));
    if (day < 1 || day > days) continue;
    if (d.kind === "meeting") cells[day - 1].meetings += 1;
    else cells[day - 1].events.push({ id: node.id, title: d.title });
  }
  return cells;
}
