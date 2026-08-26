import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { createServer, type Server } from "node:http";
import { WebSocket } from "ws";
import { createSessionToken, SESSION_COOKIE } from "@/server/auth";
import { attachVoiceUpgrade, type VoiceConnection } from "./attach";
import { parseCookies, actorForUpgrade, isVoiceUpgrade } from "./upgrade";

/**
 * ⚠ The one thing Prompt 1 exists to prove: **an unauthenticated upgrade never
 * becomes a socket.**
 *
 * Not "opens and is then closed" — the handshake does not complete at all, and
 * the client sees an HTTP 401 rather than a WebSocket close frame. The two are
 * distinguishable from the outside, which is what makes this testable: `ws`
 * raises `Unexpected server response: 401` on the *client* rather than firing
 * `open` followed by `close`.
 */

const ADMIN = {
  id: "p-admin",
  username: "admin",
  role: "admin" as const,
  displayName: "Admin",
};

describe("parseCookies", () => {
  it("reads the session cookie out of a header with several", () => {
    const jar = parseCookies(`theme=dark; ${SESSION_COOKIE}=abc.def; other=1`);
    expect(jar[SESSION_COOKIE]).toBe("abc.def");
  });

  it("treats absent, empty and malformed headers as no cookie", () => {
    expect(parseCookies(undefined)[SESSION_COOKIE]).toBeUndefined();
    expect(parseCookies("")[SESSION_COOKIE]).toBeUndefined();
    expect(parseCookies("garbage")[SESSION_COOKIE]).toBeUndefined();
  });

  it("keeps the FIRST occurrence, so an appended duplicate cannot shadow the real one", () => {
    // A caller who can append to the Cookie header must not be able to
    // override the browser's session by adding a second one after it.
    const jar = parseCookies(`${SESSION_COOKIE}=real; ${SESSION_COOKIE}=forged`);
    expect(jar[SESSION_COOKIE]).toBe("real");
  });
});

describe("actorForUpgrade", () => {
  it("returns the signed-in person for a valid session cookie", () => {
    const token = createSessionToken(ADMIN);
    const user = actorForUpgrade({ cookie: `${SESSION_COOKIE}=${token}` });
    expect(user?.id).toBe("p-admin");
  });

  it("refuses a forged token", () => {
    const token = createSessionToken(ADMIN);
    const [payload] = token.split(".");
    expect(actorForUpgrade({ cookie: `${SESSION_COOKIE}=${payload}.notthesignature` })).toBeNull();
  });

  it("refuses no cookie at all", () => {
    expect(actorForUpgrade({})).toBeNull();
  });
});

describe("isVoiceUpgrade", () => {
  it("matches the voice path, with or without a query string", () => {
    expect(isVoiceUpgrade({ url: "/api/voice" })).toBe(true);
    expect(isVoiceUpgrade({ url: "/api/voice?viewing=room:hall-2" })).toBe(true);
  });

  it("leaves every other upgrade alone — Next's own HMR socket included", () => {
    expect(isVoiceUpgrade({ url: "/_next/webpack-hmr" })).toBe(false);
    expect(isVoiceUpgrade({ url: "/api/voice/extra" })).toBe(false);
    expect(isVoiceUpgrade({ url: undefined })).toBe(false);
  });
});

