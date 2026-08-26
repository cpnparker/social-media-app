/**
 * Guards the Writer's Discuss panel — the conversation held beside the draft.
 *
 * Run: npx tsx scripts/verify-optimizer-discuss.ts --self-test
 *
 * ── WHAT IS ACTUALLY AT RISK HERE ───────────────────────────────────────────
 *
 * Three things, none of which a type-checker can see:
 *
 *   THE PROMPT COSTS. The draft is attached to the current turn and stripped
 *   from history. Storing the built turn instead of the bare question would
 *   grow every later prompt by the length of the article, silently, and invite
 *   answers about versions since rewritten. Nothing about that is a type error.
 *
 *   THE INSERT BUTTON. A ```draft fence is a button in somebody's editor. If
 *   the parser treats every fence as insertable, a JSON example ends up in an
 *   article; if it treats a half-arrived fence as a block, the button flickers
 *   over a partial sentence.
 *
 *   THE SEPARATION. The Writer's rail must not grow a Score tab. That is the
 *   exact merge this ship exists to undo, and it would re-merge by someone
 *   adding one line to a tab list.
 *
 * ── MUTATION LOG ────────────────────────────────────────────────────────────
 *
 * KILLED  removing `while (out[0].role !== "user")` from trimForPrompt        → check 2
 * KILLED  storing buildDiscussTurn(...) instead of `question` in the route    → check 5
 * KILLED  matching /```/ instead of /```draft/ in parseDiscussReply           → check 3
 * KILLED  escaping AFTER paragraphing in draftBlockToHtml                     → check 4
 * KILLED  adding {key:"score"} to the writer's tab list                       → check 7
 * KILLED  restoring `await fetch(fileUrl)` in the sources upload branch       → check 8
 * WIDENED  the kill above was genuine — the code that shipped was
 *           `await fetch(fileUrl)`, which the old /fetch\(\s*fileUrl/ detector
 *           did match. But it pinned ONE SPELLING, and the most natural way to
 *           reintroduce the bug, `fetch(body.fileUrl)`, escaped it, as did any
 *           rename. Check 8 now asserts the PROPERTY — no bare fetch() anywhere
 *           in the route — which holds however the bug is written. The
 *           distinction is worth the words: the log was accurate, the detector
 *           was narrow, and only one of those needed fixing.
 * KILLED  a Score tab pushed BEFORE the writer branch (the section-7 blind spot) → check 7
 * SURVIVED  deleting the `.trim()` in buildDiscussTurn's question — the model
 *           is unaffected by trailing whitespace on a question, and no
 *           assertion depends on it. Recorded rather than tidied away: it is a
 *           finding about the check, not an omission.
 */
import { railTabsFor, defaultRailTab } from "../lib/optimizer/rail-tabs";
import {
  trimForPrompt,
  trimForStorage,
  parseDiscussReply,
  draftBlockToHtml,
  draftBlockToInlineHtml,
  buildDiscussSystem,
  buildDiscussTurn,
  linkAnchors,
  readTurns,
  DISCUSS_PROMPT_TURNS,
  DISCUSS_STORED_TURNS,
  type DiscussTurn,
} from "../lib/optimizer/discuss";
import { readFileSync } from "fs";
import { join } from "path";

const root = join(__dirname, "..");
const read = (p: string) => readFileSync(join(root, p), "utf8");

let failures = 0;
const fail = (msg: string) => { failures++; console.log(`  ✗ ${msg}`); };
const pass = (msg: string) => console.log(`  ✓ ${msg}`);
const assert = (ok: boolean, msg: string) => (ok ? pass(msg) : fail(msg));

/** Comments are prose about code, not code. A detector that reads them reports
 *  a rule as present because somebody described it. */
function stripComments(src: string): string {
  return src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
}

/**
 * ONE function's body, bounded at the next top-level export.
 *
 * Slicing to the end of the file instead is how check 6 first reported a
 * failure: DELETE is declared above POST, so "does DELETE touch the draft?"
 * was reading POST's code. A detector whose window is wrong is not a stricter
 * detector, it is a detector answering a different question.
 */
function functionBody(src: string, name: string): string {
  const head = src.indexOf(`export async function ${name}(`);
  if (head < 0) return "";
  const next = src.indexOf("\nexport ", head + 1);
  return next < 0 ? src.slice(head) : src.slice(head, next);
}

/** The region that WRITES the conversation back, not the one that builds the
 *  prompt. Both mention a user turn; only one of them persists it. */
function storageRegion(src: string): string {
  const at = src.indexOf("trimForStorage(");
  if (at < 0) return "";
  const end = src.indexOf(".eq(\"id_session\"", at);
  return end < 0 ? src.slice(at) : src.slice(at, end);
}

