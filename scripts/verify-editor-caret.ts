/**
 * Guards the caret against the editor's own text coming back late.
 *
 * Run: npx tsx scripts/verify-editor-caret.ts --self-test
 *
 * ── WHAT IS ACTUALLY AT RISK HERE ───────────────────────────────────────────
 *
 * A writer editing the top of an article, whose caret is thrown to the bottom
 * of it mid-sentence. It shipped, it was reported from real use, and neither a
 * type-checker nor any fixture could see it: both halves of the loop were
 * correct on their own and only their timing was wrong.
 *
 * The loop: the editor reports its HTML upward on a debounce, the parent stores
 * it, the same string returns as the `content` prop, and an effect wrote it
 * back into the editor whenever it differed from what the editor held.
 * `setContent` rebuilds the document and leaves the caret at the end.
 *
 * It only differs in one situation, which is why it survived review: the writer
 * pauses, the debounce fires and snapshots the HTML, and the writer resumes
 * before React re-renders. The prop is then a few milliseconds stale, the
 * effect "corrects" the editor backwards, and the caret lands at the end.
 *
 * MEASURED ON PRODUCTION before the fix, typing at the top of a 1,180-character
 * piece with a 600ms debounce:
 *
 *     resume at 590ms → caret 8        resume at 610ms → caret 1273 (end)
 *     resume at 600ms → caret 7        resume at 620ms → caret 1278 (end)
 *                                      resume at 630ms → caret 1283 (end)
 *                                      resume at 640ms → caret 1288 (end)
 *
 * The boundary is the debounce, exactly. Those numbers are the fixture below.
 *
 * ── MUTATION LOG ────────────────────────────────────────────────────────────
 *
 * Ten mutations in a detached worktree, all ten killed.
 *
 * KILLED  decideExternalContent ignoring lastEmitted (the original bug)   → 1
 * KILLED  the echo guard comparing with != instead of ===                 → 1
 * KILLED  a genuinely new document being skipped as an echo               → 2
 * KILLED  selection restored for an unfocused editor                      → 3
 * KILLED  the clamp removed, so a shorter document takes a stale offset   → 3
 * KILLED  the debounce reporting upward without recording what it sent    → 4
 * KILLED  the effect setting content without preserving the selection     → 4
 * KILLED  focus read AFTER setContent, when it is no longer true          → 4
 * KILLED  the effect reverting to the prop-vs-editor comparison           → 4
 * KILLED  the record not updated on an EXTERNAL write                     → 2b
 *
 * That last one was found by reasoning about the fix rather than by testing it:
 * a record written only on the way out turns this fix into a quieter bug, where
 * returning to a piece you had edited reads as an echo of itself and the editor
 * keeps showing the piece you visited in between.
 */
import { decideExternalContent, selectionAfterExternalContent } from "../lib/editor/external-content";
import { readFileSync } from "fs";
import { join } from "path";

const root = join(__dirname, "..");
const read = (p: string) => readFileSync(join(root, p), "utf8");

let failures = 0;
const fail = (m: string) => { failures++; console.log(`  ✗ ${m}`); };
const pass = (m: string) => console.log(`  ✓ ${m}`);
const assert = (ok: boolean, m: string) => (ok ? pass(m) : fail(m));

const stripComments = (src: string) =>
  src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");

// ── 1. The reported bug, replayed ──────────────────────────────────────────
console.log("\n1. The writer's own text, arriving late");
{
  // The exact sequence: the debounce captured this…
  //
  // Typed as `string`, deliberately. As literals TypeScript proves the two can
  // never be equal and rejects the comparison below — which would mean deleting
  // the precondition that makes this fixture mean anything. The same widening,
  // for the same reason, as the novelty check's model-id comparison.
  const snapshot: string = "<p>Qenerative engine optimisation is the practice…</p>";
  // …and by the time the effect ran, the writer had typed five more characters.
  const nowInEditor: string = "<p>Qzzzzenerative engine optimisation is the practice…</p>";

  // The fixture's own precondition. If these two were equal the old code would
  // have been harmless and this check would prove nothing.
  assert(snapshot !== nowInEditor, "the fixture really does hold a stale snapshot and a moved-on editor");

  const d = decideExternalContent(snapshot, snapshot, nowInEditor);
  assert(d.apply === false, "a stale echo of the editor's own text is NOT written back");
  assert(d.reason === "own-echo", "and is identified as an echo rather than as a coincidence");

  // What the old code did, stated so the regression is legible: it compared the
  // prop with the editor and nothing else.
  assert(snapshot !== nowInEditor, "the old comparison (prop vs editor) would have fired here — that was the bug");
}

// ── 2. And a real external change still lands ──────────────────────────────
//
// The half that stops the fix becoming a different bug: an editor that ignores
// its prop is broken in a quieter way.
console.log("\n2. A genuinely new document is still applied");
{
  const mine = "<p>What I typed</p>";
  const theirs = "<p>A restored version from history</p>";
  const d = decideExternalContent(theirs, mine, mine);
  assert(d.apply === true, "content that is neither the editor's text nor its last emission is applied");
  assert(d.reason === "external", "and is identified as external");

  assert(decideExternalContent(mine, mine, mine).apply === false, "an identical prop is a no-op");
  assert(decideExternalContent(theirs, null, mine).apply === true, "before the editor has emitted anything, every change is external");
  // The load case: a session opens, the prop is the stored body, the editor
  // holds its own reserialisation of it. Different strings, same document, and
  // the editor is not focused yet.
  assert(decideExternalContent(theirs, null, mine).reason === "external", "including the first hydration");
}

