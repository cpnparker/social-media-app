import { NextRequest, NextResponse } from "next/server";
import { supabase } from "@/lib/supabase";
import { requireAuth, canAccessClient } from "@/lib/permissions";

// GET /api/ideas/[id]
export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const authResult = await requireAuth();
  if (authResult instanceof NextResponse) return authResult;
  const { userId, role } = authResult;

  try {
    const { id } = await params;
    const ideaId = parseInt(id, 10);

    const { data: idea, error } = await supabase
      .from("app_ideas")
      .select("*")
      .eq("id_idea", ideaId)
      .single();

    if (error || !idea) {
      return NextResponse.json({ error: "Idea not found" }, { status: 404 });
    }

    // Validate client access
    if (idea.id_client && !(await canAccessClient(userId, role, idea.id_client))) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    let customer = null;
    if (idea.id_client) {
      const { data: c } = await supabase
        .from("clients")
        .select("id_client, name_client")
        .eq("id_client", idea.id_client)
        .is("date_deleted", null)
        .single();
      if (c) customer = { id: String(c.id_client), name: c.name_client };
    }

    // Construct imageUrl: check 'creation' column (new uploads) + files join (legacy)
    let imageUrl: string | null = null;
    // Legacy: Supabase storage via files table join
    if (idea.file_path) {
      imageUrl = idea.file_path.startsWith("http")
        ? idea.file_path
        : idea.file_bucket
          ? `https://dcwodczzdeltxlyepxmc.supabase.co/storage/v1/object/public/${idea.file_bucket}/${idea.file_path}`
          : null;
    }
    // New: external URL stored in 'id_airtable' column (unused legacy field)
    if (!imageUrl) {
      const { data: raw } = await supabase
        .from("ideas")
        .select("id_airtable")
        .eq("id_idea", ideaId)
        .single();
      if (raw?.id_airtable?.startsWith("http")) {
        imageUrl = raw.id_airtable;
      }
    }

    return NextResponse.json({
      idea: {
        id: String(idea.id_idea),
        title: idea.name_idea,
        description: idea.information_brief,
        notes: idea.information_notes,
        status: idea.status,
        customerId: idea.id_client ? String(idea.id_client) : null,
        customerName: idea.name_client,
        topicTags: idea.name_topic_array || [],
        strategicTags: idea.name_campaign_array || [],
        eventTags: idea.name_event_array || [],
        imageUrl,
        linkUrl: idea.link_url,
        createdAt: idea.date_created,
        commissionedAt: idea.date_commissioned,
      },
      customer,
      contentObjectCount: (idea.id_content || []).length,
      contentObjects: (idea.id_content || []).map((cId: number, i: number) => ({
        id: String(cId),
        workingTitle: idea.name_content_content?.[i] || null,
        contentType: idea.type_content_content?.[i] || null,
      })),
    });
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}

// PUT /api/ideas/[id]
export async function PUT(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const authResult = await requireAuth();
  if (authResult instanceof NextResponse) return authResult;
  const { userId, role } = authResult;

  try {
    const { id } = await params;
    const ideaId = parseInt(id, 10);

    // Check access via the idea's client
    const { data: existing } = await supabase
      .from("ideas")
      .select("id_client, id_file")
      .eq("id_idea", ideaId)
      .is("date_deleted", null)
      .single();

    if (!existing) {
      return NextResponse.json({ error: "Idea not found" }, { status: 404 });
    }

    if (existing.id_client && !(await canAccessClient(userId, role, existing.id_client))) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    const body = await req.json();

    const updateData: Record<string, any> = { date_updated: new Date().toISOString() };

    if (body.title !== undefined) updateData.name_idea = body.title;
    if (body.description !== undefined) updateData.information_brief = body.description;
    if (body.status !== undefined) updateData.status = body.status;
    if (body.linkUrl !== undefined) updateData.link_url = body.linkUrl;
    if (body.notes !== undefined) updateData.information_notes = body.notes;
    if (body.customerId !== undefined) {
      updateData.id_client = body.customerId ? parseInt(body.customerId, 10) : null;
    }
    if (body.status === "commissioned") {
      updateData.flag_commissioned = 1;
      updateData.date_commissioned = new Date().toISOString();
    }
    if (body.status === "spiked") {
      updateData.flag_spiked = 1;
      updateData.date_spiked = new Date().toISOString();
    }

    // Handle imageUrl: store in 'id_airtable' column (unused legacy text field)
    if (body.imageUrl !== undefined) {
      updateData.id_airtable = body.imageUrl || null;
    }

    const { data: updated, error } = await supabase
      .from("ideas")
      .update(updateData)
      .eq("id_idea", ideaId)
      .is("date_deleted", null)
      .select()
      .single();

    if (error || !updated) {
      return NextResponse.json({ error: "Idea not found" }, { status: 404 });
    }

    return NextResponse.json({
      idea: {
        id: String(updated.id_idea),
        title: updated.name_idea,
        description: updated.information_brief,
        status: updated.status,
        customerId: updated.id_client ? String(updated.id_client) : null,
        updatedAt: updated.date_updated,
      },
    });
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}

// DELETE /api/ideas/[id]
export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const authResult = await requireAuth();
  if (authResult instanceof NextResponse) return authResult;
  const { userId, role } = authResult;

  try {
    const { id } = await params;
    const ideaId = parseInt(id, 10);

    // Check access
    const { data: existing } = await supabase
      .from("ideas")
      .select("id_client")
      .eq("id_idea", ideaId)
      .is("date_deleted", null)
      .single();

    if (existing?.id_client && !(await canAccessClient(userId, role, existing.id_client))) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    const { count } = await supabase
      .from("content")
      .select("*", { count: "exact", head: true })
      .eq("id_idea", ideaId)
      .is("date_deleted", null);

    if ((count || 0) > 0) {
      return NextResponse.json(
        { error: "Cannot delete idea with linked content objects" },
        { status: 400 }
      );
    }

    await supabase
      .from("ideas")
      .update({ date_deleted: new Date().toISOString() })
      .eq("id_idea", ideaId)
      .is("date_deleted", null);

    return NextResponse.json({ success: true });
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
