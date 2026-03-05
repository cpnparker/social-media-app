// ── Types for the new compact context system ──

interface WorkspaceConfig {
  contentTypes: { key: string; name: string; aiPrompt: string | null }[];
  cuDefinitions: { format: string; category: string; units: number }[];
}

interface ClientContext {
  name: string;
  industry: string | null;
  description: string | null;
  contracts: {
    name: string;
    totalUnits: number;
    completedUnits: number;
    active: boolean;
    startDate: string;
    endDate: string;
    notes?: string;
  }[];
  contentSummary: {
    total: number;
    published: number;
    inProduction: number;
    totalCU: number;
    byType: Record<string, { total: number; published: number; inProd: number }>;
    recentTitles: string[];
  };
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

export function buildSystemPrompt(ctx: {
  workspaceConfig: WorkspaceConfig;
  clientContext: ClientContext | null;
  contentDetail: ContentDetail | null;
}): string {
  const { workspaceConfig, clientContext, contentDetail } = ctx;

  let prompt = `You are EngineGPT, an expert content strategist and writer built into The Content Engine. You help users brainstorm, draft, refine, and strategise content.

Guidelines:
- Be direct, actionable, and creative — avoid generic advice
- Use the context below to give specific, informed answers
- When drafting, produce publication-ready work
- Use markdown formatting for readability`;

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

  // ── Client context (compact summary) ──
  if (clientContext) {
    prompt += `\n\n---\n## Client: ${clientContext.name}`;
    if (clientContext.industry) prompt += `\nIndustry: ${clientContext.industry}`;
    if (clientContext.description) prompt += `\n${clientContext.description.slice(0, 300)}`;

    // Contracts
    if (clientContext.contracts.length > 0) {
      prompt += `\n\n### Contracts`;
      for (const c of clientContext.contracts) {
        const remaining = (c.totalUnits || 0) - (c.completedUnits || 0);
        prompt += `\n- **${c.name}** [${c.active ? "Active" : "Inactive"}]: ${c.completedUnits || 0}/${c.totalUnits || 0} CU (${remaining} remaining)`;
        if (c.startDate || c.endDate) {
          prompt += ` | ${c.startDate?.slice(0, 10) || "?"} → ${c.endDate?.slice(0, 10) || "ongoing"}`;
        }
        if (c.notes) prompt += `\n  Notes: ${c.notes.slice(0, 200)}`;
      }
    }

    // Content pipeline summary
    const cs = clientContext.contentSummary;
    if (cs.total > 0) {
      prompt += `\n\n### Content Pipeline`;
      prompt += `\n${cs.total} pieces total | ${cs.published} published | ${cs.inProduction} in production | ${cs.totalCU} CU total`;

      // Type breakdown
      const typeEntries = Object.entries(cs.byType);
      if (typeEntries.length > 0) {
        prompt += `\nBreakdown: ${typeEntries.map(([t, v]) => `${t}: ${v.inProd} in prod / ${v.published} published`).join(" | ")}`;
      }

      // Recent in-production titles
      if (cs.recentTitles.length > 0) {
        prompt += `\nCurrently in production: ${cs.recentTitles.join(", ")}`;
      }
    }

    // Social presence
    const platforms = Object.entries(clientContext.socialPlatforms);
    if (platforms.length > 0) {
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

  // ── Closing instruction ──
  if (clientContext || contentDetail) {
    prompt += `\n\n---\nYou have full context about ${clientContext ? `${clientContext.name}'s contracts, content pipeline, and social presence` : "this content piece"}. When the user refers to "this client" or "this content", use the data above. Never ask for information you already have.`;
  }

  return prompt;
}

// Keep backward compatibility for any old imports
export const getAIWriterSystemPrompt = buildSystemPrompt as any;
