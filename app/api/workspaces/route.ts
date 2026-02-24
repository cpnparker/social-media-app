import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { workspaces, workspaceMembers } from "@/lib/db/schema";
import { eq } from "drizzle-orm";
import { auth } from "@/lib/auth";

// POST /api/workspaces — create a new workspace
export async function POST(req: NextRequest) {
  try {
    const session = await auth();
    if (!session?.user?.id) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { name } = await req.json();

    if (!name) {
      return NextResponse.json(
        { error: "name is required" },
        { status: 400 }
      );
    }

    // Insert workspace first to get the generated id
    const [workspace] = await db
      .insert(workspaces)
      .values({
        name,
        // Temporary slug — will be updated with the id suffix
        slug: name.toLowerCase().replace(/\s+/g, "-").replace(/[^a-z0-9-]/g, ""),
      })
      .returning();

    // Generate final slug with first 8 chars of the workspace id
    const slug = `${name.toLowerCase().replace(/\s+/g, "-").replace(/[^a-z0-9-]/g, "")}-${workspace.id.slice(0, 8)}`;

    const [updatedWorkspace] = await db
      .update(workspaces)
      .set({ slug })
      .where(eq(workspaces.id, workspace.id))
      .returning();

    // Add the current user as owner
    await db.insert(workspaceMembers).values({
      workspaceId: workspace.id,
      userId: session.user.id,
      role: "owner",
      joinedAt: new Date(),
    });

    return NextResponse.json({ workspace: updatedWorkspace }, { status: 201 });
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
