import { describe, it, expect, vi } from "vitest";
import { openRelay, type BrowserSocket } from "./relay";
import { ScriptedLiveEndpoint } from "./live-scripted";
import { INPUT_SAMPLE_RATE, OUTPUT_SAMPLE_RATE, type LiveSetup } from "./live-endpoint";
import type { ServerMessage } from "./protocol";

/**
 * The relay, offline.
 *
 * **No test here opens a socket to Google.** `ScriptedLiveEndpoint` produces
 * the frames a real session produces — they were read off one before any of
 * this was written — and the assertions are about what the relay did with
 * them. Same precedent as `llm-fake.ts`.
 */

/** A browser socket that records everything, for assertions. */
class FakeBrowser implements BrowserSocket {
  readyState = 1;
  readonly text: ServerMessage[] = [];
  readonly binary: Buffer[] = [];
  closedWith?: { code?: number; reason?: string };
  private handlers: Record<string, Array<(...a: never[]) => void>> = {};

  send(data: string | Buffer): void {
    if (typeof data === "string") this.text.push(JSON.parse(data) as ServerMessage);
    else this.binary.push(data);
  }
  close(code?: number, reason?: string): void {
    this.closedWith = { code, reason };
    this.readyState = 3;
  }
  on(event: string, cb: (...a: never[]) => void): void {
    (this.handlers[event] ??= []).push(cb);
  }
  /** Drive the socket the way `ws` would. */
  emit(event: string, ...args: unknown[]): void {
    for (const cb of this.handlers[event] ?? []) (cb as (...a: unknown[]) => void)(...args);
  }
  of<T extends ServerMessage["type"]>(type: T): Array<Extract<ServerMessage, { type: T }>> {
    return this.text.filter((m) => m.type === type) as Array<Extract<ServerMessage, { type: T }>>;
  }
  /** Everything the browser ever received, as one searchable string. */
  everything(): string {
    return JSON.stringify(this.text) + this.binary.map((b) => b.toString("base64")).join("");
  }
}

const SETUP: LiveSetup = {
  model: "test-live-model",
  systemInstruction: "Be terse.",
  tools: [{ name: "room_book", description: "Book a room.", parameters: { type: "object", properties: {} } }],
  voiceName: "Aoede",
};

const tick = () => new Promise((r) => setTimeout(r, 0));

async function harness(opts: { onToolCall?: (c: { name: string; args: Record<string, unknown> }) => Promise<unknown> } = {}) {
  const browser = new FakeBrowser();
  const endpoint = new ScriptedLiveEndpoint();
  const relay = await openRelay({
    browser,
    endpoint,
    setup: SETUP,
    hooks: {
      onToolCall: opts.onToolCall ?? (async () => ({ ok: true })),
    },
  });
  await tick();
  return { browser, endpoint, relay };
}

describe("the setup frame", () => {
  it("carries the model, the instruction, the tools and a voice", async () => {
    const { endpoint } = await harness();
    expect(endpoint.setup?.model).toBe("test-live-model");
    expect(endpoint.setup?.systemInstruction).toBe("Be terse.");
    expect(endpoint.setup?.tools.map((t) => t.name)).toEqual(["room_book"]);
    expect(endpoint.setup?.voiceName).toBe("Aoede");
  });

  it("tells the browser the audio format once setup is accepted", async () => {
    const { browser } = await harness();
    const ready = browser.of("ready")[0];
    expect(ready.sampleRateIn).toBe(INPUT_SAMPLE_RATE);
    expect(ready.sampleRateOut).toBe(OUTPUT_SAMPLE_RATE);
    expect(browser.of("state").at(-1)?.state).toBe("listening");
  });
});

describe("audio, both directions", () => {
  it("streams microphone audio up as binary, untouched", async () => {
    const { browser, endpoint } = await harness();
    browser.emit("message", Buffer.alloc(640, 3), true);
    browser.emit("message", Buffer.alloc(640, 4), true);
    expect(endpoint.sent.filter((s) => s.kind === "audio")).toEqual([
      { kind: "audio", bytes: 640 },
      { kind: "audio", bytes: 640 },
    ]);
  });

  it("plays model audio down to the browser as binary", async () => {
    const { browser, endpoint } = await harness();
    endpoint.emit({
      serverContent: { modelTurn: { parts: [{ inlineData: { mimeType: "audio/pcm", data: ScriptedLiveEndpoint.audio(960) } }] } },
    });
    await tick();
    expect(browser.binary).toHaveLength(1);
    expect(browser.binary[0]).toHaveLength(960);
    expect(browser.of("state").at(-1)?.state).toBe("speaking");
  });

  it("passes both transcripts through, so a mishearing can be SEEN", async () => {
    const { browser, endpoint } = await harness();
    endpoint.emit({ serverContent: { inputTranscription: { text: "book hall two", finished: true } } });
    endpoint.emit({ serverContent: { outputTranscription: { text: "Which time?", finished: false } } });
    expect(browser.of("heard")[0]).toMatchObject({ text: "book hall two", final: true });
    expect(browser.of("said")[0]).toMatchObject({ text: "Which time?", final: false });
  });
});

