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

    // Build system prompt with content + customer context (app_content is in Supabase)
    let contentContext: Parameters<typeof getAIWriterSystemPrompt>[0];
    if (conversation.contentObjectId) {
      const { data: co } = await supabase
        .from("app_content")
        .select("name_content, type_content, document_body, information_brief, information_guidelines, information_audience, information_length, information_platform, information_notes, id_client, name_client, name_topic_array, name_campaign_array")
        .eq("id_content", conversation.contentObjectId)
        .single();

      if (co) {
        contentContext = {
          contentTitle: co.name_content,
          contentType: co.type_content,
          contentBody: co.document_body,
          contentBrief: co.information_brief,
          guidelines: co.information_guidelines,
          audience: co.information_audience,
          targetLength: co.information_length,
          platform: co.information_platform,
          notes: co.information_notes,
          customerName: co.name_client,
          topicTags: co.name_topic_array,
          campaignTags: co.name_campaign_array,
        };

        // Fetch linked social posts for this content
        if (co.id_client) {
          const { data: socialPosts } = await supabase
            .from("social")
            .select("name_social, network, type_post")
            .eq("id_content", conversation.contentObjectId)
            .is("date_deleted", null)
            .limit(20);

          if (socialPosts?.length) {
            contentContext.linkedPosts = socialPosts.map((s) => ({
              content: s.name_social,
              platform: s.network,
              type: s.type_post,
            }));
          }
        }
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
