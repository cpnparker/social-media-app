import { NextRequest, NextResponse } from "next/server";
import { supabase } from "@/lib/supabase";
import { requireAuth } from "@/lib/permissions";

// GET /api/operations/spiked
// Returns spiked tasks (content + social) where flag_spiked=1 AND date_completed IS NULL.
// Date filter uses date_spiked (when the content was spiked).
export async function GET(req: NextRequest) {
  const authResult = await requireAuth();
  if (authResult instanceof NextResponse) return authResult;

  const { searchParams } = new URL(req.url);
  const from = searchParams.get("from"); // YYYY-MM-DD
  const to = searchParams.get("to"); // YYYY-MM-DD

  try {
    // ── 1. Fetch spiked content tasks ──
    let contentTaskQuery = supabase
      .from("app_tasks_content")
      .select("*")
      .eq("flag_spiked", 1)
      .is("date_completed", null)
      .order("date_spiked", { ascending: false })
      .limit(5000);

    if (from) contentTaskQuery = contentTaskQuery.gte("date_spiked", `${from}T00:00:00.000Z`);
    if (to) contentTaskQuery = contentTaskQuery.lte("date_spiked", `${to}T23:59:59.999Z`);

    // ── 2. Fetch spiked social tasks ──
    let socialTaskQuery = supabase
      .from("app_tasks_social")
      .select("*")
      .eq("flag_spiked", 1)
      .is("date_completed", null)
      .order("date_spiked", { ascending: false })
      .limit(5000);

    if (from) socialTaskQuery = socialTaskQuery.gte("date_spiked", `${from}T00:00:00.000Z`);
    if (to) socialTaskQuery = socialTaskQuery.lte("date_spiked", `${to}T23:59:59.999Z`);

    const [contentTaskRes, socialTaskRes] = await Promise.all([contentTaskQuery, socialTaskQuery]);

    if (contentTaskRes.error) throw contentTaskRes.error;
    if (socialTaskRes.error) throw socialTaskRes.error;

    const contentTasks = contentTaskRes.data || [];
    const socialTasks = socialTaskRes.data || [];

    // ── 3. Build unified task list ──
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const tasks: any[] = [];

    for (const t of contentTasks) {
      tasks.push({
        taskId: String(t.id_task),
        source: "content",
        contentId: t.id_content ? String(t.id_content) : null,
        contractId: t.id_contract ? String(t.id_contract) : null,
        taskTitle: t.type_task,
        taskCUs: Number(t.units_content) || 0,
        taskCreatedAt: t.date_created,
        taskCompletedAt: t.date_completed,
        dateSpiked: t.date_spiked,
        taskStatus: "spiked",
        assigneeName: t.name_user_assignee || null,
        contentTitle: t.name_content || "Untitled",
        contentType: t.type_content || "unknown",
        customerId: t.id_client ? String(t.id_client) : null,
        customerName: t.name_client || "Unknown",
        contractName: t.name_contract || null,
      });
    }

    for (const t of socialTasks) {
      tasks.push({
        taskId: String(t.id_task),
        source: "social",
        contentId: t.id_content ? String(t.id_content) : null,
        contractId: t.id_contract ? String(t.id_contract) : null,
        taskTitle: t.type_task,
        taskCUs: Number(t.units_content) || 0,
        taskCreatedAt: t.date_created,
        taskCompletedAt: t.date_completed,
        dateSpiked: t.date_spiked,
        taskStatus: "spiked",
        assigneeName: t.name_user_assignee || null,
        contentTitle: t.name_social || "Social Promo",
        contentType: "social promo",
        customerId: t.id_client ? String(t.id_client) : null,
        customerName: t.name_client || "Unknown",
        contractName: t.name_contract || null,
      });
    }

    return NextResponse.json({ tasks, totalTasks: tasks.length });
  } catch (error: any) {
    console.error("Spiked CUs GET error:", error.message);
    return NextResponse.json(
      { error: error.message, details: error.details || null, hint: error.hint || null },
      { status: 500 }
    );
  }
}
