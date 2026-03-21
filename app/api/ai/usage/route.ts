import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { intelligenceDb } from "@/lib/supabase-intelligence";
import { supabase } from "@/lib/supabase";
import { verifyWorkspaceMembership } from "@/lib/permissions";

const VALID_APPS = ["all", "engine", "meetingbrain", "authorityon"] as const;
type AppFilter = (typeof VALID_APPS)[number];

// GET /api/ai/usage — aggregated AI usage data for dashboard
export async function GET(req: NextRequest) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { searchParams } = new URL(req.url);
  const workspaceId = searchParams.get("workspaceId");
  const days = Math.min(parseInt(searchParams.get("days") || "30", 10), 90);
  const appParam = (searchParams.get("app") || "all") as AppFilter;
  const app = VALID_APPS.includes(appParam) ? appParam : "all";

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

    // Fetch usage rows based on app filter
    let usageRows: any[] = [];

    if (app === "engine") {
      // Engine only — filter by workspace
      const { data, error } = await intelligenceDb
        .from("ai_usage")
        .select("*")
        .eq("id_workspace", workspaceId)
        .eq("type_app", "engine")
        .gte("date_created", startDate.toISOString());
      if (error) throw error;
      usageRows = data || [];
    } else if (app === "meetingbrain" || app === "authorityon") {
      // Specific external app — no workspace filter
      const { data, error } = await intelligenceDb
        .from("ai_usage")
        .select("*")
        .eq("type_app", app)
        .gte("date_created", startDate.toISOString());
      if (error) throw error;
      usageRows = data || [];
    } else {
      // All apps — combine engine (workspace-filtered) + external apps
      const [engineResult, externalResult] = await Promise.all([
        intelligenceDb
          .from("ai_usage")
          .select("*")
          .eq("id_workspace", workspaceId)
          .eq("type_app", "engine")
          .gte("date_created", startDate.toISOString()),
        intelligenceDb
          .from("ai_usage")
          .select("*")
          .in("type_app", ["meetingbrain", "authorityon"])
          .gte("date_created", startDate.toISOString()),
      ]);
      if (engineResult.error) throw engineResult.error;
      if (externalResult.error) throw externalResult.error;
      usageRows = [...(engineResult.data || []), ...(externalResult.data || [])];
    }

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

    // By app
    const appMap: Record<string, { app: string; cost: number; calls: number; input: number; output: number }> = {};
    for (const r of usageRows) {
      const a = r.type_app || "engine";
      if (!appMap[a]) appMap[a] = { app: a, cost: 0, calls: 0, input: 0, output: 0 };
      appMap[a].cost += r.units_cost_tenths;
      appMap[a].calls += 1;
      appMap[a].input += r.units_input;
      appMap[a].output += r.units_output;
    }
    const byApp = Object.values(appMap).sort((a, b) => b.cost - a.cost);

    // Daily breakdown — with per-model cost for stacked chart
    const dailyMap: Record<string, Record<string, number> & { cost: number; calls: number }> = {};
    const allModelsSet = new Set<string>();
    for (const r of usageRows) {
      const date = r.date_created.split("T")[0];
      if (!dailyMap[date]) dailyMap[date] = { cost: 0, calls: 0 };
      dailyMap[date].cost += r.units_cost_tenths;
      dailyMap[date].calls += 1;
      // Per-model cost
      const modelKey = r.name_model || "unknown";
      allModelsSet.add(modelKey);
      dailyMap[date][modelKey] = (dailyMap[date][modelKey] || 0) + r.units_cost_tenths;
    }
    const daily = Object.entries(dailyMap)
      .map(([date, d]) => ({ date, ...d }))
      .sort((a, b) => a.date.localeCompare(b.date));
    const dailyModels = Array.from(allModelsSet).sort();

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

    // By source (with app prefix and model breakdown)
    const sourceMap: Record<string, { source: string; app: string; cost: number; calls: number; models: Record<string, { cost: number; calls: number }> }> = {};
    for (const r of usageRows) {
      const appName = r.type_app || "engine";
      const key = `${appName}::${r.type_source}`;
      if (!sourceMap[key]) sourceMap[key] = { source: r.type_source, app: appName, cost: 0, calls: 0, models: {} };
      sourceMap[key].cost += r.units_cost_tenths;
      sourceMap[key].calls += 1;
      const model = r.name_model || "unknown";
      if (!sourceMap[key].models[model]) sourceMap[key].models[model] = { cost: 0, calls: 0 };
      sourceMap[key].models[model].cost += r.units_cost_tenths;
      sourceMap[key].models[model].calls += 1;
    }
    const bySource = Object.values(sourceMap).sort((a, b) => b.cost - a.cost);

    // By user — resolve names from Supabase for engine users, use user_name_external for others
    const userMap: Record<
      string,
      { userId: number; userIdExternal: string | null; userName: string; cost: number; calls: number; inputTokens: number; outputTokens: number }
    > = {};
    for (const r of usageRows) {
      const key = r.user_id_external || String(r.user_usage || 0);
      if (!userMap[key])
        userMap[key] = {
          userId: r.user_usage || 0,
          userIdExternal: r.user_id_external || null,
          userName: r.user_name_external || "",
          cost: 0,
          calls: 0,
          inputTokens: 0,
          outputTokens: 0,
        };
      userMap[key].cost += r.units_cost_tenths;
      userMap[key].calls += 1;
      userMap[key].inputTokens += r.units_input;
      userMap[key].outputTokens += r.units_output;
    }

    // Resolve Engine user names
    const engineUserIds = Object.values(userMap)
      .filter((u) => u.userId > 0 && !u.userIdExternal)
      .map((u) => u.userId);
    if (engineUserIds.length > 0) {
      const { data: users } = await supabase
        .from("users")
        .select("id_user, name_user, email_user")
        .in("id_user", engineUserIds);
      if (users) {
        const nameMap = new Map(
          users.map((u: any) => [u.id_user, u.name_user || u.email_user || `User ${u.id_user}`])
        );
        for (const u of Object.values(userMap)) {
          if (u.userId > 0 && !u.userIdExternal) {
            u.userName = nameMap.get(u.userId) || `User ${u.userId}`;
          }
        }
      }
    }

    // Label external users by app
    for (const u of Object.values(userMap)) {
      if (u.userIdExternal && !u.userName) {
        u.userName = `External User (${u.userIdExternal.slice(0, 8)}...)`;
      }
    }

    const byUser = Object.values(userMap).sort((a, b) => b.cost - a.cost);

    // By user + model
    const userModelMap: Record<
      string,
      { userId: number; model: string; cost: number; calls: number; inputTokens: number; outputTokens: number }
    > = {};
    for (const r of usageRows) {
      const userKey = r.user_id_external || String(r.user_usage || 0);
      const key = `${userKey}::${r.name_model}`;
      if (!userModelMap[key])
        userModelMap[key] = { userId: r.user_usage || 0, model: r.name_model, cost: 0, calls: 0, inputTokens: 0, outputTokens: 0 };
      userModelMap[key].cost += r.units_cost_tenths;
      userModelMap[key].calls += 1;
      userModelMap[key].inputTokens += r.units_input;
      userModelMap[key].outputTokens += r.units_output;
    }
    const byUserModel = Object.values(userModelMap).sort((a, b) => b.cost - a.cost);

    return NextResponse.json({ summary, daily, dailyModels, byModel, bySource, byUser, byUserModel, byApp });
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
