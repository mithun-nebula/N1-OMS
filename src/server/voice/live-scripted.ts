import type {
  LiveConnection,
  LiveEndpoint,
  LiveHandlers,
  LiveServerFrame,
  LiveSetup,
} from "./live-endpoint";

/**
 * A scriptable live endpoint, for tests.
 *
 * **No test opens a socket to Google.** A test queues the frames this endpoint
 * will produce — a tool call, some audio, a turn boundary, a close — and
 * asserts what the relay did with them. Scripted rather than clever: nothing
 * here imitates a model's judgement, because asserting against imitated
 * judgement proves nothing about the real thing.
 *
 * Same shape and same reasoning as `llm-fake.ts`, which is the precedent for
 * offline testing in this codebase. Follows the in-file fake convention too —
 * there is no `vi.mock` anywhere in this project and this does not add one.
 */
export class ScriptedLiveEndpoint implements LiveEndpoint {
  readonly id = "scripted-live";

  /** Everything the relay sent upstream, in order, for assertions. */
  readonly sent: Array<
    | { kind: "audio"; bytes: number }
    | { kind: "toolResult"; results: Array<{ id?: string; name: string; response: unknown }> }
    | { kind: "text"; text: string }
    | { kind: "close"; reason: string }
  > = [];

  /** The setup frame the session built, for assertions about the tool set. */
  setup?: LiveSetup;

  private handlers?: LiveHandlers;
  private isClosed = false;

  constructor(private readonly openBehaviour: "ok" | "throw" = "ok") {}

  async open(setup: LiveSetup, handlers: LiveHandlers): Promise<LiveConnection> {
    if (this.openBehaviour === "throw") throw new Error("upstream refused the connection");
    this.setup = setup;
    this.handlers = handlers;
    // Asynchronously, like the real one: nothing may depend on `onOpen` having
    // already run by the time `open()` resolves.
    queueMicrotask(() => {
      handlers.onOpen();
      handlers.onFrame({ setupComplete: { sessionId: "scripted-session" } });
    });
    const sent = this.sent;
    const isClosed = () => this.isClosed;
    const markClosed = () => {
      this.isClosed = true;
    };
    return {
      get closed() {
        return isClosed();
      },
      sendAudio: (pcm) => sent.push({ kind: "audio", bytes: pcm.length }),
      sendToolResult: (results) => sent.push({ kind: "toolResult", results }),
      sendText: (text) => sent.push({ kind: "text", text }),
      close: (reason) => {
        if (isClosed()) return;
        markClosed();
        sent.push({ kind: "close", reason });
      },
    };
  }

  /** Play one frame down to the relay, as if Vertex had sent it. */
  emit(frame: LiveServerFrame): void {
    this.handlers?.onFrame(frame);
  }

  /** Upstream goes away on its own — the case the browser must be TOLD about. */
  hangUp(code = 1011, reason = "upstream closed"): void {
    this.isClosed = true;
    this.handlers?.onClose(code, reason);
  }

  fail(message: string, frame?: unknown): void {
    this.handlers?.onError(message, frame);
  }

  get closedByRelay(): boolean {
    return this.sent.some((s) => s.kind === "close");
  }

  /** Convenience: a chunk of "audio" of a given size. */
  static audio(bytes: number): string {
    return Buffer.alloc(bytes, 7).toString("base64");
  }
}
