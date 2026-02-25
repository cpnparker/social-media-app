import { NextRequest, NextResponse } from "next/server";
import { supabase } from "@/lib/supabase";
import { requireAuth, canAccessClient, isTCEStaff } from "@/lib/permissions";

// GET /api/customers/[id]
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

    // Validate access to this client
    if (!(await canAccessClient(userId, role, clientId))) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    const { data: client, error } = await supabase
      .from("clients")
      .select("*")
      .eq("id_client", clientId)
      .is("date_deleted", null)
      .single();

    if (error || !client) {
      return NextResponse.json({ error: "Customer not found" }, { status: 404 });
    }

    // Fetch contracts for this client
    const { data: clientContracts } = await supabase
      .from("app_contracts")
      .select("*")
      .eq("id_client", clientId)
      .order("date_start", { ascending: false });

    // Count content objects for this client
    const { count: contentCount } = await supabase
      .from("content")
      .select("*", { count: "exact", head: true })
      .eq("id_client", clientId)
      .is("date_deleted", null);

    const customer = {
      id: String(client.id_client),
      name: client.name_client,
      website: client.link_website,
      industry: client.information_industry,
      notes: client.information_description,
      guidelines: client.information_guidelines,
      status: "active",
      createdAt: client.date_created,
      updatedAt: client.date_updated,
      contracts: (clientContracts || []).map((c) => ({
        id: String(c.id_contract),
        name: c.name_contract,
        status: c.flag_active === 1 ? "active" : "inactive",
        totalContentUnits: Number(c.units_contract) || 0,
        usedContentUnits: Number(c.units_total_completed) || 0,
        startDate: c.date_start,
        endDate: c.date_end,
      })),
      contentCount: contentCount || 0,
    };

    return NextResponse.json({ customer });
  } catch (error: any) {
    console.error("Customer GET error:", error.message);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}

// PUT /api/customers/[id]
export async function PUT(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const authResult = await requireAuth();
  if (authResult instanceof NextResponse) return authResult;
  const { userId, role } = authResult;

  try {
    const { id } = await params;
    const clientId = parseInt(id, 10);

    if (!(await canAccessClient(userId, role, clientId))) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    const body = await req.json();

    const updateData: Record<string, any> = {
      date_updated: new Date().toISOString(),
    };

    if (body.name !== undefined) updateData.name_client = body.name;
    if (body.website !== undefined) updateData.link_website = body.website;
    if (body.industry !== undefined) updateData.information_industry = body.industry;
    if (body.notes !== undefined) updateData.information_description = body.notes;
    if (body.guidelines !== undefined) updateData.information_guidelines = body.guidelines;

    const { data: updated, error } = await supabase
      .from("clients")
      .update(updateData)
      .eq("id_client", clientId)
      .is("date_deleted", null)
      .select()
      .single();

    if (error || !updated) {
      return NextResponse.json({ error: "Customer not found" }, { status: 404 });
    }

    return NextResponse.json({
      customer: {
        id: String(updated.id_client),
        name: updated.name_client,
        website: updated.link_website,
        industry: updated.information_industry,
        notes: updated.information_description,
        status: "active",
        updatedAt: updated.date_updated,
      },
    });
  } catch (error: any) {
    console.error("Customer PUT error:", error.message);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}

// DELETE /api/customers/[id] — soft delete (TCE staff only)
export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const authResult = await requireAuth();
  if (authResult instanceof NextResponse) return authResult;
  const { role } = authResult;

  if (!isTCEStaff(role)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  try {
    const { id } = await params;
    const clientId = parseInt(id, 10);

    // Check for active contracts
    const { count: activeContracts } = await supabase
      .from("contracts")
      .select("*", { count: "exact", head: true })
      .eq("id_client", clientId)
      .eq("flag_active", 1)
      .is("date_deleted", null);

    if ((activeContracts || 0) > 0) {
      return NextResponse.json(
        { error: "Cannot delete customer with active contracts" },
        { status: 400 }
      );
    }

    // Soft delete
    const { error } = await supabase
      .from("clients")
      .update({ date_deleted: new Date().toISOString() })
      .eq("id_client", clientId)
      .is("date_deleted", null);

    if (error) throw error;

    return NextResponse.json({ success: true });
  } catch (error: any) {
    console.error("Customer DELETE error:", error.message);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
