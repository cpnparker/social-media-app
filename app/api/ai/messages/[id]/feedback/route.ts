import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { intelligenceDb } from "@/lib/supabase-intelligence";
import { checkConversationAccess } from "@/lib/ai/access";

// PATCH /api/ai/messages/[id]/feedback — rate an assistant message
// Body: { rating: 1 | -1 | null }  (null clears the rating)
export async function PATCH(
  req: NextRequest,
  { params }: { params: { id: string } }
) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const userId = parseInt(session.user.id, 10);
  const messageId = params.id;

  let rating: unknown;
  try {
    ({ rating } = await req.json());
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }
  if (rating !== 1 && rating !== -1 && rating !== null) {
    return NextResponse.json({ error: "rating must be 1, -1, or null" }, { status: 400 });
  }

  try {
    const { data: message } = await intelligenceDb
      .from("ai_messages")
      .select("id_message, id_conversation, role_message")
      .eq("id_message", messageId)
      .maybeSingle();
    if (!message) {
      return NextResponse.json({ error: "Message not found" }, { status: 404 });
    }
    if (message.role_message !== "assistant") {
      return NextResponse.json({ error: "Only assistant messages can be rated" }, { status: 400 });
    }

    const { data: conversation } = await intelligenceDb
      .from("ai_conversations")
      .select("id_conversation, type_visibility, user_created, id_workspace")
      .eq("id_conversation", message.id_conversation)
      .maybeSingle();
    if (!conversation) {
      return NextResponse.json({ error: "Conversation not found" }, { status: 404 });
    }

    const access = await checkConversationAccess(conversation.id_conversation, userId, {
      visibility: conversation.type_visibility,
      userCreated: conversation.user_created,
      workspaceId: conversation.id_workspace,
    });
    if (!access.allowed) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    const { error } = await intelligenceDb
      .from("ai_messages")
      .update({ rating_message: rating })
      .eq("id_message", messageId);
    if (error) {
      // Column missing until the 20260610_message_feedback migration is applied.
      console.error("[Feedback] Update failed:", error.message);
      return NextResponse.json({ error: "Failed to save feedback" }, { status: 500 });
    }

    return NextResponse.json({ ok: true, rating });
  } catch (err: any) {
    console.error("[Feedback] Error:", err.message);
    return NextResponse.json({ error: "Internal error" }, { status: 500 });
  }
}
