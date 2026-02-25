import { NextRequest, NextResponse } from "next/server";
import { supabase } from "@/lib/supabase";
import { auth } from "@/lib/auth";

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

    const members = (memberRows || []).map((m) => {
      const user = userMap.get(m.user_id);
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

    return NextResponse.json(
      {
        member: {
          id: String(existingUser.id_user),
          name: existingUser.name_user,
          email: existingUser.email_user,
          role: role || "viewer",
        },
      },
      { status: 201 }
    );
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}

// PATCH /api/workspace-members — update a member's role
export async function PATCH(req: NextRequest) {
  try {
    const { userId, role } = await req.json();

    if (!userId || !role) {
      return NextResponse.json(
        { error: "userId and role are required" },
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

    const { data: updated, error } = await supabase
      .from("workspace_members")
      .update({ role })
      .eq("workspace_id", ws.id)
      .eq("user_id", parseInt(userId, 10))
      .select()
      .single();

    if (error || !updated) {
      return NextResponse.json({ error: "Member not found" }, { status: 404 });
    }

    return NextResponse.json({ member: updated });
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

    const { error } = await supabase
      .from("workspace_members")
      .delete()
      .eq("workspace_id", ws.id)
      .eq("user_id", parseInt(userId, 10));

    if (error) throw error;

    return NextResponse.json({ success: true });
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
