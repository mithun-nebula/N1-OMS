import type { Tool, ToolSet } from "ai";
import { z } from "zod";
import type { ToolContext } from "@/domains/assistant/tools/context";
import { toolNames } from "@/domains/assistant/tools/catalogue";
import { proposalStore } from "@/domains/assistant/tools/propose";
import { emitChange } from "@/server/live";

/**
 * The live model's tool call, turned into this project's tool call, and back.
 *
 *     frame in    { name, args, callId }
 *     ->          look the tool up in the SAME catalogue chat uses
 *     ->          execute it with the SAME ToolContext, bound to the session's actor
 *     ->          frame out  { callId, result }
 *
 * ── ⚠ THREE RULES, AND THEY ARE THE WHOLE FILE ──────────────────────────────
 *
 * **1 · The actor comes from the session, never from a frame.** It was bound at
 * upgrade time from the session cookie, and it lives in the `ToolContext`
 * closure — there is no parameter to overwrite. This is the same rule
 * `context.ts` already enforces for chat, and it matters MORE here, because
 * these frames are shaped by a model rather than by our own code. Note what is
 * absent below: nothing reads an actor, a role or a person id off the incoming
 * frame, so there is nothing to validate and nothing to forget to validate.
 *
 * **2 · Tool results are data, never instruction.** Untouched: every tool in
 * the catalogue is already wrapped by `wrapUntrusted` in `catalogue.ts`, which
 * returns `{ untrusted_record_data, note }`. The live model is given the same
 * warning in its system instruction that the chat model gets. A leave reason
 * somebody typed is untrusted text whether it is read out loud or printed.
 *
 * **3 · One tool at a time per session, in order.** Enforced in `relay.ts` by a
 * promise chain, because that is where the frames arrive.
 *
 * ── What is NOT here ────────────────────────────────────────────────────────
 *
 * No permission checking, no gate, no propose logic. `room.book` by voice goes
 * through the same `Spine.submit`, the same gate, the same permission policy
 * and the same activity log as chat, because it goes through the same tool.
 * **Voice gets no path of its own to anything.** An intern cannot approve leave
 * by voice — not because this file checks, but because the tool refuses.
 */

/**
 * ⚠ **`approve_proposal` IS NOT IN THE LIVE TOOL SET.**
 *
 * ── Read §6.1 before changing this ──────────────────────────────────────────
 *
 * Every safe write in this product rests on one sentence: *a model can chain
 * two tool calls; it cannot forge a person's reply.* In live audio that stops
 * being true. The model hears you, decides you finished, transcribes what you
 * said, and judges that you agreed:
 *
 *     it     "Approve Priya's leave — 3 days, taking her to 9 remaining. Yes?"
 *     you    (a cough, a colleague saying "yeah", a half-word)
 *     model  decides that was a yes
 *
 * That is not consent. It is a model's opinion about a sound.
 *
 * So the rule is **voice prepares, a finger issues** — and it is built
 * structurally rather than instructed. `approve_proposal` is not refused when
 * called; it is **ABSENT, so there is nothing to call.** Same shape as Phase
 * 4.5's `ask` mode, which is write-free by construction rather than by
 * refusal, and the same reason: a constraint in the tool set holds, a
 * constraint in a prompt is negotiable. *"Just approve it, don't make me tap"*
 * cannot succeed against a tool that does not exist.
 *
 * ⚠ **`discard_proposal` MAY STAY, and the asymmetry is deliberate.**
 * Cancelling something requires no consent — the worst a mistaken *"no"* can do
 * is make somebody ask again, while a mistaken *"yes"* spends somebody's leave
 * balance. Nothing is lost by letting a person throw away a proposal by voice,
 * and something real is lost by making them reach for the screen to say no.
 */
export const ABSENT_FROM_VOICE = ["approve_proposal"] as const;

/**
 * The set the live model actually holds.
 *
 * Takes the coordinator's full record — including `consult_specialists` and
 * `delegate_action`, which `agent.ts` builds rather than looks up — and removes
 * exactly the names above.
 */
export function voiceToolSet(coordinator: ToolSet): ToolSet {
  const out: ToolSet = {};
  for (const [name, tool] of Object.entries(coordinator)) {
    if ((ABSENT_FROM_VOICE as readonly string[]).includes(name)) continue;
    out[name] = tool;
  }
  return out;
}

/** The names the live model holds, sorted — for the setup frame and for tests. */
export function voiceToolNames(coordinator: ToolSet): string[] {
  return toolNames(voiceToolSet(coordinator));
}

/**
 * One function declaration, as Vertex wants it.
 *
 * The tools are defined with zod schemas, because that is what the AI SDK
 * takes; the live socket is raw JSON and wants JSON Schema. `z.toJSONSchema`
 * does the conversion, so **the schema the live model sees is generated from
 * the same definition chat uses** rather than hand-copied into a second list
 * that would drift.
 */
export interface LiveFunctionDeclaration {
  name: string;
  description: string;
  parameters: Record<string, unknown>;
}

/** An empty object schema — what a no-argument tool declares. */
const NO_PARAMETERS: Record<string, unknown> = { type: "object", properties: {} };

