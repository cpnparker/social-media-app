import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { intelligenceDb } from "@/lib/supabase-intelligence";
import { verifyWorkspaceMembership } from "@/lib/permissions";

/**
 * GET /api/ai/design/assets
 *   Query params:
 *     - workspaceId (required)
 *     - conversationId (optional) — scope to one design session's canvas
 *     - clientId (optional) — scope to one client's library (across sessions)
 *     - limit (default 100, max 200)
 *
 * Returns rows from intelligence.ai_design_assets newest-first.
 */
export async function GET(req: NextRequest) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const userId = parseInt(session.user.id, 10);

  const { searchParams } = new URL(req.url);
  const workspaceId = searchParams.get("workspaceId");
  const conversationId = searchParams.get("conversationId");
  const clientId = searchParams.get("clientId");
  const contentId = searchParams.get("contentId");
  const limit = Math.min(parseInt(searchParams.get("limit") || "100", 10), 200);

  if (!workspaceId) {
    return NextResponse.json({ error: "workspaceId is required" }, { status: 400 });
  }

  const memberRole = await verifyWorkspaceMembership(userId, workspaceId);
  if (!memberRole) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  let query = intelligenceDb
    .from("ai_design_assets")
    .select("*")
    .eq("id_workspace", workspaceId)
    .eq("flag_archived", 0)
    .order("date_created", { ascending: false })
    .limit(limit);

  if (conversationId) query = query.eq("id_conversation", conversationId);
  if (clientId) query = query.eq("id_client", parseInt(clientId, 10));
  if (contentId) query = query.eq("id_content", parseInt(contentId, 10));

  const { data, error } = await query;
  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
  return NextResponse.json({ assets: data || [] });
}

/**
 * PATCH /api/ai/design/assets — toggle pin / archive flags.
 *   Body: { id_asset, flag_pinned?, flag_archived? }
 */
export async function PATCH(req: NextRequest) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const userId = parseInt(session.user.id, 10);

  const body = await req.json();
  const { id_asset, flag_pinned, flag_archived, id_content } = body;
  if (!id_asset) {
    return NextResponse.json({ error: "id_asset is required" }, { status: 400 });
  }

  // Verify the user owns this asset (or shares its workspace).
  const { data: asset } = await intelligenceDb
    .from("ai_design_assets")
    .select("id_workspace, user_created")
    .eq("id_asset", id_asset)
    .maybeSingle();

  if (!asset) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const memberRole = await verifyWorkspaceMembership(userId, (asset as any).id_workspace);
  if (!memberRole) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const patch: Record<string, unknown> = {};
  if (typeof flag_pinned === "number") patch.flag_pinned = flag_pinned ? 1 : 0;
  if (typeof flag_archived === "number") patch.flag_archived = flag_archived ? 1 : 0;
  // id_content: null clears the link, number sets it.
  if (id_content === null) patch.id_content = null;
  else if (typeof id_content === "number") patch.id_content = id_content;
  if (Object.keys(patch).length === 0) {
    return NextResponse.json({ error: "Nothing to update" }, { status: 400 });
  }

  const { error } = await intelligenceDb
    .from("ai_design_assets")
    .update(patch)
    .eq("id_asset", id_asset);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}
