import type { OperationHandler } from "@/spine/operation/registry";
import type { ActorId } from "@/spine/operation/types";
import type { RecordStore } from "@/spine/record/types";

interface EventTask {
  id: string;
  text: string;
  owner?: ActorId;
  due?: string;
  done?: boolean;
}

interface EventData {
  title: string;
  date: string;
  status: "planning" | "live" | "closed";
  capacity?: number;
  tasks: EventTask[];
  registrations: ActorId[];
  budget?: { currency: string; spent: number; limit?: number };
  report?: string;
  [key: string]: unknown;
}

let eventSeq = 0;
function nextEventId(): string {
  eventSeq += 1;
  return `event_${Date.now().toString(36)}_${eventSeq}`;
}

function readEvent(graph: RecordStore, id: string): EventData | undefined {
  return graph.getNode("event", id)?.data as EventData | undefined;
}

export function eventCreateHandler(
  graph: RecordStore,
): OperationHandler<{ title: string; date: string; capacity?: number; budgetLimit?: number }> {
  return {
    name: "event.create",
    validate: (args) => {
      const missing: string[] = [];
      if (!args.title) missing.push("title");
      if (!args.date) missing.push("date");
      return missing.length === 0 ? { ok: true } : { ok: false, missing, detail: "title and date are required." };
    },
    permission: () => ({ action: "create", nodeType: "event" }),
    involvesMoneyOrPeople: () => false,
    execute: (args) => {
      const id = nextEventId();
      const data: EventData = {
        title: args.title,
        date: args.date,
        status: "planning",
        capacity: args.capacity,
        tasks: [],
        registrations: [],
        budget: { currency: "INR", spent: 0, limit: args.budgetLimit },
      };
      graph.putNode("event", id, data);
      return {
        changes: [{ nodeType: "event", nodeId: id, after: data }],
        publishedTo: [{ kind: "broadcast" }],
        response: { eventId: id },
      };
    },
  };
}

export function eventAddTaskHandler(
  graph: RecordStore,
): OperationHandler<{ eventId: string; text: string; owner?: ActorId; due?: string }> {
  return {
    name: "event.addTask",
    validate: (args) => {
      const missing: string[] = [];
      if (!args.eventId) missing.push("eventId");
      if (!args.text) missing.push("text");
      return missing.length === 0 ? { ok: true } : { ok: false, missing };
    },
    permission: (args) => ({ action: "edit", nodeType: "event", recordNodeIds: [args.eventId] }),
    involvesMoneyOrPeople: () => false,
    execute: (args) => {
      const before = readEvent(graph, args.eventId);
      if (!before) throw new Error(`No event ${args.eventId}`);
      const task: EventTask = { id: `t_${Date.now().toString(36)}`, text: args.text, owner: args.owner, due: args.due };
      graph.putNode("event", args.eventId, { ...before, tasks: [...before.tasks, task] });
      return {
        changes: [{ nodeType: "event", nodeId: args.eventId, after: { task: task.id } }],
        publishedTo: args.owner ? [{ kind: "actor", actor: args.owner }] : [],
      };
    },
  };
}

export function eventRegisterHandler(
  graph: RecordStore,
): OperationHandler<{ eventId: string; attendee: ActorId }> {
  return {
    name: "event.register",
    validate: (args) => {
      const missing: string[] = [];
      if (!args.eventId) missing.push("eventId");
      if (!args.attendee) missing.push("attendee");
      return missing.length === 0 ? { ok: true } : { ok: false, missing };
    },
    permission: (args) => ({ action: "edit", nodeType: "event", recordNodeIds: [args.eventId] }),
    involvesMoneyOrPeople: () => false,
    execute: (args) => {
      const before = readEvent(graph, args.eventId);
      if (!before) throw new Error(`No event ${args.eventId}`);
      const registrations = before.registrations.includes(args.attendee)
        ? before.registrations
        : [...before.registrations, args.attendee];
      graph.putNode("event", args.eventId, { ...before, registrations });
      return {
        changes: [{ nodeType: "event", nodeId: args.eventId, after: { registered: args.attendee, count: registrations.length } }],
        publishedTo: [{ kind: "actor", actor: args.attendee }],
        response: { registrationCount: registrations.length },
      };
    },
  };
}

export function eventCloseHandler(
  graph: RecordStore,
): OperationHandler<{ eventId: string; report: string }> {
  return {
    name: "event.close",
    validate: (args) => {
      const missing: string[] = [];
      if (!args.eventId) missing.push("eventId");
      if (!args.report) missing.push("report");
      return missing.length === 0 ? { ok: true } : { ok: false, missing };
    },
    permission: (args) => ({ action: "edit", nodeType: "event", recordNodeIds: [args.eventId] }),
    involvesMoneyOrPeople: () => false,
    execute: (args) => {
      const before = readEvent(graph, args.eventId);
      if (!before) throw new Error(`No event ${args.eventId}`);
      graph.putNode("event", args.eventId, { ...before, status: "closed", report: args.report });
      return {
        changes: [{ nodeType: "event", nodeId: args.eventId, after: { status: "closed" } }],
        publishedTo: [{ kind: "broadcast" }],
      };
    },
  };
}

export function findOverdueEventTasks(graph: RecordStore, asOf: string): Array<{ eventId: string; task: EventTask }> {
  const out: Array<{ eventId: string; task: EventTask }> = [];
  for (const node of graph.find("event", (n) => (n.data as { status?: string }).status !== "closed")) {
    const data = node.data as EventData;
    for (const task of data.tasks ?? []) {
      if (!task.done && task.due && task.due < asOf) out.push({ eventId: node.id, task });
    }
  }
  return out;
}

export function registrationPacing(graph: RecordStore, eventId: string, compareCount: number): "ahead" | "behind" | "on-track" {
  const event = readEvent(graph, eventId);
  if (!event) return "behind";
  const count = event.registrations.length;
  if (count >= compareCount) return "ahead";
  if (count >= Math.floor(compareCount * 0.6)) return "on-track";
  return "behind";
}
