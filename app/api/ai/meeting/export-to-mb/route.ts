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
    // date_STARTED, not date_created — naming a column that does not exist
    // makes PostgREST return an ERROR with null data, which read here as
    // "session not found" and sent every save down the stale-session path.
    const { data: ms, error: msErr } = await intelligenceDb
      .from("ai_meeting_sessions")
      .select("id_session, id_workspace, name_title, mb_meeting_id, consent_attested_by, date_started")
      .eq("id_session", sessionId)
      .maybeSingle();
    // Check the ERROR explicitly. Inferring "not found" from null data hides
    // schema mistakes behind a plausible user-facing message.
    if (msErr) {
      console.error("[ExportToMB] session lookup failed:", msErr.message);
      return NextResponse.json({ error: `Could not load the session: ${msErr.message}` }, { status: 500 });
    }
    // Distinguish the two failures. A bare "Not found" was untraceable: the
    // most likely cause in practice is a STALE sessionId restored from the
    // crash buffer, pointing at a session that no longer exists — which looks
    // identical to a permissions failure from the outside.
    if (!ms) {
      console.warn(`[ExportToMB] no session row for ${sessionId} (stale crash buffer?)`);
      return NextResponse.json(
        { error: "This meeting session is no longer available — it may be from an earlier session. Start a new one and try again." },
        { status: 404 }
      );
    }
    if (ms.consent_attested_by !== userId) {
      console.warn(`[ExportToMB] session ${sessionId} belongs to user ${ms.consent_attested_by}, not ${userId}`);
      return NextResponse.json({ error: "This session belongs to another user." }, { status: 403 });
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
    let attachedMeeting: any = null;
    let attendeeTasks = 0;

    // ── Attach to the originating meeting, if it is genuinely the caller's ──
    // mb_meeting_id is stored verbatim from the ?mb= deep link, i.e. whichever
    // row the MeetingBrain modal had open. Under manager impersonation that can
    // belong to ANOTHER user, so ownership is re-checked here rather than
    // assumed — writing on trust would put this session's transcript into
    // someone else's meeting.
    if (ms.mb_meeting_id) {
      const { data: existing } = await mbDb
        .from("processed_meeting")
        .select("id, user_id, local_transcript, calendar_event_id, attendees")
        .eq("id", String(ms.mb_meeting_id))
        .maybeSingle();
      if (!existing) {
        console.warn(`[ExportToMB] mb_meeting_id ${ms.mb_meeting_id} not found — creating a new meeting instead`);
      } else if (String(existing.user_id) !== String(mbUser.id)) {
        console.warn(`[ExportToMB] mb_meeting_id ${ms.mb_meeting_id} belongs to ${existing.user_id}, not ${mbUser.id} — creating a new meeting instead`);
      }
      if (existing && String(existing.user_id) === String(mbUser.id)) {
        meetingId = existing.id;
        mode = "attached";
        attachedMeeting = existing;
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
          meeting_date: ms.date_started || new Date().toISOString(),
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

      // ── Fan out to the attendee each item was assigned to ──
      //
      // MeetingBrain keeps a SEPARATE row per attendee per calendar event, and
      // tasks are personal to the row that generated them — shareTranscript-
      // ToAttendees copies only the transcript, never tasks. So without this,
      // an action item owned by a colleague lands only in the recorder's list
      // and they never see it, which is exactly what happened after the first
      // real session.
      //
      // Scoped deliberately: only attendees who already have their OWN row for
      // this calendar event (i.e. MeetingBrain users whose calendar was
      // scanned) get a task, and it is attached to THEIR row. Nobody gains a
      // meeting record they did not already have, and a client attendee with
      // no MeetingBrain account gets nothing.
      const eventId = attachedMeeting?.calendar_event_id;
      if (eventId && !String(eventId).startsWith("engineai-live-")) {
        try {
          // Sibling rows for the same calendar event, excluding the host's.
          const { data: siblings } = await mbDb
            .from("processed_meeting")
            .select("id, user_id")
            .eq("calendar_event_id", eventId)
            .neq("user_id", mbUser.id);

          if (siblings && siblings.length > 0) {
            const { data: sibUsers } = await mbDb
              .from("users")
              .select("id, name, email")
              .in("id", siblings.map((r: any) => r.user_id));

            const norm = (x: string) => String(x || "").toLowerCase().replace(/[^a-z]+/g, " ").trim();
            let fanned = 0;
            for (const sib of siblings) {
              const u = (sibUsers || []).find((x: any) => String(x.id) === String(sib.user_id));
              if (!u) continue;
              const first = norm(u.name).split(" ")[0];
              // Match the digest's `owner` against this attendee. First name is
              // how people are named in a meeting; require a real token so a
              // blank owner never matches everyone.
              const theirs = (Array.isArray(tasks) ? tasks : []).filter((t: any) => {
                const owner = norm(t?.owner);
                if (!owner || !first || first.length < 2) return false;
                return owner === norm(u.name) || owner.split(" ").includes(first);
              });
              for (const t of theirs) {
                const title = String(t?.item || t?.title || "").trim().slice(0, 300);
                if (!title) continue;
                const { error } = await mbDb.from("task").insert({
                  title,
                  description: null,
                  status: "NEW",
                  responsible: u.name || null,
                  deadline: t?.due || null,
                  meeting: ms.name_title || "EngineAI Live meeting",
                  meeting_id: sib.id,           // THEIR row, not the host's
                  source_ref: `meeting:${sib.id}`,
                  user_id: u.id,
                  order: 0,
                });
                if (!error) fanned++;
                else if (error.code !== "23505") console.warn("[ExportToMB] attendee task:", error.message);
              }
            }
            if (fanned > 0) {
              attendeeTasks = fanned;
              console.log(`[ExportToMB] fanned ${fanned} task(s) to ${siblings.length} attendee row(s)`);
            }
          }
        } catch (e: any) {
          // Never fail the host's save because a colleague's copy did not land.
          console.warn("[ExportToMB] attendee fan-out failed:", e?.message);
        }
      }
    }

    console.log(`[ExportToMB] session ${sessionId} → meeting ${meetingId} (${mode}), ${taskCount} task(s)`);
    return NextResponse.json({ ok: true, mode, meetingId, taskCount, attendeeTasks });
  } catch (err: any) {
    console.error("[ExportToMB] Failed:", err.message);
    return NextResponse.json({ error: err.message || "Could not send to MeetingBrain" }, { status: 500 });
  }
}
