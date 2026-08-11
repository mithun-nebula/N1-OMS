import type { OperationHandler, OperationResult } from "@/spine/operation/registry";
import type { ActorId } from "@/spine/operation/types";
import type { RecordStore } from "@/spine/record/types";

interface TaskData {
  title: string;
  description?: string;
  assignedTo?: ActorId;
  status: "todo" | "in-progress" | "done";
  priority: "low" | "medium" | "high";
  dueDate?: string;
  projectId?: string;
  createdBy: string;
  [key: string]: unknown;
}

let taskSeq = 0;

export function taskCreateHandler(
  graph: RecordStore,
): OperationHandler<{
  title: string;
  description?: string;
  assignedTo?: ActorId;
  priority?: string;
  dueDate?: string;
  projectId?: string;
}> {
  return {
    name: "task.create",
    validate: (args) =>
      args.title
        ? { ok: true }
        : { ok: false, missing: ["title"], detail: "A title is required." },
    permission: () => ({ action: "create", nodeType: "task" }),
    involvesMoneyOrPeople: () => false,
    execute: async (args, ctx) => {
      taskSeq += 1;
      const id = `task_${Date.now().toString(36)}_${taskSeq}`;
      const data: TaskData = {
        title: args.title,
        description: args.description,
        assignedTo: args.assignedTo,
        status: "todo",
        priority: (args.priority as TaskData["priority"]) ?? "medium",
        dueDate: args.dueDate,
        projectId: args.projectId,
        createdBy: ctx.actor,
      };
      await graph.putNode("task", id, data);
      if (args.assignedTo) {
        await graph.addEdge({ from: args.assignedTo, to: id, type: "assigned" });
      }
      const result: OperationResult = {
        changes: [{ nodeType: "task", nodeId: id, after: data }],
        publishedTo: args.assignedTo
          ? [{ kind: "actor", actor: args.assignedTo }]
          : [],
        response: { taskId: id },
      };
      return result;
    },
  };
}

export function taskAssignHandler(
  graph: RecordStore,
): OperationHandler<{ taskId: string; assignedTo: ActorId }> {
  return {
    name: "task.assign",
    validate: (args) => {
      const missing: string[] = [];
      if (!args.taskId) missing.push("taskId");
      if (!args.assignedTo) missing.push("assignedTo");
      return missing.length === 0 ? { ok: true } : { ok: false, missing };
    },
    permission: (args) => ({ action: "edit", nodeType: "task", recordNodeIds: [args.taskId] }),
    involvesMoneyOrPeople: () => false,
    execute: async (args) => {
      const node = await graph.getNode("task", args.taskId);
      const before = node?.data as TaskData | undefined;
      if (!before) throw new Error(`No task ${args.taskId}`);
      const updated = { ...before, assignedTo: args.assignedTo };
      await graph.putNode("task", args.taskId, updated);
      if (before.assignedTo) await graph.removeEdge(before.assignedTo, args.taskId, "assigned");
      await graph.addEdge({ from: args.assignedTo, to: args.taskId, type: "assigned" });
      return {
        changes: [{ nodeType: "task", nodeId: args.taskId, after: { assignedTo: args.assignedTo } }],
        publishedTo: [{ kind: "actor", actor: args.assignedTo }],
      };
    },
  };
}

export function taskCompleteHandler(
  graph: RecordStore,
): OperationHandler<{ taskId: string }> {
  return {
    name: "task.complete",
    validate: (args) =>
      args.taskId
        ? { ok: true }
        : { ok: false, missing: ["taskId"], detail: "A task id is required." },
    permission: (args) => ({ action: "edit", nodeType: "task", recordNodeIds: [args.taskId] }),
    involvesMoneyOrPeople: () => false,
    execute: async (args) => {
      const node = await graph.getNode("task", args.taskId);
      const before = node?.data as TaskData | undefined;
      if (!before) throw new Error(`No task ${args.taskId}`);
      await graph.putNode("task", args.taskId, { ...before, status: "done" });
      return {
        changes: [{ nodeType: "task", nodeId: args.taskId, after: { status: "done" } }],
        undo: {
          description: `Reopen task ${args.taskId}.`,
          revert: async () => { await graph.putNode("task", args.taskId, before); },
        },
      };
    },
  };
}

export function taskEditHandler(
  graph: RecordStore,
): OperationHandler<{
  taskId: string;
  title?: string;
  description?: string;
  priority?: string;
  dueDate?: string;
}> {
  return {
    name: "task.edit",
    validate: (args) =>
      args.taskId
        ? { ok: true }
        : { ok: false, missing: ["taskId"], detail: "A task id is required." },
    permission: (args) => ({ action: "edit", nodeType: "task", recordNodeIds: [args.taskId] }),
    involvesMoneyOrPeople: () => false,
    execute: async (args) => {
      const node = await graph.getNode("task", args.taskId);
      const before = node?.data as TaskData | undefined;
      if (!before) throw new Error(`No task ${args.taskId}`);
      const updated: TaskData = {
        ...before,
        title: args.title ?? before.title,
        description: args.description ?? before.description,
        priority: (args.priority as TaskData["priority"]) ?? before.priority,
        dueDate: args.dueDate ?? before.dueDate,
      };
      await graph.putNode("task", args.taskId, updated);
      return {
        changes: [{ nodeType: "task", nodeId: args.taskId, after: { title: updated.title, priority: updated.priority, dueDate: updated.dueDate } }],
        undo: {
          description: `Revert edits to task ${args.taskId}.`,
          revert: async () => { await graph.putNode("task", args.taskId, before); },
        },
      };
    },
  };
}

export function taskDeleteHandler(
  graph: RecordStore,
): OperationHandler<{ taskId: string }> {
  return {
    name: "task.delete",
    validate: (args) =>
      args.taskId
        ? { ok: true }
        : { ok: false, missing: ["taskId"], detail: "A task id is required." },
    permission: (args) => ({ action: "delete", nodeType: "task", recordNodeIds: [args.taskId] }),
    involvesMoneyOrPeople: () => false,
    execute: async (args) => {
      const node = await graph.getNode("task", args.taskId);
      const before = node?.data as TaskData | undefined;
      await graph.removeNode("task", args.taskId);
      if (before?.assignedTo) {
        await graph.removeEdge(before.assignedTo, args.taskId, "assigned");
      }
      return {
        changes: [{ nodeType: "task", nodeId: args.taskId, before }],
        undo: {
          description: `Restore deleted task ${args.taskId}.`,
          revert: async () => {
            if (before) {
              await graph.putNode("task", args.taskId, before);
              if (before.assignedTo) await graph.addEdge({ from: before.assignedTo, to: args.taskId, type: "assigned" });
            }
          },
        },
      };
    },
  };
}
