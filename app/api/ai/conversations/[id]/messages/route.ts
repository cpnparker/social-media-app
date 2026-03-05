import { NextRequest } from "next/server";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { aiConversations, aiMessages } from "@/lib/db/schema";
import { eq, asc } from "drizzle-orm";
import { supabase } from "@/lib/supabase";
import { createStreamingResponse, type AIMessage } from "@/lib/ai/providers";
import { buildSystemPrompt } from "@/lib/ai/system-prompts";

// ── Helper: fetch workspace-level config (content types + CU definitions) ──
async function fetchWorkspaceConfig() {
  const [typesRes, cuRes] = await Promise.all([
    supabase
      .from("types_content")
      .select("id_type, key_type, type_content, flag_active, ai_prompt")
      .eq("flag_active", 1),
    supabase
      .from("calculator_content")
      .select("name, format, units_content")
      .order("sort_order"),
  ]);

  return {
    contentTypes: (typesRes.data || []).map((t) => ({
      key: t.key_type,
      name: t.type_content,
      aiPrompt: t.ai_prompt,
    })),
    cuDefinitions: (cuRes.data || []).map((c) => ({
      format: c.name,
      category: c.format,
      units: c.units_content,
    })),
  };
}

// ── Helper: fetch client context (compact summary) ──
async function fetchClientContext(clientId: number) {
  const [clientRes, contractsRes, contentRes, socialRes] = await Promise.all([
    supabase
      .from("app_clients")
      .select("id_client, name_client, information_industry, information_description")
      .eq("id_client", clientId)
      .single(),
    supabase
      .from("app_contracts")
      .select("name_contract, units_contract, units_total_completed, flag_active, date_start, date_end, information_notes")
      .eq("id_client", clientId)
      .is("date_deleted", null)
      .order("flag_active", { ascending: false }),
    supabase
      .from("app_content")
      .select("name_content, type_content, flag_completed, flag_spiked, units_content")
      .eq("id_client", clientId)
      .is("date_deleted", null)
      .order("date_created", { ascending: false })
      .limit(30),
    supabase
      .from("social")
      .select("network")
      .eq("id_client", clientId)
      .is("date_deleted", null),
  ]);

  const client = clientRes.data;
  if (!client) return null;

  // Summarize content pipeline into counts
  const content = contentRes.data || [];
  const published = content.filter((c) => c.flag_completed === 1);
  const inProduction = content.filter((c) => c.flag_completed !== 1 && c.flag_spiked !== 1);

  // Summarize social platforms used
  const social = socialRes.data || [];
  const platformCounts: Record<string, number> = {};
  social.forEach((s) => {
    if (s.network) platformCounts[s.network] = (platformCounts[s.network] || 0) + 1;
  });

  // Content type breakdown
  const typeBreakdown: Record<string, { total: number; published: number; inProd: number }> = {};
  content.forEach((c) => {
    const t = c.type_content || "other";
    if (!typeBreakdown[t]) typeBreakdown[t] = { total: 0, published: 0, inProd: 0 };
    typeBreakdown[t].total++;
    if (c.flag_completed === 1) typeBreakdown[t].published++;
    else if (c.flag_spiked !== 1) typeBreakdown[t].inProd++;
  });

  return {
    name: client.name_client,
    industry: client.information_industry,
    description: client.information_description,
    contracts: (contractsRes.data || []).map((c) => ({
      name: c.name_contract,
      totalUnits: c.units_contract,
      completedUnits: c.units_total_completed,
      active: c.flag_active === 1,
      startDate: c.date_start,
      endDate: c.date_end,
      notes: c.information_notes,
    })),
    contentSummary: {
      total: content.length,
      published: published.length,
      inProduction: inProduction.length,
      totalCU: content.reduce((sum, c) => sum + (c.units_content || 0), 0),
      byType: typeBreakdown,
      recentTitles: inProduction.slice(0, 8).map((c) => `${c.name_content} (${c.type_content})`),
    },
    socialPlatforms: platformCounts,
  };
}

// ── Helper: fetch content-object level detail ──
async function fetchContentDetail(contentObjectId: number) {
  const { data: co } = await supabase
    .from("app_content")
    .select("name_content, type_content, document_body, information_brief, information_guidelines, information_audience, information_length, information_platform, information_notes, id_client, name_client, id_contract, name_topic_array, name_campaign_array")
    .eq("id_content", contentObjectId)
    .single();

  if (!co) return null;

  return {
    title: co.name_content,
    type: co.type_content,
    body: co.document_body,
    brief: co.information_brief,
    guidelines: co.information_guidelines,
    audience: co.information_audience,
    targetLength: co.information_length,
    platform: co.information_platform,
    notes: co.information_notes,
    clientId: co.id_client,
    clientName: co.name_client,
    contractId: co.id_contract,
    topicTags: co.name_topic_array,
    campaignTags: co.name_campaign_array,
  };
}

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

    // Load conversation history + workspace config in parallel
    const [history, workspaceConfig] = await Promise.all([
      db
        .select({ role: aiMessages.role, content: aiMessages.content })
        .from(aiMessages)
        .where(eq(aiMessages.conversationId, conversationId))
        .orderBy(asc(aiMessages.createdAt)),
      fetchWorkspaceConfig(),
    ]);

    const messages: AIMessage[] = history.map((m) => ({
      role: m.role as "user" | "assistant" | "system",
      content: m.content,
    }));

    // Build context based on conversation scope
    let clientContext: Awaited<ReturnType<typeof fetchClientContext>> = null;
    let contentDetail: Awaited<ReturnType<typeof fetchContentDetail>> = null;

    if (conversation.contentObjectId) {
      // Content-specific conversation — fetch content detail + client context
      contentDetail = await fetchContentDetail(conversation.contentObjectId);
      if (contentDetail?.clientId) {
        clientContext = await fetchClientContext(contentDetail.clientId);
      }
    } else if (conversation.customerId) {
      // Client-scoped standalone conversation
      clientContext = await fetchClientContext(conversation.customerId);
    }

    const systemPrompt = buildSystemPrompt({
      workspaceConfig,
      clientContext,
      contentDetail,
    });

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
        await db.insert(aiMessages).values({
          conversationId,
          role: "assistant",
          content: fullText,
          model: model,
        });
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
