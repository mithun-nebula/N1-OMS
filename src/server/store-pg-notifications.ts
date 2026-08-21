import type { Pool } from "pg";
import type { NotificationPersistence, StoredNotification } from "@/spine/bus";

/**
 * Durable backing for the publish bus.
 *
 * One row per delivered notification. `actor` is lifted out of the payload as
 * denormalisation for a future per-actor query — nothing filters on it today,
 * because `PublishBus.load` hydrates a recent window and the bus filters in
 * memory. It carries no index for that reason: an index on a column no query
 * touches is write cost for nothing.
 */
export class PostgresNotificationStore implements NotificationPersistence {
  private ready: Promise<void>;

  constructor(private readonly pool: Pool) {
    this.ready = this.init();
  }

  private async init(): Promise<void> {
    await this.pool.query(`
      CREATE TABLE IF NOT EXISTS orga_notifications (
        id text PRIMARY KEY,
        actor text,
        at text NOT NULL,
        payload jsonb NOT NULL,
        read_at text
      );
      CREATE INDEX IF NOT EXISTS orga_notifications_at
        ON orga_notifications (at DESC);
    `);
  }

  async append(notification: StoredNotification): Promise<void> {
    await this.ready;
    const actor =
      notification.payload.kind === "actor" ? notification.payload.actor : null;
    await this.pool.query(
      `INSERT INTO orga_notifications (id, actor, at, payload, read_at)
       VALUES ($1, $2, $3, $4, $5)
       ON CONFLICT (id) DO NOTHING`,
      [notification.id, actor, notification.at, JSON.stringify(notification.payload), notification.readAt ?? null],
    );
  }

  async loadRecent(limit: number): Promise<StoredNotification[]> {
    await this.ready;
    const res = await this.pool.query<{
      id: string;
      at: string;
      payload: StoredNotification["payload"];
      read_at: string | null;
    }>(
      "SELECT id, at, payload, read_at FROM orga_notifications ORDER BY at DESC LIMIT $1",
      [limit],
    );
    // Oldest first, matching the in-memory history the bus appends to.
    return res.rows
      .map((r) => ({
        id: r.id,
        at: r.at,
        payload: r.payload,
        readAt: r.read_at ?? undefined,
      }))
      .reverse();
  }

  async markRead(ids: string[], at: string): Promise<void> {
    if (ids.length === 0) return;
    await this.ready;
    await this.pool.query(
      "UPDATE orga_notifications SET read_at = $2 WHERE id = ANY($1) AND read_at IS NULL",
      [ids, at],
    );
  }
}
