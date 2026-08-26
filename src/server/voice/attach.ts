import type { Server } from "node:http";
import type { Duplex } from "node:stream";
import type { IncomingMessage } from "node:http";
import { WebSocketServer, type WebSocket } from "ws";
import type { AuthUser } from "@/server/auth";
import { actorForUpgrade, isVoiceUpgrade, VOICE_PATH } from "./upgrade";

/**
 * The upgrade handler: authenticate, then hand off.
 *
 * This file does two things and deliberately no more — it decides whether a
 * socket may exist at all, and it keeps a register of the ones that do so a
 * shutdown can close them. What happens *on* a socket is `session.ts`.
 *
 * ── ⚠ THE ORDER HERE IS THE GUARANTEE ───────────────────────────────────────
 *
 * `noServer: true`, and `handleUpgrade` is called **only after**
 * `actorForUpgrade` has returned somebody. An unauthenticated caller is
 * answered with a raw `HTTP/1.1 401` on the still-plain socket, which is then
 * destroyed. The WebSocket handshake never completes, so there is no socket to
 * close, no `connection` event, and nothing to write a refusal to.
 *
 * `ws` is used for the DOWNSTREAM half — accepting a browser — because Node has
 * no built-in WebSocket *server*. The UPSTREAM half, to Vertex, uses Node 24's
 * built-in client and needs no dependency at all.
 */

/** What a connected speaker is, as far as this layer is concerned. */
export interface VoiceConnection {
  socket: WebSocket;
  user: AuthUser;
  /** Query string from the upgrade URL — `viewing` context arrives here. */
  params: URLSearchParams;
}

export interface AttachOptions {
  /**
   * What to run for each authenticated socket. Injected so a test can attach a
   * scripted handler to a real HTTP server without going near Vertex, and so
   * `server.ts` does not have to know what a session is.
   *
   * Returns a closer, called on shutdown.
   */
  onConnection?: (conn: VoiceConnection) => { close: (reason: string) => void };
}

export interface AttachedVoice {
  openSessions(): number;
  closeAll(reason: string): void;
  /** The path this listens on, for tests and for the browser to build its URL. */
  readonly path: string;
}

export function attachVoiceUpgrade(server: Server, opts: AttachOptions = {}): AttachedVoice {
  const wss = new WebSocketServer({ noServer: true });
  const live = new Set<{ close: (reason: string) => void }>();

  const ours = (req: IncomingMessage, socket: Duplex, head: Buffer) => {
    if (!isVoiceUpgrade(req)) {
      // Not ours. Next's dev server upgrades its own HMR socket, so this must
      // leave anything it does not recognise completely alone rather than
      // refusing it — destroying the socket here would break hot reload.
      return;
    }

    const user = actorForUpgrade({ cookie: req.headers.cookie });
    if (!user) {
      // ⚠ Refused BEFORE the handshake. Not a close frame — a plain HTTP
      // response on a socket that never became a WebSocket.
      socket.write(
        "HTTP/1.1 401 Unauthorized\r\n" +
          "Connection: close\r\n" +
          "Content-Type: text/plain\r\n" +
          "Content-Length: 18\r\n" +
          "\r\n" +
          "Not authenticated.",
      );
      socket.destroy();
      return;
    }

    wss.handleUpgrade(req, socket, head, (ws) => {
      const params = new URL(req.url ?? VOICE_PATH, "http://localhost").searchParams;
      const handle = opts.onConnection?.({ socket: ws, user, params });
      if (!handle) {
        // No session factory wired (the Prompt 1 shape, and any misconfiguration
        // later). Say so in words rather than going silent — a socket that
        // opens and does nothing is indistinguishable from one that broke.
        ws.send(JSON.stringify({ type: "error", message: "Voice is not configured on this server." }));
        ws.close(1011, "no session factory");
        return;
      }
      live.add(handle);
      ws.on("close", () => live.delete(handle));
    });
  };

  server.on("upgrade", ours);
  fenceOffNextsUpgradeHandler(server, ours);

  return {
    path: VOICE_PATH,
    openSessions: () => live.size,
    closeAll: (reason: string) => {
      for (const h of [...live]) h.close(reason);
      live.clear();
      wss.close();
    },
  };
}


/**
 * ⚠ **NEXT ATTACHES ITS OWN `upgrade` LISTENER, LATE, AND ENDS OUR SOCKET.**
 *
 * ── The bug this exists to stop, and why it was so hard to see ──────────────
 *
 * `next/dist/server/next.js` — `setupWebSocketHandler()` — does this:
 *
 *     getRequestHandler() {
 *       return async (req, res) => {
 *         this.setupWebSocketHandler(this.options.httpServer, req);
 *         ...
 *
 * and `setupWebSocketHandler` falls back to **`req.socket.server`** when it was
 * not given one. That is OUR server. So Next adds a second `upgrade` listener
 * to a server it was never handed — **on the first HTTP request it serves**,
 * not at startup.
 *
 * Its handler resolves the path against the route table, finds
 * `app/api/voice/route.ts`, and:
 *
 *     if (matchedOutput) { return socket.end(); }        // router-server.js
 *
 * The result is a socket that completes its handshake, fires `open`, and is
 * then killed a few milliseconds later with **no close frame** — code 1006, no
 * error, nothing logged. And it only happens **after a page has been loaded**,
 * so:
 *
 *   - `server.listenerCount("upgrade")` at startup says **1**, ours;
 *   - a WebSocket opened before any page load works perfectly;
 *   - every test that builds a bare `http.Server` passes, because there is no
 *     Next in it;
 *   - and in a real browser, where a page load always comes first, voice never
 *     works.
 *
 * ── The fix ─────────────────────────────────────────────────────────────────
 *
 * Node has no way to stop an event reaching later listeners, so Next's handler
 * is **wrapped as it is registered** and made to ignore the one path we own.
 * Everything else Next upgrades — its dev HMR socket above all — reaches it
 * untouched.
 *
 * Deleting `app/api/voice/route.ts` would also stop `matchedOutput` matching,
 * and was rejected: it would fix this by accident, leave `/api/voice` a 404 for
 * anybody who opens it in a browser, and break again the moment somebody added
 * the file back for good reasons.
 */
function fenceOffNextsUpgradeHandler(server: Server, ours: UpgradeListener): void {
  type Add = (event: string, listener: UpgradeListener) => Server;
  const patch = (name: "on" | "addListener" | "prependListener") => {
    const original = server[name].bind(server) as Add;
    (server as unknown as Record<string, Add>)[name] = (event, listener) => {
      if (event !== "upgrade" || listener === ours) return original(event, listener);
      return original(event, (req, socket, head) => {
        // Ours. Next must not see it, and must not end it.
        if (isVoiceUpgrade(req)) return;
        listener(req, socket, head);
      });
    };
  };
  patch("on");
  patch("addListener");
  patch("prependListener");
}

type UpgradeListener = (req: IncomingMessage, socket: Duplex, head: Buffer) => void;
