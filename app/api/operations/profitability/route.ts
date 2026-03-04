import { NextRequest, NextResponse } from "next/server";
import { supabase } from "@/lib/supabase";
import { requireAuth } from "@/lib/permissions";
import {
  getClockifyClients,
  getClockifyProjects,
  getAllTimeEntries,
  buildClientProfitability,
  fuzzyMatchClient,
} from "@/lib/clockify";

const r2 = (n: number) => Math.round(n * 100) / 100;

// GET /api/operations/profitability
// ?from=YYYY-MM-DD  (default: 12 months ago)
// ?to=YYYY-MM-DD    (default: today)
export async function GET(req: NextRequest) {
  const authResult = await requireAuth();
  if (authResult instanceof NextResponse) return authResult;

  const { searchParams } = new URL(req.url);

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
    // ── 1. Fetch all data in parallel ──
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
      supabase
        .from("app_clients")
        .select("*")
        .order("name_client", { ascending: true }),
      supabase.from("app_contracts").select("*"),
      // Tasks completed in the period — sum units_content for CUs
      supabase
        .from("app_tasks_content")
        .select("id_client, id_contract, units_content, date_completed, flag_spiked")
        .gte("date_completed", fromISO)
        .lte("date_completed", toISO),
      supabase
        .from("app_tasks_social")
        .select("id_client, id_contract, units_content, date_completed, flag_spiked")
        .gte("date_completed", fromISO)
        .lte("date_completed", toISO),
    ]);

    // ── 2. Build Clockify per-client hour aggregation ──
    const { byClient, unmatchedProjects } = buildClientProfitability(
      timeEntries,
      clockifyProjects,
      clockifyClients
    );

    const supabaseClients = clientsRes.data || [];
    const supabaseContracts = contractsRes.data || [];
    const contentTasks = contentTasksRes.data || [];
    const socialTasks = socialTasksRes.data || [];

    // ── 3. Sum CUs per Supabase client for the period ──
    // No dedup — each task row has its own CU portion that must be summed.
    const periodCUsBySupabaseClient = new Map<
      string,
      { cus: number; taskCount: number }
    >();

    for (const t of contentTasks) {
      if (t.flag_spiked === 1) continue;
      const clientId = t.id_client ? String(t.id_client) : null;
      if (!clientId) continue;
      const cus = Number(t.units_content) || 0;
      const entry = periodCUsBySupabaseClient.get(clientId) || {
        cus: 0,
        taskCount: 0,
      };
      entry.cus += cus;
      entry.taskCount += 1;
      periodCUsBySupabaseClient.set(clientId, entry);
    }

    for (const t of socialTasks) {
      if (t.flag_spiked === 1) continue;
      const clientId = t.id_client ? String(t.id_client) : null;
      if (!clientId) continue;
      const cus = Number(t.units_content) || 0;
      const entry = periodCUsBySupabaseClient.get(clientId) || {
        cus: 0,
        taskCount: 0,
      };
      entry.cus += cus;
      entry.taskCount += 1;
      periodCUsBySupabaseClient.set(clientId, entry);
    }

    // ── 4. Build lookups ──
    const clockifyClientNameMap = new Map<string, string>();
    for (const c of clockifyClients) clockifyClientNameMap.set(c.id, c.name);

    // Supabase clients for fuzzy matching (simplified list)
    const supabaseClientList = supabaseClients.map(
      (sc: Record<string, any>) => ({
        id: String(sc.id_client),
        name: (sc.name_client || "").trim(),
      })
    );

    // Group contracts by Supabase client id, filtered to period overlap
    const contractsByClientId = new Map<string, Record<string, any>[]>();
    for (const c of supabaseContracts) {
      const cStart = c.date_start || null;
      const cEnd = c.date_end || null;
      const overlaps =
        (!cStart || cStart <= toISO) && (!cEnd || cEnd >= fromISO);
      if (!overlaps) continue;
      const cid = String(c.id_client);
      if (!contractsByClientId.has(cid)) contractsByClientId.set(cid, []);
      contractsByClientId.get(cid)!.push(c);
    }

    // ── 5. Join Clockify hours with Supabase CU data ──
    // Use fuzzy name matching to link Clockify clients → Supabase clients
    const matchLog: { clockify: string; supabase: string | null }[] = [];

    const clients: {
      clockifyClientId: string;
      clientName: string;
      totalHours: number;
      billableHours: number;
      activityBreakdown: Record<string, number>;
      supabaseClientId: string | null;
      supabaseClientName: string | null;
      cusInPeriod: number;
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
      const clockifyName =
        clockifyClientNameMap.get(clockifyClientId) || "Unknown";

      // Fuzzy match to Supabase
      const match = fuzzyMatchClient(clockifyName, supabaseClientList);
      const supabaseClientId = match ? match.id : null;
      const supabaseClientName = match ? match.name : null;

      matchLog.push({
        clockify: clockifyName,
        supabase: supabaseClientName,
      });

      // Get period CUs (sum of task CUs completed in the date range)
      const periodCUs = supabaseClientId
        ? periodCUsBySupabaseClient.get(supabaseClientId)
        : null;
      const cusInPeriod = periodCUs ? periodCUs.cus : 0;

      // Get overlapping contracts
      let cusContracted = 0;
      const clientContracts: (typeof clients)[0]["contracts"] = [];
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

      // hours/CU: use raw values for precision, then round
      const hoursPerCU =
        cusInPeriod > 0 ? r2(hours.totalHours / cusInPeriod) : null;

      clients.push({
        clockifyClientId,
        clientName: clockifyName,
        totalHours: r2(hours.totalHours),
        billableHours: r2(hours.billableHours),
        activityBreakdown: roundedBreakdown,
        supabaseClientId,
        supabaseClientName,
        cusInPeriod: r2(cusInPeriod),
        cusContracted: r2(cusContracted),
        hoursPerCU,
        contracts: clientContracts,
      });
    }

    // Sort by total hours descending
    clients.sort((a, b) => b.totalHours - a.totalHours);

    // ── 6. Compute totals ──
    let totalHours = 0;
    let totalBillableHours = 0;
    let totalCUsInPeriod = 0;
    const activityTotals: Record<string, number> = {};

    for (const c of clients) {
      totalHours += c.totalHours;
      totalBillableHours += c.billableHours;
      totalCUsInPeriod += c.cusInPeriod;
      for (const [activity, h] of Object.entries(c.activityBreakdown)) {
        activityTotals[activity] = (activityTotals[activity] || 0) + h;
      }
    }

    for (const key of Object.keys(activityTotals)) {
      activityTotals[key] = r2(activityTotals[key]);
    }

    const totals = {
      totalHours: r2(totalHours),
      totalBillableHours: r2(totalBillableHours),
      totalCUsInPeriod: r2(totalCUsInPeriod),
      overallHoursPerCU:
        totalCUsInPeriod > 0 ? r2(totalHours / totalCUsInPeriod) : null,
      activityTotals,
    };

    return NextResponse.json({
      clients,
      totals,
      unmatchedProjects,
      matchLog,
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
