import type { OperationHandler, OperationResult } from "@/spine/operation/registry";
import type { ActorId } from "@/spine/operation/types";

export function announcementSendHandler(): OperationHandler<{
  message: string;
  to: ActorId[];
}> {
  return {
    name: "announcement.send",
    validate: (args) => {
      const missing: string[] = [];
      if (!args.message) missing.push("message");
      if (!args.to || args.to.length === 0) missing.push("to");
      return missing.length === 0
        ? { ok: true }
        : {
            ok: false,
            missing,
            detail: "A message and at least one recipient are required.",
          };
    },
    permission: () => ({ action: "view", nodeType: "course" }),
    involvesMoneyOrPeople: () => false,
    execute: (args) => {
      const result: OperationResult = {
        changes: [],
        publishedTo: args.to.map((actor) => ({ kind: "actor" as const, actor })),
        response: { sentTo: args.to.length },
      };
      return result;
    },
  };
}
