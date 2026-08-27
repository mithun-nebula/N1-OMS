"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { usePathname } from "next/navigation";
import { createPlayback, type Playback } from "./voice-playback";

/**
 * One tap opens a conversation. It stays open. You can cut in while it talks.
 *
 * ── What this replaced ──────────────────────────────────────────────────────
 *
 * `voice-input.tsx` — press, release, `webkitSpeechRecognition`, and
 * `detectIntent()`: a four-branch keyword match on `t.includes("hall")`. It
 * worked, for four things. This is the same replacement Phase 1b made when it
 * deleted `pickSpecialists`' four regexes: a model that understands the
 * sentence, instead of a list of words that might be in it.
 *
 * ── ⚠ NO CREDENTIAL IS EVER HERE ────────────────────────────────────────────
 *
 * The audio goes to **this project's own server**, which holds the key and
 * talks to Vertex. If the browser spoke to Google directly the service-account
 * key would have to be in this file, where anybody could take it and bill the
 * project.
 */

type VoiceState = "idle" | "connecting" | "listening" | "thinking" | "speaking" | "closed";

interface Line {
  who: "you" | "it";
  text: string;
  final: boolean;
}

interface PendingProposal {
  proposalId: string;
  summary: string;
  /** What happened when they tapped it, so the panel can say so. */
  state?: "approving" | "done" | "failed";
  message?: string;
}

/** What the server says. Kept in step with `src/server/voice/protocol.ts`. */
type ServerMessage =
  | { type: "ready"; sampleRateIn: number; sampleRateOut: number }
  | { type: "state"; state: Exclude<VoiceState, "idle"> }
  | { type: "heard"; text: string; final: boolean }
  | { type: "said"; text: string; final: boolean }
  | { type: "interrupted" }
  | { type: "proposal"; proposalId: string; summary: string }
  | { type: "notice"; message: string }
  | { type: "closed"; reason: string };

const STATE_LABEL: Record<VoiceState, string> = {
  idle: "Tap to talk",
  connecting: "Connecting…",
  listening: "Listening",
  thinking: "Thinking…",
  speaking: "Speaking",
  closed: "Ended",
};

