"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Avatar, Empty, PageTitle, inputCls } from "../ui/kit";
import { Icon } from "../ui/icons";

interface Turn {
  role: "user" | "assistant";
  content: string;
  /** Present only on this session's answers — the row never stores them. */
  read?: Array<{ type: string; id: string; label?: string }>;
  tools?: string[];
  consulted?: string[];
  truncated?: boolean;
  pending?: boolean;
  failed?: boolean;
}

const SUGGESTIONS = [
  "What's on me today?",
  "Who is off next week?",
  "Which courses are behind?",
];

/**
 * Ask the assistant.
 *
 * ⚠ **`conversationId` is a prop, computed on the server.** Not state, not
 * `localStorage`, not a `useRef(crypto.randomUUID())` — every one of those is
 * stable per device, and feature 07 is *"follows you between phone and
 * computer"*. It is the same string on every device this person signs in from,
 * and it is the reason this screen exists at all: the API has accepted an id
 * since Phase 1a and nothing has ever sent one.
 */
export function AssistantClient({
  conversationId,
  selfName,
}: {
  conversationId: string;
  selfName: string;
}) {
  const [turns, setTurns] = useState<Turn[]>([]);
  const [draft, setDraft] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [loaded, setLoaded] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);

  const scrollToEnd = useCallback(() => {
    requestAnimationFrame(() => {
      scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight });
    });
  }, []);

  // What was said before this tab was opened. The model is sent this history
  // server-side either way; showing it is what makes a returning person's
  // conversation look like one conversation.
  useEffect(() => {
    let live = true;
    fetch("/api/assistant/conversation")
      .then((r) => (r.ok ? r.json() : { turns: [] }))
      .then((data: { turns?: Turn[] }) => {
        if (!live) return;
        setTurns(data.turns ?? []);
        setLoaded(true);
        scrollToEnd();
      })
      .catch(() => {
        if (live) setLoaded(true);
      });
    return () => {
      live = false;
    };
  }, [scrollToEnd]);

  const send = useCallback(
    async (text: string) => {
      const message = text.trim();
      if (!message || busy) return;
      setError(null);
      setDraft("");
      setBusy(true);
      setTurns((prev) => [
        ...prev,
        { role: "user", content: message },
        { role: "assistant", content: "", pending: true },
      ]);
      scrollToEnd();
      try {
        const res = await fetch("/api/assistant/ask", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          // The one line this whole section of the phase is about.
          body: JSON.stringify({ message, conversationId }),
        });
        const data = (await res.json().catch(() => ({}))) as {
          answer?: string;
          read?: Turn["read"];
          tools?: string[];
          consulted?: string[];
          truncated?: boolean;
          error?: string;
        };
        if (!res.ok) {
          setError(data.error ?? "Couldn't reach the assistant — try again.");
          setTurns((prev) => {
            const next = [...prev];
            next[next.length - 1] = {
              role: "assistant",
              content: data.error ?? "That didn't go through.",
              failed: true,
            };
            return next;
          });
          return;
        }
        setTurns((prev) => {
          const next = [...prev];
          next[next.length - 1] = {
            role: "assistant",
            content: data.answer ?? "",
            read: data.read,
            tools: data.tools,
            consulted: data.consulted,
            truncated: data.truncated,
          };
          return next;
        });
      } catch {
        setError("Couldn't reach the server — try again.");
        setTurns((prev) => {
          const next = [...prev];
          next[next.length - 1] = {
            role: "assistant",
            content: "That didn't go through.",
            failed: true,
          };
          return next;
        });
      } finally {
        setBusy(false);
        scrollToEnd();
      }
    },
    [busy, conversationId, scrollToEnd],
  );

  return (
    <div className="flex h-[calc(100dvh-4rem)] flex-col">
      <PageTitle light="Ask" bold="anything" />

      <div ref={scrollRef} className="flex-1 space-y-4 overflow-y-auto px-4 py-4 sm:px-6">
        {loaded && turns.length === 0 && (
          <div className="space-y-4 pt-6">
            <Empty icon="spark" text="Ask a question about your work. It remembers what you said." />
            <div className="flex flex-wrap justify-center gap-2">
              {SUGGESTIONS.map((s) => (
                <button
                  key={s}
                  onClick={() => void send(s)}
                  className="press rounded-full border border-line bg-raised px-3 py-1.5 text-xs font-medium text-ink-soft transition-colors hover:border-accent-strong hover:text-ink"
                >
                  {s}
                </button>
              ))}
            </div>
          </div>
        )}

        {turns.map((turn, i) => (
          <TurnRow key={i} turn={turn} selfName={selfName} />
        ))}
      </div>

      {error && (
        <p className="px-4 pb-1 text-xs font-medium text-danger sm:px-6" role="alert">
          {error}
        </p>
      )}

      <form
        onSubmit={(e) => {
          e.preventDefault();
          void send(draft);
        }}
        className="flex items-center gap-2 border-t border-line bg-surface px-4 py-3 sm:px-6"
      >
        <input
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          placeholder="Ask about your day, your team, your work…"
          aria-label="Ask the assistant"
          disabled={busy}
          className={`${inputCls} flex-1 py-2`}
        />
        <button
          type="submit"
          disabled={busy || draft.trim().length === 0}
          className="press grid h-9 w-9 shrink-0 place-items-center rounded-full bg-accent-strong text-white transition-colors hover:bg-accent disabled:opacity-40"
          aria-label="Send"
        >
          <Icon name="arrow" />
        </button>
      </form>
    </div>
  );
}

function TurnRow({ turn, selfName }: { turn: Turn; selfName: string }) {
  if (turn.role === "user") {
    return (
      <div className="flex items-start justify-end gap-2">
        <p className="max-w-[42rem] rounded-2xl rounded-tr-sm bg-chrome px-3.5 py-2 text-sm text-chrome-ink">
          {turn.content}
        </p>
        <Avatar name={selfName} size={26} />
      </div>
    );
  }

  return (
    <div className="flex items-start gap-2">
      <span className="grid h-[26px] w-[26px] shrink-0 place-items-center rounded-full bg-accent-soft text-accent">
        <Icon name="spark" />
      </span>
      <div className="max-w-[42rem] space-y-1.5">
        <div
          className={`rounded-2xl rounded-tl-sm border border-line bg-raised px-3.5 py-2 text-sm ${
            turn.failed ? "text-danger" : "text-ink"
          }`}
        >
          {turn.pending ? (
            <span className="text-ink-faint">Thinking…</span>
          ) : (
            <p className="whitespace-pre-wrap">{turn.content}</p>
          )}
        </div>

        {/* A cited answer can be checked; an uncited one has to be believed. */}
        {turn.read && turn.read.length > 0 && (
          <p className="px-1 text-[11px] text-ink-faint">
            Read {turn.read.length} record{turn.read.length === 1 ? "" : "s"}
            {turn.consulted && turn.consulted.length > 0 && ` · asked ${turn.consulted.join(", ")}`}
            {turn.truncated && " · partial view"}
          </p>
        )}
      </div>
    </div>
  );
}
