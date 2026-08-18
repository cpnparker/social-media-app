import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { generateSlides, updateSlides, type SlideInput } from "@/lib/slides/generate";
import { isReconnectable } from "@/lib/slides/reauth";
import { intelligenceDb } from "@/lib/supabase-intelligence";

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
  if (!email) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

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

  // Publishing the same draft twice should edit the deck it already made, not
  // leave a duplicate behind — the button is easy to press again.
  const result = body.presentationId
    ? await updateSlides(body.presentationId, title, slides, email)
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
      .select("slides_draft")
      .eq("id_message", body.messageId)
      .maybeSingle();
    const draft = (row as any)?.slides_draft;
    if (draft) {
      const { error } = await intelligenceDb
        .from("ai_messages")
        .update({
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
