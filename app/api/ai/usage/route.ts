import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { intelligenceDb } from "@/lib/supabase-intelligence";
import { supabase } from "@/lib/supabase";
import { verifyWorkspaceMembership } from "@/lib/permissions";

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

  // Verify user belongs to this workspace
  const userId = parseInt(session.user.id, 10);
  const memberRole = await verifyWorkspaceMembership(userId, workspaceId);
  if (!memberRole) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
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
    const { data: rows, error } = await intelligenceDb
      .from("ai_usage")
      .select("*")
      .eq("id_workspace", workspaceId)
      .gte("date_created", startDate.toISOString());

    if (error) throw error;
    const usageRows = rows || [];

    // Aggregate helper
    const aggregate = (filtered: typeof usageRows) => ({
      cost: filtered.reduce((s, r) => s + r.units_cost_tenths, 0),
      calls: filtered.length,
      input: filtered.reduce((s, r) => s + r.units_input, 0),
      output: filtered.reduce((s, r) => s + r.units_output, 0),
    });

    const todayRows = usageRows.filter((r) => new Date(r.date_created) >= todayStart);
    const weekRows = usageRows.filter((r) => new Date(r.date_created) >= weekStart);
    const monthRows = usageRows.filter((r) => new Date(r.date_created) >= monthStart);

    const summary = {
      today: aggregate(todayRows),
      week: aggregate(weekRows),
      month: aggregate(monthRows),
    };

    // Daily breakdown
    const dailyMap: Record<string, { cost: number; calls: number }> = {};
    for (const r of usageRows) {
      const date = r.date_created.split("T")[0];
      if (!dailyMap[date]) dailyMap[date] = { cost: 0, calls: 0 };
      dailyMap[date].cost += r.units_cost_tenths;
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
    for (const r of usageRows) {
      if (!modelMap[r.name_model])
        modelMap[r.name_model] = { model: r.name_model, cost: 0, calls: 0, inputTokens: 0, outputTokens: 0 };
      modelMap[r.name_model].cost += r.units_cost_tenths;
      modelMap[r.name_model].calls += 1;
      modelMap[r.name_model].inputTokens += r.units_input;
      modelMap[r.name_model].outputTokens += r.units_output;
    }
    const byModel = Object.values(modelMap).sort((a, b) => b.cost - a.cost);

    // By source
    const sourceMap: Record<string, { source: string; cost: number; calls: number }> = {};
    for (const r of usageRows) {
      if (!sourceMap[r.type_source]) sourceMap[r.type_source] = { source: r.type_source, cost: 0, calls: 0 };
      sourceMap[r.type_source].cost += r.units_cost_tenths;
      sourceMap[r.type_source].calls += 1;
    }
    const bySource = Object.values(sourceMap).sort((a, b) => b.cost - a.cost);

    // By user — resolve names from Supabase
    const userMap: Record<
      number,
      { userId: number; cost: number; calls: number; inputTokens: number; outputTokens: number }
    > = {};
    for (const r of usageRows) {
      if (!userMap[r.user_usage])
        userMap[r.user_usage] = { userId: r.user_usage, cost: 0, calls: 0, inputTokens: 0, outputTokens: 0 };
      userMap[r.user_usage].cost += r.units_cost_tenths;
      userMap[r.user_usage].calls += 1;
      userMap[r.user_usage].inputTokens += r.units_input;
      userMap[r.user_usage].outputTokens += r.units_output;
    }

    const userIds = Object.keys(userMap).map(Number);
    let userNameMap = new Map<number, string>();
    if (userIds.length > 0) {
      const { data: users } = await supabase
        .from("users")
        .select("id_user, name_user, email_user")
        .in("id_user", userIds);
      if (users) {
        userNameMap = new Map(
          users.map((u: any) => [
            u.id_user,
            u.name_user || u.email_user || `User ${u.id_user}`,
          ])
        );
      }
    }

    const byUser = Object.values(userMap)
      .map((u) => ({
        ...u,
        userName: userNameMap.get(u.userId) || `User ${u.userId}`,
      }))
      .sort((a, b) => b.cost - a.cost);

    // By user + model — breakdown of which models each user is using
    const userModelMap: Record<
      string,
      { userId: number; model: string; cost: number; calls: number; inputTokens: number; outputTokens: number }
    > = {};
    for (const r of usageRows) {
      const key = `${r.user_usage}::${r.name_model}`;
      if (!userModelMap[key])
        userModelMap[key] = { userId: r.user_usage, model: r.name_model, cost: 0, calls: 0, inputTokens: 0, outputTokens: 0 };
      userModelMap[key].cost += r.units_cost_tenths;
      userModelMap[key].calls += 1;
      userModelMap[key].inputTokens += r.units_input;
      userModelMap[key].outputTokens += r.units_output;
    }
    const byUserModel = Object.values(userModelMap).sort((a, b) => b.cost - a.cost);

    return NextResponse.json({ summary, daily, byModel, bySource, byUser, byUserModel });
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
