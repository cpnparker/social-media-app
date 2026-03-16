import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { intelligenceDb } from "@/lib/supabase-intelligence";
import { verifyWorkspaceMembership } from "@/lib/permissions";
import { searchForRfps } from "@/lib/rfp/search";

export const maxDuration = 120; // Web search can take a while

// POST /api/rfp/discover
export async function POST(req: NextRequest) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const userId = parseInt(session.user.id, 10);

  try {
    const body = await req.json();
    const { workspaceId, query, sectors, regions, provider, sources } = body;

    if (!workspaceId) {
      return NextResponse.json({ error: "workspaceId is required" }, { status: 400 });
    }

    const memberRole = await verifyWorkspaceMembership(userId, workspaceId);
    if (!memberRole) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    // Fetch workspace company profile (if customised) for AI context
    let companyProfile: string | undefined;
    try {
      const { data: profile } = await intelligenceDb
        .from("rfp_company_profiles")
        .select("document_overview, document_services, document_sectors, document_differentiators, document_target_rfps")
        .eq("id_workspace", workspaceId)
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
      console.warn("[RFP Discover] Could not load company profile, using default:", profileErr);
    }

    const result = await searchForRfps({ query, sectors, regions, sources, provider, companyProfile });

    return NextResponse.json(result);
  } catch (error: any) {
    console.error("[RFP Discover] Error:", error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
