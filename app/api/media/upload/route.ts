import { NextRequest, NextResponse } from "next/server";
import { handleUpload, type HandleUploadBody } from "@vercel/blob/client";
import { put } from "@vercel/blob";
import { writeFile, mkdir } from "fs/promises";
import path from "path";
import crypto from "crypto";

// Route segment config
export const maxDuration = 60;

const ALLOWED_TYPES = [
  "image/jpeg",
  "image/png",
  "image/gif",
  "image/webp",
  "video/mp4",
  "video/quicktime",
  "video/webm",
];

// POST /api/media/upload
// Handles two flows:
// 1. Client-side Vercel Blob upload (handleUpload token generation) — for production
// 2. Direct formData upload — for local dev fallback
export async function POST(req: NextRequest) {
  try {
    const contentType = req.headers.get("content-type") || "";

    // If JSON body, this is a Vercel Blob client-upload handshake
    if (contentType.includes("application/json")) {
      const body = (await req.json()) as HandleUploadBody;

      const jsonResponse = await handleUpload({
        body,
        request: req,
        onBeforeGenerateToken: async (pathname, clientPayload) => {
          // Validate and configure the upload
          return {
            allowedContentTypes: ALLOWED_TYPES,
            maximumSizeInBytes: 200 * 1024 * 1024, // 200MB
            addRandomSuffix: true,
          };
        },
        onUploadCompleted: async ({ blob }) => {
          // Optional: could log or save to DB here
          console.log("[Media Upload] Client upload completed:", blob.url);
        },
      });

      return NextResponse.json(jsonResponse);
    }

    // Otherwise, handle as direct formData upload (local dev / small files)
    const formData = await req.formData();
    const file = formData.get("file") as File;

    if (!file) {
      return NextResponse.json(
        { error: "No file provided" },
        { status: 400 }
      );
    }

    if (!ALLOWED_TYPES.includes(file.type)) {
      return NextResponse.json(
        { error: "Unsupported file type" },
        { status: 400 }
      );
    }

    const isVideo = file.type.startsWith("video/");
    const maxSize = isVideo ? 200 * 1024 * 1024 : 20 * 1024 * 1024;
    const maxLabel = isVideo ? "200MB" : "20MB";
    if (file.size > maxSize) {
      return NextResponse.json(
        {
          error: `File too large. Maximum size for ${isVideo ? "video" : "images"} is ${maxLabel}.`,
        },
        { status: 400 }
      );
    }

    // Use Vercel Blob server-side for small files
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

    // Production without BLOB_READ_WRITE_TOKEN
    if (process.env.VERCEL) {
      return NextResponse.json(
        {
          error:
            "Media uploads require Vercel Blob storage. Please add BLOB_READ_WRITE_TOKEN to your environment variables.",
        },
        { status: 500 }
      );
    }

    // Local fallback (dev only)
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
