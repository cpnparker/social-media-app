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

    // VALIDATE the scope: it was taken straight from the request body, so an
    // arbitrary string ("Team", "shared", anything) fell through every
    // comparison below and was written to type_scope verbatim — a value the
    // read gates treat as neither private nor team.
    if (scope !== undefined && scope !== "private" && scope !== "team") {
      return NextResponse.json(
        { error: "scope must be 'private' or 'team'" },
        { status: 400 }
      );
    }

    // Privacy enforcement: check source conversation visibility
    let finalScope = scope || "private";
    let finalUserId: number | null = userId;
    let downgradedToPrivate = false;

    // ── Resolve the source conversation FIRST, and authorise it. ──
    // A team memory is injected into every workspace member's system prompt on
    // every turn, so promoting one is a workspace-wide act. The justification
    // for it must therefore be verified, not merely present: this lookup used
    // to select by id alone, so a caller could name a conversation in another
    // workspace — or simply create their own team conversation, which any
    // member may do — and have it count as authority.
    let sourceIsTeam = false;
    if (sourceConversationId) {
      const { data: conv } = await intelligenceDb
        .from("ai_conversations")
        .select("type_visibility, id_workspace, user_created")
        .eq("id_conversation", sourceConversationId)
        .maybeSingle();

      const sameWorkspace = !!conv && conv.id_workspace === workspaceId;
      // Readable by this caller: they own it, or it is team-visible.
      const readable = sameWorkspace &&
        (conv!.user_created === userId || conv!.type_visibility === "team");
      if (!conv || !sameWorkspace || !readable) {
        console.warn(`[Memories] user ${userId} referenced an unreadable/foreign source conversation — ignoring it`);
      } else {
        sourceIsTeam = conv.type_visibility === "team";
      }
      // A private (or unverifiable) source can ONLY produce a private memory.
      if (!sourceIsTeam) {
        finalScope = "private";
        finalUserId = userId;
      }
    }

    // ── Entitlement check on the FINAL scope, however it was reached. ──
    // Previously this ran only when no source conversation was supplied, so
    // passing any id skipped it entirely — the gate stopped nobody.
    if (finalScope === "team") {
      const { data: adminRow } = await intelligenceDb
        .from("users_access")
        .select("flag_access_admin")
        .eq("user_target", userId)
        .eq("id_workspace", workspaceId)
        .eq("flag_access_admin", 1)
        .limit(1)
        .maybeSingle();
      const isRoleAdmin = ["owner", "admin"].includes(String(memberRole || "").toLowerCase());
      if (!adminRow && !isRoleAdmin) {
        console.warn(`[Memories] user ${userId} not entitled to create a team memory — stored as private`);
        finalScope = "private";
        finalUserId = userId;
        downgradedToPrivate = true;
      } else {
        finalUserId = null;
      }
    } else {
      finalUserId = userId;
    }

    // Enforce 50-memory cap per user per workspace.
    // NOTE the and(): without it this reads as "(any private memory in the
    // workspace) OR (any memory I own)", so every colleague's private
    // memories counted towards YOUR cap and blocked saves you couldn't even
    // see, let alone archive. Matches the GET filter.
    const countFilter = finalUserId !== null
      ? `and(type_scope.eq.private,user_memory.eq.${userId})`
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

    // Tell the caller when their team request was stored as private, rather
    // than silently returning something different from what they asked for.
    return NextResponse.json({
      memory: mapMemory(memory),
      ...(downgradedToPrivate
        ? { notice: "Saved as a private memory. Team memories apply to everyone in the workspace, so only an admin can create one." }
        : {}),
    });
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
