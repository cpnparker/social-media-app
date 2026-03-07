import { NextRequest, NextResponse } from "next/server";

/**
 * Middleware for subdomain routing.
 *
 * ai.thecontentengine.com → rewrites to /enginegpt (single-page app)
 * operations.thecontentengine.com → redirects non-operations paths to /operations/commissioned-cus
 * All other hosts → blocks direct access to /enginegpt
 */
export function middleware(req: NextRequest) {
  const hostname = req.headers.get("host") || "";
  const { pathname } = req.nextUrl;

  // Routes that should always pass through on any subdomain
  const isPassthrough =
    pathname.startsWith("/api/") ||
    pathname.startsWith("/login") ||
    pathname.startsWith("/register") ||
    pathname.startsWith("/_next") ||
    pathname.startsWith("/assets") ||
    pathname === "/favicon.ico";

  // ── ai.thecontentengine.com subdomain ──
  const isAiSubdomain =
    hostname === "ai.thecontentengine.com" ||
    hostname.startsWith("ai.thecontentengine.com:");

  if (isAiSubdomain) {
    if (isPassthrough) {
      return NextResponse.next();
    }

    // Already rewritten to /enginegpt — don't loop
    if (pathname === "/enginegpt") {
      return NextResponse.next();
    }

    // Rewrite ALL paths to /enginegpt (single-page standalone app)
    // This handles /dashboard, /settings, or any other path after login
    const url = req.nextUrl.clone();
    url.pathname = "/enginegpt";
    return NextResponse.rewrite(url);
  }

  // ── operations.thecontentengine.com subdomain ──
  const isOpsSubdomain =
    hostname === "operations.thecontentengine.com" ||
    hostname.startsWith("operations.thecontentengine.com:");

  if (isOpsSubdomain) {
    if (isPassthrough) {
      return NextResponse.next();
    }

    // If not already on an operations page, redirect there
    if (!pathname.startsWith("/operations")) {
      const url = req.nextUrl.clone();
      url.pathname = "/operations/commissioned-cus";
      return NextResponse.redirect(url);
    }
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
