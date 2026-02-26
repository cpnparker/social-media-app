import { NextRequest, NextResponse } from "next/server";
import { supabase } from "@/lib/supabase";

// Helper: fetch the full task from the view and return a consistent shape
async function getFullTask(taskId: number) {
  const { data: t } = await supabase
    .from("app_tasks_content")
    .select("*")
    .eq("id_task", taskId)
    .single();

  if (!t) return null;

  return {
    id: String(t.id_task),
    contentObjectId: t.id_content ? String(t.id_content) : null,
    title: t.type_task,
    status: t.date_completed ? "done" : "todo",
    assignedTo: t.id_user_assignee ? String(t.id_user_assignee) : null,
    assignedToName: t.name_user_assignee,
    sortOrder: t.order_sort,
    notes: t.information_notes,
    contentUnits: Number(t.units_content) || 0,
    createdAt: t.date_created,
    completedAt: t.date_completed,
    dueDate: t.date_deadline,
    isCurrent: t.flag_task_current === "true" || t.flag_task_current === "1",
  };
}

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

    const { error } = await supabase
      .from("tasks_content")
      .update(updateData)
      .eq("id_task", taskId)
      .is("date_deleted", null);

    if (error) {
      return NextResponse.json({ error: "Task not found" }, { status: 404 });
    }

    // Re-fetch from view for complete response with joined user names etc.
    const task = await getFullTask(taskId);
    if (!task) {
      return NextResponse.json({ error: "Task not found" }, { status: 404 });
    }

    return NextResponse.json({ task });
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
