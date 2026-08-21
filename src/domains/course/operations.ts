import type { OperationHandler, OperationResult } from "@/spine/operation/registry";
import type { FigureStore } from "@/spine/figures/types";
import type { RecordStore } from "@/spine/record/types";
import { isValidTransition, nextStages, normalizeStage } from "./stages";
import { getVersion, snapshotCourse } from "./versioning";
import { recomputeCompletion, type CourseModule } from "./figures";

interface CourseData {
  title: string;
  stage: string;
  stageEnteredAt?: string;
  owner?: string;
  stageOwners?: Record<string, string>;
  progressNote?: { text: string; at: string; by: string };
  modules: CourseModule[];
  [key: string]: unknown;
}

async function readCourse(graph: RecordStore, courseId: string): Promise<CourseData | undefined> {
  const node = await graph.getNode("course", courseId);
  return node ? (node.data as CourseData) : undefined;
}

export function courseUpdateStageHandler(
  graph: RecordStore,
  figures: FigureStore,
): OperationHandler<{ courseId: string; stage: string }> {
  return {
    name: "course.updateStage",
    validate: async (args) => {
      const missing: string[] = [];
      if (!args.courseId) missing.push("courseId");
      const stage = normalizeStage(args.stage ?? "");
      if (!stage) missing.push("stage");
      if (missing.length > 0) {
        return { ok: false, missing, detail: "A course id and a stage are required." };
      }
      const current = await readCourse(graph, args.courseId);
      const from = current ? normalizeStage(current.stage) : "";
      if (from && !isValidTransition(from, stage)) {
        return {
          ok: false,
          missing: [],
          detail: `Cannot move "${args.courseId}" from ${from} to ${stage}. Valid next stages: ${nextStages(from).join(", ") || "(none)"}.`,
        };
      }
      return { ok: true };
    },
    // Editing the course also snapshots it — the version write is part of
    // what the gate is asked about, not a side effect it never hears of.
    permission: (args) => [
      {
        action: "edit",
        nodeType: "course",
        recordNodeIds: [args.courseId],
      },
      { action: "create", nodeType: "course-version" },
    ],
    involvesMoneyOrPeople: () => false,
    execute: async (args, ctx) => {
      const before = await readCourse(graph, args.courseId);
      const beforeStage = before?.stage;
      const stage = normalizeStage(args.stage);
      await graph.patchNode("course", args.courseId, {
        stage,
        stageEnteredAt: ctx.now(),
      });
      await snapshotCourse(graph, args.courseId, ctx.actor, `stage → ${stage}`);
      // Only `course.setModuleState` recomputed the figure, so a course that
      // moved through the pipeline without a module ever being touched showed
      // no completion at all — and any figure it did have kept a `computedAt`
      // from whenever a module last changed.
      if (before) {
        await recomputeCompletion(figures, {
          id: args.courseId,
          title: before.title,
          modules: before.modules ?? [],
        });
      }
      const result: OperationResult = {
        changes: [
          {
            nodeType: "course",
            nodeId: args.courseId,
            before: { stage: beforeStage },
            after: { stage, stageEnteredAt: ctx.now() },
          },
        ],
        undo: {
          description: `Restore course stage to "${beforeStage}".`,
          revert: async () => {
            if (before) await graph.putNode("course", args.courseId, before);
          },
          plan: before
            ? [{ op: "put", nodeType: "course", nodeId: args.courseId, data: before }]
            : undefined,
        },
        publishedTo: [{ kind: "record", nodeType: "course", nodeId: args.courseId }],
      };
      return result;
    },
  };
}

