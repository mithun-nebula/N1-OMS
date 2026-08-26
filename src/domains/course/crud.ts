import type { OperationHandler, OperationResult, UndoStep } from "@/spine/operation/registry";
import type { ActorId } from "@/spine/operation/types";
import type { FigureStore } from "@/spine/figures/types";
import type { RecordStore } from "@/spine/record/types";
import { directory } from "@/server/directory";
import { recomputeCompletion, type CourseModule } from "./figures";

/**
 * Course lifecycle (create / assign / delete) — the half the pipeline never
 * had. Courses are managed by manager-and-above; deleting one is admin-level
 * (see `taskRules`/course rules in `server/policy.ts`). Assigning a course
 * hands each assignee their own linked task: the course knows who is working
 * it, and the task board shows each person their share (top-down tasks —
 * employees never create their own).
 */

interface CourseData {
  title: string;
  stage: string;
  stageEnteredAt?: string;
  owner?: string;
  assignees?: ActorId[];
  modules: CourseModule[];
  [key: string]: unknown;
}

export const MAX_COURSE_ASSIGNEES = 3;

let courseSeq = 0;

function slugify(title: string): string {
  const base = title
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40);
  return base || "course";
}

export function courseCreateHandler(
  graph: RecordStore,
  figures: FigureStore,
  owners?: Map<string, ActorId>,
): OperationHandler<{ title: string; modules?: string[]; owner?: ActorId }> {
  return {
    name: "course.create",
    // Writes one course node. Routine: a graduated rule may do it unattended.
    category: "routine",
    validate: (args) =>
      args.title?.trim()
        ? { ok: true }
        : { ok: false, missing: ["title"], detail: "A course title is required." },
    permission: () => ({ action: "create", nodeType: "course" }),
    involvesMoneyOrPeople: () => false,
    execute: async (args, ctx) => {
      courseSeq += 1;
      let id = slugify(args.title);
      if (await graph.getNode("course", id)) id = `${id}-${Date.now().toString(36)}${courseSeq}`;
      const moduleNames = (args.modules ?? []).map((m) => m.trim()).filter(Boolean);
      const owner = args.owner ?? ctx.actor;
      const data: CourseData = {
        title: args.title.trim(),
        stage: "outline",
        stageEnteredAt: ctx.now(),
        owner,
        modules: (moduleNames.length > 0 ? moduleNames : ["Intro"]).map((name) => ({
          name,
          state: "not-started" as const,
        })),
      };
      await graph.putNode("course", id, data);
      owners?.set(`course:${id}`, owner);
      await recomputeCompletion(figures, { id, title: data.title, modules: data.modules });
      const result: OperationResult = {
        changes: [{ nodeType: "course", nodeId: id, after: data }],
        undo: {
          description: `Remove course "${data.title}".`,
          revert: async () => {
            await graph.removeNode("course", id);
            owners?.delete(`course:${id}`);
          },
          plan: [{ op: "remove", nodeType: "course", nodeId: id }],
        },
        publishedTo: owner !== ctx.actor ? [{ kind: "actor", actor: owner }] : [],
        response: { courseId: id },
      };
      return result;
    },
  };
}

