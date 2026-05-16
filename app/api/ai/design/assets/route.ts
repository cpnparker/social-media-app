import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { intelligenceDb } from "@/lib/supabase-intelligence";
import { verifyWorkspaceMembership } from "@/lib/permissions";
import { checkConversationAccess } from "@/lib/ai/access";

/**
 * GET /api/ai/design/assets
 *   Query params:
 *     - workspaceId (required)
 *     - conversationId (optional) — scope to one design session's canvas
 *     - clientId (optional) — scope to one client's library (across sessions)
 *     - contentId (optional) — scope to one content piece's design assets
 *     - limit (default 100, max 200)
 *
 * Privacy: assets are filtered to only those in conversations the user has
 * access to (own private + workspace team + explicitly shared). Incognito
 * conversations are always excluded from listings.
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

  // ── Path A: scoped to a specific conversation ──
  // Use checkConversationAccess so private/team/share rules are enforced exactly
  // the same way as for ai_messages.
  if (conversationId) {
    const { data: conv } = await intelligenceDb
      .from("ai_conversations")
      .select("type_visibility, user_created, id_workspace, flag_incognito")
      .eq("id_conversation", conversationId)
      .maybeSingle();
    if (!conv) {
      return NextResponse.json({ error: "Conversation not found" }, { status: 404 });
    }
    if ((conv as any).flag_incognito === 1) {
      // Incognito sessions never expose their assets — they don't show up
      // in any listing context.
      return NextResponse.json({ assets: [] });
    }
    const access = await checkConversationAccess(conversationId, userId, {
      visibility: (conv as any).type_visibility,
      userCreated: (conv as any).user_created,
      workspaceId: (conv as any).id_workspace,
    });
    if (!access.allowed) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    const { data, error } = await intelligenceDb
      .from("ai_design_assets")
      .select("*")
      .eq("id_workspace", workspaceId)
      .eq("id_conversation", conversationId)
      .eq("flag_archived", 0)
      .order("date_created", { ascending: false })
      .limit(limit);
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    return NextResponse.json({ assets: data || [] });
  }

  // ── Path B: cross-conversation listing by client or content ──
  // Build the set of conversation IDs the user has access to in this workspace,
  // then filter assets to those conversations only. Excludes incognito by design.
  const accessibleConvIds = await listAccessibleConversationIds(workspaceId, userId);

  let query = intelligenceDb
    .from("ai_design_assets")
    .select("*")
    .eq("id_workspace", workspaceId)
    .eq("flag_archived", 0)
    .order("date_created", { ascending: false })
    .limit(limit);

  if (clientId) query = query.eq("id_client", parseInt(clientId, 10));
  if (contentId) query = query.eq("id_content", parseInt(contentId, 10));

  // Constrain to accessible conversations OR session-less assets owned by the user.
  // (Assets without a conversation can't have visibility — fall back to creator-only.)
  if (accessibleConvIds.length > 0) {
    query = query.or(
      `id_conversation.in.(${accessibleConvIds.join(",")}),and(id_conversation.is.null,user_created.eq.${userId})`
    );
  } else {
    query = query.is("id_conversation", null).eq("user_created", userId);
  }

  const { data, error } = await query;
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ assets: data || [] });
}

/**
 * PATCH /api/ai/design/assets — toggle pin / archive flags, or attach to content.
 *   Body: { id_asset, flag_pinned?, flag_archived?, id_content? }
 *
 * Permission: requires owner OR collaborate access to the conversation the asset
 * belongs to. View-only shares cannot mutate assets.
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

  const { data: asset } = await intelligenceDb
    .from("ai_design_assets")
    .select("id_workspace, user_created, id_conversation")
    .eq("id_asset", id_asset)
    .maybeSingle();
  if (!asset) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const memberRole = await verifyWorkspaceMembership(userId, (asset as any).id_workspace);
  if (!memberRole) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  // If the asset belongs to a conversation, enforce the same access model as
  // messages. View-only shares can't mutate.
  const convId = (asset as any).id_conversation;
  if (convId) {
    const { data: conv } = await intelligenceDb
      .from("ai_conversations")
      .select("type_visibility, user_created, id_workspace, flag_incognito")
      .eq("id_conversation", convId)
      .maybeSingle();
    if (conv) {
      const access = await checkConversationAccess(convId, userId, {
        visibility: (conv as any).type_visibility,
        userCreated: (conv as any).user_created,
        workspaceId: (conv as any).id_workspace,
      });
      if (!access.allowed) {
        return NextResponse.json({ error: "Forbidden" }, { status: 403 });
      }
      if (access.permission === "view") {
        return NextResponse.json({ error: "Read-only access — cannot mutate" }, { status: 403 });
      }
    }
  } else {
    // Session-less asset — only its creator can mutate.
    if ((asset as any).user_created !== userId) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }
  }

  const patch: Record<string, unknown> = {};
  if (typeof flag_pinned === "number") patch.flag_pinned = flag_pinned ? 1 : 0;
  if (typeof flag_archived === "number") patch.flag_archived = flag_archived ? 1 : 0;
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

/**
 * Returns conversation IDs in this workspace that the user has access to:
 *   - own private
 *   - shared with user (any permission)
 *   - team
 * Always excludes incognito conversations.
 */
async function listAccessibleConversationIds(workspaceId: string, userId: number): Promise<string[]> {
  const { data: shared } = await intelligenceDb
    .from("ai_shares")
    .select("id_conversation")
    .eq("user_recipient", userId);
  const sharedIds = (shared || []).map((r: any) => r.id_conversation as string);

  let query = intelligenceDb
    .from("ai_conversations")
    .select("id_conversation")
    .eq("id_workspace", workspaceId)
    .eq("flag_incognito", 0);

  if (sharedIds.length > 0) {
    query = query.or(
      `and(type_visibility.eq.private,user_created.eq.${userId}),and(type_visibility.eq.private,id_conversation.in.(${sharedIds.join(",")})),type_visibility.eq.team`
    );
  } else {
    query = query.or(
      `and(type_visibility.eq.private,user_created.eq.${userId}),type_visibility.eq.team`
    );
  }

  const { data, error } = await query;
  if (error) {
    console.error("[design/assets] listAccessibleConversationIds error:", error.message);
    return [];
  }
  return (data || []).map((r: any) => r.id_conversation as string);
}
