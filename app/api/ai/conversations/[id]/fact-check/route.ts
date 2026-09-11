import { NextRequest } from "next/server";
import { auth } from "@/lib/auth";
import { intelligenceDb } from "@/lib/supabase-intelligence";
import { logAiUsage } from "@/lib/ai/usage-logger";
import { checkConversationAccess } from "@/lib/ai/access";
import { createStreamingResponse, type AIMessage } from "@/lib/ai/providers";

export const maxDuration = 120;

const FACT_CHECK_SYSTEM_PROMPT = `You are a precise fact-checker. Your job is to verify the factual claims in an AI-generated response using web search.

Instructions:
1. Read the AI response carefully and identify ALL verifiable factual claims (dates, statistics, names, events, regulatory details, company information, scientific claims, etc.)
2. Use web search to verify each claim against reliable sources
3. For each claim, mark it as:
   - ✅ **Verified** — confirmed by reliable sources
   - ⚠️ **Unverified** — could not find reliable sources to confirm or deny
   - ❌ **Incorrect** — contradicted by reliable sources
4. For EVERY claim, you MUST include a working URL to the source you used to verify it. This is critical — fact checking without sources is useless.
5. Skip subjective opinions, recommendations, and general advice — only check verifiable facts
6. If the response contains no verifiable factual claims, say so

CRITICAL: Every verified or incorrect claim MUST include at least one clickable source URL. Use the actual URLs from your web search results. Never fabricate URLs.

Format your response as:

## Fact Check

**Summary**: X verified, Y unverified, Z incorrect out of N claims checked

### Claims

1. **"[Exact claim text]"**
   ✅ Verified — [brief evidence]
   Source: [Source Name](https://actual-url-from-search.com)

2. **"[Exact claim text]"**
   ❌ Incorrect — [what's actually correct]
   Source: [Source Name](https://actual-url-from-search.com)

3. **"[Exact claim text]"**
   ⚠️ Unverified — [why it couldn't be verified, what you searched for]

### Corrections
[Only include this section if there are incorrect claims. Provide the corrected information clearly so the user can update their content.]

### Sources
[List all unique sources used, formatted as clickable markdown links]
- [Source Name](https://url)
- [Source Name](https://url)`;

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await auth();
  if (!session?.user?.id) {
    return new Response(JSON.stringify({ error: "Unauthorized" }), { status: 401 });
  }

  const userId = parseInt(session.user.id, 10);
  const { id: conversationId } = await params;

  try {
    const { messageContent, userQuestion } = await req.json();

    if (!messageContent?.trim()) {
      return new Response(
        JSON.stringify({ error: "Message content required" }),
        { status: 400 }
      );
    }

    // Fetch conversation
    const { data: conversation } = await intelligenceDb
      .from("ai_conversations")
      .select("*")
      .eq("id_conversation", conversationId)
      .maybeSingle();

    if (!conversation) {
      return new Response(JSON.stringify({ error: "Not found" }), { status: 404 });
    }

    // Verify access
    const access = await checkConversationAccess(conversationId, userId, {
      visibility: conversation.type_visibility,
      userCreated: conversation.user_created,
      workspaceId: conversation.id_workspace,
    });

    if (!access.allowed) {
      return new Response(JSON.stringify({ error: "Forbidden" }), { status: 403 });
    }
    // A VIEW-only share recipient must not write here: this route INSERTS an
    // assistant message into someone else's thread, and runs with
    // preserveLinks so model-authored URLs survive the fabricated-link strip.
    if (access.permission === "view") {
      return new Response(JSON.stringify({ error: "Read-only access to this conversation" }), { status: 403 });
    }

    // Build fact-check message — include user's original question for context
    const messages: AIMessage[] = [
      {
        role: "user",
        content: userQuestion
          ? `The user asked: "${userQuestion}"\n\nThe AI responded with:\n\n---\n${messageContent}\n---\n\nPlease fact-check the AI's response above. Identify and verify all factual claims.`
          : `Please fact-check the following AI response:\n\n---\n${messageContent}\n---\n\nIdentify and verify all factual claims.`,
      },
    ];

    // Use Claude with web_search tool for fact-checking — only model that returns real source URLs
    const aiStream = createStreamingResponse(
      messages,
      {
        model: "claude-sonnet-5",
        systemPrompt: FACT_CHECK_SYSTEM_PROMPT,
        maxTokens: 4096,
        webSearch: true,
        imageGeneration: false,
        temperature: 0.2,
        preserveLinks: true,
      },
      async ({ fullText, inputTokens, outputTokens, cacheReadTokens, cacheWriteTokens, modelUsed }) => {
        // LOG THE SPEND, FIRST AND UNCONDITIONALLY.
        //
        // This route called no usage logger at all. It runs Sonnet 5 at 4,096
        // output tokens with webSearch ON — and Anthropic bills the web_search
        // tool PER SEARCH, on top of tokens — so fact-check was billable spend
        // on the live chat surface that appeared nowhere in intelligence.ai_usage
        // and counted toward no cap. Same shape as the voice faults fixed on
        // 2026-08-24: the guard existed, the data it needed was never produced.
        //
        // Before the incognito branch on purpose: incognito suppresses storing
        // the user's WORDS, which is a privacy promise. It was never a promise
        // not to bill, and an unlogged cost is not a privacy feature. Nothing
        // here carries conversation text — model id, token counts, ids.
        logAiUsage({
          workspaceId: conversation.id_workspace,
          userId,
          // modelUsed, not the literal below: an Anthropic failure falls back
          // to grok-4.3, and pricing that at Sonnet's rate is a 4x output error.
          model: modelUsed,
          source: "fact-check",
          inputTokens: inputTokens || 0,
          outputTokens: outputTokens || 0,
          cacheReadTokens: cacheReadTokens || 0,
          cacheWriteTokens: cacheWriteTokens || 0,
        });

        // Save as assistant message (unless incognito)
        if (!conversation.flag_incognito && fullText.trim()) {
          await intelligenceDb.from("ai_messages").insert({
            id_conversation: conversationId,
            role_message: "assistant",
            document_message: fullText,
            name_model: modelUsed,
          });

          await intelligenceDb
            .from("ai_conversations")
            .update({ date_updated: new Date().toISOString() })
            .eq("id_conversation", conversationId);
        }
      }
    );

    return new Response(aiStream, {
      headers: {
        "Content-Type": "text/event-stream; charset=utf-8",
        "Cache-Control": "no-cache",
        Connection: "keep-alive",
      },
    });
  } catch (error: any) {
    console.error("[Fact Check] Error:", error?.message);
    return new Response(
      JSON.stringify({ error: error?.message || "Fact check failed" }),
      { status: 500 }
    );
  }
}
