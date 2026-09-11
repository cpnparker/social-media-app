import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { intelligenceDb } from "@/lib/supabase-intelligence";
import { mapMemory } from "@/lib/ai/response-mappers";
import { verifyWorkspaceMembership } from "@/lib/permissions";
import { createMemory } from "@/lib/ai/memory-create";

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

    // The whole contract — source authorisation, scope validation, the admin
    // entitlement and the 50-cap — lives in lib/ai/memory-create.ts so the
    // notebook's promote action shares it instead of copying it.
    const result = await createMemory({
      workspaceId, userId, memberRole, content, category, scope, sourceConversationId,
    });
    if (!result.ok) return NextResponse.json({ error: result.error }, { status: result.status });
    return NextResponse.json({
      memory: result.memory,
      ...(result.notice ? { notice: result.notice } : {}),
    });
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