describe("the upgrade, against a real HTTP server", () => {
  let server: Server;
  let port: number;
  const connections: VoiceConnection[] = [];

  beforeAll(async () => {
    server = createServer((_req, res) => res.end("next would handle this"));
    attachVoiceUpgrade(server, {
      onConnection: (conn) => {
        connections.push(conn);
        return { close: () => conn.socket.close(1000, "closed by test") };
      },
    });
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    port = (server.address() as { port: number }).port;
  });

  afterAll(async () => {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  });

  const connect = (cookie?: string) =>
    new Promise<{ opened: boolean; error?: string }>((resolve) => {
      const ws = new WebSocket(`ws://127.0.0.1:${port}/api/voice`, {
        headers: cookie ? { cookie } : {},
      });
      ws.on("open", () => {
        ws.close();
        resolve({ opened: true });
      });
      ws.on("error", (e: Error) => resolve({ opened: false, error: e.message }));
      setTimeout(() => resolve({ opened: false, error: "timed out" }), 4000);
    });

  it("REFUSES an upgrade with no session cookie, before the handshake", async () => {
    const out = await connect();
    expect(out.opened).toBe(false);
    // A 401 on the client's error, not a close code, is the proof that the
    // handshake never completed.
    expect(out.error).toContain("401");
  });

  it("REFUSES an upgrade whose session cookie does not verify", async () => {
    const out = await connect(`${SESSION_COOKIE}=made.up`);
    expect(out.opened).toBe(false);
    expect(out.error).toContain("401");
  });

  it("nothing reached the session factory for either refusal", () => {
    expect(connections).toHaveLength(0);
  });

  it("accepts a signed-in person, and binds the actor from the cookie", async () => {
    const out = await connect(`${SESSION_COOKIE}=${createSessionToken(ADMIN)}`);
    expect(out.opened).toBe(true);
    expect(connections.at(-1)?.user.id).toBe("p-admin");
  });

  /**
   * ⚠ The regression this exists to stop, and it made voice fail for EVERY
   * real user while every test passed.
   *
   * Next's `getRequestHandler()` attaches its OWN `upgrade` listener — lazily,
   * on the first HTTP request it serves, to `req.socket.server`, which is our
   * server even though we never handed it over. Its handler matches
   * `/api/voice` against the route table and calls `socket.end()`.
   *
   * The socket therefore completed its handshake, fired `open`, and died a few
   * milliseconds later with **code 1006, no close frame, no error and nothing
   * logged** — and only ever after a page had been loaded. Startup said one
   * listener. A socket opened before any page load was fine. Every bare
   * `http.Server` test passed. In a browser, where a page load always comes
   * first, it never worked once.
   *
   * So this test does the thing that reproduces it: adds a hostile `upgrade`
   * listener AFTER `attachVoiceUpgrade`, exactly as Next does.
   */
  it("⚠ a listener added LATER cannot end our socket — Next adds one on the first request", async () => {
    const late = createServer((_req, res) => res.end("next would handle this"));
    const seenByLate: string[] = [];
    attachVoiceUpgrade(late, {
      onConnection: (conn) => ({ close: () => conn.socket.close(1000, "bye") }),
    });

    // Registered after ours, and destructive — this is Next's shape.
    late.on("upgrade", (req, socket) => {
      seenByLate.push(req.url ?? "");
      socket.end();
    });

    await new Promise<void>((resolve) => late.listen(0, "127.0.0.1", resolve));
    const p = (late.address() as { port: number }).port;

    const voiceWs = new WebSocket(`ws://127.0.0.1:${p}/api/voice`, {
      headers: { cookie: `${SESSION_COOKIE}=${createSessionToken(ADMIN)}` },
    });
    const outcome = await new Promise<string>((resolve) => {
      const ws = voiceWs;
      ws.on("open", () => setTimeout(() => resolve(ws.readyState === WebSocket.OPEN ? "still open" : "died"), 300));
      ws.on("error", (e: Error) => resolve(`error: ${e.message}`));
      setTimeout(() => resolve("timed out"), 2000);
    });

    expect(outcome, "a later listener ended the voice socket").toBe("still open");
    // Our path never reached it...
    expect(seenByLate).not.toContain("/api/voice");

    // ...but everything else still does, which is the other half: Next's own
    // HMR socket must not be broken by the fence.
    await new Promise<void>((resolve) => {
      const ws = new WebSocket(`ws://127.0.0.1:${p}/_next/webpack-hmr`);
      ws.on("open", () => resolve());
      ws.on("error", () => resolve());
      setTimeout(resolve, 1500);
    });
    expect(seenByLate).toContain("/_next/webpack-hmr");

    // The voice socket is genuinely still open, so it has to be let go of
    // before the server will finish closing.
    voiceWs.terminate();
    late.closeAllConnections?.();
    await new Promise<void>((resolve) => late.close(() => resolve()));
  }, 15000);

  it("carries the query string through, for screen context", async () => {
    await new Promise<void>((resolve) => {
      const ws = new WebSocket(
        `ws://127.0.0.1:${port}/api/voice?route=%2Fbooking&nodeType=room&nodeId=hall-2`,
        { headers: { cookie: `${SESSION_COOKIE}=${createSessionToken(ADMIN)}` } },
      );
      ws.on("open", () => {
        ws.close();
        resolve();
      });
      ws.on("error", () => resolve());
    });
    expect(connections.at(-1)?.params.get("nodeId")).toBe("hall-2");
  });
});
