import { NextRequest, NextResponse } from "next/server";
import { supabase } from "@/lib/supabase";
import { resolveWorkspaceAndUser } from "@/lib/api-utils";

// Helper: snake_case → camelCase
function transformModel(row: any) {
  return {
    id: row.id,
    workspaceId: row.workspace_id,
    topicPerformanceMap: row.topic_performance_map,
    formatPerformanceMap: row.format_performance_map,
    bestPostingWindows: row.best_posting_windows,
    averageEngagementBaseline: row.average_engagement_baseline,
    highPerformanceThreshold: row.high_performance_threshold,
    computedAt: row.computed_at,
  };
}

// GET /api/profile-performance — get workspace performance model
export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const resolved = await resolveWorkspaceAndUser(
    searchParams.get("workspaceId") || undefined
  );
  const workspaceId = resolved.workspaceId;

  try {
    const { data: model, error } = await supabase
      .from("workspace_performance_model")
      .select("*")
      .eq("workspace_id", workspaceId)
      .limit(1)
      .single();

    if (error || !model) {
      return NextResponse.json({
        model: null,
        message: "No performance model computed yet. POST to recompute.",
      });
    }

    return NextResponse.json({ model: transformModel(model) });
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
    // Use the Supabase content table (app_content view for reads)
    const { data: allContent } = await supabase
      .from("app_content")
      .select("id_content, name_content, id_type, format_tags");

    const { data: allPerf } = await supabase
      .from("content_performance")
      .select("*");

    // Map performance by contentObjectId
    const perfMap = new Map(
      (allPerf || []).map((p) => [p.content_object_id, p])
    );

    // Build topic and format performance maps
    const topicPerformanceMap: Record<
      string,
      { totalEng: number; count: number; avgEng: number }
    > = {};
    const formatPerformanceMap: Record<
      string,
      { totalEng: number; count: number; avgEng: number }
    > = {};
    let totalEngagement = 0;
    let contentWithPerfCount = 0;

    for (const content of allContent || []) {
      const perf = perfMap.get(String(content.id_content));
      if (!perf) continue;

      const eng =
        (perf.total_reactions || 0) +
        (perf.total_comments || 0) +
        (perf.total_shares || 0);
      totalEngagement += eng;
      contentWithPerfCount++;

      // Topic tags
      const tags = (content as any).format_tags || [];
      for (const tag of tags) {
        if (!topicPerformanceMap[tag]) {
          topicPerformanceMap[tag] = { totalEng: 0, count: 0, avgEng: 0 };
        }
        topicPerformanceMap[tag].totalEng += eng;
        topicPerformanceMap[tag].count += 1;
      }

      // Format/type
      const cType = content.id_type ? String(content.id_type) : "other";
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

    const avgBaseline =
      contentWithPerfCount > 0 ? totalEngagement / contentWithPerfCount : 0;
    const highThreshold = avgBaseline * 1.5;

    const modelData = {
      workspace_id: workspaceId,
      topic_performance_map: topicPerformanceMap,
      format_performance_map: formatPerformanceMap,
      best_posting_windows: {},
      average_engagement_baseline: parseFloat(avgBaseline.toFixed(2)),
      high_performance_threshold: parseFloat(highThreshold.toFixed(2)),
      computed_at: new Date().toISOString(),
    };

    // Upsert — check if exists
    const { data: existing } = await supabase
      .from("workspace_performance_model")
      .select("id")
      .eq("workspace_id", workspaceId)
      .limit(1)
      .single();

    let model;
    if (existing) {
      const { data, error } = await supabase
        .from("workspace_performance_model")
        .update(modelData)
        .eq("workspace_id", workspaceId)
        .select()
        .single();
      if (error) throw error;
      model = data;
    } else {
      const { data, error } = await supabase
        .from("workspace_performance_model")
        .insert(modelData)
        .select()
        .single();
      if (error) throw error;
      model = data;
    }

    return NextResponse.json({
      model: transformModel(model),
      contentAnalyzed: contentWithPerfCount,
    });
  } catch (error: any) {
    console.error("Profile performance error:", error.message);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
