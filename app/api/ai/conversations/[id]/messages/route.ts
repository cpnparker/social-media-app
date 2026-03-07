import { NextRequest } from "next/server";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { aiConversations, aiMessages, aiUsage, workspaces } from "@/lib/db/schema";
import { eq, asc } from "drizzle-orm";
import { supabase } from "@/lib/supabase";
import { createStreamingResponse, type AIMessage, type AIAttachment } from "@/lib/ai/providers";
import { buildSystemPrompt, normalizeContextConfig, isFullDetail, type NormalizedContextConfig, type DetailLevel } from "@/lib/ai/system-prompts";
import { fetchBlobContent } from "@/lib/ai/blob-utils";
import type { Attachment } from "@/lib/types/ai";

// ── Cost calculation for usage tracking ──
const MODEL_COSTS: Record<string, { inputPer1M: number; outputPer1M: number }> = {
  "claude-sonnet-4-20250514": { inputPer1M: 300, outputPer1M: 1500 }, // $3/$15 in cents
  "gpt-4o": { inputPer1M: 250, outputPer1M: 1000 },                  // $2.50/$10
  "gpt-4o-mini": { inputPer1M: 15, outputPer1M: 60 },                // $0.15/$0.60
  "grok-4-1-fast": { inputPer1M: 20, outputPer1M: 50 },              // $0.20/$0.50
  "grok-3-mini": { inputPer1M: 30, outputPer1M: 50 },                // $0.30/$0.50
  "grok-3": { inputPer1M: 300, outputPer1M: 1500 },                  // legacy
};

function calculateCostTenths(model: string, inputTokens: number, outputTokens: number): number {
  const rates = MODEL_COSTS[model] || MODEL_COSTS["claude-sonnet-4-20250514"];
  const inputCost = (inputTokens / 1_000_000) * rates.inputPer1M * 10;
  const outputCost = (outputTokens / 1_000_000) * rates.outputPer1M * 10;
  return Math.round(inputCost + outputCost);
}

// ── Helper: extract text from a document attachment ──
// Uses fetchBlobContent() which handles both private proxy URLs and legacy public URLs
async function extractDocumentText(att: Attachment): Promise<string | undefined> {
  try {
    const { buffer } = await fetchBlobContent(att.url);

    if (att.type === "application/pdf") {
      const pdfParseModule = await import("pdf-parse");
      const pdfParse = pdfParseModule.default ?? pdfParseModule;
      const data = await pdfParse(buffer);
      return data.text;
    }

    if (att.type === "application/vnd.openxmlformats-officedocument.wordprocessingml.document") {
      const mammoth = await import("mammoth");
      const result = await mammoth.extractRawText({ buffer });
      return result.value;
    }

    if (att.type.startsWith("text/")) {
      return buffer.toString("utf-8");
    }

    return undefined;
  } catch (err) {
    console.error(`[Messages] Failed to extract text from ${att.name}:`, err);
    return undefined;
  }
}

// ── Helper: convert stored attachments to AIAttachments with extracted text ──
async function prepareAttachmentsForAI(attachments: Attachment[]): Promise<AIAttachment[]> {
  const prepared: AIAttachment[] = [];

  for (const att of attachments) {
    const aiAtt: AIAttachment = {
      url: att.url,
      name: att.name,
      type: att.type,
    };

    // Extract text for non-image files
    if (!att.type.startsWith("image/")) {
      aiAtt.extractedText = await extractDocumentText(att);
    }

    prepared.push(aiAtt);
  }

  return prepared;
}

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

// ── Helper: get date cutoff and item limit for a detail level ──
function getDetailParams(level: DetailLevel): { dateCutoff: string | null; limit: number } {
  const now = new Date();
  if (level === "full-week") {
    now.setDate(now.getDate() - 7);
    return { dateCutoff: now.toISOString(), limit: 30 };
  }
  if (level === "full-month") {
    now.setMonth(now.getMonth() - 1);
    return { dateCutoff: now.toISOString(), limit: 50 };
  }
  if (level === "full-year") {
    now.setFullYear(now.getFullYear() - 1);
    return { dateCutoff: now.toISOString(), limit: 100 };
  }
  return { dateCutoff: null, limit: 30 };
}

