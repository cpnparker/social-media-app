import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { customers, contracts } from "@/lib/db/schema";
import { eq, and, desc } from "drizzle-orm";
import { resolveWorkspaceAndUser } from "@/lib/api-utils";

// GET /api/customers/[id]/contracts
export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const { workspaceId } = await resolveWorkspaceAndUser();

    // Validate customer exists and belongs to workspace
    const [customer] = await db
      .select()
      .from(customers)
      .where(and(eq(customers.id, id), eq(customers.workspaceId, workspaceId)))
      .limit(1);

    if (!customer) {
      return NextResponse.json({ error: "Customer not found" }, { status: 404 });
    }

    const customerContracts = await db
      .select()
      .from(contracts)
      .where(eq(contracts.customerId, id))
      .orderBy(desc(contracts.startDate));

    return NextResponse.json({ contracts: customerContracts });
  } catch (error: any) {
    console.error("Customer contracts GET error:", error.message);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
