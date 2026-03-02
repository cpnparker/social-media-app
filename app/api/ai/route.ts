import { NextRequest, NextResponse } from "next/server";
import Anthropic from "@anthropic-ai/sdk";

const anthropic = new Anthropic({
  apiKey: process.env.ANTHROPIC_API_KEY!,
});

// POST /api/ai — handle AI actions
export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { action } = body;

    switch (action) {
      case "generate":
        return handleGenerate(body);
      case "rewrite":
        return handleRewrite(body);
      case "hashtags":
        return handleHashtags(body);
      case "adapt":
        return handleAdapt(body);
      case "best-time":
        return handleBestTime(body);
      case "insights":
        return handleInsights(body);
      case "auto-tag":
        return handleAutoTag(body);
      case "score-idea":
        return handleScoreIdea(body);
      case "suggest-ideas":
        return handleSuggestIdeas(body);
      case "promo-drafts":
        return handlePromoDrafts(body);
      case "generate-content":
        return handleGenerateContent(body);
      case "research-topics":
        return handleResearchTopics(body);
      case "suggest-themes":
        return handleSuggestThemes(body);
      case "fact-check":
        return handleFactCheck(body);
      case "detect-ai":
        return handleDetectAi(body);
      default:
        return NextResponse.json(
          { error: "Invalid action" },
          { status: 400 }
        );
    }
  } catch (error: any) {
    console.error("AI API error:", error.message);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}

// Generate a post from a topic/prompt
async function handleGenerate(body: any) {
  const { topic, platforms, tone, length } = body;

  const platformList = (platforms || []).join(", ") || "social media";
  const toneGuide = tone || "professional yet engaging";
  const lengthGuide =
    length === "short"
      ? "Keep it concise, under 100 words."
      : length === "long"
      ? "Make it detailed, 150-250 words."
      : "Keep it around 80-150 words.";

  const message = await anthropic.messages.create({
    model: "claude-sonnet-4-20250514",
    max_tokens: 1024,
    messages: [
      {
        role: "user",
        content: `You are a social media content expert. Generate a ready-to-publish social media post.

Topic/idea: ${topic}
Target platforms: ${platformList}
Tone: ${toneGuide}
${lengthGuide}

Rules:
- Write ONLY the post content, no explanations or labels
- Include 2-4 relevant emojis naturally woven into the text
- Make it engaging with a hook in the first line
- End with a call to action when appropriate
- Do NOT include hashtags (those will be added separately)
- Make it feel authentic, not corporate or AI-generated`,
      },
    ],
  });

  const content =
    message.content[0].type === "text" ? message.content[0].text : "";

  return NextResponse.json({ content: content.trim() });
}

// Rewrite/improve existing content
async function handleRewrite(body: any) {
  const { content, style, platforms } = body;

  const styleGuide =
    style === "shorter"
      ? "Make it more concise and punchy. Cut unnecessary words."
      : style === "longer"
      ? "Expand it with more detail and context."
      : style === "casual"
      ? "Make it more casual, friendly, and conversational."
      : style === "professional"
      ? "Make it more professional and polished."
      : style === "engaging"
      ? "Make it more engaging with a stronger hook and call to action."
      : style === "witty"
      ? "Add wit and humor while keeping the core message."
      : "Improve the overall quality, clarity, and engagement.";

  const platformContext =
    platforms?.length > 0
      ? `This is for: ${platforms.join(", ")}.`
      : "";

  const message = await anthropic.messages.create({
    model: "claude-sonnet-4-20250514",
    max_tokens: 1024,
    messages: [
      {
        role: "user",
        content: `Rewrite this social media post. ${styleGuide} ${platformContext}

Original post:
${content}

Rules:
- Write ONLY the rewritten post, no explanations
- Preserve the core message and any key information
- Keep emojis if they were used, or add 1-2 if appropriate
- Do NOT add hashtags`,
      },
    ],
  });

  const result =
    message.content[0].type === "text" ? message.content[0].text : "";

  return NextResponse.json({ content: result.trim() });
}

