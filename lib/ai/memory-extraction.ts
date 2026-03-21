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
import { logAiUsage } from "@/lib/ai/usage-logger";
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

    logAiUsage({ model: "grok-3-mini", source: "memory-extract", inputTokens: response.usage?.prompt_tokens || 0, outputTokens: response.usage?.completion_tokens || 0 });

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

// ── Meeting-specific memory extraction ──

const MEETING_EXTRACTION_PROMPT = `You are a memory extractor for an AI content assistant. Analyse the meeting data below and identify important facts, preferences, patterns, instructions, or client insights that would be useful to remember across future conversations.

Categories (use exactly these):
- preference: Preferences expressed by the user or their clients during the meeting
- fact: Factual information about the user's business, clients, team, or industry
- instruction: Standing instructions, decisions, or commitments made in this meeting
- style: Communication style, tone, or approach preferences revealed
- client_insight: Information about specific clients — their preferences, feedback, concerns, industry position, or strategic direction

Rules:
1. Only extract genuinely useful, specific, reusable information
2. Focus on PATTERNS and DURABLE facts, not ephemeral meeting logistics
3. Do NOT extract specific dates, times, or one-off scheduling details
4. Do NOT extract information already in the existing memories list
5. Each memory should be a concise, standalone statement (1-2 sentences max)
6. Assign a confidence score 0-1 (only items >= 0.7 are worthwhile)
7. Return 0-5 memories maximum. Most meetings will produce 1-3.
8. Insights tagged strategic, risk, or opportunity are particularly valuable as memories
9. If attendees or context suggest a specific client, use the "client_insight" category
10. Return valid JSON only, no markdown fences

Existing memories (do NOT duplicate):
{EXISTING_MEMORIES}

Return format:
{"memories": [{"content": "...", "category": "...", "confidence": 0.85}]}

If nothing noteworthy, return: {"memories": []}`;

export interface MeetingMemoryInput {
  meetingTitle: string;
  meetingDate: string;
  attendees?: string[];
  clientName?: string;
  summary: string;
  keyTopics?: string[];
  nextSteps?: string;
  insights?: { type: string; content: string }[];
  coachingNotes?: string;
}

/**
 * Extract memories from structured meeting data.
 * Optimised for meeting outcomes (summaries, topics, insights) rather than
 * user-assistant conversation exchanges.
 *
 * Returns 0-5 candidates (meetings are denser than single chat exchanges).
 */
export async function extractMeetingMemories(
  meeting: MeetingMemoryInput,
  existingMemories: string[]
): Promise<MemorySuggestion[]> {
  try {
    const xai = getXAIClient();

    // Compose meeting content as a text block
    const parts: string[] = [];
    parts.push(`Meeting: ${meeting.meetingTitle}`);
    parts.push(`Date: ${meeting.meetingDate}`);
    if (meeting.attendees && meeting.attendees.length > 0) {
      parts.push(`Attendees: ${meeting.attendees.slice(0, 15).join(", ")}`);
    }
    if (meeting.clientName) {
      parts.push(`Client: ${meeting.clientName}`);
    }
    parts.push("");
    parts.push(`Summary:\n${meeting.summary}`);

    if (meeting.keyTopics && meeting.keyTopics.length > 0) {
      parts.push(`\nKey Topics: ${meeting.keyTopics.join(", ")}`);
    }
    if (meeting.nextSteps) {
      parts.push(`\nNext Steps:\n${meeting.nextSteps}`);
    }
    if (meeting.insights && meeting.insights.length > 0) {
      const insightLines = meeting.insights
        .map((i) => `[${i.type}] ${i.content}`)
        .join("\n");
      parts.push(`\nInsights:\n${insightLines}`);
    }
    if (meeting.coachingNotes) {
      parts.push(`\nCoaching Notes:\n${meeting.coachingNotes}`);
    }

    const meetingText = parts.join("\n");

    const existingList =
      existingMemories.length > 0
        ? existingMemories.map((m) => `- ${m}`).join("\n")
        : "(none yet)";

    const systemPrompt = MEETING_EXTRACTION_PROMPT.replace(
      "{EXISTING_MEMORIES}",
      existingList
    );

    const response = await xai.chat.completions.create({
      model: "grok-3-mini",
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: meetingText.slice(0, 4000) },
      ],
      max_tokens: 600,
      temperature: 0.3,
    });

    logAiUsage({ model: "grok-3-mini", source: "memory-extract-meeting", inputTokens: response.usage?.prompt_tokens || 0, outputTokens: response.usage?.completion_tokens || 0 });

    const raw = response.choices?.[0]?.message?.content?.trim();
    if (!raw) return [];

    const jsonStr = raw.replace(/^```json?\s*/, "").replace(/```\s*$/, "");
    const parsed = JSON.parse(jsonStr);

    if (!parsed.memories || !Array.isArray(parsed.memories)) return [];

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
      .slice(0, 5)
      .map((m: any) => ({
        content: m.content.slice(0, 500),
        category: m.category,
        confidence: m.confidence,
      }));
  } catch (err) {
    console.error("[Memory] Meeting extraction failed:", err);
    return [];
  }
}

