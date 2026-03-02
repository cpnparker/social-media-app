import { NextRequest, NextResponse } from "next/server";
import { supabase } from "@/lib/supabase";
import { requireAuth } from "@/lib/permissions";

// GET /api/operations/team-production
// Returns tasks assigned to specific users for team production view.
// Filters by assignee user IDs and date range.
export async function GET(req: NextRequest) {
  const authResult = await requireAuth();
  if (authResult instanceof NextResponse) return authResult;

  const { searchParams } = new URL(req.url);
  const from = searchParams.get("from"); // YYYY-MM-DD
  const to = searchParams.get("to"); // YYYY-MM-DD
  const userIds = searchParams.get("userIds"); // comma-separated user IDs
  const excludeClientIds = searchParams.get("excludeClients");

  try {
    // Parse user IDs
    const userIdList = (userIds || "")
      .split(",")
      .map((s) => parseInt(s.trim(), 10))
      .filter((n) => !isNaN(n));

    if (userIdList.length === 0) {
      return NextResponse.json({ tasks: [] });
    }

    // Fetch tasks assigned to these users
    // We query based on deadline date range for assigned tasks
    // and completed date range for delivered tasks
    // To get both, we widen the query and filter client-side
    const batchSize = 50;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const allRows: any[] = [];

    for (let i = 0; i < userIdList.length; i += batchSize) {
      const batch = userIdList.slice(i, i + batchSize);

      let query = supabase
        .from("app_tasks_content")
        .select("*")
        .in("id_user_assignee", batch)
        .order("date_deadline", { ascending: true })
        .limit(5000);

      // Include tasks that are either:
      // - assigned with deadline in the period, OR
      // - completed in the period
      // We fetch broadly and filter client-side
      if (from) {
        // Get tasks where deadline >= from OR completed >= from
        query = query.or(
          `date_deadline.gte.${from}T00:00:00.000Z,date_completed.gte.${from}T00:00:00.000Z`
        );
      }
      if (to) {
        query = query.or(
          `date_deadline.lte.${to}T23:59:59.999Z,date_completed.lte.${to}T23:59:59.999Z`
        );
      }

      const { data: rows, error } = await query;
      if (error) throw error;
      if (rows) allRows.push(...rows);
    }

    // Parse excluded client IDs
    const excludedIds = new Set(
      (excludeClientIds || "")
        .split(",")
        .map((s) => parseInt(s.trim(), 10))
        .filter((n) => !isNaN(n))
    );

    const tasks = allRows
      .filter((t) => {
        if (t.id_client && excludedIds.has(t.id_client)) return false;
        if (t.flag_spiked === 1 && !t.date_completed) return false;
        return true;
      })
      .map((t) => ({
        taskId: String(t.id_task),
        contentId: t.id_content ? String(t.id_content) : null,
        taskTitle: t.type_task || "Untitled Task",
        taskCUs: Number(t.units_content) || 0,
        deadline: t.date_deadline || null,
        completedAt: t.date_completed || null,
        createdAt: t.date_created || null,
        contentTitle: t.name_content || "Untitled",
        contentType: t.type_content || "unknown",
        customerId: t.id_client ? String(t.id_client) : null,
        customerName: t.name_client || "Unknown",
        assigneeName: t.name_user_assignee || null,
        assigneeId: t.id_user_assignee ? String(t.id_user_assignee) : null,
      }));

    return NextResponse.json({ tasks });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : "Unknown error";
    console.error("Team production GET error:", message);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