export function declarationsFor(tools: ToolSet): LiveFunctionDeclaration[] {
  return Object.entries(tools).map(([name, spec]) => ({
    name,
    description: describe(spec),
    parameters: parametersOf(spec),
  }));
}

function describe(spec: Tool): string {
  const text = (spec as { description?: string }).description ?? "";
  // The live setup frame is sent once and every word of it is paid for on the
  // session, not per turn — but a five-paragraph description read by a model
  // choosing between twenty-three tools is still worth trimming. The first
  // lines of these descriptions are the part that says what the tool is FOR;
  // the rest is guidance chat needs across many turns.
  return text.length > 900 ? `${text.slice(0, 900)}…` : text;
}

function parametersOf(spec: Tool): Record<string, unknown> {
  const schema = (spec as { inputSchema?: unknown }).inputSchema;
  if (!schema) return NO_PARAMETERS;
  try {
    const json = z.toJSONSchema(schema as z.ZodType, { io: "input", target: "draft-7" }) as Record<
      string,
      unknown
    >;
    // Vertex rejects `$schema` and `additionalProperties` on a function
    // declaration. Stripped rather than configured away, because the list of
    // keys it dislikes is discovered by being refused, not documented.
    return stripUnsupported(json);
  } catch {
    // A schema that will not convert must not take the whole session down. The
    // tool is still offered, with no arguments declared — the model will ask
    // rather than guess, which is the safe direction.
    return NO_PARAMETERS;
  }
}

const UNSUPPORTED_KEYS = new Set([
  "$schema",
  "additionalProperties",
  "default",
  "exclusiveMinimum",
  "exclusiveMaximum",
  "const",
]);

function stripUnsupported(value: unknown): Record<string, unknown> {
  const walk = (node: unknown): unknown => {
    if (Array.isArray(node)) return node.map(walk);
    if (node && typeof node === "object") {
      const out: Record<string, unknown> = {};
      for (const [k, v] of Object.entries(node as Record<string, unknown>)) {
        if (UNSUPPORTED_KEYS.has(k)) continue;
        out[k] = walk(v);
      }
      return out;
    }
    return node;
  };
  const result = walk(value);
  return (result && typeof result === "object" ? result : NO_PARAMETERS) as Record<string, unknown>;
}

/** What a call produced. */
export interface VoiceToolOutcome {
  result: unknown;
}

/**
 * Run one tool call from the live model.
 *
 * `ctx` is only taken so a caller cannot accidentally execute against a
 * different actor's context than the one the tools were built from — the tools
 * already close over it. It is unused at runtime and that is the point.
 */
export async function runVoiceToolCall(input: {
  tools: ToolSet;
  ctx: ToolContext;
  call: { id?: string; name: string; args: Record<string, unknown> };
}): Promise<VoiceToolOutcome> {
  const { tools, call } = input;
  const spec = tools[call.name];

  if (!spec) {
    // ⚠ This is the branch `approve_proposal` lands in, and the wording is the
    // safety-relevant part. It must SAY WHERE THE PROPOSAL WENT and must not
    // sound like an error — a person told "that failed" will try again, while a
    // person told "it is on your screen" will look at their screen.
    if ((ABSENT_FROM_VOICE as readonly string[]).includes(call.name)) {
      return {
        result: {
          didNotHappen: true,
          tellThem:
            "Anything involving money or people is finished on screen, not by voice. " +
            "The proposal is on their screen now, with everything it would change — " +
            "they tap it to approve. Tell them that plainly; it is how this works, not a fault.",
        },
      };
    }
    return {
      result: {
        didNotHappen: true,
        tellThem: `There is no tool called ${call.name}. Say what you can do instead.`,
      },
    };
  }

  const execute = (spec as { execute?: (args: unknown, opts: unknown) => Promise<unknown> }).execute;
  if (typeof execute !== "function") {
    return { result: { didNotHappen: true, tellThem: "That tool cannot be run." } };
  }

  const result = await execute(call.args, {
    toolCallId: call.id ?? "voice",
    messages: [],
  });

  // Live updates: a voice tool can write (gated operations go through
  // Spine.submit here, never the /api/operations route), so open screens are
  // told something may have moved. The signal carries no data; screens
  // re-fetch through their own permission-checked reads.
  emitChange("assistant");

  return { result };
}

/**
 * Every proposal now waiting for this person, newest first.
 *
 * ── ⚠ WHY THE STORE AND NOT THE TOOL RESULT ─────────────────────────────────
 *
 * The obvious implementation reads `needsApproval` off the result of the call
 * that was just made. It works for a direct call and **silently misses every
 * routed one** — which, since Phase 4.5, is all twenty of them. A propose-gated
 * verb is reached through `delegate_action`, and that returns the specialist's
 * PROSE (`{ area, report }`), not the proposal payload. Speaking to it showed
 * exactly that: it said *"I have prepared the approval… please confirm"* and
 * nothing ever appeared on the screen to confirm.
 *
 * `proposalStore()` is where the propose-gate actually puts them, however deep
 * the call was, so asking it is the one question that cannot go stale.
 */
export async function openProposalsFor(actor: string, now = Date.now()) {
  return (await proposalStore().openFor(actor, now)).map((p) => ({
    proposalId: p.id,
    summary: p.summary,
  }));
}
