import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

/**
 * ⚠ **The voice socket does NOT live here, and it cannot.**
 *
 * `implementation-plan.md` lists this file as "the socket endpoint". Building
 * it that way is impossible and finding that out late would be expensive, so
 * the file exists to say so.
 *
 * A Next App Router route handler returns a `Response`. **It never sees the
 * HTTP upgrade** — Next's own HTTP layer consumes it before any route runs, and
 * no way of writing `GET` changes that. The upgrade is handled one level down,
 * in `server.ts`, by `src/server/voice/attach.ts`, which authenticates the
 * session cookie and refuses with a 401 **before the handshake completes**.
 *
 * What is left for this route is the thing a person or a probe gets when they
 * open `/api/voice` in a browser: an explanation, rather than a 404 that
 * suggests voice is missing.
 */
export function GET() {
  return NextResponse.json(
    {
      error: "This endpoint is a WebSocket, not an HTTP resource.",
      detail:
        "Connect with ws:// or wss:// to /api/voice. The upgrade is handled by the custom server " +
        "(server.ts), because a Next route handler never sees an HTTP upgrade. Run the app with " +
        "`npm start` or `npm run dev` — `next start` does not serve this.",
    },
    { status: 426, headers: { Upgrade: "websocket", Connection: "Upgrade" } },
  );
}
