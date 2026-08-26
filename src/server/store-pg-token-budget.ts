import type { Pool } from "pg";
import type { TokenBudgetPersistence } from "@/domains/assistant/token-budget";
import { createTableIfNotExists } from "./create-table";

/**
 * Durable backing for the daily token ceiling.
 *
 * One row per person per day, keyed the same way `orga_question_budget` is —
 * PK `(actor, date)`, and **rows are never deleted**: the count is keyed by
 * date, so yesterday's row simply stops being read, and what is left is an
 * honest record of what the assistant actually cost.
 *
 * ⚠ **One deliberate departure from that table: the conflict clause adds, it
 * does not take `GREATEST`.**
 *
 * `orga_question_budget` stores an absolute count that the caller tracks, so
 * `GREATEST` is the right guard there — it stops a stale, lower total winning
 * a race and handing back an allowance that was already spent.
 *
 * Tokens are an **increment**, not a running total the caller holds. Two
 * servers each spending 100,000 tokens must record 200,000. Under `GREATEST`
 * they would record 100,000, and **that is precisely the bug being fixed here**
 * — a ceiling that quietly multiplies by the number of instances. So the sum
 * happens inside the statement, where it is atomic, and `RETURNING` hands back
 * what the total became rather than making the caller read it and guess.
 */
export class PostgresTokenBudgetStore implements TokenBudgetPersistence {
  private ready: Promise<void>;

  constructor(private readonly pool: Pool) {
    this.ready = this.init();
  }

  private async init(): Promise<void> {
    await createTableIfNotExists(
      this.pool,
      `
      CREATE TABLE IF NOT EXISTS orga_token_budget (
        actor text NOT NULL,
        date  text NOT NULL,
        spent bigint NOT NULL,
        PRIMARY KEY (actor, date)
      );
    `,
    );
  }

  async spentOn(actor: string, date: string): Promise<number> {
    await this.ready;
    const res = await this.pool.query<{ spent: string }>(
      "SELECT spent FROM orga_token_budget WHERE actor = $1 AND date = $2",
      [actor, date],
    );
    // `bigint` arrives as a string from node-postgres — a day's tokens is far
    // inside what a JS number holds exactly, but the column is wide because a
    // cost column that can overflow is a cost column that stops counting.
    return res.rows[0] ? Number(res.rows[0].spent) : 0;
  }

  async add(actor: string, date: string, tokens: number): Promise<number> {
    await this.ready;
    const res = await this.pool.query<{ spent: string }>(
      `INSERT INTO orga_token_budget (actor, date, spent) VALUES ($1, $2, $3)
       ON CONFLICT (actor, date)
       DO UPDATE SET spent = orga_token_budget.spent + EXCLUDED.spent
       RETURNING spent`,
      [actor, date, Math.round(tokens)],
    );
    return Number(res.rows[0].spent);
  }
}
