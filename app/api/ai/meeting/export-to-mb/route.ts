import { NextRequest, NextResponse } from "next/server";
import { createHash } from "crypto";
import { auth } from "@/lib/auth";
import { intelligenceDb } from "@/lib/supabase-intelligence";
import { getMeetingBrainDb } from "@/lib/ai/providers";

export const maxDuration = 30;

/**
 * POST /api/ai/meeting/export-to-mb — send an EngineAI Live session's summary,
 * transcript and/or action items to MeetingBrain.
 *
 * EXPLICITLY USER-INITIATED, from the review screen, after the digest has been
 * read. That is what keeps Live's position honest: the default remains
 * process-and-discard, and persistence is a deliberate act the host takes
 * having seen exactly what would be saved. Nothing here runs automatically.
 *
 * Attaches to the MeetingBrain meeting the session was launched from when
 * there is one; otherwise creates a standalone record.
 *
 * MeetingBrain and EngineAI share one Supabase project (schemas `meetingbrain`
 * and `intelligence`), so this is a direct write with the service-role client —
 * no HTTP bridge involved.
 */
export async function POST(req: NextRequest) {
  const session = await auth();
  if (!session?.user?.id || !session.user.email) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const userId = parseInt(session.user.id, 10);
  const email = session.user.email.toLowerCase();

  try {
    const { sessionId, summary, transcript, tasks, includeSummary, includeTranscript, includeTasks } = await req.json();
    if (!sessionId) return NextResponse.json({ error: "sessionId is required" }, { status: 400 });
    if (!includeSummary && !includeTranscript && !includeTasks) {
      return NextResponse.json({ error: "Nothing selected to send" }, { status: 400 });
    }

    // The session must be this user's own Live session. consent_attested_by is
    // the host gate used by every other meeting route.
    const { data: ms } = await intelligenceDb
      .from("ai_meeting_sessions")
      .select("id_session, id_workspace, name_title, mb_meeting_id, consent_attested_by, date_created")
      .eq("id_session", sessionId)
      .maybeSingle();
    if (!ms || ms.consent_attested_by !== userId) {
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    }

    const mbDb = getMeetingBrainDb();
    if (!mbDb) return NextResponse.json({ error: "MeetingBrain is not configured" }, { status: 503 });

    // Resolve the caller's MeetingBrain identity. Note the table is `users`
    // (plural) — scripts/supabase-schema.sql declares `user` and is stale.
    const { data: mbUser } = await mbDb
      .from("users")
      .select("id, name")
      .ilike("email", email)
      .maybeSingle();
    if (!mbUser?.id) {
      return NextResponse.json(
        { error: "No MeetingBrain account for this email — ask an admin to invite you." },
        { status: 403 }
      );
    }

    const bullets = (text: string) =>
      String(text || "")
        .split(/\n+/)
        .map((l) => l.replace(/^[-*•]\s*/, "").trim())
        .filter(Boolean)
        .map((l) => `• ${l}`)
        .join("\n");

    let meetingId: string | null = null;
    let mode: "attached" | "created" = "created";

    // ── Attach to the originating meeting, if it is genuinely the caller's ──
    // mb_meeting_id is stored verbatim from the ?mb= deep link, i.e. whichever
    // row the MeetingBrain modal had open. Under manager impersonation that can
    // belong to ANOTHER user, so ownership is re-checked here rather than
    // assumed — writing on trust would put this session's transcript into
    // someone else's meeting.
    if (ms.mb_meeting_id) {
      const { data: existing } = await mbDb
        .from("processed_meeting")
        .select("id, user_id, local_transcript")
        .eq("id", String(ms.mb_meeting_id))
        .maybeSingle();
      if (existing && String(existing.user_id) === String(mbUser.id)) {
        meetingId = existing.id;
        mode = "attached";
        const patch: Record<string, unknown> = {};
        if (includeSummary && summary) {
          patch.summary = String(summary).slice(0, 20000);
          patch.next_steps = bullets(String(summary).match(/next steps?:?([\s\S]*)$/i)?.[1] || "");
        }
        if (includeTranscript && transcript) {
          // local_transcript, NOT transcript: the scanner OWNS `transcript`
          // (the Google Docs notes body) and overwrites it on every scan, so
          // anything written there disappears. It only ever reads and appends
          // local_transcript. Append rather than replace — the meeting may
          // already carry a browser recording.
          const prior = String(existing.local_transcript || "").trim();
          const body = String(transcript);
          patch.local_transcript = prior ? `${prior}\n\n--- EngineAI Live ---\n${body}` : body;
          // content_hash stops the scanner's reprocess pass looping over this row.
          patch.content_hash = createHash("sha256").update(String(patch.local_transcript)).digest("hex");
        }
        if (Object.keys(patch).length > 0) {
          const { error } = await mbDb.from("processed_meeting").update(patch).eq("id", meetingId);
          if (error) throw new Error(`MeetingBrain update failed: ${error.message}`);
        }
      }
    }

    // ── Otherwise create a standalone record ──
    if (!meetingId) {
      const transcriptBody = includeTranscript && transcript ? String(transcript) : null;
      // Synthetic calendar_event_id. calendar_event_id is NOT NULL, and the
      // scanner reaps any row whose id is absent from live Google Calendar —
      // MeetingBrain exempts this prefix so an EngineAI-created meeting is not
      // deleted minutes after it is written.
      const { data: created, error } = await mbDb
        .from("processed_meeting")
        .insert({
          user_id: mbUser.id,
          calendar_event_id: `engineai-live-${sessionId}`,
          meeting_title: ms.name_title || "EngineAI Live meeting",
          meeting_date: ms.date_created || new Date().toISOString(),
          summary: includeSummary && summary ? String(summary).slice(0, 20000) : null,
          local_transcript: transcriptBody,
          content_hash: transcriptBody ? createHash("sha256").update(transcriptBody).digest("hex") : null,
          tasks_extracted: 0,
        })
        .select("id")
        .single();
      if (error) throw new Error(`MeetingBrain insert failed: ${error.message}`);
      meetingId = created.id;
      mode = "created";
    }

    // ── Tasks ──
    let taskCount = 0;
    if (includeTasks && Array.isArray(tasks) && tasks.length > 0 && meetingId) {
      // The digest emits action_items as { owner, item, due } — `item` is the
      // text, not `title`.
      const rows = tasks
        .map((t: any) => ({
          text: String(t?.item || t?.title || t || "").trim(),
          owner: t?.owner ? String(t.owner).slice(0, 120) : null,
          due: t?.due || null,
        }))
        .filter((t) => t.text)
        .slice(0, 25)
        .map((t) => ({
          title: t.text.slice(0, 300),
          description: null,
          status: "NEW",
          responsible: t.owner || mbUser.name || null,
          deadline: t.due,
          meeting: ms.name_title || "EngineAI Live meeting",
          meeting_id: meetingId,
          source_ref: `meeting:${meetingId}`,
          user_id: mbUser.id,
          order: 0,
        }));
      for (const row of rows) {
        // 23505 = the partial unique index blocking a duplicate open task —
        // the DB backstop doing its job, not a failure. Insert one at a time so
        // one duplicate does not reject the batch.
        const { error } = await mbDb.from("task").insert(row);
        if (!error) taskCount++;
        else if (error.code !== "23505") console.warn("[ExportToMB] task insert:", error.message);
      }
      if (taskCount > 0) {
        await mbDb.from("processed_meeting").update({ tasks_extracted: taskCount }).eq("id", meetingId);
      }
    }

    console.log(`[ExportToMB] session ${sessionId} → meeting ${meetingId} (${mode}), ${taskCount} task(s)`);
    return NextResponse.json({ ok: true, mode, meetingId, taskCount });
  } catch (err: any) {
    console.error("[ExportToMB] Failed:", err.message);
    return NextResponse.json({ error: err.message || "Could not send to MeetingBrain" }, { status: 500 });
  }
}
