import { NextRequest, NextResponse } from "next/server";
import { supabase } from "@/lib/supabase";

// GET /api/replay-recommendations — ranked list of evergreen content suitable for replay
export async function GET(req: NextRequest) {
  try {
    // Fetch all evergreen content objects from the content table
    // flag_evergreen is a smallint (1 = true)
    const { data: evergreenContent, error: contentErr } = await supabase
      .from("content")
      .select("id_content, name_content, id_type, flag_evergreen")
      .eq("flag_evergreen", 1)
      .is("date_deleted", null);

    if (contentErr) throw contentErr;

    if (!evergreenContent || evergreenContent.length === 0) {
      return NextResponse.json({
        recommendations: [],
        message: "No evergreen content found",
      });
    }

    // Get performance data and linked posts for each
    const recommendations: any[] = [];

    for (const content of evergreenContent) {
      const contentId = String(content.id_content);

      // Performance data from our new table
      const { data: perf } = await supabase
        .from("content_performance")
        .select("*")
        .eq("content_object_id", contentId)
        .limit(1)
        .single();

      // Linked social posts
      const { data: linkedPosts } = await supabase
        .from("social")
        .select("id_social, date_scheduled, date_created")
        .eq("id_content", content.id_content)
        .is("date_deleted", null);

      // Find most recent post date
      const postDates = (linkedPosts || [])
        .map((p) => p.date_scheduled || p.date_created)
        .filter(Boolean)
        .sort(
          (a, b) => new Date(b!).getTime() - new Date(a!).getTime()
        );

      const lastPostedDate = postDates[0] || null;
      const daysSinceLastPost = lastPostedDate
        ? Math.ceil(
            (Date.now() - new Date(lastPostedDate).getTime()) / 86400000
          )
        : 999;

      // Filter out recently posted (< 14 days)
      if (daysSinceLastPost < 14) continue;

      const historicalEngagement = perf
        ? (perf.total_reactions || 0) +
          (perf.total_comments || 0) +
          (perf.total_shares || 0)
        : 0;

      const replayCount = perf?.replay_count || 0;

      // Score: (historical_engagement * decay_factor) / (replay_count + 1)
      const decayFactor = 1 / (1 + daysSinceLastPost / 30);
      const score = parseFloat(
        (
          (historicalEngagement * (1 - decayFactor * 0.5)) /
          (replayCount + 1)
        ).toFixed(2)
      );

      recommendations.push({
        contentObjectId: contentId,
        workingTitle: content.name_content,
        contentType: content.id_type ? String(content.id_type) : null,
        lastPostedDate,
        daysSinceLastPost,
        historicalEngagement,
        replayCount,
        score,
        totalImpressions: perf?.total_impressions || 0,
        linkedPostCount: (linkedPosts || []).length,
      });
    }

    // Sort by score descending
    recommendations.sort((a, b) => b.score - a.score);

    return NextResponse.json({ recommendations });
  } catch (error: any) {
    console.error("Replay recommendations error:", error.message);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