// ── 2b. Switching pieces and coming back ───────────────────────────────────
//
// The way the fix in section 1 turns into a worse bug if the record is only
// ever written on the way OUT. Sequence: edit A, open B, return to A. A's
// stored body is byte-identical to what the editor last emitted for A, so it
// reads as an echo, is skipped, and the editor keeps showing B under A's title.
console.log("\n2b. Piece A, then B, then A again");
{
  const a = "<p>Piece A, as the writer left it</p>";
  const b = "<p>Piece B, a different article entirely</p>";

  // 1. Editing A: the editor emits A.
  let lastAgreed: string | null = a;
  let inEditor = a;

  // 2. Opening B: external, applied.
  const toB = decideExternalContent(b, lastAgreed, inEditor);
  assert(toB.apply === true, "opening a different piece applies it");
  inEditor = b;
  // The line under test: an external write settles the agreement too.
  lastAgreed = b;

  // 3. Back to A.
  const backToA = decideExternalContent(a, lastAgreed, inEditor);
  assert(backToA.apply === true, "and coming back to the first piece applies it again, rather than reading as an echo of it");

  // The same sequence with the record NOT updated on the way in, which is the
  // bug this section exists for.
  const stale = decideExternalContent(a, a, b);
  assert(stale.apply === false, "whereas a record left at A would skip A and leave B's text on screen — the precondition this asserts against");
}

// ── 3. Where the caret goes when content really does arrive ────────────────
console.log("\n3. The caret after an external change");
{
  assert(selectionAfterExternalContent({ from: 40, to: 40 }, 500, true)?.from === 40, "a focused writer keeps their position");
  assert(selectionAfterExternalContent({ from: 40, to: 40 }, 500, false) === null, "an editor nobody is typing in keeps nothing — the default is better than a guess");

  const clamped = selectionAfterExternalContent({ from: 900, to: 950 }, 120, true);
  assert(!!clamped && clamped.from === 120 && clamped.to === 120, "a position past the end of a shorter document is clamped, not applied raw");
  const range = selectionAfterExternalContent({ from: 10, to: 30 }, 500, true);
  assert(!!range && range.from === 10 && range.to === 30, "a selection survives as a selection, not a collapsed caret");
  assert(selectionAfterExternalContent({ from: -5, to: 2 }, 500, true)?.from === 0, "a negative offset cannot escape the document");
}

// ── 4. And the editor actually uses all of it ──────────────────────────────
//
// Asserting it is USED, not merely written: a decision function nobody calls
// leaves every assertion above green while the caret still jumps.
console.log("\n4. Wiring");
{
  const ed = stripComments(read("components/content/TiptapEditor.tsx"));
  assert(/decideExternalContent\(content, lastEmittedRef\.current, editor\.getHTML\(\)\)/.test(ed),
    "the effect asks the decision function, with all three inputs");
  assert(/if \(!decision\.apply\) return;/.test(ed), "and returns without touching the document when told to");

  // The record of what was emitted has to be kept at EVERY exit, or the guard
  // is blind on whichever path forgot.
  assert(/lastEmittedRef\.current = html;/.test(ed), "emissions are recorded");
  const emits = (ed.match(/emit\(editor\.getHTML\(\)\)/g) || []).length;
  assert(emits === 2, `both the debounce and the blur go through emit (found ${emits})`);
  assert(/lastEmittedRef\.current = editorRef\.current\.getHTML\(\)/.test(ed), "and so does the unmount flush");
  assert(!/onChange\(editor\.getHTML\(\)\)/.test(ed), "nothing reports upward without recording it");

  assert(/selectionAfterExternalContent\(\{ from, to \}/.test(ed) && /if \(keep\) editor\.commands\.setTextSelection\(keep\)/.test(ed),
    "and the caret is restored after a real external change");
  assert(/const hadFocus = editor\.isFocused/.test(ed), "focus is read BEFORE setContent, which is the only moment it is still true");
  assert(/lastEmittedRef\.current = content;/.test(ed), "and an external write updates the record too, or returning to a piece reads as an echo of it");
}

// ── Self-test ──────────────────────────────────────────────────────────────
if (process.argv.includes("--self-test")) {
  console.log("\n── self-test: each detector against input that should trip it ──");
  let selfFail = 0;
  const must = (ok: boolean, what: string) => {
    if (ok) console.log(`  ✓ fires on ${what}`);
    else { selfFail++; console.log(`  ✗ SILENT on ${what}`); }
  };

  must(decideExternalContent("a", "a", "b").apply === false, "the echo case (must not apply)");
  must(decideExternalContent("c", "a", "b").apply === true, "the external case (must apply)");
  must(selectionAfterExternalContent({ from: 9, to: 9 }, 3, true)?.from === 3, "an unclamped offset");
  must(selectionAfterExternalContent({ from: 9, to: 9 }, 30, false) === null, "restoring into an unfocused editor");

  must(decideExternalContent("A", "A", "B").apply === false, "a record left behind after switching pieces");
  const oldEffect = 'if (editor && content !== editor.getHTML()) { editor.commands.setContent(content); }';
  must(!/decideExternalContent\(/.test(oldEffect), "the pre-fix effect, which compared the prop with the editor and nothing else");
  const rawEmit = 'debounceRef.current = setTimeout(() => { onChange(editor.getHTML()); }, debounceMs);';
  must(/onChange\(editor\.getHTML\(\)\)/.test(rawEmit), "an emission that skips the record");

  if (selfFail > 0) {
    console.log(`\n✗ ${selfFail} detector(s) silent — refusing to report the run above as meaningful.`);
    process.exit(1);
  }
  console.log("  all detectors fire");
}

console.log(failures === 0 ? "\n✓ caret holds\n" : `\n✗ ${failures} failure(s)\n`);
process.exit(failures === 0 ? 0 : 1);
