import { categorizeContentType } from "@/lib/content-type-utils";

// ── Detail level types ──

export type DetailLevel = "off" | "summary" | "full-week" | "full-month" | "full-year";

export interface NormalizedContextConfig {
  contracts: DetailLevel;
  contentPipeline: DetailLevel;
  socialPresence: DetailLevel;
  ideas: DetailLevel;
  webSearch: "on" | "off";
  incognito: "on" | "off";
  memory: "on" | "off";
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
  if (!config) return { contracts: "summary", contentPipeline: "summary", socialPresence: "summary", ideas: "summary", webSearch: "on", incognito: "off", memory: "on" };
  return {
    contracts: normalizeDetailLevel(config.contracts),
    contentPipeline: normalizeDetailLevel(config.contentPipeline),
    socialPresence: normalizeDetailLevel(config.socialPresence),
    ideas: normalizeDetailLevel(config.ideas),
    webSearch: config.webSearch === "off" ? "off" : "on",
    incognito: config.incognito === "on" ? "on" : "off",
    memory: config.memory === "off" ? "off" : "on",
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
      title: string;
      type: string;
      cu: number;
      status: string;
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
  memories?: { content: string; category: string }[];
  role?: { name: string; instructions: string } | null;
  latestUserMessage?: string;
}): string {
  const { workspaceConfig, clientContext, contentDetail } = ctx;

  let prompt: string;
  if (ctx.role) {
    prompt = `You are EngineGPT, acting as ${ctx.role.name}, built into The Content Engine. ${ctx.role.instructions}

Guidelines:
- Be direct, actionable, and creative — avoid generic advice
- Use the context below to give specific, informed answers
- When drafting, produce publication-ready work
- Use markdown formatting for readability`;
  } else {
    prompt = `You are EngineGPT, an expert content strategist and writer built into The Content Engine. You help users brainstorm, draft, refine, and strategise content.

Guidelines:
- Be direct, actionable, and creative — avoid generic advice
- Use the context below to give specific, informed answers
- When drafting, produce publication-ready work
- Use markdown formatting for readability`;
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

  // ── Workspace-level summary for "General" mode ──
  if (ctx.workspaceSummary) {
    const ws = ctx.workspaceSummary;
    prompt += `\n\n---\n## Workspace Overview (General)`;
    prompt += `\n${ws.clientCount} clients in workspace`;

    // Contracts overview
    if ((ctx.contextConfig?.contracts || "summary") !== "off" && ws.contracts.active > 0) {
      prompt += `\n\n### Contracts`;
      prompt += `\n${ws.contracts.active} active contracts | ${ws.contracts.totalCU} CU total | ${ws.contracts.completedCU} completed | ${ws.contracts.remainingCU} remaining`;
    }

    // Content overview
    if ((ctx.contextConfig?.contentPipeline || "summary") !== "off" && ws.content.total > 0) {
      prompt += `\n\n### Content Pipeline`;
      prompt += `\n${ws.content.total} pieces total | ${ws.content.published} published | ${ws.content.inProduction} in production | ${ws.content.totalCU} CU`;
    }

    // Ideas overview
    if ((ctx.contextConfig?.ideas || "summary") !== "off" && ws.ideas.total > 0) {
      prompt += `\n\n### Ideas`;
      prompt += `\n${ws.ideas.total} total ideas | ${ws.ideas.thisWeek} submitted this week`;
      const statusEntries = Object.entries(ws.ideas.byStatus);
      if (statusEntries.length > 0) {
        prompt += `\nBy status: ${statusEntries.map(([s, n]) => `${s}: ${n}`).join(" | ")}`;
      }
      if (ws.ideas.recent.length > 0) {
        prompt += `\n\nRecent ideas:`;
        for (const idea of ws.ideas.recent.slice(0, 15)) {
          prompt += `\n- **${idea.title}** [${idea.status}]`;
          if (idea.clientName) prompt += ` — ${idea.clientName}`;
          if (idea.createdAt) prompt += ` (${idea.createdAt.slice(0, 10)})`;
          if (idea.brief) prompt += `: ${idea.brief.slice(0, 150)}`;
        }
      }
    }

    prompt += `\n\n---\nYou have a workspace-wide overview of all clients, contracts, content, and ideas. Use this data to answer questions about the business. When the user asks about "all clients" or aggregate metrics, use the data above.`;
  }

  // ── Client context (compact summary) ──
  if (clientContext) {
    prompt += `\n\n---\n## Client: ${clientContext.name}`;
    if (clientContext.industry) prompt += `\nIndustry: ${clientContext.industry}`;
    if (clientContext.description) prompt += `\n${clientContext.description.slice(0, 300)}`;

    // Contracts (respects context config and detail level)
    const contractLevel = ctx.contextConfig?.contracts || "summary";
    if (clientContext.contracts.length > 0 && contractLevel !== "off") {
      prompt += `\n\n### Contracts`;
      if (isFullDetail(contractLevel)) {
        for (const c of clientContext.contracts) {
          const remaining = (c.totalUnits || 0) - (c.completedUnits || 0);
          prompt += `\n\n**${c.name}** [${c.active ? "Active" : "Inactive"}]`;
          prompt += `\n- CU Budget: ${c.completedUnits || 0}/${c.totalUnits || 0} used (${remaining} remaining)`;
          if (c.startDate || c.endDate) {
            prompt += `\n- Period: ${c.startDate?.slice(0, 10) || "?"} → ${c.endDate?.slice(0, 10) || "ongoing"}`;
          }
          if (c.notes) prompt += `\n- Notes: ${c.notes.slice(0, 500)}`;
          if (c.commissionedContent?.length) {
            prompt += `\n- Commissioned content (${c.commissionedContent.length} items):`;
            for (const item of c.commissionedContent) {
              prompt += `\n  - ${item.title} (${item.type}) — ${item.cu} CU [${item.status}]`;
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

  // ── User & Workspace Memories ──
  if (ctx.memories && ctx.memories.length > 0) {
    prompt += `\n\n---\n## Memory\nImportant context remembered from previous conversations:`;

    const grouped: Record<string, string[]> = {};
    for (const mem of ctx.memories) {
      const cat = mem.category || "fact";
      if (!grouped[cat]) grouped[cat] = [];
      grouped[cat].push(mem.content);
    }

    for (const [category, items] of Object.entries(grouped)) {
      const label = category.charAt(0).toUpperCase() + category.slice(1).replace("_", " ");
      prompt += `\n\n### ${label}`;
      for (const item of items) {
        prompt += `\n- ${item}`;
      }
    }

    prompt += `\n\nUse these memories naturally to personalise your responses. Do not mention that you have a memory system unless the user explicitly asks about it.`;
  }

  // ── Closing instruction ──
  if (clientContext || contentDetail) {
    prompt += `\n\n---\nYou have full context about ${clientContext ? `${clientContext.name}'s contracts, content pipeline, social presence, and ideas` : "this content piece"}. When the user refers to "this client" or "this content", use the data above. Never ask for information you already have.`;
  }

  return prompt;
}

// Keep backward compatibility for any old imports
export const getAIWriterSystemPrompt = buildSystemPrompt as any;
