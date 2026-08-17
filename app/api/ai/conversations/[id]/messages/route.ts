import { NextRequest } from "next/server";
import { auth } from "@/lib/auth";
import { intelligenceDb } from "@/lib/supabase-intelligence";
import { checkConversationAccess } from "@/lib/ai/access";
import { hasEngineAiAccess } from "@/lib/permissions";
import { supabase } from "@/lib/supabase";
import { createStreamingResponse, type AIMessage, type AIAttachment } from "@/lib/ai/providers";
import { buildSystemPrompt, normalizeContextConfig, isFullDetail, type NormalizedContextConfig, type DetailLevel } from "@/lib/ai/system-prompts";
import { notebookIndex } from "@/lib/notebook/search";
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
import { assertServiceAllowed, ServiceControlError } from "@/lib/admin/service-control";
import { calculateCostTenths } from "@/lib/ai/model-costs";

export const maxDuration = 300; // 5 min — covers slow attachment extractions + long responses

// Per-model cost + calculateCostTenths now live in lib/ai/model-costs.ts
// (shared with lib/ai/usage-logger.ts so the two maps can't drift).

// ── Helper: extract text from a .pptx (PowerPoint) file ──
// .pptx is a zip; slide XML lives at ppt/slides/slide*.xml. Text runs are <a:t> elements.
async function extractPptxText(buffer: Buffer): Promise<string | undefined> {
  const JSZipModule = await import("jszip");
  const JSZip = JSZipModule.default ?? JSZipModule;
  const zip = await JSZip.loadAsync(buffer);

  const slideFiles = Object.keys(zip.files)
    .filter((name) => /^ppt\/slides\/slide\d+\.xml$/.test(name))
    .sort((a, b) => {
      const an = parseInt(a.match(/slide(\d+)\.xml/)?.[1] ?? "0", 10);
      const bn = parseInt(b.match(/slide(\d+)\.xml/)?.[1] ?? "0", 10);
      return an - bn;
    });

  if (slideFiles.length === 0) return undefined;

  const slides: string[] = [];
  for (let i = 0; i < slideFiles.length; i++) {
    const xml = await zip.files[slideFiles[i]].async("string");
    const runs = Array.from(xml.matchAll(/<a:t(?:\s[^>]*)?>([\s\S]*?)<\/a:t>/g), (m) =>
      m[1]
        .replace(/&amp;/g, "&")
        .replace(/&lt;/g, "<")
        .replace(/&gt;/g, ">")
        .replace(/&quot;/g, '"')
        .replace(/&apos;/g, "'"),
    );
    const slideText = runs.join(" ").trim();
    if (slideText) slides.push(`--- Slide ${i + 1} ---\n${slideText}`);
  }

  return slides.join("\n\n") || undefined;
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

    const isPptx =
      att.type === "application/vnd.openxmlformats-officedocument.presentationml.presentation" ||
      att.name.toLowerCase().endsWith(".pptx");
    if (isPptx) {
      return await extractPptxText(buffer);
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

  // Fetch format descriptions + type instructions + company context from ai_settings
  let formatDescriptions: Record<string, string> = {};
  let typeInstructions: Record<string, string> = {};
  let companyContext: string | null = null;
  if (workspaceId) {
    try {
      let res = await intelligenceDb
        .from("ai_settings")
        .select("information_format_descriptions, information_type_instructions, information_company_context")
        .eq("id_workspace", workspaceId)
        .maybeSingle();
      if (res.error) {
        // information_company_context may not exist yet (migration pending) —
        // an unknown column fails the WHOLE select, so retry without it rather
        // than silently losing format descriptions too.
        res = await intelligenceDb
          .from("ai_settings")
          .select("information_format_descriptions, information_type_instructions")
          .eq("id_workspace", workspaceId)
          .maybeSingle();
      }
      const settings: any = res.data;
      formatDescriptions = settings?.information_format_descriptions || {};
      typeInstructions = settings?.information_type_instructions || {};
      companyContext = settings?.information_company_context || null;
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
    companyContext,
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

  // Control Centre kill switch + cap. Source matches what logAiUsage writes.
  try {
    await assertServiceAllowed("engine", "enginegpt");
  } catch (e) {
    if (e instanceof ServiceControlError) {
      return new Response(JSON.stringify({ error: e.message, reason: e.reason }), {
        status: 503,
        headers: { "Content-Type": "application/json" },
      });
    }
    throw e;
  }

  try {
    const body = await req.json();
    const userContent = body.content;
    const userAttachments: Attachment[] | undefined = body.attachments;
    // Studio mode (Design v2): attach generated assets to a specific shot in
    // a design session. Provided per-message by the Design Mode AI rail.
    const designSessionId: string | undefined = body.designSessionId;
    const designFocusedShotId: string | undefined = body.designFocusedShotId;

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

    // Reaching a conversation you are allowed to read is not the same as being
    // allowed to run a turn. flag_access_enginegpt used to be a browser-only
    // gate, so a revoked user with a live cookie could still POST here and get
    // a full turn with Engine, client-context, MeetingBrain and Slack access.
    if (!(await hasEngineAiAccess(userId, conversation.id_workspace))) {
      return new Response(
        JSON.stringify({ error: "You do not have access to EngineAI" }),
        { status: 403, headers: { "Content-Type": "application/json" } }
      );
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
    // Web search responses (with citations, sources, detailed research) need more room.
    // Bump the cap for search queries to avoid mid-sentence cut-offs.
    const baseMaxTokens = wsSettings?.units_max_tokens || 4096;
    const maxTokens = baseMaxTokens; // resolved per-query below after route is known
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
    // MERGES rather than discards. The original kept only the last message in a
    // run of consecutive user messages, which quietly destroyed the commonest
    // way anyone supplies material: paste a document, then ask about it in the
    // next message. The paste was the one dropped. Short orphaned messages —
    // what the guard was actually for, unanswered questions stacking up after a
    // failed response — are still collapsed.
    const ORPHAN_MAX_CHARS = 1200;
    const deduped: typeof effectiveHistory = [];
    for (let i = 0; i < effectiveHistory.length; i++) {
      const cur = effectiveHistory[i];
      const isUser = cur.role_message === "user";
      const nextIsUser = i + 1 < effectiveHistory.length && effectiveHistory[i + 1].role_message === "user";
      if (isUser && nextIsUser) {
        const text = (cur.document_message || "").trim();
        const hasAttachments = Array.isArray((cur as any).attachments) && (cur as any).attachments.length > 0;
        // Substantial content is carried forward into the next user message
        // instead of being deleted; only short, answerable-in-passing ones go.
        if (text.length > ORPHAN_MAX_CHARS || hasAttachments) {
          const next = effectiveHistory[i + 1] as any;
          next.document_message = `${text}\n\n${(next.document_message || "").trim()}`.trim();
        }
        continue;
      }
      deduped.push(cur);
    }
    if (deduped.length < effectiveHistory.length) {
      console.log(`[Messages] Collapsed ${effectiveHistory.length - deduped.length} orphaned user messages`);
    }

    const messages: AIMessage[] = [];

    // ── Reference documents that fell out of the window ──
    //
    // The 20-message cap above is a blunt instrument, and it silently deleted
    // the one kind of content people re-query for a whole session: material
    // they PASTED IN. A handover note, an email thread, an extracted PDF —
    // pasted once near the start, then referenced twenty turns later.
    //
    // The observed failure: a user pasted a colleague's handover, got correct
    // answers about it for several turns, then later asked what was left on it
    // and was told the handover "is not in the Engine task system" while the
    // model went hunting through tools. It had not stopped understanding — the
    // document had left the context, so from where it stood no handover
    // existed. A confident wrong answer, from a silent deletion.
    //
    // The rolling summary does not save this. A summary is a paragraph ABOUT a
    // conversation; it cannot carry a three-thousand-word document with
    // per-person owners and deadlines, which is exactly what gets asked about.
    //
    // So large user messages are re-injected verbatim regardless of age. This
    // runs at READ time, against the full stored history, which means it also
    // repairs conversations that are ALREADY long — the document is still in
    // ai_messages, it was only being dropped on the way to the model.
    const REFERENCE_DOC_MIN_CHARS = 1200;   // well above an ordinary question
    // ~240k chars is roughly 60k tokens: about 6% of a 1M-token window, and
    // comfortably inside the 200k of the smallest model offered. The binding
    // constraint is NOT the window, it is that there is no prompt caching on
    // any chain yet, so every pinned character is billed at full input rate on
    // every turn. At this budget that is a few cents a turn — acceptable for a
    // working session on a document, which is exactly what it is for.
    // If prompt caching lands, this can go up by an order of magnitude.
    const REFERENCE_DOC_BUDGET = 240000;
    const droppedCount = Math.max(0, history.length - effectiveHistory.length);

    if (droppedCount > 0) {
      const dropped = history.slice(0, history.length - effectiveHistory.length);
      // Newest first: when the budget binds, the most recently pasted document
      // is the one most likely to still be under discussion.
      // Superseded drafts are skipped, which matters more than the budget size.
      // Someone working on a report pastes it repeatedly as it evolves — v1,
      // v2, v3 — and each is a separate large message. Pinning all of them
      // spends the budget several times over on the same document, and hands
      // the model three versions of one thing to disagree with itself about.
      // Two pastes are treated as versions of each other when their openings
      // match: cheap, and it does not confuse two genuinely different documents
      // that happen to share a phrase.
      const fingerprint = (t: string) =>
        t.replace(/\s+/g, " ").trim().slice(0, 400).toLowerCase();

      const docs: string[] = [];
      const seen = new Set<string>();
      let used = 0;
      let omitted = 0;
      let superseded = 0;
      for (let i = dropped.length - 1; i >= 0; i--) {
        const m = dropped[i];
        if (m.role_message !== "user") continue;
        const text = (m.document_message || "").trim();
        if (text.length < REFERENCE_DOC_MIN_CHARS) continue;
        // Newest first, so the first version seen is the LATEST — earlier
        // drafts of the same document are the ones dropped.
        const fp = fingerprint(text);
        if (seen.has(fp)) { superseded++; continue; }
        if (used + text.length > REFERENCE_DOC_BUDGET) { omitted++; continue; }
        seen.add(fp);
        docs.unshift(text);
        used += text.length;
      }

      if (docs.length > 0) {
        messages.push({
          role: "system" as const,
          content:
            `[Reference material the user pasted earlier in THIS conversation. It is no longer in the ` +
            `visible message history because the conversation is long, so it is repeated here in full. ` +
            `Treat it as something the user has already given you — when they refer to "the handover", ` +
            `"the document", "that email" or similar, THIS is what they mean. Do not go looking for it ` +
            `in a tool, and do not tell them you do not have it.` +
            (superseded > 0
              ? ` Where a document was pasted more than once as it was revised, only the LATEST version is ` +
                `shown (${superseded} earlier draft(s) omitted) — work from what is here, and do not refer ` +
                `to earlier versions you cannot see.`
              : "") +
            (omitted > 0
              ? ` NOTE: ${omitted} further pasted document(s) could not be included here — say so if the ` +
                `user seems to be asking about something you cannot see.`
              : "") +
            `]\n\n` +
            docs.map((d, i) => `--- Pasted document ${i + 1} of ${docs.length} ---\n${d}`).join("\n\n"),
        });
      }

      // Say that history was cut, whether or not any documents were pinned. A
      // model that knows it is missing turns can ask; one that cannot tell the
      // difference between "not said" and "not shown" answers as if it were
      // never said.
      messages.push({
        role: "system" as const,
        content:
          `[${droppedCount} earlier message(s) in this conversation are not shown, to keep the context ` +
          `manageable. If the user refers to something you cannot find, say you may not have it in view ` +
          `and offer to have them re-share it — do NOT state that it does not exist.]`,
      });
    }

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
        // Scheduled-proposal markers render client-side as confirmation cards.
        // Never feed the raw marker back to the model — it would learn the
        // format and could fabricate cards whose displayed times don't match
        // what a confirm would actually save.
        if (content.includes("[SCHEDULED_PROPOSAL]")) {
          content = content.replace(
            /\[SCHEDULED_PROPOSAL\]([\s\S]*?)\[\/SCHEDULED_PROPOSAL\]/g,
            (_mk: string, json: string) => {
              try { return `[Scheduled prompt proposal card shown: "${JSON.parse(json).title}"]`; }
              catch { return "[Scheduled prompt proposal card shown]"; }
            }
          );
        }

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

    // ── Audience, computed BEFORE anything reads personal data ──
    // This must precede the memory fetch below: the passive system-prompt
    // injection branches on it, and it used to branch on raw type_visibility —
    // so a "private" thread that had been SHARED still loaded the caller's own
    // private memories and rendered them into a prompt every recipient's reply
    // was generated from. Same definition the tool gates use: team-visible,
    // shared with anyone, or not owned by the caller ⇒ more than one reader.
    const { count: shareCount } = await intelligenceDb
      .from("ai_shares")
      .select("id_conversation", { count: "exact", head: true })
      .eq("id_conversation", conversationId);
    const isMultiReaderThread =
      conversation.type_visibility === "team" ||
      (shareCount || 0) > 0 ||
      conversation.user_created !== userId;

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

          // Solo thread: own private memories + team ones. More than one
          // reader: team-scoped only — never inject one person's private
          // memories into a prompt someone else will read the answer to.
          if (!isMultiReaderThread) {
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

    // Fetch workspace client IDs for query_engine tool scoping.
    //
    // The error used to be discarded, and an empty list is not inert: every
    // chain registers query_engine and lookup_client_context behind
    // `if (config.workspaceClientIds?.length)`, so one failed read silently
    // removed the ENTIRE Content Engine connection for that turn and the
    // assistant simply told the user it had no access. Retry once — these
    // failures are transient — and log loudly if it still fails, so the
    // degraded turn is at least visible in the logs rather than looking like
    // a workspace with no clients.
    const clientIdsPromise = (async () => {
      for (let attempt = 1; attempt <= 2; attempt++) {
        const { data, error } = await supabase
          .from("app_clients")
          .select("id_client");
        if (!error) {
          return (data || []).map((c: any) => c.id_client).filter(Boolean) as number[];
        }
        console.error(
          `[chat] app_clients lookup failed (attempt ${attempt}/2): ${error.message}`
        );
      }
      console.error(
        "[chat] app_clients unavailable — query_engine and lookup_client_context will NOT be offered this turn"
      );
      return [] as number[];
    })();

    // Fetch processed client background profile (from asset files)
    // Note: if conversation is content-scoped (id_content but no id_client),
    // the client ID is resolved later via fetchContentDetail — we fetch
    // the background after the parallel block in that case.
    const clientBackgroundPromise = conversation.id_client
      ? (async () => {
          const [{ data: ctx }, { data: meetings }] = await Promise.all([
            intelligenceDb
              .from("ai_client_context")
              .select("document_context, units_asset_count, date_last_processed")
              .eq("id_workspace", conversation.id_workspace)
              .eq("id_client", conversation.id_client)
              .maybeSingle(),
            intelligenceDb
              .from("ai_client_meetings")
              .select("meeting_title, meeting_date, meeting_summary, key_topics, next_steps, attendees_external")
              .eq("id_workspace", conversation.id_workspace)
              .eq("id_client", conversation.id_client)
              .order("meeting_date", { ascending: false })
              .limit(8),
          ]);
          // Build meeting_context from individual rows
          let meeting_context: string | null = null;
          if (meetings && meetings.length > 0) {
            meeting_context = meetings.map((m: any) => {
              let text = `## ${m.meeting_title} (${m.meeting_date?.slice(0, 10)})`;
              if (m.attendees_external) text += `\nClient attendees: ${m.attendees_external}`;
              if (m.meeting_summary) text += `\n${m.meeting_summary}`;
              if (m.key_topics) {
                try { const t = JSON.parse(m.key_topics); if (Array.isArray(t)) text += `\nKey topics: ${t.slice(0, 5).join(", ")}`; } catch { /* skip */ }
              }
              if (m.next_steps) text += `\nActions: ${m.next_steps.slice(0, 300)}`;
              return text;
            }).join("\n\n");
          }
          return ctx ? { ...ctx, meeting_context } : meeting_context ? { document_context: "", units_asset_count: 0, date_last_processed: new Date().toISOString(), meeting_context } : null;
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
    // The notebook index uses the SAME audience the memory query does: in a
    // multi-reader thread only team-shareable entries are counted, so the
    // index never hints at the existence of private clippings.
    const notebookIndexPromise = notebookIndex(
      conversation.id_workspace,
      userId,
      isMultiReaderThread ? "team" : "private"
    ).catch((e: any) => {
      console.warn("[Notebook] index failed:", e?.message);
      return null;
    });

    const [memories, role, userPrefs, ctx, appContextRows, workspaceClientIds, clientBackground, nbIndex] = await Promise.all([
      memoryPromise,
      rolePromise,
      userPrefsPromise,
      contextPromise,
      appContextPromise,
      clientIdsPromise,
      clientBackgroundPromise,
      notebookIndexPromise,
    ]);

    const { clientContext, contentDetail, clientIdeas, workspaceSummary } = ctx;

    // If conversation is content-scoped, fetch client background now that we know the client ID
    let resolvedClientBackground = clientBackground;
    if (!resolvedClientBackground && contentDetail?.clientId) {
      const [{ data: ctxData }, { data: mtgData }] = await Promise.all([
        intelligenceDb
          .from("ai_client_context")
          .select("document_context, units_asset_count, date_last_processed")
          .eq("id_workspace", conversation.id_workspace)
          .eq("id_client", contentDetail.clientId)
          .maybeSingle(),
        intelligenceDb
          .from("ai_client_meetings")
          .select("meeting_title, meeting_date, meeting_summary, key_topics, next_steps, attendees_external")
          .eq("id_workspace", conversation.id_workspace)
          .eq("id_client", contentDetail.clientId)
          .gte("meeting_date", new Date(Date.now() - 90 * 24 * 60 * 60 * 1000).toISOString())
          .order("meeting_date", { ascending: false })
          .limit(5),
      ]);
      let meeting_context: string | null = null;
      if (mtgData && mtgData.length > 0) {
        meeting_context = mtgData.map((m: any) => {
          let text = `## ${m.meeting_title} (${m.meeting_date?.slice(0, 10)})`;
          if (m.attendees_external) text += `\nClient attendees: ${m.attendees_external}`;
          if (m.meeting_summary) text += `\n${m.meeting_summary}`;
          if (m.key_topics) { try { const t = JSON.parse(m.key_topics); if (Array.isArray(t)) text += `\nKey topics: ${t.slice(0, 5).join(", ")}`; } catch { /* skip */ } }
          if (m.next_steps) text += `\nActions: ${m.next_steps.slice(0, 300)}`;
          return text;
        }).join("\n\n");
      }
      resolvedClientBackground = ctxData ? { ...ctxData, meeting_context } : meeting_context ? { document_context: "", units_asset_count: 0, date_last_processed: new Date().toISOString(), meeting_context } : null;
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

    // Privacy: exclude personal/sensitive data from threads with more than one
    // reader. "private" does NOT mean solo — a private thread can be shared
    // with up to 20 recipients via ai_shares, and a collaborator posting in
    // someone else's thread runs tools as THEMSELVES while the answer persists
    // for the owner and every recipient. Treat any thread that is team-visible,
    // shared, or not owned by the caller as a multi-reader audience.
    const isTeamThread = isMultiReaderThread;

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
      ? filteredAppContext.map((r: any) => r.information_content || "").join("\n\n")
      : null;

    if (appContextRows.length > 0) {
      console.log(`[Messages] MeetingBrain context: ${appContextRows.length} rows, ${meetingBrainContext?.length || 0} chars${isTeamThread ? " (excluded — team thread)" : ""}`);
    }

    // Resolve model — "auto" routes to the best model based on the prompt
    let model = body.model || conversation.name_model;
    let wasAutoRouted = false;
    if (model === "auto") {
      const { routeModel } = await import("@/lib/ai/auto-router");
      // Prior user messages, most recent first, so "tighten it up" inherits the
      // routing of the thing it is tightening. The router walks back past
      // refinements to the last substantive message, which one prior message
      // could not do — by the third turn the predecessor is itself a
      // refinement and scores as trivial.
      //
      // No `!== userContent` filter here: it existed to skip the message being
      // sent, but it also skipped genuine verbatim repeats, which is what made
      // saying the same thing twice route BETTER than rephrasing it. The
      // router's own refinement test handles the rest.
      const priorUser = [...messages]
        .reverse()
        .filter((m: any) => m.role === "user" && typeof m.content === "string")
        .map((m: any) => m.content as string)
        .slice(0, 12);
      model = routeModel(userContent || "", priorUser);
      wasAutoRouted = true;
      console.log(`[Messages] Auto-routed → ${model}`);
    }

    // Route query to determine search mode and data source hints
    const { routeQuery } = await import("@/lib/ai/query-router");
    const queryRoute = routeQuery(userContent || "", contextConfig);
    console.log(`[Messages] Query route: intent=${queryRoute.intent}, searchMode=${queryRoute.searchMode}, hints=${queryRoute.hints.length}`);

    // Web search queries: use Claude (tool-based web_search_20250305) instead of Grok
    // when the model was auto-selected. Grok's search_mode blends training data with
    // live results — it silently fills missing facts with plausible-sounding fabrications.
    // Claude's web_search tool is explicit and discrete: it can only cite what it fetched.
    // User-selected Grok models keep their native LiveSearch behaviour unchanged.
    //
    // NOT for composition. The override exists because Grok's LiveSearch blends
    // training data with live results and fabricates — a real hazard when the
    // user asked a QUESTION. When they asked us to WRITE something, the model
    // was chosen for the writing, and having search available should not
    // silently replace it. This is what sent an all-company message to Sonnet 5
    // via a search fallback on a prompt that had nothing to search for.
    if (queryRoute.searchMode === "on" && wasAutoRouted && model.startsWith("grok") && !queryRoute.composition) {
      model = "claude-sonnet-5";
      console.log(`[Messages] Web search: auto-route override → claude-sonnet-5 (grounded tool-based search)`);
    } else if (queryRoute.searchMode === "on" && wasAutoRouted && model.startsWith("grok")) {
      console.log(`[Messages] Composition turn — keeping ${model}, search stays available`);
    }


    // Read BEFORE the system prompt is built, unlike the other access flags
    // below, because this one shapes the prompt as well as the tool list — the
    // rules for reading plan figures have to appear wherever the tool does.
    // Its own pass: an unknown column fails the WHOLE PostgREST select, so
    // folding this into any other flag query would let a missing migration
    // revoke finance, mail, calendar or Microsoft instead of just denying this.
    let resourcingAccess = false;
    try {
      const { data: ra } = await intelligenceDb
        .from("users_access")
        .select("flag_access_resourcing")
        .eq("id_workspace", conversation.id_workspace)
        .eq("user_target", userId)
        .maybeSingle();
      resourcingAccess = (ra as any)?.flag_access_resourcing === 1;
    } catch { /* pre-migration or no row = denied */ }

    // Recent-session ledger. Solo threads only — an episode is one person's
    // working history, and a thread with more than one reader is not the place
    // for it. Fails to an empty string, so chat never depends on it.
    let episodeLedger = "";
    if (!isTeamThread && !isIncognito && contextConfig.memory !== "off") {
      try {
        const { recentEpisodes, formatEpisodeLedger } = await import("@/lib/ai/episodes");
        episodeLedger = formatEpisodeLedger(
          await recentEpisodes(userId, conversation.id_workspace, conversationId)
        );
      } catch { /* no ledger is not an error */ }
    }

    let systemPrompt = buildSystemPrompt({
      notebookIndex: nbIndex,
      episodeLedger,
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
      resourcingAccess,
      personalContext: isTeamThread ? null : (userPrefs?.information_personal_context || null),
      meetingBrainContext,
      region: userPrefs?.name_region || null,
      clientBackground: resolvedClientBackground || null,
      userName: session.user?.name || null,
      userEmail: session.user?.email || null,
      userEngineId: userId,
      designMode: conversation.type_conversation_mode === "design",
      studioMode: conversation.type_conversation_mode === "design" && !!designSessionId,
      conversationVisibility: isTeamThread ? "team" : "private",
    });

    // Append query router hints to system prompt as required tool calls
    if (queryRoute.hints.length > 0) {
      systemPrompt += "\n\n## Required tool calls for this turn\nBased on the question, you MUST call these tools before answering. Do not answer from cached inline context or training data alone.\n- " + queryRoute.hints.join("\n- ");
    }

    // For xAI/Grok: web search is built-in via LiveSearch — NOT a callable tool.
    if (queryRoute.searchMode === "on" && model.startsWith("grok")) {
      systemPrompt += "\n\n**LIVESEARCH ACTIVE:** xAI LiveSearch is running for this query. You are fetching LIVE results from the web RIGHT NOW. Rules:\n- Only report facts that appear in your actual search results. Do NOT use training data or prior conversation responses to fill gaps.\n- If your live search does not confirm a specific fact (price, stock level, availability, phone number), say \"I couldn't confirm this in my search\" — do not guess.\n- Your previous responses in this conversation may have been wrong. Do not simply repeat or confirm what you said before — re-verify everything with your current search results.\n- Cite the actual URLs your search returned. Do not invent citation numbers.";
    }

    // Safety guard: whenever web search is NOT active this turn. This is
    // INTERNAL grounding guidance — it must NOT make the model open its reply by
    // announcing "web search isn't available", which reads as a broken feature.
    // It still prevents the model from promising a search it can't run (the
    // tail-chasing spiral) and from asserting unverifiable real-time facts.
    if (queryRoute.searchMode === "off") {
      systemPrompt += "\n\n**No live web this turn — INTERNAL guidance, do NOT announce this to the user:** You don't have live web results for this message. Never open or caveat your reply by saying web search is unavailable/off — just answer the request normally using the workspace data, client files, brief, and your knowledge. Do NOT claim you are searching, browsing, or looking something up online (you're not), and do NOT assert real-time facts (prices, availability, current events, breaking news) you can't verify — instead, flag any such claim as 'to verify'. Only if the user EXPLICITLY asked you to search the web should you briefly note they can turn on the Web toggle and ask again.";
    }

    // Per-user access flags (Settings → Users). finance gates query_xero;
    // gmail gates query_gmail. Both read `=== 1` explicitly: elsewhere in this
    // codebase an ABSENT users_access row has been treated as "allowed", which
    // for a mailbox would mean everyone.
    let financeAccess = false;
    let gmailAccess = false;
    // Calendar and Microsoft 365, read in their own tolerant pass below. Kept
    // OUT of the select above on purpose: an unknown column fails the WHOLE
    // PostgREST select, and folding two new columns into the query that also
    // resolves finance and mail would mean a missing migration silently
    // revoking access to both of those instead of just failing the new ones.
    let calendarAccess = false;
    let microsoftAccess = false;
    try {
      const { data: fa } = await intelligenceDb
        .from("users_access")
        .select("flag_access_finance, flag_access_gmail")
        .eq("id_workspace", conversation.id_workspace)
        .eq("user_target", userId)
        .maybeSingle();
      financeAccess = fa?.flag_access_finance === 1;
      gmailAccess = (fa as any)?.flag_access_gmail === 1;
    } catch { /* no row / pre-migration = no access (secure by default) */ }
    if (!gmailAccess) {
      // Deploy-safe: the column may not exist yet, which fails the WHOLE
      // select above and would silently drop finance access too.
      try {
        const { data: ga } = await intelligenceDb
          .from("users_access")
          .select("flag_access_gmail")
          .eq("id_workspace", conversation.id_workspace)
          .eq("user_target", userId)
          .maybeSingle();
        gmailAccess = (ga as any)?.flag_access_gmail === 1;
        if (!financeAccess) {
          const { data: fb } = await intelligenceDb
            .from("users_access")
            .select("flag_access_finance")
            .eq("id_workspace", conversation.id_workspace)
            .eq("user_target", userId)
            .maybeSingle();
          financeAccess = fb?.flag_access_finance === 1;
        }
      } catch { /* still no access */ }
    }
    // Calendar + Microsoft, in their own pass so a missing migration can only
    // ever deny these two. Explicit `=== 1`, and any error leaves both false.
    try {
      const { data: cm } = await intelligenceDb
        .from("users_access")
        .select("flag_access_calendar, flag_access_microsoft")
        .eq("id_workspace", conversation.id_workspace)
        .eq("user_target", userId)
        .maybeSingle();
      calendarAccess = (cm as any)?.flag_access_calendar === 1;
      microsoftAccess = (cm as any)?.flag_access_microsoft === 1;
    } catch { /* pre-migration or no row = denied */ }

    // Mailbox questions must land on Claude, because query_gmail only ever
    // registers there (mail content is contractually restricted to one
    // processor). Without this the default "auto" model resolves to Grok, the
    // tool is never offered, and the user gets a confident answer built from
    // nothing instead of their inbox. Only rewrites an AUTO-routed model — a
    // deliberately chosen model is left alone, and the tool simply stays
    // unavailable there.
    // Deliberately narrow: it must name the user's OWN mail. The first cut
    // matched bare "inbox"/"email"/"unread", which are everyday words in this
    // app (the social Inbox, "email the client", campaign emails) and would
    // have silently switched the model mid-conversation for ordinary work.
    // "the inbox" is left out for the same reason — only "my inbox" counts.
    //
    // The clauses below were verified against 22 real phrasings and 12
    // marketing-email decoys. Three earlier misses are why this widened:
    // every "e-?mail" was singular, so "check my emails" fell through;
    // "e-?mailed?" requires the second e, so it matched "emailed" but not
    // "did X email me"; and "gmail" — the actual product name — appeared
    // nowhere, so "check my gmail" routed to Grok and got denied.
    const MAIL_INTENT = new RegExp(
      [
        "\\bg-?mail\\b",
        "\\bmy (inbox|mailbox|e-?mails?|mails)\\b",
        "\\bin my (inbox|mailbox|mail|e-?mails?)\\b",
        "\\b(check|search|read|look in|find in|go through) (my )?(mail|e-?mails?|inbox|mailbox)\\b",
        "\\b(e-?mailed|mailed) (me|us)\\b",
        "\\b(did|does|has|have|hasn.t|didn.t|will) \\w+ (e-?mail(ed)?|replied|reply|written|got back|come back)",
        "\\b(e-?mails?|mail) from\\b",
        "\\bany (unread|new) (mail|e-?mails?)\\b",
        "\\bunread (mail|e-?mails?)\\b",
        "\\b(e-?mails?|mail) (i|we) (got|received|have|missed)\\b",
        "\\breceived (an?|any) (e-?mails?|mail)\\b",
        "\\bthe (e-?mail|thread) (from|about)\\b",
      ].join("|"),
      "i"
    );
    // Calendar and Microsoft register on the Claude chains only, for the same
    // reason mail does, so they need the same auto-route override or the tool
    // is simply never offered and the model answers from nothing.
    // Narrow, like MAIL_INTENT: "the meeting" and "my diary" are everyday words
    // here, and "calendar" alone appears in content-planning chat constantly.
    const PERSONAL_SCHEDULE_INTENT = new RegExp(
      [
        "\\bmy (calendar|diary|schedule|agenda)\\b",
        "\\b(in|on) my (calendar|diary|schedule)\\b",
        "\\bwhat.s (on|in) (my )?(calendar|diary|schedule|agenda)\\b",
        "\\b(am i|are we) (free|busy|meeting)\\b",
        "\\bwhen (am i|do i) (next )?(meet|meeting|see)\\b",
        "\\bnext meeting\\b",
        "\\boutlook\\b",
        "\\bteams (chat|message|messages)\\b",
        "\\bmicrosoft 365\\b",
        "\\bm365\\b",
      ].join("|"),
      "i"
    );
    if (
      (gmailAccess || calendarAccess || microsoftAccess) &&
      !isTeamThread &&
      wasAutoRouted &&
      !model.startsWith("claude") &&
      (MAIL_INTENT.test(userContent || "") ||
        ((calendarAccess || microsoftAccess) && PERSONAL_SCHEDULE_INTENT.test(userContent || "")))
    ) {
      model = "claude-sonnet-5";
      console.log(`[Messages] Personal-data intent: auto-route override → claude-sonnet-5 (these tools are Claude-only)`);
    }

    // Say the true thing about the mailbox.
    //
    // The override above only fires on an AUTO-routed turn whose wording trips
    // MAIL_INTENT. A user who picked Grok themselves, or who asks obliquely
    // ("can you see what Ceri sent over?"), still lands on a chain where
    // query_gmail was never registered — and the model then says it has no way
    // to read email at all, which is false and which the user believes. It is
    // a model restriction, not a missing feature, so the prompt has to carry
    // that distinction; the model cannot infer it from an absent tool.
    if ((gmailAccess || calendarAccess || microsoftAccess) && !isTeamThread && !model.startsWith("claude")) {
      const have = [
        gmailAccess ? "their work mailbox" : null,
        calendarAccess ? "their calendar" : null,
        microsoftAccess ? "their Microsoft 365 (Outlook and Teams)" : null,
      ].filter(Boolean).join(", ");
      systemPrompt +=
        `\n\n**Personal data — INTERNAL, do not raise unprompted:** this user HAS ${have} connected to EngineAI, but the tools that read those run only on the Claude models, and this turn is not on one. So if they ask, do NOT tell them you have no access, that you cannot read it, or that Slack is the only thing you can see — all of those are wrong and they will act on it. Say it is available on the Claude models, and that switching the model (or using EngineAI Auto, which routes these questions to Claude) and asking again will read it. Never answer a question about the CONTENTS of any of it from memory or inference.`;
    }

    // Scheduled task thread: load the standing task so the model can propose
    // updates to it (reply-to-refine) instead of claiming changes are applied.
    let scheduledTask:
      | { id: string; title: string; prompt: string; typeTask: string; typeSchedule: string; configSchedule: any; scheduleLabel: string }
      | undefined;
    if (conversation.type_conversation_mode === "scheduled") {
      const { data: st } = await intelligenceDb
        .from("ai_scheduled_prompts")
        .select("id_prompt, user_created, name_title, document_prompt, type_task, type_schedule, config_schedule")
        .eq("id_conversation", conversationId)
        .maybeSingle();
      if (st && st.user_created === userId) {
        // Only the task OWNER gets the update tool — anyone else would be
        // steered into a Confirm card whose PATCH can only 404.
        const { describeSchedule } = await import("@/lib/scheduled/schedule");
        scheduledTask = {
          id: st.id_prompt,
          title: st.name_title,
          prompt: st.document_prompt,
          typeTask: st.type_task,
          typeSchedule: st.type_schedule,
          configSchedule: st.config_schedule,
          scheduleLabel: describeSchedule(st.type_schedule, st.config_schedule),
        };
        systemPrompt += `\n\n## Scheduled task thread\nThis thread belongs to the recurring scheduled prompt "${st.name_title}" (${st.type_task}, ${scheduledTask.scheduleLabel}). Its standing prompt is:\n"""${st.document_prompt}"""\nAnswering questions about past results is normal chat. But when the user asks to change what FUTURE runs cover, their timing, or email delivery ("also include…", "drop the…", "move it to 9am", "stop emailing me"), you MUST call update_scheduled_task to propose the change — never claim a change is applied without it, and never just answer as if the standing prompt were already different.`;
      } else if (st) {
        systemPrompt += `\n\n## Scheduled task thread (owned by someone else)\nThis thread belongs to the recurring scheduled prompt "${st.name_title}", owned by another user. If the current user asks to change what future runs cover or when they arrive, explain that only the task's owner can modify it — you cannot propose changes here.`;
      }
    }

    // Boost token limit for web search queries — citations + research responses
    // run long. A DRAFT does not: the ceiling was doubling for "write a message
    // to the team" purely because the catch-all had switched search on, and a
    // reply with room to ramble takes it. Composition keeps the base ceiling
    // even when search is available, alongside the length rule in the prompt.
    const effectiveMaxTokens = queryRoute.searchMode === "on" && !queryRoute.composition
      ? Math.max(baseMaxTokens, 8192)
      : baseMaxTokens;

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

    // Insert a pending assistant row BEFORE starting the stream so that clients
    // returning to this conversation mid-generation can see "a response is in
    // flight" and poll for completion. onComplete UPDATEs this row; a failure
    // path below marks it failed so the UI can surface retry instead of hanging.
    let pendingMessageId: string | null = null;
    let pendingComplete = false;
    if (!conversation.flag_incognito) {
      const { data: pending, error: pendErr } = await intelligenceDb
        .from("ai_messages")
        .insert({
          id_conversation: conversationId,
          role_message: "assistant",
          document_message: "",
          name_model: model,
          status_message: "pending",
        })
        .select("id_message")
        .single();
      if (pendErr) {
        console.error("[Messages] Failed to insert pending assistant row:", pendErr);
      } else {
        pendingMessageId = pending?.id_message || null;
      }
    }

    // Create streaming response.
    // The onComplete callback saves the assistant reply. It runs when the
    // upstream AI stream finishes — which happens regardless of whether the
    // CLIENT is still connected, as long as we swallow enqueue errors in the
    // wrapper below (see `clientDisconnected` try/catch). This guards against
    // the "user navigated away mid-stream and lost their response" bug.
    // Named so the completion callback can read flags the tool executors set
    // on it during the turn (notably sawUntrustedContent after query_gmail).
    const aiConfigRef: any = { model, systemPrompt, maxTokens: effectiveMaxTokens, webSearch: queryRoute.searchMode === "on", imageGeneration: contextConfig.imageGeneration === "on", workspaceClientIds, workspaceId: conversation.id_workspace, userId, userEmail: session.user?.email || undefined, conversationVisibility: isTeamThread ? "team" : "private", selectedClientId: conversation.id_client || undefined, designMode: conversation.type_conversation_mode === "design", conversationId, contentId: conversation.id_content || undefined, incognito: conversation.flag_incognito === 1, designSessionId, designFocusedShotId, enableScheduling: conversation.type_conversation_mode !== "design", scheduledTask, financeAccess, gmailAccess, calendarAccess, microsoftAccess, resourcingAccess, // ALLOWLIST: only this interactive chat route may reach a mailbox.
        allowPersonalData: true };

    const aiStream = createStreamingResponse(
      messages,
      // userEmail is passed for team threads too: the MeetingBrain/Slack tools
      // gate personal reports server-side via conversationVisibility, while the
      // workspace-shared client_meetings report stays available to everyone.
      aiConfigRef,
      async ({ fullText, inputTokens, outputTokens, cacheReadTokens, cacheWriteTokens }) => {
        // Skip all persistence in incognito mode
        if (!conversation.flag_incognito) {
          let assistantErr: any = null;
          if (pendingMessageId) {
            const { error } = await intelligenceDb
              .from("ai_messages")
              .update({
                document_message: fullText,
                name_model: model,
                status_message: "complete",
              })
              .eq("id_message", pendingMessageId);
            assistantErr = error;
          } else {
            // Fallback path if pending-row insert failed earlier. Omits
            // status_message so the DB DEFAULT ('complete') applies — keeps
            // the endpoint working if the migration hasn't been applied yet.
            const { error } = await intelligenceDb
              .from("ai_messages")
              .insert({
                id_conversation: conversationId,
                role_message: "assistant",
                document_message: fullText,
                name_model: model,
              });
            assistantErr = error;
          }
          pendingComplete = true;
          if (assistantErr) console.error("[Messages] Failed to save assistant message:", assistantErr);

          const { error: updateErr } = await intelligenceDb
            .from("ai_conversations")
            .update({ date_updated: new Date().toISOString() })
            .eq("id_conversation", conversationId);
          if (updateErr) console.error("[Messages] Failed to update conversation:", updateErr);

          // Log AI usage for cost tracking
          // inputTokens is already NET of cache — normalised per provider in
          // providers.ts, since the two families report it differently.
          const costTenths = calculateCostTenths(
            model,
            inputTokens,
            outputTokens,
            cacheReadTokens || 0,
            cacheWriteTokens || 0
          );
          if ((cacheReadTokens || 0) > 0 || (cacheWriteTokens || 0) > 0) {
            console.log(
              `[Messages] Cache: read=${cacheReadTokens || 0} write=${cacheWriteTokens || 0} ` +
              `uncached_in=${inputTokens} model=${model}`
            );
          }
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

        // First SSE event: expose the pending assistant-message id so clients
        // can correlate streamed tokens with the DB row and resume via polling
        // if they disconnect and return mid-stream.
        if (pendingMessageId) {
          try {
            controller.enqueue(
              encoder.encode(`data: ${JSON.stringify({ assistantMessageId: pendingMessageId })}\n\n`)
            );
          } catch {}
        }

        // Send debug context if enabled
        if (debugMode) {
          controller.enqueue(
            encoder.encode(`data: ${JSON.stringify({ debugContext: systemPrompt })}\n\n`)
          );
        }

        // Pass through AI stream, intercepting [DONE] for memory extraction.
        // Critical: if the CLIENT disconnects mid-stream (user navigates away,
        // tab closed, network blip), `controller.enqueue()` will throw. We
        // swallow that so we keep draining the upstream AI stream — which
        // lets its `onComplete` callback fire and persist the assistant
        // message to the DB. Without this, long responses + large attachments
        // could lose the reply on any client navigation.
        const reader = aiStream.getReader();
        let capturedText = "";
        let clientDisconnected = false;
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

            // Forward to client — enqueue can throw if the client closed.
            // If it does, keep looping so the upstream AI stream completes
            // and its onComplete callback saves the assistant message.
            if (!clientDisconnected) {
              try {
                controller.enqueue(value);
              } catch {
                clientDisconnected = true;
                console.warn(
                  `[Messages] Client disconnected mid-stream for convo ${conversationId} — continuing upstream drain so response still saves`
                );
              }
            }
          }
        } finally {
          try { controller.close(); } catch {}
        }

        // Safety net: if onComplete never fired (upstream errored early, stream
        // closed before any tokens, etc.) the pending assistant row would dangle
        // forever as 'pending' and the client would spin indefinitely. Mark it
        // failed so the UI shows retry.
        if (pendingMessageId && !pendingComplete) {
          try {
            await intelligenceDb
              .from("ai_messages")
              .update({
                document_message: "Generation failed — please retry.",
                status_message: "failed",
              })
              .eq("id_message", pendingMessageId)
              .eq("status_message", "pending");
          } catch (err) {
            console.error("[Messages] Failed to mark pending row as failed:", err);
          }
        }

        // TAINTED TURN: if this reply was produced with third-party email
        // content in context, neither the memory extractor nor the summary
        // generator may run over it. Both are hard-wired to a different
        // vendor, both persist where others can read, and the extractor has
        // an explicit "standing instruction" category with no approval step —
        // so an injected line in a message body would become permanent
        // guidance applied to every future conversation.
        // HARD taint (mail): skip extraction AND summary.
        // SOFT taint (Drive/Slack/MeetingBrain): skip only extraction. Those
        // are routine mid-flow lookups, so blocking summaries too would mean
        // heavy MeetingBrain users never got a thread summary again — but
        // extraction is the channel that turns injected text into a STANDING
        // INSTRUCTION applied to every future conversation, and that is worth
        // closing for any third-party content.
        const turnTainted = aiConfigRef.sawUntrustedContent === true;
        const turnHadThirdParty = turnTainted || aiConfigRef.sawThirdPartyContent === true;
        if (turnHadThirdParty) {
          console.log(
            `[Messages] Third-party content in turn (${turnTainted ? "mail: hard" : "soft"}) — skipping memory extraction${turnTainted ? " and summary" : ""}`
          );
        }

        // Fire-and-forget: background memory extraction after stream closes
        // Client already received [DONE] and can continue interacting
        if (!turnHadThirdParty && memoryEnabled && capturedText.length > 50) {
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

        // Fire-and-forget: episodic capture — what was WORKED ON, for recall in
        // later sessions. Behind the SAME gates as memory extraction, and one
        // more: solo threads only. An episode is one person's working history,
        // and a thread with more than one reader is not the place for it.
        if (!turnHadThirdParty && memoryEnabled && !isMultiReaderThread && capturedText.length > 50) {
          (async () => {
            const { extractEpisode, recordEpisode } = await import("@/lib/ai/episodes");
            const capture = await extractEpisode(userContent || "", capturedText);
            // null is the common case and is meant to be — most turns are not
            // worth recalling in a week.
            if (!capture) return;
            await recordEpisode({
              workspaceId: conversation.id_workspace,
              userId,
              conversationId,
              capture,
            });
          })().catch((err) => console.error("[Episodes] capture failed:", err));
        }

        // Fire-and-forget: background conversation summary update
        // Gated by memoryEnabled — follows same rules as memory extraction:
        // only for private/shared threads with memory toggle on, never team threads
        if (memoryEnabled) {
          const currentMsgCount = (history?.length || 0) + 2; // +2 for user + assistant just added
          const lastSummaryCount = conversation.units_summary_message_count || 0;

          if (!turnTainted && shouldUpdateSummary(currentMsgCount, lastSummaryCount)) {
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

  // ALWAYS private. POST /api/ai/memories treats promoting a team memory as a
  // privileged workspace-wide act (it is injected into every member's system
  // prompt on every turn) and requires admin. Background extraction performed
  // that same act with no check at all, so any member chatting in a team
  // thread could plant standing guidance on all their colleagues — no crafted
  // request needed. Extraction now only ever produces a memory for the person
  // whose exchange it came from; team memories are created deliberately,
  // through the gated route.
  const scope = "private";
  const memUserId = userId;

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
