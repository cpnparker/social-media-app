import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { intelligenceDb } from "@/lib/supabase-intelligence";
import { verifyWorkspaceMembership } from "@/lib/permissions";

// GET /api/rfp/opportunities/[id]
export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const userId = parseInt(session.user.id, 10);
  const { id } = await params;

  try {
    const { data, error } = await intelligenceDb
      .from("rfp_opportunities")
      .select("*")
      .eq("id_opportunity", id)
      .single();

    if (error || !data) {
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    }

    const memberRole = await verifyWorkspaceMembership(userId, data.id_workspace);
    if (!memberRole) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    return NextResponse.json({ opportunity: data });
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}

// PATCH /api/rfp/opportunities/[id] — update status, notes, deadlines
export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const userId = parseInt(session.user.id, 10);
  const { id } = await params;

  try {
    const { data: opp } = await intelligenceDb
      .from("rfp_opportunities")
      .select("id_workspace")
      .eq("id_opportunity", id)
      .single();

    if (!opp) {
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    }

    const memberRole = await verifyWorkspaceMembership(userId, opp.id_workspace);
    if (!memberRole) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    const body = await req.json();
    const updates: any = { date_updated: new Date().toISOString() };

    if (body.status) updates.type_status = body.status;
    if (body.notes !== undefined) updates.document_notes = body.notes;
    if (body.deadlines !== undefined) updates.config_deadlines = body.deadlines;
    if (body.deadline !== undefined) updates.date_deadline = body.deadline;

    const { data, error } = await intelligenceDb
      .from("rfp_opportunities")
      .update(updates)
      .eq("id_opportunity", id)
      .select()
      .single();

    if (error) throw error;

    return NextResponse.json({ opportunity: data });
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}

// DELETE /api/rfp/opportunities/[id]
export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const userId = parseInt(session.user.id, 10);
  const { id } = await params;

  try {
    const { data: opp } = await intelligenceDb
      .from("rfp_opportunities")
      .select("id_workspace")
      .eq("id_opportunity", id)
      .single();

    if (!opp) {
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    }

    const memberRole = await verifyWorkspaceMembership(userId, opp.id_workspace);
    if (!memberRole) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    const { error } = await intelligenceDb
      .from("rfp_opportunities")
      .delete()
      .eq("id_opportunity", id);

    if (error) throw error;

    return NextResponse.json({ success: true });
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
