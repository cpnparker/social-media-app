import { NextRequest, NextResponse } from "next/server";
import { supabase } from "@/lib/supabase";
import { lateApiFetch } from "@/lib/late";

// POST /api/content-objects/[id]/create-post
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const contentId = parseInt(id, 10);
    const body = await req.json();

    const { data: obj } = await supabase
      .from("content")
      .select("*")
      .eq("id_content", contentId)
      .is("date_deleted", null)
      .single();

    if (!obj) {
      return NextResponse.json({ error: "Content object not found" }, { status: 404 });
    }

    const postContent = body.content || obj.document_body || obj.name_content;
    const postPayload: any = {
      content: postContent,
      platforms: body.platforms,
    };

    if (body.mediaUrls?.length) postPayload.mediaUrls = body.mediaUrls;
    if (body.publishNow) postPayload.publishNow = true;
    else if (body.scheduledFor) {
      postPayload.scheduledFor = body.scheduledFor;
      postPayload.timezone = body.timezone || "UTC";
    }

    const data = await lateApiFetch("/posts", {
      method: "POST",
      body: JSON.stringify(postPayload),
    });

    // Create a social record linked to this content
    try {
      await supabase.from("social").insert({
        id_content: contentId,
        id_client: obj.id_client,
        name_social: postContent?.substring(0, 200) || "Social post",
        network: body.platforms?.[0]?.platform || "other",
        type_post: "standard",
        date_created: new Date().toISOString(),
      });
    } catch (dbErr) {
      console.error("[CreatePost] Failed to store linkage:", dbErr);
    }

    return NextResponse.json({ post: data, contentObjectId: String(contentId) });
  } catch (error: any) {
    console.error("Create post from content error:", error.message);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
