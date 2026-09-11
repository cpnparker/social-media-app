import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { intelligenceDb } from "@/lib/supabase-intelligence";
import { verifyWorkspaceMembership } from "@/lib/permissions";

// GET /api/rfp/stats?workspaceId=...
// Returns aggregated dashboard stats for the RFP tool home page
export async function GET(req: NextRequest) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const userId = parseInt(session.user.id, 10);

  const { searchParams } = new URL(req.url);
  const workspaceId = searchParams.get("workspaceId");

  if (!workspaceId) {
    return NextResponse.json({ error: "workspaceId is required" }, { status: 400 });
  }

  const memberRole = await verifyWorkspaceMembership(userId, workspaceId);
  if (!memberRole) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  try {
    // Run all queries in parallel
    const [
      opportunitiesRes,
      responsesRes,
      searchesRes,
      savedSearchesRes,
    ] = await Promise.all([
      // All opportunities (including archived/ignored for full counts)
      intelligenceDb
        .from("rfp_opportunities")
        .select("id_opportunity, type_status, date_deadline, config_deadlines, title, organisation_name, document_value, units_relevance_score, date_created, url_source")
        .eq("id_workspace", workspaceId)
        .order("date_created", { ascending: false }),

      // All responses
      intelligenceDb
        .from("rfp_responses")
        .select("id_response, type_status, title, id_opportunity, id_user_assigned, name_user_assigned, document_sections, date_updated")
        .eq("id_workspace", workspaceId)
        .order("date_updated", { ascending: false }),

      // Recent searches (last 10)
      intelligenceDb
        .from("rfp_searches")
        .select("id_search, query, type_provider, units_result_count, name_user_created, date_created")
        .eq("id_workspace", workspaceId)
        .order("date_created", { ascending: false })
        .limit(10),

      // Saved searches
      intelligenceDb
        .from("rfp_saved_searches")
        .select("id_saved_search, name, flag_schedule_enabled, date_last_run, date_next_run, type_schedule")
        .eq("id_workspace", workspaceId),
    ]);

    if (opportunitiesRes.error) throw opportunitiesRes.error;
    if (responsesRes.error) throw responsesRes.error;
    if (searchesRes.error) throw searchesRes.error;
    if (savedSearchesRes.error) throw savedSearchesRes.error;

    const opps = opportunitiesRes.data || [];
    const responses = responsesRes.data || [];
    const searches = searchesRes.data || [];
    const savedSearches = savedSearchesRes.data || [];

    // Pipeline counts by status
    const pipelineCounts: Record<string, number> = {};
    for (const opp of opps) {
      pipelineCounts[opp.type_status] = (pipelineCounts[opp.type_status] || 0) + 1;
    }

    // Upcoming deadlines (next 30 days, only active statuses)
    const now = new Date();
    const thirtyDaysOut = new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000);
    const activeStatuses = ["discovered", "shortlisted", "in_progress"];
    const upcomingDeadlines = opps
      .filter((opp) => {
        if (!activeStatuses.includes(opp.type_status)) return false;
        if (!opp.date_deadline) return false;
        const d = new Date(opp.date_deadline);
        return d >= now && d <= thirtyDaysOut;
      })
      .sort((a, b) => new Date(a.date_deadline!).getTime() - new Date(b.date_deadline!).getTime())
      .slice(0, 8)
      .map((opp) => ({
        id: opp.id_opportunity,
        title: opp.title,
        organisation: opp.organisation_name,
        deadline: opp.date_deadline,
        status: opp.type_status,
        value: opp.document_value,
      }));

    // Response progress
    const responseStats = responses.map((r) => {
      const sections = r.document_sections || [];
      const total = sections.length;
      const completed = sections.filter((s: any) => s.status !== "empty").length;
      return {
        id: r.id_response,
        title: r.title,
        status: r.type_status,
        opportunityId: r.id_opportunity,
        assignedTo: r.name_user_assigned,
        totalSections: total,
        completedSections: completed,
        lastUpdated: r.date_updated,
      };
    });

    // Recent opportunities (last 5 added)
    const recentOpps = opps
      .filter((o) => !["ignored", "archived"].includes(o.type_status))
      .slice(0, 5)
      .map((opp) => ({
        id: opp.id_opportunity,
        title: opp.title,
        organisation: opp.organisation_name,
        deadline: opp.date_deadline,
        status: opp.type_status,
        value: opp.document_value,
        score: opp.units_relevance_score,
        dateAdded: opp.date_created,
        sourceUrl: opp.url_source,
      }));

    // Total estimated pipeline value (from opps in active statuses)
    const totalPipelineValue = opps
      .filter((o) => activeStatuses.includes(o.type_status))
      .reduce((sum, o) => {
        if (!o.document_value) return sum;
        // Try to extract numeric value from strings like "$50,000", "USD 100K", etc.
        const numMatch = o.document_value.replace(/[,\s]/g, "").match(/[\d.]+/);
        if (!numMatch) return sum;
        let val = parseFloat(numMatch[0]);
        if (/[kK]/.test(o.document_value)) val *= 1000;
        if (/[mM]/.test(o.document_value)) val *= 1000000;
        return sum + val;
      }, 0);

    return NextResponse.json({
      pipeline: {
        counts: pipelineCounts,
        totalActive: opps.filter((o) => activeStatuses.includes(o.type_status)).length,
        totalAll: opps.length,
        estimatedValue: totalPipelineValue,
      },
      upcomingDeadlines,
      recentOpportunities: recentOpps,
      responses: {
        active: responseStats.filter((r) => r.status !== "ready_to_submit"),
        total: responseStats.length,
        items: responseStats.slice(0, 5),
      },
      searches: {
        recent: searches,
        totalCount: searches.length,
        savedSearches: savedSearches.map((s) => ({
          id: s.id_saved_search,
          name: s.name,
          scheduled: s.flag_schedule_enabled === 1,
          schedule: s.type_schedule,
          lastRun: s.date_last_run,
          nextRun: s.date_next_run,
        })),
      },
    });
  } catch (error: any) {
    console.error("[RFP Stats] Error:", error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
