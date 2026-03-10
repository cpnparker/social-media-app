import { NextRequest, NextResponse } from "next/server";
import { supabase } from "@/lib/supabase";
import { intelligenceDb } from "@/lib/supabase-intelligence";

// GET /api/workspace-members — list all users in the workspace
export async function GET() {
  try {
    // Get the default workspace
    const { data: ws } = await intelligenceDb
      .from("workspaces")
      .select("id")
      .limit(1)
      .single();

    if (!ws) {
      return NextResponse.json({ members: [] });
    }

    // Fetch all members with user details
    const { data: memberRows, error } = await intelligenceDb
      .from("workspace_members")
      .select("*")
      .eq("workspace_id", ws.id);

    if (error) throw error;

    // Get user details for each member
    const userIds = (memberRows || []).map((m) => m.user_id);
    const { data: userRows } = await supabase
      .from("users")
      .select("id_user, name_user, email_user, role_user, date_created")
      .in("id_user", userIds);

    const userMap = new Map((userRows || []).map((u) => [u.id_user, u]));

    // Fetch area access flags from intelligence schema
    const { data: accessRows } = await intelligenceDb
      .from("users_access")
      .select("*")
      .eq("id_workspace", ws.id);
    const accessMap = new Map((accessRows || []).map((a: any) => [a.user_target, a]));

    const members = (memberRows || []).map((m) => {
      const user = userMap.get(m.user_id);
      const access = accessMap.get(m.user_id);
      return {
        id: String(m.user_id),
        name: user?.name_user || null,
        email: user?.email_user || null,
        avatarUrl: null,
        provider: null,
        createdAt: user?.date_created || null,
        role: m.role,
        appRole: user?.role_user || "none",
        joinedAt: m.joined_at || null,
        // No access row = no access (secure by default)
        accessEngine: access ? !!access.flag_access_engine : false,
        accessEngineGpt: access ? !!access.flag_access_enginegpt : false,
        accessOperations: access ? !!access.flag_access_operations : false,
        accessAdmin: access ? !!access.flag_access_admin : false,
        accessMeetingBrain: access ? !!access.flag_access_meetingbrain : false,
      };
    });

    return NextResponse.json({ members, workspaceId: ws.id });
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}

// POST /api/workspace-members — invite a new user to the workspace
export async function POST(req: NextRequest) {
  try {
    const { email, name, role } = await req.json();

    if (!email) {
      return NextResponse.json({ error: "Email is required" }, { status: 400 });
    }

    const normalizedEmail = email.trim().toLowerCase();

    const { data: ws } = await intelligenceDb
      .from("workspaces")
      .select("id")
      .limit(1)
      .single();

    if (!ws) {
      return NextResponse.json({ error: "No workspace found" }, { status: 404 });
    }

    // Find or create the user
    let { data: existingUser } = await supabase
      .from("users")
      .select("*")
      .eq("email_user", normalizedEmail)
      .is("date_deleted", null)
      .limit(1)
      .single();

    if (!existingUser) {
      const namePart = normalizedEmail.split("@")[0].replace(/[._-]/g, " ");
      const displayName = name || namePart.replace(/\b\w/g, (c: string) => c.toUpperCase());

      const { data: newUser, error: createErr } = await supabase
        .from("users")
        .insert({
          email_user: normalizedEmail,
          name_user: displayName,
          date_created: new Date().toISOString(),
          role_user: normalizedEmail.endsWith("@thecontentengine.com") ? "tceuser" : "none",
        })
        .select()
        .single();

      if (createErr) throw createErr;
      existingUser = newUser;
    }

    // Check if already a workspace member
    const { data: existingMember } = await intelligenceDb
      .from("workspace_members")
      .select("id")
      .eq("workspace_id", ws.id)
      .eq("user_id", existingUser.id_user)
      .limit(1)
      .single();

    if (existingMember) {
      return NextResponse.json(
        { error: "User is already a member of this workspace" },
        { status: 409 }
      );
    }

    await intelligenceDb.from("workspace_members").insert({
      workspace_id: ws.id,
      user_id: existingUser.id_user,
      role: role || "viewer",
    });

    // Create default area access row in intelligence schema (secure default: no access)
    await intelligenceDb.from("users_access").insert({
      id_workspace: ws.id,
      user_target: existingUser.id_user,
      flag_access_engine: 0,
      flag_access_enginegpt: 0,
      flag_access_operations: 0,
      flag_access_admin: 0,
      flag_access_meetingbrain: 0,
    });

    return NextResponse.json(
      {
        member: {
          id: String(existingUser.id_user),
          name: existingUser.name_user,
          email: existingUser.email_user,
          role: role || "viewer",
          accessEngine: false,
          accessEngineGpt: false,
          accessOperations: false,
          accessAdmin: false,
          accessMeetingBrain: false,
        },
      },
      { status: 201 }
    );
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}

// PATCH /api/workspace-members — update a member's role and/or area access
// Supports both single-user (userId) and bulk (userIds[]) updates
export async function PATCH(req: NextRequest) {
  try {
    const body = await req.json();
    const { userId, userIds, role, appRole, accessEngine, accessEngineGpt, accessOperations, accessAdmin, accessMeetingBrain } = body;

    // Determine target user IDs — bulk or single
    const isBulk = Array.isArray(userIds) && userIds.length > 0;
    if (!userId && !isBulk) {
      return NextResponse.json(
        { error: "userId or userIds[] is required" },
        { status: 400 }
      );
    }

    const { data: ws } = await intelligenceDb
      .from("workspaces")
      .select("id")
      .limit(1)
      .single();

    if (!ws) {
      return NextResponse.json({ error: "No workspace found" }, { status: 404 });
    }

    const targetIds: number[] = isBulk
      ? userIds.map((id: string) => parseInt(id, 10))
      : [parseInt(userId, 10)];

    // Update role in Supabase if provided (single-user only)
    if (role && !isBulk) {
      const { data: updated, error } = await intelligenceDb
        .from("workspace_members")
        .update({ role })
        .eq("workspace_id", ws.id)
        .eq("user_id", targetIds[0])
        .select()
        .single();

      if (error || !updated) {
        return NextResponse.json({ error: "Member not found" }, { status: 404 });
      }
    }

    // Update app role (user type) in the main users table if provided (single-user only)
    if (appRole && !isBulk) {
      await supabase
        .from("users")
        .update({ role_user: appRole })
        .eq("id_user", targetIds[0]);
    }

    // Update area access in intelligence schema if any access flags provided
    const hasAccessUpdate =
      accessEngine !== undefined ||
      accessEngineGpt !== undefined ||
      accessOperations !== undefined ||
      accessAdmin !== undefined ||
      accessMeetingBrain !== undefined;

    if (hasAccessUpdate) {
      await Promise.all(
        targetIds.map(async (numericId) => {
          const { data: existing } = await intelligenceDb
            .from("users_access")
            .select("*")
            .eq("id_workspace", ws.id)
            .eq("user_target", numericId)
            .maybeSingle();

          if (existing) {
            const updates: Record<string, any> = {
              date_updated: new Date().toISOString(),
            };
            if (accessEngine !== undefined) updates.flag_access_engine = accessEngine ? 1 : 0;
            if (accessEngineGpt !== undefined) updates.flag_access_enginegpt = accessEngineGpt ? 1 : 0;
            if (accessOperations !== undefined) updates.flag_access_operations = accessOperations ? 1 : 0;
            if (accessAdmin !== undefined) updates.flag_access_admin = accessAdmin ? 1 : 0;
            if (accessMeetingBrain !== undefined) updates.flag_access_meetingbrain = accessMeetingBrain ? 1 : 0;

            await intelligenceDb
              .from("users_access")
              .update(updates)
              .eq("id_access", existing.id_access);
          } else {
            await intelligenceDb.from("users_access").insert({
              id_workspace: ws.id,
              user_target: numericId,
              flag_access_engine: accessEngine ? 1 : 0,
              flag_access_enginegpt: accessEngineGpt ? 1 : 0,
              flag_access_operations: accessOperations ? 1 : 0,
              flag_access_admin: accessAdmin ? 1 : 0,
              flag_access_meetingbrain: accessMeetingBrain ? 1 : 0,
            });
          }
        })
      );
    }

    return NextResponse.json({ success: true, updated: targetIds.length });
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}

// DELETE /api/workspace-members — remove a user from the workspace
export async function DELETE(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url);
    const userId = searchParams.get("userId");

    if (!userId) {
      return NextResponse.json(
        { error: "userId query param is required" },
        { status: 400 }
      );
    }

    const { data: ws } = await intelligenceDb
      .from("workspaces")
      .select("id")
      .limit(1)
      .single();

    if (!ws) {
      return NextResponse.json({ error: "No workspace found" }, { status: 404 });
    }

    const numericUserId = parseInt(userId, 10);

    const { error } = await intelligenceDb
      .from("workspace_members")
      .delete()
      .eq("workspace_id", ws.id)
      .eq("user_id", numericUserId);

    if (error) throw error;

    // Clean up area access row in intelligence schema
    await intelligenceDb
      .from("users_access")
      .delete()
      .eq("id_workspace", ws.id)
      .eq("user_target", numericUserId);

    return NextResponse.json({ success: true });
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