// Suggest hashtags for content
async function handleHashtags(body: any) {
  const { content, platforms } = body;

  const platformContext =
    platforms?.length > 0 ? `Target platforms: ${platforms.join(", ")}.` : "";

  const message = await anthropic.messages.create({
    model: "claude-sonnet-4-20250514",
    max_tokens: 512,
    messages: [
      {
        role: "user",
        content: `Suggest hashtags for this social media post. ${platformContext}

Post:
${content}

Rules:
- Return ONLY a JSON array of hashtag strings (including the # symbol)
- Include 5-10 relevant hashtags
- Mix popular/broad hashtags with niche/specific ones
- Order from most to least relevant
- Format: ["#hashtag1", "#hashtag2", ...]`,
      },
    ],
  });

  const text =
    message.content[0].type === "text" ? message.content[0].text : "[]";

  try {
    // Extract JSON array from response
    const match = text.match(/\[[\s\S]*\]/);
    const hashtags = match ? JSON.parse(match[0]) : [];
    return NextResponse.json({ hashtags });
  } catch {
    return NextResponse.json({ hashtags: [] });
  }
}

// Adapt content for a specific platform
async function handleAdapt(body: any) {
  const { content, targetPlatform } = body;

  const platformGuidelines: Record<string, string> = {
    twitter:
      "Twitter/X: Max 280 chars. Be punchy and concise. Use 1-2 hashtags inline.",
    instagram:
      "Instagram: Can be longer. Use line breaks for readability. Put hashtags at the end (5-10). Use more emojis.",
    linkedin:
      "LinkedIn: Professional tone. Use line breaks and short paragraphs. Tell a story or share a lesson. No hashtags needed or 2-3 max at the end.",
    facebook:
      "Facebook: Conversational tone. Ask questions to drive engagement. Medium length. Can include a link.",
    tiktok:
      "TikTok: Very casual, trendy language. Keep it short. Use current slang naturally. Reference trending concepts.",
    bluesky:
      "Bluesky: Max 300 chars. Similar to Twitter but slightly more room. Be concise and conversational.",
    threads:
      "Threads: Conversational. Can be threaded. 500 char limit. Instagram-adjacent audience.",
  };

  const guide =
    platformGuidelines[targetPlatform?.toLowerCase()] ||
    `${targetPlatform}: Adapt appropriately for this platform.`;

  const message = await anthropic.messages.create({
    model: "claude-sonnet-4-20250514",
    max_tokens: 1024,
    messages: [
      {
        role: "user",
        content: `Adapt this social media post for a specific platform.

Platform guidelines: ${guide}

Original post:
${content}

Rules:
- Write ONLY the adapted post content, no explanations
- Follow the platform's character limits and conventions
- Keep the core message intact
- Adjust tone, length, and formatting for the platform`,
      },
    ],
  });

  const result =
    message.content[0].type === "text" ? message.content[0].text : "";

  return NextResponse.json({ content: result.trim() });
}

// Suggest best times to publish
async function handleBestTime(body: any) {
  const { platforms, analyticsData, timezone } = body;

  const tz = timezone || "UTC";
  const analyticsContext = analyticsData
    ? `Here is real performance data from their account:\n${JSON.stringify(analyticsData, null, 2)}`
    : "No historical data available — use industry best practices.";

  const message = await anthropic.messages.create({
    model: "claude-sonnet-4-20250514",
    max_tokens: 1024,
    messages: [
      {
        role: "user",
        content: `You are a social media scheduling expert. Suggest the best times to publish.

Platforms: ${(platforms || []).join(", ") || "general social media"}
Timezone: ${tz}
${analyticsContext}

Return a JSON object with this exact structure:
{
  "suggestions": [
    {
      "day": "Monday",
      "time": "09:00",
      "platform": "twitter",
      "reason": "Brief reason why"
    }
  ],
  "summary": "A 1-2 sentence overall recommendation"
}

Include 3-5 suggestions, picking the best times across the given platforms. Use 24-hour time format.`,
      },
    ],
  });

  const text =
    message.content[0].type === "text" ? message.content[0].text : "{}";

  try {
    const match = text.match(/\{[\s\S]*\}/);
    const result = match ? JSON.parse(match[0]) : { suggestions: [], summary: "" };
    return NextResponse.json(result);
  } catch {
    return NextResponse.json({ suggestions: [], summary: "Unable to generate suggestions." });
  }
}

