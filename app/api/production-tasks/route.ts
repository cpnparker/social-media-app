import { NextRequest, NextResponse } from "next/server";
import { supabase } from "@/lib/supabase";

// GET /api/production-tasks
export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const contentObjectId = searchParams.get("contentObjectId");
  const limit = parseInt(searchParams.get("limit") || "100");

  try {
    let query = supabase
      .from("app_tasks_content")
      .select("*")
      .order("order_sort", { ascending: true })
      .limit(limit);

    if (contentObjectId) {
      query = query.eq("id_content", parseInt(contentObjectId, 10));
    }

    const { data: rows, error } = await query;
    if (error) throw error;

    const tasks = (rows || []).map((t) => ({
      id: String(t.id_task),
      contentObjectId: t.id_content ? String(t.id_content) : null,
      title: t.type_task,
      status: t.date_completed ? "done" : t.flag_spiked === 1 ? "cancelled" : "todo",
      assignedTo: t.id_user_assignee ? String(t.id_user_assignee) : null,
      assignedToName: t.name_user_assignee,
      sortOrder: t.order_sort,
      notes: t.information_notes,
      contentUnits: Number(t.units_content) || 0,
      createdAt: t.date_created,
      completedAt: t.date_completed,
      dueDate: t.date_deadline,
    }));

    return NextResponse.json({ tasks });
  } catch (error: any) {
    console.error("Production tasks GET error:", error.message);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}

// POST /api/production-tasks
export async function POST(req: NextRequest) {
  try {
    const body = await req.json();

    if (!body.contentObjectId || !body.title) {
      return NextResponse.json(
        { error: "contentObjectId and title are required" },
        { status: 400 }
      );
    }

    const { data: task, error } = await supabase
      .from("tasks_content")
      .insert({
        id_content: parseInt(body.contentObjectId, 10),
        type_task: body.title,
        order_sort: body.sortOrder ?? 0,
        information_notes: body.description || null,
        user_assignee: body.assignedTo ? parseInt(body.assignedTo, 10) : null,
        user_created: body.createdBy ? parseInt(body.createdBy, 10) : null,
        date_created: new Date().toISOString(),
      })
      .select()
      .single();

    if (error) throw error;

    return NextResponse.json({
      task: {
        id: String(task.id_task),
        contentObjectId: String(task.id_content),
        title: task.type_task,
        status: "todo",
        sortOrder: task.order_sort,
        createdAt: task.date_created,
      },
    });
  } catch (error: any) {
    console.error("Production tasks POST error:", error.message);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
