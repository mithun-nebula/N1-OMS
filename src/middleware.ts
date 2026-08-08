import { NextResponse, type NextRequest } from "next/server";
import { SESSION_COOKIE } from "@/server/auth-constants";

const PUBLIC_PAGES = ["/login"];
const PUBLIC_API = ["/api/auth/login", "/api/auth/logout", "/api/health"];

export function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;
  const hasSession = Boolean(request.cookies.get(SESSION_COOKIE)?.value);
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

  return NextResponse.next();
}

export const config = {
  matcher: [
    "/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp|css|js|ico|map)$).*)",
  ],
};
