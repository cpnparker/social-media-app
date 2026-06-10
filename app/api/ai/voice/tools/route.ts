import { NextRequest, NextResponse } from "next/server";
import Anthropic from "@anthropic-ai/sdk";
import { auth } from "@/lib/auth";
import { supabase } from "@/lib/supabase";
import { intelligenceDb } from "@/lib/supabase-intelligence";
import { checkConversationAccess } from "@/lib/ai/access";
import { VOICE_TOOL_NAMES } from "@/lib/ai/voice";
import {
  queryEngine,
  lookupClientContext,
  searchMemory,
  queryMeetingBrain,
  querySlack,
  formatToolResult,
  formatMeetingBrainResult,
  formatSlackResult,
} from "@/lib/ai/providers";

export const maxDuration = 60;

// POST /api/ai/voice/tools — execute a function call emitted by the voice model.
// Body: { conversationId, name, arguments } (arguments = parsed object or JSON string)
// Returns: { output: string } to send back as function_call_output.
//
// Privacy: the same conversation-visibility gate as the text pipeline — in
// team threads, personal MeetingBrain reports and Slack are blocked inside
// queryMeetingBrain/querySlack via the visibility option.
export async function POST(req: NextRequest) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const userId = parseInt(session.user.id, 10);
  const userEmail = session.user.email || "";

  let body: any;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }
  const { conversationId, name } = body || {};
  let args = body?.arguments ?? {};
  if (typeof args === "string") {
    try { args = JSON.parse(args || "{}"); } catch { args = {}; }
  }

  if (!conversationId || !name) {
    return NextResponse.json({ error: "conversationId and name are required" }, { status: 400 });
  }
  if (!VOICE_TOOL_NAMES.includes(name)) {
    return NextResponse.json({ error: `Unknown tool: ${name}` }, { status: 400 });
  }

  try {
    const { data: conversation } = await intelligenceDb
      .from("ai_conversations")
      .select("id_conversation, type_visibility, user_created, id_workspace, id_client")
      .eq("id_conversation", conversationId)
      .maybeSingle();
    if (!conversation) {
      return NextResponse.json({ error: "Conversation not found" }, { status: 404 });
    }
    const access = await checkConversationAccess(conversationId, userId, {
      visibility: conversation.type_visibility,
      userCreated: conversation.user_created,
      workspaceId: conversation.id_workspace,
    });
    if (!access.allowed) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    const visibility: "private" | "team" =
      conversation.type_visibility === "team" ? "team" : "private";
    const workspaceId: string = conversation.id_workspace;

    let output: string;

    switch (name) {
      case "query_engine": {
        const { data: clients } = await supabase.from("app_clients").select("id_client");
        const workspaceClientIds = (clients || []).map((c: any) => c.id_client).filter(Boolean) as number[];
        const effectiveClientId = args.client_id || conversation.id_client || undefined;
        const result = await queryEngine(
          args.table,
          args.columns,
          args.filters,
          args.order,
          args.limit,
          workspaceClientIds,
          args.report,
          args.date_from,
          args.date_to,
          effectiveClientId,
          args.group_by,
          args.assignee_name,
          args
        );
        output = formatToolResult(result);
        break;
      }
      case "lookup_client_context": {
        output = await lookupClientContext(args.client_name, workspaceId);
        break;
      }
      case "search_memory": {
        const result = await searchMemory(args.query, args.scope || "both", workspaceId, userId);
        output = `${result.summary}\n\nMemories:\n${result.memories.map((m: any) => `- [${m.category}] ${m.content} (${m.date})`).join("\n") || "None found"}`;
        break;
      }
      case "query_meetingbrain": {
        const result = await queryMeetingBrain(args.report, userEmail, {
          query: args.query,
          status: args.status,
          days: args.days,
          workspaceId,
          meetingId: args.meeting_id,
          visibility,
        });
        output = formatMeetingBrainResult(args.report, result);
        break;
      }
      case "query_slack": {
        const result = await querySlack(args.report, userEmail, {
          query: args.query,
          channel: args.channel,
          channel_id: args.channel_id,
          thread_ts: args.thread_ts,
          days: args.days,
          limit: args.limit,
          visibility,
        });
        output = formatSlackResult(args.report, result);
        break;
      }
      case "consult_analyst": {
        const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY! });
        const msg = await anthropic.messages.create({
          model: "claude-sonnet-4-6",
          max_tokens: 1200,
          temperature: 0.3,
          system:
            "You are EngineAI's senior analyst. You receive questions escalated from a live voice conversation. Reply with a tight, well-reasoned analysis the voice assistant can relay aloud: plain prose, no markdown, no headers, no bullet symbols. Lead with the answer, then the two or three considerations that matter most. Under 150 words unless the question truly demands more.",
          messages: [
            {
              role: "user",
              content: `${args.question}${args.context ? `\n\nRelevant data from the conversation:\n${args.context}` : ""}`,
            },
          ],
        });
        output = msg.content
          .filter((b): b is Anthropic.TextBlock => b.type === "text")
          .map((b) => b.text)
          .join("\n");
        // Log analyst usage for cost tracking
        await intelligenceDb.from("ai_usage").insert({
          id_workspace: workspaceId,
          user_usage: userId,
          name_model: "claude-sonnet-4-6",
          type_source: "engineai-voice",
          units_input: msg.usage?.input_tokens || 0,
          units_output: msg.usage?.output_tokens || 0,
          units_cost_tenths: Math.round(((msg.usage?.input_tokens || 0) / 1e6 * 300 + (msg.usage?.output_tokens || 0) / 1e6 * 1500) * 10),
          id_conversation: conversationId,
        });
        break;
      }
      default:
        return NextResponse.json({ error: `Unknown tool: ${name}` }, { status: 400 });
    }

    return NextResponse.json({ output });
  } catch (err: any) {
    console.error(`[VoiceTools] ${name} failed:`, err.message);
    // Return a model-readable failure so the voice agent can explain gracefully
    return NextResponse.json({
      output: `Tool ${name} failed: ${err.message}. Tell the user you couldn't reach that system right now.`,
    });
  }
}
