import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { customers, customerMembers, workspaceMembers, workspaces } from "@/lib/db/schema";
import { eq, and } from "drizzle-orm";
import { auth } from "@/lib/auth";

// GET /api/me/customers — returns customers the authenticated user can access
export async function GET() {
  try {
    const session = await auth();
    if (!session?.user?.id) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    // Get the default workspace
    const [ws] = await db.select({ id: workspaces.id }).from(workspaces).limit(1);
    if (!ws) {
      return NextResponse.json({ customers: [], role: null, canViewAll: false });
    }

    // Get the user's workspace membership to determine role
    const [membership] = await db
      .select({ role: workspaceMembers.role })
      .from(workspaceMembers)
      .where(
        and(
          eq(workspaceMembers.workspaceId, ws.id),
          eq(workspaceMembers.userId, session.user.id)
        )
      )
      .limit(1);

    if (!membership) {
      return NextResponse.json({ customers: [], role: null, canViewAll: false });
    }

    const workspaceRole = membership.role;
    const canViewAll = workspaceRole === "owner" || workspaceRole === "admin";

    let customerList;

    if (canViewAll) {
      // Owner/admin can see all customers in the workspace
      customerList = await db
        .select({
          id: customers.id,
          name: customers.name,
          slug: customers.slug,
          status: customers.status,
          industry: customers.industry,
          logoUrl: customers.logoUrl,
        })
        .from(customers)
        .where(eq(customers.workspaceId, ws.id));
    } else {
      // Other roles can only see customers they are assigned to
      customerList = await db
        .select({
          id: customers.id,
          name: customers.name,
          slug: customers.slug,
          status: customers.status,
          industry: customers.industry,
          logoUrl: customers.logoUrl,
        })
        .from(customerMembers)
        .innerJoin(customers, eq(customerMembers.customerId, customers.id))
        .where(
          and(
            eq(customerMembers.userId, session.user.id),
            eq(customers.workspaceId, ws.id)
          )
        );
    }

    return NextResponse.json({
      customers: customerList,
      role: workspaceRole,
      canViewAll,
    });
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
