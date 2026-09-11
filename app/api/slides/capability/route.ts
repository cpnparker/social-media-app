import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { authFailureMessage, canGenerateSlides } from "@/lib/slides/token";
import { GOOGLE_CONNECT_URL, isReconnectable, reconnectLabel } from "@/lib/slides/reauth";

/**
 * GET /api/slides/capability — can the signed-in user create a Slides deck?
 *
 * Exists so the reconnect button can CONFIRM the new scope actually landed
 * rather than assuming it did because a popup closed. Someone can close the
 * consent window early, or approve as the wrong Google account, and a button
 * that clears itself on close would report success for neither.
 */
export const maxDuration = 15;

export async function GET() {
  const session = await auth();
  const email = session?.user?.email;
  if (!email) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const result = await canGenerateSlides(email);
  return NextResponse.json({
    canCreate: result.ok,
    reason: result.reason ?? null,
    reconnectable: isReconnectable(result.reason),
    connectUrl: GOOGLE_CONNECT_URL,
    buttonLabel: reconnectLabel(result.reason),
    // Same wording the chat tool uses, so a retry after a half-finished consent
    // does not suddenly explain the problem differently.
    message: result.ok ? null : authFailureMessage(result.reason!),
  });
}