const turn = (role: "user" | "assistant", content: string): DiscussTurn => ({ role, content, at: "" });

// ── 1. Storage keeps the tail, and is bounded ──────────────────────────────
console.log("\n1. History bounds");
{
  const many: DiscussTurn[] = [];
  for (let i = 0; i < DISCUSS_STORED_TURNS + 10; i++) many.push(turn(i % 2 ? "assistant" : "user", `m${i}`));
  const stored = trimForStorage(many);
  assert(stored.length === DISCUSS_STORED_TURNS, `storage capped at ${DISCUSS_STORED_TURNS}`);
  assert(
    stored[stored.length - 1].content === many[many.length - 1].content,
    "the newest exchange survives — trimming from the front would drop what they are reading"
  );
  assert(trimForPrompt(many).length <= DISCUSS_PROMPT_TURNS, `prompt window capped at ${DISCUSS_PROMPT_TURNS}`);
}

// ── 2. The prompt never opens on an assistant turn ─────────────────────────
//
// A naive tail slice produces one half the time, and every provider this app
// routes to rejects or mishandles it. The failure is a 400 at a random point in
// a working conversation, which reads as "the assistant is broken".
console.log("\n2. Prompt shape");
{
  let bad = 0;
  for (let n = 1; n <= DISCUSS_PROMPT_TURNS + 6; n++) {
    const conv: DiscussTurn[] = [];
    for (let i = 0; i < n; i++) conv.push(turn(i % 2 === 0 ? "user" : "assistant", `m${i}`));
    const out = trimForPrompt(conv);
    if (out.length > 0 && out[0].role !== "user") bad++;
  }
  assert(bad === 0, "no conversation length produces a prompt starting on an assistant turn");
  assert(trimForPrompt([turn("assistant", "orphan")]).length === 0, "a lone assistant turn yields nothing, not a bad array");
  assert(readTurns([{ role: "nonsense" }, null, { role: "user", content: "" }, { role: "user", content: "ok" }]).length === 1,
    "a malformed jsonb row degrades to the usable turns rather than throwing");
}

// ── 3. Only ```draft is insertable ─────────────────────────────────────────
console.log("\n3. Parsing what is offered for the piece");
{
  const a = parseDiscussReply("Try this:\n```draft\nA sharper opening.\n```\nIt is shorter.");
  assert(a.drafts.length === 1 && a.drafts[0] === "A sharper opening.", "a closed draft fence is extracted");
  assert(a.commentary.indexOf("A sharper opening") < 0, "the block does not also remain in the prose");
  assert(a.commentary.indexOf("It is shorter") >= 0, "prose after the block survives");

  const b = parseDiscussReply('Here is the shape:\n```json\n{"a":1}\n```\nUse that.');
  assert(b.drafts.length === 0, "a ```json example is NOT offered for the article");

  const c = parseDiscussReply("Working on it:\n```draft\nHalf a sen");
  assert(c.drafts.length === 0, "an UNCLOSED fence yields no block — that is every reply mid-stream");

  const d = parseDiscussReply("```draft\nOne.\n```\nand\n```draft\nTwo.\n```");
  assert(d.drafts.length === 2 && d.drafts[1] === "Two.", "two blocks both survive, in order");

  const e = parseDiscussReply("Just commentary, no fence.");
  assert(e.drafts.length === 0 && e.commentary === "Just commentary, no fence.", "commentary alone offers no button");

  // ── ORDER. The assertion this check did not have. ────────────────────────
  //
  // The flat {commentary, drafts} shape passed every assertion above while
  // rendering prose-then-blocks on screen, so a reply shaped
  // prose → block → prose showed a sentence ending ":" above nothing, and the
  // sentence that referred BACK to the block printed above it. Both obvious
  // properties held; the only thing that made the reply readable did not.
  // Found by reading the screen. Pinned here so it cannot come back.
  const ordered = parseDiscussReply(
    "Delete the setup and you lose nothing:\n```draft\nFundamentally, it is useful.\n```\nThough that is still a soft landing."
  );
  assert(ordered.segments.length === 3, "a prose→block→prose reply yields three segments");
  assert(
    ordered.segments[0].type === "text" &&
      ordered.segments[1].type === "draft" &&
      ordered.segments[2].type === "text",
    "the segments are IN THE ORDER the model wrote them"
  );
  assert(/lose nothing:$/.test(ordered.segments[0].text), "the lead-in stays above the block it introduces");
  assert(/^Though that/.test(ordered.segments[2].text), "the follow-on stays below the block it refers back to");
  assert(ordered.drafts.length === 1 && ordered.commentary.indexOf("Fundamentally") < 0,
    "the derived flat fields still behave, but they are not the rendering order");
}

