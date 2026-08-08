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

function readCourse(graph: RecordStore, courseId: string): CourseData | undefined {
  const node = graph.getNode("course", courseId);
  return node ? (node.data as CourseData) : undefined;
}

export function courseUpdateStageHandler(
  graph: RecordStore,
): OperationHandler<{ courseId: string; stage: string }> {
  return {
    name: "course.updateStage",
    validate: (args) => {
      const missing: string[] = [];
      if (!args.courseId) missing.push("courseId");
      const stage = normalizeStage(args.stage ?? "");
      if (!stage) missing.push("stage");
      if (missing.length > 0) {
        return { ok: false, missing, detail: "A course id and a stage are required." };
      }
      const current = readCourse(graph, args.courseId);
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
    permission: (args) => ({
      action: "edit",
      nodeType: "course",
      recordNodeIds: [args.courseId],
    }),
    involvesMoneyOrPeople: () => false,
    execute: (args, ctx) => {
      const before = readCourse(graph, args.courseId);
      const beforeStage = before?.stage;
      const stage = normalizeStage(args.stage);
      graph.patchNode("course", args.courseId, {
        stage,
        stageEnteredAt: ctx.now(),
      });
      snapshotCourse(graph, args.courseId, ctx.actor, `stage → ${stage}`);
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
          revert: () => {
            if (before) graph.putNode("course", args.courseId, before);
          },
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
    permission: (args) => ({
      action: "edit",
      nodeType: "course",
      recordNodeIds: [args.courseId],
    }),
    involvesMoneyOrPeople: () => false,
    execute: (args, ctx) => {
      const before = readCourse(graph, args.courseId);
      if (!before) throw new Error(`No course ${args.courseId}`);
      const modules = before.modules.map((m, i) =>
        i === args.moduleIndex ? { ...m, state: args.state } : m,
      );
      const updated: CourseData = { ...before, modules };
      graph.putNode("course", args.courseId, updated);
      const figure = recomputeCompletion(figures, {
        id: args.courseId,
        title: before.title,
        modules,
      });
      snapshotCourse(graph, args.courseId, ctx.actor, `module[${args.moduleIndex}] → ${args.state}`);
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
          revert: () => {
            graph.putNode("course", args.courseId, before);
            recomputeCompletion(figures, {
              id: args.courseId,
              title: before.title,
              modules: before.modules,
            });
          },
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
    permission: (args) => ({
      action: "edit",
      nodeType: "course",
      recordNodeIds: [args.courseId],
    }),
    involvesMoneyOrPeople: () => false,
    execute: (args, ctx) => {
      graph.patchNode("course", args.courseId, {
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
    permission: (args) => ({
      action: "edit",
      nodeType: "course",
      recordNodeIds: [args.courseId],
    }),
    involvesMoneyOrPeople: () => false,
    execute: (args) => {
      const before = readCourse(graph, args.courseId);
      const stageOwners = { ...(before?.stageOwners ?? {}), [normalizeStage(args.stage)]: args.owner };
      graph.patchNode("course", args.courseId, { stageOwners });
      return {
        changes: [
          {
            nodeType: "course",
            nodeId: args.courseId,
            after: { stageOwner: { stage: args.stage, owner: args.owner } },
          },
        ],
        publishedTo: [{ kind: "actor", actor: args.owner }],
      };
    },
  };
}

export function courseRestoreVersionHandler(
  graph: RecordStore,
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
    execute: (args, ctx) => {
      const target = getVersion(graph, args.courseId, args.version);
      if (!target) {
        throw new Error(`No version ${args.version} for ${args.courseId}`);
      }
      const before = readCourse(graph, args.courseId);
      graph.putNode("course", args.courseId, { ...target.snapshot });
      snapshotCourse(graph, args.courseId, ctx.actor, `restored v${args.version}`);
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
          revert: () => {
            if (before) graph.putNode("course", args.courseId, before);
          },
        },
        publishedTo: [{ kind: "record", nodeType: "course", nodeId: args.courseId }],
      };
    },
  };
}
