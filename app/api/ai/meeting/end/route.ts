import { NextRequest, NextResponse } from "next/server";
import OpenAI from "openai";
import { auth } from "@/lib/auth";
import { intelligenceDb } from "@/lib/supabase-intelligence";
import { logAiUsage } from "@/lib/ai/usage-logger";
import { mergeSameWorkstreamItems } from "@/lib/ai/merge-action-items";

export const maxDuration = 60;

// POST /api/ai/meeting/end — end an EngineAI Live session.
//
// Two-step, human-review-gated flow ("process, don't record"):
//
//   Step 1 { sessionId, durationSeconds, transcript?: [...] }
//     → marks the session ended, logs STT minutes to ai_usage, and — if a
//       transcript is provided — generates a DRAFT digest from it. The
//       transcript is processed IN MEMORY ONLY and never written anywhere;
//       the draft is returned to the client for review.
//
//   Step 2 { sessionId, approveDigest: true, digest: {...} }
//     → commits the human-reviewed digest to the meeting thread as normal
//       ai_messages rows (labeled AI-generated per EU AI Act Art. 50).
//
//   { sessionId, discard: true }
//     → marks the session discarded; nothing else persists.

const DIGEST_MODEL = "grok-4-1-fast";
const DIGEST_API_MODEL = "grok-4-1-fast-non-reasoning";
/** AssemblyAI streaming ≈ $0.27/hr with diarization → ~0.45¢/min ≈ 5 tenths-of-a-cent per minute. */
const MEETING_STT_COST_TENTHS_PER_MIN = 5;

function getXAIClient() {
  if (!process.env.XAI_API_KEY) throw new Error("XAI_API_KEY is not set");
  return new OpenAI({ apiKey: process.env.XAI_API_KEY, baseURL: "https://api.x.ai/v1" });
}

