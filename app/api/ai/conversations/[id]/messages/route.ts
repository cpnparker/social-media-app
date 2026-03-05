import { NextRequest } from "next/server";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { aiConversations, aiMessages } from "@/lib/db/schema";
import { eq, asc } from "drizzle-orm";
import { supabase } from "@/lib/supabase";
import { createStreamingResponse, type AIMessage } from "@/lib/ai/providers";
import { getAIWriterSystemPrompt } from "@/lib/ai/system-prompts";
import { getAllowedClientIds } from "@/lib/permissions";

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
        .select("name_content, type_content, document_body, information_brief, information_guidelines, information_audience, information_length, information_platform, information_notes, id_client, name_client, id_contract, name_contract, name_topic_array, name_campaign_array")
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

        // Fetch contract details if linked
        if (co.id_contract) {
          const { data: contract } = await supabase
            .from("app_contracts")
            .select("id_contract, name_contract, units_contract, units_total_completed, flag_active, date_start, date_end, information_notes")
            .eq("id_contract", co.id_contract)
            .single();

          if (contract) {
            contentContext.contract = {
              name: contract.name_contract,
              totalUnits: contract.units_contract,
              completedUnits: contract.units_total_completed,
              active: contract.flag_active === 1,
              startDate: contract.date_start,
              endDate: contract.date_end,
              notes: contract.information_notes,
            };
          }
        }

        // Fetch all content for this client (pipeline overview)
        if (co.id_client) {
          const { data: clientContent } = await supabase
            .from("app_content")
            .select("id_content, name_content, type_content, flag_completed, flag_spiked, date_completed, units_content")
            .eq("id_client", co.id_client)
            .is("date_deleted", null)
            .order("date_created", { ascending: false })
            .limit(50);

          if (clientContent?.length) {
            contentContext.clientContentPipeline = clientContent.map((c) => ({
              id: c.id_content,
              title: c.name_content,
              type: c.type_content,
              status: c.flag_completed === 1 ? "published" : c.flag_spiked === 1 ? "spiked" : "in production",
              completedAt: c.date_completed,
              units: c.units_content,
              isCurrent: c.id_content === conversation.contentObjectId,
            }));
          }
        }
      }
    } else if (conversation.customerId) {
      // Standalone AI Writer scoped to a specific client
      const { data: client } = await supabase
        .from("app_clients")
        .select("id_client, name_client, information_industry, information_description")
        .eq("id_client", conversation.customerId)
        .single();

      if (client) {
        contentContext = {
          customerName: client.name_client,
        };

        // Fetch active contracts for this client
        const { data: contracts } = await supabase
          .from("app_contracts")
          .select("id_contract, name_contract, units_contract, units_total_completed, flag_active, date_start, date_end, information_notes")
          .eq("id_client", client.id_client)
          .eq("flag_active", 1)
          .is("date_deleted", null)
          .limit(10);

        if (contracts?.length) {
          // Use the first active contract as the primary
          const c = contracts[0];
          contentContext.contract = {
            name: c.name_contract,
            totalUnits: c.units_contract,
            completedUnits: c.units_total_completed,
            active: c.flag_active === 1,
            startDate: c.date_start,
            endDate: c.date_end,
            notes: c.information_notes,
          };
        }

        // Fetch all content for this client
        const { data: clientContent } = await supabase
          .from("app_content")
          .select("id_content, name_content, type_content, flag_completed, flag_spiked, date_completed, units_content")
          .eq("id_client", client.id_client)
          .is("date_deleted", null)
          .order("date_created", { ascending: false })
          .limit(50);

        if (clientContent?.length) {
          contentContext.clientContentPipeline = clientContent.map((c) => ({
            id: c.id_content,
            title: c.name_content,
            type: c.type_content,
            status: c.flag_completed === 1 ? "published" : c.flag_spiked === 1 ? "spiked" : "in production",
            completedAt: c.date_completed,
            units: c.units_content,
            isCurrent: false,
          }));
        }

        // Fetch social posts for this client
        const { data: socialPosts } = await supabase
          .from("social")
          .select("name_social, network, type_post")
          .eq("id_client", client.id_client)
          .is("date_deleted", null)
          .order("date_created", { ascending: false })
          .limit(20);

        if (socialPosts?.length) {
          contentContext.linkedPosts = socialPosts.map((s) => ({
            content: s.name_social,
            platform: s.network,
            type: s.type_post,
          }));
        }
      }
    } else {
      // Standalone AI Writer with no client selected — workspace overview
      const { data: dbUser } = await supabase
        .from("users")
        .select("role_user")
        .eq("id_user", userId)
        .is("date_deleted", null)
        .single();
      const role = dbUser?.role_user || "none";
      const allowedIds = await getAllowedClientIds(userId, role);

      // Fetch accessible clients (app_clients view has no date_deleted column)
      let clientsQuery = supabase
        .from("app_clients")
        .select("id_client, name_client, information_industry, information_description")
        .order("name_client")
        .limit(30);
      if (allowedIds !== null) {
        clientsQuery = clientsQuery.in("id_client", allowedIds.length ? allowedIds : [-1]);
      }
      const { data: clients } = await clientsQuery;

      if (clients?.length) {
        const clientIds = clients.map((c) => c.id_client);

        const { data: contracts } = await supabase
          .from("app_contracts")
          .select("id_contract, name_contract, id_client, name_client, units_contract, units_total_completed, flag_active, date_start, date_end")
          .in("id_client", clientIds)
          .eq("flag_active", 1)
          .is("date_deleted", null)
          .limit(30);

        const { data: recentContent } = await supabase
          .from("app_content")
          .select("id_content, name_content, type_content, flag_completed, flag_spiked, id_client, name_client, units_content, date_completed")
          .in("id_client", clientIds)
          .is("date_deleted", null)
          .order("date_created", { ascending: false })
          .limit(50);

        contentContext = {
          workspaceClients: clients.map((c) => ({
            id: c.id_client,
            name: c.name_client,
            industry: c.information_industry,
            description: c.information_description,
          })),
          workspaceContracts: (contracts || []).map((c) => ({
            name: c.name_contract,
            clientName: c.name_client,
            totalUnits: c.units_contract,
            completedUnits: c.units_total_completed,
            active: c.flag_active === 1,
            startDate: c.date_start,
            endDate: c.date_end,
          })),
          workspaceContentPipeline: (recentContent || []).map((c) => ({
            title: c.name_content,
            type: c.type_content,
            clientName: c.name_client,
            status: c.flag_completed === 1 ? "published" : c.flag_spiked === 1 ? "spiked" : "in production",
            completedAt: c.date_completed,
            units: c.units_content,
          })),
        };
      }
    }

    console.log("[AI Context] Final context keys:", contentContext ? Object.keys(contentContext) : "undefined");

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
