import type { OperationCategory } from "@/spine/operation/registry";
import type { AutonomyLedger, RuleState } from "@/spine/gate/autonomy";
import type { Pool } from "pg";

export class AutonomyStore implements AutonomyLedger {
  private rules = new Map<string, RuleState>();
  private pool?: Pool;

  constructor(pool?: Pool) {
    this.pool = pool;
  }

  /** Creates the table and hydrates from Postgres. Called once at boot. */
  async init(): Promise<void> {
    if (!this.pool) return;
    await this.pool.query(`
      CREATE TABLE IF NOT EXISTS orga_autonomy_rules (
        rule_id text PRIMARY KEY,
        data    jsonb NOT NULL
      );
    `);
    const res = await this.pool.query<{ data: RuleState }>(
      "SELECT data FROM orga_autonomy_rules",
    );
    for (const row of res.rows) {
      const state = row.data;
      this.rules.set(state.ruleId, state);
    }
  }

  declare(
    ruleId: string,
    author: string,
    opName: string,
    category?: OperationCategory,
  ): RuleState {
    const existing = this.rules.get(ruleId);
    if (existing) return existing;
    const state: RuleState = {
      ruleId,
      author,
      opName,
      category,
      cleanCount: 0,
      status: "supervised",
    };
    this.rules.set(ruleId, state);
    this.persist(state);
    return state;
  }

  get(ruleId: string): RuleState | undefined {
    return this.rules.get(ruleId);
  }

  set(state: RuleState): void {
    this.rules.set(state.ruleId, state);
    this.persist(state);
  }

  listByAuthor(author: string): RuleState[] {
    return [...this.rules.values()].filter((r) => r.author === author);
  }

  list(): RuleState[] {
    return [...this.rules.values()];
  }

  /** Fire-and-forget DB write (methods stay sync — the gate calls them synchronously). */
  private persist(state: RuleState): void {
    if (!this.pool) return;
    this.pool
      .query(
        "INSERT INTO orga_autonomy_rules (rule_id, data) VALUES ($1, $2) ON CONFLICT (rule_id) DO UPDATE SET data = EXCLUDED.data",
        [state.ruleId, JSON.stringify(state)],
      )
      .catch(() => {});
  }
}
