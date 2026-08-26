import type { ActorId } from "@/spine/operation/types";
import type { DomainId } from "../specialists/domains";

/**
 * What the assistant remembers about a person's work, between conversations.
 *
 * ── ⚠ THE RULE THAT DECIDES WHAT MAY BE IN HERE ────────────────────────────
 *
 * **What the person told it. Never what the agent concluded about them.**
 *
 * Appendix D (`docs/CONTEXT.md:401-422`) forbids precisely the class of
 * statement a longitudinal memory produces:
 *
 *     "You work more slowly in the afternoons"    forbidden
 *     "You should take a break"                   forbidden
 *     "You are behind compared to Priya"          forbidden
 *
 * Look at what those three have in common: **every one is derived from
 * watching.** Every permitted example in appendix D is a fact the application
 * could already see. So:
 *
 *     "I prefer afternoon reviews"      -> stored. They said it.
 *     "reviews seem to take them 4h"    -> NOT STORED. The agent inferred it.
 *
 * Habits, pace and character are excluded **by construction, not by
 * filtering**. A filter you can argue with is a filter that will eventually be
 * argued with. `sanitizeForAppendixD` still runs on every composed sentence,
 * but it is the second line, not the first.
 *
 * ── One table, tagged by domain. Not one per specialist ────────────────────
 *
 * The schedule specialist reads `(actor, "day")` and gets two facts, not
 * thirty. Ten tables would be ten things to migrate, back up and keep in step
 * for exactly the same result. `domain` is the existing `DomainId` union — not
 * a second vocabulary that has to be kept aligned with the first.
 *
 * ── ⚠ Retire, never delete ─────────────────────────────────────────────────
 *
 * A superseded fact gets `retiredAt`. The row stays. Feature 05: everything is
 * recorded, including what the application did by itself.
 */

export interface MemoryFact {
  id: string;
  actor: ActorId;
  /** Which specialist this is useful to. From the existing `DomainId` union. */
  domain: DomainId;
  /** In the person's own words, as close as extraction can keep them. */
  text: string;
  /** Where it came from — a conversation id, or how it was recorded. */
  source?: string;
  /**
   * Records this fact came out of.
   *
   * ⚠ **Re-checked at READ time, never trusted from write time.** Permissions
   * change and a rule never outlives its owner. See `visible.ts`.
   */
  derivedFrom?: Array<{ nodeType: string; nodeId: string }>;
  createdAt: string;
  /**
   * `YYYY-MM-DD`, **inclusive** — the fact is live through this day.
   *
   * A local date rather than a timestamp, so it compares against `today()` the
   * way `Commitment.dueDate` does. Two date formats in one comparison is how a
   * fact that expired yesterday quietly survives. Absent means no expiry.
   */
  expiresAt?: string;
  /** Set when superseded. The row stays; it simply stops being returned. */
  retiredAt?: string;
}

export interface MemoryPersistence {
  save(fact: MemoryFact): Promise<void>;
  loadFor(actor: ActorId): Promise<MemoryFact[]>;
}

export interface RememberInput {
  actor: ActorId;
  domain: DomainId;
  text: string;
  source?: string;
  derivedFrom?: Array<{ nodeType: string; nodeId: string }>;
  expiresAt?: string;
  now?: string;
  /** Retire any existing fact whose text matches, so a correction supersedes. */
  supersedes?: string;
}

/**
 * In-memory facts, with optional durable backing.
 *
 * **Building the durable thing and hydrating it are one step**, exactly as
 * `CommitmentStore.create()` does it. The two-step version of that was a real
 * bug elsewhere in this codebase — `buildDemoWorld` performed the first half
 * and never the second — so there is no way to obtain a durable-but-unhydrated
 * store here. The constructor is private and `create()` is the only door.
 */
export class MemoryStore {
  private readonly byActor = new Map<ActorId, MemoryFact[]>();
  private readonly writes = new Map<string, Promise<void>>();
  private seq = 0;

  private constructor(private readonly persistence?: MemoryPersistence) {}

