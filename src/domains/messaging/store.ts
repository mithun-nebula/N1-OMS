import type { ActorId } from "@/spine/operation/types";

/**
 * Chat is deliberately OUTSIDE the operations gate: personal communication,
 * not an org record (same standing as the day-plan engine). No RBAC — every
 * signed-in person can message anyone; the only rule is identity: you can
 * only open conversations you belong to, and that is enforced at the API.
 */

/** DM ids sort the two people so both sides compute the same key. */
export function dmConversationId(a: ActorId, b: ActorId): string {
  return `dm:${[a, b].sort().join("|")}`;
}

export const EVERYONE_CONVERSATION_ID = "group:everyone";

/** The two people in a dm:<a>|<b> id, or null for group ids. */
export function dmParticipants(conversationId: string): [string, string] | null {
  if (!conversationId.startsWith("dm:")) return null;
  const pair = conversationId.slice(3).split("|");
  return pair.length === 2 ? [pair[0], pair[1]] : null;
}

export interface Message {
  id: number;
  conversationId: string;
  from: ActorId;
  text: string;
  at: string;
}

/**
 * Durable backing. Same trade as the day-plan store: writes are
 * fire-and-forget so reads stay synchronous; read-your-own-writes holds
 * within one process.
 */
export interface MessagePersistence {
  saveMessage(message: Message): Promise<void>;
  loadMessages(conversationId: string): Promise<Message[]>;
  saveRead(user: ActorId, conversationId: string, lastReadAt: string): Promise<void>;
  loadReads(user: ActorId): Promise<Array<{ conversationId: string; lastReadAt: string }>>;
  /** Highest message id ever stored, so new ids keep ascending after a restart. */
  maxId(): Promise<number>;
}

export class MessageStore {
  private messages = new Map<string, Message[]>();
  private reads = new Map<string, string>(); // `${user}:${conversationId}` → lastReadAt
  private seq = 0;
  private hydratedConversations = new Set<string>();
  private hydratedReads = new Set<string>();
  private seqHydrated = false;

  constructor(private readonly persistence?: MessagePersistence) {}

  append(conversationId: string, from: ActorId, text: string, at: string): Message {
    this.seq += 1;
    const message: Message = { id: this.seq, conversationId, from, text, at };
    const list = this.messages.get(conversationId) ?? [];
    list.push(message);
    this.messages.set(conversationId, list);
    void this.persistence?.saveMessage(message).catch(() => {});
    // Your own message never counts as unread for you.
    this.markRead(from, conversationId, at);
    return message;
  }

  /** Newest window of a conversation; with afterId, only what arrived since. */
  list(conversationId: string, opts: { afterId?: number; limit?: number } = {}): Message[] {
    const all = this.messages.get(conversationId) ?? [];
    const limit = opts.limit ?? 100;
    if (opts.afterId !== undefined) {
      const after = opts.afterId;
      return all.filter((m) => m.id > after).slice(-limit);
    }
    return all.slice(-limit);
  }

  lastMessage(conversationId: string): Message | undefined {
    const all = this.messages.get(conversationId);
    return all?.[all.length - 1];
  }

  markRead(user: ActorId, conversationId: string, at: string): void {
    const key = `${user}:${conversationId}`;
    const prev = this.reads.get(key);
    if (prev && prev >= at) return;
    this.reads.set(key, at);
    void this.persistence?.saveRead(user, conversationId, at).catch(() => {});
  }

  unreadCount(user: ActorId, conversationId: string): number {
    const lastRead = this.reads.get(`${user}:${conversationId}`);
    const all = this.messages.get(conversationId) ?? [];
    return all.filter((m) => m.from !== user && (!lastRead || m.at > lastRead)).length;
  }

  /**
   * Pull a conversation (and once per process, the user's read marks and the
   * id sequence) back into memory. Awaited by the API before reads.
   */
  async load(user: ActorId, conversationIds: string[]): Promise<void> {
    if (!this.persistence) return;
    if (!this.seqHydrated) {
      this.seqHydrated = true;
      const max = await this.persistence.maxId().catch(() => 0);
      if (max > this.seq) this.seq = max;
    }
    if (!this.hydratedReads.has(user)) {
      this.hydratedReads.add(user);
      for (const r of await this.persistence.loadReads(user).catch(() => [])) {
        const key = `${user}:${r.conversationId}`;
        const prev = this.reads.get(key);
        if (!prev || prev < r.lastReadAt) this.reads.set(key, r.lastReadAt);
      }
    }
    const fresh = conversationIds.filter((id) => !this.hydratedConversations.has(id));
    for (const id of fresh) {
      this.hydratedConversations.add(id);
      const stored = await this.persistence.loadMessages(id).catch(() => [] as Message[]);
      if (stored.length === 0) continue;
      // In-memory messages (arrived while loading) win on id collision.
      const inMemory = this.messages.get(id) ?? [];
      const seen = new Set(inMemory.map((m) => m.id));
      const merged = [...stored.filter((m) => !seen.has(m.id)), ...inMemory].sort((a, b) => a.id - b.id);
      this.messages.set(id, merged);
      const maxStored = stored[stored.length - 1].id;
      if (maxStored > this.seq) this.seq = maxStored;
    }
  }
}
