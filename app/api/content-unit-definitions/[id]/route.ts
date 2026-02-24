import { NextRequest, NextResponse } from "next/server";
import { supabase } from "@/lib/supabase";

// PUT /api/content-unit-definitions/[id]
export async function PUT(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const body = await req.json();

    const updateData: Record<string, any> = {};
    if (body.formatName !== undefined) updateData.name = body.formatName;
    if (body.defaultContentUnits !== undefined) updateData.units_content = body.defaultContentUnits;
    if (body.sortOrder !== undefined) updateData.sort_order = body.sortOrder;
    if (body.category !== undefined) updateData.format = body.category;
    if (body.splitText !== undefined) updateData.split_text = body.splitText;
    if (body.splitVideo !== undefined) updateData.split_video = body.splitVideo;
    if (body.splitVisual !== undefined) updateData.split_visual = body.splitVisual;

    if (Object.keys(updateData).length === 0) {
      return NextResponse.json({ error: "No fields to update" }, { status: 400 });
    }

    const { data: definition, error } = await supabase
      .from("calculator_content")
      .update(updateData)
      .eq("id", id)
      .select()
      .single();

    if (error || !definition) {
      return NextResponse.json({ error: "Definition not found" }, { status: 404 });
    }

    return NextResponse.json({
      definition: {
        id: definition.id,
        category: definition.format,
        formatName: definition.name,
        defaultContentUnits: Number(definition.units_content) || 0,
        sortOrder: definition.sort_order,
        isActive: true,
      },
    });
  } catch (error: any) {
    console.error("Content unit definition PUT error:", error.message);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}

// DELETE /api/content-unit-definitions/[id]
export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;

    const { error } = await supabase
      .from("calculator_content")
      .delete()
      .eq("id", id);

    if (error) throw error;

    return NextResponse.json({ success: true });
  } catch (error: any) {
    console.error("Content unit definition DELETE error:", error.message);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
