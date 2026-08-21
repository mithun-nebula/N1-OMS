import type { OperationHandler, OperationResult, UndoStep } from "@/spine/operation/registry";
import type { ActorId } from "@/spine/operation/types";
import type { RecordStore } from "@/spine/record/types";

/*
 * Every handler here returns both a `revert` closure and a serialisable
 * `plan`, per AGENTS.md: "closures die with the process." The closure is the
 * richer of the two and is preferred while the process lives; the plan is what
 * makes undo still work after a restart, a redeploy, or on a second instance.
 *
 * `task.create` and `task.assign` previously returned no undo at all, so a
 * created or reassigned task could not be put back by any route.
 */

interface TaskData {
  title: string;
  description?: string;
  assignedTo?: ActorId;
  status: "todo" | "in-progress" | "done";
  priority: "low" | "medium" | "high";
  dueDate?: string;
  projectId?: string;
  /**
   * How long this is expected to take, in minutes.
   *
   * The day plan requires a time on every item and had nowhere to keep one
   * between days, so the same task was re-estimated from scratch every morning
   * and appendix A5's learning had nothing to attach to.
   */
  estimateMinutes?: number;
  /** Set when this task is the assignee's share of a course assignment. */
  courseId?: string;
  createdBy: string;
  [key: string]: unknown;
}

/**
 * The task's owner for the gate's self/own-team scopes: the assignee, falling
 * back to the creator — an unassigned task must stay visible to the manager
 * who just created it, not vanish into a scope nobody satisfies.
 */
function registerTaskOwner(
  owners: Map<string, ActorId> | undefined,
  taskId: string,
  assignedTo: ActorId | undefined,
  createdBy?: ActorId,
): void {
  if (!owners) return;
  const owner = assignedTo ?? createdBy;
  if (owner) owners.set(`task:${taskId}`, owner);
  else owners.delete(`task:${taskId}`);
}

/** Reject nonsense without inventing a ceiling — a long job is still a job. */
function normalizeEstimate(value: unknown): number | undefined {
  const minutes = Number(value);
  if (!Number.isFinite(minutes) || minutes <= 0) return undefined;
  return Math.round(minutes);
}

let taskSeq = 0;

export function taskCreateHandler(
  graph: RecordStore,
  owners?: Map<string, ActorId>,
): OperationHandler<{
  title: string;
  description?: string;
  assignedTo?: ActorId;
  priority?: string;
  dueDate?: string;
  projectId?: string;
  estimateMinutes?: number;
  courseId?: string;
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
        estimateMinutes: normalizeEstimate(args.estimateMinutes),
        courseId: args.courseId,
        createdBy: ctx.actor,
      };
      await graph.putNode("task", id, data);
      registerTaskOwner(owners, id, args.assignedTo, ctx.actor);
      if (args.assignedTo) {
        await graph.addEdge({ from: args.assignedTo, to: id, type: "assigned" });
      }
      // Edge first, then the node — the same order the closure uses, so a
      // store that refuses to orphan an edge behaves identically either way.
      const undoPlan: UndoStep[] = [
        ...(args.assignedTo
          ? [{ op: "removeEdge" as const, from: args.assignedTo, to: id, edgeType: "assigned" }]
          : []),
        { op: "remove" as const, nodeType: "task", nodeId: id },
      ];
      const result: OperationResult = {
        changes: [{ nodeType: "task", nodeId: id, after: data }],
        undo: {
          description: `Remove task “${args.title}”.`,
          revert: async () => {
            if (args.assignedTo) await graph.removeEdge(args.assignedTo, id, "assigned");
            await graph.removeNode("task", id);
          },
          plan: undoPlan,
        },
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
  owners?: Map<string, ActorId>,
): OperationHandler<{ taskId: string; assignedTo: ActorId }> {
  return {
    name: "task.assign",
    validate: (args) => {
      const missing: string[] = [];
      if (!args.taskId) missing.push("taskId");
      if (!args.assignedTo) missing.push("assignedTo");
      return missing.length === 0 ? { ok: true } : { ok: false, missing };
    },
    permission: (args) => ({ action: "edit", nodeType: "task", recordNodeIds: [args.taskId], fields: ["assignedTo"] }),
    involvesMoneyOrPeople: () => false,
    execute: async (args) => {
      const node = await graph.getNode("task", args.taskId);
      const before = node?.data as TaskData | undefined;
      if (!before) throw new Error(`No task ${args.taskId}`);
      const updated = { ...before, assignedTo: args.assignedTo };
      await graph.putNode("task", args.taskId, updated);
      registerTaskOwner(owners, args.taskId, args.assignedTo, before.createdBy);
      if (before.assignedTo) await graph.removeEdge(before.assignedTo, args.taskId, "assigned");
      await graph.addEdge({ from: args.assignedTo, to: args.taskId, type: "assigned" });
      return {
        changes: [{ nodeType: "task", nodeId: args.taskId, after: { assignedTo: args.assignedTo } }],
        undo: {
          description: before.assignedTo
            ? `Reassign task ${args.taskId} back to ${before.assignedTo}.`
            : `Unassign task ${args.taskId}.`,
          revert: async () => {
            await graph.removeEdge(args.assignedTo, args.taskId, "assigned");
            if (before.assignedTo) {
              await graph.addEdge({ from: before.assignedTo, to: args.taskId, type: "assigned" });
            }
            await graph.putNode("task", args.taskId, before);
          },
          plan: [
            { op: "removeEdge", from: args.assignedTo, to: args.taskId, edgeType: "assigned" },
            ...(before.assignedTo
              ? [{ op: "addEdge" as const, from: before.assignedTo, to: args.taskId, edgeType: "assigned" }]
              : []),
            { op: "put", nodeType: "task", nodeId: args.taskId, data: before },
          ],
        },
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
    // Status-only: the field the employee's self-scoped task rule permits, so
    // people can finish their own assigned work but never rewrite it.
    permission: (args) => ({ action: "edit", nodeType: "task", recordNodeIds: [args.taskId], fields: ["status"] }),
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
          plan: [{ op: "put", nodeType: "task", nodeId: args.taskId, data: before }],
        },
      };
    },
  };
}

