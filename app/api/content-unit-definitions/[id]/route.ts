import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { contentUnitDefinitions } from "@/lib/db/schema";
import { eq, sql } from "drizzle-orm";

// PUT /api/content-unit-definitions/[id]
export async function PUT(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const body = await req.json();

    const updateData: any = {};
    if (body.formatName !== undefined) updateData.formatName = body.formatName;
    if (body.description !== undefined) updateData.description = body.description;
    if (body.defaultContentUnits !== undefined) updateData.defaultContentUnits = body.defaultContentUnits;
    if (body.isActive !== undefined) updateData.isActive = body.isActive;
    if (body.sortOrder !== undefined) updateData.sortOrder = body.sortOrder;
    if (body.category !== undefined) updateData.category = body.category;

    if (Object.keys(updateData).length === 0) {
      return NextResponse.json({ error: "No fields to update" }, { status: 400 });
    }

    updateData.updatedAt = sql`now()`;

    const [definition] = await db
      .update(contentUnitDefinitions)
      .set(updateData)
      .where(eq(contentUnitDefinitions.id, id))
      .returning();

    if (!definition) {
      return NextResponse.json({ error: "Definition not found" }, { status: 404 });
    }

    return NextResponse.json({ definition });
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

    const [deleted] = await db
      .delete(contentUnitDefinitions)
      .where(eq(contentUnitDefinitions.id, id))
      .returning();

    if (!deleted) {
      return NextResponse.json({ error: "Definition not found" }, { status: 404 });
    }

    return NextResponse.json({ success: true });
  } catch (error: any) {
    console.error("Content unit definition DELETE error:", error.message);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
