/**
 * Conversation summary engine.
 *
 * Generates and incrementally updates a running summary of each conversation.
 * Complements the atomic memory system by capturing the narrative arc — topics
 * discussed, decisions made, reasoning chains, and outstanding questions — that
 * individual memory extractions miss.
 *
 * Summaries are stored on the conversation row (document_summary) and used for:
 * 1. Context-window truncation in long conversations (>20 messages)
 * 2. Cross-conversation awareness (injecting past summaries into system prompt)
 *
 * Cost: ~$0.001 per summary generation (grok-4-1-fast).
 */

import OpenAI from "openai";
import { logAiUsage } from "@/lib/ai/usage-logger";
import { intelligenceDb } from "@/lib/supabase-intelligence";

function getXAIClient() {
  if (!process.env.XAI_API_KEY) {
    throw new Error("XAI_API_KEY is not set");
  }
  return new OpenAI({
    apiKey: process.env.XAI_API_KEY,
    baseURL: "https://api.x.ai/v1",
  });
}

// ── Trigger logic ──

/**
 * Returns true when the conversation has enough new messages to warrant
 * generating or updating a summary.
 *
 * First summary: after 10 messages (5 exchanges).
 * Updates: every 10 new messages after that.
 */
export function shouldUpdateSummary(
  currentMessageCount: number,
  lastSummaryMessageCount: number
): boolean {
  // First summary at 10 messages
  if (lastSummaryMessageCount === 0 && currentMessageCount >= 10) return true;
  // Subsequent updates every 10 messages
  if (lastSummaryMessageCount > 0 && currentMessageCount >= lastSummaryMessageCount + 10) return true;
  return false;
}

// ── Summary generation prompts ──

const GENERATE_PROMPT = `You are a conversation summariser for an AI content assistant. Create a concise summary of this conversation that captures:

1. **Key topics** discussed
2. **Decisions made** and the reasoning behind them
3. **Conclusions reached** through iteration
4. **Outstanding questions** or unresolved items
5. **Action items** or next steps mentioned
6. **Important context** that would help understand this conversation if returning to it later
7. **Content produced** — any images generated (describe what they showed), drafts written, or creative outputs, and how the user reacted to them (approved, requested changes, rejected)
8. **Iterative refinements** — what changed between versions and the current state of any ongoing creative work

Rules:
- Write in past tense, third-person perspective ("The user discussed...", "They decided...")
- Be concise but comprehensive — capture the narrative arc, not just topics
- Focus on WHAT was decided and WHY, not the back-and-forth process
- Include any specific names, numbers, or details that are important
- When images were generated, describe their content briefly (e.g. "an infographic showing top 10 superfoods with teal/blue styling")
- Keep to 400-600 tokens
- Return plain text only, no markdown headers or formatting`;

const UPDATE_PROMPT = `You are a conversation summariser for an AI content assistant. Below is the existing summary of a conversation, followed by new messages that have been added since the summary was last generated.

Update the summary to incorporate the new information. The updated summary should:

1. Preserve all important information from the existing summary
2. Integrate new topics, decisions, and conclusions
3. Update any items that were "outstanding" if they've been resolved
4. Add new action items or next steps
5. Maintain a coherent narrative flow
6. Track any new content produced (images, drafts) and user feedback on them

Rules:
- Write in past tense, third-person perspective
- Be concise but comprehensive — 400-600 tokens
- Don't just append — weave new information into the existing narrative
- If earlier conclusions were revised, reflect the final state
- When images were generated, briefly describe what they showed and how the user responded
- Return plain text only, no markdown headers or formatting

Existing summary:
{EXISTING_SUMMARY}`;

// ── Core functions ──

interface ConversationMessage {
  role: string;
  content: string;
}

/**
 * Generate a first-time summary from the full message history.
 * Used when a conversation reaches 10 messages and has no existing summary.
 */
export async function generateConversationSummary(
  messages: ConversationMessage[]
): Promise<string | null> {
  try {
    const xai = getXAIClient();

    // Build conversation text, capping at ~6000 chars to stay within model limits
    const conversationText = messages
      .map((m) => `${m.role === "user" ? "User" : "Assistant"}: ${m.content}`)
      .join("\n\n")
      .slice(0, 6000);

    const response = await xai.chat.completions.create({
      model: "grok-4-1-fast",
      messages: [
        { role: "system", content: GENERATE_PROMPT },
        { role: "user", content: conversationText },
      ],
      max_completion_tokens: 800,
      temperature: 0.3,
    });

    logAiUsage({ model: "grok-4-1-fast", source: "summary-generate", inputTokens: response.usage?.prompt_tokens || 0, outputTokens: response.usage?.completion_tokens || 0 });

    const summary = response.choices?.[0]?.message?.content?.trim();
    return summary || null;
  } catch (err) {
    console.error("[Summary] Generation failed:", err);
    return null;
  }
}

