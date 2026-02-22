import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { contentObjects, contentPerformance, posts } from "@/lib/db/schema";
import { eq } from "drizzle-orm";

// GET /api/replay-recommendations — ranked list of evergreen content suitable for replay
export async function GET(req: NextRequest) {
  try {
    // Fetch all evergreen content objects
    const evergreenContent = await db
      .select()
      .from(contentObjects)
      .where(eq(contentObjects.evergreenFlag, true));

    if (evergreenContent.length === 0) {
      return NextResponse.json({ recommendations: [], message: "No evergreen content found" });
    }

    // Get performance data and linked posts for each
    const recommendations: any[] = [];

    for (const content of evergreenContent) {
      const [perf] = await db
        .select()
        .from(contentPerformance)
        .where(eq(contentPerformance.contentObjectId, content.id))
        .limit(1);

      const linkedPosts = await db
        .select()
        .from(posts)
        .where(eq(posts.contentObjectId, content.id));

      // Find most recent post date
      const postDates = linkedPosts
        .map((p) => p.scheduledFor || p.createdAt)
        .filter(Boolean)
        .sort((a, b) => new Date(b!).getTime() - new Date(a!).getTime());

      const lastPostedDate = postDates[0] || null;
      const daysSinceLastPost = lastPostedDate
        ? Math.ceil((Date.now() - new Date(lastPostedDate).getTime()) / 86400000)
        : 999;

      // Filter out recently posted (< 14 days)
      if (daysSinceLastPost < 14) continue;

      const historicalEngagement = perf
        ? perf.totalReactions + perf.totalComments + perf.totalShares
        : 0;

      const replayCount = perf?.replayCount || 0;

      // Score: (historical_engagement * decay_factor) / (replay_count + 1)
      const decayFactor = 1 / (1 + daysSinceLastPost / 30);
      const score = parseFloat(
        ((historicalEngagement * (1 - decayFactor * 0.5)) / (replayCount + 1)).toFixed(2)
      );

      recommendations.push({
        contentObjectId: content.id,
        workingTitle: content.workingTitle,
        contentType: content.contentType,
        lastPostedDate,
        daysSinceLastPost,
        historicalEngagement,
        replayCount,
        score,
        totalImpressions: perf?.totalImpressions || 0,
        linkedPostCount: linkedPosts.length,
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
