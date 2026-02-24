import { NextRequest, NextResponse } from "next/server";
import { supabase } from "@/lib/supabase";
import { resolveWorkspaceAndUser } from "@/lib/api-utils";

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

// GET /api/promo-drafts?contentObjectId=xxx
export async function GET(req: NextRequest) {
  try {
    const contentObjectId = req.nextUrl.searchParams.get("contentObjectId");

    if (!contentObjectId) {
      return NextResponse.json(
        { error: "contentObjectId is required" },
        { status: 400 }
      );
    }

    const { workspaceId } = await resolveWorkspaceAndUser();

    const { data: drafts, error } = await supabase
      .from("promo_drafts")
      .select("*")
      .eq("content_object_id", contentObjectId)
      .eq("workspace_id", workspaceId);

    if (error) throw error;

    return NextResponse.json({
      drafts: (drafts || []).map(transformDraft),
    });
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}

// POST /api/promo-drafts — batch insert drafts
export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { contentObjectId, drafts: draftItems } = body;

    if (!contentObjectId || !draftItems?.length) {
      return NextResponse.json(
        { error: "contentObjectId and drafts array are required" },
        { status: 400 }
      );
    }

    const { workspaceId } = await resolveWorkspaceAndUser(body.workspaceId);

    const rows = draftItems.map((d: any) => ({
      content_object_id: contentObjectId,
      workspace_id: workspaceId,
      platform: d.platform,
      content: d.content,
      media_urls: d.mediaUrls || null,
      generated_by_ai: d.generatedByAi ?? true,
    }));

    const { data: inserted, error } = await supabase
      .from("promo_drafts")
      .insert(rows)
      .select();

    if (error) throw error;

    return NextResponse.json({
      drafts: (inserted || []).map(transformDraft),
    });
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
