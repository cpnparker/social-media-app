import { NextRequest, NextResponse } from "next/server";
import { get } from "@vercel/blob";
import { verifyMediaSignature } from "@/lib/media/signed";

/**
 * GET /api/media/signed?path=…&exp=…&sig=…
 *
 * The unauthenticated sibling of /api/media/file. It exists for one caller
 * that can never have a session: Google, fetching a slide's image from its own
 * servers at insertion time.
 *
 * The signature IS the authorisation — it scopes the grant to a single blob
 * path and an expiry, so holding one URL grants that image and nothing else.
 * No session is consulted precisely because the intended caller has none.
 */
export const maxDuration = 30;

/** Only ever serve inert media through an unauthenticated route. Nothing here
 *  should be able to run script against this origin. */
const SERVABLE = /\.(png|jpe?g|gif|webp)$/i;

export async function GET(req: NextRequest) {
  const path = req.nextUrl.searchParams.get("path");
  const exp = req.nextUrl.searchParams.get("exp");
  const sig = req.nextUrl.searchParams.get("sig");
  if (!path || !exp || !sig) {
    return NextResponse.json({ error: "Missing parameters" }, { status: 400 });
  }

  // 404 rather than 403 throughout: a 403 confirms a file exists at a path to
  // someone holding no valid signature for it.
  if (!SERVABLE.test(path)) return NextResponse.json({ error: "Not found" }, { status: 404 });
  if (!verifyMediaSignature(path, exp, sig)) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  try {
    const result = await get(path, { access: "private" });
    if (!result || result.statusCode !== 200 || !result.stream) {
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    }
    return new NextResponse(result.stream as ReadableStream, {
      headers: {
        "Content-Type": result.blob.contentType || "image/png",
        "Content-Disposition": "inline",
        // Cacheable: the URL is a capability, so anyone who can request it can
        // already see the bytes, and Google refetching costs us nothing.
        "Cache-Control": "public, max-age=86400",
        "X-Content-Type-Options": "nosniff",
      },
    });
  } catch (err: any) {
    console.error(`[Media Signed] ${path}: ${err?.message}`);
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
}
