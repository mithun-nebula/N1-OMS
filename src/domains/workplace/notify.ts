import type { OperationHandler, OperationResult } from "@/spine/operation/registry";
import type { ActorId } from "@/spine/operation/types";

/**
 * Announcements were replaced by the messaging system; what remained of them
 * is this: a way for a person — or an autonomy rule acting for one — to put
 * a line into someone's notification bell. It writes no records at all, so
 * the conformance harness has nothing to check; the gate still authorises it
 * (create on the `notification` pseudo-type, granted to every role).
 */
export function notifySendHandler(): OperationHandler<{ message: string; to: ActorId[] }> {
  return {
    name: "notify.send",
    validate: (args) => {
      const missing: string[] = [];
      if (!args.message) missing.push("message");
      if (!args.to || args.to.length === 0) missing.push("to");
      return missing.length === 0
        ? { ok: true }
        : { ok: false, missing, detail: "A message and at least one recipient are required." };
    },
    permission: () => ({ action: "create", nodeType: "notification" }),
    involvesMoneyOrPeople: () => false,
    execute: async (args) => {
      const result: OperationResult = {
        changes: [],
        // The notification IS the message — no fallback summary would carry it.
        publishedTo: args.to.map((actor) => ({ kind: "actor" as const, actor, message: args.message })),
        response: { sentTo: args.to.length },
      };
      return result;
    },
  };
}
