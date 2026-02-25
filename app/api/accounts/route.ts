import { NextRequest, NextResponse } from "next/server";
import { lateApiFetch } from "@/lib/late";
import { supabase } from "@/lib/supabase";
import { requireAuth, canAccessClient } from "@/lib/permissions";

// GET /api/accounts — list connected social accounts and profiles
export async function GET(req: NextRequest) {
  const authResult = await requireAuth();
  if (authResult instanceof NextResponse) return authResult;
  const { userId, role } = authResult;

  try {
    const { searchParams } = new URL(req.url);
    const customerId = searchParams.get("customerId");

    // Fetch both accounts and profiles in parallel
    const [accountsData, profilesData] = await Promise.all([
      lateApiFetch("/accounts"),
      lateApiFetch("/profiles"),
    ]);

    let accounts = accountsData.accounts || [];
    const profiles = profilesData.profiles || [];

    // If customerId is provided, filter to accounts linked to this client
    if (customerId) {
      const clientId = parseInt(customerId, 10);

      // Validate client access
      if (!(await canAccessClient(userId, role, clientId))) {
        return NextResponse.json({ error: "Forbidden" }, { status: 403 });
      }

      // Get distinct distribution IDs for this client from social posts
      const { data: socialLinks } = await supabase
        .from("social")
        .select("id_distribution")
        .eq("id_client", clientId)
        .not("id_distribution", "is", null)
        .is("date_deleted", null);

      const distIds = Array.from(new Set((socialLinks || []).map((r: any) => r.id_distribution)));

      if (distIds.length > 0) {
        const { data: dists } = await supabase
          .from("posting_distributions")
          .select("id_distribution, id_resource")
          .in("id_distribution", distIds);

        const assignedIds = new Set(
          (dists || []).map((d: any) => String(d.id_resource || d.id_distribution))
        );

        accounts = accounts.filter((a: any) => assignedIds.has(a._id || a.id));
      } else {
        accounts = [];
      }
    }

    return NextResponse.json({
      accounts,
      profiles,
    });
  } catch (error: any) {
    return NextResponse.json(
      { error: error.message },
      { status: 500 }
    );
  }
}
