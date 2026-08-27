import { NextResponse } from "next/server";
import { getSessionUser } from "@/server/auth";
import { getActingUser } from "@/server/session-guard";
import { getMessageStore } from "@/server/runtime";
import { emitChange } from "@/server/live";
import { directory } from "@/server/directory";
import {
  dmConversationId,
  dmParticipants,
  EVERYONE_CONVERSATION_ID,
} from "@/domains/messaging/store";

export const dynamic = "force-dynamic";

/**
 * Chat. Deliberately NO role checks — every signed-in person, intern
 * included, can message anyone and post in the Everyone group. The one rule
 * is identity: a DM can only be opened by one of its two people. Messages
 * live outside the operations gate (personal communication, not an org
 * record), so nothing here lands in the activity log.
 */

const MAX_TEXT = 2000;

function mayOpen(userId: string, conversationId: string): boolean {
  if (conversationId === EVERYONE_CONVERSATION_ID) return true;
  const pair = dmParticipants(conversationId);
  return pair !== null && (pair[0] === userId || pair[1] === userId);
}

async function sidebarFor(userId: string) {
  const store = await getMessageStore();
  const people = directory()
    .all()
    .filter((p) => p.active && p.id !== userId);
  const conversations = [
    { id: EVERYONE_CONVERSATION_ID, name: "Everyone", group: true as const },
    ...people.map((p) => ({
      id: dmConversationId(userId, p.id),
      name: p.name,
      group: false as const,
      personId: p.id,
      role: p.role,
    })),
  ];
  await store.load(userId, conversations.map((c) => c.id));
  return conversations.map((c) => {
    const last = store.lastMessage(c.id);
    return {
      ...c,
      unread: store.unreadCount(userId, c.id),
      lastPreview: last ? last.text.slice(0, 60) : undefined,
      lastFrom: last ? directory().nameOf(last.from) : undefined,
      lastAt: last?.at,
    };
  });
}

export async function GET(request: Request) {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: "Not authenticated." }, { status: 401 });
  const url = new URL(request.url);
  const conversation = url.searchParams.get("conversation");
  const after = url.searchParams.get("after");

  const store = await getMessageStore();
  let messages: unknown[] | undefined;
  if (conversation) {
    if (!mayOpen(user.id, conversation)) {
      return NextResponse.json({ error: "Not your conversation." }, { status: 403 });
    }
    await store.load(user.id, [conversation]);
    messages = store
      .list(conversation, { afterId: after ? Number(after) : undefined })
      .map((m) => ({ ...m, fromName: directory().nameOf(m.from) }));
  }
  return NextResponse.json({
    self: user.id,
    messages,
    conversations: await sidebarFor(user.id),
  });
}

export async function POST(request: Request) {
  const auth = await getActingUser();
  if (!auth.ok) {
    return NextResponse.json({ error: auth.error }, { status: auth.status });
  }
  const user = auth.user;
  let body: { action?: string; conversation?: string; text?: string };
  try {
    body = (await request.json()) as typeof body;
  } catch {
    return NextResponse.json({ error: "Invalid JSON body." }, { status: 400 });
  }
  const conversation = String(body.conversation ?? "");
  if (!conversation || !mayOpen(user.id, conversation)) {
    return NextResponse.json({ error: "Not your conversation." }, { status: 403 });
  }
  const store = await getMessageStore();
  await store.load(user.id, [conversation]);

  if (body.action === "read") {
    store.markRead(user.id, conversation, new Date().toISOString());
    // Live updates: unread badges on the reader's other open tabs.
    emitChange("messages");
    return NextResponse.json({ ok: true });
  }

  const text = String(body.text ?? "").trim();
  if (!text) return NextResponse.json({ error: "Say something first." }, { status: 422 });
  if (text.length > MAX_TEXT) {
    return NextResponse.json({ error: `Keep it under ${MAX_TEXT} characters.` }, { status: 422 });
  }
  const message = store.append(conversation, user.id, text, new Date().toISOString());
  // Live updates: the other person's open chat sees this without reloading.
  emitChange("messages");
  return NextResponse.json({
    message: { ...message, fromName: directory().nameOf(message.from) },
  });
}
