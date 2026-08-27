"use client";

import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import { Icon } from "../ui/icons";
import { fmtTime } from "../ui/dates";

/*
 * The two moments the day plan actually needs to talk to somebody, as a
 * conversation in the middle of the screen rather than a strip at the edge.
 *
 * ── ⚠ WHY THIS MAY OPEN ITSELF, WHEN A1c SAYS THE CHAT MAY NOT ──────────────
 *
 * Appendix A1c: *"The chat never opens by itself **while you are working**."*
 * The qualifier is the whole rule, and A4 draws the same line twice:
 *
 *   mid-task, an OFFER      "this is overrunning, your 12:00 will not fit"
 *                           -> stays a quiet strip on the dashboard. Never this.
 *   after it, a QUESTION    "what happened?" — asked "when you tick the item
 *                           complete late, or at the end of the day, NEVER
 *                           while you are mid-task"
 *                           -> this dialog.
 *
 * Both flows below are the second kind. A ran-over question is offered only
 * once the item has been ticked late or the day is closing, and the close-out
 * only exists after clocking out. Nobody is mid-task at either moment, so
 * opening a conversation is the helpful thing rather than the thing people
 * switch off. An interrupted miss opens nothing at all — the application knows
 * why, and A2 is explicit that asking what it knows is what breaks trust.
 *
 * ── The script follows the data, it does not count through an array ─────────
 *
 * Each answer changes the day, and the next question is derived from the day as
 * it now stands — carrying an item over removes it from `unfinished`, so the
 * next open item simply becomes the current one. An index into a list that
 * shrinks underneath it would skip every other question.
 */

interface Bubble {
  who: "it" | "you";
  text: string;
}

interface Reply {
  label: string;
  /** Returning a string queues it as the assistant's next line. */
  run: () => Promise<string | void> | string | void;
  tone?: "go" | "plain";
}

interface Step {
  /** Stable across renders — this is what drives the reveal, not object identity. */
  key: string;
  say: string[];
  replies: Reply[];
  freeText?: { placeholder: string; submit: (text: string) => Promise<string | void> };
  /** Deep link into the full assistant, carrying the subject. */
  explain?: string;
}

function fmtMin(total: number): string {
  const h = Math.floor(total / 60);
  const m = total % 60;
  if (h === 0) return `${m}m`;
  return m === 0 ? `${h}h` : `${h}h ${m}m`;
}

/** The clock, from the one place dates are written. */
const fmtClock = fmtTime;

/** Something that can be taken on today, offered in the picker. */
export interface Pickable {
  label: string;
  /** Present when it is a task on the board, so the two views stay in step. */
  ref?: { nodeType: string; nodeId: string };
  /** "in progress" · "not started" · "from your brief" — said out loud. */
  origin: string;
  /** What this took last time, where the application has learned it (A5). */
  learnedMinutes?: number;
}

export interface DayChatProps {
  onClose: () => void;
  /**
   * The morning itself — the brief, then choosing the day, then committing.
   *
   * The assistant runs it: it raises each brief item, waits, then asks what
   * they are taking on and how long each will take, and commits when they say
   * so. A1: *"the brief arrives as a conversation — not a list of cards on a
   * screen"*, and *"every question carries tappable replies"*.
   */
  plan?: {
    phase: "briefing" | "planning" | "abandoned";
    briefItem: { text: string; replies: string[]; index: number; total: number } | null;
    /** Everything still available to take on, already de-duplicated. */
    pickable: Pickable[];
    /** What is on the day so far. */
    committed: Array<{ id: string; label: string; estimateMinutes: number }>;
    tally: { meetings: number; work: number; free: number };
  };
  /** A slot about to end, while the work can still be rescued. */
  check?: { id: string; label: string; end?: string };
  /** Ran over, and the application does not know why. */
  miss?: { id: string; label: string; estimateMinutes: number };
  /** The day, closing. */
  closeOut?: {
    committed: number;
    done: number;
    committedMinutes: number;
    workedMinutes: number;
    dropped: number;
    shortfallMinutes: number;
    ranOver: Array<{ id: string; label: string; byMinutes: number }>;
    unfinished: Array<{
      id: string;
      label: string;
      estimateMinutes: number;
      progressMinutes: number;
      shortfallMinutes: number;
      interrupted: boolean;
    }>;
  };
  onAnswerBrief?: (reply: string) => Promise<void>;
  onSelect?: (label: string, minutes: number, ref?: { nodeType: string; nodeId: string }) => Promise<void>;
  onCommit?: () => Promise<void>;
  onStatusCheck?: (
    itemId: string,
    status: "on-time" | "more-time" | "blocked",
  ) => Promise<{ atRisk?: string } | void>;
  onMissReason: (itemId: string, reason: string) => Promise<{ learnedEstimate?: number } | void>;
  onCarryOver: (itemId: string) => Promise<void>;
  onDrop: (itemId: string) => Promise<void>;
  onPartDone: (itemId: string, minutes: number) => Promise<void>;
  onFinish: () => Promise<void>;
  /** Anything they choose to say about the day — kept in their conversation. */
  onNote: (text: string) => Promise<void>;
  firstName: string;
}

