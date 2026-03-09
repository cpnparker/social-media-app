import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { intelligenceDb } from "@/lib/supabase-intelligence";
import { supabase } from "@/lib/supabase";

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
  const limit = parseInt(searchParams.get("limit") || "50", 10);

  if (!workspaceId) {
    return NextResponse.json({ error: "workspaceId is required" }, { status: 400 });
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

    // Build query — always exclude incognito conversations
    let query = intelligenceDb
      .from("ai_conversations")
      .select("*")
      .eq("id_workspace", workspaceId)
      .eq("flag_incognito", 0);

    if (visibility === "private") {
      // User's own private conversations + shared-with-me private conversations
      if (sharedConvoIds.length > 0) {
        query = query.or(
          `and(type_visibility.eq.private,user_created.eq.${userId}),and(type_visibility.eq.private,id_conversation.in.(${sharedConvoIds.join(",")}))`
        );
      } else {
        query = query.eq("type_visibility", "private").eq("user_created", userId);
      }
    } else if (visibility === "team") {
      query = query.eq("type_visibility", "team");
    } else {
      // Default: user's private + shared-with-me + all team conversations
      if (sharedConvoIds.length > 0) {
        query = query.or(
          `and(type_visibility.eq.private,user_created.eq.${userId}),and(type_visibility.eq.private,id_conversation.in.(${sharedConvoIds.join(",")})),type_visibility.eq.team`
        );
      } else {
        query = query.or(
          `and(type_visibility.eq.private,user_created.eq.${userId}),type_visibility.eq.team`
        );
      }
    }

    if (contentObjectId) {
      query = query.eq("id_content", parseInt(contentObjectId, 10));
    }

    if (customerId) {
      query = query.eq("id_client", parseInt(customerId, 10));
    }

    if (search) {
      query = query.ilike("name_conversation", `%${search}%`);
    }

    const { data: conversations, error } = await query
      .order("date_updated", { ascending: false })
      .limit(limit);

    if (error) throw error;

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

    const enriched = (conversations || []).map((c: any) => {
      const isSharedWithMe = c.user_created !== userId && sharedByMap.has(c.id_conversation);
      const shareInfo = sharedByMap.get(c.id_conversation);
      return {
        ...c,
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
    const { workspaceId, title, visibility, contentObjectId, customerId, model, isIncognito } = body;

    if (!workspaceId) {
      return NextResponse.json({ error: "workspaceId is required" }, { status: 400 });
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
      aiModel = settings?.name_model || "claude-sonnet-4-20250514";
    }

    const { data: conversation, error } = await intelligenceDb
      .from("ai_conversations")
      .insert({
        id_workspace: workspaceId,
        user_created: userId,
        name_conversation: title || "New Conversation",
        type_visibility: visibility || "private",
        id_content: contentObjectId
          ? parseInt(String(contentObjectId), 10)
          : null,
        id_client: customerId
          ? parseInt(String(customerId), 10)
          : null,
        name_model: aiModel,
        flag_incognito: isIncognito ? 1 : 0,
      })
      .select()
      .single();

    if (error) throw error;

    return NextResponse.json({ conversation });
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