export function courseAssignHandler(
  graph: RecordStore,
  owners?: Map<string, ActorId>,
): OperationHandler<{ courseId: string; assignees: ActorId[] }> {
  return {
    name: "course.assign",
    // Hands real work to up to three people and notifies each, so a delegated
    // run always parks — "people" is in NEVER_GRADUATE (`gate/autonomy.ts`),
    // which is the SECOND of gate.ts's two parking conditions (`:99`).
    //
    // `involvesMoneyOrPeople` stays false, but NOT for the reason this comment
    // used to give ("a manager assigning by hand needs no second tap"). That
    // reason is wrong: BOTH parking conditions require `delegated`, so a hand
    // form never parks whatever this flag says. Proved in
    // `spine/gate/parking-audit.test.ts`.
    //
    // ⚠ The flag and the category are not interchangeable, and an agent must
    // check BOTH — `spine/operation/declarations.test.ts` pins every one.
    category: "people",
    validate: (args) => {
      const missing: string[] = [];
      if (!args.courseId) missing.push("courseId");
      const assignees = args.assignees ?? [];
      if (assignees.length === 0) missing.push("assignees");
      if (missing.length > 0) {
        return { ok: false, missing, detail: "A course id and at least one assignee are required." };
      }
      if (assignees.length > MAX_COURSE_ASSIGNEES) {
        return {
          ok: false,
          missing: [],
          detail: `A course is worked by at most ${MAX_COURSE_ASSIGNEES} people at once.`,
        };
      }
      if (new Set(assignees).size !== assignees.length) {
        return { ok: false, missing: [], detail: "The same person is listed twice." };
      }
      const unknown = assignees.filter((a) => !directory().isActive(a));
      if (unknown.length > 0) {
        return { ok: false, missing: [], detail: `Not active people: ${unknown.join(", ")}.` };
      }
      return { ok: true };
    },
    // The whole truth: the course gains its assignees AND a task is written
    // per assignee — both declared, so the conformance harness stays quiet
    // and the gate keeps this manager-shaped (task create is manager+).
    permission: (args) => [
      { action: "edit", nodeType: "course", recordNodeIds: [args.courseId] },
      { action: "create", nodeType: "task" },
    ],
    involvesMoneyOrPeople: () => false,
    execute: async (args, ctx) => {
      const node = await graph.getNode("course", args.courseId);
      const before = node?.data as CourseData | undefined;
      if (!before) throw new Error(`No course ${args.courseId}.`);

      await graph.patchNode("course", args.courseId, { assignees: args.assignees });

      const taskIds: string[] = [];
      for (const assignee of args.assignees) {
        courseSeq += 1;
        const taskId = `task_${Date.now().toString(36)}_c${courseSeq}`;
        await graph.putNode("task", taskId, {
          title: `Work on ${before.title}`,
          assignedTo: assignee,
          status: "todo",
          priority: "medium",
          courseId: args.courseId,
          createdBy: ctx.actor,
        });
        owners?.set(`task:${taskId}`, assignee);
        await graph.addEdge({ from: assignee, to: taskId, type: "assigned" });
        taskIds.push(taskId);
      }

      const undoPlan: UndoStep[] = [
        ...taskIds.flatMap((taskId, i) => [
          { op: "removeEdge" as const, from: args.assignees[i], to: taskId, edgeType: "assigned" },
          { op: "remove" as const, nodeType: "task", nodeId: taskId },
        ]),
        { op: "put" as const, nodeType: "course", nodeId: args.courseId, data: before },
      ];

      const result: OperationResult = {
        changes: [
          {
            nodeType: "course",
            nodeId: args.courseId,
            before: { assignees: before.assignees },
            after: { assignees: args.assignees },
          },
          ...taskIds.map((taskId, i) => ({
            nodeType: "task",
            nodeId: taskId,
            after: { title: `Work on ${before.title}`, assignedTo: args.assignees[i] },
          })),
        ],
        undo: {
          description: `Unassign "${before.title}" and remove the ${taskIds.length} linked task(s).`,
          revert: async () => {
            for (let i = 0; i < taskIds.length; i += 1) {
              await graph.removeEdge(args.assignees[i], taskIds[i], "assigned");
              await graph.removeNode("task", taskIds[i]);
              owners?.delete(`task:${taskIds[i]}`);
            }
            await graph.putNode("course", args.courseId, before);
          },
          plan: undoPlan,
        },
        publishedTo: args.assignees.map((actor) => ({
          kind: "actor" as const,
          actor,
          message: `You were assigned to work on "${before.title}".`,
        })),
        response: { courseId: args.courseId, taskIds },
      };
      return result;
    },
  };
}

export function courseDeleteHandler(
  graph: RecordStore,
  owners?: Map<string, ActorId>,
): OperationHandler<{ courseId: string }> {
  return {
    name: "course.delete",
    // Removes one course node; linked tasks are left alone. Routine.
    category: "routine",
    validate: (args) =>
      args.courseId
        ? { ok: true }
        : { ok: false, missing: ["courseId"], detail: "A course id is required." },
    permission: (args) => ({ action: "delete", nodeType: "course", recordNodeIds: [args.courseId] }),
    involvesMoneyOrPeople: () => false,
    execute: async (args) => {
      const node = await graph.getNode("course", args.courseId);
      const before = node?.data as CourseData | undefined;
      if (!before) throw new Error(`No course ${args.courseId}.`);
      // Versions and any linked tasks stay — history is immutable, and work
      // already handed to people is not silently taken back by a delete.
      await graph.removeNode("course", args.courseId);
      owners?.delete(`course:${args.courseId}`);
      const result: OperationResult = {
        changes: [{ nodeType: "course", nodeId: args.courseId, before }],
        undo: {
          description: `Restore course "${before.title}".`,
          revert: async () => {
            await graph.putNode("course", args.courseId, before);
            if (before.owner) owners?.set(`course:${args.courseId}`, before.owner);
          },
          plan: [{ op: "put", nodeType: "course", nodeId: args.courseId, data: before }],
        },
      };
      return result;
    },
  };
}
