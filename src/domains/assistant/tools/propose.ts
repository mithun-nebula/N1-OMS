import type { ActorId } from "@/spine/operation/types";
import type { OperationCategory, OperationHandler } from "@/spine/operation/registry";

/**
 * The propose-gate: what the agent may do, and what it may only prepare.
 *
 * ── The constraint ──────────────────────────────────────────────────────────
 *
 * `gate.ts` parks a money or people operation **only when `delegated` is true**.
 * An agent submitting `start: "typed"` produces `authority: {kind:"self"}`, so
 * `delegated` is false and **nothing parks**. Correct for a person clicking a
 * form; wrong for a model choosing an operation.
 *
 * The resolution needs no spine change: the agent checks before submitting. If
 * the operation would have parked, it **does not submit**. It returns a
 * proposal, and the person's approval submits it under their own hand — which
 * is appendix B's *"prepares but never issues"*. `SEVEN_STARTS` is untouched
 * and `Spine.confirm()` is never a tool; handing that to the model would
 * dissolve the guarantee entirely.
 *
 * ── ⚠ BOTH parking conditions, not one ──────────────────────────────────────
 *
 * Phase 3's plan says parking is decided by `involvesMoneyOrPeople` and that
 * `category` "does not appear in any parking condition". **That is wrong**, and
 * building this gate on it would have left five operations unprotected.
 * `gate.ts` has two conditions, four lines apart:
 *
 *     :94   involvesMoneyOrPeople(args) && delegated
 *     :99   delegated && category && neverGraduates(category)
 *
 * `spine/gate/parking-audit.test.ts` proves `course.assign` and
 * `employee.updateContact` park today through the second one, and
 * `spine/operation/declarations.test.ts` pins that checking the flag alone
 * misses exactly five operations.
 *
 * So `wouldPark` mirrors **both**. Anything else is a gate with a hole in it.
 */

/** `gate/autonomy.ts`'s NEVER_GRADUATE. Restated so a change there fails a test here. */
const NEVER_GRADUATE: ReadonlySet<OperationCategory> = new Set([
  "money",
  "people",
  "leaving-org",
]);

/**
 * Would this operation stop and ask, if a standing rule had submitted it?
 *
 * If yes, the agent must not submit it either — the only difference between the
 * two cases is which field of `authority` is set, and that is not a difference a
 * person's safety should turn on.
 */
export function wouldPark(
  handler: Pick<OperationHandler, "involvesMoneyOrPeople" | "category">,
  args: Record<string, unknown>,
): boolean {
  let flag = false;
  try {
    flag = handler.involvesMoneyOrPeople(args) === true;
  } catch {
    // A handler that throws while deciding is treated as if it said yes. The
    // safe direction: propose rather than act.
    return true;
  }
  return flag || (handler.category !== undefined && NEVER_GRADUATE.has(handler.category));
}

/**
 * A prepared operation, waiting for a person.
 *
 * **The whole operation, not the intent.** `opName` and `args` are exactly what
 * would be submitted. Turn 2 submits *this*, by id — the model never
 * reconstructs it, so it cannot reason differently the second time and approve
 * something the person never saw.
 */
export interface Proposal {
  id: string;
  actor: ActorId;
  opName: string;
  args: Record<string, unknown>;
  /** What the person is being asked to approve, in words. */
  summary: string;
  expiresAt: number;
  /** The turn it was made in. It cannot be approved in that same turn. */
  turnId: string;
}

/**
 * ── ⚠ WHY EVERY METHOD IS ASYNC ─────────────────────────────────────────────
 *
 * It was synchronous, in memory, and that was fine while one process served
 * everything. It stops being fine the moment there are two.
 *
 * **The failure it caused, on any horizontally-scaled deployment:** a voice
 * session on instance A prepares an approval and puts it on the person's
 * screen. They tap it — and the tap is an ordinary HTTP request, which the load
 * balancer is free to send to **instance B**, whose memory has never held that
 * proposal. Instance B answers, correctly and uselessly, *"there is nothing
 * waiting with that id"*. Nothing unsafe happens; the Approve button simply
 * fails, intermittently, which is among the worst things to debug.
 *
 * Cross-instance visibility means reading shared storage, and reading shared
 * storage is asynchronous. There is no version of this that stays synchronous
 * and is also correct.
 */
