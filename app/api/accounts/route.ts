import { NextRequest, NextResponse } from "next/server";
import { lateApiFetch } from "@/lib/late";
import { db } from "@/lib/db";
import { customerAccounts } from "@/lib/db/schema";
import { eq } from "drizzle-orm";

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

    // If customerId is provided, filter accounts to only those assigned to the customer
    if (customerId) {
      const assignedRows = await db
        .select({ lateAccountId: customerAccounts.lateAccountId })
        .from(customerAccounts)
        .where(eq(customerAccounts.customerId, customerId));

      const assignedIds = new Set(assignedRows.map((r) => r.lateAccountId));
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
