"use client";

import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";
import { Avatar, Empty, PageTitle, inputCls } from "../ui/kit";
import { Icon } from "../ui/icons";
import { useLiveEvent } from "../chrome/live";

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
  const [waitingCount, setWaitingCount] = useState(0);
  const scrollRef = useRef<HTMLDivElement>(null);
  const router = useRouter();
  const searchParams = useSearchParams();

  // Anything the conversation prepared (money/people) waits in the approvals
  // inbox for the person's own tap. Surfacing the count here closes the loop —
  // the assistant says "I've prepared it" and the screen shows where it went.
  const checkProposals = useCallback(async () => {
    try {
      const res = await fetch("/api/proposals");
      if (!res.ok) return;
      const body = (await res.json()) as { proposals?: unknown[] };
      setWaitingCount(Array.isArray(body.proposals) ? body.proposals.length : 0);
    } catch {
      /* keep the last count */
    }
  }, []);

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

  useEffect(() => {
    // State only changes after the fetch resolves, never synchronously.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void checkProposals();
  }, [checkProposals]);

  // Live: a proposal made or resolved anywhere (voice included) moves the banner.
  useLiveEvent(() => void checkProposals(), { areas: ["proposals"] });

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
        void checkProposals();
      }
    },
    [busy, conversationId, scrollToEnd, checkProposals],
  );

  /**
   * Appendix A1c — *"every prompt carries an 'explain in chat' option, which
   * opens the conversation with that item already loaded"*.
   *
   * A dashboard prompt links here with `?ask=…` and the question is asked on
   * arrival, so the conversation opens already about that item rather than at a
   * blank box the person has to retype the question into.
   *
   * ⚠ The parameter is cleared before sending. Otherwise a reload — or the back
   * button — would ask it again, and the transcript would fill with duplicates
   * nobody typed. `askedFromUrl` guards the same thing within one mount.
   *
   * Waits for `loaded`: sending before the history arrives would put the new
   * turn above the conversation it belongs to.
   */
  const askedFromUrl = useRef(false);
  useEffect(() => {
    if (askedFromUrl.current || !loaded) return;
    const q = searchParams.get("ask");
    if (!q) return;
    askedFromUrl.current = true;
    router.replace("/assistant");
    // Deferred a task so the send — and the state it writes — happens after
    // this effect returns rather than synchronously inside it.
    const t = setTimeout(() => void send(q), 0);
    return () => clearTimeout(t);
  }, [loaded, searchParams, router, send]);

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

      {waitingCount > 0 && (
        <Link
          href="/approvals"
          className="press mx-4 mb-2 flex items-center gap-3 rounded-2xl border-l-[3px] border-accent-strong bg-accent-soft px-4 py-2.5 sm:mx-6"
        >
          <span className="grid h-7 w-7 shrink-0 place-items-center rounded-full bg-accent-strong text-white">
            <Icon name="check" className="h-3.5 w-3.5" />
          </span>
          <span className="min-w-0 flex-1 text-xs font-medium text-ink">
            {waitingCount === 1
              ? "One prepared action is waiting for your hand"
              : `${waitingCount} prepared actions are waiting for your hand`}
          </span>
          <span className="shrink-0 text-xs font-semibold text-accent-strong">Open →</span>
        </Link>
      )}

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

/*
 * While the coordinator works, the screen shows what that work looks like —
 * routing, consulting specialists, reading records. The stages are cosmetic
 * (the answer arrives in one piece), but they mirror what the backend really
 * does, and the truthful summary appears under the finished answer: which
 * specialists were actually asked, and which records were actually read.
 */
const THINKING_STAGES = [
  "Routing to the right specialist…",
  "Consulting specialists…",
  "Reading your records…",
  "Putting the answer together…",
];

function ThinkingLine() {
  const [stage, setStage] = useState(0);
  useEffect(() => {
    const iv = setInterval(
      () => setStage((s) => Math.min(s + 1, THINKING_STAGES.length - 1)),
      1600,
    );
    return () => clearInterval(iv);
  }, []);
  return (
    <span className="flex items-center gap-2 text-ink-faint">
      <span className="flex gap-1">
        <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-accent-strong [animation-delay:0ms]" />
        <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-accent-strong [animation-delay:150ms]" />
        <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-accent-strong [animation-delay:300ms]" />
      </span>
      <span className="fade-in" key={stage}>
        {THINKING_STAGES[stage]}
      </span>
    </span>
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
      <span
        className={`grid h-[26px] w-[26px] shrink-0 place-items-center rounded-full bg-accent-soft text-accent ${
          turn.pending ? "animate-pulse" : ""
        }`}
      >
        <Icon name="spark" />
      </span>
      <div className="max-w-[42rem] space-y-1.5">
        <div
          className={`rounded-2xl rounded-tl-sm border border-line bg-raised px-3.5 py-2 text-sm ${
            turn.failed ? "text-danger" : "text-ink"
          }`}
        >
          {turn.pending ? (
            <ThinkingLine />
          ) : (
            <p className="whitespace-pre-wrap">{turn.content}</p>
          )}
        </div>

        {/* A cited answer can be checked; an uncited one has to be believed. */}
        {!turn.pending &&
          ((turn.consulted && turn.consulted.length > 0) ||
            (turn.read && turn.read.length > 0)) && (
            <div className="flex flex-wrap items-center gap-1.5 px-1">
              {(turn.consulted ?? []).map((s) => (
                <span
                  key={s}
                  className="flex items-center gap-1 rounded-full bg-mint px-2 py-0.5 text-[10px] font-semibold text-mint-strong"
                  title={`The ${s} specialist was consulted`}
                >
                  <Icon name="check" className="h-2.5 w-2.5" />
                  {s}
                </span>
              ))}
              {(turn.read ?? []).slice(0, 6).map((r, i) => (
                <span
                  key={`${r.type}-${r.id}-${i}`}
                  className="rounded-full bg-raised px-2 py-0.5 text-[10px] font-medium text-ink-faint"
                  title={`Read: ${r.type} ${r.id}`}
                >
                  {r.label ?? r.type}
                </span>
              ))}
              {(turn.read ?? []).length > 6 && (
                <span className="text-[10px] text-ink-faint">
                  +{(turn.read ?? []).length - 6} more
                </span>
              )}
              {turn.truncated && (
                <span className="text-[10px] text-ink-faint">· partial view</span>
              )}
            </div>
          )}
      </div>
    </div>
  );
}