// ── Task completion memory extraction ──

const TASK_EXTRACTION_PROMPT = `You are a memory extractor for an AI content assistant. A task has been completed. Analyse it and identify any useful facts, client insights, or patterns worth remembering for future conversations.

Categories (use exactly these):
- fact: Factual information about the user's business, projects, or deliverables
- client_insight: Information about specific clients — what was delivered, their requirements, or working patterns
- preference: Preferences about how the user or their clients like things done
- instruction: Standing decisions or processes that emerged from this work

Rules:
1. Only extract genuinely useful, durable information — NOT the task itself
2. Focus on what this completion REVEALS about the user's work, clients, or business
3. Do NOT just restate the task title — extract the underlying insight
4. Do NOT extract trivial or routine tasks (e.g. "replied to email", "attended meeting")
5. Each memory should be a concise, standalone statement (1-2 sentences max)
6. Assign a confidence score 0-1 (only items >= 0.7 are worthwhile)
7. Return 0-2 memories maximum. Most tasks will produce 0.
8. Return valid JSON only, no markdown fences

Existing memories (do NOT duplicate):
{EXISTING_MEMORIES}

Return format:
{"memories": [{"content": "...", "category": "...", "confidence": 0.85}]}

If nothing noteworthy, return: {"memories": []}`;

export interface TaskMemoryInput {
  taskTitle: string;
  taskDescription?: string;
  projectName?: string;
  meetingSource?: string;
  responsible?: string;
}

/**
 * Extract memories from a completed task.
 * Much lighter than meeting extraction — most tasks produce 0 memories.
 * Only tasks tied to client work or strategic decisions yield anything.
 *
 * Returns 0-2 candidates.
 */
export async function extractTaskMemories(
  task: TaskMemoryInput,
  existingMemories: string[]
): Promise<MemorySuggestion[]> {
  try {
    const xai = getXAIClient();

    const parts: string[] = [];
    parts.push(`Completed task: ${task.taskTitle}`);
    if (task.taskDescription) {
      parts.push(`Description: ${task.taskDescription}`);
    }
    if (task.projectName) {
      parts.push(`Project: ${task.projectName}`);
    }
    if (task.meetingSource) {
      parts.push(`From meeting: ${task.meetingSource}`);
    }
    if (task.responsible) {
      parts.push(`Responsible: ${task.responsible}`);
    }

    const taskText = parts.join("\n");

    const existingList =
      existingMemories.length > 0
        ? existingMemories.map((m) => `- ${m}`).join("\n")
        : "(none yet)";

    const systemPrompt = TASK_EXTRACTION_PROMPT.replace(
      "{EXISTING_MEMORIES}",
      existingList
    );

    const response = await xai.chat.completions.create({
      model: "grok-3-mini",
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: taskText.slice(0, 2000) },
      ],
      max_tokens: 400,
      temperature: 0.3,
    });

    logAiUsage({ model: "grok-3-mini", source: "memory-extract-task", inputTokens: response.usage?.prompt_tokens || 0, outputTokens: response.usage?.completion_tokens || 0 });

    const raw = response.choices?.[0]?.message?.content?.trim();
    if (!raw) return [];

    const jsonStr = raw.replace(/^```json?\s*/, "").replace(/```\s*$/, "");
    const parsed = JSON.parse(jsonStr);

    if (!parsed.memories || !Array.isArray(parsed.memories)) return [];

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
      .slice(0, 2)
      .map((m: any) => ({
        content: m.content.slice(0, 500),
        category: m.category,
        confidence: m.confidence,
      }));
  } catch (err) {
    console.error("[Memory] Task extraction failed:", err);
    return [];
  }
}
