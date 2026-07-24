import { NextRequest, NextResponse } from "next/server";
import { supabase } from "@/lib/supabase";
import { requireAuth } from "@/lib/permissions";
import { fetchAllRows } from "@/lib/supabase-paginate";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

// GET /api/operations/timeline-resourcing
// Returns tasks with deadline/CU data for the Gantt chart.
export async function GET(req: NextRequest) {
  const authResult = await requireAuth();
  if (authResult instanceof NextResponse) return authResult;

  const { searchParams } = new URL(req.url);
  const from = searchParams.get("from"); // YYYY-MM-DD
  const to = searchParams.get("to"); // YYYY-MM-DD
  const excludeClientIds = searchParams.get("excludeClients");

  try {
    // Fetch tasks that have deadlines within the visible window
    // We also grab tasks whose calculated start (deadline - CUs days) might fall in window
    // So we widen the query range by 30 days before "from" to catch tasks that start before but end within
    // Paginated, ordered by the unique id_task — fetch ALL tasks with a
    // deadline in the (widened) window rather than the old .limit(5000) cap.
    const rows = await fetchAllRows((start, end) => {
      let query = supabase
        .from("app_tasks_content")
        .select("*")
        .not("date_deadline", "is", null)
        .order("id_task", { ascending: true });

      // Widen the from date by 30 days to catch tasks that start before the window
      if (from) {
        const widenedFrom = new Date(from);
        widenedFrom.setDate(widenedFrom.getDate() - 30);
        query = query.gte("date_deadline", widenedFrom.toISOString().split("T")[0]);
      }
      if (to) {
        // Extend to date slightly to catch tasks ending at the boundary
        query = query.lte("date_deadline", `${to}T23:59:59.999Z`);
      }
      return query.range(start, end);
    });

    // Parse excluded client IDs
    const excludedIds = new Set(
      (excludeClientIds || "")
        .split(",")
        .map((s) => parseInt(s.trim(), 10))
        .filter((n) => !isNaN(n))
    );

    const tasks = (rows || [])
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
        contentTitle: t.name_content || "Untitled",
        contentType: t.type_content || "unknown",
        customerId: t.id_client ? String(t.id_client) : null,
        customerName: t.name_client || "Unknown",
        assigneeName: t.name_user_assignee || null,
        assigneeId: t.id_user_assignee ? String(t.id_user_assignee) : null,
      }));

    return NextResponse.json({ tasks });
  } catch (error: any) {
    console.error("Timeline resourcing GET error:", error.message);
    return NextResponse.json(
      { error: error.message },
      { status: 500 }
    );
  }
}