/**
 * Incrementally update an existing summary with new messages.
 * More efficient than regenerating from scratch — only processes new messages.
 */
export async function updateConversationSummary(
  existingSummary: string,
  newMessages: ConversationMessage[]
): Promise<string | null> {
  try {
    const xai = getXAIClient();

    const systemPrompt = UPDATE_PROMPT.replace(
      "{EXISTING_SUMMARY}",
      existingSummary
    );

    const newConversationText = newMessages
      .map((m) => `${m.role === "user" ? "User" : "Assistant"}: ${m.content}`)
      .join("\n\n")
      .slice(0, 4000);

    const response = await xai.chat.completions.create({
      model: "grok-4-1-fast",
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: `New messages:\n\n${newConversationText}` },
      ],
      max_completion_tokens: 800,
      temperature: 0.3,
    });

    logAiUsage({ model: "grok-4-1-fast", source: "summary-update", inputTokens: response.usage?.prompt_tokens || 0, outputTokens: response.usage?.completion_tokens || 0 });

    const summary = response.choices?.[0]?.message?.content?.trim();
    return summary || null;
  } catch (err) {
    console.error("[Summary] Update failed:", err);
    return null;
  }
}

// ── Background runner ──

/**
 * Fire-and-forget function called after the AI stream closes.
 * Checks if a summary update is needed, then generates or updates accordingly.
 */
export async function runBackgroundSummaryUpdate({
  conversationId,
  currentMessageCount,
  lastSummaryMessageCount,
  existingSummary,
}: {
  conversationId: string;
  currentMessageCount: number;
  lastSummaryMessageCount: number;
  existingSummary: string | null;
}): Promise<void> {
  if (!shouldUpdateSummary(currentMessageCount, lastSummaryMessageCount)) {
    return;
  }

  // Fetch messages for summary generation
  const { data: messageRows } = await intelligenceDb
    .from("ai_messages")
    .select("role_message, document_message")
    .eq("id_conversation", conversationId)
    .order("date_created", { ascending: true });

  if (!messageRows || messageRows.length === 0) return;

  const allMessages: ConversationMessage[] = messageRows.map((m: any) => ({
    role: m.role_message,
    content: m.document_message,
  }));

  let newSummary: string | null = null;

  if (!existingSummary || lastSummaryMessageCount === 0) {
    // First summary: generate from all messages
    console.log(`[Summary] Generating first summary for conversation ${conversationId} (${allMessages.length} messages)`);
    newSummary = await generateConversationSummary(allMessages);
  } else {
    // Incremental update: pass only new messages since last summary
    const newMessages = allMessages.slice(lastSummaryMessageCount);
    if (newMessages.length === 0) return;

    console.log(`[Summary] Updating summary for conversation ${conversationId} (+${newMessages.length} new messages)`);
    newSummary = await updateConversationSummary(existingSummary, newMessages);
  }

  if (!newSummary) return;

  // Persist summary and message count
  const { error } = await intelligenceDb
    .from("ai_conversations")
    .update({
      document_summary: newSummary,
      units_summary_message_count: currentMessageCount,
    })
    .eq("id_conversation", conversationId);

  if (error) {
    console.error("[Summary] Failed to save summary:", error);
  } else {
    console.log(`[Summary] Saved summary for conversation ${conversationId} (${newSummary.length} chars, at ${currentMessageCount} messages)`);
  }
}

// ── Cross-conversation retrieval (Phase 2) ──

export interface ConversationSummaryContext {
  title: string;
  summary: string;
  updatedAt: string;
}

/**
 * Fetch summaries from recent related conversations for cross-conversation awareness.
 * Respects visibility: private summaries only available to the conversation owner.
 */
export async function fetchRelevantSummaries({
  workspaceId,
  clientId,
  userId,
  currentConversationId,
  limit = 3,
}: {
  workspaceId: string;
  clientId?: number | null;
  userId: number;
  currentConversationId: string;
  limit?: number;
}): Promise<ConversationSummaryContext[]> {
  try {
    // Privacy filter at DB level: only user's own private conversations + team conversations
    // Never returns other users' private conversations
    let query = intelligenceDb
      .from("ai_conversations")
      .select("name_conversation, document_summary, date_updated")
      .eq("id_workspace", workspaceId)
      .not("document_summary", "is", null)
      .neq("id_conversation", currentConversationId)
      .or(`and(type_visibility.eq.private,user_created.eq.${userId}),type_visibility.eq.team`)
      .order("date_updated", { ascending: false })
      .limit(limit);

    // If client-specific conversation, prioritise same-client conversations
    if (clientId) {
      query = query.eq("id_client", clientId);
    }

    const { data, error } = await query;

    if (error || !data) return [];

    return data.map((c: any) => ({
      title: c.name_conversation || "Untitled",
      summary: c.document_summary,
      updatedAt: c.date_updated,
    }));
  } catch (err) {
    console.error("[Summary] Failed to fetch relevant summaries:", err);
    return [];
  }
}