// ── Helper: fetch client context (with optional full detail) ──
async function fetchClientContext(clientId: number, detailConfig?: NormalizedContextConfig) {
  const contractLevel = detailConfig?.contracts || "summary";
  const contentLevel = detailConfig?.contentPipeline || "summary";
  const fullContracts = isFullDetail(contractLevel);
  const fullContent = isFullDetail(contentLevel);

  // Select extra fields for full content mode (briefs, audience, topics, etc.)
  const contentSelect = fullContent
    ? "name_content, type_content, flag_completed, flag_spiked, units_content, id_contract, information_brief, information_audience, name_topic_array, name_campaign_array, information_platform"
    : "name_content, type_content, flag_completed, flag_spiked, units_content, id_contract";

  // Date filter and limits for content based on time window
  const contentParams = fullContent ? getDetailParams(contentLevel) : { dateCutoff: null, limit: 30 };

  // Build content query with optional date filter
  let contentQ = supabase
    .from("app_content")
    .select(contentSelect)
    .eq("id_client", clientId);
  if (contentParams.dateCutoff) {
    contentQ = contentQ.gte("date_created", contentParams.dateCutoff);
  }

  const [clientRes, contractsRes, contentRes, socialRes] = await Promise.all([
    supabase
      .from("app_clients")
      .select("id_client, name_client, information_industry, information_description")
      .eq("id_client", clientId)
      .single(),
    supabase
      .from("app_contracts")
      .select("id_contract, name_contract, units_contract, units_total_completed, flag_active, date_start, date_end, information_notes")
      .eq("id_client", clientId)
      .order("flag_active", { ascending: false }),
    contentQ
      .order("date_created", { ascending: false })
      .limit(contentParams.limit),
    supabase
      .from("social")
      .select("network")
      .eq("id_client", clientId)
      .is("date_deleted", null),
  ]);

  const client = clientRes.data;
  if (!client) return null;

  // Categorize content by status
  const content = contentRes.data || [];
  const commissioned = content.filter((c: any) => c.flag_completed !== 1 && c.flag_spiked !== 1);
  const completed = content.filter((c: any) => c.flag_completed === 1);
  const spiked = content.filter((c: any) => c.flag_spiked === 1);

  // Summarize social platforms used
  const social = socialRes.data || [];
  const platformCounts: Record<string, number> = {};
  social.forEach((s: any) => {
    if (s.network) platformCounts[s.network] = (platformCounts[s.network] || 0) + 1;
  });

  // Content type breakdown by category
  const typeBreakdown: Record<string, { total: number; commissioned: number; completed: number; spiked: number }> = {};
  content.forEach((c: any) => {
    const t = c.type_content || "other";
    if (!typeBreakdown[t]) typeBreakdown[t] = { total: 0, commissioned: 0, completed: 0, spiked: 0 };
    typeBreakdown[t].total++;
    if (c.flag_completed === 1) typeBreakdown[t].completed++;
    else if (c.flag_spiked === 1) typeBreakdown[t].spiked++;
    else typeBreakdown[t].commissioned++;
  });

  // For full contracts: build map of content items per contract
  const contractContentMap: Record<number, any[]> = {};
  if (fullContracts) {
    content.forEach((c: any) => {
      if (c.id_contract) {
        if (!contractContentMap[c.id_contract]) contractContentMap[c.id_contract] = [];
        contractContentMap[c.id_contract].push(c);
      }
    });
  }

  return {
    name: client.name_client,
    industry: client.information_industry,
    description: client.information_description,
    contracts: (contractsRes.data || []).map((c: any) => ({
      id: c.id_contract,
      name: c.name_contract,
      totalUnits: c.units_contract,
      completedUnits: c.units_total_completed,
      active: c.flag_active === 1,
      startDate: c.date_start,
      endDate: c.date_end,
      notes: c.information_notes,
      ...(fullContracts && contractContentMap[c.id_contract]?.length ? {
        commissionedContent: contractContentMap[c.id_contract].map((item: any) => ({
          title: item.name_content,
          type: item.type_content || "other",
          cu: item.units_content || 0,
          status: item.flag_completed === 1 ? "Completed" : item.flag_spiked === 1 ? "Spiked" : "Commissioned",
        }))
      } : {}),
    })),
    contentSummary: {
      total: content.length,
      commissioned: commissioned.length,
      completed: completed.length,
      spiked: spiked.length,
      totalCU: content.reduce((sum: number, c: any) => sum + (c.units_content || 0), 0),
      byType: typeBreakdown,
      recentCommissioned: commissioned.slice(0, 8).map((c: any) => `${c.name_content} (${c.type_content})`),
      recentCompleted: completed.slice(0, 8).map((c: any) => `${c.name_content} (${c.type_content})`),
      recentSpiked: spiked.slice(0, 5).map((c: any) => `${c.name_content} (${c.type_content})`),
    },
    ...(fullContent ? {
      contentItems: content.map((c: any) => ({
        title: c.name_content,
        type: c.type_content || "other",
        cu: c.units_content || 0,
        status: c.flag_completed === 1 ? "Completed" : c.flag_spiked === 1 ? "Spiked" : "Commissioned",
        brief: c.information_brief || undefined,
        audience: c.information_audience || undefined,
        topics: c.name_topic_array || undefined,
        campaigns: c.name_campaign_array || undefined,
        platform: c.information_platform || undefined,
      }))
    } : {}),
    socialPlatforms: platformCounts,
  };
}

