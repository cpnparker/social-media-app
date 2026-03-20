import { NextRequest } from "next/server";
import { auth } from "@/lib/auth";
import { intelligenceDb } from "@/lib/supabase-intelligence";
import { checkConversationAccess } from "@/lib/ai/access";
import { createStreamingResponse, type AIMessage } from "@/lib/ai/providers";

export const maxDuration = 120;

const FACT_CHECK_SYSTEM_PROMPT = `You are a precise fact-checker. Your job is to verify the factual claims in an AI-generated response.

Instructions:
1. Read the AI response carefully and identify ALL verifiable factual claims (dates, statistics, names, events, regulatory details, company information, scientific claims, etc.)
2. Use web search to verify each claim against reliable sources
3. For each claim, mark it as:
   - ✅ **Verified** — confirmed by reliable sources
   - ⚠️ **Unverified** — could not find reliable sources to confirm or deny
   - ❌ **Incorrect** — contradicted by reliable sources
4. Provide brief evidence or corrections for each claim, citing your sources
5. Skip subjective opinions, recommendations, and general advice — only check verifiable facts
6. If the response contains no verifiable factual claims, say so

Format your response as:

## 🔍 Fact Check

**Summary**: X verified, Y unverified, Z incorrect out of N claims checked

### Claims

1. **"[Exact claim text]"**
   ✅ Verified — [brief evidence with source]

2. **"[Exact claim text]"**
   ❌ Incorrect — [what's actually correct + source]

3. **"[Exact claim text]"**
   ⚠️ Unverified — [why it couldn't be verified]

### Corrections
[Only include this section if there are incorrect claims. Provide the corrected information clearly so the user can update their content.]`;

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

    // Build fact-check message — include user's original question for context
    const messages: AIMessage[] = [
      {
        role: "user",
        content: userQuestion
          ? `The user asked: "${userQuestion}"\n\nThe AI responded with:\n\n---\n${messageContent}\n---\n\nPlease fact-check the AI's response above. Identify and verify all factual claims.`
          : `Please fact-check the following AI response:\n\n---\n${messageContent}\n---\n\nIdentify and verify all factual claims.`,
      },
    ];

    // Always use Claude with web search for fact-checking
    const aiStream = createStreamingResponse(
      messages,
      {
        model: "claude-sonnet-4-6",
        systemPrompt: FACT_CHECK_SYSTEM_PROMPT,
        maxTokens: 4096,
        webSearch: true,
        imageGeneration: false,
        temperature: 0.2,
        preserveLinks: true,
      },
      async ({ fullText }) => {
        // Save as assistant message (unless incognito)
        if (!conversation.flag_incognito && fullText.trim()) {
          await intelligenceDb.from("ai_messages").insert({
            id_conversation: conversationId,
            role_message: "assistant",
            document_message: fullText,
            name_model: "claude-sonnet-4-6",
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
