import type { Pool } from "pg";

/**
 * `CREATE TABLE IF NOT EXISTS`, safe when two servers boot at the same moment.
 *
 * ── ⚠ Found by the database suite, and it is not a test artefact ───────────
 *
 * **`IF NOT EXISTS` is not race-safe in Postgres.** It checks, then creates,
 * and two sessions doing that at the same time both pass the check. The loser
 * does not get a friendly no-op — it gets
 *
 *     duplicate key value violates unique constraint "pg_type_typname_nsp_index"
 *
 * which is an error, from a statement whose entire purpose is not to be one.
 * Postgres documents this: the clause avoids the error only when nothing is
 * racing it.
 *
 * One server never sees this, which is exactly why it survived eighteen tables.
 * It surfaced here because Phase 4.6 added `orga_token_budget` **for the
 * two-server case** — and the first thing two servers do is boot together.
 *
 * ⚠ **Only the two tables Phase 4.6 added use this.** The other eighteen carry
 * the same exposure, unchanged, and that is recorded as a finding rather than
 * swept up quietly: fixing them is a sweep across every store in the server
 * directory, and this phase is not the place to hide one.
 *
 * The recovery is to swallow only the two errors that mean *somebody else has
 * already created it* and then prove it by reading from the table. Anything
 * else — no permission, a bad DDL, an unreachable database — still throws,
 * because those are real and must not be mistaken for a race.
 */
export async function createTableIfNotExists(pool: Pool, ddl: string): Promise<void> {
  try {
    await pool.query(ddl);
  } catch (error) {
    const code = (error as { code?: string }).code;
    // 23505 unique_violation on a catalogue index, 42P07 duplicate_table.
    // Both mean the same thing here: it exists now, which is all we wanted.
    if (code !== "23505" && code !== "42P07") throw error;
    // Prove it rather than assume it. If this fails, the original error was
    // not a race and the caller must hear about it.
    await pool.query(ddl);
  }
}