export function courseSetModuleStateHandler(
  graph: RecordStore,
  figures: FigureStore,
): OperationHandler<{ courseId: string; moduleIndex: number; state: string }> {
  return {
    name: "course.setModuleState",
    validate: (args) => {
      const missing: string[] = [];
      if (!args.courseId) missing.push("courseId");
      if (args.moduleIndex === undefined || args.moduleIndex === null) missing.push("moduleIndex");
      if (!args.state) missing.push("state");
      return missing.length === 0
        ? { ok: true }
        : { ok: false, missing, detail: "courseId, moduleIndex and state are required." };
    },
    // Editing the course also snapshots it — the version write is part of
    // what the gate is asked about, not a side effect it never hears of.
    permission: (args) => [
      {
        action: "edit",
        nodeType: "course",
        recordNodeIds: [args.courseId],
      },
      { action: "create", nodeType: "course-version" },
    ],
    involvesMoneyOrPeople: () => false,
    execute: async (args, ctx) => {
      const before = await readCourse(graph, args.courseId);
      if (!before) throw new Error(`No course ${args.courseId}`);
      const modules = before.modules.map((m, i) =>
        i === args.moduleIndex ? { ...m, state: args.state } : m,
      );
      const updated: CourseData = { ...before, modules };
      await graph.putNode("course", args.courseId, updated);
      const figure = await recomputeCompletion(figures, {
        id: args.courseId,
        title: before.title,
        modules,
      });
      await snapshotCourse(graph, args.courseId, ctx.actor, `module[${args.moduleIndex}] → ${args.state}`);
      const result: OperationResult = {
        changes: [
          {
            nodeType: "course",
            nodeId: args.courseId,
            after: { moduleIndex: args.moduleIndex, state: args.state },
          },
        ],
        undo: {
          description: `Restore module ${args.moduleIndex} state.`,
          revert: async () => {
            await graph.putNode("course", args.courseId, before);
            await recomputeCompletion(figures, {
              id: args.courseId,
              title: before.title,
              modules: before.modules,
            });
          },
          // The record goes back; the figure is recomputed from it on the next
          // module change or stage move. A plan cannot call `recomputeCompletion`,
          // so the closure stays the richer path while the process lives.
          plan: [{ op: "put", nodeType: "course", nodeId: args.courseId, data: before }],
        },
        publishedTo: [{ kind: "record", nodeType: "course", nodeId: args.courseId }],
        response: { completion: figure.value },
      };
      return result;
    },
  };
}

export function courseSetProgressNoteHandler(
  graph: RecordStore,
): OperationHandler<{ courseId: string; note: string }> {
  return {
    name: "course.setProgressNote",
    validate: (args) => {
      const missing: string[] = [];
      if (!args.courseId) missing.push("courseId");
      if (!args.note) missing.push("note");
      return missing.length === 0
        ? { ok: true }
        : { ok: false, missing, detail: "courseId and note are required." };
    },
    // Editing the course also snapshots it — the version write is part of
    // what the gate is asked about, not a side effect it never hears of.
    permission: (args) => [
      {
        action: "edit",
        nodeType: "course",
        recordNodeIds: [args.courseId],
      },
      { action: "create", nodeType: "course-version" },
    ],
    involvesMoneyOrPeople: () => false,
    execute: async (args, ctx) => {
      const before = await readCourse(graph, args.courseId);
      const previousNote = (before as { progressNote?: unknown } | undefined)?.progressNote;
      await graph.patchNode("course", args.courseId, {
        progressNote: { text: args.note, at: ctx.now(), by: ctx.actor },
      });
      return {
        changes: [
          {
            nodeType: "course",
            nodeId: args.courseId,
            after: { progressNote: args.note },
          },
        ],
        undo: {
          description: `Restore the previous progress note on ${args.courseId}.`,
          revert: async () => {
            await graph.patchNode("course", args.courseId, { progressNote: previousNote });
          },
          // `put` of the whole record, not a `patch` of the one field. The plan
          // is persisted as JSONB, and `JSON.stringify({progressNote: undefined})`
          // is `{}` — so on the *first* note a course ever received, the patch
          // replayed as a no-op and the note could not be undone after a restart.
          plan: before
            ? [{ op: "put", nodeType: "course", nodeId: args.courseId, data: before }]
            : undefined,
        },
        publishedTo: [{ kind: "record", nodeType: "course", nodeId: args.courseId }],
      };
    },
  };
}

