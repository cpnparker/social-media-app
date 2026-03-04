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

  const from = fromParam
    ? `${fromParam}T00:00:00Z`
    : twelveMonthsAgo.toISOString();
  const to = toParam
    ? `${toParam}T23:59:59Z`
    : now.toISOString();

  try {
    // ── 1. Fetch Clockify data in parallel ──
    const [clockifyClients, clockifyProjects, timeEntries] = await Promise.all([
      getClockifyClients(),
      getClockifyProjects(),
      getAllTimeEntries(from, to),
    ]);

    // ── 2. Build per-client hour aggregation from Clockify ──
    const { byClient, unmatchedProjects } = buildClientProfitability(
      timeEntries,
      clockifyProjects,
      clockifyClients
    );

    // ── 3. Fetch Supabase clients + contracts ──
    const [clientsRes, contractsRes] = await Promise.all([
      supabase.from("app_clients").select("*").order("name_client", { ascending: true }),
      supabase.from("app_contracts").select("*"),
    ]);

    const supabaseClients = clientsRes.data || [];
    const supabaseContracts = contractsRes.data || [];

    // Build Supabase client lookup by normalized name
    const supabaseClientByName = new Map<string, Record<string, any>>();
    for (const sc of supabaseClients) {
      const name = (sc.name_client || "").trim().toLowerCase();
      supabaseClientByName.set(name, sc);
    }

    // Group contracts by client id
    const contractsByClientId = new Map<string, Record<string, any>[]>();
    for (const c of supabaseContracts) {
      const cid = String(c.id_client);
      if (!contractsByClientId.has(cid)) contractsByClientId.set(cid, []);
      contractsByClientId.get(cid)!.push(c);
    }

    // ── 4. Build client name lookup from Clockify ──
    const clockifyClientNameMap = new Map<string, string>();
    for (const c of clockifyClients) {
      clockifyClientNameMap.set(c.id, c.name);
    }

    // ── 5. Join Clockify hours with Supabase CU data ──
    const clients: {
      clockifyClientId: string;
      clientName: string;
      totalHours: number;
      billableHours: number;
      activityBreakdown: Record<string, number>;
      supabaseClientId: string | null;
      cusDelivered: number;
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
      const supabaseClientId = supabaseClient ? String(supabaseClient.id_client) : null;

      // Get contracts for this client
      let cusDelivered = 0;
      let cusContracted = 0;
      const clientContracts: typeof clients[0]["contracts"] = [];

      if (supabaseClientId) {
        const contracts = contractsByClientId.get(supabaseClientId) || [];
        for (const c of contracts) {
          const delivered = Number(c.units_total_completed) || 0;
          const contracted = Number(c.units_contract) || 0;
          cusDelivered += delivered;
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
        cusDelivered: r2(cusDelivered),
        cusContracted: r2(cusContracted),
        hoursPerCU: cusDelivered > 0 ? r2(hours.totalHours / cusDelivered) : null,
        contracts: clientContracts,
      });
    }

    // Sort by total hours descending
    clients.sort((a, b) => b.totalHours - a.totalHours);

    // ── 6. Compute totals ──
    let totalHours = 0;
    let totalBillableHours = 0;
    let totalCUsDelivered = 0;
    const activityTotals: Record<string, number> = {};

    for (const c of clients) {
      totalHours += c.totalHours;
      totalBillableHours += c.billableHours;
      totalCUsDelivered += c.cusDelivered;
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
      totalCUsDelivered: r2(totalCUsDelivered),
      overallHoursPerCU: totalCUsDelivered > 0 ? r2(totalHours / totalCUsDelivered) : null,
      activityTotals,
    };

    return NextResponse.json({
      clients,
      totals,
      unmatchedProjects,
      meta: { from, to, clockifyClientsCount: clockifyClients.length, timeEntriesCount: timeEntries.length },
    });
  } catch (error: any) {
    console.error("Profitability GET error:", error.message);
    return NextResponse.json(
      { error: error.message, details: error.details || null },
      { status: 500 }
    );
  }
}
