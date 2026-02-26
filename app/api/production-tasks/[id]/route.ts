import { NextRequest, NextResponse } from "next/server";
import { supabase } from "@/lib/supabase";

// PUT /api/production-tasks/[id]
export async function PUT(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const taskId = parseInt(id, 10);
    const body = await req.json();

    const updateData: Record<string, any> = { date_updated: new Date().toISOString() };

    if (body.title !== undefined) updateData.type_task = body.title;
    if (body.notes !== undefined) updateData.information_notes = body.notes;
    if (body.sortOrder !== undefined) updateData.order_sort = body.sortOrder;
    if (body.assignedTo !== undefined) {
      updateData.user_assignee = body.assignedTo ? parseInt(body.assignedTo, 10) : null;
    }
    if (body.dueDate !== undefined) {
      updateData.date_deadline = body.dueDate || null;
    }
    if (body.contentUnits !== undefined) {
      updateData.units_content = body.contentUnits ? Number(body.contentUnits) : null;
    }

    // Handle status transitions
    if (body.status === "done") {
      updateData.date_completed = new Date().toISOString();
      if (body.completedBy) updateData.user_completed = parseInt(body.completedBy, 10);
    }
    if (body.status && body.status !== "done") {
      updateData.date_completed = null;
      updateData.user_completed = null;
    }

    // Update and return the row from the base table (not the materialized view)
    const { data: updated, error } = await supabase
      .from("tasks_content")
      .update(updateData)
      .eq("id_task", taskId)
      .is("date_deleted", null)
      .select("*")
      .single();

    if (error || !updated) {
      console.error("Task update error:", error?.message, "taskId:", taskId);
      return NextResponse.json({ error: error?.message || "Task not found" }, { status: 404 });
    }

    return NextResponse.json({
      task: {
        id: String(updated.id_task),
        contentObjectId: updated.id_content ? String(updated.id_content) : null,
        title: updated.type_task,
        status: updated.date_completed ? "done" : "todo",
        assignedTo: updated.user_assignee ? String(updated.user_assignee) : null,
        sortOrder: updated.order_sort,
        notes: updated.information_notes,
        contentUnits: Number(updated.units_content) || 0,
        createdAt: updated.date_created,
        completedAt: updated.date_completed,
        dueDate: updated.date_deadline,
      },
    });
  } catch (error: any) {
    console.error("Task PUT exception:", error.message);
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
    const taskId = parseInt(id, 10);

    await supabase
      .from("tasks_content")
      .update({ date_deleted: new Date().toISOString() })
      .eq("id_task", taskId)
      .is("date_deleted", null);

    return NextResponse.json({ success: true });
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
