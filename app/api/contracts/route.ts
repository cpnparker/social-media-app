import { NextRequest, NextResponse } from "next/server";
import { supabase } from "@/lib/supabase";

// GET /api/contracts
export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const customerId = searchParams.get("customerId");
  const status = searchParams.get("status");
  const limit = parseInt(searchParams.get("limit") || "50");

  try {
    let query = supabase
      .from("app_contracts")
      .select("*")
      .order("date_start", { ascending: false })
      .limit(limit);

    if (customerId) query = query.eq("id_client", parseInt(customerId, 10));
    if (status === "active") query = query.eq("flag_active", 1);
    if (status === "inactive") query = query.eq("flag_active", 0);

    const { data: rows, error } = await query;
    if (error) throw error;

    const contracts = (rows || []).map((c) => ({
      id: String(c.id_contract),
      customerId: String(c.id_client),
      name: c.name_contract,
      customerName: c.name_client,
      totalContentUnits: Number(c.units_contract) || 0,
      usedContentUnits: Number(c.units_total_completed) || 0,
      rolloverUnits: 0,
      status: c.flag_active === 1 ? "active" : "inactive",
      startDate: c.date_start,
      endDate: c.date_end,
      notes: c.information_notes,
      createdAt: c.date_created,
    }));

    return NextResponse.json({ contracts });
  } catch (error: any) {
    console.error("Contracts GET error:", error.message);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}

// POST /api/contracts
export async function POST(req: NextRequest) {
  try {
    const body = await req.json();

    const { customerId, name, totalContentUnits, startDate, endDate } = body;

    if (!customerId || !name || !totalContentUnits || !startDate || !endDate) {
      return NextResponse.json(
        { error: "customerId, name, totalContentUnits, startDate, and endDate are required" },
        { status: 400 }
      );
    }

    const clientId = parseInt(customerId, 10);

    // Validate client exists
    const { data: client } = await supabase
      .from("clients")
      .select("id_client")
      .eq("id_client", clientId)
      .is("date_deleted", null)
      .single();

    if (!client) {
      return NextResponse.json(
        { error: "Customer not found" },
        { status: 404 }
      );
    }

    const { data: contract, error } = await supabase
      .from("contracts")
      .insert({
        id_client: clientId,
        name_contract: name,
        units_contract: totalContentUnits,
        flag_active: body.status === "active" ? 1 : 0,
        date_start: startDate,
        date_end: endDate,
        information_notes: body.notes || null,
        date_created: new Date().toISOString(),
      })
      .select()
      .single();

    if (error) throw error;

    return NextResponse.json({
      contract: {
        id: String(contract.id_contract),
        customerId: String(contract.id_client),
        name: contract.name_contract,
        totalContentUnits: Number(contract.units_contract) || 0,
        status: contract.flag_active === 1 ? "active" : "inactive",
        startDate: contract.date_start,
        endDate: contract.date_end,
      },
    }, { status: 201 });
  } catch (error: any) {
    console.error("Contracts POST error:", error.message);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
