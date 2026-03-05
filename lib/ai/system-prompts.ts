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

    if (context.contentBody) {
      // Include content body but truncate if very long to stay within token limits
      const body = context.contentBody.length > 8000
        ? context.contentBody.slice(0, 8000) + "\n\n[Content truncated...]"
        : context.contentBody;
      prompt += `\n\n**Current Draft:**\n${body}`;
    }

    if (context.linkedPosts?.length) {
      prompt += `\n\n**Linked Social Posts (${context.linkedPosts.length}):**`;
      for (const post of context.linkedPosts.slice(0, 10)) {
        prompt += `\n- [${post.platform}${post.type ? ` / ${post.type}` : ""}]: ${post.content?.slice(0, 200) || "(empty)"}`;
      }
    }

    prompt += `\n\nYou have full context about this client and content piece. When the user asks about "this client" or "this content", use the information above. Focus your responses on helping with this specific content piece unless the user asks about something else.`;
  }

  return prompt;
}
