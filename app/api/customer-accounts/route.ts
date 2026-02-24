import { NextRequest, NextResponse } from "next/server";
import { supabase } from "@/lib/supabase";
import { auth } from "@/lib/auth";

// GET /api/customer-accounts?customerId=xxx
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

    const { data: accounts, error } = await supabase
      .from("customer_accounts")
      .select("*")
      .eq("customer_id", parseInt(customerId, 10));

    if (error) throw error;

    return NextResponse.json({ accounts: accounts || [] });
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}

// POST /api/customer-accounts
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

    const { data: account, error } = await supabase
      .from("customer_accounts")
      .insert({
        customer_id: parseInt(customerId, 10),
        late_account_id: lateAccountId,
        platform,
        display_name: displayName,
        username: username || null,
        avatar_url: avatarUrl || null,
      })
      .select()
      .single();

    if (error) throw error;

    return NextResponse.json({ account }, { status: 201 });
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}

// DELETE /api/customer-accounts?customerId=xxx&lateAccountId=yyy
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

    const { error } = await supabase
      .from("customer_accounts")
      .delete()
      .eq("customer_id", parseInt(customerId, 10))
      .eq("late_account_id", lateAccountId);

    if (error) throw error;

    return NextResponse.json({ success: true });
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
