import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { customers, contracts, contentObjects } from "@/lib/db/schema";
import { eq, and, desc, sql } from "drizzle-orm";
import { resolveWorkspaceAndUser } from "@/lib/api-utils";

// GET /api/customers/[id]
export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const { workspaceId } = await resolveWorkspaceAndUser();

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

    const [countRow] = await db
      .select({ count: sql<number>`count(*)` })
      .from(contentObjects)
      .where(eq(contentObjects.customerId, id));

    return NextResponse.json({
      customer: {
        ...customer,
        contracts: customerContracts,
        contentCount: Number(countRow?.count ?? 0),
      },
    });
  } catch (error: any) {
    console.error("Customer GET error:", error.message);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}

// PUT /api/customers/[id]
export async function PUT(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const body = await req.json();
    const { workspaceId } = await resolveWorkspaceAndUser();

    const updateData: any = { updatedAt: new Date() };
    const fields = [
      "name", "slug", "logoUrl", "website",
      "primaryContactName", "primaryContactEmail",
      "industry", "notes", "status",
    ];

    for (const field of fields) {
      if (body[field] !== undefined) updateData[field] = body[field];
    }

    const [updated] = await db
      .update(customers)
      .set(updateData)
      .where(and(eq(customers.id, id), eq(customers.workspaceId, workspaceId)))
      .returning();

    if (!updated) {
      return NextResponse.json({ error: "Customer not found" }, { status: 404 });
    }

    return NextResponse.json({ customer: updated });
  } catch (error: any) {
    console.error("Customer PUT error:", error.message);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}

// DELETE /api/customers/[id]
export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const { workspaceId } = await resolveWorkspaceAndUser();

    const [activeCount] = await db
      .select({ count: sql<number>`count(*)` })
      .from(contracts)
      .where(and(eq(contracts.customerId, id), eq(contracts.status, "active")));

    if (Number(activeCount?.count ?? 0) > 0) {
      return NextResponse.json(
        { error: "Cannot delete customer with active contracts" },
        { status: 400 }
      );
    }

    const [deleted] = await db
      .delete(customers)
      .where(and(eq(customers.id, id), eq(customers.workspaceId, workspaceId)))
      .returning();

    if (!deleted) {
      return NextResponse.json({ error: "Customer not found" }, { status: 404 });
    }

    return NextResponse.json({ success: true });
  } catch (error: any) {
    console.error("Customer DELETE error:", error.message);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
