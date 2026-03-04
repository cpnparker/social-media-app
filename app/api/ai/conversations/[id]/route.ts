import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
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
    // Fetch conversation
    const { data: conversation, error: convError } = await supabase
      .from("ai_conversations")
      .select("*")
      .eq("id", conversationId)
      .single();

    if (convError || !conversation) {
      return NextResponse.json({ error: "Conversation not found" }, { status: 404 });
    }

    // Access check: private conversations are only for the creator
    if (conversation.visibility === "private" && conversation.created_by !== userId) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    // Fetch messages
    const { data: messages, error: msgError } = await supabase
      .from("ai_messages")
      .select("*")
      .eq("conversation_id", conversationId)
      .order("created_at", { ascending: true });

    if (msgError) {
      return NextResponse.json({ error: msgError.message }, { status: 500 });
    }

    return NextResponse.json({
      conversation,
      messages: messages || [],
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
    const { data: conversation } = await supabase
      .from("ai_conversations")
      .select("created_by")
      .eq("id", conversationId)
      .single();

    if (!conversation || conversation.created_by !== userId) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    const body = await req.json();
    const updateData: Record<string, any> = {
      updated_at: new Date().toISOString(),
    };
    if (body.title !== undefined) updateData.title = body.title;
    if (body.visibility !== undefined) updateData.visibility = body.visibility;
    if (body.model !== undefined) updateData.model = body.model;

    const { data: updated, error } = await supabase
      .from("ai_conversations")
      .update(updateData)
      .eq("id", conversationId)
      .select()
      .single();

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
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
    const { data: conversation } = await supabase
      .from("ai_conversations")
      .select("created_by")
      .eq("id", conversationId)
      .single();

    if (!conversation || conversation.created_by !== userId) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    // Cascade delete handles messages
    const { error } = await supabase
      .from("ai_conversations")
      .delete()
      .eq("id", conversationId);

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    return NextResponse.json({ success: true });
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
