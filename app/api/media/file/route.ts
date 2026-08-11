import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { get } from "@vercel/blob";

// 1x1 transparent PNG placeholder for missing images
const PLACEHOLDER_PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==",
  "base64"
);

/**
 * GET /api/media/file?path=<blobPathname>
 *
 * Auth-gated proxy for private Vercel Blob files.
 * Validates the user session, then streams the blob content.
 * Browser cookies handle auth automatically for <img> and <a> tags.
 */
export async function GET(req: NextRequest) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const blobPath = req.nextUrl.searchParams.get("path");
  if (!blobPath) {
    return NextResponse.json({ error: "Missing path parameter" }, { status: 400 });
  }

  const isImage = blobPath.endsWith(".png") || blobPath.endsWith(".jpg") || blobPath.endsWith(".jpeg") || blobPath.endsWith(".gif") || blobPath.endsWith(".webp");

  try {
    const result = await get(blobPath, { access: "private" });

    if (!result || result.statusCode !== 200 || !result.stream) {
      console.error("[Media File Proxy] Not found or no stream:", blobPath, "statusCode:", result?.statusCode);
      // Return placeholder image for missing images (prevents broken icon)
      if (isImage) {
        return new NextResponse(PLACEHOLDER_PNG, {
          status: 404,
          headers: { "Content-Type": "image/png", "Cache-Control": "no-cache" },
        });
      }
      return NextResponse.json({ error: "File not found" }, { status: 404 });
    }

    return new NextResponse(result.stream as ReadableStream, {
      headers: {
        "Content-Type": result.blob.contentType || "application/octet-stream",
        // Generated decks and documents download; everything else stays inline
        // so images still render in <img> and an attached PDF still previews.
        //
        // No `filename` parameter, deliberately. A Content-Disposition filename
        // BEATS the anchor's download attribute, and the only name available
        // here is the opaque blob basename ("1770000000000-<uuid>.docx") — the
        // readable title lives on the download card. Sending it made the saved
        // filename worse than not sending it, including for the .pptx case that
        // has been doing this all along.
        //
        // html/svg are forced to download regardless: Content-Type comes
        // straight from blob metadata, text/html is an accepted upload type,
        // and serving it inline from this origin would execute script against
        // the app with the viewer's session (nosniff does not help — it stops
        // sniffing, not an honestly-declared text/html).
        "Content-Disposition": /\.(pptx|docx|html?|svg)$/i.test(blobPath) ? "attachment" : "inline",
        "Cache-Control": "private, max-age=3600",
        "X-Content-Type-Options": "nosniff",
      },
    });
  } catch (error: any) {
    console.error("[Media File Proxy] Error for path:", blobPath, "message:", error?.message);
    // Return placeholder for missing images
    if (isImage) {
      return new NextResponse(PLACEHOLDER_PNG, {
        status: 404,
        headers: { "Content-Type": "image/png", "Cache-Control": "no-cache" },
      });
    }
    return NextResponse.json({ error: "File not found" }, { status: 404 });
  }
}
