import type { OperationHandler, OperationResult } from "@/spine/operation/registry";
import type { RecordStore } from "@/spine/record/types";

export function courseUpdateStageHandler(
  graph: RecordStore,
): OperationHandler<{ courseId: string; stage: string }> {
  return {
    name: "course.updateStage",
    validate: (args) => {
      const missing: string[] = [];
      if (!args.courseId) missing.push("courseId");
      if (!args.stage) missing.push("stage");
      return missing.length === 0
        ? { ok: true }
        : { ok: false, missing, detail: "A course id and a stage are required." };
    },
    permission: (args) => ({
      action: "edit",
      nodeType: "course",
      recordNodeIds: [args.courseId],
    }),
    involvesMoneyOrPeople: () => false,
    execute: (args) => {
      const before = graph.getNode("course", args.courseId)?.data;
      const beforeStage = (before as { stage?: string } | undefined)?.stage;
      graph.patchNode("course", args.courseId, { stage: args.stage });
      const result: OperationResult = {
        changes: [
          {
            nodeType: "course",
            nodeId: args.courseId,
            before: { stage: beforeStage },
            after: { stage: args.stage },
          },
        ],
        undo: {
          description: `Restore course stage to "${beforeStage}".`,
          revert: () => {
            if (beforeStage !== undefined) {
              graph.patchNode("course", args.courseId, { stage: beforeStage });
            }
          },
        },
        publishedTo: [
          { kind: "record", nodeType: "course", nodeId: args.courseId },
        ],
      };
      return result;
    },
  };
}
