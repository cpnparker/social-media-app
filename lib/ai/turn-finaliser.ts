/**
 * THE ASSISTANT ROW NEVER STAYS 'pending'.
 *
 * The chat route inserts the assistant row as 'pending' before the stream
 * starts, and two things flip it: the completion callback (complete) and the
 * safety net after the stream (failed). Both are code that runs INSIDE the
 * function — so when the platform killed the function at its 300s ceiling, as
 * it did on 2026-09-28 (thread 8479ea99) and 2026-09-15 (thread 4b94c318),
 * neither ran, and each row sat 'pending' and empty. The first is still
 * pending as this is written; the second has been for thirteen days.
 *
 * The turn deadline (lib/ai/turn-deadline.ts) is what normally prevents that:
 * the chain stops itself in time and the completion runs. This file is the
 * last resort for what the chain cannot bound — a tool executor that hangs is
 * not a stream and cannot be aborted — and the shared wording for every path
 * that has to state a failure on the row rather than leave it blank.
 *
 * Pure and dependency-free apart from the deadline, so a check drives it.
 */
import { backstopAt, CHAT_ROUTE_MAX_DURATION_MS, type TurnDeadline } from "./turn-deadline";

/**
 * A 'pending' row older than this is DEAD: its function has outlived the
 * platform's own kill. Read by the conversation GET (which flips such rows to
 * failed on reopen), by the conversation list (which stops showing them as
 * generating) and by the client's poll — one number, above the route's
 * ceiling, because between 150s and 300s the old 2.5-minute reaper was
 * flipping LIVE turns to failed while they were still running.
 */
export const STALE_PENDING_MS = CHAT_ROUTE_MAX_DURATION_MS + 30_000;

/** Is this assistant row a dead 'pending' one? */
export function isDeadPending(
  row: { role_message?: string; status_message?: string; date_created?: string | null },
  now: number = Date.now()
): boolean {
  if (row.role_message !== "assistant" || row.status_message !== "pending" || !row.date_created) return false;
  const at = Date.parse(row.date_created);
  return Number.isFinite(at) && now - at > STALE_PENDING_MS;
}

/** What a dead row says when it is reaped on reopen. The row holds nothing
 *  that was streamed — nothing is written to it until the turn finishes — so
 *  this is all there is to show, and it must say what happened. */
export const REAPED_TEXT =
  "This reply never finished — the turn ran out of time or lost its connection before anything was saved. Retry to run it again.";

/** The row as reaped: keeps anything that WAS saved, states the failure otherwise. */
export function reapedRow(documentMessage: string | null | undefined): { status_message: "failed"; document_message: string } {
  const kept = String(documentMessage || "").trim();
  return { status_message: "failed", document_message: kept ? String(documentMessage) : REAPED_TEXT };
}

/** The note the backstop streams and saves. One line, like the chain's own. */
export const BACKSTOP_NOTE =
  "\n\n---\n\n⏱ **Cut off at this turn's time limit** — a step was still running when time ran out, so anything the reply said it was building was not created; ask again, in smaller parts if it was large.";

/** The row the backstop writes: what the user was shown, plus the note. */
export function backstopRow(streamed: string): { status_message: "failed"; document_message: string } {
  const text = String(streamed || "").trim();
  return { status_message: "failed", document_message: text ? `${text}${BACKSTOP_NOTE}` : BACKSTOP_NOTE.replace(/^\n\n---\n\n/, "") };
}

/**
 * The row when the turn ENDED in an error (provider failure mid-stream, a
 * fallback too late to start). Keeps what was streamed — it was on the user's
 * screen, and "Generation failed" alone threw it away — and says what failed.
 */
export function failedRow(streamed: string, error: string): { status_message: "failed"; document_message: string } {
  const text = String(streamed || "").trim();
  const why = String(error || "").trim();
  const line = why ? `Generation failed: ${why.slice(0, 400)}` : "Generation failed — please retry.";
  return { status_message: "failed", document_message: text ? `${text}\n\n---\n\n⚠ ${line}` : line };
}

/**
 * Arm the backstop: `fire` runs at the deadline's backstop instant unless the
 * returned cancel runs first. A deadline already past fires on the next tick.
 */
export function armBackstop(deadline: TurnDeadline, fire: () => void, now: number = Date.now()): () => void {
  const timer = setTimeout(fire, Math.max(0, backstopAt(deadline) - now));
  return () => clearTimeout(timer);
}

/**
 * What the user has been shown, read off the SSE frames the route forwards.
 *
 * Buffers a frame split across reads — the route's inline parse split each
 * chunk on newlines and dropped both halves of a split frame — and starts
 * again on a `fallback` event, because the client clears the screen there and
 * the next leg's text is the reply.
 */
export interface SseTap {
  feed(chunk: string): void;
  /** The text on the user's screen now. */
  text(): string;
  /** The last `error` event's message, or "". */
  error(): string;
}

export function createSseTap(): SseTap {
  let buf = "";
  let text = "";
  let err = "";
  const line = (l: string) => {
    if (!l.startsWith("data: ")) return;
    const body = l.slice(6);
    if (body === "[DONE]") return;
    try {
      const ev = JSON.parse(body);
      if (ev && ev.fallback) text = "";
      if (ev && typeof ev.token === "string") text += ev.token;
      if (ev && typeof ev.error === "string" && ev.error.trim()) err = ev.error;
    } catch { /* not a JSON frame */ }
  };
  return {
    feed(chunk: string) {
      buf += chunk;
      const lines = buf.split("\n");
      buf = lines.pop() ?? "";
      for (let i = 0; i < lines.length; i++) line(lines[i]);
    },
    text: () => text,
    error: () => err,
  };
}
