import { NextRequest, NextResponse } from "next/server";
import { supabase } from "@/lib/supabase";

// Helper: snake_case → camelCase
function transformDraft(row: any) {
  return {
    id: row.id,
    contentObjectId: row.content_object_id,
    workspaceId: row.workspace_id,
    platform: row.platform,
    content: row.content,
    mediaUrls: row.media_urls,
    status: row.status,
    generatedByAi: row.generated_by_ai,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

// PUT /api/promo-drafts/[id]
export async function PUT(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const body = await req.json();

    const updateData: Record<string, any> = { updated_at: new Date().toISOString() };

    if (body.content !== undefined) updateData.content = body.content;
    if (body.status !== undefined) updateData.status = body.status;
    if (body.mediaUrls !== undefined) updateData.media_urls = body.mediaUrls;

    const { data: updated, error } = await supabase
      .from("promo_drafts")
      .update(updateData)
      .eq("id", id)
      .select()
      .single();

    if (error || !updated) {
      return NextResponse.json(
        { error: "Promo draft not found" },
        { status: 404 }
      );
    }

    return NextResponse.json({ draft: transformDraft(updated) });
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}

// DELETE /api/promo-drafts/[id]
export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;

    const { error } = await supabase
      .from("promo_drafts")
      .delete()
      .eq("id", id);

    if (error) throw error;

    return NextResponse.json({ success: true });
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
