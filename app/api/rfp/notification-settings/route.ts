import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { intelligenceDb } from "@/lib/supabase-intelligence";
import { supabase } from "@/lib/supabase";
import { verifyWorkspaceMembership } from "@/lib/permissions";

// GET /api/rfp/notification-settings?workspaceId=...&includeAll=true
export async function GET(req: NextRequest) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const userId = parseInt(session.user.id, 10);

  const { searchParams } = new URL(req.url);
  const workspaceId = searchParams.get("workspaceId");
  const includeAll = searchParams.get("includeAll") === "true";

  if (!workspaceId) {
    return NextResponse.json({ error: "workspaceId is required" }, { status: 400 });
  }

  const memberRole = await verifyWorkspaceMembership(userId, workspaceId);
  if (!memberRole) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  try {
    // Get current user's settings
    const { data: ownSettings } = await intelligenceDb
      .from("rfp_notification_settings")
      .select("*")
      .eq("id_workspace", workspaceId)
      .eq("user_target", userId)
      .maybeSingle();

    const result: any = {
      own: ownSettings || {
        flag_enabled: 0,
        units_min_relevance: 70,
      },
    };

    // Admin/owner can see all team settings
    if (includeAll && (memberRole === "owner" || memberRole === "admin")) {
      const { data: allSettings } = await intelligenceDb
        .from("rfp_notification_settings")
        .select("*")
        .eq("id_workspace", workspaceId);

      if (allSettings && allSettings.length > 0) {
        const teamUserIds = allSettings.map((s: any) => s.user_target);
        const { data: users } = await supabase
          .from("users")
          .select("id_user, name_user, email_user")
          .in("id_user", teamUserIds);

        const userMap = new Map(
          (users || []).map((u: any) => [u.id_user, { name: u.name_user, email: u.email_user }])
        );

        result.team = allSettings.map((s: any) => ({
          ...s,
          userName: userMap.get(s.user_target)?.name || null,
          userEmail: userMap.get(s.user_target)?.email || null,
        }));
      } else {
        result.team = [];
      }
    }

    return NextResponse.json(result);
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}

// PATCH /api/rfp/notification-settings — upsert own settings
export async function PATCH(req: NextRequest) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const userId = parseInt(session.user.id, 10);

  try {
    const body = await req.json();
    const { workspaceId, enabled, minRelevance } = body;

    if (!workspaceId) {
      return NextResponse.json({ error: "workspaceId is required" }, { status: 400 });
    }

    const memberRole = await verifyWorkspaceMembership(userId, workspaceId);
    if (!memberRole) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    // Check if row exists
    const { data: existing } = await intelligenceDb
      .from("rfp_notification_settings")
      .select("id_setting")
      .eq("id_workspace", workspaceId)
      .eq("user_target", userId)
      .maybeSingle();

    if (existing) {
      // Update
      const { data, error } = await intelligenceDb
        .from("rfp_notification_settings")
        .update({
          flag_enabled: enabled ? 1 : 0,
          units_min_relevance: minRelevance ?? 70,
          date_updated: new Date().toISOString(),
        })
        .eq("id_setting", existing.id_setting)
        .select()
        .single();

      if (error) throw error;
      return NextResponse.json({ setting: data });
    } else {
      // Insert
      const { data, error } = await intelligenceDb
        .from("rfp_notification_settings")
        .insert({
          id_workspace: workspaceId,
          user_target: userId,
          flag_enabled: enabled ? 1 : 0,
          units_min_relevance: minRelevance ?? 70,
        })
        .select()
        .single();

      if (error) throw error;
      return NextResponse.json({ setting: data });
    }
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
