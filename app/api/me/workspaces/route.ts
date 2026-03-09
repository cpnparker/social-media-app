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
      const noRow = !access;
      // If no access row exists: workspace owners/admins get full access,
      // everyone else gets no access (secure by default).
      // Once explicit rows are created (via admin endpoint), those take priority.
      const isPrivileged = role === "owner" || role === "admin";
      return {
        id: ws.id,
        name: ws.name,
        slug: ws.slug,
        plan: ws.plan,
        role,
        accessEngine: noRow ? isPrivileged : !!access.flag_access_engine,
        accessEngineGpt: noRow ? isPrivileged : !!access.flag_access_enginegpt,
        accessOperations: noRow ? isPrivileged : !!access.flag_access_operations,
        accessAdmin: noRow ? isPrivileged : !!access.flag_access_admin,
        accessMeetingBrain: noRow ? isPrivileged : !!access.flag_access_meetingbrain,
      };
    });

    return NextResponse.json({ workspaces: results });
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
