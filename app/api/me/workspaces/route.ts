import { NextRequest, NextResponse } from "next/server";
import { supabase } from "@/lib/supabase";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { userAccess } from "@/lib/db/schema";
import { eq, and } from "drizzle-orm";

// GET /api/me/workspaces — returns workspaces the user belongs to
export async function GET() {
  try {
    const session = await auth();
    if (!session?.user?.id) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const userId = parseInt(session.user.id, 10);

    const { data: memberRows, error } = await supabase
      .from("workspace_members")
      .select("workspace_id, role")
      .eq("user_id", userId);

    if (error) throw error;

    if (!memberRows || memberRows.length === 0) {
      return NextResponse.json({ workspaces: [] });
    }

    const wsIds = memberRows.map((m) => m.workspace_id);
    const { data: wsRows } = await supabase
      .from("workspaces")
      .select("*")
      .in("id", wsIds);

    const roleMap = new Map(memberRows.map((m) => [m.workspace_id, m.role]));

    // Fetch area access flags from Neon for this user
    const accessRows = await db
      .select()
      .from(userAccess)
      .where(eq(userAccess.userId, userId));
    const accessMap = new Map(accessRows.map((a) => [a.workspaceId, a]));

    const results = (wsRows || []).map((ws) => {
      const access = accessMap.get(ws.id);
      return {
        id: ws.id,
        name: ws.name,
        slug: ws.slug,
        plan: ws.plan,
        role: roleMap.get(ws.id) || "viewer",
        accessEngine: access?.accessEngine ?? true,
        accessEngineGpt: access?.accessEngineGpt ?? true,
        accessOperations: access?.accessOperations ?? false,
        accessAdmin: access?.accessAdmin ?? false,
      };
    });

    return NextResponse.json({ workspaces: results });
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
