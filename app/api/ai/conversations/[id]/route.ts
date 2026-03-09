import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { aiConversations, aiMessages, aiUsage, aiConversationShares } from "@/lib/db/schema";
import { eq, asc, count } from "drizzle-orm";
import { supabase } from "@/lib/supabase";
import { checkConversationAccess } from "@/lib/ai/access";

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
    const [conversation] = await db
      .select({
        id: aiConversations.id,
        workspaceId: aiConversations.workspaceId,
        createdBy: aiConversations.createdBy,
        title: aiConversations.title,
        visibility: aiConversations.visibility,
        contentObjectId: aiConversations.contentObjectId,
        customerId: aiConversations.customerId,
        model: aiConversations.model,
        createdAt: aiConversations.createdAt,
        updatedAt: aiConversations.updatedAt,
      })
      .from(aiConversations)
      .where(eq(aiConversations.id, conversationId))
      .limit(1);

    if (!conversation) {
      return NextResponse.json({ error: "Conversation not found" }, { status: 404 });
    }

    // Share-aware access check
    const access = await checkConversationAccess(conversationId, userId, conversation);
    if (!access.allowed) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    const rawMessages = await db
      .select({
        id: aiMessages.id,
        conversationId: aiMessages.conversationId,
        role: aiMessages.role,
        content: aiMessages.content,
        attachments: aiMessages.attachments,
        model: aiMessages.model,
        createdBy: aiMessages.createdBy,
        createdAt: aiMessages.createdAt,
      })
      .from(aiMessages)
      .where(eq(aiMessages.conversationId, conversationId))
      .orderBy(asc(aiMessages.createdAt));

    // Resolve user names for messages with createdBy
    const messageUserIds = Array.from(
      new Set(rawMessages.filter((m) => m.createdBy).map((m) => m.createdBy!))
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

    // Parse attachments JSON strings for the client
    const messages = rawMessages.map((m) => ({
      ...m,
      attachments: m.attachments ? JSON.parse(m.attachments) : null,
      createdByName: m.createdBy ? messageNameMap.get(m.createdBy) || null : null,
    }));

    // Resolve customer name if conversation has a customerId
    let customerName: string | null = null;
    if (conversation.customerId) {
      const { data: client } = await supabase
        .from("app_clients")
        .select("name_client")
        .eq("id_client", conversation.customerId)
        .single();
      if (client) customerName = client.name_client;
    }

    // Get share count + shared user info for header avatar stack (owner only)
    let shareCount = 0;
    let shares: { userId: number; userName: string | null; permission: string }[] = [];
    if (access.permission === "owner") {
      const shareRows = await db
        .select({
          userId: aiConversationShares.userId,
          permission: aiConversationShares.permission,
        })
        .from(aiConversationShares)
        .where(eq(aiConversationShares.conversationId, conversationId));

      shareCount = shareRows.length;

      if (shareRows.length > 0) {
        const userIds = shareRows.map((s) => s.userId);
        const { data: users } = await supabase
          .from("users")
          .select("id_user, name_user")
          .in("id_user", userIds);

        const nameMap = new Map(
          (users || []).map((u: any) => [u.id_user, u.name_user])
        );

        shares = shareRows.map((s) => ({
          userId: s.userId,
          userName: nameMap.get(s.userId) || null,
          permission: s.permission,
        }));
      }
    }

    return NextResponse.json({
      conversation: {
        ...conversation,
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
    const [conversation] = await db
      .select({
        createdBy: aiConversations.createdBy,
        visibility: aiConversations.visibility,
      })
      .from(aiConversations)
      .where(eq(aiConversations.id, conversationId))
      .limit(1);

    if (!conversation || conversation.createdBy !== userId) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    const body = await req.json();
    const updateData: Record<string, any> = {
      updatedAt: new Date(),
    };
    if (body.title !== undefined) updateData.title = body.title;
    if (body.visibility !== undefined) updateData.visibility = body.visibility;
    if (body.model !== undefined) updateData.model = body.model;

    const [updated] = await db
      .update(aiConversations)
      .set(updateData)
      .where(eq(aiConversations.id, conversationId))
      .returning();

    // Clear shares when changing to team (they become redundant)
    if (
      body.visibility === "team" &&
      conversation.visibility === "private"
    ) {
      await db
        .delete(aiConversationShares)
        .where(eq(aiConversationShares.conversationId, conversationId));
    }

    return NextResponse.json({ conversation: updated });
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
    const [conversation] = await db
      .select({ createdBy: aiConversations.createdBy })
      .from(aiConversations)
      .where(eq(aiConversations.id, conversationId))
      .limit(1);

    if (!conversation || conversation.createdBy !== userId) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    // Nullify usage rows that reference this conversation, then delete.
    // (ai_messages and ai_conversation_shares cascade-delete automatically via FK constraint.)
    await db
      .update(aiUsage)
      .set({ conversationId: null })
      .where(eq(aiUsage.conversationId, conversationId));

    await db
      .delete(aiConversations)
      .where(eq(aiConversations.id, conversationId));

    return NextResponse.json({ success: true });
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
