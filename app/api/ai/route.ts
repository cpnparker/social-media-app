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
