import type { Pool } from "pg";
import type { ActorId } from "@/spine/operation/types";
import type {
  DayPlan,
  DayPlanPersistence,
  StreakRecord,
} from "@/domains/assistant/day-plan/store";

/**
 * Durable backing for the day plan. Plans are one JSONB snapshot per
 * (actor, date); streaks and learned estimates get their own rows so they
 * survive across days, not just across restarts.
 */
export class PostgresDayPlanPersistence implements DayPlanPersistence {
  private ready: Promise<void>;

  constructor(private readonly pool: Pool) {
    this.ready = this.init();
  }

  private async init(): Promise<void> {
    await this.pool.query(`
      CREATE TABLE IF NOT EXISTS orga_day_plans (
        actor text NOT NULL,
        date text NOT NULL,
        data jsonb NOT NULL,
        PRIMARY KEY (actor, date)
      );
      CREATE TABLE IF NOT EXISTS orga_day_streaks (
        actor text PRIMARY KEY,
        data jsonb NOT NULL
      );
      CREATE TABLE IF NOT EXISTS orga_day_estimates (
        key text PRIMARY KEY,
        estimate integer NOT NULL,
        actuals jsonb NOT NULL
      );
    `);
  }

  async savePlan(plan: DayPlan): Promise<void> {
    await this.ready;
    await this.pool.query(
      `INSERT INTO orga_day_plans (actor, date, data) VALUES ($1, $2, $3)
       ON CONFLICT (actor, date) DO UPDATE SET data = EXCLUDED.data`,
      [plan.actor, plan.date, JSON.stringify(plan)],
    );
  }

  async loadPlan(actor: string, date: string): Promise<DayPlan | undefined> {
    await this.ready;
    const res = await this.pool.query<{ data: DayPlan }>(
      "SELECT data FROM orga_day_plans WHERE actor=$1 AND date=$2",
      [actor, date],
    );
    return res.rows[0]?.data;
  }

  async loadRange(actor: string, from: string, to: string): Promise<DayPlan[]> {
    await this.ready;
    // Dates are stored as YYYY-MM-DD text, which sorts and compares
    // lexicographically exactly as it does chronologically.
    const res = await this.pool.query<{ data: DayPlan }>(
      `SELECT data FROM orga_day_plans
       WHERE actor = $1 AND date >= $2 AND date <= $3
       ORDER BY date ASC`,
      [actor, from, to],
    );
    return res.rows.map((r) => r.data);
  }

  async saveStreak(actor: ActorId, streak: StreakRecord): Promise<void> {
    await this.ready;
    await this.pool.query(
      `INSERT INTO orga_day_streaks (actor, data) VALUES ($1, $2)
       ON CONFLICT (actor) DO UPDATE SET data = EXCLUDED.data`,
      [actor, JSON.stringify(streak)],
    );
  }

  async loadStreak(actor: ActorId): Promise<StreakRecord | undefined> {
    await this.ready;
    const res = await this.pool.query<{ data: StreakRecord }>(
      "SELECT data FROM orga_day_streaks WHERE actor=$1",
      [actor],
    );
    return res.rows[0]?.data;
  }

  async saveEstimate(key: string, estimate: number, actuals: number[]): Promise<void> {
    await this.ready;
    await this.pool.query(
      `INSERT INTO orga_day_estimates (key, estimate, actuals) VALUES ($1, $2, $3)
       ON CONFLICT (key) DO UPDATE SET estimate = EXCLUDED.estimate, actuals = EXCLUDED.actuals`,
      [key, estimate, JSON.stringify(actuals)],
    );
  }

  async loadEstimate(key: string): Promise<{ estimate: number; actuals: number[] } | undefined> {
    await this.ready;
    const res = await this.pool.query<{ estimate: number; actuals: number[] }>(
      "SELECT estimate, actuals FROM orga_day_estimates WHERE key=$1",
      [key],
    );
    const row = res.rows[0];
    return row ? { estimate: row.estimate, actuals: row.actuals } : undefined;
  }

  async loadAllEstimates(): Promise<Array<{ key: string; estimate: number; actuals: number[] }>> {
    await this.ready;
    const res = await this.pool.query<{ key: string; estimate: number; actuals: number[] }>(
      "SELECT key, estimate, actuals FROM orga_day_estimates",
    );
    return res.rows;
  }
}
