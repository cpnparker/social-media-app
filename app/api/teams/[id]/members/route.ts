import { NextRequest, NextResponse } from "next/server";
import { supabase } from "@/lib/supabase";

// Helper: transform member with user info
function transformMember(m: any, user?: any) {
  return {
    id: m.id,
    role: m.role,
    joinedAt: m.joined_at,
    userId: m.user_id,
    userName: user?.name_user || null,
    userEmail: user?.email_user || null,
    userAvatar: user?.url_avatar || null,
  };
}

// GET /api/teams/[id]/members — list members
export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id: teamId } = await params;

    const { data: memberRows, error } = await supabase
      .from("team_members")
      .select("id, role, joined_at, user_id")
      .eq("team_id", teamId);

    if (error) throw error;

    // Enrich with user info
    const members = await Promise.all(
      (memberRows || []).map(async (m) => {
        const { data: user } = await supabase
          .from("users")
          .select("id_user, name_user, email_user, url_avatar")
          .eq("id_user", parseInt(m.user_id, 10))
          .is("date_deleted", null)
          .single();

        return transformMember(m, user);
      })
    );

    return NextResponse.json({ members });
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}

// POST /api/teams/[id]/members — add member (accepts userId or email)
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id: teamId } = await params;
    const body = await req.json();
    const { userId, email, role } = body;

    // Resolve the user — accept userId directly, email lookup, or create new user
    let resolvedUserId = userId;
    if (!resolvedUserId && email) {
      const normalizedEmail = email.trim().toLowerCase();

      const { data: existingUser } = await supabase
        .from("users")
        .select("id_user")
        .eq("email_user", normalizedEmail)
        .is("date_deleted", null)
        .limit(1)
        .single();

      if (existingUser) {
        resolvedUserId = String(existingUser.id_user);
      } else {
        // Auto-create a new user with the provided email
        const namePart = normalizedEmail.split("@")[0].replace(/[._-]/g, " ");
        const displayName =
          body.name ||
          namePart.replace(/\b\w/g, (c: string) => c.toUpperCase());

        const { data: newUser, error: userErr } = await supabase
          .from("users")
          .insert({
            email_user: normalizedEmail,
            name_user: displayName,
            provider: "email",
            date_created: new Date().toISOString(),
          })
          .select()
          .single();

        if (userErr) throw userErr;
        resolvedUserId = String(newUser.id_user);

        // Also add the new user as a workspace member
        const { data: teamData } = await supabase
          .from("teams")
          .select("workspace_id")
          .eq("id", teamId)
          .single();

        if (teamData?.workspace_id) {
          // Check if already a workspace member
          const { data: existingWs } = await supabase
            .from("workspace_members")
            .select("id")
            .eq("workspace_id", teamData.workspace_id)
            .eq("user_id", resolvedUserId)
            .limit(1)
            .single();

          if (!existingWs) {
            await supabase.from("workspace_members").insert({
              workspace_id: teamData.workspace_id,
              user_id: resolvedUserId,
              role: "viewer",
            });
          }
        }
      }
    }

    if (!resolvedUserId) {
      return NextResponse.json(
        { error: "userId or email is required" },
        { status: 400 }
      );
    }

    // Check if already a member
    const { data: existing } = await supabase
      .from("team_members")
      .select("id")
      .eq("team_id", teamId)
      .eq("user_id", resolvedUserId)
      .limit(1)
      .single();

    if (existing) {
      return NextResponse.json(
        { error: "User is already a member of this team" },
        { status: 409 }
      );
    }

    const { data: member, error } = await supabase
      .from("team_members")
      .insert({
        team_id: teamId,
        user_id: resolvedUserId,
        role: role || "user",
      })
      .select()
      .single();

    if (error) throw error;

    return NextResponse.json(
      {
        member: {
          id: member.id,
          teamId: member.team_id,
          userId: member.user_id,
          role: member.role,
          joinedAt: member.joined_at,
        },
      },
      { status: 201 }
    );
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}

// PATCH /api/teams/[id]/members — update member role
export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id: teamId } = await params;
    const body = await req.json();
    const { memberId, role } = body;

    if (!memberId || !role) {
      return NextResponse.json(
        { error: "memberId and role are required" },
        { status: 400 }
      );
    }

    const { data: updated, error } = await supabase
      .from("team_members")
      .update({ role })
      .eq("id", memberId)
      .eq("team_id", teamId)
      .select()
      .single();

    if (error || !updated) {
      return NextResponse.json(
        { error: "Member not found" },
        { status: 404 }
      );
    }

    return NextResponse.json({
      member: {
        id: updated.id,
        teamId: updated.team_id,
        userId: updated.user_id,
        role: updated.role,
        joinedAt: updated.joined_at,
      },
    });
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}

// DELETE /api/teams/[id]/members — remove member
export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id: teamId } = await params;
    const { searchParams } = new URL(req.url);
    const memberId = searchParams.get("memberId");

    if (!memberId) {
      return NextResponse.json(
        { error: "memberId query param is required" },
        { status: 400 }
      );
    }

    const { error } = await supabase
      .from("team_members")
      .delete()
      .eq("id", memberId)
      .eq("team_id", teamId);

    if (error) throw error;

    return NextResponse.json({ success: true });
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
