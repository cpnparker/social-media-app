import { NextRequest, NextResponse } from "next/server";
import { supabase } from "@/lib/supabase";

// Helper: snake_case row → camelCase for frontend
function transformTeam(row: any) {
  return {
    id: row.id,
    workspaceId: row.workspace_id,
    name: row.name,
    description: row.description,
    createdAt: row.created_at,
  };
}

// GET /api/teams — list all teams with member/account counts
export async function GET() {
  try {
    const { data: allTeams, error } = await supabase
      .from("teams")
      .select("*")
      .order("name");

    if (error) throw error;

    // Enrich with member and account counts
    const enriched = await Promise.all(
      (allTeams || []).map(async (team) => {
        const { count: memberCount } = await supabase
          .from("team_members")
          .select("*", { count: "exact", head: true })
          .eq("team_id", team.id);

        const { count: accountCount } = await supabase
          .from("team_accounts")
          .select("*", { count: "exact", head: true })
          .eq("team_id", team.id);

        return {
          ...transformTeam(team),
          memberCount: memberCount || 0,
          accountCount: accountCount || 0,
        };
      })
    );

    return NextResponse.json({ teams: enriched });
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}

// POST /api/teams — create a new team
export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { name, description, workspaceId } = body;

    if (!name) {
      return NextResponse.json(
        { error: "Team name is required" },
        { status: 400 }
      );
    }

    const { data: team, error } = await supabase
      .from("teams")
      .insert({
        name,
        description: description || null,
        workspace_id: workspaceId,
      })
      .select()
      .single();

    if (error) throw error;

    return NextResponse.json({ team: transformTeam(team) }, { status: 201 });
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
