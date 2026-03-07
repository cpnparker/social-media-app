/**
 * Memory extraction engine.
 *
 * After each AI response, analyses the latest user–assistant exchange
 * with a fast/cheap model (grok-3-mini) to extract candidate memories.
 * Returns structured suggestions that the client presents for user approval.
 *
 * Cost: ~$0.00001 per extraction call (negligible).
 */

import OpenAI from "openai";
import type { MemorySuggestion } from "@/lib/types/ai";

function getXAIClient() {
  if (!process.env.XAI_API_KEY) {
    throw new Error("XAI_API_KEY is not set");
  }
  return new OpenAI({
    apiKey: process.env.XAI_API_KEY,
    baseURL: "https://api.x.ai/v1",
  });
}

const EXTRACTION_PROMPT = `You are a memory extractor for an AI content assistant. Analyse the conversation exchange below and identify important facts, preferences, instructions, or insights that would be useful to remember for future conversations.

Categories (use exactly these):
- preference: User's stated preferences (tone, format, style, language choices)
- fact: Factual information about the user, their role, or their business
- instruction: Standing instructions for how the AI should behave
- style: Writing style preferences and guidelines
- client_insight: Information about the user's clients, their preferences, or industry

Rules:
1. Only extract genuinely useful, specific, reusable information
2. Do NOT extract trivial or one-off facts (e.g. "user asked about weather")
3. Do NOT extract information that is already in the existing memories list
4. Each memory should be a concise, standalone statement (1-2 sentences max)
5. Assign a confidence score 0-1 (only items >= 0.7 are worthwhile)
6. Return 0-3 memories maximum. Most exchanges will have 0.
7. Return valid JSON only, no markdown fences

Existing memories (do NOT duplicate):
{EXISTING_MEMORIES}

Return format:
{"memories": [{"content": "...", "category": "...", "confidence": 0.85}]}

If nothing noteworthy, return: {"memories": []}`;

export async function extractMemories(
  userMessage: string,
  assistantResponse: string,
  existingMemories: string[]
): Promise<MemorySuggestion[]> {
  try {
    const xai = getXAIClient();

    const existingList =
      existingMemories.length > 0
        ? existingMemories.map((m) => `- ${m}`).join("\n")
        : "(none yet)";

    const systemPrompt = EXTRACTION_PROMPT.replace(
      "{EXISTING_MEMORIES}",
      existingList
    );

    const response = await xai.chat.completions.create({
      model: "grok-3-mini",
      messages: [
        { role: "system", content: systemPrompt },
        {
          role: "user",
          content: `User message:\n${userMessage.slice(0, 2000)}\n\nAssistant response:\n${assistantResponse.slice(0, 3000)}`,
        },
      ],
      max_tokens: 500,
      temperature: 0.3,
    });

    const raw = response.choices?.[0]?.message?.content?.trim();
    if (!raw) return [];

    // Parse JSON, handling potential markdown fences
    const jsonStr = raw.replace(/^```json?\s*/, "").replace(/```\s*$/, "");
    const parsed = JSON.parse(jsonStr);

    if (!parsed.memories || !Array.isArray(parsed.memories)) return [];

    // Filter to high-confidence suggestions, cap at 3
    const validCategories = [
      "preference",
      "fact",
      "instruction",
      "style",
      "client_insight",
    ];

    return parsed.memories
      .filter(
        (m: any) =>
          m.content &&
          typeof m.content === "string" &&
          m.confidence >= 0.7 &&
          validCategories.includes(m.category)
      )
      .slice(0, 3)
      .map((m: any) => ({
        content: m.content.slice(0, 500),
        category: m.category,
        confidence: m.confidence,
      }));
  } catch (err) {
    console.error("[Memory] Extraction failed:", err);
    return [];
  }
}
