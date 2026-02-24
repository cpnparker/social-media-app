import { NextRequest, NextResponse } from "next/server";
import { supabase } from "@/lib/supabase";

// Helper: snake_case → camelCase transforms
function transformTeam(row: any) {
  return {
    id: row.id,
    workspaceId: row.workspace_id,
    name: row.name,
    description: row.description,
    createdAt: row.created_at,
  };
}

function transformMember(row: any) {
  return {
    id: row.id,
    role: row.role,
    joinedAt: row.joined_at,
    userId: row.user_id,
    userName: row.user_name,
    userEmail: row.user_email,
    userAvatar: row.user_avatar,
  };
}

function transformAccount(row: any) {
  return {
    id: row.id,
    teamId: row.team_id,
    lateAccountId: row.late_account_id,
    platform: row.platform,
    displayName: row.display_name,
    username: row.username,
    avatarUrl: row.avatar_url,
    createdAt: row.created_at,
  };
}

// GET /api/teams/[id] — get team with members and accounts
export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id: teamId } = await params;

    // Fetch team
    const { data: team, error: teamErr } = await supabase
      .from("teams")
      .select("*")
      .eq("id", teamId)
      .single();

    if (teamErr || !team) {
      return NextResponse.json({ error: "Team not found" }, { status: 404 });
    }

    // Fetch members — join with users table
    const { data: memberRows } = await supabase
      .from("team_members")
      .select("id, role, joined_at, user_id")
      .eq("team_id", teamId);

    // Enrich members with user info
    const members = await Promise.all(
      (memberRows || []).map(async (m) => {
        const { data: user } = await supabase
          .from("users")
          .select("id_user, name_user, email_user, url_avatar")
          .eq("id_user", parseInt(m.user_id, 10))
          .is("date_deleted", null)
          .single();

        return {
          id: m.id,
          role: m.role,
          joinedAt: m.joined_at,
          userId: m.user_id,
          userName: user?.name_user || null,
          userEmail: user?.email_user || null,
          userAvatar: user?.url_avatar || null,
        };
      })
    );

    // Fetch linked accounts
    const { data: accountRows } = await supabase
      .from("team_accounts")
      .select("*")
      .eq("team_id", teamId);

    return NextResponse.json({
      team: {
        ...transformTeam(team),
        members,
        accounts: (accountRows || []).map(transformAccount),
      },
    });
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}

// PATCH /api/teams/[id] — update team
export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id: teamId } = await params;
    const body = await req.json();

    const updates: Record<string, any> = {};
    if (body.name !== undefined) updates.name = body.name;
    if (body.description !== undefined) updates.description = body.description;

    const { data: updated, error } = await supabase
      .from("teams")
      .update(updates)
      .eq("id", teamId)
      .select()
      .single();

    if (error || !updated) {
      return NextResponse.json({ error: "Team not found" }, { status: 404 });
    }

    return NextResponse.json({ team: transformTeam(updated) });
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}

// DELETE /api/teams/[id] — delete team (cascades members & accounts)
export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id: teamId } = await params;

    // Delete members and accounts first, then team
    await supabase.from("team_members").delete().eq("team_id", teamId);
    await supabase.from("team_accounts").delete().eq("team_id", teamId);

    const { error } = await supabase
      .from("teams")
      .delete()
      .eq("id", teamId);

    if (error) throw error;

    return NextResponse.json({ success: true });
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
