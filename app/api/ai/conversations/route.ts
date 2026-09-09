import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { intelligenceDb } from "@/lib/supabase-intelligence";
import { supabase } from "@/lib/supabase";
import { mapConversation } from "@/lib/ai/response-mappers";
import { verifyWorkspaceMembership, hasEngineAiAccess } from "@/lib/permissions";

// GET /api/ai/conversations — list conversations
export async function GET(req: NextRequest) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const userId = parseInt(session.user.id, 10);

  const { searchParams } = new URL(req.url);
  const workspaceId = searchParams.get("workspaceId");
  const visibility = searchParams.get("visibility"); // 'private' | 'team' | null
  const contentObjectId = searchParams.get("contentObjectId");
  const customerId = searchParams.get("customerId");
  const search = searchParams.get("search");
  const mode = searchParams.get("mode"); // 'general' | 'design' — filter by conversation mode
  const limit = parseInt(searchParams.get("limit") || "100", 10);

  if (!workspaceId) {
    return NextResponse.json({ error: "workspaceId is required" }, { status: 400 });
  }

  // Verify user belongs to this workspace
  const memberRole = await verifyWorkspaceMembership(userId, workspaceId);
  if (!memberRole) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  try {
    // Get conversation IDs shared with this user (for private conversations they don't own)
    const { data: sharedWithMe } = await intelligenceDb
      .from("ai_shares")
      .select("id_conversation, user_shared, type_permission")
      .eq("user_recipient", userId);

    const sharedConvoIds = (sharedWithMe || []).map((s: any) => s.id_conversation);
    const sharedByMap = new Map(
      (sharedWithMe || []).map((s: any) => [
        s.id_conversation,
        { sharedBy: s.user_shared, permission: s.type_permission },
      ])
    );

    // Build query — always exclude incognito conversations.
    //
    // Applied through a function rather than inline because the pinned-thread
    // top-up below runs the SAME access rules over a different id set. Two
    // copies of an access filter is how one of them ends up looser than the
    // other, and this one decides who can read whose conversations.
    const applyScope = (q: any) => {
      q = q.eq("id_workspace", workspaceId).eq("flag_incognito", 0);
    if (visibility === "private") {
      // User's own private conversations + shared-with-me private conversations
      if (sharedConvoIds.length > 0) {
        q = q.or(
          `and(type_visibility.eq.private,user_created.eq.${userId}),and(type_visibility.eq.private,id_conversation.in.(${sharedConvoIds.join(",")}))`
        );
      } else {
        q = q.eq("type_visibility", "private").eq("user_created", userId);
      }
    } else if (visibility === "team") {
      q = q.eq("type_visibility", "team");
    } else {
      // Default: user's private + shared-with-me + all team conversations
      if (sharedConvoIds.length > 0) {
        q = q.or(
          `and(type_visibility.eq.private,user_created.eq.${userId}),and(type_visibility.eq.private,id_conversation.in.(${sharedConvoIds.join(",")})),type_visibility.eq.team`
        );
      } else {
        q = q.or(
          `and(type_visibility.eq.private,user_created.eq.${userId}),type_visibility.eq.team`
        );
      }
    }

    if (contentObjectId) {
      q = q.eq("id_content", parseInt(contentObjectId, 10));
    }

    if (customerId === "general") {
      // "General" = show ALL threads across all clients (no client filter)
    } else if (customerId) {
      q = q.eq("id_client", parseInt(customerId, 10));
    }

    if (mode === "design") {
      q = q.eq("type_conversation_mode", "design");
    } else if (mode === "meeting") {
      q = q.eq("type_conversation_mode", "meeting");
    } else if (mode === "general") {
      // Default chat surface — exclude design AND meeting sessions so they
      // don't pollute the main EngineAI list (column is NOT NULL DEFAULT
      // 'general', so a plain not-in is safe).
      q = q.not("type_conversation_mode", "in", '("design","meeting")');
    }

      return q;
    };

    let query = applyScope(intelligenceDb.from("ai_conversations").select("*"));

    if (search) {
      // Search across title AND summary (covers conversation content)
      const searchPattern = `%${search}%`;
      query = query.or(`name_conversation.ilike.${searchPattern},document_summary.ilike.${searchPattern}`);
    }

    const { data: conversations, error } = await query
      .order("date_updated", { ascending: false })
      .limit(limit);

    if (error) throw error;

    // PINNED THREADS ARE ALWAYS INCLUDED, whatever the date window.
    //
    // Pinning was a client-side SORT over a server-side page that knew nothing
    // about pins. The page is the 100 most recently updated conversations, so
    // the moment a workspace holds more than that, a pinned thread older than
    // the cutoff simply is not in the payload — and a pin quietly means the
    // opposite of what it says. Chris lost all four of his that way: still
    // stored, none returned, the oldest row in the page being three weeks
    // newer than any of them.
    //
    // Skipped while SEARCHING: a pin means keep this to hand, not force it
    // into results it does not match.
    if (!search) {
      const have = new Set((conversations || []).map((c: any) => c.id_conversation));
      const { data: prefRow } = await supabase
        .from("users")
        .select("data_pinned_conversations")
        .eq("id_user", userId)
        .maybeSingle();
      const pinnedIds: string[] = Array.isArray((prefRow as any)?.data_pinned_conversations)
        ? (prefRow as any).data_pinned_conversations
        : [];
      const absent = pinnedIds.filter((id) => id && !have.has(id));
      if (absent.length) {
        // Same access rules as the page above, by construction rather than by
        // a second copy of them — a pin must never widen what a user can read.
        const { data: pinnedRows } = await applyScope(
          intelligenceDb.from("ai_conversations").select("*")
        ).in("id_conversation", absent);
        if (pinnedRows?.length) (conversations || []).push(...pinnedRows);
      }
    }

    // If searching and few results from title/summary, also search message content
    let messageMatchIds: string[] = [];
    if (search && (conversations || []).length < 5) {
      const searchPattern = `%${search}%`;
      // Find conversations with matching message content
      const { data: msgMatches } = await intelligenceDb
        .from("ai_messages")
        .select("id_conversation")
        .ilike("document_message", searchPattern)
        .limit(20);

      if (msgMatches?.length) {
        messageMatchIds = Array.from(new Set(msgMatches.map((m: any) => m.id_conversation)));
        // Fetch those conversations (that aren't already in results)
        const existingIds = new Set((conversations || []).map((c: any) => c.id_conversation));
        const newIds = messageMatchIds.filter(id => !existingIds.has(id));

        if (newIds.length > 0) {
          const msgQuery = intelligenceDb
            .from("ai_conversations")
            .select("*")
            .eq("id_workspace", workspaceId)
            .in("id_conversation", newIds)
            .order("date_updated", { ascending: false })
            .limit(10);

          const { data: extraConvs } = await msgQuery;
          if (extraConvs?.length) {
            // Filter by access (same privacy rules)
            const accessible = extraConvs.filter((c: any) => {
              if (c.type_visibility === "team") return true;
              if (c.user_created === userId) return true;
              if (sharedConvoIds?.includes(c.id_conversation)) return true;
              return false;
            });
            conversations!.push(...accessible);
          }
        }
      }
    }

    // Resolve customer names from Supabase
    const customerIds = Array.from(
      new Set(
        (conversations || [])
          .map((c: any) => c.id_client)
          .filter((id: any): id is number => id !== null)
      )
    );

    let customerNameMap = new Map<number, string>();
    if (customerIds.length > 0) {
      const { data: clients } = await supabase
        .from("app_clients")
        .select("id_client, name_client")
        .in("id_client", customerIds);
      if (clients) {
        customerNameMap = new Map(
          clients.map((c: any) => [c.id_client, c.name_client])
        );
      }
    }

    // Resolve sharer names for shared-with-me conversations
    const sharerIds = Array.from(
      new Set(
        (conversations || [])
          .filter((c: any) => c.user_created !== userId && sharedByMap.has(c.id_conversation))
          .map((c: any) => sharedByMap.get(c.id_conversation)!.sharedBy)
      )
    );

    let sharerNameMap = new Map<number, string>();
    if (sharerIds.length > 0) {
      const { data: sharers } = await supabase
        .from("users")
        .select("id_user, name_user")
        .in("id_user", sharerIds);
      if (sharers) {
        sharerNameMap = new Map(
          sharers.map((u: any) => [u.id_user, u.name_user])
        );
      }
    }

    // WHICH THREADS ARE STILL GENERATING. Replies survive the browser leaving
    // — the messages route persists a pending row before it starts and keeps
    // draining if the client goes away — but nothing outside the open thread
    // ever said so, so firing three messages and walking away left the user
    // with no way to tell which were running, which were done, and which had
    // failed. One query over the page of conversations already fetched.
    //
    // Bounded the same way the reaper is (330s, above the messages route's
    // 300s ceiling): a row older than that is abandoned rather than live, and
    // showing it as generating would be a spinner that never stops.
    const listIds = (conversations || []).map((c: any) => c.id_conversation);
    const generating = new Set<string>();
    if (listIds.length) {
      const since = new Date(Date.now() - 330_000).toISOString();
      const { data: pendingRows } = await intelligenceDb
        .from("ai_messages")
        .select("id_conversation")
        .in("id_conversation", listIds)
        .eq("role_message", "assistant")
        .eq("status_message", "pending")
        .gte("date_created", since);
      for (const r of pendingRows || []) generating.add(r.id_conversation);
    }

    const enriched = (conversations || []).map((c: any) => {
      const isSharedWithMe = c.user_created !== userId && sharedByMap.has(c.id_conversation);
      const shareInfo = sharedByMap.get(c.id_conversation);
      return {
        ...mapConversation(c),
        generating: generating.has(c.id_conversation) || undefined,
        customerName: c.id_client ? customerNameMap.get(c.id_client) || null : null,
        sharedWithMe: isSharedWithMe || undefined,
        myPermission: c.user_created === userId
          ? ("owner" as const)
          : isSharedWithMe
          ? (shareInfo!.permission as "view" | "collaborate")
          : undefined,
        sharedByName: isSharedWithMe
          ? sharerNameMap.get(shareInfo!.sharedBy) || null
          : undefined,
      };
    });

    return NextResponse.json({ conversations: enriched });
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}

