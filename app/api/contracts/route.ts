import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { contracts, customers } from "@/lib/db/schema";
import { eq, and, sql, desc } from "drizzle-orm";
import { resolveWorkspaceAndUser } from "@/lib/api-utils";
import { calculateRollover } from "@/lib/contract-utils";

// GET /api/contracts
export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const customerId = searchParams.get("customerId");
  const status = searchParams.get("status");
  const limit = parseInt(searchParams.get("limit") || "50");

  try {
    const { workspaceId } = await resolveWorkspaceAndUser();

    const conditions: any[] = [eq(contracts.workspaceId, workspaceId)];

    if (customerId) conditions.push(eq(contracts.customerId, customerId));
    if (status) conditions.push(eq(contracts.status, status as any));

    const customerNameSq = sql<string>`(SELECT name FROM customers WHERE customers.id = contracts.customer_id)`.as("customer_name");

    const rows = await db
      .select({
        id: contracts.id,
        customerId: contracts.customerId,
        workspaceId: contracts.workspaceId,
        name: contracts.name,
        totalContentUnits: contracts.totalContentUnits,
        usedContentUnits: contracts.usedContentUnits,
        rolloverUnits: contracts.rolloverUnits,
        monthlyFee: contracts.monthlyFee,
        status: contracts.status,
        startDate: contracts.startDate,
        endDate: contracts.endDate,
        renewalDate: contracts.renewalDate,
        notes: contracts.notes,
        createdAt: contracts.createdAt,
        updatedAt: contracts.updatedAt,
        customerName: customerNameSq,
      })
      .from(contracts)
      .where(and(...conditions))
      .orderBy(desc(contracts.startDate))
      .limit(limit);

    return NextResponse.json({ contracts: rows });
  } catch (error: any) {
    console.error("Contracts GET error:", error.message);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}

// POST /api/contracts
export async function POST(req: NextRequest) {
  try {
    const body = await req.json();

    const { customerId, name, totalContentUnits, startDate, endDate } = body;

    if (!customerId || !name || !totalContentUnits || !startDate || !endDate) {
      return NextResponse.json(
        { error: "customerId, name, totalContentUnits, startDate, and endDate are required" },
        { status: 400 }
      );
    }

    const { workspaceId } = await resolveWorkspaceAndUser();

    // Validate customer exists and belongs to workspace
    const [customer] = await db
      .select({ id: customers.id })
      .from(customers)
      .where(and(eq(customers.id, customerId), eq(customers.workspaceId, workspaceId)));

    if (!customer) {
      return NextResponse.json(
        { error: "Customer not found or does not belong to this workspace" },
        { status: 404 }
      );
    }

    // Auto-calculate rollover from most recent completed contract for this customer
    let rolloverUnits = 0;

    const [previousContract] = await db
      .select({
        totalContentUnits: contracts.totalContentUnits,
        usedContentUnits: contracts.usedContentUnits,
      })
      .from(contracts)
      .where(
        and(
          eq(contracts.customerId, customerId),
          eq(contracts.workspaceId, workspaceId),
          eq(contracts.status, "completed")
        )
      )
      .orderBy(desc(contracts.endDate))
      .limit(1);

    if (previousContract) {
      rolloverUnits = calculateRollover({
        totalContentUnits: previousContract.totalContentUnits,
        usedContentUnits: previousContract.usedContentUnits,
      });
    }

    const [contract] = await db
      .insert(contracts)
      .values({
        customerId,
        workspaceId,
        name,
        totalContentUnits,
        rolloverUnits,
        monthlyFee: body.monthlyFee ?? null,
        status: body.status || "draft",
        startDate: new Date(startDate),
        endDate: new Date(endDate),
        renewalDate: body.renewalDate ? new Date(body.renewalDate) : null,
        notes: body.notes ?? null,
      })
      .returning();

    return NextResponse.json(
      { contract, rolloverApplied: rolloverUnits > 0 },
      { status: 201 }
    );
  } catch (error: any) {
    console.error("Contracts POST error:", error.message);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
