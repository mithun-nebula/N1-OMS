"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Avatar, AvatarStack, inputCls } from "../ui/kit";
import { Icon } from "../ui/icons";

interface Conversation {
  id: string;
  name: string;
  group: boolean;
  personId?: string;
  role?: string;
  unread: number;
  lastPreview?: string;
  lastFrom?: string;
  lastAt?: string;
}

interface ChatMessage {
  id: number;
  conversationId: string;
  from: string;
  fromName: string;
  text: string;
  at: string;
  /** Client-only marker for an optimistic message awaiting the server. */
  pending?: boolean;
}

const POLL_MS = 4000;

function timeOf(at: string): string {
  return at.slice(11, 16);
}

function dayOf(at: string): string {
  return at.slice(0, 10);
}

/**
 * Chat. One-to-one plus the Everyone group; no roles, no gate — see
 * /api/messages. Single poll drives both panes: new messages for the open
 * conversation and unread counts for the sidebar.
 */
export function MessagesClient({ selfId, selfName }: { selfId: string; selfName: string }) {
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [openId, setOpenId] = useState<string | null>(null);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [draft, setDraft] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loaded, setLoaded] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);
  // Written only in the open/close handlers (never during render) so the
  // polling closure always sees the conversation that is actually open.
  const openIdRef = useRef<string | null>(null);
  const lastIdRef = useRef(0);
  const pendingSeq = useRef(0);

  const scrollToEnd = useCallback(() => {
    requestAnimationFrame(() => {
      scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight });
    });
  }, []);

  const poll = useCallback(async () => {
    const conversation = openIdRef.current;
    const after = conversation ? lastIdRef.current : undefined;
    const params = new URLSearchParams();
    if (conversation) {
      params.set("conversation", conversation);
      if (after) params.set("after", String(after));
    }
    try {
      const res = await fetch(`/api/messages?${params}`);
      if (!res.ok) return;
      const data = (await res.json()) as {
        messages?: ChatMessage[];
        conversations: Conversation[];
      };
      // A slow response for a conversation the user has already left must
      // not leak into the newly opened one.
      if (openIdRef.current !== conversation) return;
      setConversations(data.conversations);
      setLoaded(true);
      if (conversation && data.messages && data.messages.length > 0) {
        const fresh = data.messages;
        setMessages((prev) => {
          // Server messages replace optimistic ones with the same text/sender.
          const withoutMatchedPending = prev.filter(
            (m) => !(m.pending && fresh.some((f) => f.from === m.from && f.text === m.text)),
          );
          const seen = new Set(withoutMatchedPending.map((m) => m.id));
          return [...withoutMatchedPending, ...fresh.filter((f) => !seen.has(f.id))];
        });
        lastIdRef.current = Math.max(lastIdRef.current, ...fresh.map((m) => m.id));
        scrollToEnd();
        // Whatever just arrived is on screen — mark it read.
        void fetch("/api/messages", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ action: "read", conversation }),
        }).catch(() => {});
      }
    } catch {
      // Network hiccup — next tick retries; the last state stays on screen.
    }
  }, [scrollToEnd]);

  useEffect(() => {
    // First tick deferred a task so no state lands synchronously in the effect.
    const t0 = setTimeout(() => void poll(), 0);
    const t = setInterval(() => void poll(), POLL_MS);
    return () => {
      clearTimeout(t0);
      clearInterval(t);
    };
  }, [poll]);

  function openConversation(id: string) {
    openIdRef.current = id;
    setOpenId(id);
    setMessages([]);
    setError(null);
    lastIdRef.current = 0;
    setConversations((prev) => prev.map((c) => (c.id === id ? { ...c, unread: 0 } : c)));
    // Immediate fetch rather than waiting for the next tick.
    setTimeout(() => void poll(), 0);
  }

  function closeConversation() {
    openIdRef.current = null;
    setOpenId(null);
  }

  async function send() {
    const text = draft.trim();
    const conversation = openId;
    if (!text || !conversation) return;
    setError(null);
    setDraft("");
    pendingSeq.current -= 1;
    const optimistic: ChatMessage = {
      id: pendingSeq.current, // negative, never collides with server ids
      conversationId: conversation,
      from: selfId,
      fromName: selfName,
      text,
      at: new Date().toISOString(),
      pending: true,
    };
    setMessages((prev) => [...prev, optimistic]);
    scrollToEnd();
    try {
      const res = await fetch("/api/messages", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ conversation, text }),
      });
      const data = (await res.json().catch(() => ({}))) as {
        message?: ChatMessage;
        error?: string;
      };
      if (!res.ok || !data.message) {
        // Failed — take the bubble back and give the user their text again.
        setMessages((prev) => prev.filter((m) => m.id !== optimistic.id));
        setDraft(text);
        setError(data.error ?? "Couldn't send — try again.");
        return;
      }
      const sent = data.message;
      setMessages((prev) => prev.map((m) => (m.id === optimistic.id ? sent : m)));
      lastIdRef.current = Math.max(lastIdRef.current, sent.id);
    } catch {
      setMessages((prev) => prev.filter((m) => m.id !== optimistic.id));
      setDraft(text);
      setError("Couldn't reach the server — try again.");
    }
  }

  const open = conversations.find((c) => c.id === openId);
  const totalUnread = conversations.reduce((n, c) => n + c.unread, 0);

  return (
    <div className="mx-auto flex h-[calc(100vh-1rem)] max-w-6xl flex-col p-4 md:h-screen md:p-6">
      <header className="rise mb-4 flex items-center justify-between">
        <h1 className="text-2xl font-light tracking-tight text-ink sm:text-3xl">
          <span className="font-extrabold">Messages</span>
          {totalUnread > 0 && (
            <span className="pulse-dot ml-2.5 inline-grid h-6 min-w-6 place-items-center rounded-full bg-accent px-1.5 align-middle text-xs font-bold text-chrome">
              {totalUnread > 99 ? "99+" : totalUnread}
            </span>
          )}
        </h1>
      </header>

      <div className="flex min-h-0 flex-1 gap-4">
        {/* ===== Sidebar — hidden on mobile while a chat is open ===== */}
        <aside
          className={`${open ? "hidden md:flex" : "flex"} w-full flex-col overflow-y-auto rounded-3xl bg-surface p-2.5 shadow-card md:w-72 md:shrink-0`}
        >
          {!loaded ? (
            <p className="fade-in px-3 py-4 text-sm text-ink-faint">Loading…</p>
          ) : (
            conversations.map((c, i) => (
              <button
                key={c.id}
                onClick={() => openConversation(c.id)}
                className={`press rise flex w-full items-center gap-2.5 rounded-2xl px-3 py-2.5 text-left transition-colors ${
                  c.id === openId ? "bg-accent-soft" : "hover:bg-raised"
                }`}
                style={{ animationDelay: `${Math.min(i * 20, 240)}ms` }}
              >
                {c.group ? (
                  <span className="grid h-9 w-9 shrink-0 place-items-center rounded-full bg-chrome text-accent">
                    <Icon name="team" className="h-4.5 w-4.5" />
                  </span>
                ) : (
                  <Avatar name={c.name} size={36} />
                )}
                <span className="min-w-0 flex-1">
                  <span className="flex items-baseline justify-between gap-2">
                    <span className={`truncate text-[13px] ${c.unread > 0 ? "font-bold text-ink" : "font-medium text-ink"}`}>
                      {c.name}
                    </span>
                    {c.lastAt && (
                      <span className="shrink-0 text-[10px] text-ink-faint">{timeOf(c.lastAt)}</span>
                    )}
                  </span>
                  <span className="block truncate text-[11px] text-ink-faint">
                    {c.lastPreview
                      ? `${c.group && c.lastFrom ? `${c.lastFrom}: ` : ""}${c.lastPreview}`
                      : c.group
                        ? "The whole organisation"
                        : (c.role ?? "")}
                  </span>
                </span>
                {c.unread > 0 && (
                  <span className="pulse-dot grid h-5 min-w-5 shrink-0 place-items-center rounded-full bg-accent px-1 text-[10px] font-bold text-chrome">
                    {c.unread > 9 ? "9+" : c.unread}
                  </span>
                )}
              </button>
            ))
          )}
        </aside>

        {/* ===== Chat pane ===== */}
        <section
          className={`${open ? "flex" : "hidden md:flex"} min-w-0 flex-1 flex-col rounded-3xl bg-surface shadow-card`}
        >
          {!open ? (
            <div className="fade-in grid flex-1 place-items-center p-8 text-center">
              <div>
                <Icon name="chat" className="mx-auto h-10 w-10 text-ink-faint" />
                <p className="mt-3 text-sm text-ink-soft">Pick a person — or talk to everyone.</p>
              </div>
            </div>
          ) : (
            <>
              <div className="flex items-center gap-2.5 border-b border-line px-4 py-3">
                <button
                  onClick={closeConversation}
                  aria-label="Back to conversations"
                  className="press -ml-1 grid h-8 w-8 place-items-center rounded-full text-ink-soft hover:bg-raised md:hidden"
                >
                  <Icon name="arrow" className="h-4 w-4 rotate-180" />
                </button>
                {open.group ? (
                  <AvatarStack names={conversations.filter((c) => !c.group).map((c) => c.name)} />
                ) : (
                  <Avatar name={open.name} />
                )}
                <div className="min-w-0">
                  <div className="truncate text-sm font-bold text-ink">{open.name}</div>
                  <div className="text-[11px] text-ink-faint">
                    {open.group ? "Everyone in the organisation" : (open.role ?? "")}
                  </div>
                </div>
              </div>

              <div ref={scrollRef} className="flex-1 overflow-y-auto px-4 py-3">
                {messages.length === 0 ? (
                  <p className="fade-in py-8 text-center text-sm text-ink-faint">
                    No messages yet — say hi.
                  </p>
                ) : (
                  messages.map((m, i) => {
                    const mine = m.from === selfId;
                    const prev = messages[i - 1];
                    const newDay = !prev || dayOf(prev.at) !== dayOf(m.at);
                    const sameSender = prev && prev.from === m.from && !newDay;
                    return (
                      <div key={m.id}>
                        {newDay && (
                          <div className="my-3 text-center text-[10px] font-semibold uppercase tracking-widest text-ink-faint">
                            {dayOf(m.at)}
                          </div>
                        )}
                        <div className={`pop-in flex ${mine ? "justify-end" : "justify-start"} ${sameSender ? "mt-0.5" : "mt-2.5"}`}>
                          {!mine && !open.group && <span className="w-0" />}
                          {!mine && open.group && (
                            <span className={`mr-2 shrink-0 self-end ${sameSender ? "invisible" : ""}`}>
                              <Avatar name={m.fromName} size={22} />
                            </span>
                          )}
                          <div
                            className={`max-w-[78%] rounded-2xl px-3.5 py-2 text-[13px] leading-relaxed shadow-card ${
                              mine
                                ? `rounded-br-md bg-chrome text-chrome-ink ${m.pending ? "opacity-60" : ""}`
                                : "rounded-bl-md bg-raised text-ink"
                            }`}
                          >
                            {!mine && open.group && !sameSender && (
                              <div className="mb-0.5 text-[11px] font-bold text-accent-strong">{m.fromName}</div>
                            )}
                            <span className="whitespace-pre-wrap break-words">{m.text}</span>
                            <span className={`ml-2 align-baseline text-[9px] ${mine ? "text-chrome-soft" : "text-ink-faint"}`}>
                              {timeOf(m.at)}
                            </span>
                          </div>
                        </div>
                      </div>
                    );
                  })
                )}
              </div>

              {error && (
                <p role="alert" className="shake mx-4 mb-1 rounded-xl bg-danger-soft px-3 py-2 text-xs font-medium text-danger">
                  {error}
                </p>
              )}

              <div className="flex items-end gap-2 border-t border-line p-3">
                <textarea
                  value={draft}
                  onChange={(e) => setDraft(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" && !e.shiftKey) {
                      e.preventDefault();
                      void send();
                    }
                  }}
                  rows={1}
                  placeholder={`Message ${open.group ? "everyone" : open.name}…`}
                  className={`${inputCls} max-h-28 min-h-10 w-full flex-1 resize-none py-2.5`}
                />
                <button
                  onClick={() => void send()}
                  disabled={!draft.trim()}
                  aria-label="Send"
                  className="press grid h-10 w-10 shrink-0 place-items-center rounded-full bg-accent-strong text-white transition-colors hover:bg-accent disabled:opacity-40"
                >
                  <Icon name="arrow" className="h-4.5 w-4.5" />
                </button>
              </div>
            </>
          )}
        </section>
      </div>
    </div>
  );
}
