import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { customerMembers, customers } from "@/lib/db/schema";
import { eq } from "drizzle-orm";
import { resolveWorkspaceAndUser } from "@/lib/api-utils";

// GET /api/workspace/customer-assignments — all customer-member mappings for the workspace
export async function GET() {
  try {
    const { workspaceId } = await resolveWorkspaceAndUser();

    const assignments = await db
      .select({
        userId: customerMembers.userId,
        customerId: customerMembers.customerId,
        customerName: customers.name,
        role: customerMembers.role,
      })
      .from(customerMembers)
      .innerJoin(customers, eq(customerMembers.customerId, customers.id))
      .where(eq(customers.workspaceId, workspaceId));

    return NextResponse.json({ assignments });
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
