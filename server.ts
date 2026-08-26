/**
 * The entry point, and the reason it exists.
 *
 * ── ⚠ THIS PROJECT COULD NOT ACCEPT A WEBSOCKET UNTIL THIS FILE ─────────────
 *
 * A Next App Router route handler returns a `Response`. **It never sees the
 * HTTP upgrade.** `export async function GET()` in `app/api/voice/route.ts`
 * cannot become a WebSocket however it is written — the upgrade is consumed by
 * Next's own HTTP layer before any route runs. Phase 6 needs a socket held open
 * per speaker, so the server underneath Next had to become ours.
 *
 * ── Three ways out, and why this one ────────────────────────────────────────
 *
 *   A · a custom Node server wrapping Next        <- chosen
 *   B · a separate WebSocket process on its own port
 *   C · WebRTC, a data channel plus signalling
 *
 * **Session auth decided it.** Every guarantee in this phase begins with
 * knowing WHO IS SPEAKING, and that answer already exists in this process: the
 * session cookie Next set, verified by `readSessionToken`. B would have made
 * that a new problem — a second process would have to be taught to validate a
 * cookie it did not issue — before any voice work started. C is a larger
 * surface than the thing it replaces, and A did not fail.
 *
 * The cost of A is stated rather than hidden: **`next start` is no longer the
 * entry point**, and this file now owns the server lifecycle Next was managing.
 * `docs/STATUS.md` says so in its "how to run it" section, because somebody
 * cloning this repo will otherwise start it the old way and voice will simply
 * not be there.
 *
 * ── Why it is run by `tsx` rather than compiled ─────────────────────────────
 *
 * This file reaches into `src/` for the session verifier and the relay, and
 * `src/` is written for a bundler: `@/*` path aliases and extensionless
 * imports, neither of which plain `node` resolves. The alternatives were to
 * duplicate the session HMAC here — a second implementation of the one thing
 * that must never have two — or to add a bundling step for one file. `tsx`
 * resolves `tsconfig.json`'s paths and strips the types, and is the smaller
 * price.
 */
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";

/**
 * ⚠ `--prod` rather than `NODE_ENV=production` in the script.
 *
 * `NODE_ENV=x cmd` is shell syntax that Windows' cmd and PowerShell do not
 * have, and this project is developed on Windows. The flag is set here and
 * `NODE_ENV` is assigned from it, BEFORE Next is imported — Next and React both
 * read that variable at module load, so a dynamic import is the only way to set
 * it first. That is why `next` is not a static import in this one file.
 */
const prod = process.argv.includes("--prod");
// `process.env.NODE_ENV` is typed read-only by Next's ambient declarations,
// which is right for application code and wrong for the process entry point —
// this IS the place that decides it.
if (prod) (process.env as Record<string, string>).NODE_ENV = "production";
const dev = !prod && process.env.NODE_ENV !== "production";
const hostname = process.env.HOST ?? "0.0.0.0";
const port = Number(process.env.PORT ?? 3000);

async function main(): Promise<void> {
  const { default: next } = await import("next");
  const app = next({ dev, hostname, port });
  await app.prepare();
  const handle = app.getRequestHandler();

  /**
   * ⚠ Imported HERE, after `app.prepare()`, and that ordering is load-bearing.
   *
   * The upgrade handler reaches `src/server/auth.ts`, which imports
   * `next/headers`. Loading that before Next has set up its Node environment
   * fails at module scope with *"Invariant: AsyncLocalStorage accessed in
   * runtime where it is not available"* — an error that names nothing to do
   * with voice, sessions or this file, and cost a while to place.
   *
   * A static import at the top of this file is hoisted above the dynamic
   * `next` import and so always loses that race. The alternative was to assign
   * `globalThis.AsyncLocalStorage` ourselves, which is reaching into Next's
   * bootstrap to fix an ordering problem that ordering already fixes.
   */
  const { startVoice } = await import("@/server/voice/start");

  const server = createServer((req: IncomingMessage, res: ServerResponse) => {
    void handle(req, res);
  });

  // The whole point of this file. Everything that is not the voice path is
  // still Next's, untouched.
  const voice = startVoice(server);

  /**
   * ⚠ A shutdown must close every open session.
   *
   * An orphaned upstream socket goes on billing until Google gives up on it,
   * and unlike the token ceiling that accrues while nothing is happening. See
   * `session.ts`.
   */
  let closing = false;
  const shutdown = (signal: string) => {
    if (closing) return;
    closing = true;
    console.log(`[voice] ${signal} — closing ${voice.openSessions()} open session(s)`);
    voice.closeAll("server shutting down");
    server.close(() => process.exit(0));
    // A held socket will not let `close` finish on its own.
    setTimeout(() => process.exit(0), 3000).unref();
  };
  process.on("SIGINT", () => shutdown("SIGINT"));
  process.on("SIGTERM", () => shutdown("SIGTERM"));

  server.listen(port, hostname, () => {
    console.log(`> ready on http://${hostname}:${port}  (voice upgrade on /api/voice)`);
  });
}

void main();
