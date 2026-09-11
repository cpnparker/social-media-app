import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { intelligenceDb } from "@/lib/supabase-intelligence";
import { checkConversationAccess } from "@/lib/ai/access";

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

  // Read the source thread SEPARATELY and ignore its error. Naming a column
  // that does not exist yet fails the WHOLE select, and folding it into the
  // query above would have turned "Continue in EngineAI" into "Session not
  // found" for everyone between this deploy and the ALTER TABLE. Absent
  // column simply means no source, which falls back to the old behaviour.
  let sourceConversationId: string | null = null;
  {
    const { data: srcRow, error: srcErr } = await intelligenceDb
      .from("ai_meeting_sessions")
      .select("id_conversation_source")
      .eq("id_session", sessionId)
      .maybeSingle();
    if (srcErr) {
      console.warn("[MeetingHandoff] id_conversation_source unavailable (pre-migration?):", srcErr.message);
    } else {
      sourceConversationId = (srcRow as any)?.id_conversation_source ?? null;
    }
  }
  if (!meetingSession) {
    return NextResponse.json({ error: "Session not found" }, { status: 404 });
  }
  if (meetingSession.consent_attested_by !== userId) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  try {
    const title = `Follow-up — ${meetingSession.name_title || "Live meeting"}`.slice(0, 120);

    // ── 0. Continue the SOURCE conversation when Live was opened from one ──
    //
    // Opening Live from a chat carries that thread through as ?thread=, and the
    // session records it. "Continue in EngineAI" should then land back in the
    // conversation the user started from, rather than stranding the follow-up
    // in a new thread away from the work that prompted the meeting.
    //
    // Three things have to hold before we write into someone's existing thread:
    // it must still exist, the user must still have WRITE access to it (a
    // view-only share must not be able to inject a transcript into someone
    // else's thread), and it must belong to this workspace.
    let targetConversationId: string | null = null;
    let continuedSource = false;
    let withholdTranscript = false;

    if (sourceConversationId) {
      const { data: src } = await intelligenceDb
        .from("ai_conversations")
        .select("id_conversation, type_visibility, user_created, id_workspace")
        .eq("id_conversation", sourceConversationId)
        .maybeSingle();

      if (src && src.id_workspace === meetingSession.id_workspace) {
        const access = await checkConversationAccess(src.id_conversation, userId, {
          visibility: src.type_visibility,
          userCreated: src.user_created,
          workspaceId: src.id_workspace,
        });
        if (access.allowed && access.permission !== "view") {
          targetConversationId = src.id_conversation;
          continuedSource = true;

          // The transcript is the sensitive artefact, and this is the only path
          // that persists it. A source thread that is team-visible, shared, or
          // owned by someone else has readers who were not in the room, so the
          // digest goes in but the verbatim transcript does not. The full
          // transcript stays reachable in the meeting's own private thread.
          const { count: shareCount } = await intelligenceDb
            .from("ai_shares")
            .select("id_conversation", { count: "exact", head: true })
            .eq("id_conversation", src.id_conversation);
          withholdTranscript =
            src.type_visibility === "team" ||
            (shareCount || 0) > 0 ||
            src.user_created !== userId;
        }
      }
    }

    // 1. New general-mode conversation, linked to the client if any.
    //
    // ALWAYS PRIVATE. This is the only handoff path that writes the verbatim
    // transcript, so it is the one place publication must not be inferred.
    //
    // It previously used `id_client ? "team" : "private"`, treating a bound
    // client as the signal for client work. But binding is SILENT and
    // AUTOMATIC — meeting/page.tsx calls bind-client whenever the live
    // transcript mentions a client strongly enough, with no confirmation. So
    // saying "we still owe UBS the edit" once during a performance review or a
    // salary conversation published that 1:1's full transcript to everyone in
    // the workspace.
    //
    // bind-client already refuses to promote visibility for exactly this
    // reason (see its comment at bind-client/route.ts:40-51); this path was
    // reintroducing the hazard from the other end. The client link is still
    // recorded, so the thread carries client context — but the host shares it
    // deliberately, as they can from any private thread.
    if (!targetConversationId) {
      const { data: conversation, error: convErr } = await intelligenceDb
        .from("ai_conversations")
        .insert({
          id_workspace: meetingSession.id_workspace,
          user_created: userId,
          name_conversation: title,
          type_visibility: "private",
          id_client: meetingSession.id_client || null,
          name_model: HANDOFF_MODEL,
          type_conversation_mode: "general",
        })
        .select("id_conversation")
        .single();
      if (convErr) throw convErr;
      targetConversationId = conversation.id_conversation;
    }
    const conversation = { id_conversation: targetConversationId as string };

    // 2. Seed message 1 (user): the raw material — context + transcript.
    const transcriptText = Array.isArray(transcript)
      ? transcript
          .map((u: any) => `${u.speaker ? `[${String(u.speaker).slice(0, 20)}] ` : ""}${String(u.text || "").slice(0, 2000)}`)
          .join("\n")
      : "";
    const truncated = transcriptText.length > MAX_TRANSCRIPT_CHARS && !withholdTranscript;
    const seedParts: string[] = [];
    seedParts.push(
      continuedSource
        ? "I've just finished a meeting captured by EngineAI Live, picking up this conversation. Here's what came out of it — help me follow up from where we left off."
        : "I've just finished a meeting captured by EngineAI Live. Here's everything — help me follow up, draft outreach, and answer questions about it."
    );
    if (context && String(context).trim()) {
      seedParts.push(`\n## Context\n${String(context).slice(0, 4000)}`);
    }
    if (transcriptText && !withholdTranscript) {
      seedParts.push(`\n## Transcript${truncated ? " (truncated)" : ""}\n${transcriptText.slice(0, MAX_TRANSCRIPT_CHARS)}`);
    } else if (transcriptText && withholdTranscript) {
      seedParts.push(
        `\n## Transcript\nWithheld — this conversation has readers beyond the people in the meeting, so the verbatim transcript was not copied here. The summary and actions below are the record. If you need the exact wording, open the meeting's own thread. Do not claim to have the transcript.`
      );
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
    if (truncated && !withholdTranscript) {
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
      const lines: string[] = [
        continuedSource
          ? `Here's the summary of **${meetingSession.name_title || "the meeting"}**, carried back into this conversation:`
          : "Here's the summary of the meeting:",
        "",
        String(digest.summary).slice(0, 6000),
      ];
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

    return NextResponse.json({
      conversationId: conversation.id_conversation,
      continuedSource,
      transcriptWithheld: withholdTranscript,
    });
  } catch (err: any) {
    console.error("[MeetingHandoff] Failed:", err.message);
    return NextResponse.json({ error: "Could not continue in EngineAI" }, { status: 500 });
  }
}
