import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { intelligenceDb } from "@/lib/supabase-intelligence";

// POST /api/ai/meeting/token — mint a short-lived AssemblyAI streaming token.
//
// Same "server mints, browser connects direct" pattern as the xAI voice
// session (app/api/ai/voice/session/route.ts): serverless can't hold the
// WebSocket, so the browser talks straight to the STT provider with a 60s
// temp token. Also serves mid-meeting reconnects (token TTL only gates the
// HANDSHAKE, not the session length).
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
  const { sessionId, spike } = body || {};

  if (!process.env.ASSEMBLYAI_API_KEY) {
    return NextResponse.json(
      { error: "Live transcription is not configured (missing ASSEMBLYAI_API_KEY)" },
      { status: 503 }
    );
  }

  if (spike === true) {
    // Capture-validation spike (Phase 0): an authenticated user testing their
    // OWN mic against streaming STT — no meeting, no other participants, no
    // consent row needed. Real sessions below remain consent-gated.
  } else {
    if (!sessionId) {
      return NextResponse.json({ error: "sessionId is required" }, { status: 400 });
    }
    // The session must exist, be live/paused, and belong to the caller's
    // attested session — capture tokens are only minted against a consented row.
    const { data: meetingSession } = await intelligenceDb
      .from("ai_meeting_sessions")
      .select("id_session, status_session, consent_attested_by")
      .eq("id_session", sessionId)
      .maybeSingle();
    if (!meetingSession) {
      return NextResponse.json({ error: "Session not found" }, { status: 404 });
    }
    if (meetingSession.consent_attested_by !== userId) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }
    if (!["live", "paused"].includes(meetingSession.status_session)) {
      return NextResponse.json({ error: "Session has ended" }, { status: 409 });
    }
  }

  try {
    const mintRes = await fetch(
      "https://streaming.assemblyai.com/v3/token?expires_in_seconds=60",
      { headers: { Authorization: process.env.ASSEMBLYAI_API_KEY } }
    );
    if (!mintRes.ok) {
      const errText = await mintRes.text().catch(() => "");
      console.error(`[MeetingToken] AssemblyAI mint failed (${mintRes.status}): ${errText.slice(0, 200)}`);
      return NextResponse.json({ error: "Could not start live transcription" }, { status: 503 });
    }
    const { token } = await mintRes.json();
    return NextResponse.json({
      token,
      wsUrl: "wss://streaming.assemblyai.com/v3/ws",
      sampleRate: 16000,
    });
  } catch (err: any) {
    console.error("[MeetingToken] Mint failed:", err.message);
    return NextResponse.json({ error: "Could not start live transcription" }, { status: 500 });
  }
}
