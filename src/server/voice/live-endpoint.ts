/**
 * The seam between the relay and whatever is speaking on the other end.
 *
 * ── Why this exists, and it is the same reason `llm-fake.ts` exists ─────────
 *
 * **No test opens a socket to Google.** `ORG_LLM_PROVIDER=stub` is the default
 * so that no test can wander onto the network by forgetting something, and a
 * held audio socket is the most expensive thing in this codebase to reach by
 * accident. So the relay is written against this interface, and the suite
 * drives it with `ScriptedLiveEndpoint` — scripted frames, no network, no cost,
 * no credentials. Exactly the precedent `FakeLlmProvider` set.
 *
 * The frames below are **the real ones**, named as Vertex names them, because a
 * fake that invents its own vocabulary tests the fake. They were read off a
 * real session before any of this was written — see `outcome.md` §1.
 */

/** What the model may ask for, and what it says back. */
export interface LiveServerFrame {
  setupComplete?: { sessionId?: string };
  serverContent?: {
    modelTurn?: { role?: string; parts?: Array<{ inlineData?: { mimeType: string; data: string }; text?: string }> };
    inputTranscription?: { text?: string; finished?: boolean };
    outputTranscription?: { text?: string; finished?: boolean };
    /** The person talked over it. Playback must stop, and stop now. */
    interrupted?: boolean;
    generationComplete?: boolean;
    turnComplete?: boolean;
  };
  toolCall?: { functionCalls: Array<{ id?: string; name: string; args?: Record<string, unknown> }> };
  toolCallCancellation?: { ids?: string[] };
  usageMetadata?: Record<string, unknown>;
  goAway?: { timeLeft?: string };
}

/** The setup frame, sent once, before any audio. */
export interface LiveSetup {
  model: string;
  systemInstruction: string;
  tools: Array<{ name: string; description: string; parameters: Record<string, unknown> }>;
  voiceName?: string;
}

export interface LiveConnection {
  /** Microphone audio, 16-bit PCM mono at `INPUT_SAMPLE_RATE`. */
  sendAudio(pcm: Buffer): void;
  /** A tool's result, back up the same socket. */
  sendToolResult(results: Array<{ id?: string; name: string; response: unknown }>): void;
  /** A text turn — used for the session's opening context, never for audio. */
  sendText(text: string, opts?: { turnComplete?: boolean }): void;
  close(reason: string): void;
  readonly closed: boolean;
}

export interface LiveHandlers {
  onOpen(): void;
  onFrame(frame: LiveServerFrame): void;
  /** Upstream went away. The browser must be TOLD, in words. */
  onClose(code: number, reason: string): void;
  onError(message: string, frame?: unknown): void;
}

export interface LiveEndpoint {
  open(setup: LiveSetup, handlers: LiveHandlers): Promise<LiveConnection>;
  readonly id: string;
}

/**
 * The audio format, **measured rather than assumed.**
 *
 * The mime type Vertex returns is a bare `audio/pcm` with no rate on it, and
 * the rate declared on the way UP is ignored — the same clip declared at 16000
 * and at 24000 billed identically. So neither number here can be verified by
 * reading a header at runtime, and both were derived from the server's own
 * `usageMetadata`, which bills live audio at a fixed 25 tokens per second:
 *
 *     456,554 bytes out = 228,277 samples, billed 238 audio tokens = 9.52s
 *     228,277 / 9.52    = 23,979 Hz       -> 24 kHz down
 *
 * ⚠ **A rate mismatch does not error.** It produces audio at the wrong speed
 * and pitch, which is the kind of bug that eats an afternoon. If either number
 * is ever in doubt, re-run the measurement rather than reading a document.
 */
export const INPUT_SAMPLE_RATE = 16000;
export const OUTPUT_SAMPLE_RATE = 24000;
export const AUDIO_MIME = `audio/pcm;rate=${INPUT_SAMPLE_RATE}`;
