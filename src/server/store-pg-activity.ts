import type { NodeId } from "@/spine/operation/types";
import { Pool } from "pg";
import type {
  ActivityEntry,
  ActivityLog,
  ActivityQuery,
} from "@/spine/activity-log/types";

/**
 * Durable Postgres ActivityLog. Append-only; every entry's full payload is
 * stored as JSONB so it survives restarts. The activity log is the second waist
 * of the spine — it must persist.
 */
export class PostgresActivityLog implements ActivityLog {
  private seq = 0;
  private ready: Promise<void>;

  constructor(private readonly pool: Pool) {
    this.ready = this.init();
  }

  private async init(): Promise<void> {
    await this.pool.query(`
      CREATE TABLE IF NOT EXISTS orga_activity (
        id text PRIMARY KEY,
        data jsonb NOT NULL,
        at timestamptz NOT NULL DEFAULT now()
      );
      CREATE INDEX IF NOT EXISTS orga_activity_at ON orga_activity (at);
    `);
  }

  private async r(): Promise<void> {
    return this.ready;
  }

  async append(entry: ActivityEntry): Promise<void> {
    await this.r();
    await this.pool.query(
      "INSERT INTO orga_activity (id, data, at) VALUES ($1, $2, $3) ON CONFLICT DO NOTHING",
      [entry.id, JSON.stringify(entry), entry.at],
    );
  }

  async get(id: string): Promise<ActivityEntry | undefined> {
    await this.r();
    const res = await this.pool.query<{ data: ActivityEntry }>(
      "SELECT data FROM orga_activity WHERE id=$1",
      [id],
    );
    return res.rows[0]?.data;
  }

  async query(q: ActivityQuery = {}): Promise<ActivityEntry[]> {
    await this.r();
    let sql = "SELECT data FROM orga_activity";
    const where: string[] = [];
    const params: unknown[] = [];
    if (q.operationName) {
      params.push(q.operationName);
      where.push(`(data->>'operationName') = $${params.length}`);
    }
    if (q.actor) {
      params.push(q.actor);
      where.push(`(data->>'actor') = $${params.length}`);
    }
    if (q.since) {
      params.push(q.since);
      where.push(`(data->>'at') >= $${params.length}`);
    }
    if (where.length > 0) sql += " WHERE " + where.join(" AND ");
    sql += " ORDER BY at ASC";
    if (q.limit) {
      params.push(q.limit);
      sql += ` LIMIT $${params.length}`;
    }
    const res = await this.pool.query<{ data: ActivityEntry }>(sql, params);
    return res.rows.map((r) => r.data);
  }

  async forRecord(nodeType: string, nodeId: string): Promise<ActivityEntry[]> {
    const all = await this.query();
    return all.filter((e) =>
      e.changes.some((c) => c.nodeType === nodeType && c.nodeId === (nodeId as NodeId)),
    );
  }

  async markUndone(entryId: string, byUndoEntryId: string): Promise<void> {
    const entry = await this.get(entryId);
    if (!entry) return;
    entry.outcome = "undone";
    entry.undoneBy = byUndoEntryId;
    await this.pool.query(
      "UPDATE orga_activity SET data=$2 WHERE id=$1",
      [entryId, JSON.stringify(entry)],
    );
  }

  async nextId(): Promise<string> {
    this.seq += 1;
    return `act_${this.seq.toString(36)}`;
  }
}
