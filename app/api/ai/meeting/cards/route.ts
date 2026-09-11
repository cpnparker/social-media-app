import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { intelligenceDb } from "@/lib/supabase-intelligence";

// POST /api/ai/meeting/cards — fire-and-forget card state + trigger-log writes.
// The trigger log (every shown/dismissed/pinned/expired/suppressed event +
// 👍/👎) is the relevance-tuning ground-truth dataset.
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
  const { sessionId, cardId, action, value, kind, title, receipt, triggerPattern, latencyMs } = body || {};
  if (!sessionId || !action) {
    return NextResponse.json({ error: "sessionId and action are required" }, { status: 400 });
  }

  // Ownership check (cheap; keeps the trigger log honest)
  const { data: meetingSession } = await intelligenceDb
    .from("ai_meeting_sessions")
    .select("id_session, consent_attested_by")
    .eq("id_session", sessionId)
    .maybeSingle();
  if (!meetingSession || meetingSession.consent_attested_by !== userId) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  try {
    // A deck/T1 card that fires for the first time may not have a row yet
    // (T1 cards are surfaced from the client's cached deck). Insert on first
    // 'shown' when no cardId, else update the existing row.
    if (!cardId && action === "shown") {
      const { data: ins } = await intelligenceDb
        .from("ai_meeting_cards")
        .insert({
          id_session: sessionId,
          kind_card: kind || "unknown",
          source_card: "t1",
          name_title: (title || "Card").slice(0, 200),
          document_body: {},
          document_receipt: receipt || { label: "—" },
          trigger_pattern: triggerPattern || null,
          state_card: "shown",
          latency_ms: typeof latencyMs === "number" ? latencyMs : null,
          date_shown: new Date().toISOString(),
        })
        .select("id_card")
        .single();
      return NextResponse.json({ ok: true, cardId: ins?.id_card || null });
    }

    if (!cardId) return NextResponse.json({ ok: true }); // nothing to update

    const updates: Record<string, any> = {};
    if (action === "feedback") {
      updates.feedback = value === 1 ? 1 : value === -1 ? -1 : null;
    } else if (["shown", "expired", "dismissed", "pinned", "suppressed"].includes(action)) {
      updates.state_card = action;
      if (action === "shown") updates.date_shown = new Date().toISOString();
      else updates.date_resolved = new Date().toISOString();
    }
    if (Object.keys(updates).length > 0) {
      await intelligenceDb.from("ai_meeting_cards").update(updates).eq("id_card", cardId).eq("id_session", sessionId);
    }
    return NextResponse.json({ ok: true });
  } catch (err: any) {
    console.error("[MeetingCards] Failed:", err.message);
    return NextResponse.json({ ok: false }, { status: 200 });
  }
}
