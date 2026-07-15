import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { queryMeetingBrain } from "@/lib/ai/providers";

// GET /api/ai/meeting/mb-context?meetingId=... — meeting context for the Live
// setup screen when launched from MeetingBrain (meetingbrain.ai links to
// /meeting?mb=<id> passing ONLY the meeting id in the URL — no PII in query
// strings; details are fetched here and access is enforced by the
// get_meeting_details RPC's own p_user_email scoping).
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
    const r = await queryMeetingBrain("meeting_details", session.user.email, { meetingId });
    if (r.error || !r.data || Array.isArray(r.data)) {
      return NextResponse.json({ error: r.error || "Meeting not found" }, { status: 404 });
    }
    const d: any = r.data;
    // Setup-screen prefill only — deliberately NOT the transcript (the Live
    // context field is a short brief, not a meeting record).
    return NextResponse.json({
      meeting: {
        title: d.title || null,
        date: d.date || null,
        attendees: d.attendees ?? null,
        summary: String(d.summary || d.external_summary || "").slice(0, 1500) || null,
        key_topics: d.key_topics ?? null,
        next_steps: String(d.next_steps || "").slice(0, 800) || null,
      },
    });
  } catch (err: any) {
    console.error("[MeetingMbContext] Failed:", err.message);
    return NextResponse.json({ error: "Could not load meeting context" }, { status: 500 });
  }
}
