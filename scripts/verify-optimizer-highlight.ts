/**
 * Do highlights survive the writer, and does Apply replace the right words?
 *
 * The decoration plugin has one job that cannot be checked by looking at it:
 * every range must ride through every transaction the writer generates, and a
 * range that no longer covers what the judge quoted must stop being a highlight
 * rather than start pointing at whatever moved into its place.
 *
 * Getting that wrong does not throw. It puts a highlight over the wrong
 * sentence and then, on Apply, rewrites it. So the assertions here are mostly
 * about REFUSING again: after an edit inside a span, after a deletion, after
 * text drifts under a mapped range.
 *
 * Runs headlessly against a real ProseMirror EditorState — no browser, no
 * jsdom. The plugin is exercised through actual transactions, because a test
 * that calls the reducer directly would not prove the plugin is wired to it.
 *
 *   npx tsx scripts/verify-optimizer-highlight.ts
 *
 * MUTATION LOG — every entry actually run, in a throwaway git worktree and
 * never the shared tree (vercel deploy --prod uploads the working directory):
 *   2026-08-21  reducer skips tr.mapping entirely  → 3 failures, exit 1  ✓
 *   2026-08-21  deleted ranges kept as active      → 1 failure,  exit 1  ✓
 *   2026-08-21  applyFinding skips revalidation    → 1 failure,  exit 1  ✓
 *   (baseline, unmutated: 0 failures, exit 0)
 *
 * The third is the one to re-run on any change to Apply. Skipping revalidation
 * looks harmless — the range mapped, so it must still be right — and it is the
 * change that makes Apply overwrite the writer's own edit with a rewrite of
 * what the text used to say.
 */
import { getSchema } from "@tiptap/core";
import StarterKit from "@tiptap/starter-kit";
import { EditorState } from "@tiptap/pm/state";
import {
  OptimizerHighlight, optimizerHighlightKey, applyFinding, anchorFindings,
} from "../lib/optimizer/highlight-plugin";
import type { HighlightFinding } from "../lib/optimizer/highlight-plugin";

let failures = 0;
const fail = (m: string, detail?: string) => {
  failures++;
  console.log(`  FAIL  ${m}`);
  if (detail) console.log(`        ${detail}`);
};
const pass = (m: string) => console.log(`  ok    ${m}`);

const extensions = [StarterKit.configure({ heading: { levels: [1, 2, 3] } }), OptimizerHighlight] as any;
const schema = getSchema(extensions);

function para(text: string) { return { type: "paragraph", content: [{ type: "text", text }] }; }

const DOC_JSON = {
  type: "doc",
  content: [
    para("Authorisation rates improve once a fallback route is live."),
    para("Merchants below five million rarely recover the cost."),
    para("The final paragraph carries the proof."),
  ],
};

const FINDING: HighlightFinding = {
  id: "f1",
  criterion: "unsourced-absolute-claims",
  severity: "high",
  quote: "Merchants below five million rarely recover the cost.",
  explanation: "an absolute claim carrying no source",
  suggestedEdit: "Merchants below five million rarely recover the cost, according to Kessler Institute modelling.",
};

/** A real EditorState with the plugin installed, findings loaded. */
function freshState(findings: HighlightFinding[] = [FINDING]) {
  const plugins: any[] = [];
  const ext = OptimizerHighlight as any;
  const built = ext.config.addProseMirrorPlugins.call({ editor: null, options: {}, storage: {} });
  for (let i = 0; i < built.length; i++) plugins.push(built[i]);

  let state = EditorState.create({ schema, doc: schema.nodeFromJSON(DOC_JSON), plugins });
  state = state.apply(state.tr.setMeta(optimizerHighlightKey, { type: "set", findings }));
  return state;
}

/** Minimal editor shim: applyFinding needs a state and a dispatch. */
function editorFor(initial: EditorState) {
  let state = initial;
  return {
    get state() { return state; },
    view: { dispatch: (tr: any) => { state = state.apply(tr); } },
  };
}

