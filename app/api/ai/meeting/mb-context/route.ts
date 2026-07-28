import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { queryMeetingBrain } from "@/lib/ai/providers";

/**
 * GET /api/ai/meeting/mb-context?meetingId=… — MeetingBrain context for the
 * Live setup screen, launched from meetingbrain.ai's "⚡ Open EngineAI Live"
 * (which passes ONLY the meeting id — no PII in query strings; access is
 * enforced by get_meeting_details' own p_user_email scoping).
 *
 * THE TIMING FACT THAT SHAPES THIS ROUTE. MeetingBrain's ⚡ button is rendered
 * only while a meeting has NOT ended, and the row it points at is normally a
 * stub inserted by the calendar sync: transcript null, summary null, no tasks.
 * Ingestion refuses to run until meeting_end + 15 minutes and then only on a
 * quarter-hourly cron. So the button is pressed at precisely the moments when
 * this meeting has no transcript, summary or tasks — asking for them is asking
 * for nulls.
 *
 * What DOES exist, and is what the user actually wants in the room, is the
 * PREVIOUS meeting in the series: its summary, its open next steps and its
 * extracted tasks. So this route returns the named meeting's state honestly,
 * and — when that meeting is still a stub — a second `previous` payload with
 * the real material.
 */

/** Is this row a calendar stub the ingestion has not reached yet? */
function meetingState(d: any): "stub" | "processing" | "processed" {
  const status = String(d?.transcript_status || "none");
  const hasSummary = !!String(d?.summary || d?.external_summary || "").trim();
  if (status === "full" || hasSummary) return "processed";
  if (status === "stub_only") return "processing";
  return "stub";
}

function shape(d: any) {
  return {
    title: d.title || null,
    date: d.date || null,
    attendees: d.attendees ?? null,
    summary: String(d.summary || d.external_summary || "").slice(0, 1500) || null,
    key_topics: d.key_topics ?? null,
    next_steps: String(d.next_steps || "").slice(0, 800) || null,
    // Forwarded now, and this is the substance of the feature: meeting_details
    // already returned both and this route discarded them.
    tasks: Array.isArray(d.tasks)
      ? d.tasks.slice(0, 12).map((t: any) => ({
          title: String(t?.title || "").slice(0, 200),
          status: t?.status ?? null,
          deadline: t?.deadline ?? null,
          responsible: t?.responsible ?? null,
        }))
      : [],
    transcript_status: d.transcript_status || "none",
    // NOT the transcript itself. It is a persisted recording in MeetingBrain,
    // and Live's own transcript is deliberately never written down; copying
    // one in would create a second, longer-lived copy of a recording in a
    // product built to avoid exactly that. Derived lines only.
    state: meetingState(d),
  };
}

export async function GET(req: NextRequest) {
  const session = await auth();
  if (!session?.user?.email) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const meetingId = req.nextUrl.searchParams.get("meetingId") || "";
  if (!meetingId) {
    return NextResponse.json({ error: "meetingId is required" }, { status: 400 });
  }

  try {
    // visibility "private": this response goes ONLY to the authenticated
    // requester as a setup-screen prefill (never into a conversation), and the
    // RPC scopes the meeting to them by p_user_email. Stated explicitly
    // because the privacy gate is fail-closed — an omitted audience blocks.
    const r = await queryMeetingBrain("meeting_details", session.user.email, { meetingId, visibility: "private" });
    if (r.error || !r.data || Array.isArray(r.data)) {
      return NextResponse.json({ error: r.error || "Meeting not found" }, { status: 404 });
    }
    const meeting = shape(r.data as any);

    // When the named meeting is still a stub, go and find the one that isn't:
    // the most recent PAST meeting in the same series. This is the payload
    // that makes someone sharp in the room — what was agreed last time and
    // what is still open from it.
    let previous: ReturnType<typeof shape> | null = null;
    if (meeting.state !== "processed") {
      try {
        const seriesQuery = String(meeting.title || "").replace(/\s*[-–—|]\s*.*$/, "").trim();
        if (seriesQuery.length >= 3) {
          const s = await queryMeetingBrain("search_meetings", session.user.email, {
            query: seriesQuery,
            visibility: "private",
          });
          const rows: any[] = Array.isArray(s.data) ? s.data : [];
          const past = rows
            .filter((m) => m?.id && m.id !== meetingId && !/^UPCOMING/i.test(String(m.label || m.status || "")))
            .sort((a, b) => String(b.date || "").localeCompare(String(a.date || "")))[0];
          if (past?.id) {
            const p = await queryMeetingBrain("meeting_details", session.user.email, {
              meetingId: String(past.id),
              visibility: "private",
            });
            if (!p.error && p.data && !Array.isArray(p.data)) {
              const shaped = shape(p.data as any);
              // Only worth returning if it actually carries something.
              if (shaped.summary || shaped.next_steps || shaped.tasks.length) previous = shaped;
            }
          }
        }
      } catch (e: any) {
        console.warn("[MeetingMbContext] previous-meeting lookup failed:", e?.message);
      }
    }

    return NextResponse.json({ meeting, previous });
  } catch (err: any) {
    console.error("[MeetingMbContext] Failed:", err.message);
    return NextResponse.json({ error: "Could not load meeting context" }, { status: 500 });
  }
}
