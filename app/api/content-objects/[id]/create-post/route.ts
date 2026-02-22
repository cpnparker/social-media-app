import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { contentObjects, posts as postsTable } from "@/lib/db/schema";
import { lateApiFetch } from "@/lib/late";
import { eq } from "drizzle-orm";

// POST /api/content-objects/[id]/create-post — create a social post from content object
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const body = await req.json();

    // Fetch the content object
    const [obj] = await db
      .select()
      .from(contentObjects)
      .where(eq(contentObjects.id, id))
      .limit(1);

    if (!obj) {
      return NextResponse.json({ error: "Content object not found" }, { status: 404 });
    }

    const postContent = body.content || obj.body || obj.workingTitle;
    const postPayload: any = {
      content: postContent,
      platforms: body.platforms,
    };

    if (body.mediaUrls?.length) {
      postPayload.mediaUrls = body.mediaUrls;
    }

    if (body.publishNow) {
      postPayload.publishNow = true;
    } else if (body.scheduledFor) {
      postPayload.scheduledFor = body.scheduledFor;
      postPayload.timezone = body.timezone || "UTC";
    }

    // Create via Late API
    const data = await lateApiFetch("/posts", {
      method: "POST",
      body: JSON.stringify(postPayload),
    });

    // Store local mapping with content object link
    const latePostId = data.post?._id || data._id;
    try {
      await db.insert(postsTable).values({
        workspaceId: obj.workspaceId,
        latePostId,
        content: postContent,
        status: body.publishNow ? "scheduled" : "draft",
        scheduledFor: body.scheduledFor ? new Date(body.scheduledFor) : undefined,
        timezone: body.timezone || "UTC",
        contentObjectId: id,
        standalone: false,
        createdBy: body.createdBy || obj.createdBy,
      });
    } catch (dbErr) {
      console.error("[CreatePost] Failed to store linkage:", dbErr);
    }

    return NextResponse.json({ post: data, contentObjectId: id });
  } catch (error: any) {
    console.error("Create post from content error:", error.message);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
