import { NextRequest, NextResponse } from "next/server";
import { supabase } from "@/lib/supabase";
import { requireAuth } from "@/lib/permissions";

// GET /api/operations/commissioned-cus
// Returns tasks (content + social promo) with metadata for the CU dashboard.
// Uses the pre-joined views app_tasks_content and app_tasks_social.
// Also returns contract summary data from app_contracts.
export async function GET(req: NextRequest) {
  const authResult = await requireAuth();
  if (authResult instanceof NextResponse) return authResult;

  const { searchParams } = new URL(req.url);
  const from = searchParams.get("from"); // YYYY-MM-DD
  const to = searchParams.get("to"); // YYYY-MM-DD
  const excludeClientIds = searchParams.get("excludeClients"); // comma-separated IDs

  try {
    // ── 1. Fetch content tasks from the enriched view ──
    let contentTaskQuery = supabase
      .from("app_tasks_content")
      .select("*")
      .order("date_created", { ascending: false })
      .limit(5000);

    if (from) contentTaskQuery = contentTaskQuery.gte("date_created", `${from}T00:00:00.000Z`);
    if (to) contentTaskQuery = contentTaskQuery.lte("date_created", `${to}T23:59:59.999Z`);

    // ── 2. Fetch social promo tasks from the enriched view ──
    let socialTaskQuery = supabase
      .from("app_tasks_social")
      .select("*")
      .order("date_created", { ascending: false })
      .limit(5000);

    if (from) socialTaskQuery = socialTaskQuery.gte("date_created", `${from}T00:00:00.000Z`);
    if (to) socialTaskQuery = socialTaskQuery.lte("date_created", `${to}T23:59:59.999Z`);

    const [contentTaskRes, socialTaskRes] = await Promise.all([contentTaskQuery, socialTaskQuery]);

    if (contentTaskRes.error) throw contentTaskRes.error;
    if (socialTaskRes.error) throw socialTaskRes.error;

    const contentTasks = contentTaskRes.data || [];
    const socialTasks = socialTaskRes.data || [];

    // ── 3. Parse excluded client IDs ──
    const excludedIds = new Set(
      (excludeClientIds || "")
        .split(",")
        .map((s) => parseInt(s.trim(), 10))
        .filter((n) => !isNaN(n))
    );

    // ── 4. Fetch content lead / commissioned-by names from app_content ──
    const contentIds = Array.from(
      new Set([
        ...contentTasks.map((t) => t.id_content),
        ...socialTasks.map((t) => t.id_content),
      ].filter(Boolean))
    );
    const contentMetaMap: Record<number, { leadName: string | null; commissionedByName: string | null }> = {};
    if (contentIds.length > 0) {
      const batchSize = 200;
      for (let i = 0; i < contentIds.length; i += batchSize) {
        const batch = contentIds.slice(i, i + batchSize);
        const { data: rows } = await supabase
          .from("app_content")
          .select("id_content, name_user_content_lead, name_user_commissioned")
          .in("id_content", batch);
        for (const c of rows || []) {
          contentMetaMap[c.id_content] = {
            leadName: c.name_user_content_lead || null,
            commissionedByName: c.name_user_commissioned || null,
          };
        }
      }
    }

    // ── 5. Build unified task list ──
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const tasks: any[] = [];

    for (const t of contentTasks) {
      if (t.id_client && excludedIds.has(t.id_client)) continue;
      if (t.flag_spiked === 1 && !t.date_completed) continue;

      const meta = t.id_content ? contentMetaMap[t.id_content] : null;

      tasks.push({
        taskId: String(t.id_task),
        source: "content",
        contentId: t.id_content ? String(t.id_content) : null,
        contractId: t.id_contract ? String(t.id_contract) : null,
        taskTitle: t.type_task,
        taskCUs: Number(t.units_content) || 0,
        taskCreatedAt: t.date_created,
        taskCompletedAt: t.date_completed,
        taskStatus: t.date_completed ? "done" : "todo",
        assigneeName: t.name_user_assignee || null,
        contentTitle: t.name_content || "Untitled",
        contentType: t.type_content || "unknown",
        customerId: t.id_client ? String(t.id_client) : null,
        customerName: t.name_client || "Unknown",
        contractName: t.name_contract || null,
        contentStatus: t.flag_spiked === 1 ? "spiked" : t.date_completed ? "published" : "draft",
        contentLeadName: meta?.leadName || null,
        commissionedByName: meta?.commissionedByName || null,
      });
    }

    for (const t of socialTasks) {
      if (t.id_client && excludedIds.has(t.id_client)) continue;
      if (t.flag_spiked === 1 && !t.date_completed) continue;

      const meta = t.id_content ? contentMetaMap[t.id_content] : null;

      tasks.push({
        taskId: String(t.id_task),
        source: "social",
        contentId: t.id_content ? String(t.id_content) : null,
        contractId: t.id_contract ? String(t.id_contract) : null,
        taskTitle: t.type_task,
        taskCUs: Number(t.units_content) || 0,
        taskCreatedAt: t.date_created,
        taskCompletedAt: t.date_completed,
        taskStatus: t.date_completed ? "done" : "todo",
        assigneeName: t.name_user_assignee || null,
        contentTitle: t.name_social || "Social Promo",
        contentType: "social promo",
        customerId: t.id_client ? String(t.id_client) : null,
        customerName: t.name_client || "Unknown",
        contractName: t.name_contract || null,
        contentStatus: "draft",
        contentLeadName: meta?.leadName || null,
        commissionedByName: meta?.commissionedByName || null,
      });
    }

    // ── 6. Fetch contract data for all referenced contracts ──
    const contractIdSet = new Set(
      tasks.map((t) => t.contractId).filter(Boolean).map(Number)
    );
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const contracts: any[] = [];
    if (contractIdSet.size > 0) {
      const contractIdArr = Array.from(contractIdSet);
      const batchSize = 200;
      for (let i = 0; i < contractIdArr.length; i += batchSize) {
        const batch = contractIdArr.slice(i, i + batchSize);
        const { data: rows } = await supabase
          .from("app_contracts")
          .select("id_contract, name_contract, id_client, name_client, units_contract, units_total_completed")
          .in("id_contract", batch);
        for (const c of rows || []) {
          contracts.push({
            contractId: String(c.id_contract),
            contractName: c.name_contract || "Unnamed",
            clientId: c.id_client ? String(c.id_client) : null,
            clientName: c.name_client || "Unknown",
            totalContractCUs: Number(c.units_contract) || 0,
            completedContractCUs: Number(c.units_total_completed) || 0,
          });
        }
      }
    }

    return NextResponse.json({ tasks, contracts, totalTasks: tasks.length });
  } catch (error: any) {
    console.error("Commissioned CUs GET error:", error.message);
    return NextResponse.json(
      { error: error.message, details: error.details || null, hint: error.hint || null },
      { status: 500 }
    );
  }
}
