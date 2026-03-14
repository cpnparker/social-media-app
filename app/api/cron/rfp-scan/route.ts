import { NextRequest, NextResponse } from "next/server";
import { intelligenceDb } from "@/lib/supabase-intelligence";
import { searchForRfps, SearchProvider } from "@/lib/rfp/search";
import { sendScanNotifications } from "@/lib/rfp/notifications";
import { computeNextRun } from "@/lib/rfp/schedule";

export const maxDuration = 300;

// GET /api/cron/rfp-scan — Vercel Cron handler
// Processes ONE due scheduled search per invocation
export async function GET(req: NextRequest) {
  // Verify cron secret
  const authHeader = req.headers.get("authorization");
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    // Find the oldest due search
    const { data: dueSearch } = await intelligenceDb
      .from("rfp_saved_searches")
      .select("*")
      .eq("flag_schedule_enabled", 1)
      .lte("date_next_run", new Date().toISOString())
      .order("date_next_run", { ascending: true })
      .limit(1)
      .maybeSingle();

    if (!dueSearch) {
      return NextResponse.json({ message: "No due searches" });
    }

    // Create scan log entry
    const { data: scanLog } = await intelligenceDb
      .from("rfp_scan_log")
      .insert({
        id_saved_search: dueSearch.id_saved_search,
        id_workspace: dueSearch.id_workspace,
        type_status: "running",
      })
      .select()
      .single();

    try {
      // Run the AI-powered search
      const config = dueSearch.config_search || {};
      const result = await searchForRfps({
        query: dueSearch.query || undefined,
        sectors: config.sectors?.length ? config.sectors : undefined,
        regions: config.regions?.length ? config.regions : undefined,
        sources: config.sources?.length ? config.sources : undefined,
        provider: (dueSearch.type_provider || "anthropic") as SearchProvider,
      });

      // Deduplicate against existing NON-EXPIRED pipeline opportunities.
      // Expired ones are ignored so that if a new edition of the same RFP
      // is published, it's treated as a new opportunity.
      const today = new Date().toISOString().split("T")[0];
      const { data: existingOpps } = await intelligenceDb
        .from("rfp_opportunities")
        .select("title, url_source")
        .eq("id_workspace", dueSearch.id_workspace)
        .or(`date_deadline.is.null,date_deadline.gte.${today}`);

      const existingTitles = new Set(
        (existingOpps || []).map((o: any) => o.title.toLowerCase().trim())
      );
      const existingUrls = new Set(
        (existingOpps || [])
          .filter((o: any) => o.url_source)
          .map((o: any) => o.url_source)
      );

      const newOpps = result.opportunities.filter((opp) => {
        const titleKey = opp.title.toLowerCase().trim();
        if (existingTitles.has(titleKey)) return false;
        if (opp.sourceUrl && existingUrls.has(opp.sourceUrl)) return false;
        return true;
      });

      // Save raw search results to rfp_searches
      await intelligenceDb.from("rfp_searches").insert({
        id_workspace: dueSearch.id_workspace,
        query: dueSearch.query || null,
        config_search: config,
        type_provider: dueSearch.type_provider || "anthropic",
        results: result.opportunities,
        document_summary: result.searchSummary,
        units_result_count: result.opportunities.length,
        user_created: dueSearch.user_created,
        name_user_created: dueSearch.name_user_created || "Scheduled Scan",
      });

      // Send notifications for new high-relevance RFPs
      let notifiedCount = 0;
      if (newOpps.length > 0) {
        notifiedCount = await sendScanNotifications(
          dueSearch.id_workspace,
          dueSearch.name,
          newOpps
        );
      }

      // Update scan log to completed
      if (scanLog) {
        await intelligenceDb
          .from("rfp_scan_log")
          .update({
            type_status: "completed",
            units_total_found: result.opportunities.length,
            units_new_found: newOpps.length,
            units_notified: notifiedCount,
            results: newOpps,
            date_completed: new Date().toISOString(),
          })
          .eq("id_scan", scanLog.id_scan);
      }

      // Advance schedule
      const nextRun = computeNextRun(dueSearch.type_schedule, dueSearch.config_schedule);
      await intelligenceDb
        .from("rfp_saved_searches")
        .update({
          date_last_run: new Date().toISOString(),
          date_next_run: nextRun.toISOString(),
          date_updated: new Date().toISOString(),
        })
        .eq("id_saved_search", dueSearch.id_saved_search);

      return NextResponse.json({
        searchName: dueSearch.name,
        totalFound: result.opportunities.length,
        newFound: newOpps.length,
        notified: notifiedCount,
      });
    } catch (error: any) {
      // Log failure but still advance schedule to prevent infinite retry
      if (scanLog) {
        await intelligenceDb
          .from("rfp_scan_log")
          .update({
            type_status: "failed",
            document_error: error.message,
            date_completed: new Date().toISOString(),
          })
          .eq("id_scan", scanLog.id_scan);
      }

      const nextRun = computeNextRun(dueSearch.type_schedule, dueSearch.config_schedule);
      await intelligenceDb
        .from("rfp_saved_searches")
        .update({
          date_last_run: new Date().toISOString(),
          date_next_run: nextRun.toISOString(),
          date_updated: new Date().toISOString(),
        })
        .eq("id_saved_search", dueSearch.id_saved_search);

      console.error("[RFP Cron] Scan failed:", error);
      return NextResponse.json({ error: error.message }, { status: 500 });
    }
  } catch (error: any) {
    console.error("[RFP Cron] Fatal error:", error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
