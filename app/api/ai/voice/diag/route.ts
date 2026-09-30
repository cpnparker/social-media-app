import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";

/**
 * POST /api/ai/voice/diag — a voice session's render trace, sent to the server
 * log so it can be read without asking anyone to open devtools.
 *
 * WHY THIS EXISTS. Four fixes have been aimed at the voice changing mid-reply
 * and the evidence now says none of them could have been the cause. What
 * settles it is which response each audio render belongs to, and how much
 * previous audio was still queued when it started — both of which the client
 * knows and neither of which survived past the browser console.
 *
 * The alternative was asking the person who has already reported this four
 * times to open a console, set a filter, tick preserve-log, reproduce, and copy
 * the output back. That is a lot of ceremony to collect nine numbers, and every
 * step is a chance to lose them. This posts the buffer at session end and the
 * lines land in `vercel logs`, where they can be read directly.
 *
 * WHAT IT DELIBERATELY DOES NOT CARRY: any transcript text, tool arguments or
 * results. The buffer is response ids, tool NAMES, timings and audio-cursor
 * positions — enough to locate the seam, and nothing that could put a client's
 * words or a mailbox into a log line. A diagnostic that quietly becomes a
 * second copy of the conversation is not worth the diagnosis.
 */
export async function POST(req: NextRequest) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  let body: any;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const lines: unknown[] = Array.isArray(body?.lines) ? body.lines : [];
  if (!lines.length) return NextResponse.json({ ok: true, logged: 0 });

  // Capped on the server as well as the client. A client is not a source of
  // truth about how much it may write to a log, and an unbounded array here is
  // a free way to fill the log with whatever anyone likes.
  const capped = lines.slice(0, 300);
  const tag = `[VDIAG ${String(body?.sessionId || "?").slice(0, 40)}]`;
  console.log(`${tag} ${capped.length} line(s), user=${session.user.id}`);
  for (let i = 0; i < capped.length; i++) {
    // One line each: `vercel logs --query` matches per line, and a single
    // blob would have to be read whole to find the one number that matters.
    console.log(`${tag} ${String(capped[i]).slice(0, 400)}`);
  }
  return NextResponse.json({ ok: true, logged: capped.length });
}
