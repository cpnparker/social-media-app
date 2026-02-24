import { NextRequest, NextResponse } from "next/server";
import { supabase } from "@/lib/supabase";

// PUT /api/task-templates/[id]
export async function PUT(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const templateId = parseInt(id, 10);
    const body = await req.json();

    const updateData: Record<string, any> = { date_updated: new Date().toISOString() };
    if (body.title !== undefined) updateData.type_task = body.title;
    if (body.description !== undefined) updateData.information_notes = body.description;
    if (body.sortOrder !== undefined) updateData.order_sort = body.sortOrder;

    if (Object.keys(updateData).length <= 1) {
      return NextResponse.json({ error: "No fields to update" }, { status: 400 });
    }

    const { data: template, error } = await supabase
      .from("templates_tasks_content")
      .update(updateData)
      .eq("id_template", templateId)
      .select()
      .single();

    if (error || !template) {
      return NextResponse.json({ error: "Template not found" }, { status: 404 });
    }

    return NextResponse.json({
      template: {
        id: String(template.id_template),
        title: template.type_task,
        description: template.information_notes,
        sortOrder: template.order_sort,
      },
    });
  } catch (error: any) {
    console.error("Task template PUT error:", error.message);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}

// DELETE /api/task-templates/[id]
export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const templateId = parseInt(id, 10);

    const { error } = await supabase
      .from("templates_tasks_content")
      .delete()
      .eq("id_template", templateId);

    if (error) throw error;

    return NextResponse.json({ success: true });
  } catch (error: any) {
    console.error("Task template DELETE error:", error.message);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
