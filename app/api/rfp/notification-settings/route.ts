import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { intelligenceDb } from "@/lib/supabase-intelligence";
import { supabase } from "@/lib/supabase";
import { verifyWorkspaceMembership } from "@/lib/permissions";

type Frequency = "realtime" | "daily" | "weekly" | "off";

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
        type_frequency: "off",
        units_digest_day: 1,
      },
    };

    // Admin/owner: return ALL workspace members with RFP access
    if (includeAll && (memberRole === "owner" || memberRole === "admin")) {
      // Get all workspace members
      const { data: members } = await intelligenceDb
        .from("workspace_members")
        .select("user_id, role")
        .eq("workspace_id", workspaceId);

      const memberUserIds = (members || []).map((m: any) => m.user_id);

      if (memberUserIds.length > 0) {
        // Check RFP tool access
        const { data: accessRows } = await intelligenceDb
          .from("users_access")
          .select("user_target, flag_access_rfptool")
          .in("user_target", memberUserIds);

        const accessMap = new Map(
          (accessRows || []).map((a: any) => [a.user_target, !!a.flag_access_rfptool])
        );

        // Filter to only members with RFP access
        const rfpUserIds = memberUserIds.filter((id: number) => accessMap.get(id));

        // Get existing notification settings for these users
        const { data: allSettings } = await intelligenceDb
          .from("rfp_notification_settings")
          .select("*")
          .eq("id_workspace", workspaceId)
          .in("user_target", rfpUserIds.length > 0 ? rfpUserIds : [-1]);

        const settingsMap = new Map(
          (allSettings || []).map((s: any) => [s.user_target, s])
        );

        // Get user details
        const { data: users } = await supabase
          .from("users")
          .select("id_user, name_user, email_user")
          .in("id_user", rfpUserIds.length > 0 ? rfpUserIds : [-1]);

        const userMap = new Map(
          (users || []).map((u: any) => [u.id_user, { name: u.name_user, email: u.email_user }])
        );

        const memberRoleMap = new Map(
          (members || []).map((m: any) => [m.user_id, m.role])
        );

        // Build team list — every RFP-access member, with or without settings
        result.team = rfpUserIds.map((uid: number) => {
          const setting = settingsMap.get(uid);
          const user = userMap.get(uid);
          return {
            user_target: uid,
            flag_enabled: setting?.flag_enabled ?? 0,
            units_min_relevance: setting?.units_min_relevance ?? 70,
            type_frequency: setting?.type_frequency ?? "off",
            units_digest_day: setting?.units_digest_day ?? 1,
            id_setting: setting?.id_setting ?? null,
            userName: user?.name || null,
            userEmail: user?.email || null,
            workspaceRole: memberRoleMap.get(uid) || null,
          };
        });
      } else {
        result.team = [];
      }

      // Include saved search schedule info
      const { data: savedSearches } = await intelligenceDb
        .from("rfp_saved_searches")
        .select("id_saved_search, name, flag_schedule_enabled, type_schedule, config_schedule, date_last_run, date_next_run")
        .eq("id_workspace", workspaceId);

      result.savedSearches = (savedSearches || []).map((s: any) => ({
        id: s.id_saved_search,
        name: s.name,
        scheduled: s.flag_schedule_enabled === 1,
        schedule: s.type_schedule,
        config: s.config_schedule,
        lastRun: s.date_last_run,
        nextRun: s.date_next_run,
      }));
    }

    return NextResponse.json(result);
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}

// PATCH /api/rfp/notification-settings — upsert settings
// Admins can pass targetUserId to edit another user's settings
export async function PATCH(req: NextRequest) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const userId = parseInt(session.user.id, 10);

  try {
    const body = await req.json();
    const { workspaceId, targetUserId, frequency, digestDay, minRelevance } = body;
    // Support legacy `enabled` field for backwards compatibility
    const legacyEnabled = body.enabled;

    if (!workspaceId) {
      return NextResponse.json({ error: "workspaceId is required" }, { status: 400 });
    }

    const memberRole = await verifyWorkspaceMembership(userId, workspaceId);
    if (!memberRole) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    // Determine the effective user to update
    const effectiveUserId = targetUserId ? parseInt(targetUserId, 10) : userId;

    // If editing another user, verify admin/owner role
    if (effectiveUserId !== userId) {
      if (memberRole !== "owner" && memberRole !== "admin") {
        return NextResponse.json({ error: "Only admins can edit other users' settings" }, { status: 403 });
      }
      // Verify target user is a workspace member
      const targetRole = await verifyWorkspaceMembership(effectiveUserId, workspaceId);
      if (!targetRole) {
        return NextResponse.json({ error: "Target user is not a workspace member" }, { status: 400 });
      }
    }

    // Determine frequency: prefer new `frequency` field, fall back to legacy `enabled`
    let effectiveFrequency: Frequency;
    if (frequency !== undefined) {
      effectiveFrequency = frequency as Frequency;
    } else if (legacyEnabled !== undefined) {
      effectiveFrequency = legacyEnabled ? "realtime" : "off";
    } else {
      effectiveFrequency = "off";
    }

    const flagEnabled = effectiveFrequency !== "off" ? 1 : 0;

    const updatePayload: any = {
      flag_enabled: flagEnabled,
      type_frequency: effectiveFrequency,
      units_min_relevance: minRelevance ?? 70,
      date_updated: new Date().toISOString(),
    };

    if (digestDay !== undefined) {
      updatePayload.units_digest_day = Math.max(1, Math.min(7, digestDay));
    }

    // Check if row exists
    const { data: existing } = await intelligenceDb
      .from("rfp_notification_settings")
      .select("id_setting")
      .eq("id_workspace", workspaceId)
      .eq("user_target", effectiveUserId)
      .maybeSingle();

    if (existing) {
      const { data, error } = await intelligenceDb
        .from("rfp_notification_settings")
        .update(updatePayload)
        .eq("id_setting", existing.id_setting)
        .select()
        .single();

      if (error) throw error;
      return NextResponse.json({ setting: data });
    } else {
      const { data, error } = await intelligenceDb
        .from("rfp_notification_settings")
        .insert({
          id_workspace: workspaceId,
          user_target: effectiveUserId,
          ...updatePayload,
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
