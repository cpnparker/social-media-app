import { NextRequest, NextResponse } from "next/server";
import { supabase } from "@/lib/supabase";
import { requireAuth, canAccessClient } from "@/lib/permissions";

// GET /api/customers/[id]/contracts
//
// Gated like every sibling in app/api/customers/. It previously had NO auth at
// all — no session check and no client-access check — while returning contract
// names, contracted and consumed unit volumes, and term dates for ANY client id
// passed in the path. Enumerating ids returned the whole book of business to an
// unauthenticated caller. The sibling route one directory up had both checks;
// this one was simply never given them.
export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const authResult = await requireAuth();
  if (authResult instanceof NextResponse) return authResult;
  const { userId, role } = authResult;

  try {
    const { id } = await params;
    const clientId = parseInt(id, 10);
    // Reject a non-numeric id before it reaches the query: parseInt("abc") is
    // NaN, and an eq() on NaN is a silently empty filter rather than an error.
    if (!Number.isFinite(clientId)) {
      return NextResponse.json({ error: "Invalid customer id" }, { status: 400 });
    }

    if (!(await canAccessClient(userId, role, clientId))) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    // Validate client exists
    const { data: client } = await supabase
      .from("clients")
      .select("id_client")
      .eq("id_client", clientId)
      .is("date_deleted", null)
      .single();

    if (!client) {
      return NextResponse.json({ error: "Customer not found" }, { status: 404 });
    }

    // Fetch contracts using the app view for denormalized data
    const { data: rows, error } = await supabase
      .from("app_contracts")
      .select("*")
      .eq("id_client", clientId)
      .order("date_start", { ascending: false });

    if (error) throw error;

    const contracts = (rows || []).map((c) => ({
      id: String(c.id_contract),
      customerId: String(c.id_client),
      name: c.name_contract,
      customerName: c.name_client,
      totalContentUnits: Number(c.units_contract) || 0,
      usedContentUnits: Number(c.units_total_completed) || 0,
      status: c.flag_active === 1 ? "active" : "inactive",
      startDate: c.date_start,
      endDate: c.date_end,
      createdAt: c.date_created,
    }));

    return NextResponse.json({ contracts });
  } catch (error: any) {
    console.error("Customer contracts GET error:", error.message);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
