import { NextRequest, NextResponse } from "next/server";
import { supabase } from "@/lib/supabase";
import { requireAuth, scopeQueryToClients, canAccessClient } from "@/lib/permissions";

// GET /api/ideas — list ideas
export async function GET(req: NextRequest) {
  const authResult = await requireAuth();
  if (authResult instanceof NextResponse) return authResult;
  const { userId, role } = authResult;

  const { searchParams } = new URL(req.url);
  const status = searchParams.get("status");
  const customerId = searchParams.get("customerId");
  const limit = parseInt(searchParams.get("limit") || "50");
  const offset = parseInt(searchParams.get("offset") || "0");

  try {
    let query = supabase
      .from("app_ideas")
      .select("*")
      .order("date_created", { ascending: false })
      .range(offset, offset + limit - 1);

    if (status) query = query.eq("status", status);

    // Scope to allowed clients
    const scoped = await scopeQueryToClients(query, userId, role, customerId, "id_client");
    if (scoped.error) return scoped.error;
    query = scoped.query;

    const { data: rows, error } = await query;
    if (error) throw error;

    const ideas = (rows || []).map((r) => ({
      id: String(r.id_idea),
      title: r.name_idea,
      description: r.information_brief,
      status: r.status,
      customerId: r.id_client ? String(r.id_client) : null,
      customerName: r.name_client,
      topicTags: r.name_topic_array || [],
      strategicTags: r.name_campaign_array || [],
      eventTags: r.name_event_array || [],
      imageUrl: r.file_bucket && r.file_path
        ? `https://dcwodczzdeltxlyepxmc.supabase.co/storage/v1/object/public/${r.file_bucket}/${r.file_path}`
        : null,
      linkUrl: r.link_url,
      createdBy: r.id_user_submitted ? String(r.id_user_submitted) : null,
      createdByName: r.name_user_submitted,
      createdAt: r.date_created,
      commissionedAt: r.date_commissioned,
      contentIds: r.id_content || [],
      socialIds: r.id_social || [],
    }));

    return NextResponse.json({ ideas });
  } catch (error: any) {
    console.error("Ideas GET error:", error.message);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}

// POST /api/ideas — create idea
export async function POST(req: NextRequest) {
  const authResult = await requireAuth();
  if (authResult instanceof NextResponse) return authResult;
  const { userId, role } = authResult;

  try {
    const body = await req.json();
    const { title, description, customerId: bodyCustomerId } = body;

    if (!title) {
      return NextResponse.json({ error: "Title is required" }, { status: 400 });
    }

    // Validate client access if customerId provided
    if (bodyCustomerId) {
      const cid = parseInt(bodyCustomerId, 10);
      if (!(await canAccessClient(userId, role, cid))) {
        return NextResponse.json({ error: "Forbidden" }, { status: 403 });
      }
    }

    const insertData: Record<string, any> = {
      name_idea: title,
      information_brief: description || null,
      status: "submitted",
      date_created: new Date().toISOString(),
    };

    if (bodyCustomerId) {
      insertData.id_client = parseInt(bodyCustomerId, 10);
    }

    if (body.createdBy) {
      insertData.user_submitted = parseInt(body.createdBy, 10);
    }

    const { data: idea, error } = await supabase
      .from("ideas")
      .insert(insertData)
      .select()
      .single();

    if (error) throw error;

    return NextResponse.json({
      idea: {
        id: String(idea.id_idea),
        title: idea.name_idea,
        description: idea.information_brief,
        status: idea.status,
        customerId: idea.id_client ? String(idea.id_client) : null,
        createdAt: idea.date_created,
      },
    });
  } catch (error: any) {
    console.error("Ideas POST error:", error.message);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
