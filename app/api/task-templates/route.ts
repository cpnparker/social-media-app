import { NextRequest, NextResponse } from "next/server";
import { supabase } from "@/lib/supabase";

// GET /api/task-templates?contentType=article
export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const contentType = searchParams.get("contentType");

  if (!contentType) {
    return NextResponse.json(
      { error: "contentType query param is required" },
      { status: 400 }
    );
  }

  try {
    // Resolve contentType string to id_type
    const { data: typeRow } = await supabase
      .from("types_content")
      .select("id_type")
      .or(`key_type.eq.${contentType},type_content.ilike.${contentType}`)
      .limit(1)
      .single();

    if (!typeRow) {
      return NextResponse.json({ templates: [] });
    }

    const { data: rows, error } = await supabase
      .from("templates_tasks_content")
      .select("*")
      .eq("id_type", typeRow.id_type)
      .order("order_sort", { ascending: true });

    if (error) throw error;

    const templates = (rows || []).map((t) => ({
      id: String(t.id_template),
      contentType,
      title: t.type_task,
      description: t.information_notes,
      sortOrder: t.order_sort,
      contentUnits: Number(t.units_content) || 0,
    }));

    return NextResponse.json({ templates });
  } catch (error: any) {
    console.error("Task templates GET error:", error.message);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}

// POST /api/task-templates
export async function POST(req: NextRequest) {
  try {
    const body = await req.json();

    if (!body.contentType || !body.title) {
      return NextResponse.json(
        { error: "contentType and title are required" },
        { status: 400 }
      );
    }

    // Resolve contentType to id_type
    const { data: typeRow } = await supabase
      .from("types_content")
      .select("id_type")
      .or(`key_type.eq.${body.contentType},type_content.ilike.${body.contentType}`)
      .limit(1)
      .single();

    const idType = typeRow?.id_type || null;

    // Get current max sortOrder
    let query = supabase
      .from("templates_tasks_content")
      .select("order_sort")
      .order("order_sort", { ascending: false })
      .limit(1);

    if (idType) {
      query = query.eq("id_type", idType);
    }

    const { data: maxRows } = await query;
    const maxOrder = maxRows?.[0]?.order_sort ?? -1;

    const { data: template, error } = await supabase
      .from("templates_tasks_content")
      .insert({
        id_type: idType,
        type_task: body.title,
        information_notes: body.description || null,
        order_sort: body.sortOrder ?? maxOrder + 1,
        date_created: new Date().toISOString(),
      })
      .select()
      .single();

    if (error) throw error;

    return NextResponse.json({
      template: {
        id: String(template.id_template),
        contentType: body.contentType,
        title: template.type_task,
        description: template.information_notes,
        sortOrder: template.order_sort,
      },
    });
  } catch (error: any) {
    console.error("Task templates POST error:", error.message);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
