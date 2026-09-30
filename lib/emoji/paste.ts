/**
 * The composer's paste door: Slack shortcodes in, emoji out.
 *
 * The chat composer (components/ai-writer/ChatInput.tsx) and the home
 * composer that starts a conversation (app/engineai/page.tsx — where the
 * incident's paste went, as the thread's first message) both hand their
 * textarea's onPaste straight to pasteShortcodesAsEmoji. It needs nothing
 * from React: the text goes in through the browser's own editing, which
 * fires the input event the textarea's onChange already listens to.
 *
 * WHY insertHTML, IN A TEXTAREA. A paste that set the React state would move
 * the caret to the end of the box and give ⌘Z nothing to take back, so the
 * text goes in as an edit the browser's undo understands. There are two, and
 * the obvious one is wrong. insertText is a TYPING command: its cost grows
 * with the square of the lines it carries (measured in Chrome: 4ms for the
 * incident's 46 lines, 243ms for 690, 17.5 seconds for a 4,000-line
 * transcript — the tab frozen throughout, where the browser's own paste of
 * the same text takes 50ms), and it merges into the typing on either side
 * of it. insertHTML in a textarea is the browser's own paste: a textarea is
 * plain text, so the markup's TEXT is what goes in, through the same replace
 * command a paste uses — those 4,000 lines, converted, go in through this
 * door in 55-67ms, one undo step that merges with nothing. Measured exact
 * on 680 combinations of box, selection and text (NBSPs, tabs, runs of
 * spaces, "<", "&", ZWJ emoji, blank lines); the one difference from a
 * paste is that it leaves the caret BEFORE a trailing newline, so the caret
 * is put after the text explicitly. That is Chrome. Safari's editing shares
 * the code this relies on, and is not verified here; an engine that refuses
 * it falls through to the next, below.
 *
 * Where insertHTML is refused, insertText is tried — but only for a paste
 * short enough that its cost does not matter — and where that is refused
 * too, setRangeText and a synthetic input event do the edit: the caret is
 * right, only undo is lost.
 *
 * EVERY attempt is judged by what the box HOLDS afterwards, never by whether
 * the box changed. A paste over a selection holding the same text changes
 * nothing and is done; judged by change, it read as refused and the fallback
 * put the whole paste in a second time (the incident's text, re-pasted over a
 * select-all of itself, went out as a 2,448-character message holding it
 * twice). And an engine that edits the box into something ELSE is corrected
 * to what was asked for, not added to.
 *
 * WHICH PASTES ARE TOUCHED. One with nothing that could convert — nothing
 * shortcode-shaped at a boundary Slack writes one at — is never touched: not
 * prevented, not re-inserted, the table not loaded. That includes every
 * timestamp ("00:01:23" holds ":01:"), so a transcript, a caption file or a
 * log is always the browser's own paste. Once the table is in, one whose
 * shortcodes are all unknown (":party-parrot:") is left alone too. The event
 * is never stopped, so anything further up that handles pasted files still
 * sees it.
 *
 * The first paste that holds a candidate waits for the table's chunk. The
 * paste is held (prevented) meanwhile and lands where it was aimed — or at
 * the caret, if the box changed in the few milliseconds of the load — and if
 * the chunk cannot load (or the conversion throws), the text goes in exactly
 * as pasted. A paste is never dropped.
 */
import type { ClipboardEvent } from "react";
import {
  convertShortcodes,
  hasShortcodeCandidate,
  loadedShortcodeTable,
  loadShortcodeTable,
} from "./shortcodes";

/** What the browser's own paste would have put in: a textarea's value holds
 *  "\n" only, and getData does not normalise. */
function asTextareaText(text: string): string {
  return text.replace(/\r\n?/g, "\n");
}

/** Markup whose text is exactly the text. */
function asMarkup(text: string): string {
  return text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

/** insertText is tried only up to this many lines. Measured in Chrome, 100
 *  lines cost 11ms into an empty box and 35ms into one already holding 300;
 *  the cost then grows with the square. It is reached only in an engine that
 *  refused insertHTML, and a longer paste there goes in through setRangeText:
 *  instantly, without undo. */
const INSERT_TEXT_MAX_LINES = 100;

function lineCount(text: string): number {
  let n = 1;
  for (let i = text.indexOf("\n"); i >= 0; i = text.indexOf("\n", i + 1)) n++;
  return n;
}

/** Re-set the selection to itself. That closes the browser's open typing
 *  group, which matters on the insertText path: insertText is a TYPING
 *  command, and measured in Chrome, "abc" typed then pasted then undone came
 *  back EMPTY — the paste had merged into the typing before it, and the next
 *  keystroke merged into the paste. insertHTML merges with nothing. */
function closeTypingGroup(el: HTMLTextAreaElement): void {
  el.setSelectionRange(el.selectionStart, el.selectionEnd, el.selectionDirection || undefined);
}

function insertAtCaret(el: HTMLTextAreaElement, text: string): void {
  if (document.activeElement !== el) el.focus();
  const before = el.value;
  const start = el.selectionStart;
  const end = el.selectionEnd;
  const expected = before.slice(0, start) + text + before.slice(end);
  const caret = start + text.length;

  const attempts: Array<[string, string]> = [["insertHTML", asMarkup(text)]];
  if (lineCount(text) <= INSERT_TEXT_MAX_LINES) attempts.push(["insertText", text]);
  for (let i = 0; i < attempts.length; i++) {
    try {
      closeTypingGroup(el);
      document.execCommand(attempts[i][0], false, attempts[i][1]);
    } catch {
      // A refusal by throwing is judged like any other, by the box.
    }
    if (el.value === expected) {
      // After the text, even when it ends in a newline; and on the
      // insertText path this closes the typing group behind the paste.
      el.setSelectionRange(caret, caret);
      return;
    }
    if (el.value !== before) break;
  }

  // Refused throughout — or a command edited the box into something other
  // than what was asked, in which case the whole box is put right rather
  // than the paste added to it.
  if (el.value === before) el.setRangeText(text, start, end, "end");
  else el.setRangeText(expected, 0, el.value.length, "end");
  el.setSelectionRange(caret, caret);
  // React's onChange is its input listener; setRangeText fires none.
  el.dispatchEvent(new Event("input", { bubbles: true }));
}

export function pasteShortcodesAsEmoji(e: ClipboardEvent<HTMLTextAreaElement>): void {
  if (e.defaultPrevented || !e.clipboardData) return;
  const el = e.currentTarget;
  const text = e.clipboardData.getData("text/plain");
  if (!text || !hasShortcodeCandidate(text)) return;

  const table = loadedShortcodeTable();
  if (table) {
    const out = convertShortcodes(text, table);
    if (out === text) return;
    e.preventDefault();
    insertAtCaret(el, asTextareaText(out));
    return;
  }

  e.preventDefault();
  const aim = { value: el.value, start: el.selectionStart, end: el.selectionEnd };
  loadShortcodeTable()
    .then((t) => convertShortcodes(text, t))
    .catch(() => text)
    .then((out) => {
      if (!el.isConnected) return;
      if (el.value === aim.value) el.setSelectionRange(aim.start, aim.end);
      insertAtCaret(el, asTextareaText(out));
    });
}
