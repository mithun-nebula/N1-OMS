import type { Pool } from "pg";
import type { ModelMessage } from "ai";
import type {
  Conversation,
  ConversationPersistence,
} from "@/domains/assistant/conversation";

/**
 * Durable assistant conversations — one JSONB row per conversation, the same
 * shape `orga_day_plans` uses.
 *
 * Feature 07: the conversation follows a person between their phone and their
 * computer. That only works if it outlives the process holding it.
 */
export class PostgresConversationStore implements ConversationPersistence {
  private ready: Promise<void>;

  constructor(private readonly pool: Pool) {
    this.ready = this.init();
  }

  private async init(): Promise<void> {
    await this.pool.query(`
      CREATE TABLE IF NOT EXISTS orga_conversations (
        id         text PRIMARY KEY,
        actor      text NOT NULL,
        messages   jsonb NOT NULL,
        updated_at text NOT NULL
      );
      -- orga_commitments has had one since Phase 2; this table did not, and
      -- every read that is not by primary key is by actor.
      CREATE INDEX IF NOT EXISTS orga_conversations_actor
        ON orga_conversations (actor);
    `);
  }

  async save(conversation: Conversation): Promise<void> {
    await this.ready;
    await this.pool.query(
      `INSERT INTO orga_conversations (id, actor, messages, updated_at)
       VALUES ($1,$2,$3,$4)
       ON CONFLICT (id) DO UPDATE
         SET actor = EXCLUDED.actor,
             messages = EXCLUDED.messages,
             updated_at = EXCLUDED.updated_at`,
      [
        conversation.id,
        conversation.actor,
        JSON.stringify(conversation.messages),
        conversation.updatedAt,
      ],
    );
  }

  async load(id: string): Promise<Conversation | undefined> {
    await this.ready;
    const res = await this.pool.query<{
      id: string;
      actor: string;
      messages: ModelMessage[];
      updated_at: string;
    }>(
      "SELECT id, actor, messages, updated_at FROM orga_conversations WHERE id=$1",
      [id],
    );
    const row = res.rows[0];
    if (!row) return undefined;
    return {
      id: row.id,
      actor: row.actor,
      // `jsonb` comes back parsed, but a row written by an older shape might
      // not be an array — an unusable history is better dropped than thrown on.
      messages: Array.isArray(row.messages) ? row.messages : [],
      updatedAt: row.updated_at,
    };
  }
}
