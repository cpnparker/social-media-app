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

    // If customerId is provided, filter accounts to only those assigned
    if (customerId) {
      const { data: assignedRows } = await supabase
        .from("customer_accounts")
        .select("late_account_id")
        .eq("customer_id", parseInt(customerId, 10));

      const assignedIds = new Set((assignedRows || []).map((r: any) => r.late_account_id));
      accounts = accounts.filter((a: any) => assignedIds.has(a._id || a.id));
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
