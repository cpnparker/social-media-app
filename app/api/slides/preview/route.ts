import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { toPreviewModel } from "@/lib/slides/preview-model";

/**
 * POST /api/slides/preview — re-derive the preview from a spec.
 *
 * Exists because "slide geometry is fixed, so editing text needs no re-layout"
 * is only true of PROSE. A bar's length is its value; a timeline marker's
 * position is its date. Patching those in place updated the label and left the
 * drawing describing the old number — a chart that lies, which is worse than
 * one that refuses to change.
 *
 * The layout engine cannot run in the browser: it reaches the Slides builder,
 * which pulls in the Google token store and the Blob client. So the authority
 * stays here and the client patches optimistically for responsiveness, then
 * takes this answer.
 */
export const maxDuration = 30;

export async function POST(req: NextRequest) {
  const session = await auth();
  if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  let body: { slides?: any[] };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid request body" }, { status: 400 });
  }
  if (!Array.isArray(body.slides) || !body.slides.length) {
    return NextResponse.json({ error: "No slides" }, { status: 400 });
  }
  // Pure function of the spec — no I/O, and images are already resolved on it.
  return NextResponse.json({ preview: toPreviewModel(body.slides) });
}
