import { NextRequest, NextResponse } from "next/server";
import { supabase } from "@/lib/supabase";

// GET /api/task-templates?contentType=article OR ?typeId=1
export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const contentType = searchParams.get("contentType");
  const typeId = searchParams.get("typeId");

  if (!contentType && !typeId) {
    return NextResponse.json(
      { error: "contentType or typeId query param is required" },
      { status: 400 }
    );
  }

  try {
    let idType: number | null = null;

    if (typeId) {
      idType = parseInt(typeId, 10);
    } else if (contentType) {
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
      idType = typeRow.id_type;
    }

    if (!idType) {
      return NextResponse.json({ templates: [] });
    }

    const { data: rows, error } = await supabase
      .from("templates_tasks_content")
      .select("*")
      .eq("id_type", idType)
      .order("order_sort", { ascending: true });

    if (error) throw error;

    const templates = (rows || []).map((t) => ({
      id: String(t.id_template),
      typeId: t.id_type,
      contentType: contentType || String(idType),
      title: t.type_task,
      description: t.information_notes,
      sortOrder: t.order_sort,
      contentUnits: Number(t.units_content) || 0,
      unitsOverride: Number(t.units_override) || 0,
      defaultAdded: t.flag_clone === 1,
      canManuallyAdd: t.flag_add === 1,
      assignedToAccountManager: t.flag_account_manager === 1,
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

    if (!body.contentType && !body.typeId) {
      return NextResponse.json(
        { error: "contentType or typeId is required" },
        { status: 400 }
      );
    }
    if (!body.title) {
      return NextResponse.json(
        { error: "title is required" },
        { status: 400 }
      );
    }

    let idType: number | null = body.typeId || null;

    if (!idType && body.contentType) {
      const { data: typeRow } = await supabase
        .from("types_content")
        .select("id_type")
        .or(`key_type.eq.${body.contentType},type_content.ilike.${body.contentType}`)
        .limit(1)
        .single();

      idType = typeRow?.id_type || null;
    }

    // Get current max sortOrder for this type
    let orderQuery = supabase
      .from("templates_tasks_content")
      .select("order_sort")
      .order("order_sort", { ascending: false })
      .limit(1);

    if (idType) {
      orderQuery = orderQuery.eq("id_type", idType);
    }

    const { data: maxRows } = await orderQuery;
    const maxOrder = maxRows?.[0]?.order_sort ?? -1;

    const { data: template, error } = await supabase
      .from("templates_tasks_content")
      .insert({
        id_type: idType,
        type_task: body.title,
        information_notes: body.description || null,
        order_sort: body.sortOrder ?? maxOrder + 1,
        units_content: body.contentUnits ?? 0,
        units_override: body.unitsOverride ?? 0,
        flag_clone: body.defaultAdded ? 1 : 0,
        flag_add: body.canManuallyAdd ? 1 : 0,
        flag_account_manager: body.assignedToAccountManager ? 1 : 0,
        date_created: new Date().toISOString(),
      })
      .select()
      .single();

    if (error) throw error;

    return NextResponse.json({
      template: {
        id: String(template.id_template),
        typeId: template.id_type,
        contentType: body.contentType || String(idType),
        title: template.type_task,
        description: template.information_notes,
        sortOrder: template.order_sort,
        contentUnits: Number(template.units_content) || 0,
        unitsOverride: Number(template.units_override) || 0,
        defaultAdded: template.flag_clone === 1,
        canManuallyAdd: template.flag_add === 1,
        assignedToAccountManager: template.flag_account_manager === 1,
      },
    });
  } catch (error: any) {
    console.error("Task templates POST error:", error.message);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
