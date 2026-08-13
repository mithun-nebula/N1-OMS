import { NextResponse, type NextRequest } from "next/server";
import { SESSION_COOKIE } from "@/server/auth-constants";

const PUBLIC_PAGES = ["/login"];
const PUBLIC_API = ["/api/auth/login", "/api/auth/logout", "/api/health"];

/** Reachable while an account still has to replace its temporary password. */
const PASSWORD_CHANGE_PAGE = "/settings/password";
const PASSWORD_CHANGE_ALLOWED_API = [
  "/api/settings/password",
  "/api/auth/logout",
  "/api/me",
];

/**
 * Reads `mustChangePassword` out of the session payload **without verifying the
 * signature**, because Edge middleware has neither `node:crypto` nor the
 * database.
 *
 * This is a redirect hint, not enforcement. It is deliberately not trusted:
 *
 *  - It can be **stale** — the token is a snapshot from sign-in, so an admin
 *    reset since then is not in it.
 *  - It can be **forged** — nothing here checks the signature.
 *
 * Enforcement lives in `src/server/session-guard.ts`, which reads the live
 * account in the Node runtime, and is applied at `POST /api/operations` — the
 * single write door for all seven starts. Reaching a page past this hint
 * therefore gains nothing: no operation will run.
 */
function mustChangePassword(token: string | undefined): boolean {
  if (!token) return false;
  const payload = token.split(".")[0];
  if (!payload) return false;
  try {
    const json = atob(payload.replace(/-/g, "+").replace(/_/g, "/"));
    return (JSON.parse(json) as { mustChangePassword?: boolean })
      .mustChangePassword === true;
  } catch {
    return false;
  }
}

export function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;
  const token = request.cookies.get(SESSION_COOKIE)?.value;
  const hasSession = Boolean(token);
  const isApi = pathname.startsWith("/api/");

  if (!hasSession) {
    if (isApi) {
      if (PUBLIC_API.some((p) => pathname === p)) {
        return NextResponse.next();
      }
      return NextResponse.json(
        { error: "Not authenticated." },
        { status: 401 },
      );
    }
    if (PUBLIC_PAGES.some((p) => pathname === p)) {
      return NextResponse.next();
    }
    const url = request.nextUrl.clone();
    url.pathname = "/login";
    url.search = "";
    return NextResponse.redirect(url);
  }

  if (pathname === "/login") {
    const url = request.nextUrl.clone();
    url.pathname = "/dashboard";
    url.search = "";
    return NextResponse.redirect(url);
  }

  // A temporary password gets you exactly one place: the page that replaces it.
  if (mustChangePassword(token)) {
    if (isApi) {
      if (PASSWORD_CHANGE_ALLOWED_API.some((p) => pathname === p)) {
        return NextResponse.next();
      }
      return NextResponse.json(
        { error: "Set a new password before continuing." },
        { status: 403 },
      );
    }
    if (pathname !== PASSWORD_CHANGE_PAGE) {
      const url = request.nextUrl.clone();
      url.pathname = PASSWORD_CHANGE_PAGE;
      url.search = "";
      return NextResponse.redirect(url);
    }
  }

  return NextResponse.next();
}

export const config = {
  matcher: [
    "/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp|css|js|ico|map)$).*)",
  ],
};
