import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { generateSlides, type SlideInput } from "@/lib/slides/generate";
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
  // A deck in Drive is the USER'S file, never updated again. The old
  // press-twice-edits-in-place convenience is exactly what destroyed a deck
  // Chris had hand-edited: the "update" replaced every slide, and his manual
  // work was gone. A second press now creates a second file, which is the
  // recoverable mistake of the two.
  const result = await generateSlides(title, slides, email);

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
    const { data: row, error: readErr } = await intelligenceDb
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
      const payload: Record<string, unknown> = {
        slides_draft: {
          ...draft,
          published: {
            url: result.url,
            presentationId: result.presentationId,
            slideCount: result.slideCount,
            thumbnails: result.thumbnails || [],
          },
        },
      };
      // Only touch the prose when we actually READ it. Falling back to "" would
      // replace the assistant's message with the bare link.
      if (!readErr && row) {
        const prose = (row as any).document_message || "";
        payload.document_message = prose.includes(result.url!) ? prose : prose + marker;
      } else {
        console.warn(`[Slides] could not read message prose for ${body.messageId}: ${readErr?.message || "no row"} — link not appended`);
      }

      // Retried once, then reported. This write is what stops the button
      // offering to build a deck that already exists, so losing it silently
      // means the next press makes a SECOND deck in the user's Drive.
      let writeErr = (await intelligenceDb.from("ai_messages").update(payload)
        .eq("id_message", body.messageId)).error;
      if (writeErr) {
        writeErr = (await intelligenceDb.from("ai_messages").update(payload)
          .eq("id_message", body.messageId)).error;
      }
      if (writeErr) {
        console.error(`[Slides] could not mark draft published: ${writeErr.message}`);
        return NextResponse.json({
          url: result.url,
          presentationId: result.presentationId,
          title: result.title,
          slideCount: result.slideCount,
          updated: !!result.updated,
          thumbnails: result.thumbnails || [],
          // The deck EXISTS. Saying otherwise would send them to build it again.
          warning: "The deck was created, but this conversation couldn't record it — reload before creating another, or you may end up with two.",
        });
      }
    }
  }

  return NextResponse.json({
    url: result.url,
    presentationId: result.presentationId,
    title: result.title,
    slideCount: result.slideCount,
    updated: !!result.updated,
    thumbnails: result.thumbnails || [],
    // A body too long for its box becomes two slides at build time. Saying so
    // is the difference between a deck that gained a slide and a deck that
    // gained a slide for a reason.
    splitFrom: (result.slideCount || 0) > slides.length ? slides.length : undefined,
  });
}
