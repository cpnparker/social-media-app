import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { customerAccounts } from "@/lib/db/schema";
import { eq, and } from "drizzle-orm";
import { auth } from "@/lib/auth";

// GET /api/customer-accounts?customerId=xxx — list social accounts assigned to a customer
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

    const accounts = await db
      .select()
      .from(customerAccounts)
      .where(eq(customerAccounts.customerId, customerId));

    return NextResponse.json({ accounts });
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}

// POST /api/customer-accounts — assign account to customer
export async function POST(req: NextRequest) {
  try {
    const session = await auth();
    if (!session?.user?.id) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { customerId, lateAccountId, platform, displayName, username, avatarUrl } =
      await req.json();

    if (!customerId || !lateAccountId || !platform || !displayName) {
      return NextResponse.json(
        { error: "customerId, lateAccountId, platform, and displayName are required" },
        { status: 400 }
      );
    }

    const [account] = await db
      .insert(customerAccounts)
      .values({
        customerId,
        lateAccountId,
        platform,
        displayName,
        username: username || null,
        avatarUrl: avatarUrl || null,
      })
      .returning();

    return NextResponse.json({ account }, { status: 201 });
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}

// DELETE /api/customer-accounts?customerId=xxx&lateAccountId=yyy — unassign account
export async function DELETE(req: NextRequest) {
  try {
    const session = await auth();
    if (!session?.user?.id) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { searchParams } = new URL(req.url);
    const customerId = searchParams.get("customerId");
    const lateAccountId = searchParams.get("lateAccountId");

    if (!customerId || !lateAccountId) {
      return NextResponse.json(
        { error: "customerId and lateAccountId query params are required" },
        { status: 400 }
      );
    }

    const [deleted] = await db
      .delete(customerAccounts)
      .where(
        and(
          eq(customerAccounts.customerId, customerId),
          eq(customerAccounts.lateAccountId, lateAccountId)
        )
      )
      .returning();

    if (!deleted) {
      return NextResponse.json({ error: "Account not found" }, { status: 404 });
    }

    return NextResponse.json({ success: true });
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
