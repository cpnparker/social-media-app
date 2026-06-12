import { NextRequest, NextResponse } from "next/server";
import { supabase } from "@/lib/supabase";
import { requireAuth } from "@/lib/permissions";
import { fetchAllRows } from "@/lib/supabase-paginate";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

// GET /api/operations/formats
// Returns content tasks for the Formats dashboard.
// Uses the pre-joined view app_tasks_content filtered by date_created.
export async function GET(req: NextRequest) {
  const authResult = await requireAuth();
  if (authResult instanceof NextResponse) return authResult;

  const { searchParams } = new URL(req.url);
  const from = searchParams.get("from"); // YYYY-MM-DD
  const to = searchParams.get("to"); // YYYY-MM-DD
  const excludeClientIds = searchParams.get("excludeClients"); // comma-separated IDs

  try {
    // Paginated, ordered by the unique id_task — fetch ALL matching rows
    // (a one-year range is ~15k, well past the old .limit(5000) cap).
    const rows = await fetchAllRows((start, end) => {
      let q = supabase
        .from("app_tasks_content")
        .select(
          "id_task, id_content, type_task, units_content, date_created, date_deadline, date_completed, name_content, type_content, id_client, name_client, id_contract, name_contract, flag_spiked"
        )
        .order("id_task", { ascending: true });
      if (from) q = q.gte("date_created", `${from}T00:00:00.000Z`);
      if (to) q = q.lte("date_created", `${to}T23:59:59.999Z`);
      return q.range(start, end);
    });

    // Parse excluded client IDs
    const excludedIds = new Set(
      (excludeClientIds || "")
        .split(",")
        .map((s) => parseInt(s.trim(), 10))
        .filter((n) => !isNaN(n))
    );

    // Filter and map
    const tasks = (rows || [])
      .filter((t) => {
        if (t.id_client && excludedIds.has(t.id_client)) return false;
        if (t.flag_spiked === 1 && !t.date_completed) return false;
        return true;
      })
      .map((t) => ({
        taskId: String(t.id_task),
        contentId: t.id_content ? String(t.id_content) : null,
        taskType: t.type_task || "",
        cus: Number(t.units_content) || 0,
        dateCreated: t.date_created,
        contentName: t.name_content || "Untitled",
        contentType: t.type_content || "unknown",
        clientId: t.id_client ? String(t.id_client) : null,
        clientName: t.name_client || "Unknown",
        contractId: t.id_contract ? String(t.id_contract) : null,
        contractName: t.name_contract || null,
      }));

    return NextResponse.json({ tasks, totalTasks: tasks.length });
  } catch (error: any) {
    console.error("Formats GET error:", error.message);
    return NextResponse.json(
      { error: error.message, details: error.details || null, hint: error.hint || null },
      { status: 500 }
    );
  }
}
