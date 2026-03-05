export function getAIWriterSystemPrompt(context?: {
  contentTitle?: string;
  contentType?: string;
  contentBody?: string;
  contentBrief?: string;
  guidelines?: string;
  audience?: string;
  targetLength?: string;
  platform?: string;
  notes?: string;
  customerName?: string;
  topicTags?: string[];
  campaignTags?: string[];
  linkedPosts?: { content: string; platform: string; type: string }[];
  contract?: {
    name: string;
    totalUnits: number;
    completedUnits: number;
    active: boolean;
    startDate: string;
    endDate: string;
    notes?: string;
  };
  clientContentPipeline?: {
    id: number;
    title: string;
    type: string;
    status: string;
    completedAt?: string;
    units?: number;
    isCurrent: boolean;
  }[];
}): string {
  let prompt = `You are an expert content strategist and writer working inside The Content Engine, a content management platform. You help users brainstorm ideas, draft content, refine messaging, and solve content challenges.

Your capabilities:
- Brainstorming and ideation for content pieces
- Drafting articles, social posts, newsletters, scripts, and other content formats
- Editing and improving existing content
- Strategic advice on content marketing, SEO, and audience engagement
- Research assistance and fact organisation

Guidelines:
- Be direct, actionable, and creative
- Avoid generic advice — be specific to the user's context
- When drafting content, produce publication-ready work
- Use markdown formatting for readability (headings, lists, bold, code blocks)
- Keep responses focused and concise unless the user asks for detail`;

  if (context?.contentTitle || context?.customerName) {
    prompt += `\n\n---\n## Current Context`;

    if (context.customerName) {
      prompt += `\n\n**Client:** ${context.customerName}`;
    }

    if (context.contentTitle) {
      prompt += `\n**Content Piece:** ${context.contentTitle}`;
    }
    if (context.contentType) {
      prompt += `\n**Content Type:** ${context.contentType}`;
    }
    if (context.platform) {
      prompt += `\n**Platform:** ${context.platform}`;
    }
    if (context.targetLength) {
      prompt += `\n**Target Length:** ${context.targetLength}`;
    }

    if (context.contentBrief) {
      prompt += `\n\n**Brief:**\n${context.contentBrief}`;
    }
    if (context.guidelines) {
      prompt += `\n\n**Guidelines:**\n${context.guidelines}`;
    }
    if (context.audience) {
      prompt += `\n\n**Target Audience:**\n${context.audience}`;
    }
    if (context.notes) {
      prompt += `\n\n**Notes:**\n${context.notes}`;
    }

    if (context.topicTags?.length) {
      prompt += `\n\n**Topics:** ${context.topicTags.join(", ")}`;
    }
    if (context.campaignTags?.length) {
      prompt += `\n\n**Campaigns:** ${context.campaignTags.join(", ")}`;
    }

    // Contract overview
    if (context.contract) {
      const c = context.contract;
      const remaining = (c.totalUnits || 0) - (c.completedUnits || 0);
      prompt += `\n\n---\n### Contract Overview`;
      prompt += `\n**Contract:** ${c.name}`;
      prompt += `\n**Status:** ${c.active ? "Active" : "Inactive"}`;
      if (c.startDate || c.endDate) {
        prompt += `\n**Period:** ${c.startDate || "?"} → ${c.endDate || "ongoing"}`;
      }
      prompt += `\n**Content Units:** ${c.completedUnits || 0} delivered of ${c.totalUnits || 0} total (${remaining} remaining)`;
      if (c.notes) {
        prompt += `\n**Contract Notes:** ${c.notes}`;
      }
    }

    // Client content pipeline
    if (context.clientContentPipeline?.length) {
      const pipeline = context.clientContentPipeline;
      const published = pipeline.filter((c) => c.status === "published");
      const inProduction = pipeline.filter((c) => c.status === "in production");
      const spiked = pipeline.filter((c) => c.status === "spiked");

      prompt += `\n\n---\n### Client Content Pipeline`;
      prompt += `\n**Total:** ${pipeline.length} pieces | **Published:** ${published.length} | **In Production:** ${inProduction.length} | **Spiked:** ${spiked.length}`;

      if (inProduction.length > 0) {
        prompt += `\n\n**In Production (${inProduction.length}):**`;
        for (const c of inProduction.slice(0, 15)) {
          prompt += `\n- ${c.isCurrent ? "→ " : ""}${c.title} (${c.type})${c.units ? ` [${c.units} CU]` : ""}`;
        }
      }

      if (published.length > 0) {
        prompt += `\n\n**Recently Published (${Math.min(published.length, 15)} of ${published.length}):**`;
        for (const c of published.slice(0, 15)) {
          prompt += `\n- ${c.title} (${c.type})${c.completedAt ? ` — ${c.completedAt.slice(0, 10)}` : ""}${c.units ? ` [${c.units} CU]` : ""}`;
        }
      }
    }

    if (context.contentBody) {
      const body = context.contentBody.length > 8000
        ? context.contentBody.slice(0, 8000) + "\n\n[Content truncated...]"
        : context.contentBody;
      prompt += `\n\n---\n### Current Draft\n${body}`;
    }

    if (context.linkedPosts?.length) {
      prompt += `\n\n**Linked Social Posts (${context.linkedPosts.length}):**`;
      for (const post of context.linkedPosts.slice(0, 10)) {
        prompt += `\n- [${post.platform}${post.type ? ` / ${post.type}` : ""}]: ${post.content?.slice(0, 200) || "(empty)"}`;
      }
    }

    prompt += `\n\nYou have full context about this client, their contract, and their content pipeline. When the user asks about "this client" or "this content", use all the information above. You can reference what content has been published, what's in production, and how the contract is tracking. Focus your responses on helping with this specific content piece unless the user asks about something else.`;
  }

  return prompt;
}
