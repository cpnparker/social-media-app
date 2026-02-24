import { NextRequest, NextResponse } from "next/server";
import { supabase } from "@/lib/supabase";

// Helper: snake_case → camelCase
function transformAccount(row: any) {
  return {
    id: row.id,
    teamId: row.team_id,
    lateAccountId: row.late_account_id,
    platform: row.platform,
    displayName: row.display_name,
    username: row.username,
    avatarUrl: row.avatar_url,
    createdAt: row.created_at,
  };
}

// GET /api/teams/[id]/accounts — list linked accounts
export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id: teamId } = await params;

    const { data: accounts, error } = await supabase
      .from("team_accounts")
      .select("*")
      .eq("team_id", teamId);

    if (error) throw error;

    return NextResponse.json({
      accounts: (accounts || []).map(transformAccount),
    });
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

    const { data: account, error } = await supabase
      .from("team_accounts")
      .insert({
        team_id: teamId,
        late_account_id: lateAccountId,
        platform,
        display_name: displayName,
        username: username || null,
        avatar_url: avatarUrl || null,
      })
      .select()
      .single();

    if (error) throw error;

    return NextResponse.json(
      { account: transformAccount(account) },
      { status: 201 }
    );
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

    const { error } = await supabase
      .from("team_accounts")
      .delete()
      .eq("id", accountId)
      .eq("team_id", teamId);

    if (error) throw error;

    return NextResponse.json({ success: true });
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