// Generate analytics insights
async function handleInsights(body: any) {
  const { analyticsData } = body;

  const message = await anthropic.messages.create({
    model: "claude-sonnet-4-20250514",
    max_tokens: 1024,
    messages: [
      {
        role: "user",
        content: `You are a social media analytics expert. Analyze this performance data and provide actionable insights.

Data:
${JSON.stringify(analyticsData, null, 2)}

Return a JSON object with this exact structure:
{
  "headline": "One-line performance summary (10 words max)",
  "insights": [
    {
      "type": "positive" | "negative" | "tip",
      "title": "Short title (5 words max)",
      "detail": "1-2 sentence explanation with specific numbers from the data"
    }
  ],
  "recommendation": "One specific, actionable recommendation for next week"
}

Include 3-5 insights. Be specific — reference actual numbers from the data. Keep language concise and direct.`,
      },
    ],
  });

  const text =
    message.content[0].type === "text" ? message.content[0].text : "{}";

  try {
    const match = text.match(/\{[\s\S]*\}/);
    const result = match ? JSON.parse(match[0]) : { headline: "", insights: [], recommendation: "" };
    return NextResponse.json(result);
  } catch {
    return NextResponse.json({
      headline: "Unable to analyze data",
      insights: [],
      recommendation: "",
    });
  }
}

// Auto-tag an idea with topic and strategic tags
async function handleAutoTag(body: any) {
  const { title, description } = body;

  const message = await anthropic.messages.create({
    model: "claude-sonnet-4-20250514",
    max_tokens: 512,
    messages: [
      {
        role: "user",
        content: `You are a content strategist. Given this content idea, suggest relevant tags.

Title: ${title}
Description: ${description || "No description provided"}

Return a JSON object with this exact structure:
{
  "topicTags": ["tag1", "tag2", "tag3"],
  "strategicTags": ["strategy1", "strategy2"]
}

Rules:
- topicTags: 3-6 topic/subject tags (e.g., "AI", "marketing", "social media", "startup")
- strategicTags: 2-4 strategic/purpose tags (e.g., "thought leadership", "brand awareness", "lead generation", "community building")
- Keep tags lowercase, concise (1-3 words each)
- Return ONLY the JSON object, no explanations`,
      },
    ],
  });

  const text = message.content[0].type === "text" ? message.content[0].text : "{}";

  try {
    const match = text.match(/\{[\s\S]*\}/);
    const result = match ? JSON.parse(match[0]) : { topicTags: [], strategicTags: [] };
    return NextResponse.json(result);
  } catch {
    return NextResponse.json({ topicTags: [], strategicTags: [] });
  }
}

// Score an idea based on workspace performance model
async function handleScoreIdea(body: any) {
  const { title, description, topicTags, performanceModel } = body;

  const modelContext = performanceModel
    ? `Historical performance data for this workspace:
- Topic performance: ${JSON.stringify(performanceModel.topicPerformanceMap || {})}
- Format performance: ${JSON.stringify(performanceModel.formatPerformanceMap || {})}
- Average engagement baseline: ${performanceModel.averageEngagementBaseline || 0}
- High performance threshold: ${performanceModel.highPerformanceThreshold || 0}`
    : "No historical performance data available — use general social media best practices.";

  const message = await anthropic.messages.create({
    model: "claude-sonnet-4-20250514",
    max_tokens: 512,
    messages: [
      {
        role: "user",
        content: `You are a content performance predictor. Score this content idea's predicted engagement.

Idea Title: ${title}
Description: ${description || "No description"}
Topic Tags: ${(topicTags || []).join(", ") || "none"}

${modelContext}

Return a JSON object with this exact structure:
{
  "score": 72,
  "reasoning": "Brief 1-2 sentence explanation of why this score was assigned",
  "strengthFactors": ["factor1", "factor2"],
  "riskFactors": ["risk1"]
}

Rules:
- Score is 0-100 (0 = very low engagement potential, 100 = viral potential)
- Base your score on the topic's historical performance if available
- Consider the topic tags' alignment with high-performing topics
- Return ONLY the JSON object`,
      },
    ],
  });

  const text = message.content[0].type === "text" ? message.content[0].text : "{}";

  try {
    const match = text.match(/\{[\s\S]*\}/);
    const result = match ? JSON.parse(match[0]) : { score: 50, reasoning: "Unable to score" };
    return NextResponse.json(result);
  } catch {
    return NextResponse.json({ score: 50, reasoning: "Unable to score", strengthFactors: [], riskFactors: [] });
  }
}

