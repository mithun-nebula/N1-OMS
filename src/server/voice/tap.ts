import * as adapters from "@/spine/adapters";
import type { ActorId } from "@/spine/operation/types";
import type { Spine } from "@/spine/spine";
import { claimProposal, proposalStore } from "@/domains/assistant/tools/propose";

/**
 * A finger issues.
 *
 * ── ⚠ WHY A TAP MAY DO WHAT THE MODEL MAY NOT ───────────────────────────────
 *
 * `approve_proposal` is **absent** from the live tool set, so nothing the model
 * says or does can complete a money or people operation. This is the other half
 * of that sentence: the person taps, and the prepared operation is submitted
 * **under their own hand**.
 *
 * The distinction is not a matter of degree, and it is the whole of §6.1. A
 * model can chain two tool calls; **it cannot make an authenticated HTTP
 * request from somebody's browser.** This route is reached with the session
 * cookie the browser holds, which is the strongest form of "a person replied"
 * this product has — stronger than a typed message, because a typed message
 * arrives through the model's own channel and this does not.
 *
 * ── ⚠ THE SAME-TURN CHECK IS DELIBERATELY BYPASSED, AND ONLY HERE ───────────
 *
 * `claimProposal` refuses a proposal whose `turnId` matches the current turn,
 * because proposing and approving inside one model loop means nobody was asked.
 * **A tap has no turn.** The finger IS the boundary, so a synthetic id is passed
 * that can never collide with a model's (`turn_<n>_<ms>`).
 *
 * This is not a loosening. It is the check being asked of the right thing:
 * `claimProposal` still verifies that the proposal exists, **belongs to this
 * actor**, and has not expired; `Spine.submit` still re-runs `validate()`
 * against the record as it is NOW, so a leave withdrawn since it was prepared is
 * still refused; the gate, the permission policy and the activity log are all
 * unchanged. Nothing about tapping widens what this person may do.
 */

/** What the person sees waiting for them, and can tap. */
export async function openProposals(actor: ActorId, now = Date.now()) {
  return (await proposalStore().openFor(actor, now)).map((p) => ({
    proposalId: p.id,
    summary: p.summary,
    operation: p.opName,
    expiresAt: p.expiresAt,
  }));
}

export type TapOutcome =
  | { ok: true; did: string; summary: string }
  | { ok: false; status: number; reason: string };

/**
 * Approve one prepared operation, because a person tapped it.
 *
 * `id` is required — unlike the tool, which may omit it and let the server
 * disambiguate. A tap is always on a specific thing, so there is nothing to
 * guess, and guessing is the failure mode `claimProposal` exists to prevent.
 */
export async function tapApprove(input: {
  spine: Spine;
  actor: ActorId;
  proposalId: string;
}): Promise<TapOutcome> {
  const claim = await claimProposal({
    actor: input.actor,
    id: input.proposalId,
    // See the header: a tap has no turn, and this can never equal one.
    turnId: `tap_${globalThis.crypto.randomUUID()}`,
  });

  if (!claim.ok) {
    // 404 rather than 403 for "not yours".
    //
    // `claimProposal` already answers "no such proposal waiting for them" for
    // both a wrong id and somebody else's, and that conflation is on purpose:
    // a distinguishable refusal would let a caller learn which proposal ids
    // exist by trying them.
    return { ok: false, status: 404, reason: claim.reason };
  }

  const proposal = claim.proposal;
  // ⚠ Taken BEFORE submitting, so a submission that throws cannot leave a
  // proposal behind to be approved a second time. Same order as the tool.
  await proposalStore().take(proposal.id);

  const outcome = await input.spine.submit(
    adapters.fromTyped({
      actor: input.actor,
      name: proposal.opName,
      args: proposal.args,
    }),
  );

  if (outcome.status === "forbidden") {
    // Says nothing about what the record holds or who could do it.
    return { ok: false, status: 403, reason: "That is not available to you." };
  }
  if (outcome.status === "rejected") {
    // The drift case, and worth naming plainly: it was fine when it was
    // prepared, and something changed since.
    return {
      ok: false,
      status: 400,
      reason:
        outcome.detail ??
        "Something changed since this was prepared, so it was refused on re-checking.",
    };
  }
  if (outcome.status !== "ran") {
    return { ok: false, status: 409, reason: `It is waiting: ${outcome.status}.` };
  }

  return { ok: true, did: proposal.opName, summary: proposal.summary };
}

/**
 * Throw one away.
 *
 * Needs no consent and no gate — the asymmetry is the same one that lets
 * `discard_proposal` stay in the live tool set. The worst a mistaken discard
 * can do is make somebody ask again.
 */
export async function tapDiscard(actor: ActorId, proposalId: string): Promise<boolean> {
  const found = await proposalStore().get(proposalId);
  if (!found || found.actor !== actor) return false;
  await proposalStore().take(proposalId);
  return true;
}
