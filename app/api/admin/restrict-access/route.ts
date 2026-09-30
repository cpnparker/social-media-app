import { NextResponse } from "next/server";
import { supabase } from "@/lib/supabase";
import { auth } from "@/lib/auth";
import { intelligenceDb } from "@/lib/supabase-intelligence";

/**
 * POST /api/admin/restrict-access
 *
 * Admin-only endpoint that:
 * 1. Sets all existing users_access rows to all-zero
 * 2. Creates/updates the requesting user's (owner) row to all-one
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
    const { data: ws } = await intelligenceDb
      .from("workspaces")
      .select("id")
      .limit(1)
      .single();

    if (!ws) {
      return NextResponse.json({ error: "No workspace found" }, { status: 404 });
    }

    // Verify the caller is the workspace owner or admin
    const { data: membership } = await intelligenceDb
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

    // 1. Set ALL existing users_access rows for this workspace to all-zero
    await intelligenceDb
      .from("users_access")
      .update({
        flag_access_engine: 0,
        flag_access_enginegpt: 0,
        flag_access_operations: 0,
        flag_access_admin: 0,
        flag_access_meetingbrain: 0,
        date_updated: new Date().toISOString(),
      })
      .eq("id_workspace", ws.id);

    // Newer flags go in their OWN update, deliberately.
    //
    // PostgREST fails an entire statement when it names an unknown column, so
    // folding a not-yet-migrated flag into the update above would break the
    // whole lockdown on any deploy that ran ahead of its migration — turning a
    // small gap (one flag not revoked) into a total failure to revoke anything.
    // Errors here are logged, not thrown, for the same reason: a partial
    // lockdown must still complete.
    //
    // NOTE (2026-08-24): the optimiser no longer GATES on this column — it now
    // follows flag_access_enginegpt, which the update above already zeroes, so
    // the lockdown revokes it either way. This write is kept so the stored data
    // stays truthful if the gate is ever split per-feature again; if it fails
    // on an unmigrated deploy, nothing is left unrevoked.
    const { error: newFlagsError } = await intelligenceDb
      .from("users_access")
      .update({ flag_access_optimizer: 0 })
      .eq("id_workspace", ws.id);
    if (newFlagsError) {
      console.warn(
        "[restrict-access] optimizer flag not revoked (column may not be migrated yet):",
        newFlagsError.message
      );
    }

    // 2. Create or update the owner's row to all-one
    const { data: existingOwnerAccess } = await intelligenceDb
      .from("users_access")
      .select("*")
      .eq("id_workspace", ws.id)
      .eq("user_target", userId)
      .maybeSingle();

    if (existingOwnerAccess) {
      await intelligenceDb
        .from("users_access")
        .update({
          flag_access_engine: 1,
          flag_access_enginegpt: 1,
          flag_access_operations: 1,
          flag_access_admin: 1,
          flag_access_meetingbrain: 1,
          date_updated: new Date().toISOString(),
        })
        .eq("id_access", existingOwnerAccess.id_access);
    } else {
      await intelligenceDb.from("users_access").insert({
        id_workspace: ws.id,
        user_target: userId,
        flag_access_engine: 1,
        flag_access_enginegpt: 1,
        flag_access_operations: 1,
        flag_access_admin: 1,
        flag_access_meetingbrain: 1,
      });
    }

    // Count how many users were restricted
    const { data: allRows } = await intelligenceDb
      .from("users_access")
      .select("user_target")
      .eq("id_workspace", ws.id);

    const restricted = (allRows || []).filter((r: any) => r.user_target !== userId).length;

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