  /**
   * Build and hydrate, in one step.
   *
   * `actors` is who to pull back now. Anybody else is hydrated lazily on first
   * read, so a large organisation does not pay for everybody at boot.
   */
  static async create(
    persistence?: MemoryPersistence,
    actors: readonly ActorId[] = [],
  ): Promise<MemoryStore> {
    const store = new MemoryStore(persistence);
    for (const actor of actors) await store.hydrate(actor);
    return store;
  }

  private async hydrate(actor: ActorId): Promise<void> {
    if (!this.persistence) return;
    if (this.byActor.has(actor)) return;
    this.byActor.set(actor, await this.persistence.loadFor(actor));
  }

  private write(fact: MemoryFact): void {
    if (!this.persistence) return;
    // Chained per fact, so retiring one and rewriting it cannot land out of
    // order — the same reason the conversation and commitment stores chain.
    const previous = this.writes.get(fact.id) ?? Promise.resolve();
    this.writes.set(
      fact.id,
      previous
        .catch(() => {})
        .then(() => this.persistence!.save(fact))
        .catch(() => {}),
    );
  }

  /** Resolves when everything queued for this fact has been written. */
  async flush(id: string): Promise<void> {
    await this.writes.get(id);
  }

  async remember(input: RememberInput): Promise<MemoryFact> {
    await this.hydrate(input.actor);
    const now = input.now ?? new Date().toISOString();
    const list = this.byActor.get(input.actor) ?? [];

    // A correction supersedes rather than overwrites. The old row stays and is
    // simply no longer returned — feature 05, everything is recorded.
    if (input.supersedes) {
      for (const existing of list) {
        if (existing.id === input.supersedes && !existing.retiredAt) {
          existing.retiredAt = now;
          this.write(existing);
        }
      }
    }

    const fact: MemoryFact = {
      id: `mem_${input.actor}_${(this.seq++).toString(36)}_${Date.now().toString(36)}`,
      actor: input.actor,
      domain: input.domain,
      text: input.text.trim(),
      source: input.source,
      derivedFrom: input.derivedFrom,
      createdAt: now,
      expiresAt: input.expiresAt,
    };
    list.push(fact);
    this.byActor.set(input.actor, list);
    this.write(fact);
    return fact;
  }

  /** Everything ever recorded for this person, retired rows included. */
  async allFor(actor: ActorId): Promise<MemoryFact[]> {
    await this.hydrate(actor);
    return [...(this.byActor.get(actor) ?? [])];
  }

  /**
   * What is live for this person now, newest last.
   *
   * ⚠ **A retired or expired fact is never returned.** It is still in the
   * table; it is simply not part of what the assistant knows any more.
   *
   * ⚠ **This does NOT check record permission** — see `visible.ts`, which is
   * the only thing a tool or a specialist should call. Splitting them would be
   * a mistake if this were the public door; it is not, and the two callers that
   * matter both go through the one that re-checks.
   */
  async recall(
    actor: ActorId,
    opts: { domain?: DomainId; today?: string } = {},
  ): Promise<MemoryFact[]> {
    const today = opts.today ?? new Date().toISOString().slice(0, 10);
    const all = await this.allFor(actor);
    return all.filter(
      (f) =>
        !f.retiredAt &&
        // Inclusive: a fact expiring today is still true today.
        (!f.expiresAt || f.expiresAt >= today) &&
        (!opts.domain || f.domain === opts.domain),
    );
  }

  /** Supersede one fact. The row stays; `retiredAt` is set. */
  async retire(actor: ActorId, id: string, now?: string): Promise<MemoryFact | undefined> {
    await this.hydrate(actor);
    // A fact belongs to one person; somebody else's id finds nothing. Same
    // shape as `CommitmentStore.discharge`, and for the same reason.
    const found = (this.byActor.get(actor) ?? []).find((f) => f.id === id);
    if (!found || found.retiredAt) return undefined;
    found.retiredAt = now ?? new Date().toISOString();
    this.write(found);
    return found;
  }
}
