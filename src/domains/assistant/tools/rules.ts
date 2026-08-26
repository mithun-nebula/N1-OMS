import { tool } from "ai";
import { z } from "zod";
import type { ToolSpec } from "./catalogue";
import { authorRule } from "@/domains/autonomy/author";
import { describeSpec } from "@/domains/autonomy/spec";
import { rulesAreStopped, stopAllRules, resumeAllRules } from "@/domains/autonomy/engine";

/**
 * Standing rules, from the assistant.
 *
 * ── Why authoring is a read-back and not a write ────────────────────────────
 *
 * Every other write tool in this catalogue does something once. A rule does
 * something **forever**, and the person confirming it will not be there when it
 * fires. So the shape is deliberately the read-back one from Phase 2.5, used
 * for a different reason:
 *
 * > **You confirm once; it acts a thousand times.** A rule that was right in
 * > March can be wrong in June without changing at all.
 *
 * The first call never saves. It returns the rule **in plain words** and waits.
 * And the read-back has to be specific enough to be wrong in a way a person
 * would catch — *"I'll keep an eye on your courses"* is theatre.
 *
 * ── What it will not do ────────────────────────────────────────────────────
 *
 * A rule may only **notify**. It cannot create, assign, approve or change
 * anything. Phase 3 left that question open deliberately and the answer is no,
 * for now: *"give Arun the review"* typed by you is one thing, a rule handing
 * Arun work every Monday decided by nobody that morning is another.
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

export const authorRuleTool: ToolSpec = {
  name: "author_rule",
  build: (ctx) =>
    tool({
      description: [
        "This tool does NOT answer a question about right now. If they want to know the state of things AT THIS MOMENT, use course_progress, list_tasks, expiring_documents or list_leave instead. THIS sets up something that watches FOREVER.",
        "",
        "Turn a sentence into a standing rule that watches unattended.",
        "",
        "⚠ USE THIS FOR ANY SENTENCE THAT ASKS TO BE TOLD ABOUT THE FUTURE, even a vague one:",
        '  "tell me when…"  "let me know if…"  "watch for…"  "keep an eye on…"',
        '  "give me a shout when…"  "flag it if…"  "from now on…"  "whenever…"',
        "",
        "Call it EVEN IF you think the sentence is too vague to become a rule. It will tell you what it cannot measure and give you the question to ask. Answering a vague future-facing sentence with today's data instead is the wrong move — they asked to be told LATER.",
        "",
        "TWO CALLS. The first NEVER saves: it returns the rule in plain words and a token. Read those exact words back, get a yes, then call again with the token.",
        "A rule can ONLY notify somebody. If they want something created, assigned or approved, say that a rule cannot do it — do not offer a notification as a substitute without saying so.",
        "If the sentence cannot be measured, or could equally be a one-off question, this refuses and gives you the question to ask. Ask it — do not guess.",
      ].join("\n"),
      inputSchema: z.object({
        sentence: z.string().describe("What they said, in their own words. Do not rewrite it."),
        confirmedStanding: z
          .boolean()
          .optional()
          .describe("True only after they have confirmed they meant a standing rule, not a question."),
        confirmationToken: z
          .string()
          .optional()
          .describe("The token the FIRST call gave you, after they agreed to the read-back."),
      }),
      execute: async ({ sentence, confirmedStanding, confirmationToken }) => {
        const engine = ctx.deps.autonomy;
        if (!engine) {
          return refused(
            "Standing rules are not available.",
            "Say so plainly rather than describing the rule as saved.",
          );
        }

        // ⚠ The id comes from WHAT THE RULE WATCHES, not from the wording.
        //
        // It used to be a hash of the sentence, and a live run found what that
        // costs: the person said "yes, that's right", the model re-called this
        // tool and re-typed the sentence slightly differently, the hash changed,
        // the confirmation from the previous turn no longer matched — so a new
        // one was issued and immediately refused by the turn boundary. **The
        // model then said "I have set up the rule" and nothing was saved.**
        //
        // Two phrasings that watch the same thing are the same rule, so keying
        // on the spec makes "yes" work however it is re-typed.
        const draft = await authorRule(sentence, ctx.actor, "pending", { confirmedStanding });
        if (!draft.ok) {
          return refused(draft.reason, draft.ask ?? "Ask them what they meant.", {
            needsAnswer: Boolean(draft.ask),
            ask: draft.ask,
            kind: draft.kind,
          });
        }
        const ruleId = `rule_${ctx.actor}_${Math.abs(
          hash(JSON.stringify({ when: draft.spec.when, do: draft.spec.do })),
        ).toString(36)}`;
        const authored = await authorRule(sentence, ctx.actor, ruleId, { confirmedStanding });

        if (!authored.ok) {
          return refused(authored.reason, authored.ask ?? "Ask them what they meant.", {
            needsAnswer: Boolean(authored.ask),
            ask: authored.ask,
            kind: authored.kind,
          });
        }

        // ⚠ The read-back. The first call never saves — and the token cannot be
        // spent in the turn that issued it, so a person genuinely replied.
        const { requireConfirmation } = await import("./confirmation");
        const gate = requireConfirmation({
          actor: ctx.actor,
          tool: "author_rule",
          target: ruleId,
          turnId: ctx.turnId,
          conversation: ctx.conversationId,
          token: confirmationToken,
          consequence: `This rule will run unattended, from now on: "${authored.readBack}"`,
          tellThem:
            "Read those exact words back to them — not a paraphrase — and ask whether that is right. Then STOP and wait.",
        });
        if (!gate.act) {
          return {
            ...gate.result,
            readBack: authored.readBack,
            // ⚠ Said twice, because a live run found the first saying ignored:
            // the model answered "I have set up the rule. It is now running"
            // when nothing had been saved. A person then believes something is
            // watching for them and nothing is.
            ruleIsNotRunning: true,
            tellThem:
              `NOTHING IS WATCHING YET. Read this back to them word for word — "${authored.readBack}" — ` +
              "ask whether that is right, and then STOP. Do NOT say the rule is set up, saved, running or active. " +
              "When they agree, call author_rule again with the SAME sentence and no token.",
          };
        }

        engine.registerRule(authored.spec);
        ctx.note("autonomy-rule", ruleId);
        return {
          ok: true,
          ruleId,
          reads: describeSpec(authored.spec),
          // A new rule PROPOSES until it has earned the right to act alone.
          note: "It starts supervised: it will prepare each notification for approval, and only acts on its own after ten clean approvals.",
        };
      },
    }),
};

export const listRulesTool: ToolSpec = {
  name: "list_rules",
  build: (ctx) =>
    tool({
      description: [
        "This tool does NOT list tasks, meetings or reminders — those are list_tasks, list_meetings and my_commitments. It lists STANDING RULES that watch unattended.",
        "",
        "What rules are running, what each one watches, and whether it acts alone yet.",
        'Use for "what rules do I have", "what are you watching for me", "why did I get that notification".',
        "",
        "Returns, per rule: its id, what it watches in plain words, whether it is supervised or acting alone, and how many clean approvals it has.",
      ].join("\n"),
      inputSchema: z.object({}),
      execute: async () => {
        const engine = ctx.deps.autonomy;
        if (!engine) return { found: false, note: "Standing rules are not available." };
        const rules = engine.listRules().filter((r) => r.author === ctx.actor);
        for (const r of rules) ctx.note("autonomy-rule", r.ruleId);
        return {
          found: rules.length > 0,
          allRulesStopped: rulesAreStopped(),
          note:
            rules.length === 0
              ? "They have no standing rules."
              : rulesAreStopped()
                ? "EVERY rule is currently stopped. Say so — none of these are watching."
                : undefined,
          items: rules.map((r) => ({
            id: r.ruleId,
            reads: r.reads,
            saidAs: r.plainLanguage,
            status: r.status,
            cleanApprovals: r.cleanCount,
            actsAlone: r.status === "graduated",
            suspendedReason: r.suspendedReason,
          })),
        };
      },
    }),
};

export const stopAllRulesTool: ToolSpec = {
  name: "stop_all_rules",
  build: (ctx) =>
    tool({
      description: [
        "This tool does NOT delete any rule and does NOT undo anything a rule already did — for that use undo_last. It stops ALL rules from firing, at once.",
        "",
        "Stop every standing rule, or start them again.",
        'Use for "stop all the rules", "turn the alerts off", "something is going wrong, stop everything".',
        "",
        "This is deliberately not per-rule: it is the thing to reach for BEFORE anybody knows which rule is misbehaving. Nothing is lost — the rules are still there and can be started again.",
      ].join("\n"),
      inputSchema: z.object({
        resume: z.boolean().optional().describe("True to start them again."),
      }),
      execute: async ({ resume }) => {
        if (!ctx.deps.autonomy) {
          return refused("Standing rules are not available.", "Say so plainly.");
        }
        if (resume) {
          resumeAllRules();
          return { ok: true, rulesStopped: false, note: "Every rule is watching again." };
        }
        stopAllRules();
        return {
          ok: true,
          rulesStopped: true,
          note: "Every standing rule is stopped. None will fire until they are started again.",
        };
      },
    }),
};

/** Stable id from the sentence, so re-authoring the same rule replaces it. */
function hash(text: string): number {
  let h = 0;
  for (let i = 0; i < text.length; i += 1) {
    h = (Math.imul(31, h) + text.charCodeAt(i)) | 0;
  }
  return h;
}

export const ruleTools: ToolSpec[] = [authorRuleTool, listRulesTool, stopAllRulesTool];