// ── Helper: fetch ideas for a specific client ──
async function fetchClientIdeas(clientId: number, detailLevel?: DetailLevel) {
  const isFull = detailLevel ? isFullDetail(detailLevel) : false;
  const params = isFull && detailLevel ? getDetailParams(detailLevel) : { dateCutoff: null, limit: 20 };

  let q = supabase
    .from("app_ideas")
    .select("name_idea, information_brief, status, name_topic_array, date_created, date_commissioned")
    .eq("id_client", clientId);
  if (params.dateCutoff) {
    q = q.gte("date_created", params.dateCutoff);
  }
  const { data: rows } = await q
    .order("date_created", { ascending: false })
    .limit(params.limit);

  return (rows || []).map((r: any) => ({
    title: r.name_idea as string,
    brief: r.information_brief as string | null,
    status: r.status as string,
    topicTags: r.name_topic_array as string[] | null,
    createdAt: r.date_created as string,
    commissionedAt: r.date_commissioned as string | null,
  }));
}

// ── Helper: fetch workspace-level summary for "All Clients" mode ──
async function fetchWorkspaceSummary() {
  const [clientsRes, contractsRes, contentRes, ideasRes] = await Promise.all([
    supabase
      .from("app_clients")
      .select("id_client, name_client"),
    supabase
      .from("app_contracts")
      .select("units_contract, units_total_completed, name_client")
      .eq("flag_active", 1),
    supabase
      .from("app_content")
      .select("name_content, type_content, flag_completed, flag_spiked, units_content, name_client")
      .order("date_created", { ascending: false })
      .limit(100),
    supabase
      .from("app_ideas")
      .select("name_idea, information_brief, status, name_client, date_created, date_commissioned")
      .order("date_created", { ascending: false })
      .limit(50),
  ]);

  const clients = clientsRes.data || [];
  const contracts = contractsRes.data || [];
  const content = contentRes.data || [];
  const ideas = ideasRes.data || [];

  // Content summary
  const published = content.filter((c: any) => c.flag_completed === 1);
  const inProduction = content.filter((c: any) => c.flag_completed !== 1 && c.flag_spiked !== 1);
  const totalCU = content.reduce((sum: number, c: any) => sum + (c.units_content || 0), 0);

  // Ideas status breakdown
  const ideasByStatus: Record<string, number> = {};
  ideas.forEach((i: any) => {
    const s = i.status || "unknown";
    ideasByStatus[s] = (ideasByStatus[s] || 0) + 1;
  });

  // Ideas this week
  const weekAgo = new Date();
  weekAgo.setDate(weekAgo.getDate() - 7);
  const ideasThisWeek = ideas.filter((i: any) => i.date_created && new Date(i.date_created) >= weekAgo);

  // Contracts summary
  const totalContractCU = contracts.reduce((sum: number, c: any) => sum + (c.units_contract || 0), 0);
  const completedContractCU = contracts.reduce((sum: number, c: any) => sum + (c.units_total_completed || 0), 0);

  return {
    clientCount: clients.length,
    contracts: {
      active: contracts.length,
      totalCU: totalContractCU,
      completedCU: completedContractCU,
      remainingCU: totalContractCU - completedContractCU,
    },
    content: {
      total: content.length,
      published: published.length,
      inProduction: inProduction.length,
      totalCU,
    },
    ideas: {
      total: ideas.length,
      byStatus: ideasByStatus,
      thisWeek: ideasThisWeek.length,
      recent: ideas.slice(0, 20).map((i: any) => ({
        title: i.name_idea as string,
        brief: i.information_brief as string | null,
        status: i.status as string,
        clientName: i.name_client as string | null,
        createdAt: i.date_created as string,
        commissionedAt: i.date_commissioned as string | null,
      })),
    },
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
    const userAttachments: Attachment[] | undefined = body.attachments;

    if (!userContent?.trim() && (!userAttachments || userAttachments.length === 0)) {
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
      content: (userContent || "").trim(),
      attachments: userAttachments ? JSON.stringify(userAttachments) : null,
      createdBy: userId,
    });

    // Load conversation history + workspace config + AI settings in parallel
    const [history, workspaceConfig, wsSettings] = await Promise.all([
      db
        .select({
          role: aiMessages.role,
          content: aiMessages.content,
          attachments: aiMessages.attachments,
        })
        .from(aiMessages)
        .where(eq(aiMessages.conversationId, conversationId))
        .orderBy(asc(aiMessages.createdAt)),
      fetchWorkspaceConfig(),
      db
        .select({
          aiContextConfig: workspaces.aiContextConfig,
          aiCuDescription: workspaces.aiCuDescription,
          aiMaxTokens: workspaces.aiMaxTokens,
          aiDebugMode: workspaces.aiDebugMode,
        })
        .from(workspaces)
        .where(eq(workspaces.id, conversation.workspaceId))
        .limit(1),
    ]);

    // Allow per-request context config override from the client (normalize to detail levels)
    const contextConfig = normalizeContextConfig(body.contextConfig ?? wsSettings[0]?.aiContextConfig ?? undefined);
    const cuDescription = wsSettings[0]?.aiCuDescription ?? undefined;
    const maxTokens = wsSettings[0]?.aiMaxTokens || 4096;
    const debugMode = body.debugMode || wsSettings[0]?.aiDebugMode || false;

    // Build messages with attachments for AI
    const messages: AIMessage[] = [];
    for (const m of history) {
      const msg: AIMessage = {
        role: m.role as "user" | "assistant" | "system",
        content: m.content,
      };

      // Parse and prepare attachments for user messages
      if (m.role === "user" && m.attachments) {
        try {
          const parsed: Attachment[] = JSON.parse(m.attachments);
          if (parsed.length > 0) {
            msg.attachments = await prepareAttachmentsForAI(parsed);
          }
        } catch {
          // Ignore malformed attachments JSON
        }
      }

      messages.push(msg);
    }

    // Build context based on conversation scope
    let clientContext: Awaited<ReturnType<typeof fetchClientContext>> = null;
    let contentDetail: Awaited<ReturnType<typeof fetchContentDetail>> = null;
    let clientIdeas: Awaited<ReturnType<typeof fetchClientIdeas>> | null = null;
    let workspaceSummary: Awaited<ReturnType<typeof fetchWorkspaceSummary>> | null = null;

    if (conversation.contentObjectId) {
      // Content-specific conversation — fetch content detail + client context
      contentDetail = await fetchContentDetail(conversation.contentObjectId);
      if (contentDetail?.clientId) {
        const [cc, ci] = await Promise.all([
          fetchClientContext(contentDetail.clientId, contextConfig),
          contextConfig.ideas !== "off" ? fetchClientIdeas(contentDetail.clientId, contextConfig.ideas) : null,
        ]);
        clientContext = cc;
        clientIdeas = ci;
      }
    } else if (conversation.customerId) {
      // Client-scoped standalone conversation
      const [cc, ci] = await Promise.all([
        fetchClientContext(conversation.customerId, contextConfig),
        contextConfig.ideas !== "off" ? fetchClientIdeas(conversation.customerId, contextConfig.ideas) : null,
      ]);
      clientContext = cc;
      clientIdeas = ci;
    } else {
      // Workspace-level "All Clients" conversation
      workspaceSummary = await fetchWorkspaceSummary();
    }

    const systemPrompt = buildSystemPrompt({
      workspaceConfig,
      clientContext,
      contentDetail,
      contextConfig,
      cuDescription,
      clientIdeas,
      workspaceSummary,
    });

    const model = body.model || conversation.model;

    // Auto-title: if this is the first user message, set conversation title
    const userMessages = messages.filter((m) => m.role === "user");
    if (userMessages.length === 1) {
      const titleSource = (userContent || "").trim() || (userAttachments?.[0]?.name || "File upload");
      const autoTitle =
        titleSource.length > 60
          ? titleSource.slice(0, 57) + "..."
          : titleSource;
      await db
        .update(aiConversations)
        .set({ title: autoTitle, updatedAt: new Date() })
        .where(eq(aiConversations.id, conversationId));
    }

    // Create streaming response
    const aiStream = createStreamingResponse(
      messages,
      { model, systemPrompt, maxTokens, webSearch: contextConfig.webSearch === "on" },
      async ({ fullText, inputTokens, outputTokens }) => {
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

        // Log AI usage for cost tracking
        const costTenths = calculateCostTenths(model, inputTokens, outputTokens);
        await db.insert(aiUsage).values({
          workspaceId: conversation.workspaceId,
          userId,
          model,
          source: conversation.contentObjectId ? "engine" : "enginegpt",
          inputTokens,
          outputTokens,
          costTenths,
          conversationId,
        });
      }
    );

    // Wrap stream: prepend debug context if debug mode is on
    const stream = debugMode
      ? new ReadableStream({
          async start(controller) {
            const encoder = new TextEncoder();
            controller.enqueue(
              encoder.encode(`data: ${JSON.stringify({ debugContext: systemPrompt })}\n\n`)
            );
            const reader = aiStream.getReader();
            try {
              while (true) {
                const { done, value } = await reader.read();
                if (done) break;
                controller.enqueue(value);
              }
            } finally {
              controller.close();
            }
          },
        })
      : aiStream;

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
