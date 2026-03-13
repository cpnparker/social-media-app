import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { intelligenceDb } from "@/lib/supabase-intelligence";

// GET /api/me/workspaces — returns workspaces the user belongs to
export async function GET() {
  try {
    const session = await auth();
    if (!session?.user?.id) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const userId = parseInt(session.user.id, 10);

    const { data: memberRows, error } = await intelligenceDb
      .from("workspace_members")
      .select("workspace_id, role")
      .eq("user_id", userId);

    if (error) throw error;

    if (!memberRows || memberRows.length === 0) {
      return NextResponse.json({ workspaces: [] });
    }

    const wsIds = memberRows.map((m) => m.workspace_id);
    const { data: wsRows } = await intelligenceDb
      .from("workspaces")
      .select("*")
      .in("id", wsIds);

    const roleMap = new Map(memberRows.map((m) => [m.workspace_id, m.role]));

    // Fetch area access flags from intelligence schema for this user
    const { data: accessRows } = await intelligenceDb
      .from("users_access")
      .select("*")
      .eq("user_target", userId);
    const accessMap = new Map((accessRows || []).map((a) => [a.id_workspace, a]));

    const results = (wsRows || []).map((ws) => {
      const access = accessMap.get(ws.id);
      const role = roleMap.get(ws.id) || "viewer";
      // Access is determined by users_access row (created on sign-in).
      // No row = no access (secure by default).
      return {
        id: ws.id,
        name: ws.name,
        slug: ws.slug,
        plan: ws.plan,
        role,
        accessEngine: access ? !!access.flag_access_engine : false,
        accessEngineGpt: access ? !!access.flag_access_enginegpt : false,
        accessOperations: access ? !!access.flag_access_operations : false,
        accessAdmin: access ? !!access.flag_access_admin : false,
        accessMeetingBrain: access ? !!access.flag_access_meetingbrain : false,
        accessRfpTool: access ? !!access.flag_access_rfptool : false,
      };
    });

    return NextResponse.json({ workspaces: results });
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
