import { NextRequest, NextResponse } from "next/server";
import { supabase } from "@/lib/supabase";
import { requireAuth } from "@/lib/permissions";

// GET /api/operations/contracts-grid
// Returns active contracts with aggregated CU data from content + social tasks.
// Client-side computes percentages, remaining, gap, and row colors.
export async function GET(req: NextRequest) {
  const authResult = await requireAuth();
  if (authResult instanceof NextResponse) return authResult;

  const { searchParams } = new URL(req.url);
  const endAfter = searchParams.get("endAfter") || new Date().toISOString().split("T")[0];
  const excludeClientIds = searchParams.get("excludeClients"); // comma-separated IDs

  try {
    // ── 1. Fetch active contracts ending after the cutoff date ──
    const contractQuery = supabase
      .from("app_contracts")
      .select("id_contract, id_client, name_contract, name_client, units_contract, units_total_completed, date_start, date_end, flag_active")
      .eq("flag_active", 1)
      .gte("date_end", `${endAfter}T00:00:00.000Z`)
      .order("name_client", { ascending: true });

    const { data: contractRows, error: contractErr } = await contractQuery;
    if (contractErr) throw contractErr;

    if (!contractRows || contractRows.length === 0) {
      return NextResponse.json({ contracts: [] });
    }

    // ── 2. Parse excluded client IDs ──
    const excludedIds = new Set(
      (excludeClientIds || "")
        .split(",")
        .map((s) => parseInt(s.trim(), 10))
        .filter((n) => !isNaN(n))
    );

    // Filter out excluded clients
    const filteredContracts = contractRows.filter(
      (c) => !c.id_client || !excludedIds.has(c.id_client)
    );

    const contractIds = filteredContracts.map((c) => c.id_contract);

    // ── 3. Aggregate task CUs per contract from app_tasks_content ──
    // We need: total commissioned (all tasks) and total completed (tasks with date_completed)
    const contentAgg: Record<number, { commissioned: number; completed: number }> = {};
    const socialAgg: Record<number, { commissioned: number; completed: number }> = {};

    // Fetch content tasks in batches
    const batchSize = 200;
    for (let i = 0; i < contractIds.length; i += batchSize) {
      const batch = contractIds.slice(i, i + batchSize);

      const [contentRes, socialRes] = await Promise.all([
        supabase
          .from("app_tasks_content")
          .select("id_contract, units_content, date_completed, flag_spiked")
          .in("id_contract", batch),
        supabase
          .from("app_tasks_social")
          .select("id_contract, units_content, date_completed, flag_spiked")
          .in("id_contract", batch),
      ]);

      if (contentRes.error) throw contentRes.error;
      if (socialRes.error) throw socialRes.error;

      for (const t of contentRes.data || []) {
        // Skip spiked tasks that aren't completed
        if (t.flag_spiked === 1 && !t.date_completed) continue;
        const cid = t.id_contract;
        if (!contentAgg[cid]) contentAgg[cid] = { commissioned: 0, completed: 0 };
        const cus = Number(t.units_content) || 0;
        contentAgg[cid].commissioned += cus;
        if (t.date_completed) contentAgg[cid].completed += cus;
      }

      for (const t of socialRes.data || []) {
        if (t.flag_spiked === 1 && !t.date_completed) continue;
        const cid = t.id_contract;
        if (!socialAgg[cid]) socialAgg[cid] = { commissioned: 0, completed: 0 };
        const cus = Number(t.units_content) || 0;
        socialAgg[cid].commissioned += cus;
        if (t.date_completed) socialAgg[cid].completed += cus;
      }
    }

    // ── 4. Build enriched contract list ──
    const contracts = filteredContracts.map((c) => {
      const content = contentAgg[c.id_contract] || { commissioned: 0, completed: 0 };
      const social = socialAgg[c.id_contract] || { commissioned: 0, completed: 0 };

      return {
        contractId: String(c.id_contract),
        clientId: c.id_client ? String(c.id_client) : null,
        clientName: c.name_client || "Unknown",
        contractName: c.name_contract || "Unnamed",
        dateStart: c.date_start || null,
        dateEnd: c.date_end || null,
        cusContract: Number(c.units_contract) || 0,
        cusCommissioned: content.commissioned + social.commissioned,
        cusComplete: content.completed + social.completed,
      };
    });

    return NextResponse.json({ contracts });
  } catch (error: any) {
    console.error("Contracts Grid GET error:", error.message);
    return NextResponse.json(
      { error: error.message, details: error.details || null, hint: error.hint || null },
      { status: 500 }
    );
  }
}
