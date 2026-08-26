/**
 * What travels on the BROWSER socket.
 *
 * Two channels on one connection, deliberately:
 *
 *   **binary frames**  audio, raw 16-bit PCM, both directions. Base64 in JSON
 *                      would cost a third more bandwidth on the one thing here
 *                      that is continuous.
 *   **text frames**    JSON control messages, below.
 *
 * ⚠ **Nothing the browser sends may name the actor.** The actor was bound at
 * upgrade time from the session cookie and is a closure, not a parameter — the
 * same rule `ToolContext` already enforces for chat. There is deliberately no
 * `actor` field in `ClientMessage`, so there is nothing to ignore.
 */

/** Browser → server. */
export type ClientMessage =
  /** What the person is looking at, sent on open and on every navigation. */
  | { type: "viewing"; route: string; nodeType?: string; nodeId?: string }
  /** The hang-up button. Must close immediately, not after the current reply. */
  | { type: "end" }
  /** The microphone stopped — a browser tab going to sleep, a device unplugged. */
  | { type: "mic-stopped" }
  /**
   * A proposal was tapped — approved, refused on re-checking, or thrown away.
   *
   * ⚠ **This tells the model what a FINGER did; it is not the finger.** The
   * approval itself went to `POST /api/proposals/{id}` with the session cookie,
   * through the gate. By the time this frame arrives the operation has already
   * run or already failed, so nothing here can cause a write — it exists so the
   * conversation and the screen stop disagreeing. Without it, it goes on saying
   * the approval is still waiting.
   */
  | {
      type: "proposal-resolved";
      proposalId: string;
      outcome: "approved" | "refused" | "discarded";
      detail?: string;
    };

/** What the person can see, plainly. */
export type VoiceState = "connecting" | "listening" | "thinking" | "speaking" | "closed";

/** Server → browser. */
export type ServerMessage =
  | { type: "ready"; sampleRateIn: number; sampleRateOut: number }
  | { type: "state"; state: VoiceState }
  /** What it heard, as it hears it. A person who can see this catches a mishearing. */
  | { type: "heard"; text: string; final: boolean }
  /** What it said. */
  | { type: "said"; text: string; final: boolean }
  /** Somebody talked over it — drop the playback queue NOW, do not fade. */
  | { type: "interrupted" }
  /** A propose-gated operation reached its proposal and stopped. The finger issues. */
  | { type: "proposal"; proposalId: string; summary: string }
  /** Something happened the person should know about, in words rather than silence. */
  | { type: "notice"; message: string }
  | { type: "closed"; reason: string };

export function encode(msg: ServerMessage): string {
  return JSON.stringify(msg);
}

export function decodeClient(raw: string): ClientMessage | null {
  try {
    const parsed = JSON.parse(raw) as ClientMessage;
    if (typeof parsed !== "object" || parsed === null || typeof parsed.type !== "string") return null;
    return parsed;
  } catch {
    return null;
  }
}
