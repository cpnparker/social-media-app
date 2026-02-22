import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { taskTemplates } from "@/lib/db/schema";
import { eq } from "drizzle-orm";

// PUT /api/task-templates/[id]
export async function PUT(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const body = await req.json();

    const updates: any = {};
    if (body.title !== undefined) updates.title = body.title;
    if (body.description !== undefined) updates.description = body.description;
    if (body.defaultRole !== undefined) updates.defaultRole = body.defaultRole;
    if (body.sortOrder !== undefined) updates.sortOrder = body.sortOrder;

    if (Object.keys(updates).length === 0) {
      return NextResponse.json({ error: "No fields to update" }, { status: 400 });
    }

    const [template] = await db
      .update(taskTemplates)
      .set(updates)
      .where(eq(taskTemplates.id, id))
      .returning();

    if (!template) {
      return NextResponse.json({ error: "Template not found" }, { status: 404 });
    }

    return NextResponse.json({ template });
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

    const [deleted] = await db
      .delete(taskTemplates)
      .where(eq(taskTemplates.id, id))
      .returning();

    if (!deleted) {
      return NextResponse.json({ error: "Template not found" }, { status: 404 });
    }

    return NextResponse.json({ success: true });
  } catch (error: any) {
    console.error("Task template DELETE error:", error.message);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
