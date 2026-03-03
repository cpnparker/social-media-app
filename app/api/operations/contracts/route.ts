import { NextRequest, NextResponse } from "next/server";
import { supabase } from "@/lib/supabase";
import { requireAuth } from "@/lib/permissions";
import { categorizeContentType } from "@/lib/content-type-utils";

// GET /api/operations/contracts
// Progressive loading:
//   Base: returns clients[] + contracts[]
//   ?clientId=X — filter contracts to one client
//   ?from=YYYY-MM-DD&to=YYYY-MM-DD — date range (overlap with contract period)
//   ?active=1|0|all — filter by flag_active (default: 1)
//   ?contractId=X — additionally returns contractDetail with aggregates
export async function GET(req: NextRequest) {
  const authResult = await requireAuth();
  if (authResult instanceof NextResponse) return authResult;

  const { searchParams } = new URL(req.url);
  const clientId = searchParams.get("clientId");
  const contractId = searchParams.get("contractId");
  const from = searchParams.get("from");
  const to = searchParams.get("to");
  const active = searchParams.get("active") || "1";

  try {
    // ── 1. Fetch clients ──
    const { data: clientRows, error: clientErr } = await supabase
      .from("app_clients")
      .select("id_client, name_client, information_description, information_industry, name_account_manager, link_website, link_linkedin, information_size, information_timezone")
      .order("name_client", { ascending: true });

    if (clientErr) throw clientErr;

    const clients = (clientRows || []).map((c) => ({
      clientId: String(c.id_client),
      name: c.name_client || "Unknown",
      description: c.information_description || null,
      industry: c.information_industry || null,
      accountManager: c.name_account_manager || null,
      website: c.link_website || null,
      linkedin: c.link_linkedin || null,
      size: c.information_size || null,
      timezone: c.information_timezone || null,
    }));

    // ── 2. Fetch contracts ──
    let contractQuery = supabase
      .from("app_contracts")
      .select("id_contract, id_client, name_contract, name_client, units_contract, units_total_completed, date_start, date_end, flag_active, name_account_manager, information_description")
      .order("name_client", { ascending: true });

    if (active === "1") contractQuery = contractQuery.eq("flag_active", 1);
    else if (active === "0") contractQuery = contractQuery.eq("flag_active", 0);
    // active === "all" — no filter

    if (clientId) contractQuery = contractQuery.eq("id_client", parseInt(clientId, 10));

    // Date range overlap: contract starts before `to` and ends after `from`
    if (from) contractQuery = contractQuery.gte("date_end", `${from}T00:00:00.000Z`);
    if (to) contractQuery = contractQuery.lte("date_start", `${to}T23:59:59.999Z`);

    const { data: contractRows, error: contractErr } = await contractQuery;
    if (contractErr) throw contractErr;

    const contracts = (contractRows || []).map((c) => ({
      contractId: String(c.id_contract),
      clientId: c.id_client ? String(c.id_client) : null,
      clientName: c.name_client || "Unknown",
      contractName: c.name_contract || "Unnamed",
      dateStart: c.date_start || null,
      dateEnd: c.date_end || null,
      cusContract: Number(c.units_contract) || 0,
      cusDelivered: Number(c.units_total_completed) || 0,
      active: c.flag_active === 1,
      accountManager: c.name_account_manager || null,
      description: c.information_description || null,
    }));

    // ── 3. If no contractId requested, return base data ──
    if (!contractId) {
      return NextResponse.json({ clients, contracts });
    }

    // ── 4. Contract detail: fetch tasks for this contract ──
    const cid = parseInt(contractId, 10);

    const [contentRes, socialRes] = await Promise.all([
      supabase
        .from("app_tasks_content")
        .select("id_task, id_content, id_contract, type_task, type_content, name_content, units_content, date_created, date_completed, flag_spiked, name_user_assignee, name_client")
        .eq("id_contract", cid),
      supabase
        .from("app_tasks_social")
        .select("id_task, id_content, id_contract, type_task, name_social, units_content, date_created, date_completed, flag_spiked, name_user_assignee, name_client")
        .eq("id_contract", cid),
    ]);

    if (contentRes.error) throw contentRes.error;
    if (socialRes.error) throw socialRes.error;

    const contentTasks = contentRes.data || [];
    const socialTasks = socialRes.data || [];

    // ── 5. Aggregate CUs ──
    let commissionedCUs = 0;
    let spikedCUs = 0;

    for (const t of contentTasks) {
      const cus = Number(t.units_content) || 0;
      if (t.flag_spiked === 1 && !t.date_completed) {
        spikedCUs += cus;
      } else {
        commissionedCUs += cus;
      }
    }
    for (const t of socialTasks) {
      const cus = Number(t.units_content) || 0;
      if (t.flag_spiked === 1 && !t.date_completed) {
        spikedCUs += cus;
      } else {
        commissionedCUs += cus;
      }
    }

    // ── 6. Average production time per category ──
    const prodTimeMap: Record<string, { totalDays: number; count: number }> = {};

    for (const t of contentTasks) {
      if (!t.date_completed || !t.date_created) continue;
      if (t.flag_spiked === 1 && !t.date_completed) continue;
      const cat = categorizeContentType(t.type_content || "other");
      const days = Math.max(0, (new Date(t.date_completed).getTime() - new Date(t.date_created).getTime()) / (1000 * 60 * 60 * 24));
      if (!prodTimeMap[cat]) prodTimeMap[cat] = { totalDays: 0, count: 0 };
      prodTimeMap[cat].totalDays += days;
      prodTimeMap[cat].count += 1;
    }

    const avgProductionTime = Object.entries(prodTimeMap)
      .map(([category, { totalDays, count }]) => ({
        category,
        avgDays: Math.round((totalDays / count) * 10) / 10,
        sampleCount: count,
      }))
      .sort((a, b) => a.category.localeCompare(b.category));

    // ── 7. Content types (by category) ──
    const typeMap: Record<string, { count: number; cus: number }> = {};
    for (const t of contentTasks) {
      if (t.flag_spiked === 1 && !t.date_completed) continue;
      const cat = categorizeContentType(t.type_content || "other");
      if (!typeMap[cat]) typeMap[cat] = { count: 0, cus: 0 };
      typeMap[cat].count += 1;
      typeMap[cat].cus += Number(t.units_content) || 0;
    }
    for (const t of socialTasks) {
      if (t.flag_spiked === 1 && !t.date_completed) continue;
      const cat = "Visual"; // social promos are visual
      if (!typeMap[cat]) typeMap[cat] = { count: 0, cus: 0 };
      typeMap[cat].count += 1;
      typeMap[cat].cus += Number(t.units_content) || 0;
    }

    const contentTypes = Object.entries(typeMap)
      .map(([name, { count, cus }]) => ({ name, count, cus }))
      .sort((a, b) => b.cus - a.cus);

    // ── 8. Content formats (by type_content) ──
    const formatMap: Record<string, { count: number; cus: number }> = {};
    for (const t of contentTasks) {
      if (t.flag_spiked === 1 && !t.date_completed) continue;
      const fmt = t.type_content || "unknown";
      if (!formatMap[fmt]) formatMap[fmt] = { count: 0, cus: 0 };
      formatMap[fmt].count += 1;
      formatMap[fmt].cus += Number(t.units_content) || 0;
    }
    for (const t of socialTasks) {
      if (t.flag_spiked === 1 && !t.date_completed) continue;
      const fmt = "social_promo";
      if (!formatMap[fmt]) formatMap[fmt] = { count: 0, cus: 0 };
      formatMap[fmt].count += 1;
      formatMap[fmt].cus += Number(t.units_content) || 0;
    }

    const contentFormats = Object.entries(formatMap)
      .map(([name, { count, cus }]) => ({ name, count, cus }))
      .sort((a, b) => b.cus - a.cus);

    // ── 9. All content items ──
    const content = contentTasks
      .filter((t) => !(t.flag_spiked === 1 && !t.date_completed))
      .map((t) => ({
        taskId: String(t.id_task),
        contentId: t.id_content ? String(t.id_content) : null,
        name: t.name_content || "Untitled",
        type: t.type_content || "unknown",
        cus: Number(t.units_content) || 0,
        dateCreated: t.date_created,
        dateCompleted: t.date_completed,
        assignee: t.name_user_assignee || null,
      }));

    // Add social tasks to content list
    for (const t of socialTasks) {
      if (t.flag_spiked === 1 && !t.date_completed) continue;
      content.push({
        taskId: String(t.id_task),
        contentId: t.id_content ? String(t.id_content) : null,
        name: t.name_social || "Social Promo",
        type: "social_promo",
        cus: Number(t.units_content) || 0,
        dateCreated: t.date_created,
        dateCompleted: t.date_completed,
        assignee: t.name_user_assignee || null,
      });
    }

    // Sort content by date descending
    content.sort((a, b) => {
      const da = a.dateCreated || "";
      const db = b.dateCreated || "";
      return db.localeCompare(da);
    });

    const contractDetail = {
      commissionedCUs,
      spikedCUs,
      avgProductionTime,
      contentTypes,
      contentFormats,
      content,
    };

    return NextResponse.json({ clients, contracts, contractDetail });
  } catch (error: any) {
    console.error("Contracts GET error:", error.message);
    return NextResponse.json(
      { error: error.message, details: error.details || null, hint: error.hint || null },
      { status: 500 }
    );
  }
}
