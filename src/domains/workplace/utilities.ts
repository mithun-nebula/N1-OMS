import type { OperationHandler } from "@/spine/operation/registry";
import type { RecordStore } from "@/spine/record/types";
import type { QuestionLimiter } from "./shared/limiter";

interface UtilityCaptureData {
  subject: string;
  detail: string;
  from?: string;
  to?: string;
  by: string;
  at: string;
  [key: string]: unknown;
}

export function utilityCaptureHandler(
  graph: RecordStore,
  limiter: QuestionLimiter,
): OperationHandler<{ subject: string; detail: string; from?: string; to?: string }> {
  return {
    name: "utility.capture",
    validate: (args) => {
      const missing: string[] = [];
      if (!args.subject) missing.push("subject");
      if (!args.detail) missing.push("detail");
      return missing.length === 0 ? { ok: true } : { ok: false, missing, detail: "subject and detail are required." };
    },
    permission: () => ({ action: "create", nodeType: "utility-capture" }),
    involvesMoneyOrPeople: () => false,
    execute: (args, ctx) => {
      if (!limiter.tryConsume(ctx.actor, ctx.now().slice(0, 10))) {
        return {
          changes: [],
          publishedTo: [],
          response: { captured: false, reason: "Two-questions-per-day limit reached." },
        };
      }
      const id = `util_${Date.now().toString(36)}`;
      const data: UtilityCaptureData = {
        subject: args.subject,
        detail: args.detail,
        from: args.from,
        to: args.to,
        by: ctx.actor,
        at: ctx.now(),
      };
      graph.putNode("utility-capture", id, data);
      return {
        changes: [{ nodeType: "utility-capture", nodeId: id, after: data }],
        publishedTo: [{ kind: "broadcast" }],
        response: { captured: true, id },
      };
    },
  };
}
