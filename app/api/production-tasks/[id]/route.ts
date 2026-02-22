import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { productionTasks } from "@/lib/db/schema";
import { eq } from "drizzle-orm";

// PUT /api/production-tasks/[id]
export async function PUT(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const body = await req.json();

    const updateData: any = { updatedAt: new Date() };
    if (body.title !== undefined) updateData.title = body.title;
    if (body.description !== undefined) updateData.description = body.description;
    if (body.assignedTo !== undefined) updateData.assignedTo = body.assignedTo;
    if (body.status !== undefined) updateData.status = body.status;
    if (body.priority !== undefined) updateData.priority = body.priority;
    if (body.sortOrder !== undefined) updateData.sortOrder = body.sortOrder;
    if (body.dueDate !== undefined)
      updateData.dueDate = body.dueDate ? new Date(body.dueDate) : null;
    if (body.hoursPlanned !== undefined) updateData.hoursPlanned = body.hoursPlanned;
    if (body.hoursSpent !== undefined) updateData.hoursSpent = body.hoursSpent;
    if (body.aiUsed !== undefined) updateData.aiUsed = body.aiUsed;
    if (body.aiDetails !== undefined) updateData.aiDetails = body.aiDetails;
    if (body.notes !== undefined) updateData.notes = body.notes;

    if (body.status === "done" && !body.completedAt) {
      updateData.completedAt = new Date();
      if (body.completedBy) updateData.completedBy = body.completedBy;
    }
    if (body.status && body.status !== "done") {
      updateData.completedAt = null;
      updateData.completedBy = null;
    }

    const [updated] = await db
      .update(productionTasks)
      .set(updateData)
      .where(eq(productionTasks.id, id))
      .returning();

    if (!updated) {
      return NextResponse.json({ error: "Task not found" }, { status: 404 });
    }

    return NextResponse.json({ task: updated });
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}

// DELETE /api/production-tasks/[id]
export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;

    const [deleted] = await db
      .delete(productionTasks)
      .where(eq(productionTasks.id, id))
      .returning();

    if (!deleted) {
      return NextResponse.json({ error: "Task not found" }, { status: 404 });
    }

    return NextResponse.json({ success: true });
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
