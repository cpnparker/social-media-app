import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { customers, contracts } from "@/lib/db/schema";
import { eq, desc, sql, and, like } from "drizzle-orm";
import { resolveWorkspaceAndUser } from "@/lib/api-utils";

// GET /api/customers
export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const status = searchParams.get("status");
  const search = searchParams.get("search");
  const limit = parseInt(searchParams.get("limit") || "50");
  const offset = parseInt(searchParams.get("offset") || "0");

  try {
    const { workspaceId } = await resolveWorkspaceAndUser();

    const conditions: any[] = [eq(customers.workspaceId, workspaceId)];

    if (status) conditions.push(eq(customers.status, status as any));
    if (search) conditions.push(like(customers.name, `%${search}%`));

    const activeContractsSq = sql<number>`(SELECT count(*) FROM contracts WHERE contracts.customer_id = customers.id AND contracts.status = 'active')`.as("active_contracts");
    const totalBudgetSq = sql<number>`(SELECT coalesce(sum(contracts.total_content_units), 0) FROM contracts WHERE contracts.customer_id = customers.id AND contracts.status = 'active')`.as("total_budget");
    const usedBudgetSq = sql<number>`(SELECT coalesce(sum(contracts.used_content_units), 0) FROM contracts WHERE contracts.customer_id = customers.id AND contracts.status = 'active')`.as("used_budget");

    const rows = await db
      .select({
        id: customers.id,
        workspaceId: customers.workspaceId,
        name: customers.name,
        slug: customers.slug,
        logoUrl: customers.logoUrl,
        website: customers.website,
        primaryContactName: customers.primaryContactName,
        primaryContactEmail: customers.primaryContactEmail,
        industry: customers.industry,
        notes: customers.notes,
        status: customers.status,
        createdAt: customers.createdAt,
        updatedAt: customers.updatedAt,
        activeContracts: activeContractsSq,
        totalBudget: totalBudgetSq,
        usedBudget: usedBudgetSq,
      })
      .from(customers)
      .where(and(...conditions))
      .orderBy(desc(customers.createdAt))
      .limit(limit)
      .offset(offset);

    return NextResponse.json({ customers: rows });
  } catch (error: any) {
    console.error("Customers GET error:", error.message);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}

// POST /api/customers
export async function POST(req: NextRequest) {
  try {
    const body = await req.json();

    if (!body.name) {
      return NextResponse.json(
        { error: "name is required" },
        { status: 400 }
      );
    }

    const { workspaceId } = await resolveWorkspaceAndUser(body.workspaceId);

    const slug = body.name
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/(^-|-$)/g, "");

    const [customer] = await db
      .insert(customers)
      .values({
        workspaceId,
        name: body.name,
        slug,
        logoUrl: body.logoUrl || null,
        website: body.website || null,
        primaryContactName: body.primaryContactName || null,
        primaryContactEmail: body.primaryContactEmail || null,
        industry: body.industry || null,
        notes: body.notes || null,
        status: body.status || "active",
      })
      .returning();

    return NextResponse.json({ customer });
  } catch (error: any) {
    console.error("Customers POST error:", error.message);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
