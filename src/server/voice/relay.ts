import type { LiveConnection, LiveEndpoint, LiveServerFrame, LiveSetup } from "./live-endpoint";
import { INPUT_SAMPLE_RATE, OUTPUT_SAMPLE_RATE } from "./live-endpoint";
import { encode, decodeClient, type ClientMessage, type ServerMessage, type VoiceState } from "./protocol";

/**
 * One socket pair, both directions.
 *
 *     browser  --audio-->   THIS PROCESS   --audio-->   Vertex Live
 *              <-audio--    holds the key  <-audio--
 *                           runs the tools
 *
 * The relay moves bytes and frames. It does not know what a tool means, who is
 * allowed to do what, or what a proposal is — `session.ts` and `tools.ts` own
 * that. Keeping this file ignorant is what makes the four failure paths below
 * checkable on their own.
 *
 * ── ⚠ TWO SOCKETS, ONE SESSION, AND EITHER CAN DIE FIRST ────────────────────
 *
 *   browser closes  -> close Vertex, discard the session
 *   Vertex closes   -> tell the browser IN WORDS, do not just go silent
 *   browser errors  -> same as close
 *   Vertex errors   -> same, and log the frame that caused it
 *
 * All four are handled here, because three handled and one forgotten is a
 * socket that bills until Google gives up on it.
 */

/** The browser end. Narrow on purpose, so a test can be a plain object. */
export interface BrowserSocket {
  send(data: string | Buffer): void;
  close(code?: number, reason?: string): void;
  on(event: "message", cb: (data: Buffer, isBinary: boolean) => void): void;
  on(event: "close", cb: () => void): void;
  on(event: "error", cb: (err: Error) => void): void;
  readonly readyState: number;
}

export interface RelayHooks {
  /** A tool the model asked for. Resolves to what goes back up the same socket. */
  onToolCall(call: { id?: string; name: string; args: Record<string, unknown> }): Promise<unknown>;
  /** The person navigated, or said what they were looking at when the session opened. */
  onViewing?(v: { route: string; nodeType?: string; nodeId?: string }): void;
  /** A proposal was tapped. Already done or already refused — this is news, not an instruction. */
  onProposalResolved?(r: {
    proposalId: string;
    outcome: "approved" | "refused" | "discarded";
    detail?: string;
  }): void;
  /**
   * The recogniser produced words from the PERSON's audio.
   *
   * ⚠ This is what `session.ts` advances a conversational turn on, and the
   * reason it is a separate hook from `turnComplete`: this one comes from bytes
   * the browser sent, and the model cannot make one appear. See the header of
   * `session.ts`.
   */
  onHeard?(text: string, final: boolean): void;
  /** The model finished a turn. */
  onModelTurnComplete?(): void;
  /** Anything worth a line in the server log. */
  log?(message: string, detail?: unknown): void;
  /** The session is over, whichever way it ended. Called exactly once. */
  onClosed?(reason: string): void;
}

/**
 * ⚠ **Backpressure: drop the OLDEST, never buffer without bound.**
 *
 * Audio arrives faster than a slow consumer drains it. Stale audio is worse
 * than missing audio, because it plays late and confuses the listener — a
 * sentence arriving four seconds after it was spoken is not a recovery, it is
 * a second, wrong conversation.
 *
 * Counted in chunks rather than bytes, because chunk sizes vary: this is
 * roughly two seconds of 24 kHz speech, long enough to ride out a stall and
 * short enough that whatever does arrive is still current.
 */
const MAX_QUEUED_CHUNKS = 24;

export interface Relay {
  /** Push a frame from upstream through to the browser. */
  handleUpstream(frame: LiveServerFrame): void;
  /**
   * Say something to the model as a text turn.
   *
   * Used for the two things the SESSION needs to say rather than the person:
   * the opening screen context, and the nudge before closing on silence.
   * Never for audio — audio goes straight through `sendAudio`.
   *
   * ⚠ `expectReply` defaults to FALSE, and that default is the fix for a bug
   * found by talking to it. A text turn with `turnComplete: true` is a
   * complete user turn, so the model ANSWERS it — handed the screen context it
   * said *"the context. How can I help?"* out loud, to nobody, before the
   * person had said anything. Context is something it should KNOW, not
   * something it should respond to.
   */
  say(text: string, opts?: { expectReply?: boolean }): void;
  /** Tell the browser something, in words. */
  notify(message: string): void;
  /** Put a prepared proposal on the person's screen. The finger issues, not the voice. */
  showProposal(proposalId: string, summary: string): void;
  /** End it. Idempotent — the button, a word, silence and a drop all land here. */
  close(reason: string): void;
  readonly state: VoiceState;
  /** How many outbound audio chunks were dropped for backpressure. */
  readonly dropped: number;
}

