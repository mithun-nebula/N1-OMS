import type { Pool } from "pg";
import type {
  Commitment,
  CommitmentPersistence,
} from "@/domains/assistant/commitments/store";

/**
 * Durable commitments — one row each, the same shape as the other tables here.
 *
 * A commitment that does not survive a restart is worse than no commitment at
 * all: somebody asked to be reminded, was told it was noted, and then never
 * heard about it again.
 */
export class PostgresCommitmentStore implements CommitmentPersistence {
  private ready: Promise<void>;

  constructor(private readonly pool: Pool) {
    this.ready = this.init();
  }

  private async init(): Promise<void> {
    await this.pool.query(`
      CREATE TABLE IF NOT EXISTS orga_commitments (
        id              text PRIMARY KEY,
        actor           text NOT NULL,
        what            text NOT NULL,
        due_date        text NOT NULL,
        conversation_id text,
        created_at      text NOT NULL,
        discharged_at   text,
        discharged_as   text
      );
      CREATE INDEX IF NOT EXISTS orga_commitments_actor ON orga_commitments (actor);
    `);
  }

  async save(c: Commitment): Promise<void> {
    await this.ready;
    await this.pool.query(
      `INSERT INTO orga_commitments
         (id, actor, what, due_date, conversation_id, created_at, discharged_at, discharged_as)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
       ON CONFLICT (id) DO UPDATE
         SET what = EXCLUDED.what,
             due_date = EXCLUDED.due_date,
             conversation_id = EXCLUDED.conversation_id,
             discharged_at = EXCLUDED.discharged_at,
             discharged_as = EXCLUDED.discharged_as`,
      [
        c.id,
        c.actor,
        c.what,
        c.dueDate,
        c.conversationId ?? null,
        c.createdAt,
        c.dischargedAt ?? null,
        c.dischargedAs ?? null,
      ],
    );
  }

  async loadFor(actor: string): Promise<Commitment[]> {
    await this.ready;
    const res = await this.pool.query<{
      id: string;
      actor: string;
      what: string;
      due_date: string;
      conversation_id: string | null;
      created_at: string;
      discharged_at: string | null;
      discharged_as: string | null;
    }>(
      `SELECT id, actor, what, due_date, conversation_id, created_at, discharged_at, discharged_as
         FROM orga_commitments WHERE actor = $1 ORDER BY due_date`,
      [actor],
    );
    return res.rows.map((r) => ({
      id: r.id,
      actor: r.actor,
      what: r.what,
      dueDate: r.due_date,
      conversationId: r.conversation_id ?? undefined,
      createdAt: r.created_at,
      dischargedAt: r.discharged_at ?? undefined,
      dischargedAs: (r.discharged_as as Commitment["dischargedAs"]) ?? undefined,
    }));
  }
}
