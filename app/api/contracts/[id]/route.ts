import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { contracts, customers, contentObjects } from "@/lib/db/schema";
import { eq, and } from "drizzle-orm";
import { resolveWorkspaceAndUser } from "@/lib/api-utils";

// GET /api/contracts/[id]
export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const { workspaceId } = await resolveWorkspaceAndUser();

    // Fetch contract
    const [contract] = await db
      .select()
      .from(contracts)
      .where(and(eq(contracts.id, id), eq(contracts.workspaceId, workspaceId)));

    if (!contract) {
      return NextResponse.json({ error: "Contract not found" }, { status: 404 });
    }

    // Fetch customer record
    const [customer] = await db
      .select()
      .from(customers)
      .where(eq(customers.id, contract.customerId));

    // Fetch content objects linked to this contract
    const linkedContentObjects = await db
      .select()
      .from(contentObjects)
      .where(eq(contentObjects.contractId, id));

    return NextResponse.json({
      contract,
      customer: customer || null,
      contentObjects: linkedContentObjects,
    });
  } catch (error: any) {
    console.error("Contract GET error:", error.message);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}

// PUT /api/contracts/[id]
export async function PUT(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const body = await req.json();
    const { workspaceId } = await resolveWorkspaceAndUser();

    // Verify contract exists and belongs to workspace
    const [existing] = await db
      .select({ id: contracts.id })
      .from(contracts)
      .where(and(eq(contracts.id, id), eq(contracts.workspaceId, workspaceId)));

    if (!existing) {
      return NextResponse.json({ error: "Contract not found" }, { status: 404 });
    }

    // Build update data field-by-field
    const updateData: Record<string, any> = {};

    if (body.name !== undefined) updateData.name = body.name;
    if (body.totalContentUnits !== undefined) updateData.totalContentUnits = body.totalContentUnits;
    if (body.usedContentUnits !== undefined) updateData.usedContentUnits = body.usedContentUnits;
    if (body.rolloverUnits !== undefined) updateData.rolloverUnits = body.rolloverUnits;
    if (body.monthlyFee !== undefined) updateData.monthlyFee = body.monthlyFee;
    if (body.status !== undefined) updateData.status = body.status;
    if (body.startDate !== undefined) updateData.startDate = new Date(body.startDate);
    if (body.endDate !== undefined) updateData.endDate = new Date(body.endDate);
    if (body.renewalDate !== undefined) updateData.renewalDate = new Date(body.renewalDate);
    if (body.notes !== undefined) updateData.notes = body.notes;

    // Always set updatedAt
    updateData.updatedAt = new Date();

    const [contract] = await db
      .update(contracts)
      .set(updateData)
      .where(and(eq(contracts.id, id), eq(contracts.workspaceId, workspaceId)))
      .returning();

    return NextResponse.json({ contract });
  } catch (error: any) {
    console.error("Contract PUT error:", error.message);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