// Suggest new ideas based on workspace performance
async function handleSuggestIdeas(body: any) {
  const { performanceModel, recentTopics } = body;

  const modelContext = performanceModel
    ? `Top performing topics: ${JSON.stringify(performanceModel.topicPerformanceMap || {})}
Best formats: ${JSON.stringify(performanceModel.formatPerformanceMap || {})}`
    : "No historical data available.";

  const recentContext = recentTopics?.length
    ? `Recent content topics (avoid repetition): ${recentTopics.join(", ")}`
    : "";

  const message = await anthropic.messages.create({
    model: "claude-sonnet-4-20250514",
    max_tokens: 1024,
    messages: [
      {
        role: "user",
        content: `You are a content strategist. Suggest 5 new content ideas based on performance data.

${modelContext}
${recentContext}

Return a JSON array with this structure:
[
  {
    "title": "Compelling content idea title",
    "description": "1-2 sentence description of the content",
    "topicTags": ["tag1", "tag2"],
    "contentType": "article",
    "predictedScore": 75,
    "reasoning": "Brief explanation of why this would perform well"
  }
]

Rules:
- Suggest 5 diverse ideas spanning different topics and formats
- contentType must be one of: article, video, graphic, thread, newsletter, podcast
- Prioritize topics that historically performed well
- Include a mix of safe bets and creative risks
- predictedScore range: 0-100
- Return ONLY the JSON array`,
      },
    ],
  });

  const text = message.content[0].type === "text" ? message.content[0].text : "[]";

  try {
    const match = text.match(/\[[\s\S]*\]/);
    const suggestions = match ? JSON.parse(match[0]) : [];
    return NextResponse.json({ suggestions });
  } catch {
    return NextResponse.json({ suggestions: [] });
  }
}

// Generate promotional social media drafts per platform from content
async function handlePromoDrafts(body: any) {
  const { title, bodyContent, platforms } = body;

  const platformList = (platforms || ["twitter", "linkedin", "instagram"]).join(", ");

  const platformGuidelines: Record<string, string> = {
    twitter: "Twitter/X (280 chars max): Punchy, concise, hook-first. 1-2 hashtags inline.",
    instagram: "Instagram (2200 chars max): Engaging caption, line breaks for readability, 5-10 hashtags at end, emojis welcome.",
    linkedin: "LinkedIn (3000 chars max): Professional storytelling, lessons/takeaways, short paragraphs, 2-3 hashtags max at end.",
    facebook: "Facebook: Conversational, question-driven for engagement, medium length.",
    tiktok: "TikTok: Very casual, trendy, short, reference trends naturally.",
    bluesky: "Bluesky (300 chars max): Concise, conversational, similar to Twitter.",
    threads: "Threads (500 chars max): Conversational, Instagram-adjacent audience.",
  };

  const guides = (platforms || ["twitter", "linkedin", "instagram"])
    .map((p: string) => platformGuidelines[p.toLowerCase()] || `${p}: Adapt appropriately.`)
    .join("\n");

  const message = await anthropic.messages.create({
    model: "claude-sonnet-4-20250514",
    max_tokens: 2048,
    messages: [
      {
        role: "user",
        content: `You are a social media promotion expert. Generate one promotional social media draft for EACH platform below, based on this content piece.

Content Title: ${title}
Content Body/Summary: ${bodyContent || "No body content provided — generate based on the title alone."}

Target platforms and guidelines:
${guides}

Return a JSON array with this exact structure:
[
  {
    "platform": "twitter",
    "content": "The full post text ready to publish",
    "characterCount": 142
  }
]

Rules:
- Generate exactly ONE draft per platform listed: ${platformList}
- Each draft should promote/tease the content piece, driving interest
- Include a hook in the first line of each draft
- Vary the approach per platform (don't just shorten/lengthen the same text)
- Include relevant emojis naturally
- Respect each platform's character limits
- Include hashtags according to each platform's conventions
- characterCount must be the actual character count of the content field
- Return ONLY the JSON array, no explanations`,
      },
    ],
  });

  const text = message.content[0].type === "text" ? message.content[0].text : "[]";

  try {
    const match = text.match(/\[[\s\S]*\]/);
    const drafts = match ? JSON.parse(match[0]) : [];
    return NextResponse.json({ drafts });
  } catch {
    return NextResponse.json({ drafts: [] });
  }
}