describe("backpressure", () => {
  it("drops the OLDEST rather than buffering without bound", async () => {
    const { browser, endpoint, relay } = await harness();
    // Stall the consumer, then flood it. `readyState` 0 means "not open yet",
    // which is how a slow or dead browser presents.
    browser.readyState = 0;
    for (let i = 0; i < 100; i += 1) {
      endpoint.emit({
        serverContent: { modelTurn: { parts: [{ inlineData: { mimeType: "audio/pcm", data: ScriptedLiveEndpoint.audio(64) } }] } },
      });
    }
    await tick();
    expect(relay.dropped).toBeGreaterThan(0);
    // 100 chunks in, at most the cap retained — nothing unbounded.
    expect(relay.dropped).toBe(100 - 24);
  });

  it("throws the queue away on an interruption, and says so at once", async () => {
    const { browser, endpoint } = await harness();
    browser.readyState = 0;
    for (let i = 0; i < 5; i += 1) {
      endpoint.emit({
        serverContent: { modelTurn: { parts: [{ inlineData: { mimeType: "audio/pcm", data: ScriptedLiveEndpoint.audio(64) } }] } },
      });
    }
    browser.readyState = 1;
    endpoint.emit({ serverContent: { interrupted: true } });
    await tick();
    expect(browser.of("interrupted")).toHaveLength(1);
    // Nothing queued survived the interruption.
    expect(browser.binary).toHaveLength(0);
  });
});

describe("tool calls", () => {
  it("runs the tool and sends the result back up the SAME socket", async () => {
    const seen: string[] = [];
    const { endpoint } = await harness({
      onToolCall: async (c) => {
        seen.push(c.name);
        return { booked: true };
      },
    });
    endpoint.emit({ toolCall: { functionCalls: [{ id: "c1", name: "room_book", args: { room: "hall-2" } }] } });
    await tick();
    expect(seen).toEqual(["room_book"]);
    expect(endpoint.sent.filter((s) => s.kind === "toolResult")).toEqual([
      { kind: "toolResult", results: [{ id: "c1", name: "room_book", response: { booked: true } }] },
    ]);
  });

  it("⚠ runs calls ONE AT A TIME, in order, even when they arrive together", async () => {
    const order: string[] = [];
    let releaseFirst: () => void = () => {};
    const firstDone = new Promise<void>((r) => (releaseFirst = r));

    const { endpoint } = await harness({
      onToolCall: async (c) => {
        order.push(`start:${c.name}`);
        if (c.name === "slow") await firstDone;
        order.push(`end:${c.name}`);
        return {};
      },
    });

    endpoint.emit({
      toolCall: {
        functionCalls: [
          { id: "a", name: "slow", args: {} },
          { id: "b", name: "fast", args: {} },
        ],
      },
    });
    await tick();
    // The second must NOT have started while the first is outstanding.
    expect(order).toEqual(["start:slow"]);
    releaseFirst();
    await tick();
    await tick();
    expect(order).toEqual(["start:slow", "end:slow", "start:fast", "end:fast"]);
  });

  it("a tool that throws does not kill the conversation", async () => {
    const { endpoint } = await harness({
      onToolCall: async () => {
        throw new Error("the store is down");
      },
    });
    endpoint.emit({ toolCall: { functionCalls: [{ id: "c1", name: "room_book", args: {} }] } });
    await tick();
    const result = endpoint.sent.find((s) => s.kind === "toolResult");
    expect(result).toBeDefined();
    expect(JSON.stringify(result)).toContain("didNotHappen");
    expect(endpoint.closedByRelay).toBe(false);
  });
});

