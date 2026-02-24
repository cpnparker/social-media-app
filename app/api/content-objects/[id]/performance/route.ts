import { NextRequest, NextResponse } from "next/server";
import { supabase } from "@/lib/supabase";
import { lateApiFetch } from "@/lib/late";

// GET /api/content-objects/[id]/performance
export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const contentId = parseInt(id, 10);

    // Check content exists
    const { data: obj } = await supabase
      .from("content")
      .select("id_content")
      .eq("id_content", contentId)
      .is("date_deleted", null)
      .single();

    if (!obj) {
      return NextResponse.json({ error: "Content object not found" }, { status: 404 });
    }

    // Get linked social posts
    const { data: linkedSocial } = await supabase
      .from("social")
      .select("*")
      .eq("id_content", contentId)
      .is("date_deleted", null);

    // For now, return basic stats from social_posts_overview
    const { data: postOverviews } = await supabase
      .from("social_posts_overview")
      .select("*")
      .eq("id_content", contentId);

    const totalPosts = (linkedSocial || []).length;
    const publishedPosts = (postOverviews || []).filter((p) => p.date_published).length;

    return NextResponse.json({
      performance: {
        contentObjectId: String(contentId),
        totalImpressions: 0,
        totalClicks: 0,
        totalReactions: 0,
        totalComments: 0,
        totalShares: 0,
        averageEngagementScore: 0,
      },
      linkedPostCount: totalPosts,
      publishedPostCount: publishedPosts,
    });
  } catch (error: any) {
    console.error("Content performance error:", error.message);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