// Generate long-form content for the content editor (articles, scripts, etc.)
async function handleGenerateContent(body: any) {
  try {
    const {
      contentType,
      contentTypeName,
      title,
      brief,
      topicTags,
      customerName,
      ideaTitle,
      customPrompt,
      tone,
      length,
      additionalInstructions,
      documentTemplates,
    } = body;

    const typeName = contentTypeName || contentType || "written";

    // Build system prompt — use custom prompt from settings or smart default
    const defaultSystemPrompt = `You are an expert editor and subject-matter authority with decades of experience producing exceptional ${typeName} content. You combine deep topic expertise with masterful writing craft.

Your writing demonstrates:
- Authoritative knowledge that builds reader trust
- Engaging structure with strong hooks and clear flow
- Perfect adaptation to the target audience
- Publication-ready quality requiring minimal editing
- Rich detail, concrete examples, and actionable insights

Write as the expert you are — not as an AI assistant. Never start with "In today's..." or other cliched openings. Never refer to yourself. Just produce excellent content.`;

    // Interpolate variables in custom prompt if provided
    let systemPrompt = defaultSystemPrompt;
    if (customPrompt && customPrompt.trim()) {
      systemPrompt = customPrompt
        .replace(/\{content_type\}/gi, typeName)
        .replace(/\{title\}/gi, title || "")
        .replace(/\{brief\}/gi, brief || "")
        .replace(/\{topics\}/gi, (topicTags || []).join(", "))
        .replace(/\{customer\}/gi, customerName || "");
    }

    // Build tone guidance
    const toneGuides: Record<string, string> = {
      professional: "Use a professional, polished tone. Authoritative and clear.",
      casual: "Use a casual, friendly, conversational tone. Approachable and warm.",
      engaging: "Use a highly engaging tone with strong hooks, vivid language, and compelling storytelling.",
      authoritative: "Use an authoritative, expert tone. Confident, data-driven, thought-leadership style.",
      conversational: "Use a conversational, relatable tone. Write as if speaking to a knowledgeable peer.",
    };
    const toneGuide = toneGuides[tone] || toneGuides.professional;

    // Build length guidance
    const lengthGuides: Record<string, string> = {
      brief: "Keep it concise — approximately 300 words. Hit the key points efficiently.",
      standard: "Write a thorough piece — approximately 600 words. Cover the topic well with good structure.",
      detailed: "Write a comprehensive, in-depth piece — approximately 1000+ words. Include sections, subheadings, and detailed coverage.",
    };
    const lengthGuide = lengthGuides[length] || lengthGuides.standard;

    // Assemble user prompt from all available context
    const contextParts: string[] = [];
    contextParts.push(`Content Type: ${typeName}`);
    if (title) contextParts.push(`Title: ${title}`);
    if (brief) contextParts.push(`Brief/Description: ${brief}`);
    if (topicTags?.length > 0) contextParts.push(`Topics: ${topicTags.join(", ")}`);
    if (customerName) contextParts.push(`Client: ${customerName}`);
    if (ideaTitle && ideaTitle !== title) contextParts.push(`Original Idea: ${ideaTitle}`);

    // Add document template context if available
    if (documentTemplates && documentTemplates.length > 0) {
      const templateInfo = documentTemplates
        .map((dt: any) => `- ${dt.key} (${dt.documentTarget || "body"})`)
        .join("\n");
      contextParts.push(`\nThis content type uses document templates:\n${templateInfo}\nThe output will be pasted into a Google Doc that follows these template structures. Match the expected format and sections of the template.`);
    }

    const userPrompt = `Write ${typeName} content based on the following:

${contextParts.join("\n")}

Tone: ${toneGuide}
Length: ${lengthGuide}
${additionalInstructions ? `\nAdditional instructions: ${additionalInstructions}` : ""}

Rules:
- Output well-structured HTML suitable for pasting into a Google Doc (use <h2>, <h3>, <p>, <ul>, <li>, <strong>, <em> tags)
- Start with a compelling opening — no generic introductions
- Use subheadings to break up the content
- Include specific examples, data points, or actionable advice where relevant
- End with a strong conclusion or call to action
- Do NOT wrap in <html>, <head>, or <body> tags — just the content HTML
- Do NOT include the title as an <h1> — it's already shown above the editor`;

    const message = await anthropic.messages.create({
      model: "claude-sonnet-4-20250514",
      max_tokens: 4096,
      messages: [
        { role: "user", content: `${systemPrompt}\n\n${userPrompt}` },
      ],
    });

    const content =
      message.content[0].type === "text" ? message.content[0].text : "";

    return NextResponse.json({ content: content.trim() });
  } catch (error: any) {
    console.error("Generate content error:", error.message || error);
    return NextResponse.json(
      { error: error.message || "Failed to generate content" },
      { status: 500 }
    );
  }
}

