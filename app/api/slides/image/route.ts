import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { resolveImage } from "@/lib/slides/images";
import { generateImage } from "@/lib/ai/providers";

/**
 * POST /api/slides/image — resolve a photograph for ONE slide.
 *
 * Exists so "change this image" costs one image rather than a whole deck. The
 * alternative is asking the model to rebuild every slide to alter one picture,
 * which is slow, spends tokens on unchanged text, and invites it to reword
 * things nobody asked about.
 */
export const maxDuration = 120;

export async function POST(req: NextRequest) {
  const session = await auth();
  if (!session?.user?.email) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  let body: { query?: string; url?: string; gradient?: boolean };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid request body" }, { status: 400 });
  }
  if (!body.query?.trim() && !body.url?.trim()) {
    return NextResponse.json({ error: "Give a description or an image URL" }, { status: 400 });
  }

  const resolved = await resolveImage(
    { query: body.query, url: body.url },
    (prompt: string) => generateImage(prompt, "1792x1024", "openai", undefined, undefined, "public"),
    // Full-bleed layouts need the gradient burnt in; a side-by-side image
    // carries no text and must not be darkened.
    { aspect: 16 / 9, gradient: body.gradient !== false }
  );
  if (!resolved) {
    return NextResponse.json(
      { error: "Couldn't find or make an image for that. Try different words." },
      { status: 502 }
    );
  }
  return NextResponse.json({ url: resolved.url, source: resolved.source, credit: resolved.credit });
}
