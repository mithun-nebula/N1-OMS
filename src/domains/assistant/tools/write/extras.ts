import { tool } from "ai";
import { z } from "zod";
import * as adapters from "@/spine/adapters";
import { dmConversationId } from "@/domains/messaging/store";
import type { ToolSpec } from "../catalogue";
import { requireConfirmation } from "../confirmation";
import { proposeInstead, wouldPark } from "../propose";

/**
 * The two write tools that are not one of the fifty-six operations.
 *
 * They go through different doors — `/api/messages` and `Spine.undo` — so they
 * cannot use `buildWriteTool`, which submits through `Spine.submit`. Everything
 * else about them is held to the same line: loud refusals, and `undo_last`
 * inherits the gating of whatever it is undoing.
 */

function refused(reason: string, tellThem: string, extra: Record<string, unknown> = {}) {
  return {
    ok: false,
    didNotHappen: true,
    reason,
    tellThem: `This did NOT happen: ${reason} ${tellThem}`,
    ...extra,
  };
}

export const sendMessage: ToolSpec = {
  name: "send_message",
  build: (ctx) =>
    tool({
      description: [
        "This tool does NOT put a line in somebody's notifications — that is notify_people, which is one-way and cannot be replied to. It also does not email anybody outside the organisation.",
        "",
        "Send a direct message to one person, in the chat they can reply in.",
        'Use for "tell Priya I am running late", "message Arun about the review".',
        "",
        "It writes no record and cannot be un-sent. Only send what they actually asked you to send, in their words rather than yours.",
      ].join("\n"),
      inputSchema: z.object({
        to: z.string().describe("The employee id, from find_people."),
        text: z.string().describe("What to say, in their words."),
      }),
      execute: async ({ to, text }) => {
        const store = ctx.deps.messages;
        if (!store) {
          return refused(
            "Messaging is not available.",
            "Say so plainly rather than describing it as sent.",
          );
        }
        const body = text.trim();
        if (!body) {
          return refused("There was nothing to send.", "Ask them what they want to say.");
        }
        if (to === ctx.actor) {
          return refused(
            "That is a message to themselves.",
            "Ask who it should actually go to.",
          );
        }
        const conversation = dmConversationId(ctx.actor, to);
        await store.load(ctx.actor, [conversation]);
        const message = store.append(conversation, ctx.actor, body, new Date().toISOString());
        return { ok: true, sentTo: to, at: message.at };
      },
    }),
};

/**
 * Undo the last thing — inheriting whatever gating the original had.
 *
 * ── The back door this closes ───────────────────────────────────────────────
 *
 * `Spine.undo` is permission-checked and has been since Phase 0 — `mayUndo`
 * requires the ability to edit every record the original touched, because
 * *"combined with an activity log readable by anyone, that was: find the pay
 * change, reverse it."*
 *
 * **But undo does not pass through `involvesMoneyOrPeople`.** So an agent
 * calling this on a `leave.approve` entry would un-approve somebody's leave
 * with no proposal at all — reaching, by the back door, exactly what the
 * propose-gate exists to prevent.
 *
 * ⚠ **Undoing a money or people operation is itself a money or people action.**
 * So this tool reads the activity entry, looks up the operation it recorded,
 * and takes that operation's tier as its own. `Spine.undo` is unmodified: the
 * gating lives here, exactly as it does for every other write, and the spine
 * keeps its own permission check underneath.
 */
export const undoLast: ToolSpec = {
  name: "undo_last",
  build: (ctx) =>
    tool({
      description: [
        "This tool does NOT restore an earlier version of a course — that is restore_course_version. It also does not cancel a meeting or delete a task; it REVERSES one recorded action.",
        "",
        "Undo something that was done.",
        'Use for "undo that", "put that back", "I did not mean to do that".',
        "",
        "It takes the activity id, which the tool that made the change returned. If you do not have one, say so and ask what they want undone — never guess at an id.",
        "IF THE ORIGINAL AFFECTED MONEY OR ANOTHER PERSON, undoing it does too: this will PREPARE the undo and not do it, and it needs their approval like any other.",
      ].join("\n"),
      inputSchema: z.object({
        activityId: z
          .string()
          .describe("The activity id the earlier tool returned. Never invent one."),
      }),
      execute: async ({ activityId }) => {
        const entry = await ctx.deps.spine.activityEntry(activityId);
        if (!entry) {
          return refused(
            "There is no recorded action with that id.",
            "Ask them what they want undone rather than guessing.",
          );
        }
        if (!entry.undoDescription) {
          // Six of the operations with no undo are money/people, so this is
          // reachable. Say what it is, or it reads as a permission problem.
          return refused(
            `${entry.operationName} cannot be undone — it never recorded a way back.`,
            "Say that plainly. It is not that they lack permission; there is nothing to reverse.",
          );
        }

        const handler = ctx.deps.spine.operationHandler(entry.operationName);
        // ⚠ The inheritance. No handler means no way to know what it touched,
        // so it is treated as if it were the strictest case.
        if (!handler || wouldPark(handler, {})) {
          return await proposeInstead({
            actor: ctx.actor,
            opName: "undo",
            args: { activityId },
            summary: `undo ${entry.operationName} (${entry.undoDescription})`,
            turnId: ctx.turnId,
          });
        }

        // Not money or people, but still a reversal of something real, so it
        // reads back — the same gate the destructive verbs use, not a second one.
        const gate = requireConfirmation({
          actor: ctx.actor,
          tool: "undo_last",
          target: activityId,
          turnId: ctx.turnId,
          conversation: ctx.conversationId,
          consequence: `Undoing this reverses ${entry.operationName}: ${entry.undoDescription}`,
          tellThem: "Say what will be reversed, ask them, then STOP and wait for their reply.",
        });
        if (!gate.act) return gate.result;

        const outcome = await ctx.deps.spine.undo(activityId, ctx.actor);
        if (outcome.status !== "undone") {
          return refused(
            outcome.detail ?? "It could not be undone.",
            "Say so plainly rather than describing it as reversed.",
          );
        }
        return { ok: true, undone: entry.operationName, activityId };
      },
    }),
};

export const extraWriteTools: ToolSpec[] = [sendMessage, undoLast];

/** Kept for `adapters` to stay imported where a future extra needs it. */
void adapters;