export function taskStartHandler(
  graph: RecordStore,
): OperationHandler<{ taskId: string }> {
  return {
    name: "task.start",
    validate: (args) =>
      args.taskId
        ? { ok: true }
        : { ok: false, missing: ["taskId"], detail: "A task id is required." },
    permission: (args) => ({ action: "edit", nodeType: "task", recordNodeIds: [args.taskId], fields: ["status"] }),
    involvesMoneyOrPeople: () => false,
    execute: async (args) => {
      const node = await graph.getNode("task", args.taskId);
      const before = node?.data as TaskData | undefined;
      if (!before) throw new Error(`No task ${args.taskId}`);
      if (before.status === "done") {
        throw new Error(`Task ${args.taskId} is already done — reopen it via undo instead.`);
      }
      await graph.putNode("task", args.taskId, { ...before, status: "in-progress" });
      return {
        changes: [{ nodeType: "task", nodeId: args.taskId, after: { status: "in-progress" } }],
        undo: {
          description: `Put task ${args.taskId} back to ${before.status}.`,
          revert: async () => { await graph.putNode("task", args.taskId, before); },
          plan: [{ op: "put", nodeType: "task", nodeId: args.taskId, data: before }],
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
  estimateMinutes?: number;
}> {
  return {
    name: "task.edit",
    validate: (args) =>
      args.taskId
        ? { ok: true }
        : { ok: false, missing: ["taskId"], detail: "A task id is required." },
    // Declares the substance it rewrites, so the status-only employee rule
    // refuses it — reshaping a task is a manager's move (top-down tasks).
    permission: (args) => ({
      action: "edit",
      nodeType: "task",
      recordNodeIds: [args.taskId],
      fields: ["title", "description", "priority", "dueDate", "estimateMinutes"],
    }),
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
        estimateMinutes: normalizeEstimate(args.estimateMinutes) ?? before.estimateMinutes,
      };
      await graph.putNode("task", args.taskId, updated);
      return {
        changes: [{ nodeType: "task", nodeId: args.taskId, after: { title: updated.title, priority: updated.priority, dueDate: updated.dueDate, estimateMinutes: updated.estimateMinutes } }],
        undo: {
          description: `Revert edits to task ${args.taskId}.`,
          revert: async () => { await graph.putNode("task", args.taskId, before); },
          plan: [{ op: "put", nodeType: "task", nodeId: args.taskId, data: before }],
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
          // Nothing to restore if the task was already gone — an empty plan
          // would otherwise read as "no undo available" and be refused.
          plan: before
            ? [
                { op: "put", nodeType: "task", nodeId: args.taskId, data: before },
                ...(before.assignedTo
                  ? [{ op: "addEdge" as const, from: before.assignedTo, to: args.taskId, edgeType: "assigned" }]
                  : []),
              ]
            : undefined,
        },
      };
    },
  };
}
