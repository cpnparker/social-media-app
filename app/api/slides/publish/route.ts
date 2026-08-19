import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { generateSlides, updateSlides, type SlideInput } from "@/lib/slides/generate";
import { isReconnectable } from "@/lib/slides/reauth";
import { intelligenceDb } from "@/lib/supabase-intelligence";
import { draftWriteAccess } from "@/lib/slides/message-access";

/**
 * POST /api/slides/publish — put a reviewed draft into the user's Drive.
 *
 * The chat tool builds a draft and renders it; nothing reaches Drive until a
 * person presses the button that calls this. That ordering is the whole point:
 * a deck that appears before it has been agreed leaves the user deciding which
 * of several files is current, which is the version confusion this removes.
 *
 * The draft is posted back by the client rather than held server-side. It
 * already lives in the conversation the user is looking at, and a server cache
 * would add an expiry that could strand a draft mid-discussion.
 */
export const maxDuration = 120;

export async function POST(req: NextRequest) {
  const session = await auth();
  const email = session?.user?.email;
  if (!email || !session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  let body: { title?: string; slides?: SlideInput[]; presentationId?: string; messageId?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid request body" }, { status: 400 });
  }

  const title = (body.title || "Presentation").trim();
  const slides = body.slides;
  if (!Array.isArray(slides) || slides.length === 0) {
    return NextResponse.json({ error: "No slides to publish" }, { status: 400 });
  }

  // Checked BEFORE anything is built. The deck is created with the caller's own
  // Google token, so stamping the result onto a message they cannot write would
  // plant a link to a file they own — and control the sharing of — in somebody
  // else's thread, in place of the button that would have made that person's
  // own copy.
  let stored: any = null;
  if (body.messageId) {
    const allowed = await draftWriteAccess(body.messageId, parseInt(session.user.id, 10));
    if (!allowed.ok) {
      return NextResponse.json({ error: allowed.error }, { status: allowed.status });
    }
    stored = allowed.draft;
  }

  // If this draft has already been built once, edit THAT file. The client
  // cannot tell us to: the case this covers is a response that never arrived —
  // the deck was created, the browser saw a timeout, and the user pressed the
  // button again. Trusting the client to send the id back means the one moment
  // the id matters is the one moment nobody has it.
  const existingId = body.presentationId || stored?.published?.presentationId;

  // Publishing the same draft twice should edit the deck it already made, not
  // leave a duplicate behind — the button is easy to press again.
  const result = existingId
    ? await updateSlides(existingId, title, slides, email)
    : await generateSlides(title, slides, email);

  if (!result.ok) {
    return NextResponse.json(
      {
        error: result.error,
        reason: result.reason ?? null,
        reconnectable: isReconnectable(result.reason),
      },
      { status: isReconnectable(result.reason) ? 409 : 502 }
    );
  }

  // Record where the draft landed, so reopening the thread shows the created
  // deck rather than offering to create it a second time.
  if (body.messageId) {
    const { data: row } = await intelligenceDb
      .from("ai_messages")
      .select("document_message")
      .eq("id_message", body.messageId)
      .maybeSingle();
    const draft = stored;
    if (draft) {
      // The link goes into the MESSAGE as well as the draft, because the model
      // is shown `document_message` next turn and nothing else. Publishing from
      // the button left no trace in the conversation at all, so the next "add a
      // pricing slide" was answered by a model that had never heard of this
      // deck — it built a second one, which is precisely the duplicate the
      // whole presentationId round-trip exists to prevent.
      const marker = `\n\n\ud83d\udcca [Open ${result.title} in Google Slides](${result.url})\n\n`;
      const prose = (row as any).document_message || "";
      const { error } = await intelligenceDb
        .from("ai_messages")
        .update({
          document_message: prose.includes(result.url!) ? prose : prose + marker,
          slides_draft: {
            ...draft,
            published: {
              url: result.url,
              presentationId: result.presentationId,
              slideCount: result.slideCount,
              thumbnails: result.thumbnails || [],
            },
          },
        })
        .eq("id_message", body.messageId);
      if (error) console.warn(`[Slides] could not mark draft published: ${error.message}`);
    }
  }

  return NextResponse.json({
    url: result.url,
    presentationId: result.presentationId,
    title: result.title,
    slideCount: result.slideCount,
    updated: !!result.updated,
    thumbnails: result.thumbnails || [],
  });
}
