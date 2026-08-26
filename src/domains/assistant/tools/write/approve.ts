import { tool } from "ai";
import { z } from "zod";
import * as adapters from "@/spine/adapters";
import type { ToolSpec } from "../catalogue";
import { claimProposal, proposalStore } from "../propose";
import type { ToolContext } from "../context";

/**
 * Turn 2: the person says yes, and the prepared operation is submitted.
 *
 * ── The whole risk lives here ───────────────────────────────────────────────
 *
 * The propose-gate spans two turns, and all three ways turn 2 goes wrong are
 * silent:
 *
 * | **Re-derivation** | the agent works out what *"yes"* meant by reasoning again, and reasons differently. The person approved something they never saw |
 * | **Drift** | the record changed between turns — the leave was withdrawn, the person left — and the proposal is against stale facts |
 * | **Ambiguity** | two proposals are open. *"Yes"* picks one and nobody knows which |
 *
 * Each is answered by a mechanism rather than by care:
 *
 * 1. **Re-derivation** — the proposal stored the whole `{ opName, args }` at
 *    the moment it was made. This submits *that*, by id. The model never
 *    rebuilds the arguments, so it cannot rebuild them differently.
 * 2. **Drift** — `Spine.submit` runs `validate()` again, on the record as it is
 *    NOW. The snapshot is never trusted: if the leave was withdrawn in between,
 *    the submit fails and says why.
 * 3. **Ambiguity** — `claimProposal` refuses to guess. Two open and an
 *    ambiguous *"yes"* comes back as a question naming both.
 *
 * And underneath all of it, the same guarantee the read-back rests on: **a
 * proposal cannot be approved in the turn that made it.** A model can chain two
 * tool calls; it cannot forge a person's reply.
 *
 * ── Why this is not `Spine.confirm` ─────────────────────────────────────────
 *
 * `Spine.confirm()` releases an operation the GATE parked, and it requires a
 * person's session — handing it to the model would dissolve that guarantee
 * entirely. This is a different thing: nothing was ever submitted, so there is
 * nothing parked. The operation is submitted here for the first time, under the
 * actor's own hand, as `start: "typed"`.
 */
export const approveProposal: ToolSpec = {
  name: "approve_proposal",
  build: (ctx) =>
    tool({
      description: [
        "This tool does NOT approve leave or an expense claim — approve_leave and approve_expense PREPARE those. This one is how a person's yes goes through, whatever was prepared.",
        "",
        "Submit something you prepared earlier, now that they have agreed to it.",
        'Use ONLY after they have actually said yes — "yes", "go ahead", "do it".',
        "",
        "You cannot call this in the same turn you prepared something. Prepare, tell them, wait for their reply, and only then call this.",
        "If more than one thing is waiting it will refuse and name them — ask which they mean rather than guessing.",
        "The arguments were stored when you prepared it. You do not pass them again, and you must not reconstruct them.",
      ].join("\n"),
      inputSchema: z.object({
        proposalId: z
          .string()
          .optional()
          .describe(
            "OMIT THIS unless more than one thing is waiting. You will not have the id from a previous turn, and a record id (a leave id, a task id) is NOT a proposal id.",
          ),
      }),
      execute: async ({ proposalId }) => {
        const claim = await claimProposal({
          actor: ctx.actor,
          id: proposalId,
          turnId: ctx.turnId,
        });
        if (!claim.ok) {
          return {
            ok: false,
            didNotHappen: true,
            reason: claim.reason,
            tellThem: `This did NOT happen: ${claim.reason} ${claim.tellThem}`,
            ...(claim.choices
              ? {
                  waiting: claim.choices.map((c) => ({
                    proposalId: c.id,
                    summary: c.summary,
                  })),
                }
              : {}),
          };
        }

        const proposal = claim.proposal;
        // ⚠ Taken BEFORE submitting, so a submission that throws cannot leave a
        // proposal behind to be approved a second time.
        await proposalStore().take(proposal.id);

        // `validate()` runs again inside the spine, against the record as it is
        // now — this is what catches a leave withdrawn between the two turns.
        const outcome = await ctx.deps.spine.submit(
          adapters.fromTyped({
            actor: ctx.actor,
            name: proposal.opName,
            args: proposal.args,
          }),
        );

        if (outcome.status === "forbidden") {
          return {
            ok: false,
            didNotHappen: true,
            reason: "They are not allowed to do that.",
            tellThem:
              "This did NOT happen. Say only that it is not available to them — not who could do it, and not what the record holds.",
          };
        }
        if (outcome.status === "rejected") {
          return {
            ok: false,
            didNotHappen: true,
            reason: outcome.detail ?? "It could not be done.",
            // The drift case, and it is worth naming: what was prepared was
            // fine when it was prepared.
            tellThem:
              "This did NOT happen. Something changed since you prepared it, so it was refused on re-checking. Say what the refusal was and ask them what they want to do.",
            missing: outcome.missing,
          };
        }
        if (outcome.status !== "ran") {
          return {
            ok: false,
            didNotHappen: true,
            reason: `It is waiting: ${outcome.status}.`,
            tellThem: "This did NOT happen. Say what it is waiting for.",
          };
        }

        for (const change of outcome.result?.changes ?? []) {
          ctx.note(change.nodeType, String(change.nodeId));
        }
        return {
          ok: true,
          did: proposal.opName,
          summary: proposal.summary,
          result: outcome.result?.response ?? null,
          activityId: outcome.activityEntry?.id,
        };
      },
    }),
};

