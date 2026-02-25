import { NextRequest, NextResponse } from "next/server";
import { supabase } from "@/lib/supabase";
import { auth } from "@/lib/auth";
import { isTCEStaff, getAllowedClientIds } from "@/lib/permissions";

// GET /api/me/customers — returns customers the authenticated user can access
// Uses role_user from the session (not workspace_members.role)
export async function GET() {
  try {
    const session = await auth();
    if (!session?.user?.id) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const userId = parseInt(session.user.id, 10);
    const role = session.user.role || "none";
    const canViewAll = isTCEStaff(role);

    let customerList: any[] = [];

    if (canViewAll) {
      // TCE staff (super/tceadmin/tcemanager/tceuser) can see all clients
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
      // Client roles see only their assigned clients via lookup_users_clients
      const allowedIds = await getAllowedClientIds(userId, role);

      if (!allowedIds || allowedIds.length === 0) {
        customerList = [];
      } else {
        const { data: clients } = await supabase
          .from("app_clients")
          .select("id_client, name_client, information_industry, link_website")
          .in("id_client", allowedIds);

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
      role,
      canViewAll,
    });
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
