import type { Pool } from "pg";
import type { ActorId } from "@/spine/operation/types";
import type { Message, MessagePersistence } from "@/domains/messaging/store";

/**
 * Durable backing for chat. Messages get sequence ids so `after` pagination
 * is a plain integer comparison; read marks are one row per (user,
 * conversation).
 */
export class PostgresMessagePersistence implements MessagePersistence {
  private ready: Promise<void>;

  constructor(private readonly pool: Pool) {
    this.ready = this.init();
  }

  private async init(): Promise<void> {
    await this.pool.query(`
      CREATE TABLE IF NOT EXISTS orga_messages (
        id bigint PRIMARY KEY,
        conversation_id text NOT NULL,
        sender text NOT NULL,
        text text NOT NULL,
        at timestamptz NOT NULL
      );
      CREATE INDEX IF NOT EXISTS orga_messages_conversation
        ON orga_messages (conversation_id, id);
      CREATE TABLE IF NOT EXISTS orga_message_reads (
        username text NOT NULL,
        conversation_id text NOT NULL,
        last_read_at timestamptz NOT NULL,
        PRIMARY KEY (username, conversation_id)
      );
    `);
  }

  async saveMessage(message: Message): Promise<void> {
    await this.ready;
    await this.pool.query(
      `INSERT INTO orga_messages (id, conversation_id, sender, text, at)
       VALUES ($1, $2, $3, $4, $5) ON CONFLICT (id) DO NOTHING`,
      [message.id, message.conversationId, message.from, message.text, message.at],
    );
  }

  async loadMessages(conversationId: string): Promise<Message[]> {
    await this.ready;
    const res = await this.pool.query<{
      id: string;
      conversation_id: string;
      sender: string;
      text: string;
      at: Date;
    }>(
      "SELECT id, conversation_id, sender, text, at FROM orga_messages WHERE conversation_id=$1 ORDER BY id",
      [conversationId],
    );
    return res.rows.map((r) => ({
      id: Number(r.id),
      conversationId: r.conversation_id,
      from: r.sender,
      text: r.text,
      at: r.at.toISOString(),
    }));
  }

  async saveRead(user: ActorId, conversationId: string, lastReadAt: string): Promise<void> {
    await this.ready;
    await this.pool.query(
      `INSERT INTO orga_message_reads (username, conversation_id, last_read_at)
       VALUES ($1, $2, $3)
       ON CONFLICT (username, conversation_id)
       DO UPDATE SET last_read_at = GREATEST(orga_message_reads.last_read_at, EXCLUDED.last_read_at)`,
      [user, conversationId, lastReadAt],
    );
  }

  async loadReads(user: ActorId): Promise<Array<{ conversationId: string; lastReadAt: string }>> {
    await this.ready;
    const res = await this.pool.query<{ conversation_id: string; last_read_at: Date }>(
      "SELECT conversation_id, last_read_at FROM orga_message_reads WHERE username=$1",
      [user],
    );
    return res.rows.map((r) => ({
      conversationId: r.conversation_id,
      lastReadAt: r.last_read_at.toISOString(),
    }));
  }

  async maxId(): Promise<number> {
    await this.ready;
    const res = await this.pool.query<{ max: string | null }>(
      "SELECT MAX(id) AS max FROM orga_messages",
    );
    return Number(res.rows[0]?.max ?? 0);
  }
}