/**
 * Throw away something prepared, because they said no.
 *
 * ── Found by running it for real ────────────────────────────────────────────
 *
 * Asked to prepare a pay change and then told *"reject that request"*, the model
 * answered **"I have cancelled the preparation for the pay change. No changes
 * were made."** The second sentence was true. The first was not: there was no
 * way to cancel a proposal, so it was still sitting in the store, still live,
 * still approvable by a later *"yes"* meant for something else entirely.
 *
 * A proposal the person has REFUSED must not survive the refusal. Otherwise the
 * safest-looking answer — "nothing happened" — is the one that leaves a loaded
 * change lying about.
 */
export const discardProposal: ToolSpec = {
  name: "discard_proposal",
  build: (ctx: ToolContext) =>
    tool({
      description: [
        "This tool does NOT undo something that already happened — that is undo_last. It throws away something you PREPARED and they then said no to.",
        "",
        "Discard a prepared change they have refused.",
        'Use whenever they say no, not now, leave it, forget it — anything that means they are not approving what you prepared.',
        "",
        "Call this rather than only saying you have cancelled it. Until you do, the prepared change is still waiting and a later yes could approve it.",
      ].join("\n"),
      inputSchema: z.object({
        proposalId: z
          .string()
          .optional()
          .describe("Which one. Omit only when exactly one thing is waiting."),
      }),
      execute: async ({ proposalId }) => {
        const open = await proposalStore().openFor(ctx.actor, Date.now());
        const id = proposalId ?? (open.length === 1 ? open[0].id : undefined);
        if (!id) {
          return {
            ok: false,
            didNotHappen: true,
            reason:
              open.length === 0
                ? "There is nothing prepared to discard."
                : "More than one thing is waiting, so it is not clear which they mean.",
            tellThem:
              open.length === 0
                ? "Say there was nothing waiting. Nothing has changed either way."
                : "Do NOT guess. Name them and ask which: " +
                  open.map((p) => `"${p.summary}"`).join(" · "),
          };
        }
        const found = await proposalStore().get(id);
        if (!found || found.actor !== ctx.actor) {
          return {
            ok: false,
            didNotHappen: true,
            reason: "There is no proposal with that id waiting for them.",
            tellThem: "Say so plainly rather than describing it as cancelled.",
          };
        }
        await proposalStore().take(id);
        return { ok: true, discarded: found.summary };
      },
    }),
};
