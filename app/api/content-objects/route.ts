import { NextRequest, NextResponse } from "next/server";
import { supabase } from "@/lib/supabase";
import { requireAuth, scopeQueryToClients, canAccessClient } from "@/lib/permissions";

// GET /api/content-objects
export async function GET(req: NextRequest) {
  const authResult = await requireAuth();
  if (authResult instanceof NextResponse) return authResult;
  const { userId, role } = authResult;

  const { searchParams } = new URL(req.url);
  const contentType = searchParams.get("contentType");
  const customerId = searchParams.get("customerId");
  const limit = parseInt(searchParams.get("limit") || "50");
  const offset = parseInt(searchParams.get("offset") || "0");

  try {
    let query = supabase
      .from("app_content")
      .select("*")
      .order("date_created", { ascending: false })
      .range(offset, offset + limit - 1);

    if (contentType) query = query.eq("type_content", contentType);

    // Scope to allowed clients
    const scoped = await scopeQueryToClients(query, userId, role, customerId, "id_client");
    if (scoped.error) return scoped.error;
    query = scoped.query;

    const { data: rows, error } = await query;
    if (error) throw error;

    // Batch-fetch task counts for all returned content IDs
    const contentIds = (rows || []).map((r: any) => r.id_content).filter(Boolean) as number[];
    const taskCountMap: Record<number, { total: number; done: number }> = {};

    if (contentIds.length > 0) {
      // Fetch all tasks for these content items
      const { data: allTasks } = await supabase
        .from("tasks_content")
        .select("id_content, date_completed")
        .in("id_content", contentIds)
        .is("date_deleted", null);

      for (const task of allTasks || []) {
        const cid = task.id_content as number;
        if (!taskCountMap[cid]) {
          taskCountMap[cid] = { total: 0, done: 0 };
        }
        taskCountMap[cid].total += 1;
        if (task.date_completed) {
          taskCountMap[cid].done += 1;
        }
      }
    }

    // Batch-fetch current tasks (next uncompleted task per content item)
    const currentTaskMap: Record<number, { id: number; type: string; assignee: string | null }> = {};

    if (contentIds.length > 0) {
      const { data: currentTasks } = await supabase
        .from("app_tasks_content")
        .select("*")
        .in("id_content", contentIds)
        .is("date_completed", null)
        .order("order_sort", { ascending: true });

      // Take only the first uncompleted task per content item
      for (const task of currentTasks || []) {
        const cid = task.id_content as number;
        if (!currentTaskMap[cid]) {
          currentTaskMap[cid] = {
            id: task.id_task as number,
            type: task.type_task as string,
            assignee: (task.name_user_assignee as string) || null,
          };
        }
      }
    }

    const contentObjects = (rows || []).map((r: any) => {
      const counts = taskCountMap[r.id_content] || { total: 0, done: 0 };
      const currentTask = currentTaskMap[r.id_content] || null;

      return {
        id: String(r.id_content),
        ideaId: r.id_idea ? String(r.id_idea) : null,
        contentType: r.type_content,
        workingTitle: r.name_content,
        status: r.flag_completed === 1 ? "published" : r.flag_spiked === 1 ? "spiked" : "draft",
        customerId: r.id_client ? String(r.id_client) : null,
        customerName: r.name_client,
        contractId: r.id_contract ? String(r.id_contract) : null,
        contractName: r.name_contract || null,
        contentUnits: Number(r.units_content) || 0,
        topicTags: r.name_topic_array || [],
        campaignTags: r.name_campaign_array || [],
        eventTags: r.name_event_array || [],
        createdAt: r.date_created,
        completedAt: r.date_completed || null,
        updatedAt: r.date_completed || r.date_created,
        deadlineProduction: r.date_deadline_production || null,
        deadlinePublication: r.date_deadline_publication || null,
        isFastTurnaround: r.flag_fast_turnaround === 1,
        contentLeadName: r.name_user_content_lead || null,
        commissionedByName: r.name_user_commissioned || null,
        // Task counts
        totalTasks: counts.total,
        doneTasks: counts.done,
        // Current task (next uncompleted)
        currentTask,
      };
    });

    return NextResponse.json({ contentObjects });
  } catch (error: any) {
    console.error("Content objects GET error:", error.message);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}

// POST /api/content-objects
export async function POST(req: NextRequest) {
  const authResult = await requireAuth();
  if (authResult instanceof NextResponse) return authResult;
  const { userId, role } = authResult;

  try {
    const body = await req.json();

    // Validate client access if customerId provided
    if (body.customerId) {
      const cid = parseInt(body.customerId, 10);
      if (!(await canAccessClient(userId, role, cid))) {
        return NextResponse.json({ error: "Forbidden" }, { status: 403 });
      }
    }

    const insertData: Record<string, any> = {
      name_content: body.workingTitle || body.title || "Untitled",
      type_content: body.contentType || "article",
      information_brief: body.body || "",
      date_created: new Date().toISOString(),
    };

    if (body.ideaId) insertData.id_idea = parseInt(body.ideaId, 10);
    if (body.customerId) insertData.id_client = parseInt(body.customerId, 10);
    if (body.contractId) insertData.id_contract = parseInt(body.contractId, 10);
    if (body.contentUnits) insertData.units_override = parseFloat(body.contentUnits);
    if (body.createdBy) insertData.user_commissioned = parseInt(body.createdBy, 10);

    const { data: obj, error } = await supabase
      .from("content")
      .insert(insertData)
      .select()
      .single();

    if (error) throw error;

    return NextResponse.json({
      contentObject: {
        id: String(obj.id_content),
        ideaId: obj.id_idea ? String(obj.id_idea) : null,
        workingTitle: obj.name_content,
        contentType: obj.type_content,
        status: "draft",
        createdAt: obj.date_created,
      },
    });
  } catch (error: any) {
    console.error("Content objects POST error:", error.message);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
