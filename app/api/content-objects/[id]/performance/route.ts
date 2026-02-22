import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { contentObjects, posts, contentPerformance } from "@/lib/db/schema";
import { lateApiFetch } from "@/lib/late";
import { eq } from "drizzle-orm";

// GET /api/content-objects/[id]/performance — aggregate performance for content object
export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;

    // Check content object exists
    const [obj] = await db
      .select()
      .from(contentObjects)
      .where(eq(contentObjects.id, id))
      .limit(1);

    if (!obj) {
      return NextResponse.json({ error: "Content object not found" }, { status: 404 });
    }

    // Get linked posts
    const linkedPosts = await db
      .select()
      .from(posts)
      .where(eq(posts.contentObjectId, id));

    // Aggregate analytics from Late API for each linked post
    let totalImpressions = 0;
    let totalClicks = 0;
    let totalReactions = 0;
    let totalComments = 0;
    let totalShares = 0;
    let totalWatchTime = 0;
    const platformBreakdown: Record<string, any> = {};

    for (const post of linkedPosts) {
      if (!post.latePostId) continue;
      try {
        const postData = await lateApiFetch(`/posts/${post.latePostId}`);
        const p = postData.post || postData;
        const platforms = p.platforms || [];

        for (const plat of platforms) {
          const a = plat.analytics || {};
          const platform = (plat.platform || "unknown").toLowerCase();

          const imp = a.impressions || 0;
          const clicks = a.clicks || 0;
          const likes = a.likes || 0;
          const comments = a.comments || 0;
          const shares = a.shares || 0;
          const views = a.views || 0;
          const eng = likes + comments + shares;

          totalImpressions += imp;
          totalClicks += clicks;
          totalReactions += likes;
          totalComments += comments;
          totalShares += shares;
          totalWatchTime += views;

          if (!platformBreakdown[platform]) {
            platformBreakdown[platform] = {
              impressions: 0,
              clicks: 0,
              reactions: 0,
              comments: 0,
              shares: 0,
              posts: 0,
            };
          }
          platformBreakdown[platform].impressions += imp;
          platformBreakdown[platform].clicks += clicks;
          platformBreakdown[platform].reactions += likes;
          platformBreakdown[platform].comments += comments;
          platformBreakdown[platform].shares += shares;
          platformBreakdown[platform].posts += 1;
        }
      } catch {
        // Post may not exist in Late API anymore
      }
    }

    const totalEngagements = totalReactions + totalComments + totalShares;
    const avgEngScore = totalImpressions > 0
      ? parseFloat(((totalEngagements / totalImpressions) * 100).toFixed(2))
      : 0;

    // Upsert performance record
    const perfData = {
      contentObjectId: id,
      totalImpressions,
      totalClicks,
      totalReactions,
      totalComments,
      totalShares,
      totalWatchTime,
      averageEngagementScore: avgEngScore,
      engagementVelocity: 0,
      platformBreakdown,
      replayCount: 0,
      computedAt: new Date(),
    };

    // Check if record exists
    const [existing] = await db
      .select()
      .from(contentPerformance)
      .where(eq(contentPerformance.contentObjectId, id))
      .limit(1);

    let perf;
    if (existing) {
      [perf] = await db
        .update(contentPerformance)
        .set(perfData)
        .where(eq(contentPerformance.contentObjectId, id))
        .returning();
    } else {
      [perf] = await db
        .insert(contentPerformance)
        .values(perfData)
        .returning();
    }

    return NextResponse.json({ performance: perf, linkedPostCount: linkedPosts.length });
  } catch (error: any) {
    console.error("Content performance error:", error.message);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