export function VoiceButton() {
  const [state, setState] = useState<VoiceState>("idle");
  const [lines, setLines] = useState<Line[]>([]);
  const [notice, setNotice] = useState<string | null>(null);
  const [proposals, setProposals] = useState<PendingProposal[]>([]);
  const [error, setError] = useState<string | null>(null);

  const socketRef = useRef<WebSocket | null>(null);
  const [busyProposal, setBusyProposal] = useState<string | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const audioRef = useRef<AudioContext | null>(null);
  const playbackRef = useRef<Playback | null>(null);
  const pathname = usePathname();

  const teardown = useCallback(() => {
    playbackRef.current?.close();
    playbackRef.current = null;
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
    audioRef.current = null;
    const socket = socketRef.current;
    socketRef.current = null;
    if (socket && socket.readyState <= 1) socket.close(1000, "closed by the person");
  }, []);

  // A tab that closes must not leave a socket open on the server, which would
  // go on billing until it noticed.
  useEffect(() => teardown, [teardown]);

  /**
   * The person navigated. Tell the session, so *"that room"* means the room
   * they are looking at NOW rather than the one they were on when they tapped.
   */
  useEffect(() => {
    const socket = socketRef.current;
    if (!socket || socket.readyState !== 1 || !pathname) return;
    socket.send(JSON.stringify({ type: "viewing", route: pathname, ...recordOnScreen() }));
  }, [pathname]);

  const appendLine = useCallback((who: Line["who"], text: string, final: boolean) => {
    setLines((prev) => {
      const last = prev.at(-1);
      // Interim results replace the previous interim from the same speaker;
      // a final one closes the line off.
      if (last && last.who === who && !last.final) {
        return [...prev.slice(0, -1), { who, text: last.text + text, final }];
      }
      return [...prev, { who, text, final }];
    });
  }, []);

  const start = useCallback(async () => {
    setError(null);
    setNotice(null);
    setLines([]);
    setProposals([]);
    setState("connecting");

    let stream: MediaStream;
    try {
      stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          channelCount: 1,
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true,
        },
      });
    } catch {
      setState("idle");
      setError("I could not reach the microphone. Check the browser's permission for this site.");
      return;
    }
    streamRef.current = stream;

    const url = new URL("/api/voice", window.location.href);
    url.protocol = url.protocol === "https:" ? "wss:" : "ws:";
    if (pathname) {
      url.searchParams.set("route", pathname);
      const on = recordOnScreen();
      if (on.nodeType) url.searchParams.set("nodeType", on.nodeType);
      if (on.nodeId) url.searchParams.set("nodeId", on.nodeId);
    }

    const socket = new WebSocket(url);
    socket.binaryType = "arraybuffer";
    socketRef.current = socket;

    socket.onerror = () => {
      // The upgrade is refused with a plain 401 for anybody not signed in, and
      // the browser surfaces that as an error rather than a close code.
      setError("Voice is not available right now. Every screen still works as normal.");
      setState("idle");
      teardown();
    };

    socket.onclose = () => {
      setState((s) => (s === "idle" ? s : "closed"));
      teardown();
    };

    socket.onmessage = async (ev: MessageEvent) => {
      if (ev.data instanceof ArrayBuffer) {
        playbackRef.current?.push(ev.data);
        return;
      }
      const msg = JSON.parse(String(ev.data)) as ServerMessage;
      switch (msg.type) {
        case "ready":
          await beginCapture(msg.sampleRateOut);
          break;
        case "state":
          setState(msg.state);
          break;
        case "heard":
          appendLine("you", msg.text, msg.final);
          break;
        case "said":
          appendLine("it", msg.text, msg.final);
          break;
        case "interrupted":
          // ⚠ Stop, do not fade. They are already talking.
          playbackRef.current?.stop();
          break;
        case "proposal":
          setProposals((p) => [...p, { proposalId: msg.proposalId, summary: msg.summary }]);
          break;
        case "notice":
          setNotice(msg.message);
          break;
        case "closed":
          setNotice(msg.reason);
          setState("closed");
          break;
      }
    };

    /**
     * Capture, once the server has told us the format.
     *
     * ⚠ The mic stays open **while it speaks**. That is what makes barge-in
     * possible, and it is only safe because the live model signals
     * `interrupted` itself — the server proved that before this was written.
     * `echoCancellation` handles the speaker bleed; on speakers it is not
     * perfect, and the alternative — stopping capture while it talks — kills
     * the one thing that makes this feel like a conversation.
     */
    async function beginCapture(outputRate: number) {
      const audio = new AudioContext();
      audioRef.current = audio;
      playbackRef.current = createPlayback(audio, outputRate);
      try {
        await audio.audioWorklet.addModule("/voice-worklet.js");
      } catch {
        setError("This browser could not start audio capture.");
        teardown();
        return;
      }
      const source = audio.createMediaStreamSource(stream);
      const worklet = new AudioWorkletNode(audio, "mic-capture");
      worklet.port.onmessage = (e: MessageEvent) => {
        const socket = socketRef.current;
        if (socket?.readyState === 1) socket.send(e.data as ArrayBuffer);
      };
      source.connect(worklet);
      // Deliberately NOT connected to the destination: routing the microphone
      // to the speakers is feedback, not monitoring.
    }
  }, [appendLine, pathname, teardown]);

  /**
   * Let another part of the app offer "do it by voice" without importing this
   * component's internals — the clock-in prompt uses it, so all three ways in
   * (form, chat, voice) are one tap from the same place.
   *
   * An event rather than a prop: this button is mounted once in the shell and
   * has no parent that knows the dashboard exists.
   */
  useEffect(() => {
    const onAsk = () => {
      // Never restart a conversation that is already running.
      if (socketRef.current) return;
      void start();
    };
    window.addEventListener("n1:start-voice", onAsk);
    return () => window.removeEventListener("n1:start-voice", onAsk);
  }, [start]);

  /**
   * ⚠ The finger, issuing.
   *
   * This is the other half of "voice prepares, a finger issues", and it is why
   * the model does not hold `approve_proposal`: **a model cannot make an
   * authenticated request from this browser.** The tap goes to the server with
   * the session cookie, and the operation is submitted under the person's own
   * hand through the same gate as everything else.
   */
  const approve = useCallback(async (proposalId: string) => {
    setBusyProposal(proposalId);
    setProposals((all) =>
      all.map((p) => (p.proposalId === proposalId ? { ...p, state: "approving" } : p)),
    );
    try {
      const res = await fetch(`/api/proposals/${encodeURIComponent(proposalId)}`, { method: "POST" });
      const body = (await res.json().catch(() => ({}))) as { error?: string; summary?: string };
      setProposals((all) =>
        all.map((p) =>
          p.proposalId === proposalId
            ? res.ok
              ? { ...p, state: "done", message: "Approved." }
              : { ...p, state: "failed", message: body.error ?? "That did not go through." }
            : p,
        ),
      );
      // Tell it out loud, so the conversation and the screen agree. Without
      // this it would go on believing the approval is still waiting.
      const socket = socketRef.current;
      if (socket?.readyState === 1) {
        socket.send(
          JSON.stringify({
            type: "proposal-resolved",
            proposalId,
            outcome: res.ok ? "approved" : "refused",
            detail: res.ok ? undefined : body.error,
          }),
        );
      }
    } catch {
      setProposals((all) =>
        all.map((p) =>
          p.proposalId === proposalId
            ? { ...p, state: "failed", message: "Couldn't reach the server." }
            : p,
        ),
      );
    } finally {
      setBusyProposal(null);
    }
  }, []);

  const discard = useCallback(async (proposalId: string) => {
    await fetch(`/api/proposals/${encodeURIComponent(proposalId)}`, { method: "DELETE" }).catch(() => {});
    setProposals((all) => all.filter((p) => p.proposalId !== proposalId));
    const socket = socketRef.current;
    if (socket?.readyState === 1) {
      socket.send(JSON.stringify({ type: "proposal-resolved", proposalId, outcome: "discarded" }));
    }
  }, []);

  /** The hang-up button. Closes immediately, not after the current reply. */
  const hangUp = useCallback(() => {
    const socket = socketRef.current;
    if (socket?.readyState === 1) socket.send(JSON.stringify({ type: "end" }));
    playbackRef.current?.stop();
    setState("closed");
    teardown();
  }, [teardown]);

  /**
   * Put the panel away.
   *
   * ⚠ A DIFFERENT ACTION FROM `hangUp`, and they used to share a handler.
   *
   * `hangUp` sets the state to `closed`, and the panel is shown while
   * `open || state === "closed"` — so it stays up deliberately, holding the
   * transcript and any proposal after the conversation ends. That is right:
   * hanging up mid-sentence should not take the last thing it said with it.
   *
   * But the button then labelled "Close" still called `hangUp`, which set
   * `closed` again — so the panel could never be dismissed. Ending the
   * conversation and putting the panel away are two things, and only one of
   * them was wired.
   *
   * Returns to `idle` and clears what the last conversation left behind, so a
   * new one does not open onto the old transcript.
   */
  const dismiss = useCallback(() => {
    teardown();
    setState("idle");
    setLines([]);
    setProposals([]);
    setNotice(null);
    setError(null);
  }, [teardown]);

  const open = state !== "idle" && state !== "closed";

  return (
    <>
      <button
        onClick={open ? hangUp : () => void start()}
        className={`press fixed bottom-20 right-4 z-40 h-12 w-12 rounded-full text-xl text-chrome-ink shadow-lift transition-colors md:bottom-6 md:right-6 md:h-14 md:w-14 md:text-2xl ${
          open ? "voice-breathe bg-danger" : "bg-chrome-card hover:bg-chrome"
        }`}
        aria-label={open ? "End the conversation" : "Talk to the assistant"}
      >
        {open ? "■" : "✦"}
      </button>

      {(open || state === "closed") && (
        <div className="sheet-up fixed bottom-36 right-4 z-40 w-[min(22rem,calc(100vw-2rem))] rounded-2xl bg-chrome px-4 py-3 text-sm text-chrome-ink shadow-lift md:bottom-24 md:right-6">
          <div className="flex items-center justify-between gap-3">
            <span className="flex items-center gap-2 text-[10px] font-semibold uppercase tracking-widest text-chrome-ink/60">
              <StateGlyph state={state} />
              {STATE_LABEL[state]}
            </span>
            {/* ⚠ Always reachable, never hidden while it talks. This is the
                button a person reaches for when it has misunderstood them. */}
            <button
              onClick={state === "closed" ? dismiss : hangUp}
              className="press rounded-full bg-white/10 px-2.5 py-0.5 text-xs font-semibold transition-colors hover:bg-white/20"
            >
              {state === "closed" ? "Close" : "Stop"}
            </button>
          </div>

          {/* What it heard, as it hears it. A person who can SEE the transcript
              catches a mishearing before it becomes an action. */}
          {lines.length > 0 && (
            <div className="mt-2 max-h-40 space-y-1 overflow-y-auto">
              {lines.slice(-6).map((l, i) => (
                <p key={i} className={l.who === "you" ? "text-chrome-ink" : "text-chrome-ink/70 italic"}>
                  <span className="mr-1 text-[10px] uppercase tracking-wide text-chrome-ink/40">
                    {l.who === "you" ? "you" : "it"}
                  </span>
                  {l.text}
                </p>
              ))}
            </div>
          )}

          {/* ⚠ Voice prepares. A finger issues. Money and people arrive here,
              and are approved by tapping — never by saying yes. */}
          {proposals.map((p) => (
            <div
              key={p.proposalId}
              className="pop-in mt-2 rounded-xl border-l-[3px] border-accent-strong bg-white/10 px-3 py-2"
            >
              <div className="text-[10px] font-semibold uppercase tracking-widest text-chrome-ink/60">
                Needs your approval
              </div>
              <p className="mt-1 text-xs">{p.summary}</p>

              {p.state === "done" || p.state === "failed" ? (
                <p
                  className={`mt-1.5 text-[11px] ${p.state === "done" ? "text-chrome-ink/70" : "text-danger"}`}
                >
                  {p.message}
                </p>
              ) : (
                <div className="mt-2 flex items-center gap-2">
                  {/* ⚠ THE FINGER. The model holds no tool that can press this. */}
                  <button
                    onClick={() => void approve(p.proposalId)}
                    disabled={busyProposal === p.proposalId}
                    className="press rounded-full bg-accent-strong px-3 py-1 text-xs font-semibold text-white transition-colors hover:bg-accent disabled:opacity-40"
                  >
                    {p.state === "approving" ? "Approving…" : "Approve"}
                  </button>
                  <button
                    onClick={() => void discard(p.proposalId)}
                    disabled={busyProposal === p.proposalId}
                    className="press rounded-full bg-white/10 px-3 py-1 text-xs font-medium transition-colors hover:bg-white/20 disabled:opacity-40"
                  >
                    Discard
                  </button>
                </div>
              )}
            </div>
          ))}

          {notice && <p className="mt-2 text-xs text-chrome-ink/70">{notice}</p>}
        </div>
      )}

      {error && (
        <div className="sheet-up fixed bottom-36 right-4 z-40 max-w-xs rounded-2xl bg-chrome px-4 py-2.5 text-sm text-chrome-ink shadow-lift md:bottom-24 md:right-6">
          {error}
          <button
            onClick={() => setError(null)}
            className="press ml-2 rounded-full bg-white/10 px-2.5 py-0.5 text-xs font-semibold transition-colors hover:bg-white/20"
          >
            OK
          </button>
        </div>
      )}
    </>
  );
}

