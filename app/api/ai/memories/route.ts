import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { intelligenceDb } from "@/lib/supabase-intelligence";
import { mapMemory } from "@/lib/ai/response-mappers";
import { verifyWorkspaceMembership } from "@/lib/permissions";

// GET /api/ai/memories?workspaceId=...
// Returns active memories: user's private + workspace team
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
    const { data: memories, error } = await intelligenceDb
      .from("ai_memories")
      .select("*")
      .eq("id_workspace", workspaceId)
      .eq("flag_active", 1)
      .or(`and(type_scope.eq.private,user_memory.eq.${userId}),type_scope.eq.team`)
      .order("date_created", { ascending: true });

    if (error) throw error;

    return NextResponse.json({ memories: (memories || []).map(mapMemory) });
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}

// POST /api/ai/memories
// Save a memory with privacy enforcement
export async function POST(req: NextRequest) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const userId = parseInt(session.user.id, 10);

  try {
    const body = await req.json();
    const { workspaceId, content, category, scope, sourceConversationId } = body;

    if (!workspaceId || !content) {
      return NextResponse.json(
        { error: "workspaceId and content are required" },
        { status: 400 }
      );
    }

    // Verify user belongs to this workspace
    const memberRole = await verifyWorkspaceMembership(userId, workspaceId);
    if (!memberRole) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    // Privacy enforcement: check source conversation visibility
    let finalScope = scope || "private";
    let finalUserId: number | null = userId;

    if (sourceConversationId) {
      const { data: conv } = await intelligenceDb
        .from("ai_conversations")
        .select("type_visibility")
        .eq("id_conversation", sourceConversationId)
        .maybeSingle();

      if (conv?.type_visibility === "private") {
        // Private conversations can ONLY produce private memories
        finalScope = "private";
        finalUserId = userId;
      } else if (finalScope === "team") {
        // Team conversation → team memory (userId = null)
        finalUserId = null;
      } else {
        // Team conversation, user chose private
        finalUserId = userId;
      }
    }

    // Enforce 50-memory cap per user per workspace
    const countFilter = finalUserId !== null
      ? `type_scope.eq.private,user_memory.eq.${userId}`
      : `type_scope.eq.team`;

    const { count: memoryCount } = await intelligenceDb
      .from("ai_memories")
      .select("*", { count: "exact", head: true })
      .eq("id_workspace", workspaceId)
      .eq("flag_active", 1)
      .or(countFilter);

    if ((memoryCount || 0) >= 50) {
      return NextResponse.json(
        { error: "Memory limit reached (50). Archive old memories to save new ones." },
        { status: 400 }
      );
    }

    const { data: memory, error } = await intelligenceDb
      .from("ai_memories")
      .insert({
        id_workspace: workspaceId,
        user_memory: finalUserId,
        type_scope: finalScope,
        type_category: category || "fact",
        information_content: content.slice(0, 500),
        id_conversation_source: sourceConversationId || null,
        type_source: "explicit", // User-created memories get highest trust
      })
      .select()
      .single();

    if (error) throw error;

    return NextResponse.json({ memory: mapMemory(memory) });
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
