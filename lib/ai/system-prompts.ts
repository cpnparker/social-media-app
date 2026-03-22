import { categorizeContentType } from "@/lib/content-type-utils";

// ── Detail level types ──

export type DetailLevel = "off" | "summary" | "full-week" | "full-month" | "full-year";

export interface NormalizedContextConfig {
  contracts: DetailLevel;
  contentPipeline: DetailLevel;
  socialPresence: DetailLevel;
  ideas: DetailLevel;
  webSearch: "on" | "off";
  imageGeneration: "on" | "off";
  incognito: "on" | "off";
  memory: "on" | "off";
  meetingBrain: "on" | "off";
}

/** Check if a detail level is any "full" variant */
export function isFullDetail(level: DetailLevel | string): boolean {
  return level === "full-week" || level === "full-month" || level === "full-year";
}

/** Get a human-readable window label for full detail levels */
export function getWindowLabel(level: DetailLevel | string): string {
  if (level === "full-week") return "last 7 days";
  if (level === "full-month") return "last 30 days";
  if (level === "full-year") return "last 12 months";
  return "";
}

/** Normalize a legacy boolean or string value to a DetailLevel */
export function normalizeDetailLevel(value: any): DetailLevel {
  if (value === true) return "summary";
  if (value === false || value === "off") return "off";
  if (value === "full") return "full-month"; // migrate old "full" to "full-month"
  if (value === "full-week") return "full-week";
  if (value === "full-month") return "full-month";
  if (value === "full-year") return "full-year";
  if (value === "summary") return "summary";
  return "summary";
}

/** Normalize a full context config (handles both legacy boolean and new string formats) */
export function normalizeContextConfig(config: any): NormalizedContextConfig {
  if (!config) return { contracts: "summary", contentPipeline: "off", socialPresence: "summary", ideas: "off", webSearch: "on", imageGeneration: "on", incognito: "off", memory: "on", meetingBrain: "on" };
  return {
    contracts: normalizeDetailLevel(config.contracts),
    contentPipeline: normalizeDetailLevel(config.contentPipeline),
    socialPresence: normalizeDetailLevel(config.socialPresence),
    ideas: normalizeDetailLevel(config.ideas),
    webSearch: config.webSearch === "off" ? "off" : "on",
    imageGeneration: config.imageGeneration === "off" ? "off" : "on",
    incognito: config.incognito === "on" ? "on" : "off",
    memory: config.memory === "off" ? "off" : "on",
    meetingBrain: config.meetingBrain === "off" ? "off" : "on",
  };
}

// ── Types for the context system ──

interface WorkspaceConfig {
  contentTypes: { key: string; name: string; aiPrompt: string | null }[];
  cuDefinitions: { format: string; category: string; units: number }[];
  formatDescriptions: Record<string, string>;
  typeInstructions: Record<string, string>;
}

interface ClientContext {
  id?: number;
  name: string;
  industry: string | null;
  description: string | null;
  contracts: {
    id?: number;
    name: string;
    totalUnits: number;
    completedUnits: number;
    active: boolean;
    startDate: string;
    endDate: string;
    notes?: string;
    commissionedContent?: {
      id?: number | null;
      title: string;
      type: string;
      format?: string | null;
      cu: number;
      status: string;
      dateCompleted?: string | null;
      currentTask?: string | null;
      taskAssignee?: string | null;
    }[];
  }[];
  contentSummary: {
    total: number;
    commissioned: number;
    completed: number;
    spiked: number;
    totalCU: number;
    byType: Record<string, { total: number; commissioned: number; completed: number; spiked: number }>;
    recentCommissioned: string[];
    recentCompleted: string[];
    recentSpiked: string[];
  };
  contentItems?: {
    title: string;
    type: string;
    cu: number;
    status: string;
    brief?: string;
    audience?: string;
    topics?: string[];
    campaigns?: string[];
    platform?: string;
  }[];
  socialPlatforms: Record<string, number>;
}

interface ContentDetail {
  title: string;
  type: string;
  body: string | null;
  brief: string | null;
  guidelines: string | null;
  audience: string | null;
  targetLength: string | null;
  platform: string | null;
  notes: string | null;
  clientId: number | null;
  clientName: string | null;
  contractId: number | null;
  topicTags: string[] | null;
  campaignTags: string[] | null;
}

interface IdeaItem {
  title: string;
  brief: string | null;
  status: string;
  topicTags?: string[] | null;
  clientName?: string | null;
  createdAt: string;
  commissionedAt: string | null;
}

interface WorkspaceSummary {
  clientCount: number;
  contracts: {
    active: number;
    totalCU: number;
    completedCU: number;
    remainingCU: number;
  };
  content: {
    total: number;
    published: number;
    inProduction: number;
    totalCU: number;
  };
  ideas: {
    total: number;
    byStatus: Record<string, number>;
    thisWeek: number;
    recent: IdeaItem[];
  };
}

