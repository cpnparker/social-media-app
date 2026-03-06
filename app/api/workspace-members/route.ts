import { NextRequest, NextResponse } from "next/server";
import { supabase } from "@/lib/supabase";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { userAccess } from "@/lib/db/schema";
import { eq, and } from "drizzle-orm";

// GET /api/workspace-members — list all users in the workspace
export async function GET() {
  try {
    // Get the default workspace
    const { data: ws } = await supabase
      .from("workspaces")
      .select("id")
      .limit(1)
      .single();

    if (!ws) {
      return NextResponse.json({ members: [] });
    }

    // Ensure the logged-in user is a workspace member
    const session = await auth();
    if (session?.user?.email) {
      const { data: sessionUser } = await supabase
        .from("users")
        .select("id_user")
        .eq("email_user", session.user.email)
        .is("date_deleted", null)
        .limit(1)
        .single();

      if (sessionUser) {
        const { data: existingMember } = await supabase
          .from("workspace_members")
          .select("id")
          .eq("workspace_id", ws.id)
          .eq("user_id", sessionUser.id_user)
          .limit(1)
          .single();

        if (!existingMember) {
          await supabase.from("workspace_members").insert({
            workspace_id: ws.id,
            user_id: sessionUser.id_user,
            role: "admin",
            joined_at: new Date().toISOString(),
          });
        }
      }
    }

    // Fetch all members with user details
    const { data: memberRows, error } = await supabase
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

    // Fetch area access flags from Neon
    const accessRows = await db
      .select()
      .from(userAccess)
      .where(eq(userAccess.workspaceId, ws.id));
    const accessMap = new Map(accessRows.map((a) => [a.userId, a]));

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
        supabaseRole: user?.role_user || null,
        joinedAt: m.joined_at || null,
        accessEngine: access?.accessEngine ?? true,
        accessEngineGpt: access?.accessEngineGpt ?? true,
        accessOperations: access?.accessOperations ?? false,
        accessAdmin: access?.accessAdmin ?? false,
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

    const { data: ws } = await supabase
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
        })
        .select()
        .single();

      if (createErr) throw createErr;
      existingUser = newUser;
    }

    // Check if already a workspace member
    const { data: existingMember } = await supabase
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

    await supabase.from("workspace_members").insert({
      workspace_id: ws.id,
      user_id: existingUser.id_user,
      role: role || "viewer",
    });

    // Create default area access row in Neon
    await db.insert(userAccess).values({
      workspaceId: ws.id,
      userId: existingUser.id_user,
      accessEngine: true,
      accessEngineGpt: true,
      accessOperations: false,
      accessAdmin: false,
    });

    return NextResponse.json(
      {
        member: {
          id: String(existingUser.id_user),
          name: existingUser.name_user,
          email: existingUser.email_user,
          role: role || "viewer",
          accessEngine: true,
          accessEngineGpt: true,
          accessOperations: false,
          accessAdmin: false,
        },
      },
      { status: 201 }
    );
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}

// PATCH /api/workspace-members — update a member's role and/or area access
export async function PATCH(req: NextRequest) {
  try {
    const body = await req.json();
    const { userId, role, accessEngine, accessEngineGpt, accessOperations, accessAdmin } = body;

    if (!userId) {
      return NextResponse.json(
        { error: "userId is required" },
        { status: 400 }
      );
    }

    const { data: ws } = await supabase
      .from("workspaces")
      .select("id")
      .limit(1)
      .single();

    if (!ws) {
      return NextResponse.json({ error: "No workspace found" }, { status: 404 });
    }

    const numericUserId = parseInt(userId, 10);

    // Update role in Supabase if provided
    if (role) {
      const { data: updated, error } = await supabase
        .from("workspace_members")
        .update({ role })
        .eq("workspace_id", ws.id)
        .eq("user_id", numericUserId)
        .select()
        .single();

      if (error || !updated) {
        return NextResponse.json({ error: "Member not found" }, { status: 404 });
      }
    }

    // Update area access in Neon if any access flags provided
    const hasAccessUpdate =
      accessEngine !== undefined ||
      accessEngineGpt !== undefined ||
      accessOperations !== undefined ||
      accessAdmin !== undefined;

    if (hasAccessUpdate) {
      // Check if access row exists
      const [existing] = await db
        .select()
        .from(userAccess)
        .where(
          and(
            eq(userAccess.workspaceId, ws.id),
            eq(userAccess.userId, numericUserId)
          )
        )
        .limit(1);

      if (existing) {
        const updates: Record<string, boolean> = {};
        if (accessEngine !== undefined) updates.accessEngine = accessEngine;
        if (accessEngineGpt !== undefined) updates.accessEngineGpt = accessEngineGpt;
        if (accessOperations !== undefined) updates.accessOperations = accessOperations;
        if (accessAdmin !== undefined) updates.accessAdmin = accessAdmin;

        await db
          .update(userAccess)
          .set({ ...updates, updatedAt: new Date() })
          .where(eq(userAccess.id, existing.id));
      } else {
        // Create access row with provided values or defaults
        await db.insert(userAccess).values({
          workspaceId: ws.id,
          userId: numericUserId,
          accessEngine: accessEngine ?? true,
          accessEngineGpt: accessEngineGpt ?? true,
          accessOperations: accessOperations ?? false,
          accessAdmin: accessAdmin ?? false,
        });
      }
    }

    return NextResponse.json({ success: true });
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

    const { data: ws } = await supabase
      .from("workspaces")
      .select("id")
      .limit(1)
      .single();

    if (!ws) {
      return NextResponse.json({ error: "No workspace found" }, { status: 404 });
    }

    const numericUserId = parseInt(userId, 10);

    const { error } = await supabase
      .from("workspace_members")
      .delete()
      .eq("workspace_id", ws.id)
      .eq("user_id", numericUserId);

    if (error) throw error;

    // Clean up area access row in Neon
    await db
      .delete(userAccess)
      .where(
        and(
          eq(userAccess.workspaceId, ws.id),
          eq(userAccess.userId, numericUserId)
        )
      );

    return NextResponse.json({ success: true });
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
