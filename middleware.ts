import { NextRequest, NextResponse } from "next/server";

/**
 * Middleware for subdomain routing.
 *
 * engine.thecontentengine.com     → main app (dashboard, content, settings, etc.)
 * operations.thecontentengine.com → operations section + settings
 * ai.thecontentengine.com         → EngineGPT standalone
 *
 * Cross-subdomain redirects: if a user navigates to the wrong section
 * on the wrong subdomain, redirect them to the correct one.
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

    // Already on /enginegpt — pass through
    if (pathname === "/enginegpt") {
      return NextResponse.next();
    }

    // Root path: rewrite to /enginegpt so the URL stays clean as "/"
    if (pathname === "/") {
      const url = req.nextUrl.clone();
      url.pathname = "/enginegpt";
      return NextResponse.rewrite(url);
    }

    // Any other path (e.g. /dashboard from a stale redirect or client nav) —
    // hard-redirect back to root, which then rewrites to /enginegpt.
    // Using redirect (not rewrite) forces a new server request.
    const url = req.nextUrl.clone();
    url.pathname = "/";
    return NextResponse.redirect(url);
  }

  // ── operations.thecontentengine.com subdomain ──
  const isOpsSubdomain =
    hostname === "operations.thecontentengine.com" ||
    hostname.startsWith("operations.thecontentengine.com:");

  if (isOpsSubdomain) {
    if (isPassthrough) {
      return NextResponse.next();
    }

    // Allow operations pages and settings
    if (pathname.startsWith("/operations") || pathname.startsWith("/settings")) {
      return NextResponse.next();
    }

    // Redirect anything else to the operations landing page
    const url = req.nextUrl.clone();
    url.pathname = "/operations/commissioned-cus";
    return NextResponse.redirect(url);
  }

  // ── engine.thecontentengine.com subdomain ──
  const isEngineSubdomain =
    hostname === "engine.thecontentengine.com" ||
    hostname.startsWith("engine.thecontentengine.com:");

  if (isEngineSubdomain) {
    if (isPassthrough) {
      return NextResponse.next();
    }

    // Block /enginegpt on the engine subdomain — redirect to AI subdomain
    if (pathname === "/enginegpt" || pathname.startsWith("/enginegpt/")) {
      const url = req.nextUrl.clone();
      url.hostname = "ai.thecontentengine.com";
      url.pathname = "/";
      url.port = "";
      return NextResponse.redirect(url);
    }

    // Block /operations on the engine subdomain — redirect to ops subdomain
    if (pathname.startsWith("/operations")) {
      const url = req.nextUrl.clone();
      url.hostname = "operations.thecontentengine.com";
      url.port = "";
      return NextResponse.redirect(url);
    }

    // Everything else (dashboard, content, settings, ai-writer, etc.) passes through
    return NextResponse.next();
  }

  // ── Any other host (Vercel preview URLs, localhost, etc.) ──
  // Allow /enginegpt on non-production hosts (dev, preview)
  // so the app is fully testable without subdomain setup.

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