export function buildSystemPrompt(ctx: {
  workspaceConfig: WorkspaceConfig;
  clientContext: ClientContext | null;
  contentDetail: ContentDetail | null;
  contextConfig?: NormalizedContextConfig;
  cuDescription?: string | null;
  clientIdeas?: IdeaItem[] | null;
  workspaceSummary?: WorkspaceSummary | null;
  memories?: { content: string; category: string; strength?: number }[];
  role?: { name: string; instructions: string } | null;
  selectedRoles?: { name: string; instructions: string }[];
  latestUserMessage?: string;
  personalContext?: string | null;
  meetingBrainContext?: string | null;
  region?: string | null;
  clientBackground?: { document_context: string; meeting_context?: string | null; units_asset_count: number; date_last_processed: string } | null;
}): string {
  const { workspaceConfig, clientContext, contentDetail } = ctx;

  const FORMATTING_GUIDELINES = `
Guidelines:
- Be direct, actionable, and creative — avoid generic advice
- Use the context below to give specific, informed answers
- When drafting, produce high-quality, well-structured work — but never sacrifice accuracy for polish. Including [verify] markers and honest gaps IS part of quality work.

Factual accuracy — THIS IS YOUR HIGHEST PRIORITY:
- NEVER fabricate facts, statistics, quotes, case studies, research findings, regulatory details, or claims. If you don't have the information, say so clearly.
- NEVER invent or fabricate source URLs, reference links, or citations. Only cite URLs that were returned by web search results. If you have no search results to cite, do not provide any URLs — just state what you know and flag what needs verification.
- Clearly distinguish between: (a) facts from the workspace context provided below, (b) your general knowledge, and (c) your suggestions or ideas. Label suggestions as suggestions.
- When writing content about a client or topic, use the workspace context for TCE-specific facts (contracts, CU budgets, content pipeline). For industry facts, market data, regulatory requirements, or claims about the client's business — use web search or explicitly flag that you're suggesting placeholder text the user should verify.
- Use phrases like "[verify this figure]", "[placeholder — check with client]", or "[suggested claim — needs source]" when you are uncertain about a specific fact rather than inventing one.
- If web search is available, use it when the user is asking about current events, recent data, or time-sensitive facts. Do not use web search for general knowledge or well-established facts. When unsure about a specific claim, flag it with a verification note rather than searching.
- It is far better to deliver an outline with honest gaps than a polished draft full of fabrications. Users lose trust when they find fabricated claims — honesty about gaps is always preferred.
- When the user asks you to fact-check or verify a specific claim, answer THAT question directly. Do not generate a full article, outline, or new content unless asked.
- If you previously stated something that the user questions, do not double down — re-examine and correct if needed. Admit when you are wrong or uncertain.

Response format:
- Write in a mix of short paragraphs and bullet lists — avoid wall-of-text or bullet-only replies
- Lead with a brief paragraph that frames the answer, then use lists or tables where they add clarity
- Use markdown: headings for structure, **bold** for key terms, tables for comparisons or data
- Keep paragraphs to 2-3 sentences; use them to explain reasoning, nuance, or narrative
- Use bullet lists for actionable steps, options, or quick-reference items
- Vary your structure to match the content — don't default to the same layout every time`;

  let prompt: string;
  if (ctx.role) {
    prompt = `You are EngineAI, acting as ${ctx.role.name}, built into The Content Engine. ${ctx.role.instructions}
${FORMATTING_GUIDELINES}`;
  } else {
    prompt = `You are EngineAI, an expert content strategist and writer built into The Content Engine. You help users brainstorm, draft, refine, and strategise content.
${FORMATTING_GUIDELINES}`;
  }

  // ── Current date ──
  const now = new Date();
  const dateStr = now.toLocaleDateString("en-GB", { weekday: "long", day: "numeric", month: "long", year: "numeric" });
  prompt += `\n\nToday's date is ${dateStr}. Always use this as your reference for "today", "this week", "recent", etc. Your training data may be outdated — if the user asks about current events, recent news, industry trends, company information, market data, statistics, or anything that may have changed since your training cutoff, you MUST use web search to get up-to-date information before responding. Never present outdated training data as current fact. When writing content that includes factual claims about a client's industry, competitors, or market — search first, don't guess.`;

  // ── Web search disabled warning ──
  if (ctx.contextConfig?.webSearch === "off") {
    prompt += `\n\nWEB SEARCH IS CURRENTLY DISABLED. Since you cannot verify external claims, you MUST:
- Flag ALL factual claims about companies, industries, regulations, trends, statistics, or current events with [unverified — web search disabled].
- Do not present any external facts as confirmed. State them as "based on general knowledge" or "this may be outdated."
- Be extra conservative — when in doubt, say you cannot verify without web search.`;
  }

  // ── Conversation continuity ──
  prompt += `\n\n## Conversation Continuity
- You are in a multi-turn conversation. Always maintain awareness of what you have already produced — text, images, drafts, and ideas.
- When the user asks to refine, redo, or improve something, reference your previous output and explain what you're changing rather than starting from scratch.
- If you generated images earlier in the conversation, they appear as ![Generated image](url) in the message history. Reference them specifically when the user asks about "the first one", "the top one", "the one you did", etc.
- Treat follow-up requests as iterative refinements. Carry forward the context, style decisions, and constraints from earlier in the conversation.
- Never re-ask for information the user has already provided in this conversation.`;

  // ── Image generation capability ──
  if (ctx.contextConfig?.imageGeneration === "on") {
    prompt += `\n\n## Image Generation
You have a generate_image tool. When the user asks you to create, generate, design, make, or produce an image, graphic, visual, infographic, or carousel — USE the generate_image tool immediately. Do not describe what you would create instead of generating it. Act on the request.

Rules:
- Call the tool whenever the user requests visual content. This includes requests like "generate an image of…", "make me a graphic", "create an infographic", "can you generate an image of these", etc.
- You can call the tool multiple times for multi-panel content (e.g. carousels).
- Do NOT generate images unsolicited — only when the user asks for visual content.
- NEVER fabricate image URLs or write image markdown yourself. Only reference URLs returned by the generate_image tool. The tool automatically embeds the image in the conversation — do NOT write additional ![alt](url) markdown for the same image or any other image.
- After generating, briefly describe the result in text. Do NOT repeat the image as another markdown image link.`;
  }

  // ── Document generation capability ──
  if (ctx.contextConfig?.imageGeneration === "on") {
    prompt += `\n\n## Document Generation
You have a generate_document tool that creates PowerPoint presentations (.pptx files). When a user asks for a presentation, deck, slides, pitch deck, or PPTX:
- Use the generate_document tool immediately with structured slide data
- Create appropriately sized presentations: 5-8 slides for a brief overview, 10-15 for a full presentation, 15-25 for a detailed deck
- Use appropriate layouts: "title" for the opening slide, "content" for standard body slides, "two-column" for comparisons or pros/cons, "section" for section dividers
- Keep bullet points to 4-6 per slide maximum — concise and impactful
- Include speaker notes when the user asks for a detailed or professional presentation
- Choose a theme that matches the context: "professional" for corporate/business, "modern" for tech/creative, "bold" for high-impact pitches, "minimal" for clean/simple
- NEVER describe what slides would look like — actually generate them with the tool
- After generating, briefly summarise the content. Do NOT write another download link — the tool already provides one.`;
  }

  // ── Chart generation capability ──
  if (ctx.contextConfig?.imageGeneration === "on") {
    prompt += `\n\n## Chart Generation
You have a generate_chart tool that creates data-accurate charts and graphs.

CRITICAL: When the user asks for a chart, graph, or visualization — you MUST call generate_chart. Do NOT show a table instead. Do NOT say "daily breakdown unavailable". Do NOT suggest the user check elsewhere.

Workflow:
1. Query data with query_engine (use report mode with group_by="day" for daily charts, group_by="client" for client charts)
2. Call generate_chart with the EXACT numbers from the query results
3. Add a brief text summary after the chart

Supported types: bar, horizontalBar, line, pie, doughnut
Example for daily CUs: query_engine({ report: "commissioned_units", date_from: "2026-03-01", group_by: "day" }) → then generate_chart({ type: "bar", labels: ["Mar 1", "Mar 2", ...], datasets: [{ label: "CUs", data: [1.5, 2.0, ...] }] })`;
  }

  // ── Personal context (user-specific, private/shared threads only) ──
  if (ctx.personalContext) {
    prompt += `\n\n## About the User`;
    prompt += `\n${ctx.personalContext}`;
  }

  // ── MeetingBrain context (inline data + tool for deeper searches) ──
  if (ctx.meetingBrainContext) {
    prompt += `\n\n## MeetingBrain`;
    prompt += `\n${ctx.meetingBrainContext}`;
    prompt += `\n\n_The data above includes your current tasks, recent meetings, and upcoming schedule from MeetingBrain. Use this data to answer questions about your week, schedule, tasks, and recent meetings. Only use the query_meetingbrain tool if you need to search for something specific not shown above._`;
  }

  // ── Selected roles (always-on background expertise) ──
  if (ctx.selectedRoles && ctx.selectedRoles.length > 0) {
    prompt += `\n\n## Your Active Roles`;
    prompt += `\nThe user has selected the following expertise areas to always inform your responses:`;
    for (const sr of ctx.selectedRoles) {
      prompt += `\n\n### ${sr.name}`;
      prompt += `\n${sr.instructions}`;
    }
  }

  // ── Regional context (user-specific) ──
  if (ctx.region && ctx.region !== "Global") {
    prompt += `\n\n## Regional Context`;
    prompt += `\nThe user is based in ${ctx.region}. Adapt spelling, grammar, cultural references, date formats, currency symbols, and idioms to match ${ctx.region} conventions.`;
  }

  // ── Custom CU system description (if configured) ──
  if (ctx.cuDescription) {
    prompt += `\n\n## Content Unit System`;
    prompt += `\n${ctx.cuDescription}`;
  }

  // ── Workspace content formats & CU definitions (always included, compact) ──
  if (workspaceConfig.contentTypes.length > 0) {
    prompt += `\n\n## Content Formats Available`;
    prompt += `\nThis workspace produces: ${workspaceConfig.contentTypes.map((t) => t.name).join(", ")}.`;
  }

  if (workspaceConfig.cuDefinitions.length > 0) {
    const grouped: Record<string, string[]> = {};
    workspaceConfig.cuDefinitions.forEach((d) => {
      const cat = d.category || "other";
      if (!grouped[cat]) grouped[cat] = [];
      grouped[cat].push(`${d.format} (${d.units} CU)`);
    });
    prompt += `\n\nContent Unit (CU) definitions by category:`;
    for (const [cat, formats] of Object.entries(grouped)) {
      prompt += `\n- **${cat}:** ${formats.join(", ")}`;
    }
  }

  // ── Per-format AI prompts (from admin Content Formats page) ──
  if (workspaceConfig.formatDescriptions) {
    const entries = Object.entries(workspaceConfig.formatDescriptions).filter(([, v]) => v?.trim());
    if (entries.length > 0) {
      // Map format IDs back to names using CU definitions
      const formatNames = new Map(
        workspaceConfig.cuDefinitions.map((d) => [d.format, d.format])
      );
      prompt += `\n\n## Content Format Guidelines`;
      for (const [key, description] of entries) {
        const name = formatNames.get(key) || key;
        prompt += `\n\n### ${name}\n${description}`;
      }
    }
  }

  // ── Per-type AI prompts (from admin Content Units page, inject when content selected) ──
  if (contentDetail && workspaceConfig.contentTypes.length > 0) {
    const matchingType = workspaceConfig.contentTypes.find(
      (t) => t.name?.toLowerCase() === contentDetail.type?.toLowerCase() ||
             t.key?.toLowerCase() === contentDetail.type?.toLowerCase()
    );
    if (matchingType?.aiPrompt) {
      prompt += `\n\n## Writing Guidelines for ${matchingType.name}\n${matchingType.aiPrompt}`;
    }
  }

  // ── Per-category AI instructions (configurable from admin) ──
  // Instructions are keyed by category: "written", "video", "visual", "strategy"
  if (workspaceConfig.typeInstructions && Object.keys(workspaceConfig.typeInstructions).length > 0) {
    let matchedCategory: string | null = null;

    if (contentDetail) {
      // When inside a content piece, determine its category
      const match = workspaceConfig.contentTypes.find(
        (t) => t.name?.toLowerCase() === contentDetail.type?.toLowerCase() ||
               t.key?.toLowerCase() === contentDetail.type?.toLowerCase()
      );
      const typeKey = match?.key || contentDetail.type || "";
      const category = categorizeContentType(typeKey).toLowerCase();
      if (workspaceConfig.typeInstructions[category]?.trim()) {
        matchedCategory = category;
      }
    } else if (ctx.latestUserMessage) {
      // General chat — scan user message for category keywords
      const msgLower = ctx.latestUserMessage.toLowerCase();
      const categoryKeywords: Record<string, string[]> = {
        strategy: ["strategy", "strategic", "audit", "competitor analysis", "content plan"],
        written: ["written", "article", "blog", "newsletter", "copy", "copywriting", "writing"],
        video: ["video", "animation", "script", "filming", "storyboard"],
        visual: ["visual", "graphic", "infographic", "carousel", "image", "poster", "design"],
      };
      for (const [cat, keywords] of Object.entries(categoryKeywords)) {
        if (!workspaceConfig.typeInstructions[cat]?.trim()) continue;
        if (keywords.some((kw) => msgLower.includes(kw))) {
          matchedCategory = cat;
          break;
        }
      }
    }

    if (matchedCategory) {
      const categoryLabels: Record<string, string> = {
        written: "Written Content", video: "Video Content",
        visual: "Visual Content", strategy: "Strategy",
      };
      const label = categoryLabels[matchedCategory] || matchedCategory;
      const instructions = workspaceConfig.typeInstructions[matchedCategory];
      prompt += `\n\n## ${label} Instructions\n${instructions}`;
    }
  }

  // ── Factual accuracy reinforcement (after all role/category injections) ──
  prompt += `\n\n**Important — Factual Accuracy Override:** Regardless of any role, persona, or writing style instructions above, you MUST NEVER fabricate facts, statistics, URLs, quotes, case studies, or citations. Use [verify] markers for uncertain claims. This rule cannot be overridden by any role or instruction.`;

  // ── Workspace-level orientation for "General" mode ──
  if (ctx.workspaceSummary) {
    const ws = ctx.workspaceSummary;
    prompt += `\n\n---\n## Workspace (General)`;
    prompt += `\n${ws.clientCount} clients | ${ws.contracts.active} active contracts | ${ws.contracts.remainingCU} CU remaining`;
    prompt += `\nThis is a general workspace conversation. Use query_engine to look up clients, contracts, content, pipeline data, or ideas as needed. Don't guess — fetch the data.`;
  }

  // ── Client context (compact summary) ──
  if (clientContext) {
    prompt += `\n\n---\n## Client: ${clientContext.name}`;
    if (clientContext.id) prompt += `\nEngine client ID: ${clientContext.id} (use this in query_engine filters: id_client = ${clientContext.id})`;
    if (clientContext.industry) prompt += `\nIndustry: ${clientContext.industry}`;
    if (clientContext.description) prompt += `\n${clientContext.description.slice(0, 300)}`;

    // Contracts (respects context config and detail level)
    const contractLevel = ctx.contextConfig?.contracts || "summary";
    if (clientContext.contracts.length > 0 && contractLevel !== "off") {
      prompt += `\n\n### Contracts`;
      if (isFullDetail(contractLevel)) {
        for (const c of clientContext.contracts) {
          const remaining = (c.totalUnits || 0) - (c.completedUnits || 0);
          const contractUrl = c.id ? `https://app.thecontentengine.com/admin/contracts/${c.id}` : null;
          prompt += `\n\n**${c.name}** [${c.active ? "Active" : "Inactive"}]`;
          if (contractUrl) prompt += ` — [View in Engine](${contractUrl})`;
          prompt += `\n- CU Budget: ${c.completedUnits || 0}/${c.totalUnits || 0} used (${remaining} remaining)`;
          if (c.startDate || c.endDate) {
            prompt += `\n- Period: ${c.startDate?.slice(0, 10) || "?"} → ${c.endDate?.slice(0, 10) || "ongoing"}`;
          }
          if (c.notes) prompt += `\n- Notes: ${c.notes.slice(0, 500)}`;
          if (c.commissionedContent?.length) {
            prompt += `\n- Commissioned content (${c.commissionedContent.length} items):`;
            for (const item of c.commissionedContent) {
              let line = `\n  - ${item.title} (${item.type}`;
              if (item.format) line += ` / ${item.format}`;
              line += `) — ${item.cu} CU [${item.status}]`;
              if (item.dateCompleted) line += ` completed ${item.dateCompleted.slice(0, 10)}`;
              if (item.currentTask) {
                line += ` | Task: ${item.currentTask}`;
                if (item.taskAssignee) line += ` → ${item.taskAssignee}`;
              }
              if (item.id) line += ` [engine:content:${item.id}]`;
              prompt += line;
            }
          }
        }
      } else {
        for (const c of clientContext.contracts) {
          const remaining = (c.totalUnits || 0) - (c.completedUnits || 0);
          prompt += `\n- **${c.name}** [${c.active ? "Active" : "Inactive"}]: ${c.completedUnits || 0}/${c.totalUnits || 0} CU (${remaining} remaining)`;
          if (c.startDate || c.endDate) {
            prompt += ` | ${c.startDate?.slice(0, 10) || "?"} → ${c.endDate?.slice(0, 10) || "ongoing"}`;
          }
          if (c.notes) prompt += `\n  Notes: ${c.notes.slice(0, 200)}`;
        }
      }
    }

    // Content pipeline (respects context config and detail level)
    const contentLevel = ctx.contextConfig?.contentPipeline || "summary";
    const ideasLevel = ctx.contextConfig?.ideas || "summary";
    const cs = clientContext.contentSummary;
    const hasContent = cs.total > 0 && contentLevel !== "off";
    const hasIdeas = ctx.clientIdeas && ctx.clientIdeas.length > 0 && ideasLevel !== "off";

    if (hasContent || hasIdeas) {
      prompt += `\n\n### Content Pipeline`;
      if (hasContent) {
        prompt += `\n${cs.total} pieces total | ${cs.totalCU} CU total`;
      }

      if (hasContent) {
        if (isFullDetail(contentLevel) && clientContext.contentItems?.length) {
          // Full detail: group items by status category
          const windowNote = getWindowLabel(contentLevel);
          const commissioned = clientContext.contentItems.filter(i => i.status === "Commissioned");
          const completed = clientContext.contentItems.filter(i => i.status === "Completed");
          const spiked = clientContext.contentItems.filter(i => i.status === "Spiked");

          if (commissioned.length > 0) {
            prompt += `\n\n#### Commissioned (In Production) — ${commissioned.length} items`;
            prompt += `\nContent the client has approved and commissioned for production${windowNote ? ` (${windowNote})` : ""}:`;
            for (const item of commissioned) {
              prompt += `\n- **${item.title}** (${item.type}) — ${item.cu} CU`;
              if (item.brief) prompt += `\n  Brief: ${item.brief.slice(0, 300)}`;
              if (item.audience) prompt += `\n  Audience: ${item.audience}`;
              if (item.topics?.length) prompt += `\n  Topics: ${item.topics.join(", ")}`;
              if (item.platform) prompt += `\n  Platform: ${item.platform}`;
            }
          }

          if (completed.length > 0) {
            prompt += `\n\n#### Completed (Delivered) — ${completed.length} items`;
            prompt += `\nContent successfully completed and delivered${windowNote ? ` (${windowNote})` : ""}:`;
            for (const item of completed) {
              prompt += `\n- **${item.title}** (${item.type}) — ${item.cu} CU`;
              if (item.brief) prompt += `\n  Brief: ${item.brief.slice(0, 300)}`;
              if (item.audience) prompt += `\n  Audience: ${item.audience}`;
              if (item.topics?.length) prompt += `\n  Topics: ${item.topics.join(", ")}`;
              if (item.platform) prompt += `\n  Platform: ${item.platform}`;
            }
          }

          if (spiked.length > 0) {
            prompt += `\n\n#### Spiked — ${spiked.length} items`;
            prompt += `\nContent that was rejected or couldn't proceed${windowNote ? ` (${windowNote})` : ""}:`;
            for (const item of spiked) {
              prompt += `\n- **${item.title}** (${item.type}) — ${item.cu} CU`;
              if (item.brief) prompt += `\n  Brief: ${item.brief.slice(0, 300)}`;
              if (item.topics?.length) prompt += `\n  Topics: ${item.topics.join(", ")}`;
            }
          }
        } else {
          // Summary mode: show per-category counts, type breakdown, and recent titles
          if (cs.commissioned > 0) {
            prompt += `\n\n**Commissioned** (In Production) — ${cs.commissioned} items`;
            prompt += `\nContent the client has approved and commissioned for production.`;
            const commTypes = Object.entries(cs.byType).filter(([, v]) => v.commissioned > 0);
            if (commTypes.length > 0) {
              prompt += `\nBy type: ${commTypes.map(([t, v]) => `${t}: ${v.commissioned}`).join(", ")}`;
            }
            if (cs.recentCommissioned.length > 0) {
              prompt += `\nIn progress: ${cs.recentCommissioned.join(", ")}`;
            }
          }

          if (cs.completed > 0) {
            prompt += `\n\n**Completed** (Delivered) — ${cs.completed} items`;
            prompt += `\nSuccessfully delivered content.`;
            const compTypes = Object.entries(cs.byType).filter(([, v]) => v.completed > 0);
            if (compTypes.length > 0) {
              prompt += `\nBy type: ${compTypes.map(([t, v]) => `${t}: ${v.completed}`).join(", ")}`;
            }
            if (cs.recentCompleted.length > 0) {
              prompt += `\nRecent: ${cs.recentCompleted.join(", ")}`;
            }
          }

          if (cs.spiked > 0) {
            prompt += `\n\n**Spiked** — ${cs.spiked} items`;
            prompt += `\nContent that was rejected or couldn't proceed.`;
            const spkTypes = Object.entries(cs.byType).filter(([, v]) => v.spiked > 0);
            if (spkTypes.length > 0) {
              prompt += `\nBy type: ${spkTypes.map(([t, v]) => `${t}: ${v.spiked}`).join(", ")}`;
            }
            if (cs.recentSpiked.length > 0) {
              prompt += `\nRecent: ${cs.recentSpiked.join(", ")}`;
            }
          }
        }
      }

      // Ideas submitted (within content pipeline, controlled by ideas config toggle)
      if (hasIdeas) {
        const weekAgo = new Date();
        weekAgo.setDate(weekAgo.getDate() - 7);
        const thisWeek = ctx.clientIdeas!.filter((i) => i.createdAt && new Date(i.createdAt) >= weekAgo);

        prompt += `\n\n#### Ideas Submitted — ${ctx.clientIdeas!.length} ideas`;
        prompt += `\nPotential content ideas submitted for consideration | ${thisWeek.length} this week`;

        // Status breakdown
        const statusCounts: Record<string, number> = {};
        ctx.clientIdeas!.forEach((i) => {
          statusCounts[i.status] = (statusCounts[i.status] || 0) + 1;
        });
        prompt += `\nBy status: ${Object.entries(statusCounts).map(([s, n]) => `${s}: ${n}`).join(" | ")}`;

        if (isFullDetail(ideasLevel)) {
          for (const idea of ctx.clientIdeas!) {
            prompt += `\n- **${idea.title}** [${idea.status}]`;
            if (idea.createdAt) prompt += ` (${idea.createdAt.slice(0, 10)})`;
            if (idea.brief) prompt += `\n  ${idea.brief}`;
            if (idea.topicTags?.length) prompt += `\n  Topics: ${idea.topicTags.join(", ")}`;
            if (idea.commissionedAt) prompt += `\n  Commissioned: ${idea.commissionedAt.slice(0, 10)}`;
          }
        } else {
          for (const idea of ctx.clientIdeas!.slice(0, 10)) {
            prompt += `\n- **${idea.title}** [${idea.status}]`;
            if (idea.createdAt) prompt += ` (${idea.createdAt.slice(0, 10)})`;
            if (idea.brief) prompt += `: ${idea.brief.slice(0, 150)}`;
          }
        }
      }
    }

    // Social presence (respects context config and detail level)
    const socialLevel = ctx.contextConfig?.socialPresence || "summary";
    const platforms = Object.entries(clientContext.socialPlatforms);
    if (platforms.length > 0 && socialLevel !== "off") {
      prompt += `\n\n### Social Presence`;
      prompt += `\n${platforms.map(([p, n]) => `${p}: ${n} posts`).join(" | ")}`;
    }

    // Client background from processed asset files
    if (ctx.clientBackground?.document_context) {
      prompt += `\n\n### Client Background (from ${ctx.clientBackground.units_asset_count} asset file${ctx.clientBackground.units_asset_count !== 1 ? "s" : ""})`;
      prompt += `\n${ctx.clientBackground.document_context}`;
      prompt += `\n_Last updated: ${ctx.clientBackground.date_last_processed?.slice(0, 10)}_`;
    }

    // Client meeting context from MeetingBrain (linked via attendee email domains)
    if (ctx.clientBackground?.meeting_context) {
      prompt += `\n\n### Recent Client Meetings`;
      prompt += `\n${ctx.clientBackground.meeting_context}`;
      prompt += `\n\n**Important:** When the user asks about meetings in this client context, use ONLY the client meetings listed above. Do NOT use query_meetingbrain to search for meetings — that tool returns all personal meetings which may include unrelated private meetings. The meetings above have been verified as relevant to this client.`;
    }
  }

  // ── Content detail (when inside a specific content piece) ──
  if (contentDetail) {
    prompt += `\n\n---\n## Current Content Piece`;
    prompt += `\n**${contentDetail.title}** (${contentDetail.type})`;
    if (contentDetail.platform) prompt += ` — Platform: ${contentDetail.platform}`;
    if (contentDetail.targetLength) prompt += ` — Target: ${contentDetail.targetLength}`;

    if (contentDetail.brief) prompt += `\n\n**Brief:** ${contentDetail.brief}`;
    if (contentDetail.guidelines) prompt += `\n\n**Guidelines:** ${contentDetail.guidelines}`;
    if (contentDetail.audience) prompt += `\n\n**Audience:** ${contentDetail.audience}`;
    if (contentDetail.notes) prompt += `\n\n**Notes:** ${contentDetail.notes}`;
    if (contentDetail.topicTags?.length) prompt += `\n**Topics:** ${contentDetail.topicTags.join(", ")}`;
    if (contentDetail.campaignTags?.length) prompt += `\n**Campaigns:** ${contentDetail.campaignTags.join(", ")}`;

    if (contentDetail.body) {
      const body = contentDetail.body.length > 6000
        ? contentDetail.body.slice(0, 6000) + "\n[truncated]"
        : contentDetail.body;
      prompt += `\n\n### Current Draft\n${body}`;
    }
  }

  // ── User & Workspace Memories (V2: tiered by strength) ──
  if (ctx.memories && ctx.memories.length > 0) {
    prompt += `\n\n---\n## Memory\nContext from previous conversations, ranked by confidence. Higher tiers reflect well-established patterns.\n\n**Important:** Memories are things the user or team have said — they are NOT externally verified facts. When a memory contains a factual claim (e.g. a statistic or market figure), treat it as user-provided context. If writing content that includes such claims for publication, flag them: "[from team context — verify before publishing]".`;

    // Split into tiers by decayed strength
    const strong = ctx.memories.filter((m) => (m.strength ?? 1.0) >= 0.7);
    const moderate = ctx.memories.filter((m) => (m.strength ?? 1.0) >= 0.35 && (m.strength ?? 1.0) < 0.7);
    const weak = ctx.memories.filter((m) => (m.strength ?? 1.0) < 0.35);

    const categoryLabels: Record<string, string> = {
      instruction: "Standing guidance",
      preference: "Preferences",
      fact: "Background context",
      style: "Style",
      client_insight: "Client context",
    };

    const renderTier = (memories: typeof ctx.memories, tierLabel: string) => {
      if (!memories || memories.length === 0) return;
      const tierGrouped: Record<string, string[]> = {};
      for (const mem of memories!) {
        const cat = mem.category || "fact";
        if (!tierGrouped[cat]) tierGrouped[cat] = [];
        tierGrouped[cat].push(mem.content);
      }
      prompt += `\n\n### ${tierLabel}`;
      for (const [category, items] of Object.entries(tierGrouped)) {
        const label = categoryLabels[category] || category;
        prompt += `\n**${label}:**`;
        for (const item of items) {
          prompt += `\n- ${item}`;
        }
      }
    };

    if (strong.length > 0) renderTier(strong, "Established");
    if (moderate.length > 0) renderTier(moderate, "Developing");
    if (weak.length > 0) renderTier(weak, "Fading");

    prompt += `\n\n**How to use memories:**`;
    prompt += `\n- "Established" memories are well-confirmed patterns — lean on these confidently.`;
    prompt += `\n- "Developing" memories are emerging signals — use when relevant but don't over-anchor on them.`;
    prompt += `\n- "Fading" memories may be outdated — reference only if clearly relevant to the current topic.`;
    prompt += `\n- If any memory conflicts with what the user is saying right now, follow the current conversation.`;
    prompt += `\n- Never mention the memory system or that you "remember" something unless the user explicitly asks.`;
  }

  // ── Engine deep links ──
  prompt += `\n\n## Engine Links
When listing content items, tasks, or contracts, include clickable links to the Content Engine app:
- Content: https://app.thecontentengine.com/all/contents/{contentId}
- Contract: https://app.thecontentengine.com/admin/contracts/{contractId}
- Social promo: https://app.thecontentengine.com/{clientId}/social-media/all-social-promos/{id_social}
- Social post/schedule: https://app.thecontentengine.com/{clientId}/social-media/schedule/{id_social}
When you have IDs from query results, ALWAYS include the relevant link. Format: [Content Name](https://app.thecontentengine.com/all/contents/12345)
For social promos use the client's id_client in the URL path. For tables, include links in an ID/Link column.`;

  // ── Database query tool instructions ──
  prompt += `\n\n## Database Queries
You have a query_engine tool to look up real-time data from The Content Engine database.

CRITICAL: When you need data you don't have — USE the query_engine tool immediately. Do NOT suggest the user check the Engine or query it themselves. Do NOT say "you could use query_engine" — just call it. You have direct access to the database.

### Report mode (for CU metrics and totals)
For questions about "how many CUs", "what was commissioned", or pipeline totals, use REPORT mode — it does proper cross-table joins:
- report: "commissioned_units" + date_from — CUs from new tasks created in the period (the standard commissioning metric, joins tasks → content/social → clients)
- report: "completed_units" + date_from — CUs from content completed in the period
- report: "pipeline_summary" — overview of all content by status and type
Add client_id to scope to one client. Add date_to for end date (defaults to today).
ALWAYS use report mode for "how many CUs" questions — direct table queries cannot calculate these correctly.

### Table mode (for specific records)
Use table mode when:
- The user asks about specific content items, contracts, tasks, or ideas
- You need to list or search for individual records
- The user asks about data across multiple clients or contracts
- The user asks "what did we produce" or "what was commissioned" — query app_content filtered by contract or client
- You have a contract ID or client ID but no content details — query for them

Available tables: app_content (content pipeline), app_contracts (contracts), app_clients (clients), app_tasks_content (content workflow tasks), app_ideas (ideas), app_social (social promos — creative content per network, NOT publishing data), app_tasks_social (social workflow tasks). NOTE: There is NO table for querying published posts directly — use report="social_performance" instead.

Query tips:
- Omit id_client filter to query across ALL clients in the workspace
- Filter by id_client for client-specific data (the client ID is in your context above if a client is selected)
- Filter by id_contract to get content under a specific contract
- Use flag_completed=1 for completed items, flag_spiked=1 for spiked items
- Date filters use ISO format: gte "2025-01-01" for "since January 2025"
- Use type_content to filter by format (e.g. "article", "video", "social-card")
- Use ilike with % wildcards for text search (e.g. ilike "%ESG%")
- Results include IDs you can use for Engine deep links
- You can query multiple times if needed (e.g. first get totals, then break down by client)

**Social media data model** — the social media pipeline has FOUR tables across THREE layers:

1. **Content commissioning** (app_content): Content pieces commissioned for social media have type_content like "Social Only", "Social Card", etc. Each has id_content.

2. **Social promos** (app_social): Promos created FROM content (linked via id_content). Each promo targets a network and type_post. Has: id_social, name_social, network, type_post, date_created, date_completed, id_content, id_client, units_content. One content piece can have MULTIPLE promos across networks.

3. **Published posts** (app_posting_posts): The actual posts that went out to social networks. This is the GROUND TRUTH for "what was published". Has: id_post, id_social (links to promo), name_social (post text), network, status ("published"), date_published, link_post (live URL). One promo (id_social) can have multiple posts (id_post) if scheduled multiple times.

4. **Metrics view** (social_posts_overview): A database view combining post data with engagement metrics. Has: metrics_score (engagement), error_post_key. This view is NOT directly queryable — use the social_performance report instead.

- **app_tasks_social** = workflow tasks for social production (who's working on what)
- CRITICAL: network values are LOWERCASE: "linkedin", "facebook", "twitter", "instagram" — NOT "LinkedIn", "Facebook" etc.

⚠️ **MANDATORY RULES for social queries:**
- For ANY question about "how many posts published", "social performance", "best posts", "engagement", "publishing schedule" → use report="social_performance". This queries app_posting_posts (authoritative published posts) enriched with metrics from social_posts_overview.
- NEVER query social_posts_overview or app_posting_posts directly — they are NOT in the allowed tables list. Direct queries give WRONG counts because one promo can have multiple posting attempts (retries/edits). The report deduplicates by promo (id_social) to give accurate counts.
- NEVER query app_social to count "published posts" — app_social contains promos (creative content), NOT publishing records. A promo existing does NOT mean it was published.
- For ANY question about "how many posts", "publishing data", "social performance", "engagement" → you MUST use: query_engine({ report: "social_performance", client_id: X, date_from: "YYYY-MM-DD" })
- To filter by network, pass it in args: query_engine({ report: "social_performance", args: { network: "linkedin" }, client_id: 6, date_from: "2026-01-01" })
- The report automatically excludes test client (id_client=2).
- "How many Twitter posts?" → report: "social_performance" with args.network="twitter" + client_id + date_from
- "Best performing post?" → report: "social_performance" (results sorted by metrics_score)
- "Social comparison across platforms?" → report: "social_performance" WITHOUT network filter (summary field has per-network breakdown)
- "What social content was produced?" → query app_social for promos + app_content for commissioned content (these are production questions, not publishing)
- Social tasks/assignments → use app_tasks_social with direct table query

Do NOT query for every question — use your existing context first. Query only when you need specific data you don't already have.

### Web Search vs Database: Choosing the Right Tool
- **web_search**: Use for external information — news, industry trends, company research, regulations, current events, competitor analysis, market data. If the user asks "what's in the news" or "latest trends in X" — use web_search.
- **query_engine**: Use for internal Engine data — content pipeline, contracts, CUs, tasks, ideas, client data. If the user asks about "our content" or "commissioned this month" — use query_engine.
- You can use BOTH in the same response if needed (e.g. web search for industry context + query_engine for client data).
- NEVER guess at external facts — use web_search. NEVER guess at internal data — use query_engine.

### Smart Multi-Tool Workflows
When a client is selected, combine tools for deeper, more useful answers:

**Content Ideas**: When asked for new content ideas:
1. query_engine → app_ideas (filter id_client, check status for approved vs rejected patterns)
2. query_engine → app_content (recent completed content — what's already been done)
3. web_search → industry trends, competitor content, news relevant to the client
4. Combine: suggest ideas that build on successful patterns, avoid duplicating existing content, and incorporate fresh external insights

**Pipeline Review**: When asked about content status or workload:
1. query_engine → app_content (filter id_client, check flag_completed/flag_spiked)
2. query_engine → app_tasks_content (filter id_client, check current tasks and assignees)
3. Summarise: what's in production, who's working on what, what's overdue

**Tasks**: There are TWO task systems — always pick the right one:
- **Engine tasks**: Content production workflow tasks — writing, editing, reviewing, designing. Use the **assigned_tasks** report: query_engine({ report: "assigned_tasks", assignee_name: "Chris" }). This returns current incomplete tasks with proper joins (content + client + status).
- **MeetingBrain tasks**: Personal action items from meetings and planning. Use query_meetingbrain({ report: "my_tasks" }) to fetch current tasks.
- **MeetingBrain meetings**: Use query_meetingbrain({ report: "meetings" }) for recent meeting summaries, or query_meetingbrain({ report: "search_meetings", query: "budget" }) to search meeting content.
- When the question is ambiguous (e.g. "what tasks have I got?"), check BOTH: use assigned_tasks report for Engine tasks AND query_meetingbrain for MeetingBrain tasks, then present both together clearly labelled.
- DEFAULT: If the user says "tasks in the Engine" or "assigned tasks" — use report: "assigned_tasks" with their name. For other people: query_engine({ report: "assigned_tasks", assignee_name: "Ceri" }).
- For MeetingBrain queries about other people: query_meetingbrain({ report: "my_tasks", person_name: "Ceri" }).
- Use first name only for names — both tools do partial matching.

**Social Media Review**: When asked about social media, posts, or social content:
1. query_engine → report="social_performance" with client_id, date_from, and optionally args.network (MANDATORY for any publishing/metrics/performance/count questions). This queries app_posting_posts (ground truth) enriched with metrics.
2. query_engine → app_social (filter by id_client, network — social promos/creative content, NOT publishing data)
3. query_engine → app_content (filter by id_client, type_content for social types — commissioned social content)
4. query_engine → app_tasks_social (filter by id_client — who's working on social tasks)
5. For social ideas or new post suggestions: also check app_ideas and use web_search for trending topics
6. IMPORTANT: The pipeline flows: Content (commissioned) → Social Promo (created per network) → Post (published via app_posting_posts). Distinguish between these stages.
7. NEVER query social_posts_overview directly. NEVER use app_social to count published posts. ALWAYS use report="social_performance" for publishing data.

**Client Research**: When asked to research topics for a client:
1. query_engine → app_content + app_ideas (what has this client done before on this topic)
2. web_search → latest developments, data, news on the topic
3. Combine: contextualise external research with the client's content history`;

  // Add client ID reminder if client is selected
  if (clientContext?.id) {
    prompt += `\n\n**Active client filter**: id_client = ${clientContext.id} (${clientContext.name}). Use this in ALL query_engine calls when the question is about this client.`;
  }

  // ── Closing instruction ──
  if (clientContext || contentDetail) {
    prompt += `\n\n---\nYou have full context about ${clientContext ? `${clientContext.name}'s contracts, content pipeline, social presence, and ideas` : "this content piece"}. When the user refers to "this client" or "this content", use the data above. Never ask for information you already have.`;
  }

  // ── Memory search tool ──
  prompt += `\n\n### Memory Search
You have a search_memory tool that searches the user's previous conversations, stored memories, and thread summaries.

CRITICAL: When you cannot answer a personal question from your current context, ALWAYS call search_memory before saying "I don't have that information." Never assume — search first.

Use search_memory when:
- The user asks about personal plans, travel, flights, bookings, schedules
- The user references something from a previous conversation ("I told you last week...")
- The user asks about preferences, decisions, or personal context not in current context
- You're about to say "I don't have information about..." for a PERSONAL question — STOP and search first
- Questions about specific people, places, or topics the user may have discussed previously

Do NOT use search_memory when:
- The question is about Engine data (content, tasks, social posts, clients, contracts) — use query_engine instead
- The question can be answered with query_engine reports or table queries
- The user asks about social media performance, commissioned content, pipelines — these are database queries, not memory searches
- You already have the answer in your current context or loaded memories

Search tips:
- Use short, specific keywords: "kuala lumpur flight", "Q2 budget", "hotel booking"
- Try alternate terms if first search returns nothing: "KL" vs "Kuala Lumpur"
- The tool searches memories, messages, AND thread summaries`;

  // ── Final factual accuracy reminder (recency-weighted — LLMs weight end of prompt highly) ──
  prompt += `\n\n---\n**Final reminder:** Users publish your output. Every fabricated fact, URL, statistic, or citation damages their professional reputation. When uncertain: use [verify] markers, state limitations honestly, and never invent sources.`;

  return prompt;
}

// Keep backward compatibility for any old imports
export const getAIWriterSystemPrompt = buildSystemPrompt as any;
