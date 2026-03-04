import { NextRequest, NextResponse } from "next/server";
import { supabase } from "@/lib/supabase";
import { requireAuth } from "@/lib/permissions";
import {
  getClockifyClients,
  getClockifyProjects,
  getAllTimeEntries,
  buildClientProfitability,
} from "@/lib/clockify";

const r2 = (n: number) => Math.round(n * 100) / 100;

// GET /api/operations/profitability
// ?from=YYYY-MM-DD  (default: 12 months ago)
// ?to=YYYY-MM-DD    (default: today)
export async function GET(req: NextRequest) {
  const authResult = await requireAuth();
  if (authResult instanceof NextResponse) return authResult;

  const { searchParams } = new URL(req.url);

  // Date range defaults to last 12 months
  const now = new Date();
  const twelveMonthsAgo = new Date(now);
  twelveMonthsAgo.setMonth(twelveMonthsAgo.getMonth() - 12);

  const fromParam = searchParams.get("from");
  const toParam = searchParams.get("to");

  const fromDate = fromParam || twelveMonthsAgo.toISOString().slice(0, 10);
  const toDate = toParam || now.toISOString().slice(0, 10);

  const fromISO = `${fromDate}T00:00:00Z`;
  const toISO = `${toDate}T23:59:59Z`;

  try {
    // ── 1. Fetch Clockify data + Supabase data in parallel ──
    const [
      clockifyClients,
      clockifyProjects,
      timeEntries,
      clientsRes,
      contractsRes,
      contentTasksRes,
      socialTasksRes,
    ] = await Promise.all([
      getClockifyClients(),
      getClockifyProjects(),
      getAllTimeEntries(fromISO, toISO),
      // Supabase clients
      supabase
        .from("app_clients")
        .select("*")
        .order("name_client", { ascending: true }),
      // Contracts overlapping the date range
      supabase
        .from("app_contracts")
        .select("*"),
      // Content tasks completed within the date range — this gives us
      // actual CUs delivered in the period (not all-time)
      supabase
        .from("app_tasks_content")
        .select("id_client, id_contract, units_content, date_completed, flag_spiked, id_content")
        .gte("date_completed", fromISO)
        .lte("date_completed", toISO),
      // Social tasks completed within the date range
      supabase
        .from("app_tasks_social")
        .select("id_client, id_contract, units_content, date_completed, flag_spiked, id_content")
        .gte("date_completed", fromISO)
        .lte("date_completed", toISO),
    ]);

    // ── 2. Build per-client hour aggregation from Clockify ──
    const { byClient, unmatchedProjects } = buildClientProfitability(
      timeEntries,
      clockifyProjects,
      clockifyClients
    );

    const supabaseClients = clientsRes.data || [];
    const supabaseContracts = contractsRes.data || [];
    const contentTasks = contentTasksRes.data || [];
    const socialTasks = socialTasksRes.data || [];

    // ── 3. Calculate actual CUs delivered per client in the period ──
    // Deduplicate by id_content to avoid counting the same content item twice
    // (multiple tasks can exist per content item)
    const periodCUsByClient = new Map<string, { delivered: number; contentCount: number }>();

    // Track seen content IDs to deduplicate
    const seenContentIds = new Set<string>();

    for (const t of contentTasks) {
      if (t.flag_spiked === 1) continue; // exclude spiked
      const clientId = t.id_client ? String(t.id_client) : null;
      if (!clientId) continue;

      // Deduplicate by id_content
      const contentKey = t.id_content ? `c_${t.id_content}` : `t_${Math.random()}`;
      if (seenContentIds.has(contentKey)) continue;
      seenContentIds.add(contentKey);

      const cus = Number(t.units_content) || 0;
      if (!periodCUsByClient.has(clientId)) {
        periodCUsByClient.set(clientId, { delivered: 0, contentCount: 0 });
      }
      const entry = periodCUsByClient.get(clientId)!;
      entry.delivered += cus;
      entry.contentCount += 1;
    }

    for (const t of socialTasks) {
      if (t.flag_spiked === 1) continue;
      const clientId = t.id_client ? String(t.id_client) : null;
      if (!clientId) continue;

      const contentKey = t.id_content ? `s_${t.id_content}` : `st_${Math.random()}`;
      if (seenContentIds.has(contentKey)) continue;
      seenContentIds.add(contentKey);

      const cus = Number(t.units_content) || 0;
      if (!periodCUsByClient.has(clientId)) {
        periodCUsByClient.set(clientId, { delivered: 0, contentCount: 0 });
      }
      const entry = periodCUsByClient.get(clientId)!;
      entry.delivered += cus;
      entry.contentCount += 1;
    }

    // ── 4. Build lookups ──
    // Supabase client lookup by normalized name
    const supabaseClientByName = new Map<string, Record<string, any>>();
    for (const sc of supabaseClients) {
      const name = (sc.name_client || "").trim().toLowerCase();
      supabaseClientByName.set(name, sc);
    }

    // Group contracts by client id (filter to overlapping ones for display)
    const contractsByClientId = new Map<string, Record<string, any>[]>();
    for (const c of supabaseContracts) {
      // Only include contracts that overlap the selected period
      const cStart = c.date_start || null;
      const cEnd = c.date_end || null;
      const overlaps =
        (!cStart || cStart <= toISO) && (!cEnd || cEnd >= fromISO);
      if (!overlaps) continue;

      const cid = String(c.id_client);
      if (!contractsByClientId.has(cid)) contractsByClientId.set(cid, []);
      contractsByClientId.get(cid)!.push(c);
    }

    // Clockify client name lookup
    const clockifyClientNameMap = new Map<string, string>();
    for (const c of clockifyClients) {
      clockifyClientNameMap.set(c.id, c.name);
    }

    // ── 5. Join Clockify hours with period-specific CU data ──
    const clients: {
      clockifyClientId: string;
      clientName: string;
      totalHours: number;
      billableHours: number;
      activityBreakdown: Record<string, number>;
      supabaseClientId: string | null;
      cusDeliveredInPeriod: number;
      contentItemsInPeriod: number;
      cusContracted: number;
      hoursPerCU: number | null;
      contracts: {
        contractId: string;
        contractName: string;
        cusDelivered: number;
        cusContracted: number;
        dateStart: string | null;
        dateEnd: string | null;
        active: boolean;
      }[];
    }[] = [];

    for (const [clockifyClientId, hours] of Object.entries(byClient)) {
      const clientName = clockifyClientNameMap.get(clockifyClientId) || "Unknown";
      const normalizedName = clientName.trim().toLowerCase();

      // Match to Supabase client
      const supabaseClient = supabaseClientByName.get(normalizedName);
      const supabaseClientId = supabaseClient
        ? String(supabaseClient.id_client)
        : null;

      // Get period-specific CUs from actual completed tasks
      const periodCUs = supabaseClientId
        ? periodCUsByClient.get(supabaseClientId)
        : null;
      const cusDeliveredInPeriod = periodCUs ? periodCUs.delivered : 0;
      const contentItemsInPeriod = periodCUs ? periodCUs.contentCount : 0;

      // Get overlapping contracts for display
      let cusContracted = 0;
      const clientContracts: typeof clients[0]["contracts"] = [];

      if (supabaseClientId) {
        const contracts = contractsByClientId.get(supabaseClientId) || [];
        for (const c of contracts) {
          const delivered = Number(c.units_total_completed) || 0;
          const contracted = Number(c.units_contract) || 0;
          cusContracted += contracted;
          clientContracts.push({
            contractId: String(c.id_contract),
            contractName: c.name_contract || "Unnamed",
            cusDelivered: r2(delivered),
            cusContracted: r2(contracted),
            dateStart: c.date_start || null,
            dateEnd: c.date_end || null,
            active: c.flag_active === 1,
          });
        }
      }

      // Round activity breakdown
      const roundedBreakdown: Record<string, number> = {};
      for (const [activity, h] of Object.entries(hours.activityBreakdown)) {
        roundedBreakdown[activity] = r2(h);
      }

      clients.push({
        clockifyClientId,
        clientName,
        totalHours: r2(hours.totalHours),
        billableHours: r2(hours.billableHours),
        activityBreakdown: roundedBreakdown,
        supabaseClientId,
        cusDeliveredInPeriod: r2(cusDeliveredInPeriod),
        contentItemsInPeriod,
        cusContracted: r2(cusContracted),
        hoursPerCU:
          cusDeliveredInPeriod > 0
            ? r2(hours.totalHours / cusDeliveredInPeriod)
            : null,
        contracts: clientContracts,
      });
    }

    // Sort by total hours descending
    clients.sort((a, b) => b.totalHours - a.totalHours);

    // ── 6. Compute totals ──
    let totalHours = 0;
    let totalBillableHours = 0;
    let totalCUsInPeriod = 0;
    let totalContentItems = 0;
    const activityTotals: Record<string, number> = {};

    for (const c of clients) {
      totalHours += c.totalHours;
      totalBillableHours += c.billableHours;
      totalCUsInPeriod += c.cusDeliveredInPeriod;
      totalContentItems += c.contentItemsInPeriod;
      for (const [activity, h] of Object.entries(c.activityBreakdown)) {
        activityTotals[activity] = (activityTotals[activity] || 0) + h;
      }
    }

    // Round activity totals
    for (const key of Object.keys(activityTotals)) {
      activityTotals[key] = r2(activityTotals[key]);
    }

    const totals = {
      totalHours: r2(totalHours),
      totalBillableHours: r2(totalBillableHours),
      totalCUsInPeriod: r2(totalCUsInPeriod),
      totalContentItems,
      overallHoursPerCU:
        totalCUsInPeriod > 0 ? r2(totalHours / totalCUsInPeriod) : null,
      activityTotals,
    };

    return NextResponse.json({
      clients,
      totals,
      unmatchedProjects,
      meta: {
        from: fromISO,
        to: toISO,
        clockifyClientsCount: clockifyClients.length,
        timeEntriesCount: timeEntries.length,
      },
    });
  } catch (error: any) {
    console.error("Profitability GET error:", error.message);
    return NextResponse.json(
      { error: error.message, details: error.details || null },
      { status: 500 }
    );
  }
}
