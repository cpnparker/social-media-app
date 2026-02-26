import { NextRequest, NextResponse } from "next/server";
import { put } from "@vercel/blob";

// POST /api/image-proxy — fetch an external image URL and upload to blob storage
export async function POST(req: NextRequest) {
  try {
    const { url, filename } = await req.json();

    if (!url) {
      return NextResponse.json({ error: "URL is required" }, { status: 400 });
    }

    // Fetch the image server-side (no CORS issues)
    const imgRes = await fetch(url, { redirect: "follow" });
    if (!imgRes.ok) {
      return NextResponse.json({ error: "Failed to fetch image" }, { status: 502 });
    }

    const contentType = imgRes.headers.get("content-type") || "image/jpeg";
    const buffer = Buffer.from(await imgRes.arrayBuffer());
    const safeName = (filename || "cover-image").replace(/[^a-z0-9-]/gi, "-") + ".jpg";

    if (process.env.BLOB_READ_WRITE_TOKEN) {
      const blob = await put(safeName, buffer, {
        access: "public",
        addRandomSuffix: true,
        contentType,
      });
      return NextResponse.json({ url: blob.url });
    }

    // Local fallback
    const { writeFile, mkdir } = await import("fs/promises");
    const path = await import("path");
    const crypto = await import("crypto");
    const uniqueName = `${crypto.randomUUID()}.jpg`;
    const uploadsDir = path.join(process.cwd(), "public", "uploads");
    await mkdir(uploadsDir, { recursive: true });
    await writeFile(path.join(uploadsDir, uniqueName), buffer);

    return NextResponse.json({ url: `/uploads/${uniqueName}` });
  } catch (error: any) {
    console.error("Image proxy error:", error.message);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
