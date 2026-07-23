import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { intelligenceDb } from "@/lib/supabase-intelligence";

export const maxDuration = 30;

// POST /api/ai/meeting/handoff — "Continue in EngineAI".
//
// The user's explicit, reviewed choice to carry a finished meeting into a
// normal EngineAI conversation for follow-up work. Creates a general-mode
// conversation (linked to the client if there is one) and seeds it with the
// context, the reviewed digest, and the transcript, so the user can keep
// drafting follow-ups with everything in the model's context.
//
// NOTE: this is the ONE path where the transcript is persisted — because the
// user deliberately asked for it at review time. The default flows
// (save-summary / discard) remain transcript-free.
const HANDOFF_MODEL = "grok-4-1-fast";
const MAX_TRANSCRIPT_CHARS = 40000;

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
  const { sessionId, context, digest, transcript } = body || {};
  if (!sessionId) {
    return NextResponse.json({ error: "sessionId is required" }, { status: 400 });
  }

  const { data: meetingSession } = await intelligenceDb
    .from("ai_meeting_sessions")
    .select("id_session, id_workspace, id_client, name_title, consent_attested_by")
    .eq("id_session", sessionId)
    .maybeSingle();
  if (!meetingSession) {
    return NextResponse.json({ error: "Session not found" }, { status: 404 });
  }
  if (meetingSession.consent_attested_by !== userId) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  try {
    const title = `Follow-up — ${meetingSession.name_title || "Live meeting"}`.slice(0, 120);

    // 1. New general-mode conversation, linked to the client if any.
    //
    // VISIBILITY follows the same rule as meeting_details: client work is a
    // team artefact, everything else stays with its owner. This used to be
    // unconditionally "team", so continuing an internal 1:1 — a performance
    // review, a salary conversation — dropped its verbatim transcript into a
    // workspace-readable thread. A bound client is the signal that this is
    // client work; without one, the follow-up is private to the host, who
    // can still share it deliberately.
    const isClientMeeting = !!meetingSession.id_client;
    const { data: conversation, error: convErr } = await intelligenceDb
      .from("ai_conversations")
      .insert({
        id_workspace: meetingSession.id_workspace,
        user_created: userId,
        name_conversation: title,
        type_visibility: isClientMeeting ? "team" : "private",
        id_client: meetingSession.id_client || null,
        name_model: HANDOFF_MODEL,
        type_conversation_mode: "general",
      })
      .select("id_conversation")
      .single();
    if (convErr) throw convErr;

    // 2. Seed message 1 (user): the raw material — context + transcript.
    const transcriptText = Array.isArray(transcript)
      ? transcript
          .map((u: any) => `${u.speaker ? `[${String(u.speaker).slice(0, 20)}] ` : ""}${String(u.text || "").slice(0, 2000)}`)
          .join("\n")
      : "";
    const truncated = transcriptText.length > MAX_TRANSCRIPT_CHARS;
    const seedParts: string[] = [];
    seedParts.push("I've just finished a meeting captured by EngineAI Live. Here's everything — help me follow up, draft outreach, and answer questions about it.");
    if (context && String(context).trim()) {
      seedParts.push(`\n## Context\n${String(context).slice(0, 4000)}`);
    }
    if (transcriptText) {
      seedParts.push(`\n## Transcript${truncated ? " (truncated)" : ""}\n${transcriptText.slice(0, MAX_TRANSCRIPT_CHARS)}`);
    }
    const { error: userMsgErr } = await intelligenceDb.from("ai_messages").insert({
      id_conversation: conversation.id_conversation,
      role_message: "user",
      document_message: seedParts.join("\n").slice(0, 20000),
      user_created: userId,
      status_message: "complete",
    });
    if (userMsgErr) throw userMsgErr;

    // If the transcript overflowed one message, add continuation user messages
    // so nothing is lost (the model reads them all as context).
    if (truncated) {
      let offset = MAX_TRANSCRIPT_CHARS;
      let part = 2;
      while (offset < transcriptText.length && part <= 6) {
        const chunk = transcriptText.slice(offset, offset + 18000);
        await intelligenceDb.from("ai_messages").insert({
          id_conversation: conversation.id_conversation,
          role_message: "user",
          document_message: `## Transcript (part ${part})\n${chunk}`,
          user_created: userId,
          status_message: "complete",
        });
        offset += 18000;
        part++;
      }
    }

    // 3. Seed message 2 (assistant): the reviewed digest, so the thread opens
    //    with a useful summary and the user can immediately ask for more.
    if (digest?.summary) {
      const lines: string[] = ["Here's the summary of the meeting:", "", String(digest.summary).slice(0, 6000)];
      const decisions = Array.isArray(digest.decisions) ? digest.decisions : [];
      const actions = Array.isArray(digest.action_items) ? digest.action_items : [];
      if (decisions.length) {
        lines.push("", "**Decisions**");
        decisions.slice(0, 20).forEach((x: string) => lines.push(`- ${String(x).slice(0, 400)}`));
      }
      if (actions.length) {
        lines.push("", "**Action items**");
        actions.slice(0, 30).forEach((a: any) =>
          lines.push(`- ${String(a.item || a).slice(0, 400)}${a.owner ? ` — ${String(a.owner).slice(0, 60)}` : ""}`)
        );
      }
      if (digest.followup_email) {
        lines.push("", "**Draft follow-up email**", "", String(digest.followup_email).slice(0, 4000));
      }
      lines.push("", "What would you like to do next — refine the follow-up, pull more client data, or dig into anything from the call?");
      await intelligenceDb.from("ai_messages").insert({
        id_conversation: conversation.id_conversation,
        role_message: "assistant",
        document_message: lines.join("\n").slice(0, 20000),
        name_model: HANDOFF_MODEL,
        status_message: "complete",
      });
    }

    // 4. Close the meeting session (its record is the working conversation now).
    await intelligenceDb
      .from("ai_meeting_sessions")
      .update({ status_session: "ended", date_ended: new Date().toISOString() })
      .eq("id_session", sessionId)
      .in("status_session", ["live", "paused", "ended"]);

    return NextResponse.json({ conversationId: conversation.id_conversation });
  } catch (err: any) {
    console.error("[MeetingHandoff] Failed:", err.message);
    return NextResponse.json({ error: "Could not continue in EngineAI" }, { status: 500 });
  }
}
