import { describe, it, expect } from "vitest";
import {
  dmConversationId,
  dmParticipants,
  EVERYONE_CONVERSATION_ID,
  MessageStore,
  type Message,
  type MessagePersistence,
} from "./store";

describe("conversation ids", () => {
  it("both sides of a DM compute the same id", () => {
    expect(dmConversationId("priya", "james")).toBe(dmConversationId("james", "priya"));
    expect(dmConversationId("priya", "james")).toBe("dm:james|priya");
  });

  it("participants round-trip; group ids have none", () => {
    expect(dmParticipants("dm:james|priya")).toEqual(["james", "priya"]);
    expect(dmParticipants(EVERYONE_CONVERSATION_ID)).toBeNull();
  });
});

describe("MessageStore — append, list, unread", () => {
  it("appends with ascending ids and lists a window", () => {
    const store = new MessageStore();
    const dm = dmConversationId("priya", "james");
    const m1 = store.append(dm, "priya", "hi", "2026-08-18T09:00:00Z");
    const m2 = store.append(dm, "james", "hello", "2026-08-18T09:01:00Z");
    expect(m2.id).toBeGreaterThan(m1.id);
    expect(store.list(dm).map((m) => m.text)).toEqual(["hi", "hello"]);
    expect(store.list(dm, { afterId: m1.id }).map((m) => m.text)).toEqual(["hello"]);
    expect(store.lastMessage(dm)?.text).toBe("hello");
  });

  it("your own message is never unread for you; reading clears the other side", () => {
    const store = new MessageStore();
    const dm = dmConversationId("priya", "james");
    store.append(dm, "priya", "hi", "2026-08-18T09:00:00Z");
    expect(store.unreadCount("priya", dm)).toBe(0);
    expect(store.unreadCount("james", dm)).toBe(1);
    store.markRead("james", dm, "2026-08-18T09:00:30Z");
    expect(store.unreadCount("james", dm)).toBe(0);
  });

  it("the everyone group counts unread per person", () => {
    const store = new MessageStore();
    store.append(EVERYONE_CONVERSATION_ID, "shruti", "office closed friday", "2026-08-18T09:00:00Z");
    expect(store.unreadCount("ravi", EVERYONE_CONVERSATION_ID)).toBe(1);
    expect(store.unreadCount("shruti", EVERYONE_CONVERSATION_ID)).toBe(0);
  });
});

describe("MessageStore — persistence round-trip (restart survival)", () => {
  class FakePersistence implements MessagePersistence {
    messages: Message[] = [];
    reads = new Map<string, string>();
    async saveMessage(m: Message) {
      this.messages.push(JSON.parse(JSON.stringify(m)) as Message);
    }
    async loadMessages(conversationId: string) {
      return this.messages.filter((m) => m.conversationId === conversationId);
    }
    async saveRead(user: string, conversationId: string, lastReadAt: string) {
      this.reads.set(`${user}:${conversationId}`, lastReadAt);
    }
    async loadReads(user: string) {
      return [...this.reads.entries()]
        .filter(([k]) => k.startsWith(`${user}:`))
        .map(([k, lastReadAt]) => ({ conversationId: k.slice(user.length + 1), lastReadAt }));
    }
    async maxId() {
      return this.messages.reduce((n, m) => Math.max(n, m.id), 0);
    }
  }

  const flush = () => new Promise((r) => setTimeout(r, 0));

  it("messages, read marks and the id sequence survive a fresh store", async () => {
    const persistence = new FakePersistence();
    const a = new MessageStore(persistence);
    const dm = dmConversationId("priya", "james");
    a.append(dm, "priya", "before restart", "2026-08-18T09:00:00Z");
    a.markRead("james", dm, "2026-08-18T09:05:00Z");
    await flush();

    const b = new MessageStore(persistence); // "after the restart"
    await b.load("james", [dm]);
    expect(b.list(dm).map((m) => m.text)).toEqual(["before restart"]);
    expect(b.unreadCount("james", dm)).toBe(0);
    // New ids keep ascending past what was stored.
    const storedId = b.list(dm)[0].id;
    const next = b.append(dm, "james", "after restart", "2026-08-18T10:00:00Z");
    expect(next.id).toBeGreaterThan(storedId);
  });

  it("a second load never clobbers newer in-memory state", async () => {
    const persistence = new FakePersistence();
    const store = new MessageStore(persistence);
    const dm = dmConversationId("priya", "james");
    await store.load("priya", [dm]);
    store.append(dm, "priya", "fresh", "2026-08-18T09:00:00Z");
    await store.load("priya", [dm]); // hydrated → no-op
    expect(store.list(dm)).toHaveLength(1);
  });
});
