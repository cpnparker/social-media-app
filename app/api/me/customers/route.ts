import { NextRequest, NextResponse } from "next/server";
import { supabase } from "@/lib/supabase";
import { auth } from "@/lib/auth";

// GET /api/me/customers — returns customers the authenticated user can access
export async function GET() {
  try {
    const session = await auth();
    if (!session?.user?.id) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const userId = parseInt(session.user.id, 10);

    // Get the default workspace
    const { data: ws } = await supabase
      .from("workspaces")
      .select("id")
      .limit(1)
      .single();

    if (!ws) {
      return NextResponse.json({ customers: [], role: null, canViewAll: false });
    }

    // Get the user's workspace role
    const { data: membership } = await supabase
      .from("workspace_members")
      .select("role")
      .eq("workspace_id", ws.id)
      .eq("user_id", userId)
      .limit(1)
      .single();

    if (!membership) {
      return NextResponse.json({ customers: [], role: null, canViewAll: false });
    }

    const workspaceRole = membership.role;
    const canViewAll = workspaceRole === "owner" || workspaceRole === "admin";

    let customerList: any[] = [];

    if (canViewAll) {
      // Owner/admin can see all clients
      const { data: clients } = await supabase
        .from("app_clients")
        .select("id_client, name_client, information_industry, link_website");

      customerList = (clients || []).map((c) => ({
        id: String(c.id_client),
        name: c.name_client,
        industry: c.information_industry,
        logoUrl: null,
        status: "active",
      }));
    } else {
      // Other roles only see assigned clients
      const { data: assignments } = await supabase
        .from("lookup_users_clients")
        .select("id_client")
        .eq("id_user", userId);

      const clientIds = (assignments || []).map((a) => a.id_client);

      if (clientIds.length === 0) {
        customerList = [];
      } else {
        const { data: clients } = await supabase
          .from("app_clients")
          .select("id_client, name_client, information_industry, link_website")
          .in("id_client", clientIds);

        customerList = (clients || []).map((c) => ({
          id: String(c.id_client),
          name: c.name_client,
          industry: c.information_industry,
          logoUrl: null,
          status: "active",
        }));
      }
    }

    return NextResponse.json({
      customers: customerList,
      role: workspaceRole,
      canViewAll,
    });
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
