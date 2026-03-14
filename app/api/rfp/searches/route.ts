import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { intelligenceDb } from "@/lib/supabase-intelligence";
import { supabase } from "@/lib/supabase";
import { verifyWorkspaceMembership } from "@/lib/permissions";

// GET /api/rfp/searches?workspaceId=...&limit=1
export async function GET(req: NextRequest) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const userId = parseInt(session.user.id, 10);

  const { searchParams } = new URL(req.url);
  const workspaceId = searchParams.get("workspaceId");
  const limit = Math.min(parseInt(searchParams.get("limit") || "1", 10), 20);

  if (!workspaceId) {
    return NextResponse.json({ error: "workspaceId is required" }, { status: 400 });
  }

  const memberRole = await verifyWorkspaceMembership(userId, workspaceId);
  if (!memberRole) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  try {
    const { data, error } = await intelligenceDb
      .from("rfp_searches")
      .select("*")
      .eq("id_workspace", workspaceId)
      .order("date_created", { ascending: false })
      .limit(limit);

    if (error) throw error;

    return NextResponse.json({ searches: data || [] });
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}

// POST /api/rfp/searches — save search results
export async function POST(req: NextRequest) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const userId = parseInt(session.user.id, 10);

  try {
    const body = await req.json();
    const { workspaceId, query, config, provider, results, summary } = body;

    if (!workspaceId) {
      return NextResponse.json({ error: "workspaceId is required" }, { status: 400 });
    }

    const memberRole = await verifyWorkspaceMembership(userId, workspaceId);
    if (!memberRole) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    // Look up user name for display
    const { data: user } = await supabase
      .from("users")
      .select("name_user")
      .eq("id_user", userId)
      .single();

    const { data, error } = await intelligenceDb
      .from("rfp_searches")
      .insert({
        id_workspace: workspaceId,
        query: query || null,
        config_search: config || {},
        type_provider: provider || "anthropic",
        results: results || [],
        document_summary: summary || null,
        units_result_count: results?.length || 0,
        user_created: userId,
        name_user_created: user?.name_user || null,
      })
      .select()
      .single();

    if (error) throw error;

    return NextResponse.json({ search: data });
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
