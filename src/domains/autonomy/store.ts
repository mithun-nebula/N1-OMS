import type { OperationCategory } from "@/spine/operation/registry";
import type { AutonomyLedger, RuleState } from "@/spine/gate/autonomy";
import type { Pool } from "pg";
import type { RuleSpec } from "./spec";
import type { RoutineSuggestion } from "./engine";

/**
 * The ledger — and, since Phase 4, **the rules themselves**.
 *
 * It used to hold only `RuleState`: who may emit what, and how many clean
 * approvals they have. That is the GRANT. The rule — what it watches — lived in
 * a JavaScript closure in an in-memory array, so after a restart the system
 * knew a rule existed and could not say what it was for.
 *
 * Specs and suggestions now sit beside the grant, in their own tables. Separate
 * tables rather than fields on the grant because they change on different
 * schedules: a grant is rewritten on every approval, a spec almost never.
 */
export class AutonomyStore implements AutonomyLedger {
  private rules = new Map<string, RuleState>();
  private specs = new Map<string, RuleSpec>();
  private suggestions = new Map<string, RoutineSuggestion>();
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
    await this.pool.query(`
      CREATE TABLE IF NOT EXISTS orga_autonomy_specs (
        rule_id text PRIMARY KEY,
        data    jsonb NOT NULL
      );
      CREATE TABLE IF NOT EXISTS orga_autonomy_suggestions (
        id   text PRIMARY KEY,
        data jsonb NOT NULL
      );
    `);
    const res = await this.pool.query<{ data: RuleState }>(
      "SELECT data FROM orga_autonomy_rules",
    );
    for (const row of res.rows) {
      const state = row.data;
      this.rules.set(state.ruleId, state);
    }
    const specs = await this.pool.query<{ data: RuleSpec }>(
      "SELECT data FROM orga_autonomy_specs",
    );
    for (const row of specs.rows) this.specs.set(row.data.id, row.data);

    const suggestions = await this.pool.query<{ data: RoutineSuggestion }>(
      "SELECT data FROM orga_autonomy_suggestions",
    );
    for (const row of suggestions.rows) this.suggestions.set(row.data.id, row.data);
  }

  /**
   * Save a rule as data, and declare its grant in the same step.
   *
   * One call, because the two going out of step is the failure this phase
   * exists to fix — a grant with no rule, or a rule nothing is allowed to run.
   */
  declareSpec(spec: RuleSpec): void {
    this.specs.set(spec.id, spec);
    this.write("orga_autonomy_specs", "rule_id", spec.id, spec);
    if (!this.rules.get(spec.id)) {
      // Rules are `routine` by category. Money and people never graduate and a
      // rule may only notify, so nothing here can carry a heavier category —
      // but the grant records it either way, and the gate reads it.
      this.declare(spec.id, spec.author, spec.do.opName, "routine");
    }
  }

  getSpec(ruleId: string): RuleSpec | undefined {
    return this.specs.get(ruleId);
  }

  listSpecs(): RuleSpec[] {
    return [...this.specs.values()];
  }

  putSuggestion(s: RoutineSuggestion): void {
    this.suggestions.set(s.id, s);
    this.write("orga_autonomy_suggestions", "id", s.id, s);
  }

  listSuggestions(): RoutineSuggestion[] {
    return [...this.suggestions.values()];
  }

  /** Fire-and-forget, like `persist` — a tick must not fail on a slow write. */
  private write(table: string, idColumn: string, id: string, data: unknown): void {
    if (!this.pool) return;
    this.pool
      .query(
        `INSERT INTO ${table} (${idColumn}, data) VALUES ($1, $2) ` +
          `ON CONFLICT (${idColumn}) DO UPDATE SET data = EXCLUDED.data`,
        [id, JSON.stringify(data)],
      )
      .catch(() => {});
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