export interface ProposalStore {
  put(proposal: Proposal): Promise<void>;
  get(id: string): Promise<Proposal | undefined>;
  /**
   * Reads AND removes, atomically.
   *
   * ⚠ Single-use is a safety property, not a tidiness one: it is what stops one
   * prepared approval being submitted twice. In memory that was guaranteed by
   * JavaScript being single-threaded. Across instances it has to be guaranteed
   * by the DATABASE — see `PostgresProposalStore`, where this is one
   * `DELETE ... RETURNING`, so two simultaneous taps cannot both win.
   */
  take(id: string): Promise<Proposal | undefined>;
  /** Everything still open for this person — so an ambiguous "yes" can ask. */
  openFor(actor: ActorId, now: number): Promise<Proposal[]>;
  clear(): Promise<void>;
}

class InMemoryProposalStore implements ProposalStore {
  private proposals = new Map<string, Proposal>();

  async put(proposal: Proposal): Promise<void> {
    this.proposals.set(proposal.id, proposal);
  }

  async get(id: string): Promise<Proposal | undefined> {
    return this.proposals.get(id);
  }

  async take(id: string): Promise<Proposal | undefined> {
    const found = this.proposals.get(id);
    if (found) this.proposals.delete(id);
    return found;
  }

  async openFor(actor: ActorId, now: number): Promise<Proposal[]> {
    return [...this.proposals.values()].filter(
      (p) => p.actor === actor && p.expiresAt > now,
    );
  }

  async clear(): Promise<void> {
    this.proposals.clear();
  }
}

/**
 * Minutes, not hours.
 *
 * A stale proposal approved the next morning is a change made against facts
 * nobody re-read. Expiry is the cheap half of that protection; re-validating at
 * submit time is the half that catches drift inside the window.
 */
export const PROPOSAL_TTL_MS = 10 * 60 * 1000;

const globalForProposals = globalThis as unknown as {
  __orgProposalStore?: ProposalStore;
  __orgProposalClock?: () => number;
};

export function proposalStore(): ProposalStore {
  globalForProposals.__orgProposalStore ??= new InMemoryProposalStore();
  return globalForProposals.__orgProposalStore;
}

export function setProposalStore(store?: ProposalStore): void {
  globalForProposals.__orgProposalStore = store;
}

function now(): number {
  return globalForProposals.__orgProposalClock?.() ?? Date.now();
}

export function setProposalClock(clock?: () => number): void {
  globalForProposals.__orgProposalClock = clock;
}

/**
 * Empty the store.
 *
 * Returns the promise so a caller that needs the guarantee can await it. Every
 * existing caller is a test's `beforeEach` and does not — which is safe with
 * the in-memory store, whose `clear()` runs to completion before it yields.
 * Against Postgres, await it.
 */
export function resetProposals(): Promise<void> {
  return proposalStore().clear();
}

/**
 * ⚠ **Durable since Phase 6, and the old reasoning is kept because it was
 * half right.** It said a restart losing a proposal is *correct* — the person is
 * asked again against facts that were re-read — and that a proposal surviving
 * the night would mean approving this morning what was prepared last night.
 *
 * The second half is still true and is handled by `PROPOSAL_TTL_MS`, which is
 * ten minutes: nothing survives the night whether it is durable or not. What the
 * old note missed is that "a restart" is not the only way memory is lost. **Two
 * instances never shared it in the first place**, and a proposal prepared by
 * voice on one and tapped on another was simply not found.
 */
function newProposalId(): string {
  return `prop_${globalThis.crypto.randomUUID()}`;
}

export interface ProposalRefusal {
  ok: false;
  didNotHappen: true;
  needsApproval: true;
  proposalId: string;
  operation: string;
  summary: string;
  reason: string;
  tellThem: string;
}

/**
 * Prepare, and refuse.
 *
 * Shaped as a refusal for the reason Phase 2 discovered the hard way: a quiet
 * `{ ok: false }` was read as success and narrated as *"I've added Module 4"*.
 * `didNotHappen` and `tellThem` in the same payload fixed it immediately.
 *
 * **A parked operation described as "done" is the single worst sentence this
 * product could emit**, and there will be many of these — twenty operations
 * propose by design.
 */
