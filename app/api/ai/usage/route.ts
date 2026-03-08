import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { aiUsage } from "@/lib/db/schema";
import { eq, and, gte } from "drizzle-orm";
import { supabase } from "@/lib/supabase";

// GET /api/ai/usage — aggregated AI usage data for dashboard
export async function GET(req: NextRequest) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { searchParams } = new URL(req.url);
  const workspaceId = searchParams.get("workspaceId");
  const days = Math.min(parseInt(searchParams.get("days") || "30", 10), 90);

  if (!workspaceId) {
    return NextResponse.json({ error: "workspaceId is required" }, { status: 400 });
  }

  try {
    const now = new Date();
    const startDate = new Date(now);
    startDate.setDate(startDate.getDate() - days);

    const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const weekStart = new Date(todayStart);
    weekStart.setDate(weekStart.getDate() - weekStart.getDay());
    const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);

    // Fetch all usage rows for the period
    const rows = await db
      .select()
      .from(aiUsage)
      .where(
        and(
          eq(aiUsage.workspaceId, workspaceId),
          gte(aiUsage.createdAt, startDate)
        )
      );

    // Aggregate helper
    const aggregate = (filtered: typeof rows) => ({
      cost: filtered.reduce((s, r) => s + r.costTenths, 0),
      calls: filtered.length,
      input: filtered.reduce((s, r) => s + r.inputTokens, 0),
      output: filtered.reduce((s, r) => s + r.outputTokens, 0),
    });

    const todayRows = rows.filter((r) => r.createdAt >= todayStart);
    const weekRows = rows.filter((r) => r.createdAt >= weekStart);
    const monthRows = rows.filter((r) => r.createdAt >= monthStart);

    const summary = {
      today: aggregate(todayRows),
      week: aggregate(weekRows),
      month: aggregate(monthRows),
    };

    // Daily breakdown
    const dailyMap: Record<string, { cost: number; calls: number }> = {};
    for (const r of rows) {
      const date = r.createdAt.toISOString().split("T")[0];
      if (!dailyMap[date]) dailyMap[date] = { cost: 0, calls: 0 };
      dailyMap[date].cost += r.costTenths;
      dailyMap[date].calls += 1;
    }
    const daily = Object.entries(dailyMap)
      .map(([date, d]) => ({ date, ...d }))
      .sort((a, b) => a.date.localeCompare(b.date));

    // By model
    const modelMap: Record<
      string,
      { model: string; cost: number; calls: number; inputTokens: number; outputTokens: number }
    > = {};
    for (const r of rows) {
      if (!modelMap[r.model])
        modelMap[r.model] = { model: r.model, cost: 0, calls: 0, inputTokens: 0, outputTokens: 0 };
      modelMap[r.model].cost += r.costTenths;
      modelMap[r.model].calls += 1;
      modelMap[r.model].inputTokens += r.inputTokens;
      modelMap[r.model].outputTokens += r.outputTokens;
    }
    const byModel = Object.values(modelMap).sort((a, b) => b.cost - a.cost);

    // By source
    const sourceMap: Record<string, { source: string; cost: number; calls: number }> = {};
    for (const r of rows) {
      if (!sourceMap[r.source]) sourceMap[r.source] = { source: r.source, cost: 0, calls: 0 };
      sourceMap[r.source].cost += r.costTenths;
      sourceMap[r.source].calls += 1;
    }
    const bySource = Object.values(sourceMap).sort((a, b) => b.cost - a.cost);

    // By user — resolve names from Supabase
    const userMap: Record<
      number,
      { userId: number; cost: number; calls: number; inputTokens: number; outputTokens: number }
    > = {};
    for (const r of rows) {
      if (!userMap[r.userId])
        userMap[r.userId] = { userId: r.userId, cost: 0, calls: 0, inputTokens: 0, outputTokens: 0 };
      userMap[r.userId].cost += r.costTenths;
      userMap[r.userId].calls += 1;
      userMap[r.userId].inputTokens += r.inputTokens;
      userMap[r.userId].outputTokens += r.outputTokens;
    }

    const userIds = Object.keys(userMap).map(Number);
    let userNameMap = new Map<number, string>();
    if (userIds.length > 0) {
      const { data: users } = await supabase
        .from("users")
        .select("id_user, name_user")
        .in("id_user", userIds);
      if (users) {
        userNameMap = new Map(users.map((u: any) => [u.id_user, u.name_user]));
      }
    }

    const byUser = Object.values(userMap)
      .map((u) => ({
        ...u,
        userName: userNameMap.get(u.userId) || `User ${u.userId}`,
      }))
      .sort((a, b) => b.cost - a.cost);

    return NextResponse.json({ summary, daily, byModel, bySource, byUser });
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
