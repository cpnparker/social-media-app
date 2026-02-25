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

      // Collect assigned Late account IDs from BOTH sources:
      const assignedIds = new Set<string>();

      // Source 1: customer_accounts table (modern direct linkages)
      const { data: directLinks } = await supabase
        .from("customer_accounts")
        .select("late_account_id")
        .eq("customer_id", clientId);

      for (const link of directLinks || []) {
        if (link.late_account_id) assignedIds.add(String(link.late_account_id));
      }

      // Source 2: Legacy social → posting_distributions linkage
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

        for (const d of dists || []) {
          const id = String(d.id_resource || d.id_distribution);
          assignedIds.add(id);
        }
      }

      // Filter Late API accounts to only those assigned to this customer
      if (assignedIds.size > 0) {
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