export async function proposeInstead(input: {
  actor: ActorId;
  opName: string;
  args: Record<string, unknown>;
  summary: string;
  turnId: string;
}): Promise<ProposalRefusal> {
  const id = newProposalId();
  await proposalStore().put({
    id,
    actor: input.actor,
    opName: input.opName,
    args: input.args,
    summary: input.summary,
    turnId: input.turnId,
    expiresAt: now() + PROPOSAL_TTL_MS,
  });
  return {
    ok: false,
    didNotHappen: true,
    needsApproval: true,
    proposalId: id,
    operation: input.opName,
    summary: input.summary,
    reason:
      "This affects money or another person, so it has been PREPARED and NOT done. It needs their approval.",
    tellThem:
      `Say exactly what you have prepared — "${input.summary}" — and that NOTHING has happened yet. ` +
      "Ask them to confirm. Do not describe it as done, scheduled, approved or submitted. " +
      // ⚠ Found by running it for real. Told "yes, go ahead", the model called
      // approve_proposal with the LEAVE id it had just quoted, because that was
      // the only id in front of it — and was refused. It will not have the
      // proposalId next turn: tool results are not kept between turns, by
      // design. So it must be told, here, to come back without one.
      "When they agree, call approve_proposal with NO proposalId — you will not " +
      "have this id in the next turn, and you must not substitute a record id for it.",
  };
}

export type ApprovalOutcome =
  | { ok: true; proposal: Proposal }
  | { ok: false; reason: string; tellThem: string; choices?: Proposal[] };

/**
 * Resolve which proposal an approval refers to, and hand it back to be
 * submitted — or say precisely why not.
 *
 * `id` is optional because a person answers *"yes"*, not *"yes, prop_7f3a"*.
 * When exactly one proposal is open the answer is unambiguous. When more than
 * one is, **it asks** — it does not pick. *"Priya's leave, or Arun's?"* is a
 * question; guessing is a change somebody did not ask for.
 */
export async function claimProposal(input: {
  actor: ActorId;
  id?: string;
  turnId: string;
}): Promise<ApprovalOutcome> {
  const askAgain =
    "Nothing has happened. Tell them what is waiting and ask them again.";
  const open = await proposalStore().openFor(input.actor, now());

  if (input.id) {
    const found = await proposalStore().get(input.id);
    if (!found || found.actor !== input.actor) {
      return {
        ok: false,
        reason: "There is no proposal with that id waiting for them.",
        tellThem:
          "Do NOT pass a record id here — a leave id or a task id is not a proposal id. " +
          "Call approve_proposal again with NO proposalId at all.",
      };
    }
    if (found.expiresAt <= now()) {
      await proposalStore().take(input.id);
      return {
        ok: false,
        reason: "That proposal has expired, so it was not submitted.",
        tellThem:
          "Say it has expired and that nothing was done. Prepare it again if they still want it — the facts will be re-read.",
      };
    }
    if (found.turnId === input.turnId) {
      // The same guarantee the read-back token rests on: a model can chain two
      // tool calls, but it cannot forge a turn boundary. Proposing and
      // approving inside one loop means nobody was asked.
      return {
        ok: false,
        reason: "You have not asked them yet — that proposal was prepared in this same turn.",
        tellThem:
          "Stop here. Tell them what is prepared, ask them, and WAIT for their reply before calling this again.",
      };
    }
    return { ok: true, proposal: found };
  }

  const live = open.filter((p) => p.turnId !== input.turnId);
  if (live.length === 0) {
    return {
      ok: false,
      reason: "There is nothing prepared and waiting for their approval.",
      tellThem: askAgain,
    };
  }
  if (live.length > 1) {
    return {
      ok: false,
      reason: "More than one thing is waiting, so it is not clear which they mean.",
      tellThem:
        "Do NOT guess. Name each one and ask which they mean: " +
        live.map((p) => `"${p.summary}"`).join(" · "),
      choices: live,
    };
  }
  return { ok: true, proposal: live[0] };
}
