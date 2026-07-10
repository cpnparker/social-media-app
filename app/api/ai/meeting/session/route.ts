import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { intelligenceDb } from "@/lib/supabase-intelligence";
import { verifyWorkspaceMembership } from "@/lib/permissions";

// POST /api/ai/meeting/session — start an EngineAI Live meeting session.
//
// Creates the meeting conversation (type_conversation_mode='meeting',
// team-visible per the meetings-are-a-team-surface stance) plus the
// ai_meeting_sessions row. The session row's NOT NULL consent columns make
// the attestation gate structurally unskippable: this route REJECTS any
// request without an explicit consent attestation, and no other route
// starts capture.
//
// NOTE: no transcript is ever persisted — EngineAI Live is ephemeral by
// design ("process, don't record"). This row + ai_meeting_cards are the only
// server-side artifacts until the user approves the end-of-meeting digest.
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

  const { workspaceId, clientId, mbMeetingId, title, meetingType, consent, captureDevice } = body || {};
  if (!workspaceId) {
    return NextResponse.json({ error: "workspaceId is required" }, { status: 400 });
  }

  // Consent attestation is mandatory — the legal gate, enforced server-side.
  if (!consent || consent.attested !== true || !consent.method) {
    return NextResponse.json(
      { error: "Consent attestation is required before a meeting session can start" },
      { status: 403 }
    );
  }

  const memberRole = await verifyWorkspaceMembership(userId, workspaceId);
  if (!memberRole) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  // Per-user enablement flag (admins flip in Settings → Users)
  const { data: access } = await intelligenceDb
    .from("users_access")
    .select("flag_access_engineai_live")
    .eq("id_workspace", workspaceId)
    .eq("user_target", userId)
    .maybeSingle();
  if (!access?.flag_access_engineai_live) {
    return NextResponse.json(
      { error: "EngineAI Live is not enabled for your account — ask an admin to enable it in Settings → Users" },
      { status: 403 }
    );
  }

  try {
    const sessionTitle = (title || "Live meeting").slice(0, 120);
    const type = ["client_checkin", "sales", "general"].includes(meetingType) ? meetingType : "general";

    // Meeting = team surface (roadmap stance): visible to the workspace.
    const { data: conversation, error: convErr } = await intelligenceDb
      .from("ai_conversations")
      .insert({
        id_workspace: workspaceId,
        user_created: userId,
        name_conversation: sessionTitle,
        type_visibility: "team",
        id_client: clientId ? parseInt(String(clientId), 10) : null,
        name_model: "grok-4-1-fast",
        type_conversation_mode: "meeting",
      })
      .select("id_conversation")
      .single();
    if (convErr) throw convErr;

    const { data: meetingSession, error: sessErr } = await intelligenceDb
      .from("ai_meeting_sessions")
      .insert({
        id_conversation: conversation.id_conversation,
        id_workspace: workspaceId,
        id_client: clientId ? parseInt(String(clientId), 10) : null,
        mb_meeting_id: mbMeetingId || null,
        name_title: sessionTitle,
        type_meeting: type,
        status_session: "live",
        consent_attested_at: new Date().toISOString(),
        consent_attested_by: userId,
        consent_method: ["verbal", "calendar_note", "both"].includes(consent.method) ? consent.method : "verbal",
        consent_wording_version: "v1",
        capture_device: (captureDevice || "").slice(0, 200) || null,
      })
      .select("id_session")
      .single();
    if (sessErr) throw sessErr;

    return NextResponse.json({
      conversationId: conversation.id_conversation,
      sessionId: meetingSession.id_session,
    });
  } catch (err: any) {
    console.error("[MeetingSession] Create failed:", err.message);
    return NextResponse.json({ error: "Could not start meeting session" }, { status: 500 });
  }
}
