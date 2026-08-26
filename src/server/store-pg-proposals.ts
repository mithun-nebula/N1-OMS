import type { Pool } from "pg";
import type { Proposal, ProposalStore } from "@/domains/assistant/tools/propose";
import type { ActorId } from "@/spine/operation/types";

/**
 * Prepared operations, shared between instances.
 *
 * ── ⚠ WHY THIS EXISTS, AND IT IS NOT ABOUT RESTARTS ─────────────────────────
 *
 * `propose.ts` argued for years that a proposal should NOT be durable: losing
 * one to a restart is correct, because the person is asked again against facts
 * that were re-read. That argument still holds, and expiry — ten minutes — is
 * what enforces it. Nothing here survives the night.
 *
 * What the old note missed is that a restart is not the only way memory is
 * lost. **Two instances never shared it in the first place.**
 *
 *     voice on instance A   ->  prepares an approval, puts it on the screen
 *     the person taps       ->  an ordinary HTTP request
 *     the load balancer     ->  sends it to instance B
 *     instance B            ->  "there is nothing waiting with that id"
 *
 * Nothing unsafe happens — the tap is refused. The Approve button simply fails,
 * intermittently, depending on which instance answers, which is close to the
 * worst thing to be handed as a bug report.
 *
 * ── ⚠ `take` IS ONE STATEMENT, AND THAT IS THE POINT ────────────────────────
 *
 * Single-use is a **safety** property: it is what stops one prepared approval
 * being submitted twice. In memory it was free, because JavaScript is
 * single-threaded and `get`-then-`delete` could not be interleaved. Across
 * instances that guarantee has to come from the database, so `take` is a single
 * `DELETE ... RETURNING`: two simultaneous taps both run it, and **exactly one
 * gets a row back.** The loser sees "nothing waiting", which is the correct
 * refusal.
 *
 * Doing it as `SELECT` then `DELETE` would look identical, pass every test, and
 * let a double-tap through under load.
 */
export class PostgresProposalStore implements ProposalStore {
  private ready: Promise<void>;

  constructor(private readonly pool: Pool) {
    this.ready = this.init();
  }

  /**
   * ⚠ `CREATE TABLE IF NOT EXISTS` is NOT safe against a concurrent create.
   *
   * Two sessions running it at the same moment do not both quietly succeed:
   * one wins and the other fails with a unique-violation on Postgres's internal
   * catalogue (`pg_type_typname_nsp_index`, or `duplicate key`), because the
   * existence check and the create are not atomic with each other.
   *
   * That is not a test artefact. **Two instances booting together do exactly
   * this**, which is the same deployment shape this whole table exists for — so
   * the losing side treats it as success and confirms the table is really there
   * rather than assuming it.
   */
  private async init(): Promise<void> {
    try {
      await this.create();
    } catch {
      // Somebody else created it a moment ago. Prove it, rather than hoping.
      await this.pool.query("SELECT 1 FROM orga_proposals WHERE false");
    }
  }

  private async create(): Promise<void> {
    await this.pool.query(`
      CREATE TABLE IF NOT EXISTS orga_proposals (
        id          text PRIMARY KEY,
        actor       text NOT NULL,
        op_name     text NOT NULL,
        args        jsonb NOT NULL,
        summary     text NOT NULL,
        expires_at  bigint NOT NULL,
        turn_id     text NOT NULL
      );
      CREATE INDEX IF NOT EXISTS orga_proposals_actor ON orga_proposals (actor, expires_at);
    `);
  }

  async put(proposal: Proposal): Promise<void> {
    await this.ready;
    await this.pool.query(
      `INSERT INTO orga_proposals (id, actor, op_name, args, summary, expires_at, turn_id)
       VALUES ($1,$2,$3,$4,$5,$6,$7)
       ON CONFLICT (id) DO NOTHING`,
      [
        proposal.id,
        proposal.actor,
        proposal.opName,
        JSON.stringify(proposal.args),
        proposal.summary,
        String(proposal.expiresAt),
        proposal.turnId,
      ],
    );
  }

  async get(id: string): Promise<Proposal | undefined> {
    await this.ready;
    const rows = await this.pool.query<Row>("SELECT * FROM orga_proposals WHERE id = $1", [id]);
    return rows.rows[0] ? toProposal(rows.rows[0]) : undefined;
  }

  async take(id: string): Promise<Proposal | undefined> {
    await this.ready;
    // ⚠ One statement. See the header — this is what makes single-use hold
    // when two instances race.
    const rows = await this.pool.query<Row>(
      "DELETE FROM orga_proposals WHERE id = $1 RETURNING *",
      [id],
    );
    return rows.rows[0] ? toProposal(rows.rows[0]) : undefined;
  }

  async openFor(actor: ActorId, now: number): Promise<Proposal[]> {
    await this.ready;
    // Expired rows are filtered here rather than swept on a timer: a row nobody
    // asks about costs nothing, and a sweeper is one more thing to run.
    const rows = await this.pool.query<Row>(
      "SELECT * FROM orga_proposals WHERE actor = $1 AND expires_at > $2 ORDER BY expires_at",
      [actor, String(now)],
    );
    return rows.rows.map(toProposal);
  }

  async clear(): Promise<void> {
    await this.ready;
    await this.pool.query("DELETE FROM orga_proposals");
  }
}

interface Row {
  id: string;
  actor: string;
  op_name: string;
  args: Record<string, unknown>;
  summary: string;
  expires_at: string;
  turn_id: string;
}

function toProposal(row: Row): Proposal {
  return {
    id: row.id,
    actor: row.actor,
    opName: row.op_name,
    // `jsonb` comes back parsed; a string would mean the driver changed under us.
    args: typeof row.args === "string" ? (JSON.parse(row.args) as Record<string, unknown>) : row.args,
    summary: row.summary,
    // bigint arrives as a string, because it does not fit a JS number safely in
    // general. These are milliseconds, which do, so the conversion is honest.
    expiresAt: Number(row.expires_at),
    turnId: row.turn_id,
  };
}