export function courseAssignStageOwnerHandler(
  graph: RecordStore,
): OperationHandler<{ courseId: string; stage: string; owner: string }> {
  return {
    name: "course.assignStageOwner",
    validate: (args) => {
      const missing: string[] = [];
      if (!args.courseId) missing.push("courseId");
      if (!args.stage) missing.push("stage");
      if (!args.owner) missing.push("owner");
      return missing.length === 0
        ? { ok: true }
        : { ok: false, missing, detail: "courseId, stage and owner are required." };
    },
    // Editing the course also snapshots it — the version write is part of
    // what the gate is asked about, not a side effect it never hears of.
    permission: (args) => [
      {
        action: "edit",
        nodeType: "course",
        recordNodeIds: [args.courseId],
      },
      { action: "create", nodeType: "course-version" },
    ],
    involvesMoneyOrPeople: () => false,
    execute: async (args) => {
      const before = await readCourse(graph, args.courseId);
      const previousOwners = { ...(before?.stageOwners ?? {}) };
      const stageOwners = { ...previousOwners, [normalizeStage(args.stage)]: args.owner };
      await graph.patchNode("course", args.courseId, { stageOwners });
      return {
        changes: [
          {
            nodeType: "course",
            nodeId: args.courseId,
            after: { stageOwner: { stage: args.stage, owner: args.owner } },
          },
        ],
        undo: {
          description: `Put the ${args.stage} owner on ${args.courseId} back as it was.`,
          revert: async () => {
            await graph.patchNode("course", args.courseId, { stageOwners: previousOwners });
          },
          plan: [
            {
              op: "patch",
              nodeType: "course",
              nodeId: args.courseId,
              data: { stageOwners: previousOwners },
            },
          ],
        },
        publishedTo: [{ kind: "actor", actor: args.owner }],
      };
    },
  };
}

export function courseRestoreVersionHandler(
  graph: RecordStore,
  figures: FigureStore,
): OperationHandler<{ courseId: string; version: number }> {
  return {
    name: "course.restoreVersion",
    validate: (args) => {
      const missing: string[] = [];
      if (!args.courseId) missing.push("courseId");
      if (args.version === undefined || args.version === null) missing.push("version");
      return missing.length === 0
        ? { ok: true }
        : { ok: false, missing, detail: "courseId and version are required." };
    },
    permission: (args) => ({
      action: "approve",
      nodeType: "course",
      recordNodeIds: [args.courseId],
    }),
    involvesMoneyOrPeople: () => false,
    execute: async (args, ctx) => {
      const target = await getVersion(graph, args.courseId, args.version);
      if (!target) {
        throw new Error(`No version ${args.version} for ${args.courseId}`);
      }
      const before = await readCourse(graph, args.courseId);
      const restored = { ...target.snapshot } as CourseData;
      await graph.putNode("course", args.courseId, restored);
      await snapshotCourse(graph, args.courseId, ctx.actor, `restored v${args.version}`);
      // A restore replaces the whole record, modules included, so the
      // completion figure describes a version that is no longer there. Nothing
      // recomputed it, and the stale percentage stayed on screen.
      await recomputeCompletion(figures, {
        id: args.courseId,
        title: restored.title ?? args.courseId,
        modules: restored.modules ?? [],
      });
      return {
        changes: [
          {
            nodeType: "course",
            nodeId: args.courseId,
            before: { stage: before?.stage },
            after: { stage: (target.snapshot as { stage?: string }).stage, restoredFrom: args.version },
          },
        ],
        undo: {
          description: `Undo restore of ${args.courseId} from v${args.version}.`,
          revert: async () => {
            if (!before) return;
            await graph.putNode("course", args.courseId, before);
            await recomputeCompletion(figures, {
              id: args.courseId,
              title: before.title,
              modules: before.modules ?? [],
            });
          },
          // This one matters most: a restore replaces the entire record, it is
          // offered from `/courses`, and without a plan it became irreversible
          // the moment the process restarted.
          plan: before
            ? [{ op: "put", nodeType: "course", nodeId: args.courseId, data: before }]
            : undefined,
        },
        publishedTo: [{ kind: "record", nodeType: "course", nodeId: args.courseId }],
      };
    },
  };
}
