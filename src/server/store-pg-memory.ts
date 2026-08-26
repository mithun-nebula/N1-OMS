import type { Pool } from "pg";
import type {
  MemoryFact,
  MemoryPersistence,
} from "@/domains/assistant/memory/store";
import type { DomainId } from "@/domains/assistant/specialists/domains";
import { createTableIfNotExists } from "./create-table";

/**
 * Durable backing for what the assistant remembers.
 *
 * **One table, tagged by domain — not one per specialist.** The schedule
 * specialist reads `(actor, "day")` and gets two facts, not thirty. Ten tables
 * would be ten things to migrate, back up and keep in step for exactly the same
 * result.
 *
 * ⚠ **`actor` comes FIRST in the index, and that is not an optimisation.**
 * `learnedFor` in `day-plan/store.ts:302-308` records why in the code already:
 * a table keyed by record discloses which records exist. Every read here starts
 * from a person.
 *
 * ⚠ **Nothing deletes.** `retired_at` is set and the row stays — feature 05,
 * everything is recorded, including what the application did by itself.
 *
 * Created inside `init()` with `CREATE TABLE IF NOT EXISTS` and awaited through
 * a private `ready`, like every other store here. **There is no migrations
 * directory in this repository**; this is the pattern.
 *
 * The one departure is `createTableIfNotExists`, because `IF NOT EXISTS` is
 * **not race-safe** and two servers booting together both run this. See that
 * file — the database suite found it, and it is a real defect rather than a
 * test artefact.
 */
export class PostgresMemoryStore implements MemoryPersistence {
  private ready: Promise<void>;

  constructor(private readonly pool: Pool) {
    this.ready = this.init();
  }

  private async init(): Promise<void> {
    await createTableIfNotExists(
      this.pool,
      `
      CREATE TABLE IF NOT EXISTS orga_memory_facts (
        id           text PRIMARY KEY,
        actor        text NOT NULL,
        domain       text NOT NULL,
        text         text NOT NULL,
        source       text,
        derived_from jsonb,
        created_at   text NOT NULL,
        expires_at   text,
        retired_at   text
      );
      CREATE INDEX IF NOT EXISTS orga_memory_facts_actor
        ON orga_memory_facts (actor, domain);
    `,
    );
  }

  async save(fact: MemoryFact): Promise<void> {
    await this.ready;
    // Retiring is an UPDATE of an existing row, never a delete and never a new
    // row — so the conflict clause has to carry `retired_at` through.
    await this.pool.query(
      `INSERT INTO orga_memory_facts
         (id, actor, domain, text, source, derived_from, created_at, expires_at, retired_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)
       ON CONFLICT (id) DO UPDATE
         SET text       = EXCLUDED.text,
             domain     = EXCLUDED.domain,
             source     = EXCLUDED.source,
             expires_at = EXCLUDED.expires_at,
             retired_at = EXCLUDED.retired_at`,
      [
        fact.id,
        fact.actor,
        fact.domain,
        fact.text,
        fact.source ?? null,
        fact.derivedFrom ? JSON.stringify(fact.derivedFrom) : null,
        fact.createdAt,
        fact.expiresAt ?? null,
        fact.retiredAt ?? null,
      ],
    );
  }

  async loadFor(actor: string): Promise<MemoryFact[]> {
    await this.ready;
    // ⚠ Retired rows come back too. Filtering them out is `recall`'s job, and
    // doing it here as well would mean a retired fact could never be audited or
    // un-retired — which is the whole reason the row stays.
    const res = await this.pool.query<{
      id: string;
      actor: string;
      domain: string;
      text: string;
      source: string | null;
      derived_from: Array<{ nodeType: string; nodeId: string }> | null;
      created_at: string;
      expires_at: string | null;
      retired_at: string | null;
    }>(
      `SELECT id, actor, domain, text, source, derived_from, created_at, expires_at, retired_at
         FROM orga_memory_facts
        WHERE actor = $1
        ORDER BY created_at`,
      [actor],
    );
    return res.rows.map((row) => ({
      id: row.id,
      actor: row.actor,
      domain: row.domain as DomainId,
      text: row.text,
      ...(row.source ? { source: row.source } : {}),
      // `jsonb` comes back parsed, but a row written by an older shape might
      // not be an array — the same guard the conversation store makes.
      ...(Array.isArray(row.derived_from) ? { derivedFrom: row.derived_from } : {}),
      createdAt: row.created_at,
      ...(row.expires_at ? { expiresAt: row.expires_at } : {}),
      ...(row.retired_at ? { retiredAt: row.retired_at } : {}),
    }));
  }
}
