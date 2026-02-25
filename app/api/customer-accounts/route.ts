import { NextRequest, NextResponse } from "next/server";
import { supabase } from "@/lib/supabase";
import { requireAuth, canAccessClient } from "@/lib/permissions";

// GET /api/customer-accounts?customerId=xxx
// Derives accounts from the existing social→posting_distributions relationship
export async function GET(req: NextRequest) {
  const authResult = await requireAuth();
  if (authResult instanceof NextResponse) return authResult;
  const { userId, role } = authResult;

  try {
    const { searchParams } = new URL(req.url);
    const customerId = searchParams.get("customerId");

    if (!customerId) {
      return NextResponse.json(
        { error: "customerId query param is required" },
        { status: 400 }
      );
    }

    const clientId = parseInt(customerId, 10);

    // Validate client access
    if (!(await canAccessClient(userId, role, clientId))) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    // Get distinct distribution channels used for this client's social posts
    const { data: socialLinks, error: socialErr } = await supabase
      .from("social")
      .select("id_distribution")
      .eq("id_client", clientId)
      .not("id_distribution", "is", null)
      .is("date_deleted", null);

    if (socialErr) throw socialErr;

    // Deduplicate distribution IDs
    const distIds = Array.from(new Set((socialLinks || []).map((r) => r.id_distribution)));

    if (distIds.length === 0) {
      return NextResponse.json({ accounts: [] });
    }

    // Fetch full distribution details
    const { data: distributions, error: distErr } = await supabase
      .from("posting_distributions")
      .select("id_distribution, network, name_resource, type_distribution, flag_active, id_resource")
      .in("id_distribution", distIds);

    if (distErr) throw distErr;

    const accounts = (distributions || []).map((d) => ({
      id: String(d.id_distribution),
      customerId: clientId,
      lateAccountId: d.id_resource ? String(d.id_resource) : String(d.id_distribution),
      platform: d.network,
      displayName: d.name_resource || d.network,
      username: null,
      avatarUrl: null,
      type: d.type_distribution,
      isActive: d.flag_active === 1,
    }));

    return NextResponse.json({ accounts });
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}

// POST /api/customer-accounts
export async function POST(req: NextRequest) {
  const authResult = await requireAuth();
  if (authResult instanceof NextResponse) return authResult;
  const { userId, role } = authResult;

  try {
    const { customerId, lateAccountId, platform, displayName, username, avatarUrl } =
      await req.json();

    if (!customerId || !lateAccountId || !platform || !displayName) {
      return NextResponse.json(
        { error: "customerId, lateAccountId, platform, and displayName are required" },
        { status: 400 }
      );
    }

    const clientId = parseInt(customerId, 10);

    if (!(await canAccessClient(userId, role, clientId))) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    const { data: account, error } = await supabase
      .from("customer_accounts")
      .insert({
        customer_id: clientId,
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
  const authResult = await requireAuth();
  if (authResult instanceof NextResponse) return authResult;
  const { userId, role } = authResult;

  try {
    const { searchParams } = new URL(req.url);
    const customerId = searchParams.get("customerId");
    const lateAccountId = searchParams.get("lateAccountId");

    if (!customerId || !lateAccountId) {
      return NextResponse.json(
        { error: "customerId and lateAccountId query params are required" },
        { status: 400 }
      );
    }

    const clientId = parseInt(customerId, 10);

    if (!(await canAccessClient(userId, role, clientId))) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    const { error } = await supabase
      .from("customer_accounts")
      .delete()
      .eq("customer_id", clientId)
      .eq("late_account_id", lateAccountId);

    if (error) throw error;

    return NextResponse.json({ success: true });
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
