/**
 * When a controlled editor should accept a new `content` prop, and when doing
 * so would throw the writer's caret across the document.
 *
 * ── THE BUG THIS EXISTS TO STOP ─────────────────────────────────────────────
 *
 * The editor is controlled in the loosest sense: it reports its HTML upward on
 * a debounce, the parent stores that in state, and the same string comes back
 * down as `content`. An effect compared the prop with the editor's current HTML
 * and called `setContent` on any difference. `setContent` replaces the whole
 * document, and a replaced document puts the caret at the end.
 *
 * Most of the time the two agree and nothing happens. They disagree in exactly
 * one situation: the writer pauses, the debounce fires and captures the HTML,
 * and the writer starts typing again before React has re-rendered. The prop is
 * now a snapshot from a few milliseconds ago; the editor has moved on; the
 * effect "corrects" the editor to the stale snapshot.
 *
 * Measured on production, typing at the top of a 1,180-character piece with a
 * 600ms debounce. Resuming at 590ms and 600ms left the caret at offset 8 and 7.
 * Resuming at 610, 620, 630 and 640ms put it at 1273, 1278, 1283 and 1288: the
 * last character of the document, every time. It also silently dropped the
 * keystroke that fell inside the window.
 *
 * ── WHY A MODULE FOR THREE LINES ────────────────────────────────────────────
 *
 * Because the three lines are a rule about a race, and a rule about a race
 * cannot be reviewed by reading it. Here it can be RUN: the check replays the
 * exact sequence above and asserts the answer, which is the only form of
 * evidence this repo accepts for something that already shipped once.
 */

export interface ExternalContentDecision {
  apply: boolean;
  /** Why, for a check to assert on and a human to read in a log. */
  reason: "identical" | "own-echo" | "external";
}

/**
 * Should an incoming `content` prop be written into the editor?
 *
 * @param incoming     the prop as it now stands
 * @param lastEmitted  the last HTML this editor reported upward, or null if it
 *                     has not reported any yet
 * @param currentHtml  what the editor holds right now
 *
 * The middle argument is the whole fix. Comparing the prop against the editor
 * alone cannot tell "someone loaded a different document" from "this is my own
 * text coming back late", and those need opposite treatment: the first must be
 * applied, the second must never be.
 */
export function decideExternalContent(
  incoming: string,
  lastEmitted: string | null,
  currentHtml: string
): ExternalContentDecision {
  if (incoming === currentHtml) return { apply: false, reason: "identical" };
  // An echo of our own text, arriving after the writer has typed more. Applying
  // it rewinds the document and drops the caret at the end.
  if (lastEmitted !== null && incoming === lastEmitted) return { apply: false, reason: "own-echo" };
  return { apply: true, reason: "external" };
}

/**
 * Where the caret should sit after content genuinely arrives from outside.
 *
 * Clamped, because the new document can be shorter than the old offset. Null
 * means "leave it alone", which is the right answer for an editor nobody is
 * typing in: restoring a position in a document the writer has not looked at
 * is worse than the default.
 */
export function selectionAfterExternalContent(
  selection: { from: number; to: number },
  newDocSize: number,
  hadFocus: boolean
): { from: number; to: number } | null {
  if (!hadFocus) return null;
  // ProseMirror positions are 1-based inside the doc node; content.size is the
  // last valid one.
  const from = Math.max(0, Math.min(selection.from, newDocSize));
  const to = Math.max(from, Math.min(selection.to, newDocSize));
  return { from, to };
}
