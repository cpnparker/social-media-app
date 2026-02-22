import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { teamAccounts } from "@/lib/db/schema";
import { eq, and } from "drizzle-orm";

// GET /api/teams/[id]/accounts — list linked accounts
export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id: teamId } = await params;

    const accounts = await db
      .select()
      .from(teamAccounts)
      .where(eq(teamAccounts.teamId, teamId));

    return NextResponse.json({ accounts });
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}

// POST /api/teams/[id]/accounts — link an account to team
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id: teamId } = await params;
    const body = await req.json();
    const { lateAccountId, platform, displayName, username, avatarUrl } = body;

    if (!lateAccountId || !platform || !displayName) {
      return NextResponse.json(
        { error: "lateAccountId, platform, and displayName are required" },
        { status: 400 }
      );
    }

    const [account] = await db
      .insert(teamAccounts)
      .values({
        teamId,
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

// DELETE /api/teams/[id]/accounts — unlink account
export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id: teamId } = await params;
    const { searchParams } = new URL(req.url);
    const accountId = searchParams.get("accountId");

    if (!accountId) {
      return NextResponse.json(
        { error: "accountId query param is required" },
        { status: 400 }
      );
    }

    const [deleted] = await db
      .delete(teamAccounts)
      .where(
        and(
          eq(teamAccounts.id, accountId),
          eq(teamAccounts.teamId, teamId)
        )
      )
      .returning();

    if (!deleted) {
      return NextResponse.json(
        { error: "Account link not found" },
        { status: 404 }
      );
    }

    return NextResponse.json({ success: true });
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
