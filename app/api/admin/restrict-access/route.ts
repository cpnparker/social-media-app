import { NextResponse } from "next/server";
import { supabase } from "@/lib/supabase";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { userAccess } from "@/lib/db/schema";
import { eq, and } from "drizzle-orm";

/**
 * POST /api/admin/restrict-access
 *
 * Admin-only endpoint that:
 * 1. Sets all existing user_access rows to all-false
 * 2. Creates/updates the requesting user's (owner) row to all-true
 *
 * Only the workspace owner can call this.
 */
export async function POST() {
  try {
    const session = await auth();
    if (!session?.user?.id) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const userId = parseInt(session.user.id, 10);

    // Get the workspace
    const { data: ws } = await supabase
      .from("workspaces")
      .select("id")
      .limit(1)
      .single();

    if (!ws) {
      return NextResponse.json({ error: "No workspace found" }, { status: 404 });
    }

    // Verify the caller is the workspace owner or admin
    const { data: membership } = await supabase
      .from("workspace_members")
      .select("role")
      .eq("workspace_id", ws.id)
      .eq("user_id", userId)
      .single();

    if (!membership || (membership.role !== "owner" && membership.role !== "admin")) {
      return NextResponse.json(
        { error: "Only the workspace owner or admin can perform this action" },
        { status: 403 }
      );
    }

    // 1. Set ALL existing user_access rows for this workspace to all-false
    await db
      .update(userAccess)
      .set({
        accessEngine: false,
        accessEngineGpt: false,
        accessOperations: false,
        accessAdmin: false,
        updatedAt: new Date(),
      })
      .where(eq(userAccess.workspaceId, ws.id));

    // 2. Create or update the owner's row to all-true
    const [existingOwnerAccess] = await db
      .select()
      .from(userAccess)
      .where(
        and(
          eq(userAccess.workspaceId, ws.id),
          eq(userAccess.userId, userId)
        )
      )
      .limit(1);

    if (existingOwnerAccess) {
      await db
        .update(userAccess)
        .set({
          accessEngine: true,
          accessEngineGpt: true,
          accessOperations: true,
          accessAdmin: true,
          updatedAt: new Date(),
        })
        .where(eq(userAccess.id, existingOwnerAccess.id));
    } else {
      await db.insert(userAccess).values({
        workspaceId: ws.id,
        userId,
        accessEngine: true,
        accessEngineGpt: true,
        accessOperations: true,
        accessAdmin: true,
      });
    }

    // Count how many users were restricted
    const allRows = await db
      .select()
      .from(userAccess)
      .where(eq(userAccess.workspaceId, ws.id));

    const restricted = allRows.filter((r) => r.userId !== userId).length;

    return NextResponse.json({
      success: true,
      message: `Restricted ${restricted} user(s). Owner (user ${userId}) has full access.`,
      restricted,
    });
  } catch (error: any) {
    console.error("[Admin] restrict-access error:", error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