// ── 3b. Anchors: the conversation pointing at the draft ───────────────────
console.log("\n3b. Anchors");
{
  const r = parseDiscussReply(
    "Two things.\n```anchor\nIOE speaks for business across the multilateral system.\n```\nYou never say what they should do differently.\n```anchor\nWe are the best in the market.\n```\n```draft\nWe grew thirty accounts in four years.\n```"
  );
  assert(r.segments.length === 3, "an anchor is folded into what it introduces, not left as a segment");
  assert(r.segments[0].anchor === undefined, "prose before any anchor carries none");
  assert(r.segments[1].anchor === "IOE speaks for business across the multilateral system.",
    "the anchor binds FORWARD, to the point it introduces");
  assert(r.segments[2].type === "draft" && r.segments[2].anchor === "We are the best in the market.",
    "a rewrite carries the passage it was written for");
  assert(r.commentary.indexOf("IOE speaks for business") < 0,
    "the quoted passage is NOT rendered as prose — it is the writer's own sentence, shown back to them");

  // Binding backwards is the dangerous mutation: the reply still reads
  // correctly while every Show me points one paragraph off.
  const backwards = (segs: any[]) => {
    const out: any[] = []; let last: any = null;
    for (const seg of segs) { if (seg.type === "anchor") { if (last) last.anchor = seg.text; continue; } out.push(seg); last = seg; }
    return out;
  };
  const raw = [
    { type: "text", text: "Two things." },
    { type: "anchor", text: "A." },
    { type: "text", text: "The point about A." },
  ] as any[];
  assert(linkAnchors(raw)[1].anchor === "A.", "linkAnchors binds to the FOLLOWING segment");
  assert(backwards(raw.slice())[0].anchor === "A.", "(the backwards mutation is distinguishable)");

  // ── THE SHAPE THE MODEL ACTUALLY WRITES ─────────────────────────────────
  //
  // Observed live, not imagined: asked to quote a sentence and improve it, the
  // model wrote [anchor][reasoning][rewrite]. Binding to the immediately
  // following segment gave the anchor to the REASONING and left the rewrite
  // unanchored, so the button read "Add to the end" and would have appended a
  // replacement paragraph to the foot of the document. The original fixture put
  // the anchor directly before the draft block, which the model had no reason
  // to do — a fixture written to match the implementation rather than reality.
  const realShape = parseDiscussReply(
    "```anchor\nIn our experience, the companies that win answer real questions.\n```\n" +
    "\"In our experience\" is the tell — it signals opinion where you have data.\n" +
    "```draft\nOur 2026 study of 412 B2B pages found they were cited 3.4x more often.\n```\n" +
    "That replaces the claim with evidence."
  );
  const rewrite = realShape.segments.filter((x) => x.type === "draft")[0];
  assert(!!rewrite && rewrite.anchor === "In our experience, the companies that win answer real questions.",
    "an anchor reaches the REWRITE even when reasoning sits between them");
  assert(realShape.segments.every((x) => !!x.anchor),
    "an anchor scopes every point that follows it, until the next anchor");

  const twoSubjects = parseDiscussReply(
    "```anchor\nFirst passage.\n```\nAbout the first.\n```anchor\nSecond passage.\n```\nAbout the second."
  );
  assert(twoSubjects.segments[0].anchor === "First passage." &&
         twoSubjects.segments[1].anchor === "Second passage.",
    "a second anchor changes the subject rather than accumulating");

  const trailing = parseDiscussReply("A point.\n```anchor\nDangling quote.\n```");
  assert(trailing.segments.length === 1 && !trailing.segments[0].anchor,
    "a trailing anchor with nothing after it is dropped, not shown as commentary");

  const unclosed = parseDiscussReply("Look at\n```anchor\nhalf a quo");
  assert(!unclosed.segments.some((x) => x.type === "anchor"),
    "an unclosed anchor fence yields no anchor — that is every reply mid-stream");

  const mixed = parseDiscussReply("```draft\nX\n```\n```anchor\nY\n```\nAbout Y.");
  assert(mixed.drafts.length === 1 && mixed.drafts[0] === "X",
    "an anchor is never mistaken for insertable text");
}

