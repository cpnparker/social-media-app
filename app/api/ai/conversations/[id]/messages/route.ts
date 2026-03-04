import { NextRequest } from "next/server";
import { auth } from "@/lib/auth";
import { supabase } from "@/lib/supabase";
import { createStreamingResponse, type AIMessage } from "@/lib/ai/providers";
import { getAIWriterSystemPrompt } from "@/lib/ai/system-prompts";

// POST /api/ai/conversations/[id]/messages — send message & stream response
export async function POST(
  req: NextRequest,
  { params }: { params: { id: string } }
) {
  const session = await auth();
  if (!session?.user?.id) {
    return new Response(JSON.stringify({ error: "Unauthorized" }), {
      status: 401,
      headers: { "Content-Type": "application/json" },
    });
  }
  const userId = parseInt(session.user.id, 10);
  const conversationId = params.id;

  try {
    const body = await req.json();
    const userContent = body.content;

    if (!userContent?.trim()) {
      return new Response(JSON.stringify({ error: "Message content is required" }), {
        status: 400,
        headers: { "Content-Type": "application/json" },
      });
    }

    // Fetch conversation
    const { data: conversation, error: convError } = await supabase
      .from("ai_conversations")
      .select("*")
      .eq("id", conversationId)
      .single();

    if (convError || !conversation) {
      return new Response(JSON.stringify({ error: "Conversation not found" }), {
        status: 404,
        headers: { "Content-Type": "application/json" },
      });
    }

    // Access check
    if (conversation.visibility === "private" && conversation.created_by !== userId) {
      return new Response(JSON.stringify({ error: "Forbidden" }), {
        status: 403,
        headers: { "Content-Type": "application/json" },
      });
    }

    // Save user message
    const { error: insertError } = await supabase
      .from("ai_messages")
      .insert({
        conversation_id: conversationId,
        role: "user",
        content: userContent.trim(),
        created_by: userId,
      });

    if (insertError) {
      return new Response(JSON.stringify({ error: insertError.message }), {
        status: 500,
        headers: { "Content-Type": "application/json" },
      });
    }

    // Load full conversation history
    const { data: history } = await supabase
      .from("ai_messages")
      .select("role, content")
      .eq("conversation_id", conversationId)
      .order("created_at", { ascending: true });

    const messages: AIMessage[] = (history || []).map((m: any) => ({
      role: m.role as "user" | "assistant" | "system",
      content: m.content,
    }));

    // Build system prompt with optional content context
    let contentContext: { contentTitle?: string; contentType?: string; contentBrief?: string } | undefined;
    if (conversation.content_object_id) {
      const { data: co } = await supabase
        .from("app_content")
        .select("title_content, type_content, description_content")
        .eq("id_content", conversation.content_object_id)
        .single();

      if (co) {
        contentContext = {
          contentTitle: co.title_content,
          contentType: co.type_content,
          contentBrief: co.description_content,
        };
      }
    }

    const systemPrompt = getAIWriterSystemPrompt(contentContext);
    const model = body.model || conversation.model;

    // Auto-title: if this is the first user message, set conversation title
    const userMessages = messages.filter((m) => m.role === "user");
    if (userMessages.length === 1) {
      const autoTitle =
        userContent.trim().length > 60
          ? userContent.trim().slice(0, 57) + "..."
          : userContent.trim();
      await supabase
        .from("ai_conversations")
        .update({ title: autoTitle, updated_at: new Date().toISOString() })
        .eq("id", conversationId);
    }

    // Create streaming response
    const stream = createStreamingResponse(
      messages,
      { model, systemPrompt },
      async (fullText: string) => {
        // Save assistant message after stream completes
        await supabase.from("ai_messages").insert({
          conversation_id: conversationId,
          role: "assistant",
          content: fullText,
          model: model,
        });

        // Update conversation timestamp
        await supabase
          .from("ai_conversations")
          .update({ updated_at: new Date().toISOString() })
          .eq("id", conversationId);
      }
    );

    return new Response(stream, {
      headers: {
        "Content-Type": "text/event-stream",
        "Cache-Control": "no-cache",
        Connection: "keep-alive",
      },
    });
  } catch (error: any) {
    return new Response(JSON.stringify({ error: error.message }), {
      status: 500,
      headers: { "Content-Type": "application/json" },
    });
  }
}
