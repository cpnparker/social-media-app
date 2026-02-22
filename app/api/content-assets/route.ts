import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { contentAssets } from "@/lib/db/schema";
import { eq, and } from "drizzle-orm";
import { resolveWorkspaceAndUser } from "@/lib/api-utils";

// GET /api/content-assets
export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const entityType = searchParams.get("entityType");
  const entityId = searchParams.get("entityId");

  try {
    const conditions: any[] = [];
    if (entityType) conditions.push(eq(contentAssets.entityType, entityType));
    if (entityId) conditions.push(eq(contentAssets.entityId, entityId));

    let query = db.select().from(contentAssets);
    if (conditions.length === 1) {
      query = query.where(conditions[0]) as any;
    } else if (conditions.length > 1) {
      query = query.where(and(...conditions)) as any;
    }

    const rows = await query;
    return NextResponse.json({ assets: rows });
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

    const resolved = await resolveWorkspaceAndUser(body.workspaceId, body.uploadedBy);

    const [asset] = await db
      .insert(contentAssets)
      .values({
        entityType: body.entityType,
        entityId: body.entityId,
        workspaceId: resolved.workspaceId,
        name: body.name,
        url: body.url,
        assetType: body.assetType || "document",
        fileSize: body.fileSize || null,
        uploadedBy: resolved.createdBy,
      })
      .returning();

    return NextResponse.json({ asset });
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
    const [deleted] = await db
      .delete(contentAssets)
      .where(eq(contentAssets.id, id))
      .returning();

    if (!deleted) {
      return NextResponse.json({ error: "Asset not found" }, { status: 404 });
    }

    return NextResponse.json({ success: true });
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
