import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { intelligenceDb } from "@/lib/supabase-intelligence";
import { verifyWorkspaceMembership } from "@/lib/permissions";

// GET /api/ai/summaries?workspaceId=...
// Returns conversations with summaries (private + shared only, never team)
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

  // Verify user belongs to this workspace
  const memberRole = await verifyWorkspaceMembership(userId, workspaceId);
  if (!memberRole) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  try {
    // Get conversation IDs shared with this user
    const { data: sharedWithMe } = await intelligenceDb
      .from("ai_shares")
      .select("id_conversation")
      .eq("user_recipient", userId);

    const sharedConvoIds = (sharedWithMe || []).map((s: any) => s.id_conversation);

    // Fetch conversations with summaries — user's private + shared-with-me (never team)
    let query = intelligenceDb
      .from("ai_conversations")
      .select("id_conversation, name_conversation, document_summary, units_summary_message_count, type_visibility, id_client, date_updated, date_created")
      .eq("id_workspace", workspaceId)
      .eq("flag_incognito", 0)
      .not("document_summary", "is", null);

    if (sharedConvoIds.length > 0) {
      query = query.or(
        `and(type_visibility.eq.private,user_created.eq.${userId}),and(type_visibility.eq.private,id_conversation.in.(${sharedConvoIds.join(",")}))`
      );
    } else {
      query = query.eq("type_visibility", "private").eq("user_created", userId);
    }

    const { data: conversations, error } = await query
      .order("date_updated", { ascending: false })
      .limit(30);

    if (error) throw error;

    const summaries = (conversations || []).map((c: any) => ({
      id: c.id_conversation,
      title: c.name_conversation || "Untitled",
      summary: c.document_summary,
      messageCount: c.units_summary_message_count || 0,
      clientId: c.id_client,
      updatedAt: c.date_updated,
      createdAt: c.date_created,
    }));

    return NextResponse.json({ summaries });
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
