import { NextRequest, NextResponse } from "next/server";
import { lateApiFetch } from "@/lib/late";
import { db } from "@/lib/db";
import { posts as postsTable } from "@/lib/db/schema";

// GET /api/posts — list posts
export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const status = searchParams.get("status");
  const page = searchParams.get("page") || "1";
  const limit = searchParams.get("limit") || "20";

  try {
    let endpoint = `/posts?page=${page}&limit=${limit}`;
    if (status) endpoint += `&status=${status}`;

    const data = await lateApiFetch(endpoint);
    return NextResponse.json(data);
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}

// POST /api/posts — create a new post
export async function POST(req: NextRequest) {
  try {
    const body = await req.json();

    const postPayload: any = {
      content: body.content,
      platforms: body.platforms, // [{platform, accountId, content?}]
    };

    if (body.mediaUrls?.length || body.mediaItems?.length) {
      const baseUrl = process.env.NEXTAUTH_URL || process.env.NEXT_PUBLIC_APP_URL || "http://localhost:3000";
      // Late API expects mediaItems: [{ url, type }]
      const urls: string[] = body.mediaUrls || body.mediaItems?.map((m: any) => m.url) || [];
      postPayload.mediaItems = urls.map((url: string) => {
        const absoluteUrl = url.startsWith("http") ? url : `${baseUrl}${url}`;
        const isVideo = /\.(mp4|mov|webm)$/i.test(absoluteUrl) ||
          body.mediaItems?.find((m: any) => m.url === url)?.contentType?.startsWith("video/");
        return { url: absoluteUrl, type: isVideo ? "video" : "image" };
      });
    }

    if (body.publishNow) {
      postPayload.publishNow = true;
    } else if (body.scheduledFor) {
      postPayload.scheduledFor = body.scheduledFor;
      postPayload.timezone = body.timezone || "UTC";
    }

    console.log("[Posts] Sending to Late API:", JSON.stringify(postPayload, null, 2));

    const data = await lateApiFetch("/posts", {
      method: "POST",
      body: JSON.stringify(postPayload),
    });

    // If this post is linked to a content object, store the mapping locally
    if (body.contentObjectId) {
      const latePostId = data.post?._id || data._id;
      try {
        await db.insert(postsTable).values({
          workspaceId: body.workspaceId || "00000000-0000-0000-0000-000000000000",
          latePostId: latePostId,
          content: body.content,
          status: body.publishNow ? "scheduled" : "draft",
          scheduledFor: body.scheduledFor ? new Date(body.scheduledFor) : undefined,
          timezone: body.timezone || "UTC",
          contentObjectId: body.contentObjectId,
          standalone: false,
          createdBy: body.createdBy || "00000000-0000-0000-0000-000000000000",
        });
      } catch (dbErr) {
        // Don't fail the whole request if local DB insert fails
        console.error("[Posts] Failed to store content object linkage:", dbErr);
      }
    }

    return NextResponse.json(data);
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
