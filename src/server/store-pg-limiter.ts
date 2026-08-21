import type { Pool } from "pg";
import type { QuestionLimiterPersistence } from "@/domains/workplace/shared/limiter";

/**
 * Durable backing for the two-questions-a-day allowance.
 *
 * One row per person per day. Rows are never deleted on the write path — the
 * count is keyed by date, so yesterday's row simply stops being read. That
 * also leaves an honest record of how often people were actually asked.
 */
export class PostgresQuestionLimiterStore implements QuestionLimiterPersistence {
  private ready: Promise<void>;

  constructor(private readonly pool: Pool) {
    this.ready = this.init();
  }

  private async init(): Promise<void> {
    await this.pool.query(`
      CREATE TABLE IF NOT EXISTS orga_question_budget (
        actor text NOT NULL,
        date text NOT NULL,
        used integer NOT NULL,
        PRIMARY KEY (actor, date)
      );
    `);
  }

  async save(actor: string, date: string, used: number): Promise<void> {
    await this.ready;
    // GREATEST, not a plain overwrite: two questions racing on the same day
    // must not let the lower count win and hand back a spent allowance.
    await this.pool.query(
      `INSERT INTO orga_question_budget (actor, date, used) VALUES ($1, $2, $3)
       ON CONFLICT (actor, date)
       DO UPDATE SET used = GREATEST(orga_question_budget.used, EXCLUDED.used)`,
      [actor, date, used],
    );
  }

  async loadFor(date: string): Promise<Array<{ actor: string; used: number }>> {
    await this.ready;
    const res = await this.pool.query<{ actor: string; used: number }>(
      "SELECT actor, used FROM orga_question_budget WHERE date = $1",
      [date],
    );
    return res.rows;
  }
}
