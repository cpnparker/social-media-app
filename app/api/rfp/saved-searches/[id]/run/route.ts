import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { intelligenceDb } from "@/lib/supabase-intelligence";
import { supabase } from "@/lib/supabase";
import { verifyWorkspaceMembership } from "@/lib/permissions";
import { searchForRfps, SearchProvider } from "@/lib/rfp/search";

export const maxDuration = 120;

// POST /api/rfp/saved-searches/[id]/run — manually trigger a saved search
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const userId = parseInt(session.user.id, 10);
  const { id } = await params;

  try {
    const { data: savedSearch } = await intelligenceDb
      .from("rfp_saved_searches")
      .select("*")
      .eq("id_saved_search", id)
      .single();

    if (!savedSearch) {
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    }

    const memberRole = await verifyWorkspaceMembership(userId, savedSearch.id_workspace);
    if (!memberRole) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    // Fetch workspace company profile for AI context
    let companyProfile: string | undefined;
    try {
      const { data: profile } = await intelligenceDb
        .from("rfp_company_profiles")
        .select("document_overview, document_services, document_sectors, document_differentiators, document_target_rfps")
        .eq("id_workspace", savedSearch.id_workspace)
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
      console.warn("[RFP Saved Search] Could not load company profile, using default:", profileErr);
    }

    // Run the search using the saved configuration
    const config = savedSearch.config_search || {};
    const result = await searchForRfps({
      query: savedSearch.query || undefined,
      sectors: config.sectors?.length ? config.sectors : undefined,
      regions: config.regions?.length ? config.regions : undefined,
      sources: config.sources?.length ? config.sources : undefined,
      provider: (savedSearch.type_provider || "anthropic") as SearchProvider,
      companyProfile,
    });

    // Look up user name
    const { data: user } = await supabase
      .from("users")
      .select("name_user")
      .eq("id_user", userId)
      .single();

    // Save to rfp_searches (same as manual search)
    await intelligenceDb.from("rfp_searches").insert({
      id_workspace: savedSearch.id_workspace,
      query: savedSearch.query || null,
      config_search: config,
      type_provider: savedSearch.type_provider || "anthropic",
      results: result.opportunities,
      document_summary: result.searchSummary,
      units_result_count: result.opportunities.length,
      user_created: userId,
      name_user_created: user?.name_user || null,
    });

    // Update date_last_run on the saved search
    await intelligenceDb
      .from("rfp_saved_searches")
      .update({
        date_last_run: new Date().toISOString(),
        date_updated: new Date().toISOString(),
      })
      .eq("id_saved_search", id);

    return NextResponse.json(result);
  } catch (error: any) {
    console.error("[RFP Saved Search Run] Error:", error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
