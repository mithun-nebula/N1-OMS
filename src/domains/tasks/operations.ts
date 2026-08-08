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
    execute: (args, ctx) => {
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
      graph.putNode("task", id, data);
      if (args.assignedTo) {
        graph.addEdge({ from: args.assignedTo, to: id, type: "assigned" });
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
    execute: (args) => {
      const before = graph.getNode("task", args.taskId)?.data as TaskData | undefined;
      if (!before) throw new Error(`No task ${args.taskId}`);
      const updated = { ...before, assignedTo: args.assignedTo };
      graph.putNode("task", args.taskId, updated);
      if (before.assignedTo) graph.removeEdge(before.assignedTo, args.taskId, "assigned");
      graph.addEdge({ from: args.assignedTo, to: args.taskId, type: "assigned" });
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
    execute: (args) => {
      const before = graph.getNode("task", args.taskId)?.data as TaskData | undefined;
      if (!before) throw new Error(`No task ${args.taskId}`);
      graph.putNode("task", args.taskId, { ...before, status: "done" });
      return {
        changes: [{ nodeType: "task", nodeId: args.taskId, after: { status: "done" } }],
        undo: {
          description: `Reopen task ${args.taskId}.`,
          revert: () => { graph.putNode("task", args.taskId, before); },
        },
      };
    },
  };
}
