import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { intelligenceDb } from "@/lib/supabase-intelligence";
import { supabase } from "@/lib/supabase";
import { checkConversationAccess } from "@/lib/ai/access";
import { mapConversation, mapMessage } from "@/lib/ai/response-mappers";

/** Check if a user has workspace admin access for a specific workspace */
async function isWorkspaceAdmin(userId: number, workspaceId: string): Promise<boolean> {
  const { data } = await intelligenceDb
    .from("users_access")
    .select("flag_access_admin")
    .eq("user_target", userId)
    .eq("id_workspace", workspaceId)
    .eq("flag_access_admin", 1)
    .limit(1)
    .maybeSingle();
  return !!data;
}

// GET /api/ai/conversations/[id] — get conversation with messages
export async function GET(
  req: NextRequest,
  { params }: { params: { id: string } }
) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const userId = parseInt(session.user.id, 10);
  const conversationId = params.id;

  try {
    const { data: conversation } = await intelligenceDb
      .from("ai_conversations")
      .select("*")
      .eq("id_conversation", conversationId)
      .maybeSingle();

    if (!conversation) {
      return NextResponse.json({ error: "Conversation not found" }, { status: 404 });
    }

    // Share-aware access check (function expects camelCase params)
    const access = await checkConversationAccess(conversationId, userId, {
      visibility: conversation.type_visibility,
      userCreated: conversation.user_created,
      workspaceId: conversation.id_workspace,
    });
    if (!access.allowed) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    const { data: rawMessages, error: msgError } = await intelligenceDb
      .from("ai_messages")
      .select("*")
      .eq("id_conversation", conversationId)
      .order("date_created", { ascending: true });

    if (msgError) throw msgError;

    // Resolve user names for messages with user_created
    const messageUserIds = Array.from(
      new Set(
        (rawMessages || [])
          .filter((m: any) => m.user_created)
          .map((m: any) => m.user_created)
      )
    );
    let messageNameMap = new Map<number, string>();
    if (messageUserIds.length > 0) {
      const { data: msgUsers } = await supabase
        .from("users")
        .select("id_user, name_user")
        .in("id_user", messageUserIds);
      messageNameMap = new Map(
        (msgUsers || []).map((u: any) => [u.id_user, u.name_user])
      );
    }

    // Map DB column names → frontend-friendly camelCase
    const messages = (rawMessages || []).map((m: any) => ({
      ...mapMessage(m),
      createdByName: m.user_created ? messageNameMap.get(m.user_created) || null : null,
    }));

    // Resolve customer name if conversation has an id_client
    let customerName: string | null = null;
    if (conversation.id_client) {
      const { data: client } = await supabase
        .from("app_clients")
        .select("name_client")
        .eq("id_client", conversation.id_client)
        .single();
      if (client) customerName = client.name_client;
    }

    // Get share count + shared user info for header avatar stack (owner only)
    let shareCount = 0;
    let shares: { userId: number; userName: string | null; permission: string }[] = [];
    if (access.permission === "owner") {
      const { data: shareRows } = await intelligenceDb
        .from("ai_shares")
        .select("user_recipient, type_permission")
        .eq("id_conversation", conversationId);

      shareCount = (shareRows || []).length;

      if (shareCount > 0) {
        const userIds = (shareRows || []).map((s: any) => s.user_recipient);
        const { data: users } = await supabase
          .from("users")
          .select("id_user, name_user")
          .in("id_user", userIds);

        const nameMap = new Map(
          (users || []).map((u: any) => [u.id_user, u.name_user])
        );

        shares = (shareRows || []).map((s: any) => ({
          userId: s.user_recipient,
          userName: nameMap.get(s.user_recipient) || null,
          permission: s.type_permission,
        }));
      }
    }

    return NextResponse.json({
      conversation: {
        ...mapConversation(conversation),
        customerName,
        myPermission: access.permission,
        shareCount,
        shares,
      },
      messages,
    });
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}

// PATCH /api/ai/conversations/[id] — update title or visibility
export async function PATCH(
  req: NextRequest,
  { params }: { params: { id: string } }
) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const userId = parseInt(session.user.id, 10);
  const conversationId = params.id;

  try {
    // Check ownership
    const { data: conversation } = await intelligenceDb
      .from("ai_conversations")
      .select("user_created, type_visibility, id_workspace")
      .eq("id_conversation", conversationId)
      .maybeSingle();

    if (!conversation) {
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    }
    if (conversation.user_created !== userId && !(await isWorkspaceAdmin(userId, conversation.id_workspace))) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    const body = await req.json();
    const updateData: Record<string, any> = {
      date_updated: new Date().toISOString(),
    };
    if (body.title !== undefined) updateData.name_conversation = body.title;
    if (body.visibility !== undefined) updateData.type_visibility = body.visibility;
    if (body.model !== undefined) updateData.name_model = body.model;

    const { data: updated, error } = await intelligenceDb
      .from("ai_conversations")
      .update(updateData)
      .eq("id_conversation", conversationId)
      .select()
      .single();

    if (error) throw error;

    // Clear shares when changing to team (they become redundant)
    if (
      body.visibility === "team" &&
      conversation.type_visibility === "private"
    ) {
      await intelligenceDb
        .from("ai_shares")
        .delete()
        .eq("id_conversation", conversationId);
    }

    return NextResponse.json({ conversation: mapConversation(updated) });
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}

// DELETE /api/ai/conversations/[id]
export async function DELETE(
  req: NextRequest,
  { params }: { params: { id: string } }
) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const userId = parseInt(session.user.id, 10);
  const conversationId = params.id;

  try {
    // Check ownership
    const { data: conversation } = await intelligenceDb
      .from("ai_conversations")
      .select("user_created, id_workspace")
      .eq("id_conversation", conversationId)
      .maybeSingle();

    if (!conversation) {
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    }
    if (conversation.user_created !== userId && !(await isWorkspaceAdmin(userId, conversation.id_workspace))) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    // Nullify usage rows that reference this conversation, then delete.
    // (ai_messages and ai_conversation_shares cascade-delete via FK constraint.)
    await intelligenceDb
      .from("ai_usage")
      .update({ id_conversation: null })
      .eq("id_conversation", conversationId);

    await intelligenceDb
      .from("ai_conversations")
      .delete()
      .eq("id_conversation", conversationId);

    return NextResponse.json({ success: true });
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