describe("all four close and error paths", () => {
  it("browser closes -> the Vertex socket is closed too", async () => {
    const { browser, endpoint } = await harness();
    browser.emit("close");
    expect(endpoint.closedByRelay).toBe(true);
  });

  it("browser errors -> same as a close", async () => {
    const { browser, endpoint } = await harness();
    browser.emit("error", new Error("ECONNRESET"));
    expect(endpoint.closedByRelay).toBe(true);
  });

  it("Vertex closes -> the browser is told IN WORDS, not left silent", async () => {
    const { browser, endpoint } = await harness();
    endpoint.hangUp(1011, "internal");
    const notices = browser.of("notice");
    expect(notices).toHaveLength(1);
    expect(notices[0].message).toMatch(/voice connection ended/i);
    expect(browser.of("closed")).toHaveLength(1);
  });

  it("Vertex errors -> the browser is told, and the frame is logged", async () => {
    const browser = new FakeBrowser();
    const endpoint = new ScriptedLiveEndpoint();
    const log = vi.fn();
    await openRelay({ browser, endpoint, setup: SETUP, hooks: { onToolCall: async () => ({}), log } });
    await tick();
    endpoint.fail("bad frame", { setup: "nonsense" });
    expect(browser.of("notice")[0].message).toMatch(/something went wrong/i);
    // The frame that caused it is logged beside the message, not lost.
    expect(log).toHaveBeenCalledWith(expect.stringContaining("bad frame"), { setup: "nonsense" });
  });

  it("an upstream that will not open at all is reported, not left hanging", async () => {
    const browser = new FakeBrowser();
    const endpoint = new ScriptedLiveEndpoint("throw");
    await openRelay({ browser, endpoint, setup: SETUP, hooks: { onToolCall: async () => ({}) } });
    expect(browser.of("notice")[0].message).toMatch(/not available right now/i);
    expect(browser.of("closed")).toHaveLength(1);
  });

  it("closing is idempotent — the button, a drop and a shutdown all land here", async () => {
    const { browser, endpoint, relay } = await harness();
    relay.close("first");
    relay.close("second");
    browser.emit("close");
    expect(browser.of("closed").map((m) => m.reason)).toEqual(["first"]);
    expect(endpoint.sent.filter((s) => s.kind === "close")).toHaveLength(1);
  });

  it("the hang-up button closes immediately, not after the current reply", async () => {
    const { browser, endpoint } = await harness();
    // Mid-sentence: audio is streaming down when the button is pressed.
    endpoint.emit({
      serverContent: { modelTurn: { parts: [{ inlineData: { mimeType: "audio/pcm", data: ScriptedLiveEndpoint.audio(64) } }] } },
    });
    browser.emit("message", Buffer.from(JSON.stringify({ type: "end" })), false);
    expect(endpoint.closedByRelay).toBe(true);
    expect(browser.of("closed")[0].reason).toMatch(/you ended/i);
  });
});

describe("⚠ no credential ever reaches the browser", () => {
  /**
   * Asserted, not assumed. The whole reason the server is in the middle is
   * that the service-account key must never be in the browser, where anyone
   * could take it and bill the project. So this inspects **everything the
   * browser socket actually received** rather than reasoning about the code.
   */
  it("nothing the browser receives resembles a credential", async () => {
    const { browser, endpoint } = await harness();
    endpoint.emit({ setupComplete: { sessionId: "s1" } });
    endpoint.emit({ serverContent: { outputTranscription: { text: "Hello.", finished: true } } });
    endpoint.emit({
      serverContent: { modelTurn: { parts: [{ inlineData: { mimeType: "audio/pcm", data: ScriptedLiveEndpoint.audio(128) } }] } },
    });
    endpoint.emit({ toolCall: { functionCalls: [{ id: "c", name: "room_book", args: {} }] } });
    await tick();

    const seen = browser.everything();
    for (const smell of [
      "Bearer ",
      "ya29.",
      "private_key",
      "BEGIN PRIVATE KEY",
      "service_account",
      "client_secret",
      "GOOGLE_APPLICATION_CREDENTIALS",
      "aiplatform.googleapis.com",
    ]) {
      expect(seen, `the browser was sent something containing "${smell}"`).not.toContain(smell);
    }
  });

  it("the browser is never told which model or project is upstream either", async () => {
    const { browser } = await harness();
    expect(browser.everything()).not.toContain("test-live-model");
  });
});

describe("what the browser may say", () => {
  it("passes `viewing` through to the session, as a hint", async () => {
    const browser = new FakeBrowser();
    const endpoint = new ScriptedLiveEndpoint();
    const onViewing = vi.fn();
    await openRelay({ browser, endpoint, setup: SETUP, hooks: { onToolCall: async () => ({}), onViewing } });
    await tick();
    browser.emit(
      "message",
      Buffer.from(JSON.stringify({ type: "viewing", route: "/booking", nodeType: "room", nodeId: "hall-2" })),
      false,
    );
    expect(onViewing).toHaveBeenCalledWith({ route: "/booking", nodeType: "room", nodeId: "hall-2" });
  });

  it("ignores anything it does not recognise, rather than trusting it", async () => {
    const { browser, endpoint } = await harness();
    browser.emit("message", Buffer.from("not json at all"), false);
    browser.emit("message", Buffer.from(JSON.stringify({ type: "actor", actor: "p-admin" })), false);
    browser.emit("message", Buffer.from(JSON.stringify({ type: "toolResult", name: "leave_approve" })), false);
    // Nothing went upstream, and the session is still open.
    expect(endpoint.sent).toHaveLength(0);
    expect(endpoint.closedByRelay).toBe(false);
  });
});
