import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { teams, teamMembers, teamAccounts } from "@/lib/db/schema";
import { eq, sql } from "drizzle-orm";

// GET /api/teams — list all teams with member/account counts
export async function GET() {
  try {
    const allTeams = await db.select().from(teams).orderBy(teams.name);

    // Enrich with member and account counts
    const enriched = await Promise.all(
      allTeams.map(async (team) => {
        const [memberResult] = await db
          .select({ count: sql<number>`count(*)::int` })
          .from(teamMembers)
          .where(eq(teamMembers.teamId, team.id));
        const [accountResult] = await db
          .select({ count: sql<number>`count(*)::int` })
          .from(teamAccounts)
          .where(eq(teamAccounts.teamId, team.id));
        return {
          ...team,
          memberCount: memberResult?.count || 0,
          accountCount: accountResult?.count || 0,
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

    const [team] = await db
      .insert(teams)
      .values({
        name,
        description: description || null,
        workspaceId: workspaceId,
      })
      .returning();

    return NextResponse.json({ team }, { status: 201 });
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
