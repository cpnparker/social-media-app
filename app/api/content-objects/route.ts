import { NextRequest, NextResponse } from "next/server";
import { supabase } from "@/lib/supabase";

// GET /api/content-objects
export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const contentType = searchParams.get("contentType");
  const customerId = searchParams.get("customerId");
  const limit = parseInt(searchParams.get("limit") || "50");
  const offset = parseInt(searchParams.get("offset") || "0");

  try {
    let query = supabase
      .from("app_content")
      .select("*")
      .order("date_created", { ascending: false })
      .range(offset, offset + limit - 1);

    if (contentType) query = query.eq("type_content", contentType);
    if (customerId) query = query.eq("id_client", parseInt(customerId, 10));

    const { data: rows, error } = await query;
    if (error) throw error;

    const contentObjects = (rows || []).map((r) => ({
      id: String(r.id_content),
      ideaId: r.id_idea ? String(r.id_idea) : null,
      contentType: r.type_content,
      workingTitle: r.name_content,
      status: r.flag_completed === 1 ? "published" : r.flag_spiked === 1 ? "spiked" : "draft",
      customerId: r.id_client ? String(r.id_client) : null,
      customerName: r.name_client,
      contractId: r.id_contract ? String(r.id_contract) : null,
      contentUnits: Number(r.units_content) || 0,
      topicTags: r.name_topic_array || [],
      campaignTags: r.name_campaign_array || [],
      createdAt: r.date_created,
      contentLeadName: r.name_user_content_lead,
    }));

    return NextResponse.json({ contentObjects });
  } catch (error: any) {
    console.error("Content objects GET error:", error.message);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}

// POST /api/content-objects
export async function POST(req: NextRequest) {
  try {
    const body = await req.json();

    const insertData: Record<string, any> = {
      name_content: body.workingTitle || body.title || "Untitled",
      type_content: body.contentType || "article",
      information_brief: body.body || "",
      date_created: new Date().toISOString(),
    };

    if (body.ideaId) insertData.id_idea = parseInt(body.ideaId, 10);
    if (body.customerId) insertData.id_client = parseInt(body.customerId, 10);
    if (body.contractId) insertData.id_contract = parseInt(body.contractId, 10);
    if (body.contentUnits) insertData.units_override = parseFloat(body.contentUnits);
    if (body.createdBy) insertData.user_commissioned = parseInt(body.createdBy, 10);

    const { data: obj, error } = await supabase
      .from("content")
      .insert(insertData)
      .select()
      .single();

    if (error) throw error;

    return NextResponse.json({
      contentObject: {
        id: String(obj.id_content),
        ideaId: obj.id_idea ? String(obj.id_idea) : null,
        workingTitle: obj.name_content,
        contentType: obj.type_content,
        status: "draft",
        createdAt: obj.date_created,
      },
    });
  } catch (error: any) {
    console.error("Content objects POST error:", error.message);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
