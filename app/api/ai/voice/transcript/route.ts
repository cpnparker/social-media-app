import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { intelligenceDb } from "@/lib/supabase-intelligence";
import { checkConversationAccess } from "@/lib/ai/access";
import { VOICE_COST_TENTHS_PER_MIN, VOICE_MODEL } from "@/lib/ai/voice";

// POST /api/ai/voice/transcript — persist voice turns into the conversation
// Body: { conversationId, turns: [{ role: "user"|"assistant", content }], durationSeconds? }
// durationSeconds (sent once, on session end) logs voice minutes to ai_usage.
export async function POST(req: NextRequest) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const userId = parseInt(session.user.id, 10);

  let body: any;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }
  const { conversationId, turns, durationSeconds } = body || {};
  if (!conversationId || (!Array.isArray(turns) && !durationSeconds)) {
    return NextResponse.json({ error: "conversationId and turns (or durationSeconds) are required" }, { status: 400 });
  }

  try {
    const { data: conversation } = await intelligenceDb
      .from("ai_conversations")
      .select("id_conversation, type_visibility, user_created, id_workspace, flag_incognito")
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
    // A VIEW-only share recipient must not write here. Without this, they can
    // inject a voice transcript turns into someone else's thread — which the owner's
    // next turn reads back as trusted prior context.
    if (access.permission === "view") {
      return NextResponse.json({ error: "Read-only access to this conversation" }, { status: 403 });
    }

    // Save turns (skip in incognito, mirroring the text pipeline)
    let saved = 0;
    if (Array.isArray(turns) && turns.length > 0 && !conversation.flag_incognito) {
      const rows = turns
        .filter((t: any) => t && (t.role === "user" || t.role === "assistant") && typeof t.content === "string" && t.content.trim())
        .slice(0, 200)
        .map((t: any) => ({
          id_conversation: conversationId,
          role_message: t.role,
          document_message: t.content.trim().slice(0, 20000),
          name_model: t.role === "assistant" ? VOICE_MODEL : null,
          user_created: t.role === "user" ? userId : null,
        }));
      if (rows.length > 0) {
        const { error } = await intelligenceDb.from("ai_messages").insert(rows);
        if (error) {
          console.error("[VoiceTranscript] Insert failed:", error.message);
          return NextResponse.json({ error: "Failed to save transcript" }, { status: 500 });
        }
        saved = rows.length;
        await intelligenceDb
          .from("ai_conversations")
          .update({ date_updated: new Date().toISOString() })
          .eq("id_conversation", conversationId);
      }
    }

    // Log voice minutes on session end
    if (durationSeconds && Number(durationSeconds) > 0) {
      const minutes = Number(durationSeconds) / 60;
      const { error: usageErr } = await intelligenceDb.from("ai_usage").insert({
        id_workspace: conversation.id_workspace,
        user_usage: userId,
        name_model: VOICE_MODEL,
        type_source: "engineai-voice",
        units_input: Math.round(Number(durationSeconds)),
        units_output: 0,
        units_cost_tenths: Math.max(1, Math.round(minutes * VOICE_COST_TENTHS_PER_MIN)),
        id_conversation: conversationId,
      });
      if (usageErr) console.error("[VoiceTranscript] Usage log failed:", usageErr.message);
    }

    return NextResponse.json({ ok: true, saved });
  } catch (err: any) {
    console.error("[VoiceTranscript] Error:", err.message);
    return NextResponse.json({ error: "Internal error" }, { status: 500 });
  }
}
