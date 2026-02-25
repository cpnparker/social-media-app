import { NextRequest, NextResponse } from "next/server";
import { lateApiFetch } from "@/lib/late";
import { supabase } from "@/lib/supabase";

// GET /api/accounts — list connected social accounts and profiles
export async function GET(req: NextRequest) {
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
    // via the social→posting_distributions implicit relationship
    if (customerId) {
      const clientId = parseInt(customerId, 10);

      // Get distinct distribution IDs for this client from social posts
      const { data: socialLinks } = await supabase
        .from("social")
        .select("id_distribution")
        .eq("id_client", clientId)
        .not("id_distribution", "is", null)
        .is("date_deleted", null);

      const distIds = Array.from(new Set((socialLinks || []).map((r: any) => r.id_distribution)));

      if (distIds.length > 0) {
        // Get the resource IDs from posting_distributions (these map to Late account IDs)
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
