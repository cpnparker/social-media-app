import { NextRequest } from "next/server";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { aiConversations, aiMessages } from "@/lib/db/schema";
import { eq, asc } from "drizzle-orm";
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
    const [conversation] = await db
      .select()
      .from(aiConversations)
      .where(eq(aiConversations.id, conversationId))
      .limit(1);

    if (!conversation) {
      return new Response(JSON.stringify({ error: "Conversation not found" }), {
        status: 404,
        headers: { "Content-Type": "application/json" },
      });
    }

    // Access check
    if (conversation.visibility === "private" && conversation.createdBy !== userId) {
      return new Response(JSON.stringify({ error: "Forbidden" }), {
        status: 403,
        headers: { "Content-Type": "application/json" },
      });
    }

    // Save user message
    await db.insert(aiMessages).values({
      conversationId,
      role: "user",
      content: userContent.trim(),
      createdBy: userId,
    });

    // Load full conversation history
    const history = await db
      .select({ role: aiMessages.role, content: aiMessages.content })
      .from(aiMessages)
      .where(eq(aiMessages.conversationId, conversationId))
      .orderBy(asc(aiMessages.createdAt));

    const messages: AIMessage[] = history.map((m) => ({
      role: m.role as "user" | "assistant" | "system",
      content: m.content,
    }));

    // Build system prompt with optional content context (app_content is in Supabase)
    let contentContext: { contentTitle?: string; contentType?: string; contentBrief?: string } | undefined;
    if (conversation.contentObjectId) {
      const { data: co } = await supabase
        .from("app_content")
        .select("title_content, type_content, description_content")
        .eq("id_content", conversation.contentObjectId)
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
      await db
        .update(aiConversations)
        .set({ title: autoTitle, updatedAt: new Date() })
        .where(eq(aiConversations.id, conversationId));
    }

    // Create streaming response
    const stream = createStreamingResponse(
      messages,
      { model, systemPrompt },
      async (fullText: string) => {
        // Save assistant message after stream completes
        await db.insert(aiMessages).values({
          conversationId,
          role: "assistant",
          content: fullText,
          model: model,
        });

        // Update conversation timestamp
        await db
          .update(aiConversations)
          .set({ updatedAt: new Date() })
          .where(eq(aiConversations.id, conversationId));
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
