import { NextRequest, NextResponse } from "next/server";
import { put } from "@vercel/blob";
import { writeFile, mkdir } from "fs/promises";
import path from "path";
import crypto from "crypto";

// Route segment config for App Router — extend timeout for large video uploads
export const maxDuration = 60; // 60 seconds

// POST /api/media/upload — upload file to Vercel Blob (or local fallback)
export async function POST(req: NextRequest) {
  try {
    const formData = await req.formData();
    const file = formData.get("file") as File;

    if (!file) {
      return NextResponse.json(
        { error: "No file provided" },
        { status: 400 }
      );
    }

    // Validate file type
    const allowedTypes = [
      "image/jpeg",
      "image/png",
      "image/gif",
      "image/webp",
      "video/mp4",
      "video/quicktime",
      "video/webm",
    ];

    if (!allowedTypes.includes(file.type)) {
      return NextResponse.json(
        { error: "Unsupported file type" },
        { status: 400 }
      );
    }

    // Validate file size (50MB max)
    if (file.size > 50 * 1024 * 1024) {
      return NextResponse.json(
        { error: "File too large. Maximum size is 50MB." },
        { status: 400 }
      );
    }

    // Use Vercel Blob if token is available, otherwise fall back to local storage
    if (process.env.BLOB_READ_WRITE_TOKEN) {
      const blob = await put(file.name, file, {
        access: "public",
        addRandomSuffix: true,
      });

      return NextResponse.json({
        url: blob.url,
        pathname: blob.pathname,
        contentType: file.type,
        size: file.size,
        filename: file.name,
      });
    }

    // Production without BLOB_READ_WRITE_TOKEN — reject with helpful error
    if (process.env.VERCEL) {
      return NextResponse.json(
        {
          error:
            "Media uploads require Vercel Blob storage. Please add BLOB_READ_WRITE_TOKEN to your environment variables.",
        },
        { status: 500 }
      );
    }

    // Local fallback (dev only): save to public/uploads
    const ext = path.extname(file.name) || ".bin";
    const uniqueName = `${crypto.randomUUID()}${ext}`;
    const uploadsDir = path.join(process.cwd(), "public", "uploads");

    await mkdir(uploadsDir, { recursive: true });

    const buffer = Buffer.from(await file.arrayBuffer());
    await writeFile(path.join(uploadsDir, uniqueName), buffer);

    const url = `/uploads/${uniqueName}`;

    return NextResponse.json({
      url,
      pathname: uniqueName,
      contentType: file.type,
      size: file.size,
      filename: file.name,
    });
  } catch (error: any) {
    console.error("[Media Upload] Error:", error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
