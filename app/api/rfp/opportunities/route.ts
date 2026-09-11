import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { intelligenceDb } from "@/lib/supabase-intelligence";
import { verifyWorkspaceMembership } from "@/lib/permissions";

// GET /api/rfp/opportunities?workspaceId=...&status=...
export async function GET(req: NextRequest) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const userId = parseInt(session.user.id, 10);

  const { searchParams } = new URL(req.url);
  const workspaceId = searchParams.get("workspaceId");
  const status = searchParams.get("status");

  if (!workspaceId) {
    return NextResponse.json({ error: "workspaceId is required" }, { status: 400 });
  }

  const memberRole = await verifyWorkspaceMembership(userId, workspaceId);
  if (!memberRole) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  try {
    const includeExpired = searchParams.get("includeExpired") === "true";

    let query = intelligenceDb
      .from("rfp_opportunities")
      .select("*")
      .eq("id_workspace", workspaceId)
      .order("date_created", { ascending: false });

    if (status) {
      query = query.eq("type_status", status);
    }

    // By default, exclude opportunities whose deadline has passed.
    // Opportunities without a deadline are always included.
    // "won" and "submitted" statuses are kept regardless of deadline
    // (they're historical records, not active pursuits).
    if (!includeExpired) {
      const today = new Date().toISOString().split("T")[0];
      query = query.or(`date_deadline.is.null,date_deadline.gte.${today},type_status.in.(won,submitted)`);
    }

    const { data, error } = await query;
    if (error) throw error;

    return NextResponse.json({ opportunities: data || [] });
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}

// POST /api/rfp/opportunities — save a discovered RFP
export async function POST(req: NextRequest) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const userId = parseInt(session.user.id, 10);

  try {
    const body = await req.json();
    const {
      workspaceId,
      title,
      organisationName,
      deadline,
      milestones,
      scope,
      sectors,
      region,
      estimatedValue,
      sourceUrl,
      relevanceScore,
      aiReasoning,
      status,
    } = body;

    if (!workspaceId || !title || !organisationName) {
      return NextResponse.json({ error: "Missing required fields" }, { status: 400 });
    }

    const memberRole = await verifyWorkspaceMembership(userId, workspaceId);
    if (!memberRole) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    const insertPayload: any = {
      id_workspace: workspaceId,
      title,
      organisation_name: organisationName,
      date_deadline: deadline || null,
      document_scope: scope || null,
      tags_sectors: sectors || [],
      name_region: region || null,
      document_value: estimatedValue || null,
      url_source: sourceUrl || null,
      units_relevance_score: relevanceScore || null,
      document_ai_reasoning: aiReasoning || null,
      config_deadlines: milestones || [],
      type_status: status || "shortlisted",
      user_created: userId,
    };

    // URL verification metadata — only include when present
    // (columns may not exist in older schemas)
    if (body.urlConfidence) insertPayload.type_url_confidence = body.urlConfidence;
    if (body.portalName) insertPayload.name_portal = body.portalName;
    if (body.portalSearchUrl) insertPayload.url_portal_search = body.portalSearchUrl;

    const { data, error } = await intelligenceDb
      .from("rfp_opportunities")
      .insert(insertPayload)
      .select()
      .single();

    if (error) throw error;

    return NextResponse.json({ opportunity: data });
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
