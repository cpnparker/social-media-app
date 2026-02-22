import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import {
  contentObjects,
  contentPerformance,
  workspacePerformanceModel,
} from "@/lib/db/schema";
import { eq } from "drizzle-orm";
import { resolveWorkspaceAndUser } from "@/lib/api-utils";

// GET /api/profile-performance — get workspace performance model
export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const resolved = await resolveWorkspaceAndUser(searchParams.get("workspaceId") || undefined);
  const workspaceId = resolved.workspaceId;

  try {
    const [model] = await db
      .select()
      .from(workspacePerformanceModel)
      .where(eq(workspacePerformanceModel.workspaceId, workspaceId))
      .limit(1);

    if (!model) {
      return NextResponse.json({
        model: null,
        message: "No performance model computed yet. POST to recompute.",
      });
    }

    return NextResponse.json({ model });
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}

// POST /api/profile-performance — recompute workspace performance model
export async function POST(req: NextRequest) {
  try {
    const body = await req.json().catch(() => ({}));
    const resolved = await resolveWorkspaceAndUser(body.workspaceId);
    const workspaceId = resolved.workspaceId;

    // Fetch all content objects with performance data
    const allContent = await db.select().from(contentObjects).where(
      eq(contentObjects.workspaceId, workspaceId)
    );
    const allPerf = await db.select().from(contentPerformance);

    // Map performance by contentObjectId
    const perfMap = new Map(allPerf.map((p) => [p.contentObjectId, p]));

    // Build topic performance map
    const topicPerformanceMap: Record<string, { totalEng: number; count: number; avgEng: number }> = {};
    const formatPerformanceMap: Record<string, { totalEng: number; count: number; avgEng: number }> = {};
    let totalEngagement = 0;
    let contentWithPerfCount = 0;

    for (const content of allContent) {
      const perf = perfMap.get(content.id);
      if (!perf) continue;

      const eng = perf.totalReactions + perf.totalComments + perf.totalShares;
      totalEngagement += eng;
      contentWithPerfCount++;

      // Topic tags
      for (const tag of content.formatTags || []) {
        if (!topicPerformanceMap[tag]) {
          topicPerformanceMap[tag] = { totalEng: 0, count: 0, avgEng: 0 };
        }
        topicPerformanceMap[tag].totalEng += eng;
        topicPerformanceMap[tag].count += 1;
      }

      // Format/type
      const cType = content.contentType || "other";
      if (!formatPerformanceMap[cType]) {
        formatPerformanceMap[cType] = { totalEng: 0, count: 0, avgEng: 0 };
      }
      formatPerformanceMap[cType].totalEng += eng;
      formatPerformanceMap[cType].count += 1;
    }

    // Compute averages
    for (const val of Object.values(topicPerformanceMap)) {
      val.avgEng = val.count > 0 ? val.totalEng / val.count : 0;
    }
    for (const val of Object.values(formatPerformanceMap)) {
      val.avgEng = val.count > 0 ? val.totalEng / val.count : 0;
    }

    const avgBaseline = contentWithPerfCount > 0 ? totalEngagement / contentWithPerfCount : 0;
    const highThreshold = avgBaseline * 1.5;

    const modelData = {
      workspaceId,
      topicPerformanceMap,
      formatPerformanceMap,
      bestPostingWindows: {},
      averageEngagementBaseline: parseFloat(avgBaseline.toFixed(2)),
      highPerformanceThreshold: parseFloat(highThreshold.toFixed(2)),
      computedAt: new Date(),
    };

    // Upsert
    const [existing] = await db
      .select()
      .from(workspacePerformanceModel)
      .where(eq(workspacePerformanceModel.workspaceId, workspaceId))
      .limit(1);

    let model;
    if (existing) {
      [model] = await db
        .update(workspacePerformanceModel)
        .set(modelData)
        .where(eq(workspacePerformanceModel.workspaceId, workspaceId))
        .returning();
    } else {
      [model] = await db
        .insert(workspacePerformanceModel)
        .values(modelData)
        .returning();
    }

    return NextResponse.json({ model, contentAnalyzed: contentWithPerfCount });
  } catch (error: any) {
    console.error("Profile performance error:", error.message);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
