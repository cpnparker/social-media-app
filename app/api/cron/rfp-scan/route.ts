import { NextRequest, NextResponse } from "next/server";
import { intelligenceDb } from "@/lib/supabase-intelligence";
import { searchForRfps, SearchProvider } from "@/lib/rfp/search";
import { sendScanNotifications } from "@/lib/rfp/notifications";
import { computeNextRun } from "@/lib/rfp/schedule";
import { assertNotKilled, ServiceControlError } from "@/lib/admin/service-control";

export const maxDuration = 300;

// GET /api/cron/rfp-scan — Vercel Cron handler
// Processes ONE due scheduled search per invocation
export async function GET(req: NextRequest) {
  // Verify cron secret
  const authHeader = req.headers.get("authorization");
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  // Control Centre kill switch.
  try {
    await assertNotKilled("engine", "rfp-search");
  } catch (e) {
    if (e instanceof ServiceControlError && e.reason === "killed") {
      return NextResponse.json({ status: "disabled", reason: e.message });
    }
    throw e;
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
      // Fetch workspace company profile for AI context
      let companyProfile: string | undefined;
      try {
        const { data: profile } = await intelligenceDb
          .from("rfp_company_profiles")
          .select("document_overview, document_services, document_sectors, document_differentiators, document_target_rfps")
          .eq("id_workspace", dueSearch.id_workspace)
          .maybeSingle();

        if (profile) {
          companyProfile = [
            profile.document_overview,
            profile.document_services ? `Core Services:\n${profile.document_services}` : "",
            profile.document_sectors ? `Key Sectors:\n${profile.document_sectors}` : "",
            profile.document_differentiators ? `Differentiators:\n${profile.document_differentiators}` : "",
            profile.document_target_rfps ? `Target RFP Types:\n${profile.document_target_rfps}` : "",
          ].filter(Boolean).join("\n\n");
        }
      } catch (profileErr) {
        console.warn("[RFP Cron] Could not load company profile, using default:", profileErr);
      }

      // Run the AI-powered search
      const config = dueSearch.config_search || {};
      const result = await searchForRfps({
        query: dueSearch.query || undefined,
        sectors: config.sectors?.length ? config.sectors : undefined,
        regions: config.regions?.length ? config.regions : undefined,
        sources: config.sources?.length ? config.sources : undefined,
        provider: (dueSearch.type_provider || "anthropic") as SearchProvider,
        companyProfile,
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

      // Populate digest queue for daily/weekly digest users
      if (newOpps.length > 0) {
        await intelligenceDb.from("rfp_digest_queue").insert(
          newOpps.map((opp) => ({
            id_workspace: dueSearch.id_workspace,
            id_scan: scanLog?.id_scan,
            name_search: dueSearch.name,
            title: opp.title,
            organisation_name: opp.organisation,
            date_deadline: opp.deadline || null,
            document_scope: opp.scope,
            units_relevance_score: opp.relevanceScore,
            url_source: opp.sourceUrl || null,
          }))
        );
      }

      // Send real-time notifications for new high-relevance RFPs
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
