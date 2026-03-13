import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { intelligenceDb } from "@/lib/supabase-intelligence";
import { verifyWorkspaceMembership } from "@/lib/permissions";
import { createDefaultSections, createSectionsForOpportunity } from "@/lib/rfp/section-templates";

// GET /api/rfp/responses?workspaceId=...
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
    const { data, error } = await intelligenceDb
      .from("rfp_responses")
      .select("*")
      .eq("id_workspace", workspaceId)
      .order("date_updated", { ascending: false });

    if (error) throw error;

    return NextResponse.json({ responses: data || [] });
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}

export const maxDuration = 60; // AI section analysis may take time

// POST /api/rfp/responses — create a new response
export async function POST(req: NextRequest) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const userId = parseInt(session.user.id, 10);

  try {
    const body = await req.json();
    const { workspaceId, title, opportunityId } = body;

    if (!workspaceId || !title) {
      return NextResponse.json({ error: "workspaceId and title are required" }, { status: 400 });
    }

    const memberRole = await verifyWorkspaceMembership(userId, workspaceId);
    if (!memberRole) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    // If linked to an opportunity, generate tailored sections based on RFP
    let sections;
    if (opportunityId) {
      const { data: opp } = await intelligenceDb
        .from("rfp_opportunities")
        .select("title, organisation_name, document_scope, document_ai_reasoning, tags_sectors")
        .eq("id_opportunity", opportunityId)
        .single();

      if (opp) {
        sections = await createSectionsForOpportunity(opp);
      } else {
        sections = createDefaultSections();
      }
    } else {
      sections = createDefaultSections();
    }

    const { data, error } = await intelligenceDb
      .from("rfp_responses")
      .insert({
        id_workspace: workspaceId,
        id_opportunity: opportunityId || null,
        title,
        type_status: "drafting",
        config_win_themes: [],
        document_sections: sections,
        user_created: userId,
      })
      .select()
      .single();

    if (error) throw error;

    return NextResponse.json({ response: data });
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