console.log("\nverify-optimizer-highlight\n");

// ── 1. Anchoring and decorating ──────────────────────────────────────────

console.log("1. A finding becomes a decoration over its own words");
{
  const state = freshState();
  const st = optimizerHighlightKey.getState(state);
  if (!st) { fail("the plugin has no state — it is not installed"); }
  else {
    st.issues.length === 1 && st.issues[0].status === "active"
      ? pass("the finding anchored and is active")
      : fail(`issues=${st.issues.length} status=${st.issues[0]?.status}`);

    const covered = state.doc.textBetween(st.issues[0].from, st.issues[0].to, "\n\n", " ");
    covered === FINDING.quote
      ? pass("the decorated range covers exactly the quoted text")
      : fail(`the range covers ${JSON.stringify(covered)}`, `wanted ${JSON.stringify(FINDING.quote)}`);

    const decos = (st.decorations as any).find();
    decos.length === 1
      ? pass("one decoration rendered")
      : fail(`${decos.length} decorations rendered, expected 1`);
  }
}

// ── 2. Surviving the writer ──────────────────────────────────────────────

console.log("\n2. Highlights ride through edits elsewhere");
{
  const state = freshState();
  const before = optimizerHighlightKey.getState(state)!.issues[0];

  // Insert a whole sentence ABOVE the highlight. Raw offsets would rot here.
  const after = state.apply(state.tr.insertText("A brand new opening sentence. ", 1));
  const st = optimizerHighlightKey.getState(after)!;
  const issue = st.issues[0];

  if (issue.status !== "active") {
    fail("an edit ABOVE the highlight orphaned it", "The range was not mapped through the transaction.");
  } else {
    const covered = after.doc.textBetween(issue.from, issue.to, "\n\n", " ");
    covered === FINDING.quote
      ? pass(`inserting above shifted the range (${before.from}→${issue.from}) and it still covers the quote`)
      : fail(`after an edit above, the range covers ${JSON.stringify(covered)}`,
             "This is the wrong-sentence highlight: it looks fine and Apply would rewrite the wrong words.");
  }

  // Typing INSIDE a different paragraph must not disturb it either.
  const after2 = after.apply(after.tr.insertText(" Extra.", after.doc.content.size - 2));
  const issue2 = optimizerHighlightKey.getState(after2)!.issues[0];
  issue2.status === "active" && after2.doc.textBetween(issue2.from, issue2.to, "\n\n", " ") === FINDING.quote
    ? pass("typing in a later paragraph leaves it intact")
    : fail("an edit below the highlight disturbed it");
}

// ── 3. Refusing when the text under it changes ───────────────────────────

console.log("\n3. Editing the highlighted text itself orphans it");
{
  const state = freshState();
  const issue = optimizerHighlightKey.getState(state)!.issues[0];

  // Delete a word from the middle of the highlighted span.
  const cut = state.apply(state.tr.delete(issue.from + 10, issue.from + 16));
  const st = optimizerHighlightKey.getState(cut)!;
  const now = st.issues[0];

  // It may still map (the ends survived) — which is exactly why Apply
  // revalidates rather than trusting the mapping.
  const ed = editorFor(cut);
  const result = applyFinding(ed as any, "f1");
  result.ok === false && result.reason === "drifted"
    ? pass("Apply refuses when the text under the range is no longer what was quoted")
    : fail(`Apply returned ${JSON.stringify(result)} after the span was edited`,
           "Mapping survival is not validity. Replacing here discards the writer's own edit.");
  void now;

  // Deleting the whole span must orphan it outright.
  const gone = state.apply(state.tr.delete(issue.from, issue.to));
  const goneIssue = optimizerHighlightKey.getState(gone)!.issues[0];
  goneIssue.status === "orphaned"
    ? pass("deleting the whole span orphans the finding")
    : fail(`status after deleting the span is ${goneIssue.status}`,
           "A highlight over text that no longer exists points at whatever moved into its place.");
}

// ── 4. Apply ─────────────────────────────────────────────────────────────

