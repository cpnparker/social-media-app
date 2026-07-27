import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { intelligenceDb } from "@/lib/supabase-intelligence";

// POST /api/ai/meeting/bind-client — link a client to a live meeting session
// mid-call, after the user confirms a transcript-driven suggestion. Updates the
// session (so the deck, ambient lookup and T2 all scope to it) and mirrors the
// link onto the meeting conversation, exactly as session-create does.
export async function POST(req: NextRequest) {
  const session = await auth();
  if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const userId = parseInt(session.user.id, 10);

  let body: any;
  try { body = await req.json(); } catch { return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 }); }
  const { sessionId, clientId } = body || {};
  if (!sessionId || clientId == null) {
    return NextResponse.json({ error: "sessionId and clientId are required" }, { status: 400 });
  }
  const cid = parseInt(String(clientId), 10);
  if (!Number.isFinite(cid)) return NextResponse.json({ error: "Invalid clientId" }, { status: 400 });

  const { data: ms } = await intelligenceDb
    .from("ai_meeting_sessions")
    .select("id_session, id_conversation, consent_attested_by")
    .eq("id_session", sessionId)
    .maybeSingle();
  if (!ms) return NextResponse.json({ error: "Session not found" }, { status: 404 });
  if (ms.consent_attested_by !== userId) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const { error } = await intelligenceDb
    .from("ai_meeting_sessions")
    .update({ id_client: cid })
    .eq("id_session", sessionId);
  if (error) {
    console.error("[MeetingBindClient] Update failed:", error.message);
    return NextResponse.json({ error: "Could not link client" }, { status: 500 });
  }
  // Keep the meeting thread linked too (mirrors session creation) — and
  // promote it to team visibility, which session creation also does when a
  // client is picked up front. Without this, a client bound mid-call (the
  // whole reason the in-meeting picker exists) left the thread private, so
  // the approved digest of genuine client work never reached the team.
  // Guarded: meeting threads only, owned by the caller, never demotes, and
  // never promotes a thread that has been shared with specific people.
  if (ms.id_conversation) {
    const update: Record<string, any> = { id_client: cid };
    const { data: conv } = await intelligenceDb
      .from("ai_conversations")
      .select("type_visibility, user_created, type_conversation_mode")
      .eq("id_conversation", ms.id_conversation)
      .maybeSingle();
    if (
      cid &&
      conv &&
      conv.type_conversation_mode === "meeting" &&
      conv.type_visibility !== "team" &&
      conv.user_created === userId
    ) {
      const { count: shareCount } = await intelligenceDb
        .from("ai_shares")
        .select("id_conversation", { count: "exact", head: true })
        .eq("id_conversation", ms.id_conversation);
      if (!shareCount) update.type_visibility = "team";
    }
    await intelligenceDb.from("ai_conversations").update(update).eq("id_conversation", ms.id_conversation);
  }
  return NextResponse.json({ ok: true });
}
