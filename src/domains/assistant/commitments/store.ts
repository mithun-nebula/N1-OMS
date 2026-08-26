import type { ActorId } from "@/spine/operation/types";

/**
 * Things somebody asked to be reminded of.
 *
 * ── Explicit only, for now ──────────────────────────────────────────────────
 *
 * *"Remind me to do the Priya review on Thursday"* is recorded. *"I'll get that
 * done Thursday"* is **not** — inferring a promise from conversation is a later
 * decision, deliberately.
 *
 * The reason is the failure mode rather than the difficulty. *"I should
 * probably look at that"* is not a promise, and an assistant that chases you
 * about things you never committed to is worse than one that only remembers
 * what you asked it to. Explicit costs a person a few words and cannot misfire.
 *
 * The table and the follow-up are identical either way, so automatic inference
 * is an added detector later — not a rewrite of any of this.
 */

export interface Commitment {
  id: string;
  actor: ActorId;
  /** What they said they would do, in their words. */
  what: string;
  /** `YYYY-MM-DD`. Resolved before it gets here — never a relative phrase. */
  dueDate: string;
  /** Where it came from, so the chase can point at the conversation. */
  conversationId?: string;
  createdAt: string;
  /** Set when it is done, dropped or moved. A discharged commitment is history. */
  dischargedAt?: string;
  dischargedAs?: "done" | "dropped" | "moved";
}

export interface CommitmentPersistence {
  save(commitment: Commitment): Promise<void>;
  loadFor(actor: ActorId): Promise<Commitment[]>;
}

/**
 * In-memory commitments, with optional durable backing.
 *
 * **Building the durable thing and hydrating it are one step.** They used to be
 * two elsewhere in this codebase and `buildDemoWorld` only ever performed the
 * first — a real bug, not a style note, and the reason `configureQuestionLimiter`
 * now hydrates inside itself. `create()` below follows that: there is no way to
 * obtain a durable-but-unhydrated store.
 */
export class CommitmentStore {
  private readonly byActor = new Map<ActorId, Commitment[]>();
  private readonly writes = new Map<string, Promise<void>>();

  private constructor(private readonly persistence?: CommitmentPersistence) {}

  /**
   * Build and hydrate, in one step.
   *
   * `actors` is who to pull back now. Anybody else is hydrated lazily on first
   * read, so a large organisation does not pay for everybody at boot.
   */
  static async create(
    persistence?: CommitmentPersistence,
    actors: readonly ActorId[] = [],
  ): Promise<CommitmentStore> {
    const store = new CommitmentStore(persistence);
    for (const actor of actors) await store.hydrate(actor);
    return store;
  }

  private async hydrate(actor: ActorId): Promise<void> {
    if (!this.persistence) return;
    if (this.byActor.has(actor)) return;
    this.byActor.set(actor, await this.persistence.loadFor(actor));
  }

  private write(commitment: Commitment): void {
    if (!this.persistence) return;
    // Chained per commitment, so two edits to the same row cannot land out of
    // order and leave the older one winning — the same reason the conversation
    // store chains its writes.
    const previous = this.writes.get(commitment.id) ?? Promise.resolve();
    this.writes.set(
      commitment.id,
      previous
        .catch(() => {})
        .then(() => this.persistence!.save(commitment))
        .catch(() => {}),
    );
  }

  /** Resolves when everything queued for this commitment has been written. */
  async flush(id: string): Promise<void> {
    await this.writes.get(id);
  }

  async record(input: {
    actor: ActorId;
    what: string;
    dueDate: string;
    conversationId?: string;
    now?: string;
  }): Promise<Commitment> {
    await this.hydrate(input.actor);
    const commitment: Commitment = {
      id: `cmt_${input.actor}_${Date.now().toString(36)}_${Math.floor(Math.random() * 1e6).toString(36)}`,
      actor: input.actor,
      what: input.what.trim(),
      dueDate: input.dueDate,
      conversationId: input.conversationId,
      createdAt: input.now ?? new Date().toISOString(),
    };
    const list = this.byActor.get(input.actor) ?? [];
    list.push(commitment);
    this.byActor.set(input.actor, list);
    this.write(commitment);
    return commitment;
  }

  async listFor(actor: ActorId): Promise<Commitment[]> {
    await this.hydrate(actor);
    return [...(this.byActor.get(actor) ?? [])];
  }

  /**
   * Outstanding on or before a date — what the morning brief chases.
   *
   * Includes anything overdue, not only what is due exactly today. A promise
   * that slipped is the one most worth mentioning.
   */
  async dueBy(actor: ActorId, date: string): Promise<Commitment[]> {
    const all = await this.listFor(actor);
    return all
      .filter((c) => !c.dischargedAt && c.dueDate <= date)
      .sort((a, b) => a.dueDate.localeCompare(b.dueDate));
  }

  async discharge(
    actor: ActorId,
    id: string,
    as: Commitment["dischargedAs"],
    now?: string,
  ): Promise<Commitment | undefined> {
    await this.hydrate(actor);
    const found = (this.byActor.get(actor) ?? []).find((c) => c.id === id);
    if (!found) return undefined;
    // A commitment belongs to one person; somebody else's id finds nothing.
    found.dischargedAt = now ?? new Date().toISOString();
    found.dischargedAs = as;
    this.write(found);
    return found;
  }

  /** Move it rather than discharge it — the common answer to a chase. */
  async reschedule(
    actor: ActorId,
    id: string,
    dueDate: string,
  ): Promise<Commitment | undefined> {
    await this.hydrate(actor);
    const found = (this.byActor.get(actor) ?? []).find((c) => c.id === id);
    if (!found) return undefined;
    found.dueDate = dueDate;
    this.write(found);
    return found;
  }
}
