import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { customers, contracts, workspaceMembers, teams } from "@/lib/db/schema";
import { eq, and, count, sum } from "drizzle-orm";
import { resolveWorkspaceAndUser } from "@/lib/api-utils";

// GET /api/workspace/stats — get workspace overview statistics
export async function GET() {
  try {
    const { workspaceId } = await resolveWorkspaceAndUser();

    const [
      [customerCount],
      [activeContractCount],
      [cuBudget],
      [userCount],
      [teamCount],
    ] = await Promise.all([
      // Total customers
      db
        .select({ value: count() })
        .from(customers)
        .where(eq(customers.workspaceId, workspaceId)),

      // Active contracts
      db
        .select({ value: count() })
        .from(contracts)
        .where(
          and(
            eq(contracts.workspaceId, workspaceId),
            eq(contracts.status, "active")
          )
        ),

      // CU budget and used from active contracts
      db
        .select({
          totalBudget: sum(contracts.totalContentUnits),
          totalUsed: sum(contracts.usedContentUnits),
        })
        .from(contracts)
        .where(
          and(
            eq(contracts.workspaceId, workspaceId),
            eq(contracts.status, "active")
          )
        ),

      // Total workspace members (users)
      db
        .select({ value: count() })
        .from(workspaceMembers)
        .where(eq(workspaceMembers.workspaceId, workspaceId)),

      // Total teams
      db
        .select({ value: count() })
        .from(teams)
        .where(eq(teams.workspaceId, workspaceId)),
    ]);

    return NextResponse.json({
      stats: {
        totalCustomers: customerCount?.value ?? 0,
        activeContracts: activeContractCount?.value ?? 0,
        totalCUBudget: Number(cuBudget?.totalBudget) || 0,
        usedCU: Number(cuBudget?.totalUsed) || 0,
        totalUsers: userCount?.value ?? 0,
        totalTeams: teamCount?.value ?? 0,
      },
    });
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
