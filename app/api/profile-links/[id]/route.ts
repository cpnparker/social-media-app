import { NextRequest, NextResponse } from "next/server";
import { supabase } from "@/lib/supabase";

// Helper: snake_case → camelCase
function transformLink(row: any) {
  return {
    id: row.id,
    workspaceId: row.workspace_id,
    title: row.title,
    url: row.url,
    description: row.description,
    icon: row.icon,
    sortOrder: row.sort_order,
    isActive: row.is_active,
    createdAt: row.created_at,
  };
}

// PUT /api/profile-links/[id] — update a link
export async function PUT(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const body = await req.json();

    const updateData: Record<string, any> = {};
    if (body.title !== undefined) updateData.title = body.title;
    if (body.url !== undefined) updateData.url = body.url;
    if (body.description !== undefined) updateData.description = body.description;
    if (body.icon !== undefined) updateData.icon = body.icon;
    if (body.isActive !== undefined) updateData.is_active = body.isActive;
    if (body.sortOrder !== undefined) updateData.sort_order = body.sortOrder;

    const { data: updated, error } = await supabase
      .from("profile_links")
      .update(updateData)
      .eq("id", id)
      .select()
      .single();

    if (error || !updated) {
      return NextResponse.json({ error: "Link not found" }, { status: 404 });
    }

    return NextResponse.json({ link: transformLink(updated) });
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}

// DELETE /api/profile-links/[id] — delete a link
export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;

    const { error } = await supabase
      .from("profile_links")
      .delete()
      .eq("id", id);

    if (error) throw error;

    return NextResponse.json({ success: true });
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
