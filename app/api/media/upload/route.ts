import { NextRequest, NextResponse } from "next/server";
import { handleUpload, type HandleUploadBody } from "@vercel/blob/client";
import { put } from "@vercel/blob";
import { writeFile, mkdir } from "fs/promises";
import path from "path";
import crypto from "crypto";
import { auth } from "@/lib/auth";

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
  "application/pdf",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  "application/vnd.ms-excel",
  "application/vnd.openxmlformats-officedocument.presentationml.presentation",
  "application/vnd.ms-powerpoint",
  "application/rtf",
  "application/json",
  "application/xml",
  "text/plain",
  "text/csv",
  "text/markdown",
  "text/xml",
  "text/tab-separated-values",
  "text/html",
];

// POST /api/media/upload
// Handles two flows:
// 1. Client-side Vercel Blob upload (handleUpload token generation) — for production
// 2. Direct formData upload — for local dev fallback
export async function POST(req: NextRequest) {
  try {
    const contentType = req.headers.get("content-type") || "";

    // If JSON body, this is a Vercel Blob client-upload handshake.
    // The completion callback comes from Vercel's infrastructure (no user
    // cookies), so auth is checked inside onBeforeGenerateToken instead of
    // at the top of the route.
    if (contentType.includes("application/json")) {
      const body = (await req.json()) as HandleUploadBody;

      const jsonResponse = await handleUpload({
        body,
        request: req,
        onBeforeGenerateToken: async (pathname, clientPayload) => {
          // Auth-check here so the completion callback isn't blocked
          const session = await auth();
          if (!session?.user?.id) {
            throw new Error("Unauthorized");
          }
          return {
            allowedContentTypes: ALLOWED_TYPES,
            maximumSizeInBytes: 50 * 1024 * 1024, // 50MB for docs, images; videos handled separately
            addRandomSuffix: true,
          };
        },
        onUploadCompleted: async ({ blob }) => {
          console.log("[Media Upload] Client upload completed:", blob.url);
        },
      });

      return NextResponse.json(jsonResponse);
    }

    // Non-JSON requests (formData uploads) require auth
    const session = await auth();
    if (!session?.user?.id) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
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
    const maxSize = isVideo ? 200 * 1024 * 1024 : 50 * 1024 * 1024;
    const maxLabel = isVideo ? "200MB" : "50MB";
    if (file.size > maxSize) {
      return NextResponse.json(
        {
          error: `File too large. Maximum size for ${isVideo ? "video" : "images"} is ${maxLabel}.`,
        },
        { status: 400 }
      );
    }

    // Use Vercel Blob server-side (private store)
    if (process.env.BLOB_READ_WRITE_TOKEN) {
      let blob;
      try {
        blob = await put(file.name, file, {
          access: "private",
          addRandomSuffix: true,
        });
      } catch (privateErr: any) {
        console.error("[Media Upload] Private blob upload failed:", privateErr?.message, privateErr);
        return NextResponse.json(
          { error: `Upload failed: ${privateErr?.message || "Unknown error"}` },
          { status: 500 }
        );
      }

      // Private: return auth-gated proxy URL
      const url = `/api/media/file?path=${encodeURIComponent(blob.pathname)}`;

      return NextResponse.json({
        url,
        pathname: blob.pathname,
        contentType: file.type,
        size: file.size,
        filename: file.name,
      });
    }

    // Production without blob token
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
