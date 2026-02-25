import { NextRequest, NextResponse } from "next/server";
import { supabase } from "@/lib/supabase";
import { requireAuth, canAccessClient } from "@/lib/permissions";

// GET /api/content-objects/[id]
export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const authResult = await requireAuth();
  if (authResult instanceof NextResponse) return authResult;
  const { userId, role } = authResult;

  try {
    const { id } = await params;
    const contentId = parseInt(id, 10);

    const { data: obj, error } = await supabase
      .from("app_content")
      .select("*")
      .eq("id_content", contentId)
      .single();

    if (error || !obj) {
      return NextResponse.json({ error: "Content object not found" }, { status: 404 });
    }

    // Validate client access
    if (obj.id_client && !(await canAccessClient(userId, role, obj.id_client))) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    // Fetch tasks for this content
    const { data: tasks } = await supabase
      .from("app_tasks_content")
      .select("*")
      .eq("id_content", contentId)
      .order("order_sort", { ascending: true });

    // Fetch linked social posts
    const { data: linkedSocial } = await supabase
      .from("social")
      .select("id_social, name_social, network, type_post, date_created")
      .eq("id_content", contentId)
      .is("date_deleted", null);

    // Fetch idea if linked
    let idea = null;
    if (obj.id_idea) {
      const { data: i } = await supabase
        .from("ideas")
        .select("id_idea, name_idea, status")
        .eq("id_idea", obj.id_idea)
        .is("date_deleted", null)
        .single();
      if (i) idea = { id: String(i.id_idea), title: i.name_idea, status: i.status };
    }

    return NextResponse.json({
      contentObject: {
        id: String(obj.id_content),
        ideaId: obj.id_idea ? String(obj.id_idea) : null,
        contentType: obj.type_content,
        workingTitle: obj.name_content,
        body: obj.document_body,
        brief: obj.information_brief,
        status: obj.flag_completed === 1 ? "published" : obj.flag_spiked === 1 ? "spiked" : "draft",
        customerId: obj.id_client ? String(obj.id_client) : null,
        customerName: obj.name_client,
        contractId: obj.id_contract ? String(obj.id_contract) : null,
        contentUnits: Number(obj.units_content) || 0,
        topicTags: obj.name_topic_array || [],
        campaignTags: obj.name_campaign_array || [],
        createdAt: obj.date_created,
        completedAt: obj.date_completed,
      },
      idea,
      tasks: (tasks || []).map((t) => ({
        id: String(t.id_task),
        title: t.type_task,
        status: t.date_completed ? "done" : t.flag_spiked === 1 ? "cancelled" : "todo",
        assignedTo: t.id_user_assignee ? String(t.id_user_assignee) : null,
        assignedToName: t.name_user_assignee,
        sortOrder: t.order_sort,
        createdAt: t.date_created,
        completedAt: t.date_completed,
      })),
      posts: (linkedSocial || []).map((s) => ({
        id: String(s.id_social),
        content: s.name_social,
        platform: s.network,
        status: "draft",
        createdAt: s.date_created,
      })),
      performance: null,
      promoDrafts: [],
    });
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}

// PUT /api/content-objects/[id]
export async function PUT(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const authResult = await requireAuth();
  if (authResult instanceof NextResponse) return authResult;
  const { userId, role } = authResult;

  try {
    const { id } = await params;
    const contentId = parseInt(id, 10);

    // Fetch the content object to check client access
    const { data: existing } = await supabase
      .from("content")
      .select("id_client")
      .eq("id_content", contentId)
      .is("date_deleted", null)
      .single();

    if (!existing) {
      return NextResponse.json({ error: "Content object not found" }, { status: 404 });
    }

    if (existing.id_client && !(await canAccessClient(userId, role, existing.id_client))) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    const body = await req.json();

    const updateData: Record<string, any> = { date_updated: new Date().toISOString() };

    if (body.workingTitle !== undefined) updateData.name_content = body.workingTitle;
    if (body.body !== undefined) updateData.document_body = body.body;
    if (body.contentType !== undefined) updateData.type_content = body.contentType;
    if (body.brief !== undefined) updateData.information_brief = body.brief;
    if (body.customerId !== undefined) updateData.id_client = body.customerId ? parseInt(body.customerId, 10) : null;
    if (body.contractId !== undefined) updateData.id_contract = body.contractId ? parseInt(body.contractId, 10) : null;
    if (body.contentUnits !== undefined) updateData.units_override = body.contentUnits;

    if (body.status === "published") {
      updateData.flag_completed = 1;
      updateData.date_completed = new Date().toISOString();
    }

    const { data: updated, error } = await supabase
      .from("content")
      .update(updateData)
      .eq("id_content", contentId)
      .is("date_deleted", null)
      .select()
      .single();

    if (error || !updated) {
      return NextResponse.json({ error: "Content object not found" }, { status: 404 });
    }

    return NextResponse.json({
      contentObject: {
        id: String(updated.id_content),
        workingTitle: updated.name_content,
        contentType: updated.type_content,
        status: updated.flag_completed === 1 ? "published" : "draft",
        updatedAt: updated.date_updated,
      },
    });
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}

// DELETE /api/content-objects/[id]
export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const authResult = await requireAuth();
  if (authResult instanceof NextResponse) return authResult;
  const { userId, role } = authResult;

  try {
    const { id } = await params;
    const contentId = parseInt(id, 10);

    // Validate access
    const { data: existing } = await supabase
      .from("content")
      .select("id_client")
      .eq("id_content", contentId)
      .is("date_deleted", null)
      .single();

    if (existing?.id_client && !(await canAccessClient(userId, role, existing.id_client))) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    await supabase
      .from("content")
      .update({ date_deleted: new Date().toISOString() })
      .eq("id_content", contentId)
      .is("date_deleted", null);

    return NextResponse.json({ success: true });
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
