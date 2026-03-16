import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { supabase } from "@/lib/supabase";
import { intelligenceDb } from "@/lib/supabase-intelligence";

// GET /api/me/workspaces — returns workspaces the user belongs to
export async function GET() {
  try {
    const session = await auth();
    if (!session?.user?.id) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    let userId = parseInt(session.user.id, 10);
    const isValidId = !isNaN(userId) && userId > 0 && userId < 10000000;

    // If token.sub is a Google ID (not a valid DB ID), resolve via email
    if (!isValidId && session.user.email) {
      console.warn(`[/api/me/workspaces] Invalid user ID ${session.user.id}, resolving by email: ${session.user.email}`);
      const { data: dbUser } = await supabase
        .from("users")
        .select("id_user")
        .eq("email_user", session.user.email)
        .is("date_deleted", null)
        .limit(1)
        .single();
      if (dbUser) {
        userId = dbUser.id_user;
      } else {
        return NextResponse.json({ workspaces: [] });
      }
    }

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

    console.log(`[/api/me/workspaces] userId=${userId}, workspaces=${results.length}`, results.map(r => ({ id: r.id, name: r.name, accessEngineGpt: r.accessEngineGpt, role: r.role })));
    return NextResponse.json({ workspaces: results });
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
