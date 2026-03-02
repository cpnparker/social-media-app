import { NextRequest, NextResponse } from "next/server";

const OPERATIONS_HOST = "operations.thecontentengine.com";

export function middleware(req: NextRequest) {
  const { pathname } = req.nextUrl;
  const host = req.headers.get("host") || "";

  // Allow public routes
  const publicPaths = ["/login", "/register", "/links"];
  if (publicPaths.some((p) => pathname.startsWith(p))) {
    return NextResponse.next();
  }

  // Light auth check — just verify the session cookie exists.
  // Full auth validation happens in API routes and server components.
  const isProduction = process.env.NODE_ENV === "production";
  const cookieName = isProduction
    ? "__Secure-authjs.session-token"
    : "authjs.session-token";
  const sessionToken = req.cookies.get(cookieName)?.value;

  if (!sessionToken) {
    const loginUrl = new URL("/login", req.nextUrl.origin);
    loginUrl.searchParams.set("callbackUrl", pathname);
    return NextResponse.redirect(loginUrl);
  }

  // ── Operations subdomain handling ──
  if (host === OPERATIONS_HOST && pathname === "/") {
    return NextResponse.redirect(
      new URL("/operations/commissioned-cus", req.nextUrl.origin)
    );
  }

  return NextResponse.next();
}

export const config = {
  matcher: ["/((?!api|_next/static|_next/image|favicon.ico).*)"],
};