/**
 * The state, drawn — equalizer bars while sound is moving, a pulsing dot
 * while it thinks, a steady dot otherwise. Presentation only.
 */
function StateGlyph({ state }: { state: VoiceState }) {
  if (state === "listening" || state === "speaking") {
    return (
      <span
        className={`voice-eq ${state === "listening" ? "text-chrome-ink/80" : "text-accent"}`}
        aria-hidden
      >
        <span />
        <span />
        <span />
        <span />
      </span>
    );
  }
  if (state === "thinking" || state === "connecting") {
    return <span className="pulse-dot h-2 w-2 rounded-full bg-accent" aria-hidden />;
  }
  return <span className="h-2 w-2 rounded-full bg-chrome-ink/40" aria-hidden />;
}

/**
 * What record the current page is showing, if it says so.
 *
 * Read from a `data-` attribute rather than parsed out of the URL: a route
 * shape is a guess, and a wrong guess here would send the model an id for a
 * record the person is not looking at. A page that wants to be referable says
 * so; every other page contributes its route and nothing more.
 *
 * ⚠ Whatever this returns is **resolved through the spine** on the server
 * before it reaches the model, and dropped if the read refuses. Being on a page
 * is not permission to see what is on it.
 */
function recordOnScreen(): { nodeType?: string; nodeId?: string } {
  if (typeof document === "undefined") return {};
  const el = document.querySelector("[data-record-type][data-record-id]");
  if (!el) return {};
  return {
    nodeType: el.getAttribute("data-record-type") ?? undefined,
    nodeId: el.getAttribute("data-record-id") ?? undefined,
  };
}
