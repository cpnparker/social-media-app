import { NextRequest, NextResponse } from "next/server";
import { supabase } from "@/lib/supabase";
import { requireAuth } from "@/lib/permissions";

// Maps entityType to the correct existing Supabase assets table
const ENTITY_TABLE_MAP: Record<string, { table: string; view: string; fk: string }> = {
  content: { table: "assets_content", view: "app_assets_content", fk: "id_content" },
  client: { table: "assets_clients", view: "app_assets_clients", fk: "id_client" },
  idea: { table: "assets_ideas", view: "app_assets_ideas", fk: "id_idea" },
};

// Transform existing asset row → camelCase API shape
function transformAsset(row: any, entityType: string) {
  return {
    id: String(row.id_asset),
    entityType,
    entityId: String(row[ENTITY_TABLE_MAP[entityType]?.fk] || row.id_content || row.id_client || row.id_idea),
    name: row.name_asset || row.file_name || null,
    url: row.file_url || (row.file_path ? `/files/${row.file_path}` : null),
    assetType: row.type_asset || "document",
    description: row.information_description || null,
    fileSize: null,
    createdAt: row.date_created,
    fileName: row.file_name || null,
    filePath: row.file_path || null,
    fileBucket: row.file_bucket || null,
  };
}

// GET /api/content-assets
export async function GET(req: NextRequest) {
  const authResult = await requireAuth();
  if (authResult instanceof NextResponse) return authResult;

  const { searchParams } = new URL(req.url);
  const entityType = searchParams.get("entityType") || "content";
  const entityId = searchParams.get("entityId");

  try {
    const mapping = ENTITY_TABLE_MAP[entityType];
    if (!mapping) {
      return NextResponse.json(
        { error: `Unknown entityType: ${entityType}. Supported: ${Object.keys(ENTITY_TABLE_MAP).join(", ")}` },
        { status: 400 }
      );
    }

    let query = supabase.from(mapping.view).select("*");

    if (entityId) {
      query = query.eq(mapping.fk, parseInt(entityId, 10));
    }

    const { data: rows, error } = await query;
    if (error) throw error;

    return NextResponse.json({
      assets: (rows || []).map((r) => transformAsset(r, entityType)),
    });
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}

// POST /api/content-assets
export async function POST(req: NextRequest) {
  const authResult = await requireAuth();
  if (authResult instanceof NextResponse) return authResult;

  try {
    const body = await req.json();
    const entityType = body.entityType || "content";

    if (!body.entityId || !body.name) {
      return NextResponse.json(
        { error: "entityId and name are required" },
        { status: 400 }
      );
    }

    const mapping = ENTITY_TABLE_MAP[entityType];
    if (!mapping) {
      return NextResponse.json(
        { error: `Unknown entityType: ${entityType}` },
        { status: 400 }
      );
    }

    const insertData: any = {
      [mapping.fk]: parseInt(body.entityId, 10),
      name_asset: body.name,
      type_asset: body.assetType || "document",
      information_description: body.description || null,
    };

    if (body.fileId) {
      insertData.id_file = parseInt(body.fileId, 10);
    }

    const { data: asset, error } = await supabase
      .from(mapping.table)
      .insert(insertData)
      .select()
      .single();

    if (error) throw error;

    return NextResponse.json({ asset: transformAsset(asset, entityType) });
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}

// DELETE /api/content-assets
export async function DELETE(req: NextRequest) {
  const authResult = await requireAuth();
  if (authResult instanceof NextResponse) return authResult;

  const { searchParams } = new URL(req.url);
  const id = searchParams.get("id");
  const entityType = searchParams.get("entityType") || "content";

  if (!id) {
    return NextResponse.json({ error: "id is required" }, { status: 400 });
  }

  const mapping = ENTITY_TABLE_MAP[entityType];
  if (!mapping) {
    return NextResponse.json(
      { error: `Unknown entityType: ${entityType}` },
      { status: 400 }
    );
  }

  try {
    const { error } = await supabase
      .from(mapping.table)
      .update({ date_deleted: new Date().toISOString() })
      .eq("id_asset", parseInt(id, 10));

    if (error) throw error;

    return NextResponse.json({ success: true });
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
