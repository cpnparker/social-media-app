import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { supabase } from "@/lib/supabase";
import { intelligenceDb } from "@/lib/supabase-intelligence";

// GET /api/me/preferences — returns the current user's personal preferences
export async function GET() {
  try {
    const session = await auth();
    if (!session?.user?.id) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const userId = parseInt(session.user.id, 10);

    // Get workspace
    const { data: ws } = await intelligenceDb
      .from("workspaces")
      .select("id")
      .limit(1)
      .single();

    if (!ws) {
      return NextResponse.json({
        personalContext: null,
        region: "Global",
        pinnedConversationIds: [],
        pinnedClientIds: [],
      });
    }

    // Fetch preferences from users_access
    const { data: row } = await intelligenceDb
      .from("users_access")
      .select(
        "information_personal_context, name_region, data_pinned_conversations, data_pinned_clients, data_selected_roles"
      )
      .eq("id_workspace", ws.id)
      .eq("user_target", userId)
      .maybeSingle();

    return NextResponse.json({
      personalContext: row?.information_personal_context || null,
      region: row?.name_region || "Global",
      pinnedConversationIds: row?.data_pinned_conversations || [],
      pinnedClientIds: row?.data_pinned_clients || [],
      selectedRoleIds: row?.data_selected_roles || [],
    });
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}

// PATCH /api/me/preferences — update personal preferences
export async function PATCH(req: NextRequest) {
  try {
    const session = await auth();
    if (!session?.user?.id) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const userId = parseInt(session.user.id, 10);
    const body = await req.json();

    // Get workspace
    const { data: ws } = await intelligenceDb
      .from("workspaces")
      .select("id")
      .limit(1)
      .single();

    if (!ws) {
      return NextResponse.json({ error: "No workspace found" }, { status: 404 });
    }

    // Build update object (only include provided fields)
    const updates: Record<string, any> = {
      date_updated: new Date().toISOString(),
    };

    if (body.personalContext !== undefined) {
      updates.information_personal_context = body.personalContext;
    }
    if (body.region !== undefined) {
      updates.name_region = body.region;
    }
    if (body.pinnedConversationIds !== undefined) {
      updates.data_pinned_conversations = body.pinnedConversationIds;
    }
    if (body.pinnedClientIds !== undefined) {
      updates.data_pinned_clients = body.pinnedClientIds;
    }
    if (body.selectedRoleIds !== undefined) {
      updates.data_selected_roles = body.selectedRoleIds;
    }

    // Check if row exists
    const { data: existing } = await intelligenceDb
      .from("users_access")
      .select("id_access")
      .eq("id_workspace", ws.id)
      .eq("user_target", userId)
      .maybeSingle();

    if (existing) {
      await intelligenceDb
        .from("users_access")
        .update(updates)
        .eq("id_access", existing.id_access);
    } else {
      // Create new row with defaults
      await intelligenceDb.from("users_access").insert({
        id_workspace: ws.id,
        user_target: userId,
        flag_access_engine: 1,
        flag_access_enginegpt: 1,
        flag_access_operations: 0,
        flag_access_admin: 1,
        flag_access_meetingbrain: 0,
        ...updates,
      });
    }

    return NextResponse.json({ success: true });
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
