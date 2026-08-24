import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { intelligenceDb } from "@/lib/supabase-intelligence";
import { checkConversationAccess } from "@/lib/ai/access";

/** The six reasons, matching the CHECK on intelligence.ai_message_feedback. */
const REASONS = [
  "wrong_facts", "wrong_datetime", "made_it_up",
  "missed_data", "ignored_request", "tone_format",
] as const;

// PATCH /api/ai/messages/[id]/feedback — rate an assistant message
// Body: { rating: 1 | -1 | null, reason?: string, note?: string }
//
// Two writes, deliberately. ai_messages.rating_message stays as the UI's
// current-state column so the thumb renders without a join; the durable,
// attributable, append-only record goes to intelligence.ai_message_feedback,
// which has no foreign key and therefore outlives the conversation it came
// from. A rating whose evidence has been cascaded away is not evidence.
export async function PATCH(
  req: NextRequest,
  { params }: { params: { id: string } }
) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const userId = parseInt(session.user.id, 10);
  const messageId = params.id;

  let rating: unknown, reason: unknown, note: unknown;
  try {
    ({ rating, reason, note } = await req.json());
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }
  if (rating !== 1 && rating !== -1 && rating !== null) {
    return NextResponse.json({ error: "rating must be 1, -1, or null" }, { status: 400 });
  }
  // An unanswered reason must still be a flag — the picker is dismissible, and
  // requiring it would cost more signal than it gathers at this volume.
  const cleanReason =
    typeof reason === "string" && (REASONS as readonly string[]).indexOf(reason) >= 0 ? reason : null;
  if (reason != null && cleanReason === null) {
    return NextResponse.json({ error: `reason must be one of: ${REASONS.join(", ")}` }, { status: 400 });
  }
  // Trimmed, not rejected: a note one character over the limit is still
  // feedback, and a 400 here would lose it.
  const cleanNote = typeof note === "string" && note.trim() ? note.trim().slice(0, 200) : null;

  try {
    const { data: message } = await intelligenceDb
      .from("ai_messages")
      .select("id_message, id_conversation, role_message, document_message, name_model, date_created")
      .eq("id_message", messageId)
      .maybeSingle();
    if (!message) {
      return NextResponse.json({ error: "Message not found" }, { status: 404 });
    }
    if (message.role_message !== "assistant") {
      return NextResponse.json({ error: "Only assistant messages can be rated" }, { status: 400 });
    }

    const { data: conversation } = await intelligenceDb
      .from("ai_conversations")
      .select("id_conversation, type_visibility, user_created, id_workspace")
      .eq("id_conversation", message.id_conversation)
      .maybeSingle();
    if (!conversation) {
      return NextResponse.json({ error: "Conversation not found" }, { status: 404 });
    }

    const access = await checkConversationAccess(conversation.id_conversation, userId, {
      visibility: conversation.type_visibility,
      userCreated: conversation.user_created,
      workspaceId: conversation.id_workspace,
    });
    if (!access.allowed) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }
    // A VIEW-only share recipient must not write here, matching the sibling
    // guard in app/api/ai/voice/transcript/route.ts.
    //
    // rating_message is a single column with no rater — last writer wins and
    // nothing records who. So a viewer could silently flip or clear the owner's
    // rating on a shared thread, and this feedback is about to be read as a
    // quality signal. An unattributable rating that anyone with a link can
    // overwrite is worse than no rating, because it looks like evidence.
    //
    // If viewers SHOULD be able to flag answers — a reasonable product call —
    // that needs a rater column first, so two people's opinions can coexist
    // instead of overwriting each other.
    if (access.permission === "view") {
      return NextResponse.json({ error: "Read-only access to this conversation" }, { status: 403 });
    }

    const { error } = await intelligenceDb
      .from("ai_messages")
      .update({ rating_message: rating })
      .eq("id_message", messageId);
    if (error) {
      // Column missing until the 20260610_message_feedback migration is applied.
      console.error("[Feedback] Update failed:", error.message);
      return NextResponse.json({ error: "Failed to save feedback" }, { status: 500 });
    }

    // The durable record. Written AFTER the rating so a failure here never
    // costs the user their click, and reported in the response rather than
    // swallowed — a capture channel that silently stops capturing looks
    // exactly like a channel with nothing to report.
    let recorded = true;
    if (rating !== null) {
      // The question that prompted the answer, snapshotted alongside it. Without
      // it a reviewer reads a reply with nothing to judge it against — which is
      // why one of the three flags on record cannot be diagnosed at all.
      const { data: prior } = await intelligenceDb
        .from("ai_messages")
        .select("document_message")
        .eq("id_conversation", (message as any).id_conversation)
        .eq("role_message", "user")
        .lt("date_created", (message as any).date_created)
        .order("date_created", { ascending: false })
        .limit(1);

      const { error: recErr } = await intelligenceDb.from("ai_message_feedback").insert({
        id_message: messageId,
        id_conversation: (message as any).id_conversation,
        id_workspace: (conversation as any).id_workspace,
        user_rated: userId,
        rating,
        type_reason: cleanReason,
        note_reason: cleanNote,
        name_model: (message as any).name_model || null,
        document_answer: ((message as any).document_message || "").slice(0, 20000),
        document_asked: (((prior as any[]) || [])[0]?.document_message || "").slice(0, 4000),
      });
      if (recErr) {
        recorded = false;
        console.error("[Feedback] Detail record failed (run 20260824_message_feedback_detail.sql):", recErr.message);
      }
    }

    return NextResponse.json({ ok: true, rating, reason: cleanReason, recorded });
  } catch (err: any) {
    console.error("[Feedback] Error:", err.message);
    return NextResponse.json({ error: "Internal error" }, { status: 500 });
  }
}