const DIGEST_PROMPT = `You are generating the post-meeting digest for a live business meeting at a content-production agency. From the transcript below, produce STRICT JSON:
{
  "summary": "4-8 sentence narrative summary (past tense, third person)",
  "decisions": ["each explicit decision made"],
  "action_items": [{"owner": "name or 'us'/'client'", "item": "what", "due": "when if stated, else null"}],
  "followup_email": "a short, warm, professional follow-up email draft the host could send (no subject line)"
}
Rules: only include what is actually in the transcript — never invent. Numbers, dates and commitments must be verbatim-accurate.
CONSOLIDATION: merge action items that are steps of ONE workstream for the SAME owner — the same deliverable or the same counterpart (e.g. "ask Gary about the process" and later "share the document with Gary and confirm") — into ONE item with the steps joined by "; ". HARD RULE: no commitment may disappear in a merge — every action stated in the transcript must appear either as its own item or as an explicit step inside a merged item, including preparatory steps (asking about, checking, confirming something). Distinct deliverables stay separate items even for the same owner; when merged steps carry different due dates, use the earliest.
Return ONLY the JSON object.`;

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
  const { sessionId, durationSeconds, transcript, context, approveDigest, digest, discard } = body || {};
  if (!sessionId) {
    return NextResponse.json({ error: "sessionId is required" }, { status: 400 });
  }

  const { data: meetingSession } = await intelligenceDb
    .from("ai_meeting_sessions")
    .select("id_session, id_conversation, id_workspace, id_client, name_title, status_session, consent_attested_by")
    .eq("id_session", sessionId)
    .maybeSingle();
  if (!meetingSession) {
    return NextResponse.json({ error: "Session not found" }, { status: 404 });
  }
  if (meetingSession.consent_attested_by !== userId) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  try {
    // ── Discard: end with nothing persisted ──
    if (discard === true) {
      await intelligenceDb
        .from("ai_meeting_sessions")
        .update({ status_session: "discarded", date_ended: new Date().toISOString() })
        .eq("id_session", sessionId);
      return NextResponse.json({ ok: true, discarded: true });
    }

    // ── Step 2: commit the human-reviewed digest ──
    if (approveDigest === true) {
      if (!digest?.summary) {
        return NextResponse.json({ error: "digest.summary is required" }, { status: 400 });
      }
      const actions = Array.isArray(digest.action_items) ? digest.action_items : [];
      const decisions = Array.isArray(digest.decisions) ? digest.decisions : [];
      const lines: string[] = [
        `## Meeting digest — ${meetingSession.name_title || "Live meeting"}`,
        "",
        digest.summary.slice(0, 6000),
      ];
      if (decisions.length) {
        lines.push("", "**Decisions**");
        decisions.slice(0, 20).forEach((d: string) => lines.push(`- ${String(d).slice(0, 400)}`));
      }
      if (actions.length) {
        lines.push("", "**Action items**");
        actions.slice(0, 30).forEach((a: any) =>
          lines.push(`- [ ] ${String(a.item || a).slice(0, 400)}${a.owner ? ` — ${String(a.owner).slice(0, 60)}` : ""}${a.due ? ` (due ${String(a.due).slice(0, 60)})` : ""}`)
        );
      }
      lines.push("", "_AI-generated from a live meeting session (transcript not retained). Reviewed before saving._");

      const { error: msgErr } = await intelligenceDb.from("ai_messages").insert({
        id_conversation: meetingSession.id_conversation,
        role_message: "assistant",
        document_message: lines.join("\n").slice(0, 20000),
        name_model: DIGEST_MODEL,
        status_message: "complete",
      });
      if (msgErr) throw msgErr;

      // Publication decision belongs HERE, not at client-bind time: this is
      // the moment a human deliberately reviews the digest and approves it.
      // (bind-client used to promote, but binding is silent and automatic
      // from the transcript, so a client's name spoken aloud in an internal
      // 1:1 published the whole thread.)
      //
      // Promote only when: a client is bound (client work is a team
      // artefact), the thread is still private, the caller owns it, nobody
      // has been given a specific share, and the thread was NOT used as a
      // private chat. That last check is the important one — meeting threads
      // are ordinary chat threads, so a host who asked about their mail or
      // memories in it must not have that history republished. Counts that
      // come back null are treated as unknown ⇒ do not promote.
      const convUpdate: Record<string, any> = { date_updated: new Date().toISOString() };
      if (meetingSession.id_client) {
        const [{ data: conv }, { count: shareCount }, { count: userMsgCount }] = await Promise.all([
          intelligenceDb
            .from("ai_conversations")
            .select("type_visibility, user_created, type_conversation_mode")
            .eq("id_conversation", meetingSession.id_conversation)
            .maybeSingle(),
          intelligenceDb
            .from("ai_shares")
            .select("id_conversation", { count: "exact", head: true })
            .eq("id_conversation", meetingSession.id_conversation),
          intelligenceDb
            .from("ai_messages")
            .select("id_message", { count: "exact", head: true })
            .eq("id_conversation", meetingSession.id_conversation)
            .eq("role_message", "user"),
        ]);
        if (
          conv &&
          conv.type_conversation_mode === "meeting" &&
          conv.type_visibility !== "team" &&
          conv.user_created === userId &&
          shareCount === 0 &&
          userMsgCount === 0
        ) {
          convUpdate.type_visibility = "team";
          console.log(`[MeetingEnd] Client meeting digest approved — thread published to the team`);
        }
      }

      await intelligenceDb
        .from("ai_conversations")
        .update(convUpdate)
        .eq("id_conversation", meetingSession.id_conversation);

      return NextResponse.json({
        ok: true, committed: true, conversationId: meetingSession.id_conversation,
        sharedWithTeam: convUpdate.type_visibility === "team",
      });
    }

    // ── Step 1: end the session, log usage, draft the digest ──
    const seconds = Math.max(0, Math.round(Number(durationSeconds) || 0));
    await intelligenceDb
      .from("ai_meeting_sessions")
      .update({
        status_session: "ended",
        date_ended: new Date().toISOString(),
        duration_seconds: seconds,
      })
      .eq("id_session", sessionId)
      .in("status_session", ["live", "paused"]);

    // STT minutes → ai_usage (same shape as voice-minute logging)
    if (seconds > 30) {
      const minutes = Math.max(1, Math.round(seconds / 60));
      const { error: usageErr } = await intelligenceDb.from("ai_usage").insert({
        id_workspace: meetingSession.id_workspace,
        user_usage: userId,
        name_model: "assemblyai-universal-streaming",
        type_source: "engineai-meeting",
        units_input: seconds,
        units_output: 0,
        units_cost_tenths: minutes * MEETING_STT_COST_TENTHS_PER_MIN,
        id_conversation: meetingSession.id_conversation,
      });
      if (usageErr) console.error("[MeetingEnd] Usage log failed:", usageErr.message);
    }

    // Draft digest from the in-memory transcript (processed, never stored)
    let draftDigest: any = null;
    if (Array.isArray(transcript) && transcript.length > 0) {
      const body = transcript
        .map((u: any) => `${u.speaker ? `[${String(u.speaker).slice(0, 20)}] ` : ""}${String(u.text || "").slice(0, 2000)}`)
        .join("\n");
      const ctxPrefix = context && String(context).trim()
        ? `Meeting context provided by the host (use it to disambiguate names/topics):\n${String(context).slice(0, 4000)}\n\nTranscript:\n`
        : "";
      const text = (ctxPrefix + body).slice(0, 120000); // grok-4-1-fast context is ample; cap defensively
      // Company/team context (roster) so digests attribute names and roles
      // correctly ("Gar" = Gary Lyness, Finance Manager — not a mystery guest).
      let companyCtx = "";
      try {
        const { data: st } = await intelligenceDb
          .from("ai_settings")
          .select("information_company_context")
          .eq("id_workspace", meetingSession.id_workspace)
          .maybeSingle();
        companyCtx = String(st?.information_company_context || "").slice(0, 3500);
      } catch { /* optional */ }
      try {
        const xai = getXAIClient();
        const res = await xai.chat.completions.create({
          model: DIGEST_API_MODEL,
          temperature: 0.2,
          max_tokens: 1500,
          messages: [
            { role: "system", content: companyCtx ? `${DIGEST_PROMPT}\n\nCompany & team context (use for correct name/role attribution; never copy verbatim into the summary):\n${companyCtx}` : DIGEST_PROMPT },
            { role: "user", content: text },
          ],
        });
        const raw = res.choices?.[0]?.message?.content || "";
        logAiUsage({
          workspaceId: meetingSession.id_workspace,
          userId,
          model: DIGEST_MODEL,
          source: "engineai-meeting",
          inputTokens: res.usage?.prompt_tokens || 0,
          outputTokens: res.usage?.completion_tokens || 0,
        });
        const jsonMatch = raw.match(/\{[\s\S]*\}/);
        if (jsonMatch) draftDigest = JSON.parse(jsonMatch[0]);
        // Lossless backstop for same-workstream splits the prompt's
        // CONSOLIDATION rule didn't catch — the host reviews the merged list.
        if (draftDigest && Array.isArray(draftDigest.action_items)) {
          try {
            draftDigest.action_items = mergeSameWorkstreamItems(draftDigest.action_items);
          } catch (mergeErr: any) {
            console.warn('[MeetingEnd] action-item merge skipped:', mergeErr.message);
          }
        }
      } catch (err: any) {
        console.error("[MeetingEnd] Digest generation failed:", err.message);
        // Non-fatal: the client can retry or save without a digest
      }
    }

    return NextResponse.json({ ok: true, ended: true, draftDigest });
  } catch (err: any) {
    console.error("[MeetingEnd] Failed:", err.message);
    return NextResponse.json({ error: "Could not end meeting session" }, { status: 500 });
  }
}