// POST /api/ai/conversations — create a new conversation
export async function POST(req: NextRequest) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const userId = parseInt(session.user.id, 10);

  try {
    const body = await req.json();
    const { workspaceId, title, visibility, contentObjectId, customerId, model, isIncognito, mode } = body;

    if (!workspaceId) {
      return NextResponse.json({ error: "workspaceId is required" }, { status: 400 });
    }

    // Validate the enum on CREATE, exactly as PATCH does. An arbitrary string
    // reads as not-"team" to the privacy gates (personal tools allowed) but as
    // not-"private" to the memory-scope logic (memories written workspace-wide)
    // — the read gate and the write gate would disagree about the same thread.
    if (visibility !== undefined && visibility !== null && visibility !== "private" && visibility !== "team") {
      return NextResponse.json(
        { error: "visibility must be 'private' or 'team'" },
        { status: 400 }
      );
    }

    // Verify user belongs to this workspace
    const memberRole = await verifyWorkspaceMembership(userId, workspaceId);
    if (!memberRole) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    // Being in the workspace is not the same as being allowed to use EngineAI.
    // Without this the rail could hide the product while the API still served it.
    if (!(await hasEngineAiAccess(userId, workspaceId))) {
      return NextResponse.json(
        { error: "You do not have access to EngineAI" },
        { status: 403 }
      );
    }

    // Verify workspace exists in Supabase
    const { data: wsExists } = await intelligenceDb
      .from("workspaces")
      .select("id")
      .eq("id", workspaceId)
      .maybeSingle();

    if (!wsExists) {
      return NextResponse.json({ error: "Workspace not found" }, { status: 404 });
    }

    // Get workspace default model from ai_settings if not specified
    let aiModel = model;
    if (!aiModel) {
      const { data: settings } = await intelligenceDb
        .from("ai_settings")
        .select("name_model")
        .eq("id_workspace", workspaceId)
        .maybeSingle();
      aiModel = settings?.name_model || "claude-sonnet-5";
    }
    // Design mode: pin to Anthropic for v1 (only streamer with the design tools wired).
    const conversationMode = mode === "design" ? "design" : mode === "meeting" ? "meeting" : "general";
    if (conversationMode === "design" && !aiModel.startsWith("claude-")) {
      aiModel = "claude-sonnet-5";
    }

    const { data: conversation, error } = await intelligenceDb
      .from("ai_conversations")
      .insert({
        id_workspace: workspaceId,
        user_created: userId,
        name_conversation: title || (conversationMode === "design" ? "New Design Session" : "New Conversation"),
        type_visibility: visibility || "private",
        id_content: contentObjectId
          ? parseInt(String(contentObjectId), 10)
          : null,
        id_client: customerId
          ? parseInt(String(customerId), 10)
          : null,
        name_model: aiModel,
        flag_incognito: isIncognito ? 1 : 0,
        type_conversation_mode: conversationMode,
      })
      .select()
      .single();

    if (error) throw error;

    return NextResponse.json({ conversation: mapConversation(conversation) });
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
