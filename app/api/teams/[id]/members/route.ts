import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { teamMembers, users, workspaceMembers, teams } from "@/lib/db/schema";
import { eq, and } from "drizzle-orm";

// GET /api/teams/[id]/members — list members
export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id: teamId } = await params;

    const members = await db
      .select({
        id: teamMembers.id,
        role: teamMembers.role,
        joinedAt: teamMembers.joinedAt,
        userId: users.id,
        userName: users.name,
        userEmail: users.email,
        userAvatar: users.avatarUrl,
      })
      .from(teamMembers)
      .innerJoin(users, eq(teamMembers.userId, users.id))
      .where(eq(teamMembers.teamId, teamId));

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
      const [existingUser] = await db
        .select({ id: users.id })
        .from(users)
        .where(eq(users.email, normalizedEmail))
        .limit(1);

      if (existingUser) {
        resolvedUserId = existingUser.id;
      } else {
        // Auto-create a new user with the provided email
        const namePart = normalizedEmail.split("@")[0].replace(/[._-]/g, " ");
        const displayName = body.name || namePart.replace(/\b\w/g, (c: string) => c.toUpperCase());

        const [newUser] = await db
          .insert(users)
          .values({
            email: normalizedEmail,
            name: displayName,
            provider: "email",
          })
          .returning();

        resolvedUserId = newUser.id;

        // Also add the new user as a workspace member
        const [team] = await db
          .select({ workspaceId: teams.workspaceId })
          .from(teams)
          .where(eq(teams.id, teamId))
          .limit(1);

        if (team) {
          // Check if already a workspace member
          const [existingWsMember] = await db
            .select()
            .from(workspaceMembers)
            .where(
              and(
                eq(workspaceMembers.workspaceId, team.workspaceId),
                eq(workspaceMembers.userId, resolvedUserId)
              )
            )
            .limit(1);

          if (!existingWsMember) {
            await db.insert(workspaceMembers).values({
              workspaceId: team.workspaceId,
              userId: resolvedUserId,
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
    const existing = await db
      .select()
      .from(teamMembers)
      .where(
        and(
          eq(teamMembers.teamId, teamId),
          eq(teamMembers.userId, resolvedUserId)
        )
      )
      .limit(1);

    if (existing.length > 0) {
      return NextResponse.json(
        { error: "User is already a member of this team" },
        { status: 409 }
      );
    }

    const [member] = await db
      .insert(teamMembers)
      .values({
        teamId,
        userId: resolvedUserId,
        role: role || "user",
      })
      .returning();

    return NextResponse.json({ member }, { status: 201 });
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

    const [updated] = await db
      .update(teamMembers)
      .set({ role })
      .where(
        and(
          eq(teamMembers.id, memberId),
          eq(teamMembers.teamId, teamId)
        )
      )
      .returning();

    if (!updated) {
      return NextResponse.json(
        { error: "Member not found" },
        { status: 404 }
      );
    }

    return NextResponse.json({ member: updated });
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

    const [deleted] = await db
      .delete(teamMembers)
      .where(
        and(
          eq(teamMembers.id, memberId),
          eq(teamMembers.teamId, teamId)
        )
      )
      .returning();

    if (!deleted) {
      return NextResponse.json(
        { error: "Member not found" },
        { status: 404 }
      );
    }

    return NextResponse.json({ success: true });
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
