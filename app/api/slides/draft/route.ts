import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { intelligenceDb } from "@/lib/supabase-intelligence";
import { draftWriteAccess } from "@/lib/slides/message-access";

/**
 * PATCH /api/slides/draft — persist edits made directly in the preview.
 *
 * Without this an in-place edit lives only in the browser that made it, and a
 * reload throws it away — the same fault the draft was moved onto the message
 * to fix. Edits are as much a part of the draft as the generation that
 * produced it.
 *
 * A published draft is not editable: once the deck exists, changing the stored
 * preview would make it disagree with the file in Drive, and a preview that
 * misrepresents the deck is the failure this whole flow exists to avoid.
 */
export const maxDuration = 30;

export async function PATCH(req: NextRequest) {
  const session = await auth();
  if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  let body: { messageId?: string; draft?: any };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid request body" }, { status: 400 });
  }
  if (!body.messageId || !body.draft) {
    return NextResponse.json({ error: "messageId and draft are required" }, { status: 400 });
  }

  // Signed in is not the same as entitled to this message. See
  // lib/slides/message-access.ts — the table is reached through the
  // service-role client, so this check IS the access control.
  const allowed = await draftWriteAccess(body.messageId, parseInt(session.user.id, 10));
  if (!allowed.ok) {
    return NextResponse.json({ error: allowed.error }, { status: allowed.status });
  }
  const existing = allowed.draft;
  if (existing.published?.url) {
    return NextResponse.json({ error: "That deck has already been created" }, { status: 409 });
  }

  const { error } = await intelligenceDb
    .from("ai_messages")
    .update({ slides_draft: { ...existing, title: body.draft.title, slides: body.draft.slides, preview: body.draft.preview } })
    .eq("id_message", body.messageId);
  if (error) {
    console.warn(`[Slides] draft edit not saved: ${error.message}`);
    return NextResponse.json({ error: "Couldn't save the change" }, { status: 500 });
  }
  return NextResponse.json({ ok: true });
}