// ── 3c. The instruction the anchors depend on ─────────────────────────────
console.log("\n3c. The assembled prompt");
{
  const sys = buildDiscussSystem({ title: "T", format: "article", grounding: "# Background material\nNone." });
  assert(sys.indexOf("```anchor") >= 0, "the anchor fence is named in the prompt");
  assert(/verbatim from the draft/i.test(sys), "it must be copied verbatim, or it cannot be found");
  // The rule sits INSIDE the block that governs fences, not appended elsewhere.
  // CLAUDE.md: a new rule beside a contradicting old one changes nothing, which
  // is why the voice check reads the ASSEMBLED prompt rather than the diff.
  const anchorAt = sys.indexOf("```anchor");
  const draftAt = sys.indexOf("# Text meant FOR the draft");
  const pieceAt = sys.indexOf("# The piece");
  assert(anchorAt > 0 && draftAt > 0 && anchorAt < draftAt,
    "the anchor rule sits beside the draft-fence contract, before it");
  assert(pieceAt > draftAt, "both fence rules precede the grounding, in one block");
  assert(/whole[\s\S]{0,80}nothing to underline/i.test(sys) || /piece as a whole/i.test(sys),
    "whole-piece criticism is told to stay prose — inventing an anchor for it sends the writer somewhere wrong with a confident label");
}

