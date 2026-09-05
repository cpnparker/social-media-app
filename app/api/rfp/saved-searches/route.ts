import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { intelligenceDb } from "@/lib/supabase-intelligence";
import { supabase } from "@/lib/supabase";
import { verifyWorkspaceMembership } from "@/lib/permissions";

// GET /api/rfp/saved-searches?workspaceId=...
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
      .from("rfp_saved_searches")
      .select("*")
      .eq("id_workspace", workspaceId)
      .order("date_created", { ascending: false });

    if (error) throw error;

    return NextResponse.json({ savedSearches: data || [] });
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}

// POST /api/rfp/saved-searches — create a new saved search configuration
export async function POST(req: NextRequest) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const userId = parseInt(session.user.id, 10);

  try {
    const body = await req.json();
    const { workspaceId, name, query, config, provider } = body;

    if (!workspaceId || !name) {
      return NextResponse.json({ error: "workspaceId and name are required" }, { status: 400 });
    }

    const memberRole = await verifyWorkspaceMembership(userId, workspaceId);
    if (!memberRole) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    // Look up user name
    const { data: user } = await supabase
      .from("users")
      .select("name_user")
      .eq("id_user", userId)
      .single();

    const { data, error } = await intelligenceDb
      .from("rfp_saved_searches")
      .insert({
        id_workspace: workspaceId,
        name,
        query: query || null,
        config_search: config || {},
        type_provider: provider || "anthropic",
        user_created: userId,
        name_user_created: user?.name_user || null,
      })
      .select()
      .single();

    if (error) throw error;

    return NextResponse.json({ savedSearch: data });
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
