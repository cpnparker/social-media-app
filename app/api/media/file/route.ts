import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { get } from "@vercel/blob";

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

  try {
    const blobToken = process.env.PRIVATE_READ_WRITE_TOKEN || process.env.BLOB_READ_WRITE_TOKEN;
    const result = await get(blobPath, { access: "private", token: blobToken });

    if (!result || result.statusCode !== 200 || !result.stream) {
      return NextResponse.json({ error: "File not found" }, { status: 404 });
    }

    return new NextResponse(result.stream as ReadableStream, {
      headers: {
        "Content-Type": result.blob.contentType || "application/octet-stream",
        "Cache-Control": "private, max-age=3600",
        "X-Content-Type-Options": "nosniff",
      },
    });
  } catch (error: any) {
    console.error("[Media File Proxy] Error:", error?.message);
    return NextResponse.json({ error: "File not found" }, { status: 404 });
  }
}
