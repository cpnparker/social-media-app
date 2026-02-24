import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { customerMembers, customers, users, workspaceMembers } from "@/lib/db/schema";
import { eq, and } from "drizzle-orm";
import { auth } from "@/lib/auth";

// GET /api/customer-members?customerId=xxx — list members for a customer with user details
export async function GET(req: NextRequest) {
  try {
    const session = await auth();
    if (!session?.user?.id) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { searchParams } = new URL(req.url);
    const customerId = searchParams.get("customerId");

    if (!customerId) {
      return NextResponse.json(
        { error: "customerId query param is required" },
        { status: 400 }
      );
    }

    const members = await db
      .select({
        id: customerMembers.id,
        customerId: customerMembers.customerId,
        userId: customerMembers.userId,
        role: customerMembers.role,
        createdAt: customerMembers.createdAt,
        userName: users.name,
        userEmail: users.email,
        userAvatar: users.avatarUrl,
      })
      .from(customerMembers)
      .innerJoin(users, eq(customerMembers.userId, users.id))
      .where(eq(customerMembers.customerId, customerId));

    return NextResponse.json({ members });
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}

// POST /api/customer-members — assign user to customer
export async function POST(req: NextRequest) {
  try {
    const session = await auth();
    if (!session?.user?.id) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { customerId, email, role, name } = await req.json();

    if (!customerId || !email) {
      return NextResponse.json(
        { error: "customerId and email are required" },
        { status: 400 }
      );
    }

    const normalizedEmail = email.trim().toLowerCase();

    // Find or create the user
    let [existingUser] = await db
      .select()
      .from(users)
      .where(eq(users.email, normalizedEmail))
      .limit(1);

    if (!existingUser) {
      // Auto-create a new user with the provided email
      const namePart = normalizedEmail.split("@")[0].replace(/[._-]/g, " ");
      const displayName = name || namePart.replace(/\b\w/g, (c: string) => c.toUpperCase());

      const [newUser] = await db
        .insert(users)
        .values({
          email: normalizedEmail,
          name: displayName,
          provider: "email",
        })
        .returning();

      existingUser = newUser;

      // Also add the new user as a workspace member (viewer)
      const [customer] = await db
        .select({ workspaceId: customers.workspaceId })
        .from(customers)
        .where(eq(customers.id, customerId))
        .limit(1);

      if (customer) {
        const [existingWsMember] = await db
          .select()
          .from(workspaceMembers)
          .where(
            and(
              eq(workspaceMembers.workspaceId, customer.workspaceId),
              eq(workspaceMembers.userId, existingUser.id)
            )
          )
          .limit(1);

        if (!existingWsMember) {
          await db.insert(workspaceMembers).values({
            workspaceId: customer.workspaceId,
            userId: existingUser.id,
            role: "viewer",
          });
        }
      }
    }

    // Check if already a customer member
    const [existingMember] = await db
      .select()
      .from(customerMembers)
      .where(
        and(
          eq(customerMembers.customerId, customerId),
          eq(customerMembers.userId, existingUser.id)
        )
      )
      .limit(1);

    if (existingMember) {
      return NextResponse.json(
        { error: "User is already a member of this customer" },
        { status: 409 }
      );
    }

    const [member] = await db
      .insert(customerMembers)
      .values({
        customerId,
        userId: existingUser.id,
        role: role || "viewer",
      })
      .returning();

    return NextResponse.json({ member }, { status: 201 });
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}

// DELETE /api/customer-members?customerId=xxx&userId=yyy — remove user from customer
export async function DELETE(req: NextRequest) {
  try {
    const session = await auth();
    if (!session?.user?.id) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { searchParams } = new URL(req.url);
    const customerId = searchParams.get("customerId");
    const userId = searchParams.get("userId");

    if (!customerId || !userId) {
      return NextResponse.json(
        { error: "customerId and userId query params are required" },
        { status: 400 }
      );
    }

    const [deleted] = await db
      .delete(customerMembers)
      .where(
        and(
          eq(customerMembers.customerId, customerId),
          eq(customerMembers.userId, userId)
        )
      )
      .returning();

    if (!deleted) {
      return NextResponse.json({ error: "Member not found" }, { status: 404 });
    }

    return NextResponse.json({ success: true });
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
