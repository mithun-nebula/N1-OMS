import type { IncomingMessage } from "node:http";
import { readSessionToken, SESSION_COOKIE, type AuthUser } from "@/server/auth";

/**
 * Who is speaking, decided before the socket exists.
 *
 * ── ⚠ WHY THIS RUNS ON THE UPGRADE AND NOT AFTER ────────────────────────────
 *
 * Every guarantee in this phase begins with knowing who is talking. A socket
 * that opens and *then* checks is a socket that existed for an unauthenticated
 * caller — it consumed a file descriptor, it could be written to, and whatever
 * refusal follows is a message rather than an absence.
 *
 * So the cookie is read off the raw upgrade request's headers and the
 * handshake is refused with a plain HTTP 401 **before it completes**. There is
 * no moment at which an anonymous WebSocket to this server is open.
 *
 * ── Why the cookie, and not a token in the URL ───────────────────────────────
 *
 * `getSessionUser()` cannot be used here: it reads `next/headers`, which only
 * exists inside a Next request. `readSessionToken()` is the half underneath it
 * — a pure function over the cookie value — and it is deliberately the SAME
 * function, not a second implementation. The session HMAC is verified once, in
 * one place, whether the caller arrived by fetch or by upgrade.
 *
 * A query-string token was the alternative and is worse: URLs are logged by
 * proxies and kept in history, and a session token in an access log is a
 * session anybody with the log can resume.
 */

/** Parse a `Cookie:` header into a map. Absent, malformed and empty all mean "no cookie". */
export function parseCookies(header: string | undefined): Record<string, string> {
  const out: Record<string, string> = {};
  if (!header) return out;
  for (const part of header.split(";")) {
    const eq = part.indexOf("=");
    if (eq < 0) continue;
    const name = part.slice(0, eq).trim();
    if (!name) continue;
    // Only the first occurrence counts. A second `orga_session=` appended by a
    // caller must not be able to shadow the browser's real one.
    if (name in out) continue;
    out[name] = decodeURIComponent(part.slice(eq + 1).trim());
  }
  return out;
}

/**
 * The actor for this upgrade, or `null` to refuse it.
 *
 * Takes the headers rather than the request so the test does not have to
 * construct an `IncomingMessage`.
 */
export function actorForUpgrade(headers: { cookie?: string }): AuthUser | null {
  return readSessionToken(parseCookies(headers.cookie)[SESSION_COOKIE]);
}

/** The one path this server upgrades. Anything else is a 404, not a socket. */
export const VOICE_PATH = "/api/voice";

export function isVoiceUpgrade(req: Pick<IncomingMessage, "url">): boolean {
  if (!req.url) return false;
  // `new URL` needs a base; the host is irrelevant because only the path is read.
  const path = new URL(req.url, "http://localhost").pathname;
  return path === VOICE_PATH;
}
