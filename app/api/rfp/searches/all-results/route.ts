import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { intelligenceDb } from "@/lib/supabase-intelligence";
import { verifyWorkspaceMembership } from "@/lib/permissions";

// GET /api/rfp/searches/all-results?workspaceId=...
// Returns all discovered RFPs across all searches, deduplicated and enriched
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
    // Fetch all searches and all saved opportunities in parallel
    const [searchesRes, oppsRes] = await Promise.all([
      intelligenceDb
        .from("rfp_searches")
        .select("id_search, query, results, type_provider, date_created, name_user_created")
        .eq("id_workspace", workspaceId)
        .order("date_created", { ascending: false }),
      intelligenceDb
        .from("rfp_opportunities")
        .select("id_opportunity, title, url_source, type_status, organisation_name")
        .eq("id_workspace", workspaceId),
    ]);

    if (searchesRes.error) throw searchesRes.error;
    if (oppsRes.error) throw oppsRes.error;

    const searches = searchesRes.data || [];
    const opportunities = oppsRes.data || [];

    // Build a lookup of saved opportunities by sourceUrl and title+org
    const oppByUrl = new Map<string, { id: string; status: string }>();
    const oppByTitleOrg = new Map<string, { id: string; status: string }>();
    for (const opp of opportunities) {
      const info = { id: opp.id_opportunity, status: opp.type_status };
      if (opp.url_source) {
        oppByUrl.set(opp.url_source.toLowerCase().replace(/\/+$/, ""), info);
      }
      const key = `${(opp.title || "").toLowerCase().trim()}|${(opp.organisation_name || "").toLowerCase().trim()}`;
      oppByTitleOrg.set(key, info);
    }

    // Flatten all search results and deduplicate
    const dedupMap = new Map<string, any>();
    let totalBeforeDedup = 0;

    for (const search of searches) {
      const results = search.results;
      if (!Array.isArray(results)) continue;

      for (const rfp of results) {
        if (!rfp || !rfp.title) continue;
        totalBeforeDedup++;

        // Compute dedup key: sourceUrl if available, else title+org
        let dedupKey: string;
        if (rfp.sourceUrl) {
          dedupKey = `url:${rfp.sourceUrl.toLowerCase().replace(/\/+$/, "")}`;
        } else {
          dedupKey = `title:${rfp.title.toLowerCase().trim()}|${(rfp.organisation || "").toLowerCase().trim()}`;
        }

        const existing = dedupMap.get(dedupKey);
        if (existing) {
          // Merge: keep higher score, track additional search
          existing.foundInSearches++;
          if (search.date_created < existing.firstFoundDate) {
            existing.firstFoundDate = search.date_created;
          }
          if (search.date_created > existing.lastFoundDate) {
            existing.lastFoundDate = search.date_created;
            existing.searchId = search.id_search;
            existing.searchQuery = search.query;
            existing.provider = search.type_provider;
          }
          if ((rfp.relevanceScore || 0) > (existing.relevanceScore || 0)) {
            // Update with higher-scoring version's details
            Object.assign(existing, {
              ...rfp,
              // Preserve aggregation metadata
              firstFoundDate: existing.firstFoundDate,
              lastFoundDate: existing.lastFoundDate,
              foundInSearches: existing.foundInSearches,
              searchId: existing.searchId,
              searchQuery: existing.searchQuery,
              provider: existing.provider,
              pipelineStatus: existing.pipelineStatus,
              opportunityId: existing.opportunityId,
            });
          }
        } else {
          // First time seeing this RFP
          const entry = {
            ...rfp,
            firstFoundDate: search.date_created,
            lastFoundDate: search.date_created,
            foundInSearches: 1,
            searchQuery: search.query || null,
            searchId: search.id_search,
            provider: search.type_provider || "anthropic",
            pipelineStatus: null as string | null,
            opportunityId: null as string | null,
          };

          // Cross-reference with pipeline
          const urlKey = rfp.sourceUrl?.toLowerCase().replace(/\/+$/, "");
          const titleOrgKey = `${rfp.title.toLowerCase().trim()}|${(rfp.organisation || "").toLowerCase().trim()}`;
          const pipelineMatch = (urlKey && oppByUrl.get(urlKey)) || oppByTitleOrg.get(titleOrgKey);
          if (pipelineMatch) {
            entry.pipelineStatus = pipelineMatch.status;
            entry.opportunityId = pipelineMatch.id;
          }

          dedupMap.set(dedupKey, entry);
        }
      }
    }

    // Convert to sorted array (newest first by default)
    const rfps = Array.from(dedupMap.values()).sort(
      (a, b) => new Date(b.lastFoundDate).getTime() - new Date(a.lastFoundDate).getTime()
    );

    return NextResponse.json({
      rfps,
      totalSearches: searches.length,
      totalBeforeDedup,
    });
  } catch (error: any) {
    console.error("[RFP All Results] Error:", error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