/** The times a person can give a piece of work, as A1 requires one. */
const TIMES = [15, 30, 45, 60, 90, 120, 180];

export function DayChat(props: DayChatProps) {
  const { onClose, plan, check, miss, closeOut, firstName } = props;
  const [said, setSaid] = useState<Bubble[]>([]);
  const [busy, setBusy] = useState(false);
  const [draft, setDraft] = useState("");
  const [showText, setShowText] = useState(false);
  /** The summary has been read; move on to what it cannot know. */
  const [acked, setAcked] = useState(false);
  /** The one open question about the day itself, asked once. */
  const [noted, setNoted] = useState(false);
  const [closed, setClosed] = useState(false);
  /** The item being given a time — A1: nothing is committed without one. */
  const [pending, setPending] = useState<Pickable | null>(null);
  /** They said that is everything; confirm the shape of the day, then commit. */
  const [readyToCommit, setReadyToCommit] = useState(false);
  const endRef = useRef<HTMLDivElement>(null);

  /* ── The current question, derived from the day as it now stands ─────────── */
  function step(): Step | null {
    if (closed) return null;

    /* ── The morning: brief, then choose the day, then commit ─────────────── */
    if (plan) {
      // 1 · The brief, one item at a time, waiting for an answer before moving
      //     on (A1). The replies come from the service, not from here.
      if (plan.phase === "briefing" || plan.briefItem) {
        const item = plan.briefItem;
        if (!item) {
          return {
            key: "brief-done",
            say: ["That's your brief."],
            replies: [
              {
                label: "Plan my day",
                tone: "go",
                run: () => props.onAnswerBrief?.("Got it"),
              },
            ],
          };
        }
        return {
          key: `brief:${item.index}`,
          say: [item.text],
          replies: item.replies.map((r) => ({
            label: r,
            tone: r === item.replies[0] ? "go" : undefined,
            run: () => props.onAnswerBrief?.(r),
          })),
        };
      }

      // 2 · A time for the thing they just picked. Required, and the service
      //     refuses without it — so it is asked here rather than assumed.
      if (pending) {
        const suggested = pending.learnedMinutes;
        const times = suggested && !TIMES.includes(suggested) ? [suggested, ...TIMES] : TIMES;
        return {
          key: `time:${pending.label}`,
          say: [
            `How long for ${pending.label}?` +
              (suggested ? ` It usually takes about ${fmtMin(suggested)}.` : ""),
          ],
          replies: times.slice(0, 6).map((m) => ({
            label: fmtMin(m),
            tone: m === suggested ? "go" : undefined,
            run: async () => {
              const picked = pending;
              setPending(null);
              await props.onSelect?.(picked.label, m, picked.ref);
              return `${picked.label} — ${fmtMin(m)}. Anything else?`;
            },
          })),
        };
      }

      // 3 · The shape of the day, before it is committed.
      if (readyToCommit) {
        const list = plan.committed.map((c) => `${c.label} (${fmtMin(c.estimateMinutes)})`);
        const overCapacity = plan.tally.work + plan.tally.meetings > 8 * 60;
        return {
          key: "confirm",
          say: [
            list.length > 0
              ? `So today: ${list.join(", ")}.`
              : "Nothing chosen yet — you can still commit an empty day.",
            `${fmtMin(plan.tally.work)} of work around ${fmtMin(plan.tally.meetings)} of meetings, ${fmtMin(plan.tally.free)} free.` +
              (overCapacity ? " That is more than the day holds — I'll say so now rather than at six." : ""),
          ],
          replies: [
            {
              label: "Commit my day",
              tone: "go",
              run: async () => {
                await props.onCommit?.();
                setClosed(true);
                setTimeout(onClose, 1800);
                return "Committed. It's on your dashboard, around your meetings — reorder it whenever you like.";
              },
            },
            { label: "Add something else", run: () => setReadyToCommit(false) },
          ],
        };
      }

      // 4 · What are you taking on? Offered as taps, never as a blank box.
      const offered = plan.pickable.slice(0, 6);
      return {
        // Stable: the picker is returned to after every item, and a key that
        // counted the items would make it re-introduce itself each time.
        key: "pick",
        say: ["What are you taking on today? Pick one at a time — I'll ask how long for each."],
        replies: [
          ...offered.map((p) => ({
            label: p.label,
            run: () => setPending(p),
          })),
          {
            label: plan.committed.length > 0 ? "That's everything" : "Nothing today",
            tone: "go" as const,
            run: () => setReadyToCommit(true),
          },
        ],
        freeText: {
          placeholder: "Something else you're doing today…",
          submit: async (text) => {
            setPending({ label: text, origin: "your own words" });
          },
        },
      };
    }

    /* ── A slot about to end, while it can still be rescued ───────────────── */
    if (check) {
      const answer = async (status: "on-time" | "more-time" | "blocked", line: string) => {
        const out = await props.onStatusCheck?.(check.id, status);
        const risked = out && "atRisk" in out ? out.atRisk : undefined;
        setClosed(true);
        setTimeout(onClose, risked ? 3200 : 1800);
        return risked
          ? `${line} The time you committed still stands, so ${risked} is now at risk.`
          : line;
      };
      return {
        key: `check:${check.id}`,
        say: [
          `${check.label} is due to finish${check.end ? ` at ${fmtClock(check.end)}` : ""}.`,
          "How is it going?",
        ],
        replies: [
          { label: "On time", tone: "go", run: () => answer("on-time", "Good — I'll leave you to it.") },
          { label: "Need more time", run: () => answer("more-time", "Noted.") },
          { label: "Blocked", run: () => answer("blocked", "Noted.") },
        ],
        explain: `How is "${check.label}" affecting the rest of my day?`,
      };
    }

    if (miss) {
      const answer = async (reason: string) => {
        const out = await props.onMissReason(miss.id, reason);
        const learned = out && "learnedEstimate" in out ? out.learnedEstimate : undefined;
        setClosed(true);
        // A4: one short question, and only one. Let them read the reply.
        setTimeout(onClose, 2200);
        return learned
          ? `Noted. This work usually takes about ${fmtMin(learned)} — I'll plan for that next time.`
          : "Noted — I'll use that when this comes round again.";
      };
      return {
        key: `miss:${miss.id}`,
        say: [
          `${miss.label} ran over the ${fmtMin(miss.estimateMinutes)} you planned for it.`,
          "What happened? It goes into planning this work better, never against you.",
        ],
        replies: ["Bigger than expected", "Interruptions", "Waiting on someone"].map((r) => ({
          label: r,
          run: () => answer(r),
        })),
        freeText: { placeholder: "Or say what happened…", submit: answer },
        explain: `"${miss.label}" took longer than I planned. Can we talk about it?`,
      };
    }

    if (!closeOut) return null;

    // 1 · What it already knows. A statement, never "what did you do today?".
    if (!acked) {
      const ranOver = closeOut.ranOver
        .map((r) => `${r.label} ran over by ${fmtMin(r.byMinutes)}.`)
        .join(" ");
      return {
        key: "summary",
        say: [
          `That's the day, ${firstName}.`,
          `You finished ${closeOut.done} of ${closeOut.committed}` +
            (closeOut.committedMinutes > 0
              ? ` — ${fmtMin(closeOut.workedMinutes)} of the ${fmtMin(closeOut.committedMinutes)} you committed`
              : "") +
            `.${closeOut.dropped > 0 ? ` ${closeOut.dropped} dropped.` : ""}${ranOver ? ` ${ranOver}` : ""}`,
        ],
        replies: [
          {
            label: closeOut.unfinished.length > 0 ? "What's still open?" : "Good",
            tone: "go",
            run: () => setAcked(true),
          },
        ],
      };
    }

    // 2 · What it cannot know: what happens to each thing still open. The list
    //     shrinks as they answer, so the first entry is always the live one.
    const open = closeOut.unfinished[0];
    if (open) {
      return {
        key: `open:${open.id}`,
        say: [
          `${open.label} is still open` +
            (open.progressMinutes > 0
              ? ` — ${fmtMin(open.progressMinutes)} done, ${fmtMin(open.shortfallMinutes)} left`
              : "") +
            `.` +
            (open.interrupted
              ? " Something else took that time, so it is not counted against you."
              : ""),
          "What should happen to it?",
        ],
        replies: [
          {
            label: "Carry to tomorrow",
            tone: "go",
            run: async () => {
              await props.onCarryOver(open.id);
              return "Carried. It comes back in the morning — you'll still choose it, and give it a time, then.";
            },
          },
          {
            label: "Part done",
            run: async () => {
              await props.onPartDone(open.id, Math.round(open.estimateMinutes / 2));
              return "Progress recorded — only the remainder is owed.";
            },
          },
          {
            label: "Drop it",
            run: async () => {
              await props.onDrop(open.id);
              return "Dropped. It won't come back, and it doesn't break your streak.";
            },
          },
        ],
      };
    }

    // 3 · The one thing about the day it genuinely cannot see.
    if (!noted) {
      const note = async (text: string) => {
        await props.onNote(text);
        setNoted(true);
        return "Noted — I'll have that tomorrow.";
      };
      return {
        key: "note",
        say: ["How was the day itself?"],
        replies: [
          { label: "A good one", run: () => note("Today went well.") },
          { label: "Hard going", run: () => note("Today was hard going.") },
          { label: "Skip", run: () => setNoted(true) },
        ],
        freeText: {
          placeholder: "Anything worth remembering about today…",
          submit: note,
        },
      };
    }

    // 4 · Close it.
    return {
      key: "finish",
      say: ["Anything carried over comes back in tomorrow's brief. Shall I close the day?"],
      replies: [
        {
          label: "That's the day",
          tone: "go",
          run: async () => {
            await props.onFinish();
            setClosed(true);
            // Long enough to read the last line before it goes.
            setTimeout(onClose, 2200);
            return "Closed. See you tomorrow.";
          },
        },
      ],
    };
  }

  const current = step();
  const stepKey = current?.key ?? "";

  /*
   * The lines, said one after another.
   *
   * ⚠ Keyed on `stepKey`, never on the step object. The script is rebuilt every
   * render, so depending on its identity made this effect re-run — and its
   * cleanup cancel the pending timers — on every unrelated re-render, which is
   * why the assistant's own lines never appeared while the buttons did.
   */
  const stepRef = useRef<Step | null>(current);
  useEffect(() => {
    stepRef.current = current;
  });
  /**
   * Each step says its piece once.
   *
   * The conversation returns to earlier steps by design — the picker is come
   * back to after every item — and without this it re-introduced itself every
   * time ("What are you taking on today?" twice in a row, between two answers).
   */
  const spoken = useRef<Set<string>>(new Set());
  useEffect(() => {
    if (!stepKey || spoken.current.has(stepKey)) return;
    spoken.current.add(stepKey);
    const lines = stepRef.current?.say ?? [];
    const timers = lines.map((text, i) =>
      setTimeout(() => setSaid((prev) => [...prev, { who: "it", text }]), i * 600),
    );
    return () => timers.forEach(clearTimeout);
  }, [stepKey]);

  useEffect(() => {
    endRef.current?.scrollIntoView({ block: "end", behavior: "smooth" });
  }, [said]);

  const answer = useCallback(async (reply: Reply) => {
    if (busy) return;
    setBusy(true);
    setShowText(false);
    setSaid((prev) => [...prev, { who: "you", text: reply.label }]);
    try {
      const followUp = await reply.run();
      if (typeof followUp === "string") {
        setSaid((prev) => [...prev, { who: "it", text: followUp }]);
      }
    } catch {
      setSaid((prev) => [
        ...prev,
        { who: "it", text: "That didn't go through — try again, or open the full chat." },
      ]);
    } finally {
      setBusy(false);
    }
  }, [busy]);

  async function submitText() {
    const text = draft.trim();
    const ft = current?.freeText;
    if (!text || !ft || busy) return;
    setDraft("");
    await answer({ label: text, run: () => ft.submit(text) });
  }

  return (
    <div
      className="fade-in fixed inset-0 z-50 flex items-end justify-center bg-chrome-deep/70 p-4 backdrop-blur-sm sm:items-center"
      role="dialog"
      aria-modal
      aria-label="Your day"
    >
      <div className="pop-in flex max-h-[85vh] w-full max-w-lg flex-col overflow-hidden rounded-3xl bg-surface shadow-lift">
        <div className="flex items-center gap-3 border-b border-line px-5 py-3.5">
          <span className="pulse-dot grid h-8 w-8 shrink-0 place-items-center rounded-full bg-accent-soft text-accent-strong">
            <Icon name="spark" className="h-4 w-4" />
          </span>
          <div className="min-w-0 flex-1">
            <div className="text-sm font-bold text-ink">Your assistant</div>
            <div className="text-[11px] text-ink-faint">
              {plan
                ? "planning your day"
                : closeOut
                  ? "closing the day"
                  : check
                    ? "checking in"
                    : "one question"}
            </div>
          </div>
          {/* Never trapped: A4's question "lapses quietly" if it is ignored. */}
          <button
            onClick={onClose}
            className="press rounded-full px-2.5 py-1 text-xs font-medium text-ink-faint hover:text-ink"
          >
            Later
          </button>
        </div>

        <div className="min-h-32 flex-1 space-y-2.5 overflow-y-auto px-5 py-4">
          {said.map((b, i) =>
            b.who === "it" ? (
              <div key={i} className="rise flex items-start gap-2.5">
                <span className="mt-0.5 grid h-6 w-6 shrink-0 place-items-center rounded-full bg-accent-soft text-accent-strong">
                  <Icon name="spark" className="h-3 w-3" />
                </span>
                <p className="max-w-[85%] rounded-2xl rounded-tl-sm bg-raised px-3.5 py-2 text-[13px] leading-relaxed text-ink">
                  {b.text}
                </p>
              </div>
            ) : (
              <div key={i} className="rise flex justify-end">
                <p className="max-w-[85%] rounded-2xl rounded-tr-sm bg-chrome px-3.5 py-2 text-[13px] text-chrome-ink">
                  {b.text}
                </p>
              </div>
            ),
          )}
          <div ref={endRef} />
        </div>

        {/* Buttons first, typing optional — A1: "chat-first must never mean typing-first". */}
        {current && (
          <div className="space-y-2 border-t border-line px-5 py-3.5">
            <div className="flex flex-wrap gap-1.5">
              {current.replies.map((r) => (
                <button
                  key={r.label}
                  onClick={() => void answer(r)}
                  disabled={busy}
                  className={`press rounded-full px-3.5 py-1.5 text-xs font-semibold transition-colors disabled:opacity-40 ${
                    r.tone === "go"
                      ? "bg-accent-strong text-white hover:bg-accent"
                      : "bg-raised text-ink-soft hover:text-ink"
                  }`}
                >
                  {r.label}
                </button>
              ))}
              {current.freeText && !showText && (
                <button
                  onClick={() => setShowText(true)}
                  disabled={busy}
                  className="press rounded-full px-3 py-1.5 text-xs font-medium text-ink-faint hover:text-ink disabled:opacity-40"
                >
                  Say it myself
                </button>
              )}
              {current.explain && (
                <Link
                  href={`/assistant?ask=${encodeURIComponent(current.explain)}`}
                  className="press rounded-full px-3 py-1.5 text-xs font-medium text-ink-faint hover:text-ink"
                >
                  Full chat →
                </Link>
              )}
            </div>

            {current.freeText && showText && (
              <form
                onSubmit={(e) => {
                  e.preventDefault();
                  void submitText();
                }}
                className="flex items-center gap-2"
              >
                <input
                  value={draft}
                  onChange={(e) => setDraft(e.target.value)}
                  placeholder={current.freeText.placeholder}
                  disabled={busy}
                  className="min-w-0 flex-1 rounded-xl border border-line bg-raised px-3 py-1.5 text-xs text-ink outline-none placeholder:text-ink-faint focus:border-accent-strong"
                />
                <button
                  type="submit"
                  disabled={busy || !draft.trim()}
                  className="press grid h-8 w-8 shrink-0 place-items-center rounded-full bg-accent-strong text-white disabled:opacity-40"
                  aria-label="Send"
                >
                  <Icon name="arrow" className="h-3.5 w-3.5" />
                </button>
              </form>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
