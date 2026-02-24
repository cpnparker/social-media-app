import { NextResponse } from "next/server";
import { supabase } from "@/lib/supabase";
import { resolveWorkspaceAndUser } from "@/lib/api-utils";

// GET /api/workspace/stats — get workspace overview statistics
export async function GET() {
  try {
    const { workspaceId } = await resolveWorkspaceAndUser();

    const [clientsRes, contractsRes, cuRes, membersRes, teamsRes] = await Promise.all([
      // Total clients (active)
      supabase
        .from("clients")
        .select("id_client", { count: "exact", head: true })
        .is("date_deleted", null),

      // Active contracts
      supabase
        .from("contracts")
        .select("id_contract", { count: "exact", head: true })
        .eq("flag_active", 1)
        .is("date_deleted", null),

      // CU budget from active contracts
      supabase
        .from("contracts")
        .select("units_contract")
        .eq("flag_active", 1)
        .is("date_deleted", null),

      // Total workspace members
      supabase
        .from("workspace_members")
        .select("id", { count: "exact", head: true })
        .eq("workspace_id", workspaceId),

      // Total teams
      supabase
        .from("teams")
        .select("id", { count: "exact", head: true })
        .eq("workspace_id", workspaceId),
    ]);

    const totalCUBudget = (cuRes.data || []).reduce(
      (sum, c) => sum + (Number(c.units_contract) || 0),
      0
    );

    return NextResponse.json({
      stats: {
        totalCustomers: clientsRes.count ?? 0,
        activeContracts: contractsRes.count ?? 0,
        totalCUBudget,
        usedCU: 0, // would need to aggregate from tasks
        totalUsers: membersRes.count ?? 0,
        totalTeams: teamsRes.count ?? 0,
      },
    });
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
