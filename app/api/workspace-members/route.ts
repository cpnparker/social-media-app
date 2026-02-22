import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { users, workspaceMembers, workspaces } from "@/lib/db/schema";
import { eq, and } from "drizzle-orm";
import { auth } from "@/lib/auth";

// GET /api/workspace-members — list all users in the workspace
export async function GET() {
  try {
    // Get the default workspace
    const [ws] = await db.select({ id: workspaces.id }).from(workspaces).limit(1);
    if (!ws) {
      return NextResponse.json({ members: [] });
    }

    // Ensure the logged-in user is a workspace member
    const session = await auth();
    if (session?.user?.email) {
      const [sessionUser] = await db
        .select({ id: users.id })
        .from(users)
        .where(eq(users.email, session.user.email))
        .limit(1);

      if (sessionUser) {
        const [existingMember] = await db
          .select()
          .from(workspaceMembers)
          .where(
            and(
              eq(workspaceMembers.workspaceId, ws.id),
              eq(workspaceMembers.userId, sessionUser.id)
            )
          )
          .limit(1);

        if (!existingMember) {
          await db.insert(workspaceMembers).values({
            workspaceId: ws.id,
            userId: sessionUser.id,
            role: "admin",
            joinedAt: new Date(),
          });
        }
      }
    }

    const members = await db
      .select({
        id: users.id,
        name: users.name,
        email: users.email,
        avatarUrl: users.avatarUrl,
        provider: users.provider,
        createdAt: users.createdAt,
        role: workspaceMembers.role,
        invitedAt: workspaceMembers.invitedAt,
        joinedAt: workspaceMembers.joinedAt,
      })
      .from(workspaceMembers)
      .innerJoin(users, eq(workspaceMembers.userId, users.id))
      .where(eq(workspaceMembers.workspaceId, ws.id));

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

    // Get the default workspace
    const [ws] = await db.select({ id: workspaces.id }).from(workspaces).limit(1);
    if (!ws) {
      return NextResponse.json({ error: "No workspace found" }, { status: 404 });
    }

    // Find or create the user
    let [existingUser] = await db
      .select()
      .from(users)
      .where(eq(users.email, normalizedEmail))
      .limit(1);

    if (!existingUser) {
      const namePart = normalizedEmail.split("@")[0].replace(/[._-]/g, " ");
      const displayName = name || namePart.replace(/\b\w/g, (c: string) => c.toUpperCase());

      const [newUser] = await db
        .insert(users)
        .values({
          email: normalizedEmail,
          name: displayName,
          provider: "email",
        })
        .returning();

      existingUser = newUser;
    }

    // Check if already a workspace member
    const [existingMember] = await db
      .select()
      .from(workspaceMembers)
      .where(
        and(
          eq(workspaceMembers.workspaceId, ws.id),
          eq(workspaceMembers.userId, existingUser.id)
        )
      )
      .limit(1);

    if (existingMember) {
      return NextResponse.json(
        { error: "User is already a member of this workspace" },
        { status: 409 }
      );
    }

    await db.insert(workspaceMembers).values({
      workspaceId: ws.id,
      userId: existingUser.id,
      role: role || "viewer",
    });

    return NextResponse.json(
      {
        member: {
          id: existingUser.id,
          name: existingUser.name,
          email: existingUser.email,
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

    const [ws] = await db.select({ id: workspaces.id }).from(workspaces).limit(1);
    if (!ws) {
      return NextResponse.json({ error: "No workspace found" }, { status: 404 });
    }

    const [updated] = await db
      .update(workspaceMembers)
      .set({ role })
      .where(
        and(
          eq(workspaceMembers.workspaceId, ws.id),
          eq(workspaceMembers.userId, userId)
        )
      )
      .returning();

    if (!updated) {
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

    const [ws] = await db.select({ id: workspaces.id }).from(workspaces).limit(1);
    if (!ws) {
      return NextResponse.json({ error: "No workspace found" }, { status: 404 });
    }

    const [deleted] = await db
      .delete(workspaceMembers)
      .where(
        and(
          eq(workspaceMembers.workspaceId, ws.id),
          eq(workspaceMembers.userId, userId)
        )
      )
      .returning();

    if (!deleted) {
      return NextResponse.json({ error: "Member not found" }, { status: 404 });
    }

    return NextResponse.json({ success: true });
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
