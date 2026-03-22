import { NextRequest } from "next/server";
import { auth } from "@/lib/auth";
import { intelligenceDb } from "@/lib/supabase-intelligence";
import { checkConversationAccess } from "@/lib/ai/access";
import { supabase } from "@/lib/supabase";
import { createStreamingResponse, type AIMessage, type AIAttachment } from "@/lib/ai/providers";
import { buildSystemPrompt, normalizeContextConfig, isFullDetail, type NormalizedContextConfig, type DetailLevel } from "@/lib/ai/system-prompts";
import { fetchBlobContent } from "@/lib/ai/blob-utils";
import { extractMemories } from "@/lib/ai/memory-extraction";
import {
  computeImportance,
  runConsolidationPipeline,
} from "@/lib/ai/memory-consolidation";
import {
  shouldUpdateSummary,
  runBackgroundSummaryUpdate,
} from "@/lib/ai/conversation-summary";
import type { Attachment } from "@/lib/types/ai";

export const maxDuration = 120; // Allow up to 2 minutes for AI streaming responses

// ── Cost calculation for usage tracking ──
const MODEL_COSTS: Record<string, { inputPer1M: number; outputPer1M: number }> = {
  "claude-sonnet-4-6": { inputPer1M: 300, outputPer1M: 1500 },       // $3/$15
  "claude-sonnet-4-20250514": { inputPer1M: 300, outputPer1M: 1500 },
  "gpt-4o": { inputPer1M: 250, outputPer1M: 1000 },                  // $2.50/$10
  "gpt-4o-mini": { inputPer1M: 15, outputPer1M: 60 },                // $0.15/$0.60
  "gpt-4.1": { inputPer1M: 200, outputPer1M: 800 },                  // $2/$8
  "grok-4-1-fast": { inputPer1M: 20, outputPer1M: 50 },              // $0.20/$0.50
  "grok-3-mini": { inputPer1M: 30, outputPer1M: 50 },                // $0.30/$0.50
  "grok-3": { inputPer1M: 300, outputPer1M: 1500 },                  // $3/$15
  "grok-4": { inputPer1M: 200, outputPer1M: 1000 },                  // $2/$10
  "mistral-large-latest": { inputPer1M: 200, outputPer1M: 600 },     // $2/$6
  "gemini-2.5-flash": { inputPer1M: 15, outputPer1M: 60 },           // $0.15/$0.60
  "gemini-2.5-pro": { inputPer1M: 125, outputPer1M: 1000 },          // $1.25/$10
  "gemini-3-flash": { inputPer1M: 50, outputPer1M: 300 },            // $0.50/$3
  "gemini-3.1-flash-lite": { inputPer1M: 25, outputPer1M: 150 },     // $0.25/$1.50
};