// Research topics — gather themes, talking points, data angles for a content piece
async function handleResearchTopics(body: any) {
  try {
    const { title, brief, contentType, topicTags } = body;

    const message = await anthropic.messages.create({
      model: "claude-sonnet-4-20250514",
      max_tokens: 2048,
      messages: [
        {
          role: "user",
          content: `You are a senior content researcher. Research this content topic and provide structured findings to inform a writer.

Title: ${title || "Untitled"}
Content Type: ${contentType || "article"}
Brief: ${brief || "No brief provided"}
Topics: ${(topicTags || []).join(", ") || "none"}

Return a JSON object with this exact structure:
{
  "themes": [
    { "id": "theme-1", "name": "Theme name", "description": "One sentence description" }
  ],
  "talkingPoints": [
    { "id": "tp-1", "point": "A specific talking point or argument to make", "why": "Brief reason this matters" }
  ],
  "dataPoints": [
    { "id": "dp-1", "stat": "A relevant statistic or data point", "context": "Where this might come from or how to verify" }
  ],
  "angles": [
    { "id": "angle-1", "name": "Angle name", "description": "How to approach the topic from this angle" }
  ]
}

Rules:
- Provide 3-5 items in each category
- Be specific and actionable — not generic
- Themes should be distinct content themes within the topic
- Talking points should be concrete arguments or points to make
- Data points should be plausible statistics or facts (note they should be verified)
- Angles should be distinct editorial approaches
- Return ONLY the JSON object`,
        },
      ],
    });

    const text = message.content[0].type === "text" ? message.content[0].text : "{}";
    try {
      const match = text.match(/\{[\s\S]*\}/);
      return NextResponse.json(match ? JSON.parse(match[0]) : { themes: [], talkingPoints: [], dataPoints: [], angles: [] });
    } catch {
      return NextResponse.json({ themes: [], talkingPoints: [], dataPoints: [], angles: [] });
    }
  } catch (error: any) {
    return NextResponse.json({ error: error.message || "Research failed" }, { status: 500 });
  }
}

// Suggest themed writing angles based on research
async function handleSuggestThemes(body: any) {
  try {
    const { title, brief, research, contentType } = body;

    const researchContext = research
      ? `Research findings:\n${JSON.stringify(research, null, 2)}`
      : "No prior research available.";

    const message = await anthropic.messages.create({
      model: "claude-sonnet-4-20250514",
      max_tokens: 1024,
      messages: [
        {
          role: "user",
          content: `You are a senior content strategist. Suggest 5-6 distinct editorial themes/angles for this content piece.

Title: ${title || "Untitled"}
Content Type: ${contentType || "article"}
Brief: ${brief || "No brief provided"}
${researchContext}

Return a JSON array with this structure:
[
  {
    "id": "theme-1",
    "name": "Theme Name (3-5 words)",
    "description": "One sentence describing the angle",
    "approach": "2-3 sentences on how to execute this approach — what to emphasize, structure suggestions, tone"
  }
]

Rules:
- Suggest 5-6 DISTINCT themes — each must take a genuinely different approach
- Include a mix: data-driven, narrative, contrarian, practical/how-to, trend-based, opinion
- Be specific to this topic, not generic
- Return ONLY the JSON array`,
        },
      ],
    });

    const text = message.content[0].type === "text" ? message.content[0].text : "[]";
    try {
      const match = text.match(/\[[\s\S]*\]/);
      return NextResponse.json({ themes: match ? JSON.parse(match[0]) : [] });
    } catch {
      return NextResponse.json({ themes: [] });
    }
  } catch (error: any) {
    return NextResponse.json({ error: error.message || "Theme suggestion failed" }, { status: 500 });
  }
}