console.log("\n4. Apply replaces the right words, in one undo step");
{
  const state = freshState();
  const ed = editorFor(state);
  const result = applyFinding(ed as any, "f1");

  if (!result.ok) {
    fail(`Apply failed on a clean document: ${result.reason}`);
  } else {
    const text = ed.state.doc.textBetween(0, ed.state.doc.content.size, "\n\n", " ");
    text.indexOf(FINDING.suggestedEdit!) >= 0
      ? pass("the replacement text is in the document")
      : fail("the replacement is not in the document");
    text.indexOf(FINDING.quote) < 0
      ? pass("the original quoted text is gone")
      : fail("the original text survived alongside the replacement");

    // The neighbours must be untouched — a loose edge eats a block boundary.
    text.indexOf("Authorisation rates improve once a fallback route is live.") >= 0 &&
    text.indexOf("The final paragraph carries the proof.") >= 0
      ? pass("the surrounding paragraphs are untouched")
      : fail("Apply damaged a neighbouring paragraph", "A range whose edges are not tight eats block boundaries.");

    const st = optimizerHighlightKey.getState(ed.state)!;
    st.issues[0].status === "resolved"
      ? pass("the finding is marked resolved in the same transaction")
      : fail(`status after Apply is ${st.issues[0].status}`,
             "A separate transaction would let undo restore the text without the highlight, or vice versa.");
  }

  // Applying twice must not double-apply.
  const second = applyFinding(ed as any, "f1");
  second.ok === false && second.reason === "not-active"
    ? pass("applying an already-resolved finding is refused")
    : fail(`a second Apply returned ${JSON.stringify(second)}`);
}

// ── 5. Findings with nothing to apply ────────────────────────────────────

console.log("\n5. Findings that cannot be applied");
{
  const noEdit: HighlightFinding = { ...FINDING, id: "f2", suggestedEdit: null };
  const state = freshState([noEdit]);
  const ed = editorFor(state);
  const r = applyFinding(ed as any, "f2");
  r.ok === false && r.reason === "no-replacement"
    ? pass("an explanation-only finding has no Apply, but still anchors")
    : fail(`explanation-only Apply returned ${JSON.stringify(r)}`);

  optimizerHighlightKey.getState(state)!.issues[0].status === "active"
    ? pass("it is still highlighted — no rewrite does not mean no issue")
    : fail("an explanation-only finding was not highlighted");

  const unknown = applyFinding(editorFor(state) as any, "does-not-exist");
  unknown.ok === false && unknown.reason === "unknown"
    ? pass("an unknown id is refused rather than throwing")
    : fail("an unknown id was not handled");
}

// ── 6. Overlap and orphans at anchor time ────────────────────────────────

console.log("\n6. Overlapping and unanchorable findings");
{
  const nested: HighlightFinding = {
    ...FINDING, id: "f-short", quote: "rarely recover", suggestedEdit: "seldom recover",
  };
  const issues = anchorFindings(schema.nodeFromJSON(DOC_JSON), [FINDING, nested]);
  const long = issues.filter((i) => i.finding.id === "f1")[0];
  const short = issues.filter((i) => i.finding.id === "f-short")[0];
  long.status === "active" && short.status === "orphaned"
    ? pass("a nested shorter quote yields to the longer finding it sits inside")
    : fail(`long=${long.status} short=${short.status}`,
           "Two highlights over one sentence means one Apply edits what the other described.");

  const missing: HighlightFinding = { ...FINDING, id: "f-gone", quote: "a sentence that is not in this document" };
  const gone = anchorFindings(schema.nodeFromJSON(DOC_JSON), [missing]);
  gone[0].status === "orphaned" && gone.length === 1
    ? pass("an unanchorable finding is returned as an orphan, not dropped")
    : fail("an unanchorable finding was dropped rather than orphaned",
           "The finding is still true; only its location is lost.");
}

console.log(failures ? `\n${failures} FAILURE(S)\n` : `\nAll checks passed.\n`);
process.exit(failures ? 1 : 0);
