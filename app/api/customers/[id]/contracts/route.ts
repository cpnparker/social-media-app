import { NextRequest, NextResponse } from "next/server";
import { supabase } from "@/lib/supabase";

// GET /api/customers/[id]/contracts
export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const clientId = parseInt(id, 10);

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
