import { NextRequest, NextResponse } from "next/server";
import { put } from "@vercel/blob";
import { writeFile, mkdir } from "fs/promises";
import path from "path";
import crypto from "crypto";

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
      });

      return NextResponse.json({
        url: blob.url,
        pathname: blob.pathname,
        contentType: file.type,
        size: file.size,
        filename: file.name,
      });
    }

    // Local fallback: save to public/uploads
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
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
