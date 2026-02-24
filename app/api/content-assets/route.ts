import { NextRequest, NextResponse } from "next/server";
import { supabase } from "@/lib/supabase";
import { resolveWorkspaceAndUser } from "@/lib/api-utils";

// Helper: snake_case → camelCase
function transformAsset(row: any) {
  return {
    id: row.id,
    entityType: row.entity_type,
    entityId: row.entity_id,
    workspaceId: row.workspace_id,
    name: row.name,
    url: row.url,
    assetType: row.asset_type,
    fileSize: row.file_size,
    uploadedBy: row.uploaded_by,
    createdAt: row.created_at,
  };
}

// GET /api/content-assets
export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const entityType = searchParams.get("entityType");
  const entityId = searchParams.get("entityId");

  try {
    let query = supabase.from("content_assets").select("*");

    if (entityType) query = query.eq("entity_type", entityType);
    if (entityId) query = query.eq("entity_id", entityId);

    const { data: rows, error } = await query;
    if (error) throw error;

    return NextResponse.json({
      assets: (rows || []).map(transformAsset),
    });
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}

// POST /api/content-assets
export async function POST(req: NextRequest) {
  try {
    const body = await req.json();

    if (!body.entityType || !body.entityId || !body.name || !body.url) {
      return NextResponse.json(
        { error: "entityType, entityId, name, and url are required" },
        { status: 400 }
      );
    }

    const resolved = await resolveWorkspaceAndUser(
      body.workspaceId,
      body.uploadedBy
    );

    const { data: asset, error } = await supabase
      .from("content_assets")
      .insert({
        entity_type: body.entityType,
        entity_id: body.entityId,
        workspace_id: resolved.workspaceId,
        name: body.name,
        url: body.url,
        asset_type: body.assetType || "document",
        file_size: body.fileSize || null,
        uploaded_by: resolved.createdBy,
      })
      .select()
      .single();

    if (error) throw error;

    return NextResponse.json({ asset: transformAsset(asset) });
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}

// DELETE /api/content-assets
export async function DELETE(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const id = searchParams.get("id");

  if (!id) {
    return NextResponse.json({ error: "id is required" }, { status: 400 });
  }

  try {
    const { error } = await supabase
      .from("content_assets")
      .delete()
      .eq("id", id);

    if (error) throw error;

    return NextResponse.json({ success: true });
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