export interface OpenRelayInput {
  browser: BrowserSocket;
  endpoint: LiveEndpoint;
  setup: LiveSetup;
  hooks: RelayHooks;
}

export async function openRelay(input: OpenRelayInput): Promise<Relay> {
  const { browser, endpoint, setup, hooks } = input;
  let upstream: LiveConnection | undefined;
  let state: VoiceState = "connecting";
  let dropped = 0;
  let finished = false;

  const outbound: Buffer[] = [];
  let flushing = false;

  const toBrowser = (msg: ServerMessage) => {
    if (finished || browser.readyState !== 1) return;
    try {
      browser.send(encode(msg));
    } catch (e) {
      hooks.log?.("could not write to the browser socket", e);
    }
  };

  const setState = (next: VoiceState) => {
    if (state === next) return;
    state = next;
    toBrowser({ type: "state", state });
  };

  /**
   * Audio down to the browser, with the drop-oldest cap.
   *
   * A slow consumer shows up as the socket buffering internally rather than as
   * a send failing, so the queue here is what makes the drop deliberate and
   * countable instead of an invisible memory climb.
   */
  const playToBrowser = (pcm: Buffer) => {
    if (finished) return;
    outbound.push(pcm);
    while (outbound.length > MAX_QUEUED_CHUNKS) {
      outbound.shift();
      dropped += 1;
    }
    if (flushing) return;
    flushing = true;
    queueMicrotask(() => {
      flushing = false;
      while (outbound.length) {
        const chunk = outbound.shift();
        if (!chunk) break;
        if (browser.readyState !== 1) break;
        try {
          browser.send(chunk);
        } catch (e) {
          hooks.log?.("could not write audio to the browser socket", e);
          break;
        }
      }
    });
  };

  /**
   * ⚠ ONE TOOL AT A TIME PER SESSION, IN ORDER.
   *
   * The live model may send a second call before the first has returned.
   * Running them concurrently against the same day plan is a race nobody will
   * ever reproduce — two `select_item` calls interleaving on one list, and the
   * loser silently gone. A promise chain is the whole mechanism.
   */
  let toolQueue: Promise<void> = Promise.resolve();

  const runToolCall = (call: { id?: string; name: string; args?: Record<string, unknown> }) => {
    toolQueue = toolQueue.then(async () => {
      let response: unknown;
      try {
        response = await hooks.onToolCall({ id: call.id, name: call.name, args: call.args ?? {} });
      } catch (e) {
        // A thrown tool must not kill the conversation. The model is told in
        // the same envelope a refusal uses, and can say so out loud.
        hooks.log?.(`tool ${call.name} threw`, e);
        response = { didNotHappen: true, tellThem: "That could not be done just now." };
      }
      upstream?.sendToolResult([{ id: call.id, name: call.name, response }]);
    });
  };

  const finish = (reason: string, code = 1000) => {
    if (finished) return;
    finished = true;
    state = "closed";
    try {
      browser.send(encode({ type: "closed", reason }));
    } catch {
      /* the browser may already be gone; that is one of the four paths */
    }
    upstream?.close(reason);
    try {
      browser.close(code, reason.slice(0, 120));
    } catch {
      /* already gone */
    }
    hooks.onClosed?.(reason);
  };

  // ── upstream -> browser ───────────────────────────────────────────────────
  const handleUpstream = (frame: LiveServerFrame) => {
    if (finished) return;

    if (frame.setupComplete) {
      setState("listening");
      toBrowser({ type: "ready", sampleRateIn: INPUT_SAMPLE_RATE, sampleRateOut: OUTPUT_SAMPLE_RATE });
      return;
    }

    if (frame.toolCall) {
      setState("thinking");
      for (const call of frame.toolCall.functionCalls) runToolCall(call);
      return;
    }

    if (frame.toolCallCancellation) {
      // Nothing to undo: a result is only sent when a call resolves, and a
      // cancelled call's result is simply ignored upstream.
      hooks.log?.("upstream cancelled a tool call", frame.toolCallCancellation.ids);
      return;
    }

    const sc = frame.serverContent;
    if (!sc) return;

    if (sc.interrupted) {
      // Ahead of everything else. Audio that keeps playing after somebody has
      // interrupted is the single most irritating failure this interface has.
      outbound.length = 0;
      toBrowser({ type: "interrupted" });
      setState("listening");
    }

    if (sc.inputTranscription?.text) {
      const final = sc.inputTranscription.finished === true;
      toBrowser({ type: "heard", text: sc.inputTranscription.text, final });
      hooks.onHeard?.(sc.inputTranscription.text, final);
    }
    if (sc.outputTranscription?.text) {
      toBrowser({
        type: "said",
        text: sc.outputTranscription.text,
        final: sc.outputTranscription.finished === true,
      });
    }

    for (const part of sc.modelTurn?.parts ?? []) {
      if (!part.inlineData) continue;
      setState("speaking");
      playToBrowser(Buffer.from(part.inlineData.data, "base64"));
    }

    if (sc.turnComplete) {
      setState("listening");
      hooks.onModelTurnComplete?.();
    }
  };

  // ── browser -> upstream ───────────────────────────────────────────────────
  browser.on("message", (data: Buffer, isBinary: boolean) => {
    if (finished) return;
    if (isBinary) {
      // Microphone audio. Straight up, no queue: upstream is not the slow
      // consumer here, and holding mic audio back would add latency to the one
      // thing that must not have any.
      upstream?.sendAudio(data);
      return;
    }
    const msg: ClientMessage | null = decodeClient(data.toString("utf8"));
    if (!msg) return;
    if (msg.type === "end") {
      finish("you ended the conversation");
      return;
    }
    if (msg.type === "mic-stopped") {
      toBrowser({ type: "notice", message: "The microphone stopped." });
      return;
    }
    if (msg.type === "viewing") {
      hooks.onViewing?.({ route: msg.route, nodeType: msg.nodeType, nodeId: msg.nodeId });
      return;
    }
    if (msg.type === "proposal-resolved") {
      hooks.onProposalResolved?.({
        proposalId: msg.proposalId,
        outcome: msg.outcome,
        detail: msg.detail,
      });
    }
  });

  browser.on("close", () => {
    // ⚠ A dropped browser connection must close the Vertex socket. Not when a
    // timeout eventually notices — now.
    finish("the browser disconnected");
  });

  browser.on("error", (err: Error) => {
    hooks.log?.("browser socket errored", err.message);
    finish("the browser connection failed");
  });

  // ── open upstream ─────────────────────────────────────────────────────────
  try {
    upstream = await endpoint.open(setup, {
      onOpen: () => hooks.log?.("upstream open"),
      onFrame: handleUpstream,
      onClose: (code, reason) => {
        if (finished) return;
        // ⚠ TELL THE BROWSER IN WORDS. A session that goes silent is
        // indistinguishable from one that broke.
        toBrowser({
          type: "notice",
          message: "The voice connection ended at the server end. Tap to start again.",
        });
        hooks.log?.(`upstream closed ${code} ${reason}`);
        finish("the voice service closed the connection");
      },
      onError: (message, frame) => {
        // Log the frame that caused it — an error with no frame beside it is an
        // afternoon of guessing.
        hooks.log?.(`upstream error: ${message}`, frame);
        toBrowser({ type: "notice", message: "Something went wrong with the voice connection." });
        finish("the voice connection failed");
      },
    });
  } catch (e) {
    const why = e instanceof Error ? e.message : String(e);
    hooks.log?.("could not open the upstream voice connection", why);
    toBrowser({ type: "notice", message: "Voice is not available right now. Every screen still works." });
    finish("voice could not be started");
  }

  return {
    handleUpstream,
    say: (text: string, opts?: { expectReply?: boolean }) => {
      if (finished) return;
      upstream?.sendText(text, { turnComplete: opts?.expectReply === true });
    },
    notify: (message: string) => toBrowser({ type: "notice", message }),
    showProposal: (proposalId: string, summary: string) =>
      toBrowser({ type: "proposal", proposalId, summary }),
    close: (reason: string) => finish(reason),
    get state() {
      return state;
    },
    get dropped() {
      return dropped;
    },
  };
}