// Fact-check content — scan for claims and flag unverifiable ones
async function handleFactCheck(body: any) {
  try {
    const { content } = body;

    const message = await anthropic.messages.create({
      model: "claude-sonnet-4-20250514",
      max_tokens: 2048,
      messages: [
        {
          role: "user",
          content: `You are a rigorous fact-checker and editor. Analyze this content for factual claims and assess their verifiability.

Content:
${content}

Return a JSON object with this exact structure:
{
  "claims": [
    {
      "claim": "The specific claim made in the content",
      "status": "verified" | "likely_accurate" | "unverifiable" | "needs_source" | "potentially_inaccurate",
      "note": "Brief explanation of why this status was assigned and what to check"
    }
  ],
  "overallScore": 85,
  "summary": "One paragraph summary of the content's factual reliability"
}

Rules:
- Extract ALL factual claims (statistics, dates, named facts, causal claims)
- Be thorough — check every assertion that presents something as fact
- overallScore is 0-100 (100 = all claims verified, 0 = all claims problematic)
- For "verified" claims, note the common knowledge basis
- For "needs_source" claims, suggest what source could verify it
- For "potentially_inaccurate" claims, explain what seems wrong
- Strip HTML tags when quoting claims
- Return ONLY the JSON object`,
        },
      ],
    });

    const text = message.content[0].type === "text" ? message.content[0].text : "{}";
    try {
      const match = text.match(/\{[\s\S]*\}/);
      return NextResponse.json(match ? JSON.parse(match[0]) : { claims: [], overallScore: 0, summary: "" });
    } catch {
      return NextResponse.json({ claims: [], overallScore: 0, summary: "Unable to analyze content." });
    }
  } catch (error: any) {
    return NextResponse.json({ error: error.message || "Fact check failed" }, { status: 500 });
  }
}

// Detect AI-written patterns in content
async function handleDetectAi(body: any) {
  try {
    const { content } = body;

    const message = await anthropic.messages.create({
      model: "claude-sonnet-4-20250514",
      max_tokens: 1024,
      messages: [
        {
          role: "user",
          content: `You are an expert in detecting AI-generated writing patterns. Analyze this content for signs of AI authorship and suggest improvements to make it sound more authentically human.

Content:
${content}

Return a JSON object with this exact structure:
{
  "score": 65,
  "verdict": "likely_ai" | "mixed" | "likely_human",
  "flags": [
    {
      "text": "The specific phrase or pattern flagged",
      "reason": "Why this feels AI-generated"
    }
  ],
  "suggestions": [
    "Specific, actionable suggestion to make the content sound more human"
  ]
}

Rules:
- score is 0-100 where 0 = definitely human, 100 = definitely AI
- Look for: overly perfect structure, formulaic transitions, lack of personal voice, hedging language, "delve/landscape/tapestry/leverage/utilize" words, lists of exactly 3-5 items, generic conclusions
- flags should quote specific passages (strip HTML tags)
- suggestions should be concrete and actionable (not generic advice)
- Provide 3-6 flags and 3-5 suggestions
- Return ONLY the JSON object`,
        },
      ],
    });

    const text = message.content[0].type === "text" ? message.content[0].text : "{}";
    try {
      const match = text.match(/\{[\s\S]*\}/);
      return NextResponse.json(match ? JSON.parse(match[0]) : { score: 0, verdict: "mixed", flags: [], suggestions: [] });
    } catch {
      return NextResponse.json({ score: 0, verdict: "mixed", flags: [], suggestions: [] });
    }
  } catch (error: any) {
    return NextResponse.json({ error: error.message || "AI detection failed" }, { status: 500 });
  }
}
