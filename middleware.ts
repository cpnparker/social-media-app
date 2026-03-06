import { NextRequest, NextResponse } from "next/server";

/**
 * Middleware for subdomain routing.
 *
 * ai.thecontentengine.com → rewrites to /enginegpt/*
 * All other hosts → blocks direct access to /enginegpt
 */
export function middleware(req: NextRequest) {
  const hostname = req.headers.get("host") || "";
  const { pathname } = req.nextUrl;

  // ── ai.thecontentengine.com subdomain ──
  const isAiSubdomain =
    hostname === "ai.thecontentengine.com" ||
    hostname.startsWith("ai.thecontentengine.com:");

  if (isAiSubdomain) {
    // Let these routes pass through unchanged:
    // - API routes
    // - Auth routes (login, register, NextAuth)
    // - Static files (_next, favicon, assets, etc.)
    if (
      pathname.startsWith("/api/") ||
      pathname.startsWith("/login") ||
      pathname.startsWith("/register") ||
      pathname.startsWith("/_next") ||
      pathname.startsWith("/assets") ||
      pathname === "/favicon.ico"
    ) {
      return NextResponse.next();
    }

    // Already rewritten to /enginegpt — don't loop
    if (pathname.startsWith("/enginegpt")) {
      return NextResponse.next();
    }

    // Rewrite everything else to /enginegpt/*
    const url = req.nextUrl.clone();
    url.pathname = pathname === "/" ? "/enginegpt" : `/enginegpt${pathname}`;
    return NextResponse.rewrite(url);
  }

  // ── Main domain: block direct access to /enginegpt ──
  if (pathname.startsWith("/enginegpt")) {
    const url = req.nextUrl.clone();
    url.pathname = "/";
    return NextResponse.redirect(url);
  }

  return NextResponse.next();
}

export const config = {
  matcher: [
    /*
     * Match all request paths except static files.
     * We skip _next/static, _next/image, and common file extensions.
     */
    "/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico)$).*)",
  ],
};
