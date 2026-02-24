import { NextRequest, NextResponse } from "next/server";
import { supabase } from "@/lib/supabase";

// GET /api/contracts/[id]
export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const contractId = parseInt(id, 10);

    // Fetch contract via app view
    const { data: contract, error } = await supabase
      .from("app_contracts")
      .select("*")
      .eq("id_contract", contractId)
      .single();

    if (error || !contract) {
      return NextResponse.json({ error: "Contract not found" }, { status: 404 });
    }

    // Fetch client
    const { data: client } = await supabase
      .from("clients")
      .select("*")
      .eq("id_client", contract.id_client)
      .is("date_deleted", null)
      .single();

    // Fetch content linked to this contract
    const { data: linkedContent } = await supabase
      .from("content")
      .select("id_content, name_content, type_content, flag_completed, date_created")
      .eq("id_contract", contractId)
      .is("date_deleted", null);

    return NextResponse.json({
      contract: {
        id: String(contract.id_contract),
        customerId: String(contract.id_client),
        name: contract.name_contract,
        customerName: contract.name_client,
        totalContentUnits: Number(contract.units_contract) || 0,
        usedContentUnits: Number(contract.units_total_completed) || 0,
        status: contract.flag_active === 1 ? "active" : "inactive",
        startDate: contract.date_start,
        endDate: contract.date_end,
        notes: contract.information_notes,
        createdAt: contract.date_created,
      },
      customer: client ? {
        id: String(client.id_client),
        name: client.name_client,
      } : null,
      contentObjects: (linkedContent || []).map((c) => ({
        id: String(c.id_content),
        workingTitle: c.name_content,
        contentType: c.type_content,
        status: c.flag_completed === 1 ? "published" : "draft",
        createdAt: c.date_created,
      })),
    });
  } catch (error: any) {
    console.error("Contract GET error:", error.message);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}

// PUT /api/contracts/[id]
export async function PUT(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const contractId = parseInt(id, 10);
    const body = await req.json();

    const updateData: Record<string, any> = {
      date_updated: new Date().toISOString(),
    };

    if (body.name !== undefined) updateData.name_contract = body.name;
    if (body.totalContentUnits !== undefined) updateData.units_contract = body.totalContentUnits;
    if (body.status !== undefined) updateData.flag_active = body.status === "active" ? 1 : 0;
    if (body.startDate !== undefined) updateData.date_start = body.startDate;
    if (body.endDate !== undefined) updateData.date_end = body.endDate;
    if (body.notes !== undefined) updateData.information_notes = body.notes;

    const { data: updated, error } = await supabase
      .from("contracts")
      .update(updateData)
      .eq("id_contract", contractId)
      .is("date_deleted", null)
      .select()
      .single();

    if (error || !updated) {
      return NextResponse.json({ error: "Contract not found" }, { status: 404 });
    }

    return NextResponse.json({
      contract: {
        id: String(updated.id_contract),
        name: updated.name_contract,
        totalContentUnits: Number(updated.units_contract) || 0,
        status: updated.flag_active === 1 ? "active" : "inactive",
        startDate: updated.date_start,
        endDate: updated.date_end,
      },
    });
  } catch (error: any) {
    console.error("Contract PUT error:", error.message);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
