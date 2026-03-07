import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { aiConversations, aiMessages } from "@/lib/db/schema";
import { eq, asc } from "drizzle-orm";
import { supabase } from "@/lib/supabase";

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
      .select()
      .from(aiConversations)
      .where(eq(aiConversations.id, conversationId))
      .limit(1);

    if (!conversation) {
      return NextResponse.json({ error: "Conversation not found" }, { status: 404 });
    }

    // Access check: private conversations are only for the creator
    if (conversation.visibility === "private" && conversation.createdBy !== userId) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    const rawMessages = await db
      .select()
      .from(aiMessages)
      .where(eq(aiMessages.conversationId, conversationId))
      .orderBy(asc(aiMessages.createdAt));

    // Parse attachments JSON strings for the client
    const messages = rawMessages.map((m) => ({
      ...m,
      attachments: m.attachments ? JSON.parse(m.attachments) : null,
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

    return NextResponse.json({
      conversation: { ...conversation, customerName },
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
      .select({ createdBy: aiConversations.createdBy })
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

    // Cascade delete handles messages
    await db
      .delete(aiConversations)
      .where(eq(aiConversations.id, conversationId));

    return NextResponse.json({ success: true });
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
