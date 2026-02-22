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