// ── 4. Escaping happens BEFORE paragraphing ────────────────────────────────
console.log("\n4. Text into the editor");
{
  const html = draftBlockToHtml('Margins under <10% are thin.\n\nSo is "growth" & scale.');
  assert(html.indexOf("&lt;10%") >= 0, "an angle bracket is escaped, not treated as a tag");
  assert(html.indexOf("&amp;") >= 0, "an ampersand is escaped");
  assert((html.match(/<p>/g) || []).length === 2, "a blank line becomes a second paragraph");
  // The ordering bug: paragraph first and the <p> tags themselves get escaped,
  // so the writer gets literal "&lt;p&gt;" in their article.
  assert(html.indexOf("&lt;p&gt;") < 0, "the paragraph tags are NOT themselves escaped");
  assert(draftBlockToHtml("   ") === "", "an empty block produces nothing to insert");

  // ── Replacing INSIDE a paragraph must not break the paragraph ────────────
  //
  // draftBlockToHtml wraps in <p>, which Tiptap parses as a BLOCK — so
  // inserting it over a sentence inside a paragraph split that paragraph in
  // three and left a blank line either side. Reported on a live cover letter.
  const inline = draftBlockToInlineHtml("Margins under <10% are thin.\nSecond line.");
  assert(inline.indexOf("<p>") < 0, "the inline form emits NO block tag — that is the paragraph break");
  assert(inline.indexOf("&lt;10%") >= 0, "it escapes before it structures, like its sibling");
  assert(inline.indexOf("<br>") >= 0, "a single newline stays a line break");
  assert(draftBlockToHtml("a\n\nb").indexOf("<p>") >= 0,
    "the block form is still there for replacements that ARE paragraphs");

  const page = stripComments(read("app/engineai/optimizer/page.tsx"));
  assert(/sameParent\(/.test(page),
    "the page chooses inline vs block by whether the range sits inside ONE text block");
  assert(/type: "flash"/.test(page),
    "a replacement announces itself — a change several paragraphs away is one you would have to hunt for");
}

// ── 5. The draft rides on the current turn, never in history ───────────────
//
// Asserted on the ROUTE, because this is a property of what gets STORED and no
// pure function can hold it.
console.log("\n5. The draft is not stored in the conversation");
{
  const src = stripComments(read("app/api/optimizer/sessions/[id]/discuss/route.ts"));
  assert(/role:\s*"user",\s*content:\s*question/.test(src.replace(/\s+/g, " ").replace(/ /g, " ")) ||
         /content:\s*question\b/.test(src),
    "the stored user turn is the bare QUESTION");
  const stored = storageRegion(src);
  assert(stored.length > 0, "the storage region is identifiable");
  assert(!/buildDiscussTurn/.test(stored),
    "the built turn — which contains the whole draft — is NOT what gets stored");
  assert(/content:\s*question\b/.test(stored),
    "what IS stored is the bare question");
  assert(/promptTurns\.push\(\s*\{[\s\S]{0,200}buildDiscussTurn/.test(src),
    "the built turn IS what gets sent, on the current turn only");
  assert(/logAiUsage\(/.test(src), "the call is logged — an unlogged call is invisible to the spend cap");
  assert(/assertServiceAllowed\(/.test(src), "the spend gate is applied");
  assert(src.indexOf("systemPrompt") > 0 && /buildGroundingBlock\(/.test(src),
    "grounding comes from the SHARED builder, not a second description of the client");
}

// ── 6. Clearing is reachable ───────────────────────────────────────────────
//
// It shipped as `if (body.clear === true)` BELOW the "ask a question first"
// guard, so clearing required sending a question and sending a question meant
// it was never a clear. It type-checked and read correctly.
console.log("\n6. Clearing the conversation");
{
  const src = stripComments(read("app/api/optimizer/sessions/[id]/discuss/route.ts"));
  assert(/export async function DELETE\(/.test(src), "clear is its own verb, not a flag on POST");
  assert(!/body\.clear/.test(src), "no clear flag survives on POST, where it sat behind the question guard");
  // Bounded at the next export. DELETE sits ABOVE POST in this file, so a
  // slice to end-of-file reads POST's body and answers the wrong question.
  const del = functionBody(src, "DELETE");
  assert(del.length > 0 && del.indexOf("export async function POST") < 0,
    "the DELETE body is bounded — it does not run on into POST");
  assert(/config_chat:\s*\[\]/.test(del), "DELETE empties the conversation");
  assert(!/optimizer_drafts/.test(del), "DELETE does not touch the draft — it clears the talk, never the piece");
  assert(/loadSessionForCaller\(/.test(del), "DELETE checks entitlement");
}

// ── 7. The Writer's rail has no Score tab ──────────────────────────────────
//
// The merge this ship undoes. Re-merging is one line in a tab list.
console.log("\n7. The two rails stay different");
{
  const page = stripComments(read("app/engineai/optimizer/page.tsx"));
  // ── CALLED, not grepped ──────────────────────────────────────────────
  //
  // This was a regex that carved the writer's branch out of the file's text,
  // and it was blind: a t.push({key:"score"}) placed BEFORE the
  // `if (surface === "writer")` gives the Writer a Score tab and never enters
  // the window the regex read. The re-merge this section exists to prevent
  // could ship green. Proven, not theorised — the mutation is in the self-test.
  //
  // Running the function admits no such arrangement.
  const chromes = [
    { showScore: true, showCoverageTab: true },
    { showScore: true, showCoverageTab: false },
    { showScore: false, showCoverageTab: true },
    { showScore: false, showCoverageTab: false },
  ];
  let writerScore = 0;
  let writerCoverage = 0;
  for (let i = 0; i < chromes.length; i++) {
    const keys = railTabsFor("writer", chromes[i], 3).map((t) => t.key);
    if (keys.indexOf("score") >= 0) writerScore++;
    if (keys.indexOf("coverage") >= 0) writerCoverage++;
  }
  assert(writerScore === 0, "the Writer's rail offers NO Score tab, under EVERY chrome combination");
  assert(writerCoverage === 0, "the Writer's rail offers no Coverage tab, under every chrome combination");

  const w = railTabsFor("writer", chromes[0], 3).map((t) => t.key);
  assert(w.indexOf("discuss") >= 0 && w.indexOf("sources") >= 0, "the Writer's rail offers Discuss and Background");
  assert(defaultRailTab("writer", chromes[0]) === "discuss", "the Writer OPENS on the conversation");
  assert(defaultRailTab("optimiser", chromes[0]) === "score", "the Optimiser opens on the number");

  const o = railTabsFor("optimiser", chromes[0], 3).map((t) => t.key);
  assert(o.indexOf("discuss") < 0 && o.indexOf("sources") < 0,
    "the Optimiser's rail does NOT grow the Writer's tabs — the separation cuts both ways");
  assert(railTabsFor("optimiser", chromes[3], 0).map((t) => t.key).join(",") === "issues",
    "with no judge and no coverage the Optimiser is left with Suggestions alone, not an empty rail");

  // And the page must actually USE it, or the function is a decoration and the
  // page keeps its own list.
  assert(/railTabsFor\(/.test(page), "the page calls railTabsFor rather than building its own list");
  // Defence in depth. railTabsFor already makes a score tab unreachable on the
  // Writer, and check 7 proves that by EXECUTION — so this is a second lock on
  // a door that is already shut, not the lock. Worth having because the render
  // branch is the thing a future refactor reaches for first, and it was the
  // only one of the three that read the tab alone.
  assert(/panelTab === "score" && chrome\.showScore && surface !== "writer"/.test(page),
    "the score panel's render branch ALSO tests the surface, not just the tab");
  assert(!/key: "score", label: "Score"/.test(page),
    "no tab list survives inline in the page — one definition, not two");

  assert(/key === panelTab/.test(page) && /setPanelTab\(panelTabs\[0\]\.key\)/.test(page),
    "a tab this surface does not offer is corrected, not left selected under a fallback panel");
  // USED, not merely present. This repo has closed a live hole on the strength
  // of a line existing.
  assert(/<DiscussPanel\b/.test(page), "DiscussPanel is actually rendered");
  assert(/<SourcesPanel\b/.test(page), "SourcesPanel is actually rendered");
  assert(/getDraftHtml=\{getDraftHtml\}/.test(page), "the panel is handed the LIVE draft, not the saved body");
  assert(/editorRef\.current\.getHTML\(\)/.test(page.slice(page.indexOf("const getDraftHtml"), page.indexOf("const getDraftHtml") + 400)),
    "getDraftHtml reads the editor rather than the debounced state");
  assert(/onApply=\{applyDraftText\}/.test(page), "the Apply button is wired to the editor");
  assert(/onRevealQuote=\{revealQuote\}/.test(page), "Show me is wired to the document");
  const dp = stripComments(read("components/optimizer/DiscussPanel.tsx"));
  assert(/askForFix/.test(dp) && /askForPointFix/.test(dp),
    "a fix is offered for BOTH an anchored passage and a whole-piece point — the best criticism often has nothing to underline");
  assert(/onFix=\{answered\[seg\.anchor\] \? undefined : onFix\}/.test(dp),
    "and NOT offered where the point already carries a rewrite");
  assert(/split\(\/\\n\{2,\}\/\)/.test(dp),
    "prose is split per POINT, so a six-point reply gets six actions rather than one");
  assert(/onClick=\{\(\) => ask\(\)\}/.test(dp),
    "the send button calls ask() with no argument — onClick={ask} would pass the MouseEvent as the question");
  assert(/findAnchor\(/.test(page),
    "quotes resolve through the SAME anchor resolver the judge's findings use");
  assert(/anchorQuote/.test(page),
    "an anchored rewrite replaces the passage it was written for, not the selection");
  const route = stripComments(read("app/api/optimizer/sessions/[id]/discuss/route.ts"));
  assert(/parseDraft\(/.test(route) && !/function htmlToText/.test(route),
    "the route sends ParsedDraft.text — one derivation of the document's text, so a returned quote is a quote of the string we search");

  // USED, not merely available. parseDiscussReply still exposes the flat
  // {commentary, drafts} fields, so a panel can go on rendering in the wrong
  // order while the parser is perfectly correct — the ordering bug lived
  // exactly there. Assert the panel reads SEGMENTS, and that neither render
  // path maps over .drafts.
  const panel = stripComments(read("components/optimizer/DiscussPanel.tsx"));
  assert(/\.segments\.map\(/.test(panel), "the panel renders from segments");
  assert(!/\.drafts\.map\(/.test(panel),
    "no render path maps over the flat drafts list — that is the prose-then-blocks bug");
  assert((panel.match(/\.segments\.map\(/g) || []).length >= 2,
    "BOTH the settled and the streaming views render in order, not just one");

  // ── Nothing in the rail may fire a non-error toast ────────────────────────
  //
  // sonner renders bottom-right and so does the rail's composer, so a toast
  // fired from a rail panel lands ON the input the writer is about to type in
  // and swallows their clicks for its lifetime. Measured, not guessed:
  // elementFromPoint at the composer's centre returned the toast element.
  // Confirmation of a state the panel already shows is redundant; errors are
  // not, and are worth interrupting for — so only those may toast.
  const sources = stripComments(read("components/optimizer/SourcesPanel.tsx"));
  const railPanels: [string, string][] = [["DiscussPanel", panel], ["SourcesPanel", sources]];
  for (let i = 0; i < railPanels.length; i++) {
    const [name, src] = railPanels[i];
    const noisy = src.match(/toast\.(success|warning|info|message)\(/g) || [];
    assert(noisy.length === 0,
      `${name} fires no non-error toast over the rail's composer (found ${noisy.length})`);
    assert(/toast\.error\(/.test(src), `${name} still reports genuine errors`);
  }
}

// ── 8. Nothing fetches a caller-supplied address ───────────────────────────
//
// The sources upload branch shipped as fetch(body.fileUrl): a server-side
// request to any address a caller named, whose response was then stored.
console.log("\n8. Background material reaches out safely");
{
  const src = stripComments(read("app/api/optimizer/sessions/[id]/sources/route.ts"));
  // The detector this replaces looked for /fetch\(\s*fileUrl/ — which does NOT
  // match `fetch(body.fileUrl)`, the most natural way to write the very bug,
  // nor any renamed variable. The mutation log claimed that kill; the claim was
  // false, and is corrected in the header. Assert the PROPERTY instead: this
  // route makes no bare outbound fetch at all. Its two legitimate reach-outs go
  // through importFromUrl (guarded) and the blob client (credentialed), neither
  // of which is a bare `fetch(`.
  const bareFetch = src.match(/(?<![.\w])fetch\s*\(/g) || [];
  assert(bareFetch.length === 0,
    `no bare fetch() anywhere in the sources route — found ${bareFetch.length}`);
  assert(/expectedPrefix\s*=\s*`optimizer-uploads\/w\$\{guard\.caller\.workspaceId\}/.test(src),
    "an uploaded file must sit under the CALLER's own workspace prefix");
  assert(/startsWith\(expectedPrefix\)/.test(src) && /indexOf\("\.\."\)/.test(src),
    "the prefix is checked, and traversal refused");
  assert(/importFromUrl\(/.test(src), "the url branch goes through the shared guarded fetch");
  assert(/get\(blobPath,\s*\{\s*access:\s*"private"\s*\}\)/.test(src),
    "blob bytes are read with credentials — the store is private and a plain GET is refused");
}

// ── 9. The model is told to mark text meant for the piece ──────────────────
console.log("\n9. The instruction the button depends on");
{
  const sys = buildDiscussSystem({ title: "T", format: "article", grounding: "# Background material\nNone." });
  assert(sys.indexOf("```draft") >= 0, "the fence is named in the prompt");
  assert(/nothing else inside it/i.test(sys), "the fence is specified as containing ONLY the words for the piece");
  assert(/no fence at all/i.test(sys), "commentary-only answers are told to offer no fence");
  assert(sys.indexOf("# Background material") >= 0, "the grounding is carried into the system block");

  const t = buildDiscussTurn({ draftText: "The draft.", selection: "one line", question: "Tighter?" });
  assert(t.indexOf("The draft.") >= 0 && t.indexOf("Tighter?") >= 0, "draft and question travel together");
  assert(t.indexOf("selected") >= 0 && t.indexOf("one line") >= 0, "a selection is quoted separately, so 'this bit' is not guessed");
  const empty = buildDiscussTurn({ draftText: "", selection: null, question: "Where do I start?" });
  assert(/empty/i.test(empty), "an empty piece says so rather than presenting a blank as the draft");
  const long = buildDiscussTurn({ draftText: "x".repeat(40000), selection: null, question: "q" });
  assert(/TRUNCATED/.test(long), "a truncated draft SAYS it is truncated");
}

// ── Self-test ──────────────────────────────────────────────────────────────
//
// Drives every detector against synthetic bad input. Used rather than
// break-test-restore because this working tree is shared with other sessions
// and also deploys — a deliberate break has reached production from here once.
function selfTest() {
  console.log("\n── self-test: each detector against input it must reject ──");
  let broken = 0;
  const detects = (what: string, fired: boolean) => {
    if (fired) console.log(`  ✓ fires on ${what}`);
    else { broken++; console.log(`  ✗ SILENT on ${what}`); }
  };

  // check 3
  detects("a ```json block treated as insertable",
    parseDiscussReply('```json\n{"a":1}\n```').drafts.length === 0);
  detects("an unclosed fence treated as a block",
    parseDiscussReply("```draft\npartial").drafts.length === 0);
  // check 4 — the ordering bug, simulated
  const wrongOrder = (b: string) =>
    b.split(/\n{2,}/).map((p) => `<p>${p}</p>`).join("")
      .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  detects("escaping after paragraphing (tags escaped into the article)",
    wrongOrder("a<b").indexOf("&lt;p&gt;") >= 0 && draftBlockToHtml("a<b").indexOf("&lt;p&gt;") < 0);
  // check 2 — the naive slice
  const naive = (t: DiscussTurn[]) => t.slice(Math.max(0, t.length - DISCUSS_PROMPT_TURNS));
  const odd: DiscussTurn[] = [];
  for (let i = 0; i < DISCUSS_PROMPT_TURNS + 1; i++) odd.push(turn(i % 2 === 0 ? "user" : "assistant", `m${i}`));
  detects("a naive tail slice opening on an assistant turn",
    naive(odd)[0].role === "assistant" && trimForPrompt(odd)[0].role === "user");
  // check 5 / 6 / 7 / 8 string detectors, against synthetic sources
  detects("a stored turn carrying the built draft",
    /content:\s*buildDiscussTurn/.test("      content: buildDiscussTurn({ draftText, selection, question }),"));
  detects("a clear flag hidden behind the question guard",
    /body\.clear/.test("  if (body.clear === true) {"));
  // Section 7 — behavioural now, so the mutation is applied to the FUNCTION's
  // contract rather than to a string. The blind spot that motivated the change
  // is recorded alongside, so nobody reintroduces the regex thinking it was
  // equivalent.
  detects("a Score tab reaching the writer under any chrome",
    railTabsFor("writer", { showScore: true, showCoverageTab: true }, 0)
      .map((t) => t.key).indexOf("score") < 0);
  {
    const oldWindow = /if \(surface === "writer"\) \{([\s\S]*?)return t;/;
    const bypass =
      '  t.push({ key: "score", label: "Score" });\n' +
      '  if (surface === "writer") {\n    t.push({ key: "discuss" });\n    return t;\n  }';
    const seen = (bypass.match(oldWindow) || [])[1] || "";
    // The old detector was BLIND to this: the Writer gets Score, the window
    // never sees it. Recorded as a live demonstration, not a memory.
    detects("the retired regex being blind to a Score tab pushed before the branch",
      seen.indexOf('key: "score"') < 0);
  }

  // Section 8 — the property, against every spelling the old regex missed.
  {
    const bare = (src: string) => (src.match(/(?<![.\w])fetch\s*\(/g) || []).length > 0;
    detects("fetch(fileUrl)", bare("const res = await fetch(fileUrl);"));
    detects("fetch(body.fileUrl) — the spelling the retired regex MISSED",
      bare("const res = await fetch(body.fileUrl);"));
    detects("fetch(body.sourceUrl) — a renamed variable", bare("await fetch(body.sourceUrl)"));
    // And it must NOT fire on the legitimate reach-outs, or check 8 is unusable.
    detects("no false alarm on the guarded url import",
      !bare("const result = await importFromUrl(ref);"));
    detects("no false alarm on a method named fetch on an object",
      !bare("await client.fetch(thing);"));
  }
  detects("a comment being read as code",
    stripComments('// const x = fetch(fileUrl);\nconst y = 1;').indexOf("fileUrl") < 0);
  // The narrowing itself, in BOTH directions. Over-narrowing turns a false
  // positive into a false negative, which is worse: it reports full coverage
  // while seeing nothing. That happened on the previous ship.
  const fakeSrc =
    'export async function DELETE(a) {\n  config_chat: []\n}\n' +
    'export async function POST(b) {\n  optimizer_drafts.select()\n}\n';
  detects("a DELETE window that runs on into POST",
    functionBody(fakeSrc, "DELETE").indexOf("optimizer_drafts") < 0);
  detects("a DELETE window narrowed to nothing (would see no code at all)",
    functionBody(fakeSrc, "DELETE").indexOf("config_chat") >= 0);
  const fakeRoute =
    '  promptTurns.push({ role: "user", content: buildDiscussTurn({ d }) });\n' +
    '  const next = trimForStorage(history.concat([{ role: "user", content: question }]));\n' +
    '  await db.from("x").update({ config_chat: next }).eq("id_session", id);\n';
  detects("a storage window that swallows the prompt-building push",
    storageRegion(fakeRoute).indexOf("buildDiscussTurn") < 0);
  detects("a storage window narrowed past the stored turn",
    storageRegion(fakeRoute).indexOf("content: question") >= 0);
  const badRoute = fakeRoute.replace("content: question", "content: buildDiscussTurn({ d })");
  detects("a route that really does store the built turn",
    /buildDiscussTurn/.test(storageRegion(badRoute)));

  // The flat shape, simulated: it satisfies every OTHER assertion in section 3.
  const flat = parseDiscussReply("A:\n```draft\nX\n```\nB.");
  detects("a renderer that would emit prose-then-blocks instead of segment order",
    flat.segments.length === 3 && flat.segments[1].type === "draft" &&
    // the flat fields alone cannot distinguish the two orders — which is why
    // the old shape could not catch this
    (flat.commentary === "A:\n\nB." && flat.drafts.length === 1));

  detects("a success toast fired from a rail panel",
    (("toast.success(\"Attached\");").match(/toast\.(success|warning|info|message)\(/g) || []).length === 1);
  detects("an error toast being wrongly flagged as noisy",
    (("toast.error(\"nope\");").match(/toast\.(success|warning|info|message)\(/g) || []).length === 0);

  {
    // The bug, reproduced: bind-to-next-segment-only.
    const nextOnly = (segs: any[]) => {
      const out: any[] = []; let pending: string | null = null;
      for (const seg of segs) {
        if (seg.type === "anchor") { pending = seg.text; continue; }
        out.push(pending ? { ...seg, anchor: pending } : seg);
        pending = null;
      }
      return out;
    };
    const shape = [
      { type: "anchor", text: "Q." },
      { type: "text", text: "reasoning" },
      { type: "draft", text: "rewrite" },
    ] as any[];
    detects("an anchor that stops before the rewrite it was written for",
      !nextOnly(shape).filter((x: any) => x.type === "draft")[0].anchor &&
      !!linkAnchors(shape).filter((x) => x.type === "draft")[0].anchor);
  }
  detects("a truncated draft that does not say so",
    /TRUNCATED/.test(buildDiscussTurn({ draftText: "x".repeat(40000), selection: null, question: "q" })));

  if (broken > 0) {
    console.log(`\n✗ ${broken} detector(s) failed to fire — reporting nothing.`);
    process.exit(1);
  }
  console.log("  all detectors fire.");
}

if (process.argv.indexOf("--self-test") >= 0) selfTest();

console.log(failures === 0 ? "\n✓ discuss checks pass\n" : `\n✗ ${failures} failed\n`);
process.exit(failures === 0 ? 0 : 1);