function calculateCostTenths(model: string, inputTokens: number, outputTokens: number): number {
  const rates = MODEL_COSTS[model] || MODEL_COSTS["claude-sonnet-4-6"];
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
// If `extractedText` is already cached on the attachment, skip re-extraction.
async function prepareAttachmentsForAI(attachments: Attachment[]): Promise<AIAttachment[]> {
  const prepared: AIAttachment[] = [];

  for (const att of attachments) {
    const aiAtt: AIAttachment = {
      url: att.url,
      name: att.name,
      type: att.type,
    };

    // Use cached extracted text if available; otherwise extract fresh
    if (!att.type.startsWith("image/")) {
      if ((att as any).extractedText) {
        aiAtt.extractedText = (att as any).extractedText;
      } else {
        aiAtt.extractedText = await extractDocumentText(att);
      }
    }

    prepared.push(aiAtt);
  }

  return prepared;
}

// ── Helper: fetch workspace-level config (content types + CU definitions + format descriptions) ──
async function fetchWorkspaceConfig(workspaceId?: string) {
  const [typesRes, cuRes] = await Promise.all([
    supabase
      .from("types_content")
      .select("id_type, key_type, type_content, flag_active")
      .eq("flag_active", 1),
    supabase
      .from("calculator_content")
      .select("id, name, format, units_content")
      .order("sort_order"),
  ]);

  // Fetch format descriptions + type instructions from ai_settings
  let formatDescriptions: Record<string, string> = {};
  let typeInstructions: Record<string, string> = {};
  if (workspaceId) {
    try {
      const { data: settings } = await intelligenceDb
        .from("ai_settings")
        .select("information_format_descriptions, information_type_instructions")
        .eq("id_workspace", workspaceId)
        .maybeSingle();
      formatDescriptions = settings?.information_format_descriptions || {};
      typeInstructions = settings?.information_type_instructions || {};
    } catch {
      // Ignore — optional
    }
  }

  // Build format ID → name map for resolving descriptions
  const cuData = cuRes.data || [];
  const idToName: Record<string, string> = {};
  cuData.forEach((c) => { idToName[c.id] = c.name; });

  // Resolve format descriptions: map IDs to names
  const resolvedDescriptions: Record<string, string> = {};
  for (const [id, desc] of Object.entries(formatDescriptions)) {
    if (desc?.trim()) {
      const name = idToName[id] || id;
      resolvedDescriptions[name] = desc;
    }
  }

  return {
    contentTypes: (typesRes.data || []).map((t) => ({
      key: t.key_type,
      name: t.type_content,
      aiPrompt: null,
    })),
    cuDefinitions: cuData.map((c) => ({
      format: c.name,
      category: c.format,
      units: c.units_content,
    })),
    formatDescriptions: resolvedDescriptions,
    typeInstructions,
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
    ? "id_content, name_content, type_content, flag_completed, flag_spiked, units_content, id_contract, date_completed, document_type, information_brief, information_audience, name_topic_array, name_campaign_array, information_platform"
    : "id_content, name_content, type_content, flag_completed, flag_spiked, units_content, id_contract, date_completed, document_type";

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

  // Fetch current tasks for content items (latest non-completed task per content)
  const content = contentRes.data || [];
  const taskMap: Record<number, { type: string; assignee: string }> = {};
  if (content.length > 0) {
    const contentIds = content
      .map((c: any) => c.id_content)
      .filter((id: any) => id != null);
    if (contentIds.length > 0) {
      const { data: tasks } = await supabase
        .from("app_tasks_content")
        .select("id_content, type_task, name_user_assignee, date_completed")
        .in("id_content", contentIds)
        .is("date_completed", null)
        .order("order_sort", { ascending: true });
      if (tasks) {
        // Keep only the first (current) incomplete task per content item
        for (const t of tasks) {
          if (t.id_content && !taskMap[t.id_content]) {
            taskMap[t.id_content] = {
              type: t.type_task || "",
              assignee: t.name_user_assignee || "",
            };
          }
        }
      }
    }
  }

  // Categorize content by status
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
    id: client.id_client,
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
        commissionedContent: contractContentMap[c.id_contract].map((item: any) => {
          const task = item.id_content ? taskMap[item.id_content] : null;
          return {
            id: item.id_content || null,
            title: item.name_content,
            type: item.type_content || "other",
            format: item.document_type || null,
            cu: item.units_content || 0,
            status: item.flag_completed === 1 ? "Completed" : item.flag_spiked === 1 ? "Spiked" : "Commissioned",
            dateCompleted: item.date_completed || null,
            currentTask: task?.type || null,
            taskAssignee: task?.assignee || null,
          };
        })
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

// ── Helper: fetch workspace-level summary for "General" mode ──
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
    const { data: conversation } = await intelligenceDb
      .from("ai_conversations")
      .select("*")
      .eq("id_conversation", conversationId)
      .maybeSingle();

    if (!conversation) {
      return new Response(JSON.stringify({ error: "Conversation not found" }), {
        status: 404,
        headers: { "Content-Type": "application/json" },
      });
    }

    // Share-aware access check (function expects camelCase params)
    const access = await checkConversationAccess(conversationId, userId, {
      visibility: conversation.type_visibility,
      userCreated: conversation.user_created,
      workspaceId: conversation.id_workspace,
    });
    if (!access.allowed) {
      return new Response(JSON.stringify({ error: "Forbidden" }), {
        status: 403,
        headers: { "Content-Type": "application/json" },
      });
    }
    if (access.permission === "view") {
      return new Response(JSON.stringify({ error: "Read-only access" }), {
        status: 403,
        headers: { "Content-Type": "application/json" },
      });
    }

    // Pre-extract text from document attachments so we can cache it in the DB
    // This avoids re-downloading and re-parsing on every subsequent message
    let enrichedAttachments: Attachment[] | null = null;
    if (userAttachments?.length) {
      enrichedAttachments = await Promise.all(
        userAttachments.map(async (att) => {
          if (!att.type.startsWith("image/") && !(att as any).extractedText) {
            const extracted = await extractDocumentText(att);
            if (extracted) return { ...att, extractedText: extracted } as any;
          }
          return att;
        })
      );
    }

    // Save user message with cached extracted text (skip in incognito)
    if (!conversation.flag_incognito) {
      const { error: msgErr } = await intelligenceDb.from("ai_messages").insert({
        id_conversation: conversationId,
        role_message: "user",
        document_message: (userContent || "").trim(),
        attachments: enrichedAttachments || null,
        user_created: userId,
      });
      if (msgErr) console.error("[Messages] Failed to save user message:", msgErr);
    }

    // Load conversation history + workspace config + AI settings in parallel
    const [historyRes, workspaceConfig, settingsRes] = await Promise.all([
      intelligenceDb
        .from("ai_messages")
        .select("role_message, document_message, attachments")
        .eq("id_conversation", conversationId)
        .order("date_created", { ascending: true }),
      fetchWorkspaceConfig(conversation.id_workspace),
      intelligenceDb
        .from("ai_settings")
        .select("config_context, information_cu_description, units_max_tokens, flag_debug")
        .eq("id_workspace", conversation.id_workspace)
        .maybeSingle(),
    ]);

    const history = historyRes.data || [];
    const wsSettings = settingsRes.data;

    // Allow per-request context config override from the client (normalize to detail levels)
    const contextConfig = normalizeContextConfig(body.contextConfig ?? wsSettings?.config_context ?? undefined);
    const cuDescription = wsSettings?.information_cu_description ?? undefined;
    const maxTokens = wsSettings?.units_max_tokens || 4096;
    const debugMode = body.debugMode || wsSettings?.flag_debug || false;

    // Determine if memory/summary features are enabled for this request
    // (used by truncation, memory extraction, and summary generation)
    const isIncognito = contextConfig.incognito === "on";
    const memoryEnabled = !isIncognito && contextConfig.memory !== "off";

    // Build messages with attachments for AI
    // Context window truncation: keep conversations manageable for AI models.
    // Long conversations with many tool calls (image gen, queries) bloat the
    // context and cause models to stop calling tools or hit token limits.
    const hasSummary = !!conversation.document_summary;
    const shouldTruncate = memoryEnabled && history.length > 30 && hasSummary;
    // Always cap at last 20 messages regardless — prevents tool call history
    // from overwhelming the model (each image gen adds ~3 messages)
    const MAX_HISTORY = 20;
    const cappedHistory = history.length > MAX_HISTORY ? history.slice(-MAX_HISTORY) : history;
    const effectiveHistory = shouldTruncate ? history.slice(-MAX_HISTORY) : cappedHistory;

    if (shouldTruncate) {
      console.log(`[Messages] Truncating context: ${history.length} messages → summary + last 20`);
    }

    // Collapse consecutive user messages (orphaned messages from failed responses).
    // Keep only the last user message in each consecutive run to avoid the model
    // trying to answer 5+ unanswered questions at once and hitting timeouts.
    const deduped: typeof effectiveHistory = [];
    for (let i = 0; i < effectiveHistory.length; i++) {
      const isUser = effectiveHistory[i].role_message === "user";
      const nextIsUser = i + 1 < effectiveHistory.length && effectiveHistory[i + 1].role_message === "user";
      if (isUser && nextIsUser) {
        // Skip — keep only the last user message in a consecutive run
        continue;
      }
      deduped.push(effectiveHistory[i]);
    }
    if (deduped.length < effectiveHistory.length) {
      console.log(`[Messages] Collapsed ${effectiveHistory.length - deduped.length} orphaned user messages`);
    }

    const messages: AIMessage[] = [];

    // Inject summary as context if truncating
    if (shouldTruncate) {
      messages.push({
        role: "system" as const,
        content: `[Earlier conversation context]\n${conversation.document_summary}`,
      });
    }

    // Detect if the user's latest message references a previous image/output
    // (e.g., "make that red", "another version", "change the background", "try again")
    const latestUserContent = (body.content || "").toLowerCase();
    const referencesImage = /\b(that|it|the image|the picture|this one|another|again|version|redo|modify|change|adjust|tweak|make it|more like|less|same but|similar|background|color|style|angle|pose)\b/i.test(latestUserContent);

    // Find the index of the last assistant message that contains a generated image
    let lastImageAssistantIdx = -1;
    for (let i = deduped.length - 1; i >= 0; i--) {
      if (deduped[i].role_message === "assistant" && /!\[Generated image\]\(/.test(deduped[i].document_message)) {
        lastImageAssistantIdx = i;
        break;
      }
    }

    for (let hi = 0; hi < deduped.length; hi++) {
      const m = deduped[hi];
      let content = m.document_message;

      // For assistant messages: strip image/chart/doc markdown from conversation history
      // to keep context lean. But if the user references a previous image, keep the
      // MOST RECENT generated image intact so the model can iterate on it.
      if (m.role_message === "assistant") {
        const keepThisImage = referencesImage && hi === lastImageAssistantIdx;

        if (!keepThisImage) {
          content = content
            .replace(/!\[Generated image\]\([^)]+\)/g, "[Previously generated image]")
            .replace(/!\[[^\]]*\]\(\/api\/media\/[^)]+\)/g, "[Previously generated visual]")
            .replace(/📄\s*\[Download [^\]]+\]\([^)]+\)/g, "[Previously generated document]")
            .replace(/\n{3,}/g, "\n\n")
            .trim();
        }
      }

      const msg: AIMessage = {
        role: m.role_message as "user" | "assistant" | "system",
        content,
      };

      // Parse and prepare attachments for user messages
      // Supabase JSONB returns parsed objects; handle both string and object
      if (m.role_message === "user" && m.attachments) {
        try {
          const parsed: Attachment[] = typeof m.attachments === "string"
            ? JSON.parse(m.attachments)
            : m.attachments;
          if (parsed.length > 0) {
            msg.attachments = await prepareAttachmentsForAI(parsed);
          }
        } catch {
          // Ignore malformed attachments
        }
      }

      messages.push(msg);
    }

    // ── Parallel fetch: context, memories, role, user prefs ──
    // These are all independent and can run concurrently

    // Build memory query with V2 scored retrieval
    const memoryPromise = (!isIncognito && contextConfig.memory !== "off")
      ? (async (): Promise<{ content: string; category: string; strength: number }[]> => {
          let memoryQuery = intelligenceDb
            .from("ai_memories")
            .select("id_memory, information_content, type_category, score_strength, count_reinforced, date_last_accessed, type_source")
            .eq("id_workspace", conversation.id_workspace)
            .eq("flag_active", 1);

          if (conversation.type_visibility === "private") {
            memoryQuery = memoryQuery.or(
              `and(type_scope.eq.private,user_memory.eq.${userId}),type_scope.eq.team`
            );
          } else {
            memoryQuery = memoryQuery.eq("type_scope", "team");
          }

          const { data } = await memoryQuery;
          if (!data || data.length === 0) return [];

          // Score each memory using importance formula (decay + reinforcement + recency)
          const scored = data.map((m: any) => {
            const { decayedStrength, importance } = computeImportance({
              score_strength: m.score_strength ?? 1.0,
              count_reinforced: m.count_reinforced ?? 0,
              date_last_accessed: m.date_last_accessed ?? m.date_created,
              type_category: m.type_category,
              type_source: m.type_source ?? "inferred",
            });
            return {
              id: m.id_memory,
              content: m.information_content,
              category: m.type_category,
              strength: Math.round(decayedStrength * 100) / 100,
              importance,
            };
          });

          // Sort by importance descending, take top 25
          scored.sort((a: any, b: any) => b.importance - a.importance);
          const selected = scored.slice(0, 25);

          // NOTE: We intentionally do NOT update date_last_accessed here.
          // Passive retrieval (loading memories into system prompt) should not
          // reset the decay clock. Only active reinforcement/update/contradiction
          // (in applyConsolidationAction) should refresh access time.
          // Without this, memories never decay because they're "accessed" on every message.

          return selected.map((m: any) => ({
            content: m.content,
            category: m.category,
            strength: m.strength,
          }));
        })()
      : Promise.resolve([]);

    // Role fetch (if specified)
    const rolePromise = body.roleId
      ? (async () => {
          const { data } = await intelligenceDb
            .from("ai_roles")
            .select("name_role, information_instructions")
            .eq("id_role", body.roleId)
            .maybeSingle();
          return data ? { name: data.name_role, instructions: data.information_instructions } : null;
        })()
      : Promise.resolve(null);

    // User preferences fetch
    const userPrefsPromise = (async () => {
      const { data } = await intelligenceDb
        .from("users_access")
        .select("information_personal_context, name_region, data_selected_roles")
        .eq("id_workspace", conversation.id_workspace)
        .eq("user_target", userId)
        .maybeSingle();
      return data;
    })();

    // Context fetch (client / content / workspace)
    const contextPromise = (async () => {
      let clientContext: Awaited<ReturnType<typeof fetchClientContext>> = null;
      let contentDetail: Awaited<ReturnType<typeof fetchContentDetail>> = null;
      let clientIdeas: Awaited<ReturnType<typeof fetchClientIdeas>> | null = null;
      let workspaceSummary: Awaited<ReturnType<typeof fetchWorkspaceSummary>> | null = null;

      if (conversation.id_content) {
        contentDetail = await fetchContentDetail(conversation.id_content);
        if (contentDetail?.clientId) {
          const [cc, ci] = await Promise.all([
            fetchClientContext(contentDetail.clientId, contextConfig),
            contextConfig.ideas !== "off" ? fetchClientIdeas(contentDetail.clientId, contextConfig.ideas) : null,
          ]);
          clientContext = cc;
          clientIdeas = ci;
        }
      } else if (conversation.id_client) {
        const [cc, ci] = await Promise.all([
          fetchClientContext(conversation.id_client, contextConfig),
          contextConfig.ideas !== "off" ? fetchClientIdeas(conversation.id_client, contextConfig.ideas) : null,
        ]);
        clientContext = cc;
        clientIdeas = ci;
      } else {
        workspaceSummary = await fetchWorkspaceSummary();
      }

      return { clientContext, contentDetail, clientIdeas, workspaceSummary };
    })();

    // Fetch workspace client IDs for query_engine tool scoping
    const clientIdsPromise = (async () => {
      const { data } = await supabase
        .from("app_clients")
        .select("id_client");
      return (data || []).map((c: any) => c.id_client).filter(Boolean) as number[];
    })();

    // Fetch processed client background profile (from asset files)
    // Note: if conversation is content-scoped (id_content but no id_client),
    // the client ID is resolved later via fetchContentDetail — we fetch
    // the background after the parallel block in that case.
    const clientBackgroundPromise = conversation.id_client
      ? (async () => {
          const { data } = await intelligenceDb
            .from("ai_client_context")
            .select("document_context, meeting_context, units_asset_count, date_last_processed")
            .eq("id_client", conversation.id_client)
            .maybeSingle();
          return data;
        })()
      : Promise.resolve(null);

    // MeetingBrain / external app context (skip in incognito or when toggled off)
    const meetingBrainEnabled = contextConfig.meetingBrain !== "off";
    const appContextPromise = !isIncognito && meetingBrainEnabled
      ? (async () => {
          const { data } = await intelligenceDb
            .from("user_app_context")
            .select("type_context, information_content")
            .eq("user_target", userId)
            .eq("name_source", "meetingbrain");
          return data || [];
        })()
      : Promise.resolve([]);

    // Run all in parallel
    const [memories, role, userPrefs, ctx, appContextRows, workspaceClientIds, clientBackground] = await Promise.all([
      memoryPromise,
      rolePromise,
      userPrefsPromise,
      contextPromise,
      appContextPromise,
      clientIdsPromise,
      clientBackgroundPromise,
    ]);

    const { clientContext, contentDetail, clientIdeas, workspaceSummary } = ctx;

    // If conversation is content-scoped, fetch client background now that we know the client ID
    let resolvedClientBackground = clientBackground;
    if (!resolvedClientBackground && contentDetail?.clientId) {
      const { data } = await intelligenceDb
        .from("ai_client_context")
        .select("document_context, meeting_context, units_asset_count, date_last_processed")
        .eq("id_client", contentDetail.clientId)
        .maybeSingle();
      resolvedClientBackground = data;
    }

    // Resolve selected role IDs to role objects (depends on userPrefs)
    let selectedRoles: { name: string; instructions: string }[] = [];
    const selectedRoleIds: string[] = userPrefs?.data_selected_roles || [];
    if (selectedRoleIds.length > 0) {
      const { data: roleRows } = await intelligenceDb
        .from("ai_roles")
        .select("name_role, information_instructions")
        .in("id_role", selectedRoleIds)
        .eq("flag_active", 1);
      selectedRoles = (roleRows || []).map((r: any) => ({
        name: r.name_role,
        instructions: r.information_instructions,
      }));
    }

    // Privacy: exclude personal/sensitive data from team threads
    const isTeamThread = conversation.type_visibility === "team";

    // MeetingBrain context: only for private/shared threads (never team threads)
    // When in a client conversation with linked meeting context, exclude general
    // meetings/upcoming to avoid leaking unrelated meetings into client scope.
    const hasClientMeetings = resolvedClientBackground?.meeting_context;
    const filteredAppContext = isTeamThread ? [] : appContextRows.filter((r: any) => {
      if (hasClientMeetings && (r.type_context === "meetings" || r.type_context === "upcoming_meetings")) {
        return false; // Use client-linked meetings instead
      }
      return true;
    });
    const meetingBrainContext = filteredAppContext.length > 0
      ? filteredAppContext.map((r: any) => r.information_content).join("\n\n")
      : null;

    if (appContextRows.length > 0) {
      console.log(`[Messages] MeetingBrain context: ${appContextRows.length} rows, ${meetingBrainContext?.length || 0} chars${isTeamThread ? " (excluded — team thread)" : ""}`);
    }

    // Resolve model — "auto" routes to the best model based on the prompt
    let model = body.model || conversation.name_model;
    if (model === "auto") {
      const { routeModel } = await import("@/lib/ai/auto-router");
      model = routeModel(userContent || "");
      console.log(`[Messages] Auto-routed → ${model}`);
    }

    // Route query to determine search mode and data source hints
    const { routeQuery } = await import("@/lib/ai/query-router");
    const queryRoute = routeQuery(userContent || "", contextConfig);
    console.log(`[Messages] Query route: intent=${queryRoute.intent}, searchMode=${queryRoute.searchMode}, hints=${queryRoute.hints.length}`);

    let systemPrompt = buildSystemPrompt({
      workspaceConfig,
      clientContext,
      contentDetail,
      contextConfig,
      cuDescription,
      clientIdeas,
      workspaceSummary,
      memories: memories.length > 0 ? memories : undefined,
      role,
      selectedRoles: selectedRoles.length > 0 ? selectedRoles : undefined,
      latestUserMessage: userContent || "",
      personalContext: isTeamThread ? null : (userPrefs?.information_personal_context || null),
      meetingBrainContext,
      region: userPrefs?.name_region || null,
      clientBackground: resolvedClientBackground || null,
    });

    // Append query router hints to system prompt
    if (queryRoute.hints.length > 0) {
      systemPrompt += "\n\n<!-- Query Router Hints -->\n" + queryRoute.hints.join("\n");
    }

    // Auto-title: if this is the first user message, set conversation title (skip incognito)
    const userMessages = messages.filter((m) => m.role === "user");
    if (userMessages.length === 1 && !conversation.flag_incognito) {
      const titleSource = (userContent || "").trim() || (userAttachments?.[0]?.name || "File upload");
      const autoTitle =
        titleSource.length > 60
          ? titleSource.slice(0, 57) + "..."
          : titleSource;
      await intelligenceDb
        .from("ai_conversations")
        .update({ name_conversation: autoTitle, date_updated: new Date().toISOString() })
        .eq("id_conversation", conversationId);
    }

    // Create streaming response
    const aiStream = createStreamingResponse(
      messages,
      { model, systemPrompt, maxTokens, webSearch: queryRoute.searchMode === "on", imageGeneration: contextConfig.imageGeneration === "on", workspaceClientIds, workspaceId: conversation.id_workspace, userId, userEmail: session.user?.email || undefined, selectedClientId: conversation.id_client || undefined },
      async ({ fullText, inputTokens, outputTokens }) => {
        // Skip all persistence in incognito mode
        if (!conversation.flag_incognito) {
          const { error: assistantErr } = await intelligenceDb
            .from("ai_messages")
            .insert({
              id_conversation: conversationId,
              role_message: "assistant",
              document_message: fullText,
              name_model: model,
            });
          if (assistantErr) console.error("[Messages] Failed to save assistant message:", assistantErr);

          const { error: updateErr } = await intelligenceDb
            .from("ai_conversations")
            .update({ date_updated: new Date().toISOString() })
            .eq("id_conversation", conversationId);
          if (updateErr) console.error("[Messages] Failed to update conversation:", updateErr);

          // Log AI usage for cost tracking
          const costTenths = calculateCostTenths(model, inputTokens, outputTokens);
          const { error: usageErr } = await intelligenceDb
            .from("ai_usage")
            .insert({
              id_workspace: conversation.id_workspace,
              user_usage: userId,
              name_model: model,
              type_source: conversation.id_content ? "engine" : "enginegpt",
              units_input: inputTokens,
              units_output: outputTokens,
              units_cost_tenths: costTenths,
              id_conversation: conversationId,
            });
          if (usageErr) console.error("[Usage] Failed to log:", usageErr);
        }
      }
    );

    // Wrap stream: inject debug context, capture text, extract & auto-save memories
    const stream = new ReadableStream({
      async start(controller) {
        const encoder = new TextEncoder();
        const decoder = new TextDecoder();

        // Send debug context if enabled
        if (debugMode) {
          controller.enqueue(
            encoder.encode(`data: ${JSON.stringify({ debugContext: systemPrompt })}\n\n`)
          );
        }

        // Pass through AI stream, intercepting [DONE] for memory extraction
        const reader = aiStream.getReader();
        let capturedText = "";
        try {
          while (true) {
            const { done, value } = await reader.read();
            if (done) break;

            // Capture text tokens for memory extraction
            if (memoryEnabled) {
              const chunk = decoder.decode(value, { stream: true });
              for (const line of chunk.split("\n")) {
                if (line.startsWith("data: ") && line.slice(6) !== "[DONE]") {
                  try {
                    const parsed = JSON.parse(line.slice(6));
                    if (parsed.token) capturedText += parsed.token;
                  } catch {}
                }
              }
            }

            // Forward all chunks immediately — no [DONE] interception
            controller.enqueue(value);
          }
        } finally {
          controller.close();
        }

        // Fire-and-forget: background memory extraction after stream closes
        // Client already received [DONE] and can continue interacting
        if (memoryEnabled && capturedText.length > 50) {
          runBackgroundMemoryExtraction({
            userContent: userContent || "",
            assistantContent: capturedText,
            existingMemories: memories.map((m) => m.content),
            workspaceId: conversation.id_workspace,
            userId,
            conversationId,
            conversationVisibility: conversation.type_visibility,
          }).catch((err) => {
            console.error("[Memory] Background extraction failed:", err);
          });
        }

        // Fire-and-forget: background conversation summary update
        // Gated by memoryEnabled — follows same rules as memory extraction:
        // only for private/shared threads with memory toggle on, never team threads
        if (memoryEnabled) {
          const currentMsgCount = (history?.length || 0) + 2; // +2 for user + assistant just added
          const lastSummaryCount = conversation.units_summary_message_count || 0;

          if (shouldUpdateSummary(currentMsgCount, lastSummaryCount)) {
            runBackgroundSummaryUpdate({
              conversationId,
              currentMessageCount: currentMsgCount,
              lastSummaryMessageCount: lastSummaryCount,
              existingSummary: conversation.document_summary || null,
            }).catch((err) => {
              console.error("[Summary] Background update failed:", err);
            });
          }
        }
      },
    });

    return new Response(stream, {
      headers: {
        "Content-Type": "text/event-stream; charset=utf-8",
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

// ── Background memory extraction + consolidation (V2) ──
// Extracts candidates from the conversation exchange, then runs them through
// the shared consolidation pipeline (findSimilar → classify → apply).
async function runBackgroundMemoryExtraction({
  userContent,
  assistantContent,
  existingMemories,
  workspaceId,
  userId,
  conversationId,
  conversationVisibility,
}: {
  userContent: string;
  assistantContent: string;
  existingMemories: string[];
  workspaceId: string;
  userId: number;
  conversationId: string;
  conversationVisibility: string;
}): Promise<{ id: string; content: string }[]> {
  const suggestions = await extractMemories(userContent, assistantContent, existingMemories);
  if (suggestions.length === 0) return [];

  const scope = conversationVisibility === "private" ? "private" : "team";
  const memUserId = scope === "private" ? userId : null;

  const result = await runConsolidationPipeline(
    suggestions,
    workspaceId,
    memUserId,
    scope,
    conversationId,
    "inferred"
  );

  return result.memories.map((m) => ({ id: m.id, content: m.content }));
}
