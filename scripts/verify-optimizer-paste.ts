/**
 * A pasted article keeps its structure — and when it genuinely cannot, the
 * tool says so instead of scoring the loss as the writing.
 *
 *   npx tsx scripts/verify-optimizer-paste.ts
 *
 * THE INCIDENT (2026-09-23). A writer pasted a feature article into the
 * Optimizer twice. Both arrived as plain text: the stored body was only <p>
 * and <br>, one storytelling heading fused onto the question heading beneath
 * it, and the studio said "0 of 0 headings are question-shaped", 0/10. She took
 * that as a verdict on the article's structure. Two colleagues imported the
 * same article as the .docx: eleven headings, 10/10, 63 against her 43-45.
 *
 * The mechanism, proven in Chrome against the real component: the paste box
 * was a <textarea> that used the clipboard's HTML only while its value EQUALLED
 * the clipboard's text/plain. A textarea normalises \r\n and a lone \r to \n;
 * DataTransfer.getData does not. So a source that writes CR line endings —
 * Chrome on Windows for any copied page, Word and Outlook on Windows — failed
 * the comparison with no edit at all, and ANY edit (trimming the title) failed
 * it for everyone. The one signal was grey text reading "plain text".
 *
 * WHAT THIS DRIVES, and why each is the real thing rather than a model of it:
 *
 *   1-5  the pure seams — classifyPaste (every paste's one door), the route's
 *        decision (structureUnseenForImport), the engine, the offer — with an
 *        article shaped like the incident's: storytelling H1s over question
 *        H2s, bullets, a quotation with its attribution on the next line.
 *   6    the REAL StartScreen, bundled from source and mounted in real Chrome,
 *        fed by a TRUSTED paste (a synthetic ClipboardEvent inserts nothing,
 *        and CDP insertText fires no paste event — measured, 2026-09-23), with
 *        the exact clipboard flavours each case needs. Every POST it makes is
 *        sent through the REAL import route (section 8's driver), and what the
 *        route stores is what the case asserts on.
 *   7    the REAL studio pieces — StructureNotice, the studio's TiptapEditor
 *        with the highlight plugin, ScorePanel — wired the way the page wires
 *        them, and an offer accepted by clicking it.
 *   8    the wiring. The import route's POST is RUN, with only auth and the
 *        database stubbed at the module boundary, and the row it inserts is
 *        read back through the function the page and the assess route read it
 *        with. The page cannot be mounted here, so its scorers and the assess
 *        route are read from the SYNTAX TREE: the value each passes for the
 *        record must be exactly the record, not merely an expression that
 *        mentions its name.
 *
 * The CRLF precondition (6) pastes the same clipboard into a bare textarea and
 * asserts the value and getData DIFFER — the fixture must reproduce the
 * original bug's condition, or the cases that pass on it prove nothing.
 *
 * Needs Chrome (CHROME_EXECUTABLE_PATH, or the default macOS path) and fails
 * rather than skipping without it: not looking and finding nothing are
 * different claims. Headless Chrome has its own clipboard; the machine's is
 * never touched.
 *
 * MUTATION LOG — every entry run in a throwaway detached worktree, never the
 * shared tree (it deploys); each mutation asserted to have CHANGED the file
 * before its result was read, and the file restored and compared byte-for-byte
 * after. Kills AND survivors, because a survivor is a finding about the check.
 *
 * Round 1 (2026-09-23, first version of the box):
 *
 *   StartScreen reverted to d1c7faf (textarea + equality gate) → KILLED
 *       (CRLF and lone-CR: headings not stored — the incident, reproduced)
 *   classifyPaste prefers text/plain whenever present           → KILLED
 *   paste plugin hands the paste back to ProseMirror             → KILLED
 *   engine: headingsBlindReason always null                      → KILLED
 *   headingsUnseen ignores the heading count                     → KILLED
 *   engine skips question-headings but still scores hierarchy
 *     and density                                                → KILLED
 *   applyHeadingOffer replaces the whole document (setContent)   → KILLED
 *       (the judge finding elsewhere is orphaned)
 *   route decision: accepts any known reason from a client       → KILLED
 *   route decision: old-client fallback removed                  → KILLED
 *   ScorePanel's headings-not-scored notice removed              → KILLED
 *   offer: multi-sentence / quotation-opening guards removed,
 *     statement lines offered as well                            → KILLED
 *   classifyPaste's \r normalisation deleted → SURVIVED at first (only the
 *     HTML was compared, and plainTextToHtml normalises too); the record for
 *     CR and CRLF is now asserted                                → KILLED
 *   the transformPastedHTML backstop deleted → SURVIVED at first (trusted
 *     pastes carry clipboardData and never reach it); view.pasteHTML with no
 *     clipboardData now drives it                                → KILLED
 *
 * Round 1 was then reviewed, and FIVE mutations SURVIVED it — the check
 * reported "All checks passed" over each:
 *
 *   page: `structureUnseen,` → `structureUnseen: null,` in both scorers
 *   page: `structureUnseen,` → `structureUnseen: null && structureUnseen,`
 *   assess: `structureUnseen: brief.structureUnseen && null`
 *   route: the line storing the record commented out — the brace-matched
 *     object still CONTAINED the word, inside the comment
 *   route: the record stored under another key (structure_unseen) that no
 *     consumer reads
 *
 * Section 8 matched the NAME `structureUnseen` in the text around each call,
 * which every one of those mutations keeps. That is the failure this repo has
 * paid for before — a line existing reported as a thing working — and the
 * report of round 1 said section 8 read "the actual argument objects, not a
 * line merely existing". It did not. The route is now RUN and its insert read
 * back; the page and assess route are read as syntax, value by value.
 *
 * The same review found three defects in the code the checks had passed —
 * undo/redo restoring a plain paste without its record; every paste inserted
 * as a closed block, so a phrase split its paragraph and a word pasted inside
 * an H2 split the heading; and the record dropped whenever the box held ANY
 * heading, including the one the warning told the writer to mark and a lone
 * "# Title" — so round 1's "StartScreen sends the claim even with headings in
 * the box" and "route decision no longer requires a headless body", both
 * recorded as KILLED, were kills of the WRONG behaviour and are now the
 * design. Round 2, against the code as it now stands, is below.
 *
 * Round 2 (2026-09-23), 47 mutations, 47 KILLED, against the code as it now
 * stands (baseline, unmutated: exit 0):
 *
 *   the record through history
 *     record mirrored from paste transactions only (round 1's design)  → KILLED
 *       (select-all/delete/undo, undo/redo, rich-over-plain/undo)
 *     the paste transaction writes no doc attribute                    → KILLED
 *     clearing-on-empty kept out of the history event                  → KILLED
 *     clearing-on-empty removed                                         → KILLED
 *     a paste over everything keeps the earlier record                  → KILLED
 *   where a paste lands
 *     inner pass inserts the slice CLOSED (round 1's insertContent)    → KILLED
 *       (phrase mid-sentence, cut/paste, whole-H2 replace, word in H2)
 *     one-line plain text converted like any other ("brand-newrebuilt") → KILLED
 *     outer pass hands the paste to ProseMirror's default               → KILLED
 *     drops handed to ProseMirror's own drop                            → KILLED
 *   the record's gates
 *     box sends the record only while it holds no section heading     → KILLED
 *     route decision drops the record when the body holds a heading    → KILLED
 *     classifyPaste records nothing when the text made a heading       → KILLED
 *     engine / box warning / StructureNotice count EVERY heading, so a
 *       lone title H1 switches the criteria back on (three mutations)  → KILLED
 *     box's remaining-offers line, notice's partial-state sentence     → KILLED
 *   the box's HTML through the route
 *     route re-infers the box's editor HTML (a Word bold line → <h2>)  → KILLED
 *     box does not send contentIsEditorHtml                            → KILLED
 *     the re-sanitise skips the whitelist as well                      → KILLED
 *   the wiring — the five that SURVIVED round 1, and neighbours
 *     page: `structureUnseen: null` in both scorers                    → KILLED
 *     page: `structureUnseen: null && structureUnseen`                 → KILLED
 *     assess: `structureUnseenOfBrief(brief) && null`                  → KILLED
 *     route: the storing line commented out                            → KILLED
 *     route: `false && structureUnseen` stored                         → KILLED
 *     route: stored under structure_unseen                             → KILLED
 *     the brief's writer using a key its reader does not               → KILLED
 *     page: the live marks' deps drop the record                       → KILLED
 *     page: hydration reads nothing                                    → KILLED
 *     page: the record shadowed by a local null inside the scorer      → KILLED
 *     assess: the record read from the request body                    → KILLED
 *   round 1's, re-run: StartScreen reverted to d1c7faf (fails on the
 *     CRLF and lone-CR cases — the incident), classifyPaste prefers
 *     text, no CR normalisation, headingsBlindReason null,
 *     headingsUnseen ignores the count, hierarchy/density still scored,
 *     applyHeadingOffer by setContent, any client reason accepted,
 *     old-client fallback removed, the transformPastedHTML backstop
 *     removed, the route blind to the plain-text door, the ScorePanel
 *     block removed, the three offer guards                            → KILLED
 *
 *   ONE SURVIVED the first pass of round 2: the inner pass given the RAW
 *   clipboard HTML instead of the conversion. For HTML the conversion IS
 *   the sanitiser, and the transformPastedHTML backstop sanitises the inner
 *   parse too, so every case was byte-identical — except an html flavour
 *   holding no words, which classifyPaste answers from the text flavour and
 *   which nothing in section 6 pasted. It does now, and the mutation is
 *   KILLED. The layering stays: two sanitisers is the point, and a mutation
 *   removing either one alone is caught by its own case.
 */
import { existsSync, readFileSync } from "fs";
import Module, { createRequire } from "module";
import { join } from "path";
import * as ts from "typescript";
import { NextRequest } from "next/server";
import {
  classifyPaste, headingsUnseen, headingCountOf, likelyQuestionHeadings, promoteLineToHeading,
  structureUnseenForImport, structureUnseenInScores, normaliseStructureUnseen, HEADING_CRITERIA,
  structureUnseenSkipReason, sectionHeadingCountOf, structureUnseenOfBrief, briefStructureFields,
} from "../lib/optimizer/import-structure";
import { importsAsPlainText, toEditorHtml } from "../lib/optimizer/import-html";
import { computeDraftScores } from "../lib/optimizer/engine";
import { parseDraft } from "../lib/optimizer/parse";
import { buildShipChecklist } from "../lib/optimizer/ship-checklist";

const ROOT = join(__dirname, "..");
let failures = 0;
const pass = (m: string) => console.log(`  ok    ${m}`);
const fail = (m: string) => { failures++; console.log(`  FAIL  ${m}`); };
const check = (ok: boolean, m: string, detail?: string) => (ok ? pass(m) : fail(detail ? `${m}\n          ${detail}` : m));

// ── The article ──────────────────────────────────────────────────────────
//
// Neutral words in the incident's SHAPE. Two storytelling H1s, five question
// H2s under them, a three-item summary, a quotation whose attribution sits on
// the next line, a question inside a sentence, a quoted question, and a
// two-sentence line that ends in one — the last four are the lines a heading
// rule must NOT offer.
type Block = [string, string];
const P = (s: string): Block => ["p", s];
const ARTICLE: Block[] = [
  P("October 1, 2026"),
  ["li", "The Port Albrecht quarry has earned the regional origin certification for stone cut, dressed and shipped within the province."],
  ["li", "From the customs house to the north pier, the same quarry has supplied the stone for most of the harbour's landmarks."],
  ["li", "The new river crossing will use a concrete system engineered for a hundred-year service life."],
  P("Some of the harbour's buildings carry the names of the families who built the port. The stone holding them up now carries a name too: the quarry that supplied it has been certified as a regional source, from the rock face through to the finished block."),
  P("It is a small recognition with a long history behind it. The same benches of limestone have been worked for two centuries, and the buildings made from them are the ones people point to when they describe the waterfront to visitors."),
  ["h1", "Harbours that carry the city’s past forward"],
  ["h2", "What stone was used to build the old customs house?"],
  P("The customs house was built from the quarry's grey limestone in 1868, dressed on site by masons who lived in the terraces behind the harbour. Its walls are nearly a metre thick at the base, and the blocks were laid without steel, relying on their own weight and on lime mortar that has been repointed only twice since it was first laid."),
  P("“One thing I have always noticed working on the waterfront is how much people care about what the old buildings are made of,” she said.\n— Jane Doe, Senior Structural Engineer"),
  ["h2", "How was the north pier rebuilt to last a century?"],
  P("The north pier was rebuilt after the storm of 1953 with a core of mass concrete and a facing of the original stone, salvaged block by block from the collapsed section. Engineers numbered every block before the work began so the facing could be returned to its old position, and most of the blocks you see today are the ones that stood there before the storm."),
  ["h1", "Projects that define the moment"],
  ["h2", "What concrete is going into the new tram line?"],
  P("The tram line's viaduct uses a low-carbon concrete in which a third of the cement is replaced by ground slag from the steelworks upriver. The mix was trialled on a single span for a year before it was approved for the rest of the route, and the trial span is now the one closest to the station."),
  ["h2", "How will the river crossing reach a hundred-year service life?"],
  P("The crossing's deck is designed around a concrete that resists chloride attack from the salt carried upriver on high tides. Why does that matter? Because a crossing that lasts a century is one the city only has to pay for once, and the cost of a second crossing within the lifetime of the first is what the design was written to avoid."),
  P("“Who decides what gets built on the waterfront?”\n— Council minutes, 1911"),
  P("The pier has been rebuilt twice since 1868. Will it need a third?"),
  ["h2", "What gives the new square its distinctive paving?"],
  P("The square is paved with offcuts from the quarry's building stone, cut into setts and laid in the fan pattern used on the old market streets. The offcuts would otherwise have been crushed for aggregate, and using them gave the square the same colour as the buildings around it without opening a new face in the quarry."),
  P("Taken together, the projects describe a city that keeps building with the material it started with. The certification changes nothing about the stone itself, but it records something the people who work it have always known: that the harbour was built from what was close at hand, and still is."),
];
const QUESTION_HEADINGS: string[] = [];
for (let i = 0; i < ARTICLE.length; i++) if (ARTICLE[i][0] === "h2") QUESTION_HEADINGS.push(ARTICLE[i][1]);
const STATEMENT_HEADING = "Projects that define the moment";

const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
/** What a rich source puts in text/html. */
function richHtml(blocks: Block[]): string {
  let out = "";
  for (let i = 0; i < blocks.length; i++) {
    const [k, t] = blocks[i];
    if (k === "li") {
      if (i === 0 || blocks[i - 1][0] !== "li") out += "<ul>";
      out += `<li>${esc(t)}</li>`;
      if (i === blocks.length - 1 || blocks[i + 1][0] !== "li") out += "</ul>";
    } else if (k === "p") {
      const lines = t.split("\n");
      for (let j = 0; j < lines.length; j++) out += `<p>${esc(lines[j])}</p>`;
    } else {
      out += `<${k}>${esc(t)}</${k}>`;
    }
  }
  return out;
}
/**
 * What the same source puts in text/plain, in the incident's shape: blank
 * lines between blocks, EXCEPT inside the summary list and between the first
 * storytelling heading and its question — the fused spot from the real paste.
 */
function plainText(blocks: Block[], eol: string): string {
  const parts: string[] = [];
  for (let i = 0; i < blocks.length; i++) {
    const [k, t] = blocks[i];
    const tight = i > 0 && ((k === "li" && blocks[i - 1][0] === "li") || (k === "h2" && blocks[i - 1][0] === "h1" && i === 7));
    if (i > 0) parts.push(tight ? eol : eol + eol);
    parts.push(t.split("\n").join(eol));
  }
  return parts.join("");
}
const RICH = richHtml(ARTICLE);
const PLAIN_LF = plainText(ARTICLE, "\n");
const PLAIN_CRLF = plainText(ARTICLE, "\r\n");
const PLAIN_CR = plainText(ARTICLE, "\r");
const QUERY = ["how long does harbour concrete last"];
const TITLE = "What the harbour is built on";

const byKey = (s: any): { [k: string]: any } => {
  const m: { [k: string]: any } = {};
  for (let i = 0; i < s.pillars.length; i++) for (let c = 0; c < s.pillars[i].criteria.length; c++) m[s.pillars[i].criteria[c].key] = s.pillars[i].criteria[c];
  return m;
};

// ── 1. Fixture preconditions ─────────────────────────────────────────────
console.log(`\n1. The fixture is the incident's shape`);
const plainImported = toEditorHtml(PLAIN_LF, false);
{
  check(ARTICLE[6][0] === "h1" && ARTICLE[7][0] === "h2", "the fused pair in the plain text is a storytelling H1 over a question H2");
  check(/Harbours that carry the city’s past forward<br>What stone was used to build the old customs house\?/.test(plainImported),
    "pasted as plain text, that pair fuses into one paragraph — the shape of the real stored body", plainImported.slice(0, 300));
  check(headingCountOf(plainImported) === 0, "and the plain import holds no headings at all");
  check(headingCountOf(toEditorHtml(RICH, true)) === 7, "while the rich flavour carries all seven");
  const words = parseDraft({ body: plainImported }).wordCount;
  check(words >= 600, `the article is long enough for the long-draft heading rules to apply (${words} words)`);
  check(PLAIN_CRLF.indexOf("\r\n") >= 0 && PLAIN_CR.indexOf("\r") >= 0 && PLAIN_CR.indexOf("\n") < 0,
    "the CRLF and CR variants really carry those line endings");
}

// ── 2. classifyPaste — every paste's one door ────────────────────────────
console.log(`\n2. classifyPaste: the rich flavour wins, whatever the line endings`);
{
  const a = classifyPaste({ html: RICH, text: PLAIN_LF });
  const b = classifyPaste({ html: RICH, text: PLAIN_CRLF });
  const c = classifyPaste({ html: RICH, text: PLAIN_CR });
  check(a.kind === "html" && headingCountOf(a.html) === 7 && a.structureUnseen === null && a.inline === null, "LF text + html → html, seven headings, nothing unseen");
  check(b.html === a.html && c.html === a.html && b.kind === "html" && c.kind === "html",
    "CRLF and lone-CR text beside the same html produce the IDENTICAL result — the line endings no longer decide anything");
  const pl = classifyPaste({ text: PLAIN_LF });
  const pc = classifyPaste({ text: PLAIN_CRLF });
  const pr = classifyPaste({ text: PLAIN_CR });
  check(pl.kind === "plain-text" && pl.structureUnseen === "plain-text-paste" && pl.inline === null, "text only → plain, and recorded as unable to see headings");
  check(pc.html === pl.html && pr.html === pl.html, "a Windows or classic-Mac plain paste converts exactly as an LF one does");
  check(pc.structureUnseen === "plain-text-paste" && pr.structureUnseen === "plain-text-paste",
    "...and is RECORDED exactly as one — a lone-CR paste has no \\n, so an unnormalised line test would call it one line");
  check(pl.html === plainImported, "the plain door IS plainTextToHtml — its conservative doctrine is untouched");
  const one = classifyPaste({ text: "brand-new " });
  check(one.structureUnseen === null && one.inline === "brand-new ",
    "a single-line plain paste records nothing, and is inserted AS TEXT with its edge space — it carries no block to convert", JSON.stringify(one));
  check(classifyPaste({ text: "a copied line\r\n" }).inline === "a copied line" && classifyPaste({ text: "\n\n  indented\n\n" }).inline === "  indented",
    "...a line's own trailing newline does not make it two lines, and does not come with it");
  const marked = classifyPaste({ text: "## Notes for the editor\n\n" + PLAIN_LF });
  check(marked.structureUnseen === "plain-text-paste" && headingCountOf(marked.html) === 1,
    "a plain paste with ONE markdown heading is still recorded — a \"##\" line says nothing about the headings the clipboard dropped", JSON.stringify(marked.structureUnseen));
  const titled = classifyPaste({ text: "# " + TITLE + "\n\n" + PLAIN_LF });
  check(titled.structureUnseen === "plain-text-paste", "...and so is one that opens with a \"# Title\" line");
  const empty = classifyPaste({ html: "<meta charset='utf-8'>", text: "Words that only came as text.\nSecond line." });
  check(empty.kind === "plain-text" && /Words that only came as text/.test(empty.html),
    "an html flavour holding no words falls through to the text rather than inserting nothing");
  const cocoa = classifyPaste({ html: `<!DOCTYPE html PUBLIC "-//W3C//DTD HTML 4.01//EN"><html><head><meta name="Generator" content="Cocoa HTML Writer"></head><body><p class="p1"><span class="s1"><b>A bold line</b></span></p><p class="p1">Body.</p></body></html>`, text: "A bold line\nBody." });
  check(cocoa.kind === "html" && cocoa.structureUnseen === "rtf-paste" && !/DOCTYPE/.test(cocoa.html),
    "an RTF paste (Pages, TextEdit) is html with no heading element possible — recorded as rtf-paste", JSON.stringify(cocoa));
}

// ── 3. The route's decision ──────────────────────────────────────────────
console.log(`\n3. The import route records which door the content came through`);
{
  const decide = (source: string, content: string, isHtml: boolean | undefined, claimed?: unknown, fileName?: string) =>
    structureUnseenForImport({ source, convertedFromPlainText: importsAsPlainText(content, isHtml), raw: content, claimed, fileName });
  const boxPlain = classifyPaste({ text: PLAIN_LF });
  check(decide("pasted", boxPlain.html, true, "plain-text-paste") === "plain-text-paste", "the paste box's claim for a plain paste is recorded");
  const oneMarked = promoteLineToHeading(boxPlain.html, { text: STATEMENT_HEADING })!;
  check(!!oneMarked && decide("pasted", oneMarked, true, "plain-text-paste") === "plain-text-paste",
    "...and STILL recorded once the writer has marked a heading — the other headings are still lost (it used to be dropped here)");
  check(decide("pasted", boxPlain.html, true, "plain-text-export") === null, "a browser cannot claim a server-side reason");
  check(decide("pasted", boxPlain.html, true, "anything-else") === null, "or an unknown one");
  check(decide("pasted", PLAIN_LF, false) === "plain-text-paste",
    "an OLD client (a cached bundle mid-deploy) sending textarea text is recorded from the server's own conversion");
  check(decide("pasted", "# " + TITLE + "\n\n" + PLAIN_LF, false) === "plain-text-paste", "...including one whose text opens with a \"# Title\" line");
  check(decide("pasted", "One line typed by hand.", false) === null, "...but not a single line, which could not have lost a heading");
  check(decide("gdoc", PLAIN_LF, undefined) === "plain-text-export", "the shared-Drive list's text/plain export is recorded");
  check(decide("gdoc", RICH, undefined) === null, "...and not when that content is html");
  check(decide("file", plainImported, true, undefined, "article.txt") === "plain-text-file", "an uploaded .txt is recorded");
  check(decide("file", plainImported, true, undefined, "article.md") === null, "an uploaded .md is not — markdown marks its headings");
  check(decide("url", plainImported, true, "plain-text-paste") === null, "a claim on a non-paste source is ignored");
  check(normaliseStructureUnseen("plain-text-paste") === "plain-text-paste" && normaliseStructureUnseen("x") === null && normaliseStructureUnseen(1) === null,
    "the stored value is narrowed before anything reads it");
  check(structureUnseenOfBrief({ targetQueries: [], ...briefStructureFields("rtf-paste") }) === "rtf-paste" && structureUnseenOfBrief({ ...briefStructureFields(null) }) === null
    && structureUnseenOfBrief({ structureUnseen: "bogus" }) === null && structureUnseenOfBrief(null) === null,
    "the brief's writer and reader agree, and the reader narrows");
}

// ── 4. The engine: not looking is not finding nothing ───────────────────
console.log(`\n4. The heading criteria skip, with the reason, only while nothing can be seen`);
{
  const base = { body: plainImported, title: TITLE, targetQueries: QUERY, now: new Date("2026-09-23") };
  const before = byKey(computeDraftScores(base));
  // Pinned, so the change is visible in both directions: without the record
  // this is still exactly the claim the writer was shown.
  check(before["question-headings"].earned === 0 && /0 of 0 headings/.test(before["question-headings"].name),
    "WITHOUT the record the old claim stands — \"0 of 0 headings are question-shaped\", 0/10", before["question-headings"].name);
  const scores = computeDraftScores({ ...base, structureUnseen: "plain-text-paste" });
  const after = byKey(scores);
  const why = structureUnseenSkipReason("plain-text-paste");
  for (let i = 0; i < HEADING_CRITERIA.length; i++) {
    const k = HEADING_CRITERIA[i];
    check(after[k] && after[k].skipped === true && after[k].skipReason === why, `WITH it, ${k} is skipped and says why`, JSON.stringify(after[k]));
  }
  let others = true;
  const keys = Object.keys(before);
  for (let i = 0; i < keys.length; i++) {
    if (HEADING_CRITERIA.indexOf(keys[i]) >= 0) continue;
    if (JSON.stringify(before[keys[i]]) !== JSON.stringify(after[keys[i]])) { others = false; fail(`the record changed a criterion that is not about headings: ${keys[i]}`); }
  }
  if (others) pass("...and changes nothing else — every other criterion is identical with and without it");
  const notice = structureUnseenInScores(scores, "plain-text-paste");
  check(!!notice && notice.criteria.length === HEADING_CRITERIA.length,
    "the panel's explanation is read out of the score and names all five — the number and the sentence agree");
  const ship = buildShipChecklist({ scores, text: parseDraft({ body: plainImported }).text, headings: [], title: base.title, hasLivePage: false });
  let qRow: any = null;
  for (let i = 0; i < ship.length; i++) if (ship[i].via === "question-headings") qRow = ship[i];
  check(!!qRow && qRow.state === "not-checked" && String(qRow.detail).indexOf("pasted as plain text") >= 0,
    "the ship checklist's question-heading row says \"not checked\" and why, rather than \"missing\"", JSON.stringify(qRow));

  // A LONE H1 IS THE TITLE. A plain paste opening "# Title" holds one heading
  // and no section; counting that heading switched the criteria back on and
  // produced the incident's sentence word for word.
  const lone = toEditorHtml("# " + TITLE + "\n\n" + PLAIN_LF, false);
  check(headingCountOf(lone) === 1 && sectionHeadingCountOf(lone) === 0, "precondition: \"# Title\" + the article is one heading and no SECTION heading");
  const loneBare = byKey(computeDraftScores({ ...base, body: lone }));
  check(/0 of 0 headings/.test(loneBare["question-headings"].name), "precondition: without the record that draft reads \"0 of 0\"", loneBare["question-headings"].name);
  const loneRec = byKey(computeDraftScores({ ...base, body: lone, structureUnseen: "plain-text-paste" }));
  check(loneRec["question-headings"].skipped === true && loneRec["heading-density"].skipped === true,
    "WITH the record, a lone title H1 does not switch the heading criteria back on", JSON.stringify(loneRec["question-headings"]));

  // THE PARTIAL STATE. The writer marked one storytelling line (as the
  // warning tells her to). The criteria score what is marked — honestly
  // "0 of 1" — and the record keeps the five question lines on offer.
  const partial = promoteLineToHeading(plainImported, { text: STATEMENT_HEADING }, 2)!;
  const ps = computeDraftScores({ ...base, body: partial, structureUnseen: "plain-text-paste" });
  const pk = byKey(ps);
  check(!pk["question-headings"].skipped && /0 of 1 headings/.test(pk["question-headings"].name) && structureUnseenInScores(ps, "plain-text-paste") === null,
    "one statement heading marked: the criteria score what is marked (\"0 of 1\") and nothing is reported skipped", pk["question-headings"].name);
  check(likelyQuestionHeadings(partial).length === 5, "...and the five question lines are still there to offer — which only happens if the record survived the marking");

  // THE INVARIANT the incident broke: with a record, "0 of 0" is never shown.
  const bodies: [string, string][] = [["plain", plainImported], ["lone H1", lone], ["statement H2", partial], ["rich", toEditorHtml(RICH, true)],
    ["H1 + statement H2", toEditorHtml("# " + TITLE + "\n\n## " + STATEMENT_HEADING + "\n\n" + PLAIN_LF, false)]];
  let zeroOfZero = "";
  for (let i = 0; i < bodies.length; i++) {
    const q = byKey(computeDraftScores({ ...base, body: bodies[i][1], structureUnseen: "plain-text-paste" }))["question-headings"];
    if (!q.skipped && /\b0 of 0\b/.test(q.name)) zeroOfZero += bodies[i][0] + " ";
  }
  check(!zeroOfZero, "with a record, no draft shape reads \"0 of 0 headings are question-shaped\"", zeroOfZero);

  // THE PREDICATE CLEARS. One question heading and the criteria measure it.
  const one = promoteLineToHeading(plainImported, { text: QUESTION_HEADINGS[0] })!;
  const marked = byKey(computeDraftScores({ ...base, body: one, structureUnseen: "plain-text-paste" }));
  check(!marked["question-headings"].skipped && marked["question-headings"].earned === 4,
    "once one heading exists the criteria score again (question-headings 4/10 for one question heading)", JSON.stringify(marked["question-headings"]));
  check(headingsUnseen("plain-text-paste", 0) && !headingsUnseen("plain-text-paste", 1) && !headingsUnseen(null, 0) && !headingsUnseen("bogus", 0),
    "headingsUnseen: a known record AND no section heading, nothing else");
  const junk = byKey(computeDraftScores({ ...base, structureUnseen: "bogus" }));
  check(!junk["question-headings"].skipped, "an unknown stored value switches nothing off");
}

// ── 5. The offer ─────────────────────────────────────────────────────────
console.log(`\n5. Offered question headings: the five questions, nothing else, one at a time`);
{
  const offers = likelyQuestionHeadings(plainImported);
  const texts: string[] = [];
  for (let i = 0; i < offers.length; i++) texts.push(offers[i].text);
  check(JSON.stringify(texts) === JSON.stringify(QUESTION_HEADINGS),
    "exactly the five question headings, in order — including the one fused under a storytelling line", JSON.stringify(texts));
  check(texts.indexOf("Harbours that carry the city’s past forward") < 0 && texts.indexOf(STATEMENT_HEADING) < 0,
    "statement headings are NOT offered — the short-line rule measured 31% precise on copied pages");
  check(texts.indexOf("“Who decides what gets built on the waterfront?”") < 0, "a quoted question is not offered");
  check(texts.indexOf("The pier has been rebuilt twice since 1868. Will it need a third?") < 0,
    "nor a line of two sentences that happens to end in one — the measured rule is ONE sentence");
  check(/The pier has been rebuilt twice since 1868\. Will it need a third\?/.test(plainImported),
    "precondition: that line really is in the draft, on its own, for the rule to refuse");
  const rich = toEditorHtml(RICH, true);
  check(likelyQuestionHeadings(rich).length === 0, "a line that is already a heading is not offered again");
  const fused = promoteLineToHeading(plainImported, offers[0])!;
  check(/<p>Harbours that carry the city’s past forward<\/p><h2>What stone was used to build the old customs house\?<\/h2>/.test(fused),
    "accepting the fused one splits its paragraph and leaves the storytelling line for the writer");
  check(fused.replace(/<[^>]+>/g, "") === plainImported.replace(/<[^>]+>/g, ""),
    "...without adding or losing a character of text");
  check(promoteLineToHeading(plainImported, { text: "A line that is not in the draft?" }) === null,
    "a line no longer in the draft returns null, so the caller can say so");
  const bullets = likelyQuestionHeadings("<ul><li><p>Is this a list item?</p></li></ul><blockquote><p>Is this a quotation?</p></blockquote><p>Is this a paragraph line?</p>");
  check(bullets.length === 1 && bullets[0].text === "Is this a paragraph line?", "lines in lists and quotations are never offered");
}

// ── The import route, RUN ────────────────────────────────────────────────
//
// The route's own POST, with the four modules that reach outside the process
// — auth, workspace permissions, the two database clients, the client canon —
// replaced at the module boundary. Everything between the request and the
// insert is the route's own code: requireOptimizer, the source switch, the
// conversion, the decision, the brief. What it would have written is captured
// and returned.

interface Stored { status: number; json: any; brief: any; body: string | null }
const inserted: { table: string; row: any }[] = [];
const stubsUsed: { [k: string]: boolean } = {};
let routePOST: ((req: any) => Promise<any>) | null = null;

function loadImportRoute(): void {
  const db = {
    from(table: string) {
      return {
        insert(row: any) {
          inserted.push({ table, row });
          const res = { data: table === "optimizer_sessions" ? { id_session: "session-" + inserted.length } : null, error: null };
          return {
            select: () => ({ maybeSingle: async () => res }),
            then: (ok: any, bad: any) => Promise.resolve(res).then(ok, bad),
          };
        },
      };
    },
  };
  const stubs: { [k: string]: any } = {
    "@/lib/supabase-intelligence": { intelligenceDb: db },
    "@/lib/supabase": { supabase: {} },
    "@/lib/auth": { auth: async () => ({ user: { id: "7", email: "writer@example.com" } }) },
    "@/lib/permissions": {
      verifyWorkspaceMembership: async () => "member", hasOptimizerAccess: async () => true,
      canAccessClient: async () => true, requireAuth: async () => ({ userId: 7, role: "member" }),
    },
    "@/lib/ai/access": { checkConversationAccess: async () => ({ allowed: true, permission: "owner" }) },
    "@/lib/optimizer/client-canon": { getClientCanon: async () => ({}) },
  };
  // Node's own loader, patched for the one require of the route below and
  // restored in the finally. The default import is the real module object;
  // a namespace import would be a copy, and patching a copy stubs nothing.
  const NodeModule: any = Module;
  const realLoad = NodeModule._load;
  NodeModule._load = function (this: any, request: string, ...rest: any[]) {
    if (Object.prototype.hasOwnProperty.call(stubs, request)) { stubsUsed[request] = true; return stubs[request]; }
    return realLoad.apply(this, [request].concat(rest));
  };
  try {
    routePOST = createRequire(__filename)(join(ROOT, "app/api/optimizer/import/route.ts")).POST;
  } finally {
    NodeModule._load = realLoad;
  }
}

async function importThroughRoute(post: any): Promise<Stored> {
  inserted.length = 0;
  const req = new NextRequest("http://localhost/api/optimizer/import", {
    method: "POST", body: JSON.stringify(post), headers: { "content-type": "application/json" },
  });
  const res = await routePOST!(req);
  const json = await res.json();
  let brief: any = null;
  let body: string | null = null;
  for (let i = 0; i < inserted.length; i++) {
    if (inserted[i].table === "optimizer_sessions") brief = inserted[i].row.config_brief;
    if (inserted[i].table === "optimizer_drafts") body = inserted[i].row.document_body;
  }
  return { status: res.status, json, brief, body };
}

/** Each heading as level:text, in order — the structure a writer sees. */
function headingList(html: string): string {
  const hs = parseDraft({ body: html || "" }).headings;
  const out: string[] = [];
  for (let i = 0; i < hs.length; i++) out.push(hs[i].level + ":" + hs[i].text);
  return out.join(" | ");
}
/** Every import section 6 makes, box against stored — asserted once at the end. */
const boxVsStored: { box: string; stored: string }[] = [];

/** What the studio would score for a stored import: the body, and the record
 *  read back exactly as the page reads it. */
function studioView(st: Stored) {
  const body = st.body || "";
  const reason = structureUnseenOfBrief(st.brief);
  const q = byKey(computeDraftScores({ body, title: TITLE, targetQueries: QUERY, structureUnseen: reason, now: new Date("2026-09-23") }))["question-headings"];
  return { reason, headings: headingCountOf(body), sections: sectionHeadingCountOf(body), qh: q.skipped ? "not scored" : q.name };
}

// ── 6-7. Real Chrome: the StartScreen, then the studio pieces ────────────

const ENTRY = `
import React from "react";
import { createRoot } from "react-dom/client";
import StartScreen from "@/components/optimizer/StartScreen";
import StructureNotice from "@/components/optimizer/StructureNotice";
import ScorePanel from "@/components/optimizer/ScorePanel";
import TiptapEditor from "@/components/content/TiptapEditor";
import { OptimizerHighlight, optimizerHighlightKey } from "@/lib/optimizer/highlight-plugin";
import { applyHeadingOffer } from "@/lib/optimizer/paste-extension";
const w: any = window;
w.__posts = [];
w.fetch = async (url: any, init: any) => {
  if (init && init.method === "POST") w.__posts.push(JSON.parse(init.body));
  return new Response(JSON.stringify(init && init.method === "POST" ? { sessionId: "s" } : { docs: [], docsNotice: null, engineItems: [], serviceAccount: null }), { status: 200, headers: { "Content-Type": "application/json" } });
};
w.__mountStart = () => createRoot(document.getElementById("root")!).render(
  <StartScreen workspaceId="w1" clientId={null} clientName={null} onImported={() => {}} onWriteNew={() => {}} onStartBlank={() => {}} surface="optimiser" />
);
const EXT = [OptimizerHighlight];
function Studio({ initial, reason, queries }: any) {
  const [body, setBody] = React.useState(initial);
  const ed = React.useRef<any>(null);
  w.__studio = { get editor() { return ed.current; }, key: optimizerHighlightKey };
  // The page's glue, in miniature: the notice reads the body and the record,
  // an offer is accepted through applyHeadingOffer, and the panel scores the
  // same body with the same record.
  return (
    <div>
      <StructureNotice reason={reason} html={body} onMakeHeading={(o: any) => (ed.current ? applyHeadingOffer(ed.current, o) : false)} />
      <TiptapEditor content={body} onChange={setBody} onReady={(e: any) => { ed.current = e; }} debounceMs={30} extraExtensions={EXT} />
      <div id="panel"><ScorePanel input={{ body, title: "${TITLE}", targetQueries: queries, structureUnseen: reason }} /></div>
    </div>
  );
}
w.__mountStudio = (html: string, reason: any, queries: string[]) =>
  createRoot(document.getElementById("studio")!).render(<Studio initial={html} reason={reason} queries={queries} />);
`;

async function bundle(): Promise<string> {
  const esbuild: any = await import("esbuild");
  const res = await esbuild.build({
    stdin: { contents: ENTRY, resolveDir: ROOT, loader: "tsx", sourcefile: "verify-paste-entry.tsx" },
    bundle: true, write: false, format: "iife", jsx: "automatic", logLevel: "silent",
    define: { "process.env.NODE_ENV": '"production"' },
    plugins: [{
      name: "repo",
      setup(b: any) {
        // The two modules that fetch the workspace's client list. Neither is on
        // the paste path; everything else is the repository's own code.
        b.onResolve({ filter: /^@\/components\/engineai\/ClientSelector$/ }, () => ({ path: "ClientSelector", namespace: "stub" }));
        b.onResolve({ filter: /^@\/lib\/contexts\/CustomerContext$/ }, () => ({ path: "CustomerContext", namespace: "stub" }));
        b.onLoad({ filter: /.*/, namespace: "stub" }, (a: any) => ({
          loader: "tsx",
          contents: a.path === "ClientSelector"
            ? "export default function ClientSelector() { return null; }"
            : "export function useCustomerSafe() { return { customers: [] }; }",
        }));
        b.onResolve({ filter: /^@\// }, async (a: any) => {
          const r = await b.resolve("./" + a.path.slice(2), { resolveDir: ROOT, kind: a.kind });
          return { path: r.path };
        });
      },
    }],
  });
  return res.outputFiles[0].text;
}

const HARNESS = `<!doctype html><html><head><meta charset="utf-8"></head><body>
<div id="src" contenteditable="true">copy source</div>
<textarea id="probe"></textarea>
<div id="root"></div><div id="studio"></div>
<script>
window.__clip = null;
document.addEventListener("copy", function (e) {
  if (!window.__clip) return;
  e.clipboardData.setData("text/plain", window.__clip.plain);
  if (window.__clip.html != null) e.clipboardData.setData("text/html", window.__clip.html);
  e.preventDefault();
}, true);
document.getElementById("probe").addEventListener("paste", function (e) {
  window.__probe = { plain: e.clipboardData.getData("text/plain") };
});
</script></body></html>`;

/** The box — or, when this check is pointed at the pre-fix component (the
 *  first entry in the mutation log), the textarea it replaced, so that run
 *  fails on the incident's own cases rather than on a missing selector. */
const BOX = "[data-paste-box] .ProseMirror, textarea:not(#probe)";
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function main() {
  const exe = process.env.CHROME_EXECUTABLE_PATH || "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
  if (!existsSync(exe)) {
    console.log(`\n✗ cannot run the browser sections: no Chrome at ${exe}. Set CHROME_EXECUTABLE_PATH.\n`);
    process.exit(1);
  }
  loadImportRoute();
  const code = await bundle();
  const puppeteer: any = (await import("puppeteer-core")).default;
  const browser = await puppeteer.launch({ executablePath: exe, args: ["--no-sandbox", "--disable-dev-shm-usage"], headless: true });

  const open = async (): Promise<any> => {
    const page = await browser.newPage();
    await page.setContent(HARNESS);
    await page.addScriptTag({ content: code });
    return page;
  };
  const openStart = async (): Promise<any> => {
    const page = await open();
    await page.evaluate(() => (window as any).__mountStart());
    await page.waitForSelector(BOX);
    return page;
  };
  /** A TRUSTED copy of exactly these flavours onto headless Chrome's clipboard. */
  const setClip = async (page: any, plain: string, html: string | null) => {
    await page.evaluate((p: string, h: string | null) => { (window as any).__clip = { plain: p, html: h }; }, plain, html);
    await page.focus("#src");
    await page.evaluate(() => {
      const r = document.createRange(); r.selectNodeContents(document.getElementById("src")!);
      const s = getSelection()!; s.removeAllRanges(); s.addRange(r);
    });
    await page.keyboard.press("KeyC", { commands: ["copy"] });
  };
  const pasteKey = async (page: any) => { await page.keyboard.press("KeyV", { commands: ["paste"] }); await sleep(350); };
  /** A trusted copy, a click into `target`, a trusted paste. */
  const pasteInto = async (page: any, target: string, plain: string, html: string | null) => {
    await setClip(page, plain, html);
    await page.click(target);
    await pasteKey(page);
  };
  const isMac = await (async () => { const p = await open(); const m = await p.evaluate(() => /Mac/.test(navigator.platform)); await p.close(); return m; })();
  const MOD = isMac ? "Meta" : "Control";
  const undo = async (page: any) => { await page.keyboard.down(MOD); await page.keyboard.press("KeyZ"); await page.keyboard.up(MOD); await sleep(300); };
  const redo = async (page: any) => { await page.keyboard.down(MOD); await page.keyboard.down("Shift"); await page.keyboard.press("KeyZ"); await page.keyboard.up("Shift"); await page.keyboard.up(MOD); await sleep(300); };
  const selectAll = async (page: any) => { await page.keyboard.press("KeyA", { commands: ["selectAll"] }); await sleep(100); };
  /**
   * Select `needle` in the box, select the whole text of the block holding
   * it ("block"), or put the caret just after it ("after") — in the first
   * block whose text includes `within`, when given, since a word like
   * "customs" also appears in the summary above the heading it is meant for.
   */
  const selectIn = async (page: any, needle: string, mode: "text" | "block" | "after", within?: string) => {
    const ok = await page.evaluate((sel: string, n: string, m: string, w: string) => {
      const box = document.querySelector(sel) as HTMLElement;
      const tw = document.createTreeWalker(box, NodeFilter.SHOW_TEXT);
      let t: Text | null;
      while ((t = tw.nextNode() as Text | null)) {
        const i = t.data.indexOf(n);
        if (i < 0) continue;
        if (w && (t.parentElement!.closest("h1,h2,h3,p,li")!.textContent || "").indexOf(w) < 0) continue;
        box.focus();
        const r = document.createRange();
        if (m === "block") r.selectNodeContents(t.parentElement!.closest("h1,h2,h3,p,li")!);
        else if (m === "after") { r.setStart(t, i + n.length); r.collapse(true); }
        else { r.setStart(t, i); r.setEnd(t, i + n.length); }
        const s = getSelection()!; s.removeAllRanges(); s.addRange(r);
        return true;
      }
      return false;
    }, BOX, needle, mode, within || "");
    await sleep(100);
    return ok;
  };
  /** prosemirror-history folds edits less than newGroupDelay (500ms) apart
   *  into ONE undo step, so a delete straight after a paste would be undone
   *  together with it. A writer's hands are slower than that; the check waits. */
  const settleHistory = () => sleep(650);
  const state = async (page: any) => page.evaluate((sel: string) => {
    const box = document.querySelector(sel);
    const hint = document.querySelector("[data-paste-hint]");
    const n = document.querySelector("[data-structure-notice]");
    const rest = document.querySelector("[data-structure-remaining]");
    const blocks: string[] = [];
    const heads: string[] = [];
    if (box) {
      for (let i = 0; i < box.children.length; i++) blocks.push(box.children[i].tagName + ":" + (box.children[i].textContent || ""));
      const hs = box.querySelectorAll("h1,h2,h3");
      for (let i = 0; i < hs.length; i++) heads.push(hs[i].tagName + ":" + (hs[i].textContent || ""));
    }
    return {
      headings: heads.length, heads, blocks,
      boxHtml: box ? box.innerHTML : "",
      hint: hint ? hint.textContent || "" : "",
      notice: n ? { role: n.getAttribute("role"), text: n.textContent || "" } : null,
      remaining: rest ? rest.textContent || "" : null,
      xss: (window as any).__xss || null,
    };
  }, BOX);
  const submit = async (page: any) => {
    const n0 = await page.evaluate(() => (window as any).__posts.length);
    await page.evaluate(() => {
      const b = Array.prototype.slice.call(document.querySelectorAll("button")).filter((x: any) => /Open in the editor/.test(x.textContent || ""))[0];
      if (b) b.click();
    });
    await sleep(250);
    return page.evaluate((n: number) => { const p = (window as any).__posts; return p.length > n ? p[p.length - 1] : null; }, n0);
  };
  /** Press Open, send the POST through the REAL import route, and return what the studio would then show. */
  const importNow = async (page: any) => {
    const post = await submit(page);
    if (!post) return { post: null as any, stored: null as Stored | null, view: null as ReturnType<typeof studioView> | null };
    const stored = await importThroughRoute(post);
    boxVsStored.push({ box: headingList(post.content), stored: headingList(stored.body || "") });
    return { post, stored, view: studioView(stored) };
  };
  const brief = (x: any) => JSON.stringify(x && x.view ? { claim: x.post.structureUnseen || null, stored: x.view.reason, qh: x.view.qh } : x);

  try {
    console.log(`\n6. The real StartScreen in Chrome, fed by a trusted paste, imported through the real route`);

    // PRECONDITION. The CRLF clipboard must reproduce the original bug's
    // condition: a textarea's value differs from getData's text.
    {
      const page = await open();
      await pasteInto(page, "#probe", PLAIN_CRLF, RICH);
      const pr = await page.evaluate(() => ({ value: (document.getElementById("probe") as HTMLTextAreaElement).value, got: (window as any).__probe }));
      check(!!pr.got && pr.got.plain.indexOf("\r\n") >= 0 && pr.value !== pr.got.plain && pr.value === pr.got.plain.replace(/\r\n/g, "\n"),
        "PRECONDITION: with this clipboard a textarea normalises CRLF and getData does not — the condition the old box failed on with no edit");
      await page.close();
    }

    const cases: [string, string][] = [["LF", PLAIN_LF], ["CRLF (Windows)", PLAIN_CRLF], ["lone CR", PLAIN_CR]];
    for (let i = 0; i < cases.length; i++) {
      const page = await openStart();
      await pasteInto(page, BOX, cases[i][1], RICH);
      const st = await state(page);
      const x = await importNow(page);
      check(st.headings === 7 && !st.notice && /7 headings/.test(st.hint),
        `${cases[i][0]} + html, untouched: the box SHOWS seven headings as headings, and no warning`, JSON.stringify({ headings: st.headings, hint: st.hint, notice: st.notice }));
      check(!!x.stored && x.stored.status === 200 && x.view!.headings === 7 && x.post.contentIsHtml === true && !x.post.structureUnseen && x.view!.reason === null,
        `...and the route stores all seven, with nothing recorded as unseen`, brief(x));
      await page.close();
    }

    // THE EDIT THAT USED TO DISCARD EVERYTHING: trimming a title off the top.
    {
      const page = await openStart();
      const T = "WHAT THE HARBOUR IS BUILT ON";
      await pasteInto(page, BOX, T + "\r\n\r\n" + PLAIN_CRLF, `<p>${T}</p>` + RICH);
      await page.evaluate(() => {
        const box = document.querySelector("[data-paste-box] .ProseMirror")!;
        const r = document.createRange(); r.selectNodeContents(box.firstElementChild!);
        const s = getSelection()!; s.removeAllRanges(); s.addRange(r);
      });
      await sleep(80);
      await page.keyboard.press("Backspace");
      await page.keyboard.press("Delete");
      await sleep(250);
      const st = await state(page);
      const x = await importNow(page);
      check(!!x.stored && String(x.stored.body).indexOf(T) < 0, "trimming the title out of the box removes it from the import");
      check(st.headings === 7 && !!x.view && x.view.headings === 7 && !x.post.structureUnseen,
        "...and every heading survives the edit — the box edits structure, not a copy of the text", brief(x));
      await page.close();
    }

    // Pasting twice; the second paste is structure too.
    {
      const page = await openStart();
      await pasteInto(page, BOX, PLAIN_CRLF, RICH);
      await pasteKey(page);
      const st = await state(page);
      check(st.headings === 14, "a second paste adds its headings to the first's", String(st.headings));
      await page.close();
    }

    // PASTING INTO A SELECTION. Every paste used to be inserted as a closed
    // block, so a phrase split its sentence and a word pasted inside a
    // heading split the heading. A paste lands where ProseMirror's own paste
    // puts it now: one paragraph joins the line it lands in.
    {
      const inlineCases: [string, string, string | null][] = [
        ["a plain-text phrase", "brand-new ", null],
        ["a Word-for-the-web phrase", "brand-new ", `<div class="OutlineElement Ltr"><p class="Paragraph" paraid="1"><span class="TextRun"><span class="NormalTextRun">brand-new&nbsp;</span></span></p></div>`],
      ];
      for (let i = 0; i < inlineCases.length; i++) {
        const page = await openStart();
        await pasteInto(page, BOX, PLAIN_LF, RICH);
        const s0 = await state(page);
        await setClip(page, inlineCases[i][1], inlineCases[i][2]);
        const caret = await selectIn(page, "The north pier was ", "after");
        await pasteKey(page);
        const s1 = await state(page);
        let pier = "";
        for (let b = 0; b < s1.blocks.length; b++) if (s1.blocks[b].indexOf("north pier was") >= 0) pier = s1.blocks[b];
        check(caret && s1.blocks.length === s0.blocks.length && /^P:The north pier was brand-new[  ]rebuilt after the storm/.test(pier),
          `${inlineCases[i][0]} pasted mid-sentence joins the sentence — no new paragraph, and its space kept`, JSON.stringify({ before: s0.blocks.length, after: s1.blocks.length, pier: pier.slice(0, 80) }));
        await page.close();
      }
      // The box's own clipboard: cut a phrase, paste it elsewhere.
      {
        const page = await openStart();
        await pasteInto(page, BOX, PLAIN_LF, RICH);
        const s0 = await state(page);
        await selectIn(page, "grey limestone", "text");
        await page.keyboard.press("KeyX", { commands: ["cut"] });
        await sleep(200);
        await selectIn(page, "The north pier was ", "after");
        await pasteKey(page);
        const s1 = await state(page);
        const x = await importNow(page);
        check(s1.blocks.length === s0.blocks.length && !!x.stored && /<p>The north pier was grey limestonerebuilt/.test(String(x.stored.body)),
          "a phrase cut and pasted inside the box stays inline, in the box and in what is stored", JSON.stringify({ before: s0.blocks.length, after: s1.blocks.length }));
        await page.close();
      }
      // Inside a heading.
      const H = QUESTION_HEADINGS[0];
      {
        const page = await openStart();
        await pasteInto(page, BOX, PLAIN_LF, RICH);
        await setClip(page, "Why does the customs house still stand?", null);
        await selectIn(page, H, "block");
        await pasteKey(page);
        const s1 = await state(page);
        const x = await importNow(page);
        check(s1.headings === 7 && s1.heads.indexOf("H2:Why does the customs house still stand?") >= 0 && !!x.view && x.view.headings === 7,
          "a plain question pasted over a heading's whole text REPLACES the text and keeps the heading (it was turned into a paragraph: 7 → 6)", JSON.stringify(s1.heads));
        await page.close();
      }
      {
        const page = await openStart();
        await pasteInto(page, BOX, PLAIN_LF, RICH);
        await setClip(page, "harbour", null);
        const inHeading = await selectIn(page, "customs", "text", H);
        await pasteKey(page);
        const s1 = await state(page);
        const x = await importNow(page);
        check(inHeading && s1.headings === 7 && s1.heads.indexOf("H2:What stone was used to build the old harbour house?") >= 0 && !!x.view && x.view.headings === 7,
          "one word pasted over a word inside a heading stays inside it (it split the heading in three: 7 → 8)", JSON.stringify(s1.heads));
        await page.close();
      }
    }

    // TEXT ONLY: said where it cannot be missed, and recorded.
    {
      const page = await openStart();
      await pasteInto(page, BOX, PLAIN_CRLF, null);
      const st = await state(page);
      check(!!st.notice && st.notice.role === "alert" && /headings did not come across/i.test(st.notice.text),
        "a text-only paste raises a warning between the box and the button (role=alert), not grey hint text", JSON.stringify(st.notice));
      check(/no headings/.test(st.hint), "...and the hint says \"no headings\" rather than a count that looks healthy");
      const x = await importNow(page);
      check(!!x.view && x.post.structureUnseen === "plain-text-paste" && x.view.reason === "plain-text-paste" && x.view.qh === "not scored",
        "...the route stores the record, and the studio does not score the headings the paste lost", brief(x));

      // THE WARNING'S OWN ADVICE: mark a heading. A storytelling line, as a
      // writer working top-down would. The warning gives way — the heading
      // criteria score what is marked — but the record is STILL SENT, so the
      // studio keeps offering the question lines left as paragraphs.
      await selectIn(page, STATEMENT_HEADING, "block");
      await page.click('[data-paste-box] button[title="Heading 2"]');
      await sleep(300);
      const st2 = await state(page);
      const x2 = await importNow(page);
      check(st2.headings === 1 && !st2.notice && !!st2.remaining && /5 more lines read like a question heading/.test(st2.remaining),
        "marking one statement heading clears the warning, and a quieter line counts the five question lines still unmarked", JSON.stringify({ h: st2.headings, notice: !!st2.notice, remaining: st2.remaining }));
      check(!!x2.view && x2.post.structureUnseen === "plain-text-paste" && x2.view.reason === "plain-text-paste" && /0 of 1 headings/.test(x2.view.qh),
        "...the record is still stored — the studio scores the one marked heading (\"0 of 1\") AND keeps the offers (it used to drop the record here)", brief(x2));
      await page.close();
    }

    // A "# Title" LINE. One heading in the box, and it is the title.
    {
      const page = await openStart();
      await pasteInto(page, BOX, "# " + TITLE + "\n\n" + PLAIN_LF, null);
      const st = await state(page);
      const x = await importNow(page);
      check(/1 heading/.test(st.hint) && !!st.notice && st.notice.role === "alert",
        "a plain paste opening \"# Title\" shows one heading AND the warning — a lone H1 is the title, not a section", JSON.stringify({ hint: st.hint, notice: !!st.notice }));
      check(!!x.view && x.view.reason === "plain-text-paste" && x.view.qh === "not scored",
        "...and it is stored with the record, so the studio does not read \"0 of 0\" (it used to, word for word)", brief(x));
      await page.close();
    }

    // UNDO AND REDO carry the record with the content.
    {
      const page = await openStart();
      await pasteInto(page, BOX, PLAIN_CRLF, null);
      await settleHistory();
      await selectAll(page);
      await page.keyboard.press("Backspace");
      await sleep(300);
      const s1 = await state(page);
      await undo(page);
      const s2 = await state(page);
      const x = await importNow(page);
      check(!s1.notice && !!s2.notice && /no headings/.test(s2.hint) && !!x.view && x.view.reason === "plain-text-paste" && x.view.qh === "not scored",
        "plain paste, select all, delete, UNDO: the warning comes back with the text, and the record is sent", JSON.stringify({ emptied: !!s1.notice, undone: !!s2.notice, x: brief(x) }));
      await page.close();
    }
    {
      const page = await openStart();
      await pasteInto(page, BOX, PLAIN_CRLF, null);
      await undo(page);
      const s1 = await state(page);
      await redo(page);
      const s2 = await state(page);
      const x = await importNow(page);
      check(!s1.notice && /Paste from a doc/.test(s1.hint) && !!s2.notice && !!x.view && x.view.reason === "plain-text-paste",
        "plain paste, UNDO (empty), REDO: the warning and the record return with the text", JSON.stringify({ undone: s1.hint, redone: !!s2.notice, x: brief(x) }));
      await page.close();
    }
    {
      const page = await openStart();
      await pasteInto(page, BOX, PLAIN_LF, null);
      await settleHistory();
      await setClip(page, PLAIN_LF, RICH);
      await page.focus(BOX);
      await selectAll(page);
      await pasteKey(page);
      const s1 = await state(page);
      await undo(page);
      const s2 = await state(page);
      const x = await importNow(page);
      check(s1.headings === 7 && !s1.notice && s2.headings === 0 && !!s2.notice && !!x.view && x.view.reason === "plain-text-paste",
        "plain paste, a rich paste over ALL of it (record cleared), UNDO: the plain text comes back WITH its record", JSON.stringify({ over: [s1.headings, !!s1.notice], undone: [s2.headings, !!s2.notice], x: brief(x) }));
      await redo(page);
      const s3 = await state(page);
      const x3 = await importNow(page);
      check(s3.headings === 7 && !s3.notice && !!x3.view && x3.view.reason === null,
        "...and REDO puts the rich paste back with no record", JSON.stringify({ redone: [s3.headings, !!s3.notice], x: brief(x3) }));
      await page.close();
    }

    // A rich paste over everything replaces the record; a one-line plain
    // paste records nothing.
    {
      const page = await openStart();
      await pasteInto(page, BOX, PLAIN_LF, null);
      await setClip(page, "", "<p>Replaced with a paragraph that has no headings but came as html.</p><p>Second.</p>");
      await page.focus(BOX);
      await selectAll(page);
      await pasteKey(page);
      const st = await state(page);
      check(!st.notice, "a rich paste over everything clears what an earlier plain paste lost", JSON.stringify(st.notice));
      await page.close();

      const p2 = await openStart();
      await pasteInto(p2, BOX, "A single line of text.", null);
      const s2 = await state(p2);
      check(!s2.notice, "a single-line plain paste raises nothing");
      await p2.close();
    }

    // Pages / TextEdit.
    {
      const page = await openStart();
      await pasteInto(page, BOX, "A bold line\nBody text.", `<!DOCTYPE html PUBLIC "-//W3C//DTD HTML 4.01//EN"><html><head><meta name="Generator" content="Cocoa HTML Writer"></head><body><p class="p3"><span class="s1"><b>A bold line that was a heading</b></span></p><p class="p1"><span class="s1">Body text.</span></p></body></html>`);
      const st = await state(page);
      const x = await importNow(page);
      check(!!st.notice && !!x.view && x.post.structureUnseen === "rtf-paste" && x.view.reason === "rtf-paste" && !/DOCTYPE/.test(st.boxHtml),
        "an RTF paste (Pages, TextEdit) is warned about and recorded, and no DOCTYPE text reaches the box", brief(x));
      await page.close();
    }

    // A BOLD LINE FROM WORD. Word and Pages mark bold with <b>, which the
    // bold-line heading rule deliberately does not read, and the box shows a
    // bold paragraph. The editor writes bold back out as <strong>, which the
    // rule DOES read — so the route, converting the box's HTML a second time,
    // stored a heading the writer never saw.
    {
      const page = await openStart();
      const word = `<html><body><!--StartFragment--><p class=MsoNormal><b><span style='font-size:14.0pt'>Why the quarry matters<o:p></o:p></span></b></p><p class=MsoNormal>The quarry has supplied the harbour's stone for two centuries, and the certification records it.</p><!--EndFragment--></body></html>`;
      await pasteInto(page, BOX, "Why the quarry matters\r\nThe quarry has supplied the harbour's stone for two centuries, and the certification records it.", word);
      const st = await state(page);
      const x = await importNow(page);
      check(st.headings === 0 && /<strong>Why the quarry matters<\/strong>/.test(st.boxHtml) && !!x.stored && headingCountOf(x.stored.body || "") === 0
        && /<p><strong>Why the quarry matters<\/strong><\/p>/.test(String(x.stored.body)),
        "a bold line from Word is a bold paragraph in the box AND in what is stored — the route does not guess a heading the box never showed", JSON.stringify({ box: st.headings, stored: x.stored && x.stored.body }));
      await page.close();
    }

    // AN HTML FLAVOUR WITH NO WORDS in it (an image-less fragment, a bare
    // <meta charset>): the words are in the text flavour, and must arrive.
    {
      const page = await openStart();
      await pasteInto(page, BOX, PLAIN_LF, "<meta charset='utf-8'>");
      const st = await state(page);
      check(st.headings === 0 && /What stone was used to build the old customs house\?/.test(st.boxHtml) && !!st.notice,
        "an html flavour holding no words: the text flavour is pasted instead, and recorded as plain text", JSON.stringify({ hint: st.hint, notice: !!st.notice }));
      await page.close();
    }

    // A DROP is a paste at the drop point: the same door, the same record.
    // Dispatched as a DragEvent carrying a real DataTransfer, which is what
    // ProseMirror's drop handler reads; the coordinates are inside the box's
    // empty first line.
    {
      const drops: [string, string, string | null][] = [["text only", PLAIN_LF, null], ["html beside CRLF text", PLAIN_CRLF, RICH]];
      for (let i = 0; i < drops.length; i++) {
        const page = await openStart();
        const handled = await page.evaluate((sel: string, plain: string, html: string | null) => {
          const pm = document.querySelector(sel) as HTMLElement;
          const r = (pm.firstElementChild as HTMLElement).getBoundingClientRect();
          const dt = new DataTransfer();
          dt.setData("text/plain", plain);
          if (html !== null) dt.setData("text/html", html);
          const ev = new DragEvent("drop", { dataTransfer: dt, clientX: r.left + 4, clientY: r.top + r.height / 2, bubbles: true, cancelable: true });
          pm.dispatchEvent(ev);
          return ev.defaultPrevented;
        }, BOX, drops[i][1], drops[i][2]);
        await sleep(350);
        const st = await state(page);
        const x = await importNow(page);
        const rich = drops[i][2] !== null;
        check(handled && !!x.view && (rich
          ? st.headings === 7 && !st.notice && x.view.headings === 7 && x.view.reason === null
          : st.headings === 0 && !!st.notice && x.view.reason === "plain-text-paste" && x.view.qh === "not scored"),
          `a DROP (${drops[i][0]}) goes through the same door as a paste — ${rich ? "seven headings, nothing recorded" : "warned about and recorded"}`,
          JSON.stringify({ handled, headings: st.headings, notice: !!st.notice, x: brief(x) }));
        await page.close();
      }
    }

    // THE BACKSTOP. A paste with no clipboardData (old browsers; ProseMirror
    // then captures it through the DOM) never reaches handlePaste's own
    // conversion, so transformPastedHTML must put it through the sanitiser.
    // view.pasteHTML is that path. An ARIA heading tells the two apart: the
    // sanitiser makes it an <h2>, ProseMirror's schema alone keeps a <p>.
    {
      const page = await openStart();
      await page.click(BOX);
      const out = await page.evaluate(() => {
        const pm: any = document.querySelector("[data-paste-box] .ProseMirror");
        // Tiptap hangs the editor on its root element; its view is the
        // ProseMirror EditorView whose pasteHTML runs the paste pipeline.
        const view = pm && pm.editor ? pm.editor.view : null;
        if (!view) return { ok: false, html: "no view" };
        view.pasteHTML('<p role="heading" aria-level="2">An ARIA heading</p><p>Body <a href="javascript:window.__xss=9">x</a></p>');
        return { ok: true, html: pm.innerHTML };
      });
      await sleep(200);
      check(out.ok && /<h2>An ARIA heading<\/h2>/.test(out.html) && !/javascript:/.test(out.html),
        "a paste with no clipboardData still goes through the sanitiser (the transformPastedHTML backstop)", JSON.stringify(out));
      await page.close();
    }

    // The door did not widen. A hostile clipboard, through the real box.
    {
      const page = await openStart();
      await pasteInto(page, BOX, "x\ny",
        `<h2 onclick="window.__xss=1">Heading</h2><p>Text <img src="https://example.invalid/x.png" onerror="window.__xss=2"><a href="javascript:window.__xss=3">link</a><script>window.__xss=4</script></p><iframe src="https://example.invalid"></iframe>`);
      await sleep(400);
      const st = await state(page);
      check(!st.xss && !/<script|<iframe|\son[a-z]+=|javascript:/i.test(st.boxHtml) && /<h2>Heading<\/h2>/.test(st.boxHtml),
        "a hostile clipboard leaves no script, handler, iframe or javascript: URL in the box — sanitizeImportedHtml is the door", JSON.stringify(st));
      await page.close();
    }

    {
      let diff = "";
      for (let i = 0; i < boxVsStored.length; i++) if (boxVsStored[i].box !== boxVsStored[i].stored) diff += `#${i + 1} box [${boxVsStored[i].box}] stored [${boxVsStored[i].stored}]; `;
      check(boxVsStored.length >= 15 && !diff,
        `across all ${boxVsStored.length} imports above, the route stored exactly the headings the box showed — no more, no fewer`, diff.slice(0, 600));
    }

    console.log(`\n7. The studio: the notice, the panel and an accepted offer, in Chrome`);
    {
      const stored = toEditorHtml(classifyPaste({ text: PLAIN_CRLF }).html, true);
      const page = await open();
      await page.evaluate((h: string, q: string[]) => (window as any).__mountStudio(h, "plain-text-paste", q), stored, QUERY);
      await page.waitForSelector("#studio .ProseMirror");
      await sleep(250);
      const s1 = await page.evaluate(() => {
        const n = document.querySelector("#studio [data-structure-notice]");
        const offers = Array.prototype.slice.call(document.querySelectorAll("#studio [data-heading-offers] [data-offer]"));
        const panel = document.getElementById("panel")!;
        return {
          notice: n ? { role: n.getAttribute("role"), text: n.textContent || "" } : null,
          offers: offers.length,
          panelNotice: !!panel.querySelector("[data-headings-not-scored]"),
          panelText: panel.textContent || "",
        };
      });
      check(!!s1.notice && s1.notice.role === "alert" && s1.offers === 5,
        "above the draft: the warning, and the five question lines offered one by one", JSON.stringify(s1.notice && s1.notice.text.slice(0, 160)) + " offers=" + s1.offers);
      check(s1.panelNotice && /Headings not scored/.test(s1.panelText) && s1.panelText.indexOf("Question-shaped section headings") < 0,
        "in the Score tab: \"Headings not scored\", and question headings are NOT in the list of things to fix");

      // A judge finding in the LAST paragraph, then accept the first offer.
      const quote = "Taken together, the projects describe a city that keeps building with the material it started with.";
      await page.evaluate((q: string) => {
        const st = (window as any).__studio;
        const ed = st.editor;
        ed.view.dispatch(ed.state.tr.setMeta(st.key, { type: "set", findings: [{ id: "f1", criterion: "x", severity: "low", quote: q, explanation: "e", suggestedEdit: null }] }));
      }, quote);
      const before = await page.evaluate(() => { const st = (window as any).__studio; const s = st.key.getState(st.editor.state); return s.issues.map((i: any) => i.status); });
      await page.evaluate(() => { (document.querySelector("#studio [data-offer]") as HTMLButtonElement).click(); });
      await sleep(300);
      const s2 = await page.evaluate((q: string) => {
        const st = (window as any).__studio;
        const ed = st.editor;
        const hs = st.editor.view.dom.querySelectorAll("h2");
        const iss = st.key.getState(ed.state).issues;
        const i0 = iss[0];
        return {
          h2: hs.length, first: hs.length ? hs[0].textContent : "",
          finding: i0 ? { status: i0.status, text: ed.state.doc.textBetween(i0.from, i0.to) } : null,
          q,
          notice: (document.querySelector("#studio [data-structure-notice]") || { textContent: "" }).textContent,
          panelNotice: !!document.querySelector("#panel [data-headings-not-scored]"),
        };
      }, quote);
      check(before.length === 1 && before[0] === "active", "precondition: the finding anchored before the offer was accepted");
      check(s2.h2 === 1 && s2.first === QUESTION_HEADINGS[0], "clicking the offer makes that ONE line a heading", JSON.stringify(s2));
      check(!!s2.finding && s2.finding.status === "active" && s2.finding.text === quote,
        "...and a judge finding elsewhere keeps its mark — the edit replaced one paragraph, not the document", JSON.stringify(s2.finding));
      check(/4 more lines read like a question heading/.test(s2.notice || "") && /score the headings marked so far/.test(s2.notice || "") && !s2.panelNotice,
        "the notice drops to the remaining offers, says the criteria now score what is marked, and the panel scores headings again", JSON.stringify({ notice: s2.notice, panel: s2.panelNotice }));
      await page.close();
    }
    // The partial state and the lone title, each mounted as the studio would open it.
    {
      const partial = promoteLineToHeading(plainImported, { text: STATEMENT_HEADING }, 2)!;
      const page = await open();
      await page.evaluate((h: string, q: string[]) => (window as any).__mountStudio(h, "plain-text-paste", q), partial, QUERY);
      await page.waitForSelector("#studio .ProseMirror");
      await sleep(250);
      const s = await page.evaluate(() => {
        const n = document.querySelector("#studio [data-structure-notice]");
        return { role: n ? n.getAttribute("role") : "absent", offers: document.querySelectorAll("#studio [data-offer]").length, panelNotice: !!document.querySelector("#panel [data-headings-not-scored]") };
      });
      check(s.role === null && s.offers === 5 && !s.panelNotice,
        "a draft imported with one statement heading marked opens with the five question lines on offer (not an alert: the criteria are scored)", JSON.stringify(s));
      await page.close();

      const lone = toEditorHtml("# " + TITLE + "\n\n" + PLAIN_LF, false);
      const p2 = await open();
      await p2.evaluate((h: string, q: string[]) => (window as any).__mountStudio(h, "plain-text-paste", q), lone, QUERY);
      await p2.waitForSelector("#studio .ProseMirror");
      await sleep(250);
      const s2 = await p2.evaluate(() => {
        const n = document.querySelector("#studio [data-structure-notice]");
        return { role: n ? n.getAttribute("role") : "absent", panelNotice: !!document.querySelector("#panel [data-headings-not-scored]") };
      });
      check(s2.role === "alert" && s2.panelNotice, "a draft whose only heading is its title opens with the warning and \"Headings not scored\"", JSON.stringify(s2));
      await p2.close();
    }
  } finally {
    await browser.close();
  }

  // ── 8. The wiring ─────────────────────────────────────────────────────
  console.log(`\n8a. The import route, run: what it stores, read back the way the studio reads it`);
  {
    const need = ["@/lib/auth", "@/lib/permissions", "@/lib/supabase-intelligence"];
    let missing = "";
    for (let i = 0; i < need.length; i++) if (!stubsUsed[need[i]]) missing += need[i] + " ";
    check(!missing, "PRECONDITION: the route really ran through requireOptimizer and the insert, with only these boundaries stubbed", missing);
    const plainBox = classifyPaste({ text: PLAIN_LF }).html;
    const a = await importThroughRoute({ workspaceId: "w1", source: "pasted", title: TITLE, content: plainBox, contentIsHtml: true, contentIsEditorHtml: true, structureUnseen: "plain-text-paste" });
    check(a.status === 200 && structureUnseenOfBrief(a.brief) === "plain-text-paste" && a.json.structureUnseen === "plain-text-paste" && a.body === toEditorHtml(plainBox, true),
      "a plain paste's claim is stored in the session's brief, and the body is stored as converted", JSON.stringify({ status: a.status, brief: a.brief }));
    const b = await importThroughRoute({ workspaceId: "w1", source: "pasted", title: TITLE, content: toEditorHtml(RICH, true), contentIsHtml: true, contentIsEditorHtml: true });
    check(b.status === 200 && !!b.brief && !Object.prototype.hasOwnProperty.call(b.brief, "structureUnseen") && structureUnseenOfBrief(b.brief) === null,
      "a rich paste stores no record at all — the key is absent, not null", JSON.stringify(b.brief));
    const c = await importThroughRoute({ workspaceId: "w1", source: "pasted", title: TITLE, content: promoteLineToHeading(plainBox, { text: STATEMENT_HEADING })!, contentIsHtml: true, contentIsEditorHtml: true, structureUnseen: "plain-text-paste" });
    check(structureUnseenOfBrief(c.brief) === "plain-text-paste", "a claim with a heading already marked is stored", JSON.stringify(c.brief));
    const d = await importThroughRoute({ workspaceId: "w1", source: "pasted", title: TITLE, content: PLAIN_LF, contentIsHtml: false });
    check(structureUnseenOfBrief(d.brief) === "plain-text-paste" && headingCountOf(d.body || "") === 0, "an old client's textarea text is stored with the record the server derived", JSON.stringify(d.brief));
    const e = await importThroughRoute({ workspaceId: "w1", source: "pasted", title: TITLE, content: plainBox, contentIsHtml: true, contentIsEditorHtml: true, structureUnseen: "plain-text-export" });
    check(structureUnseenOfBrief(e.brief) === null, "a forged server-side reason is not stored", JSON.stringify(e.brief));
    // The box's HTML is re-sanitised, not re-inferred; raw clipboard HTML
    // from an older client still gets the whole conversion.
    const bold = "<p><strong>Why the quarry matters</strong></p><p>The quarry has supplied the harbour's stone.</p><script>x()</script>";
    const f = await importThroughRoute({ workspaceId: "w1", source: "pasted", title: TITLE, content: bold, contentIsHtml: true, contentIsEditorHtml: true });
    const g = await importThroughRoute({ workspaceId: "w1", source: "pasted", title: TITLE, content: bold, contentIsHtml: true });
    check(headingCountOf(f.body || "") === 0 && !/script/.test(String(f.body)) && headingCountOf(g.body || "") === 1,
      "the box's own HTML is sanitised again but not re-inferred (a bold line stays a paragraph); an old client's raw HTML is converted in full", JSON.stringify({ box: f.body, raw: g.body }));
  }

  console.log(`\n8b. The page and the assess route pass exactly the record — read as syntax, not as text`);
  const parse = (rel: string) => ts.createSourceFile(rel, readFileSync(join(ROOT, rel), "utf8"), ts.ScriptTarget.Latest, true, /x$/.test(rel) ? ts.ScriptKind.TSX : ts.ScriptKind.TS);
  const all = (root: ts.Node, pred: (n: ts.Node) => boolean): ts.Node[] => {
    const out: ts.Node[] = [];
    const visit = (n: ts.Node): void => { if (pred(n)) out.push(n); ts.forEachChild(n, visit); };
    visit(root);
    return out;
  };
  const isCallTo = (n: ts.Node, name: string): n is ts.CallExpression => ts.isCallExpression(n) && ts.isIdentifier(n.expression) && n.expression.text === name;
  /** The expression an object literal passes for `name` — a shorthand property passes the identifier of that name. */
  const passed = (obj: ts.Node | undefined, name: string): string | null => {
    if (!obj || !ts.isObjectLiteralExpression(obj)) return null;
    for (let i = 0; i < obj.properties.length; i++) {
      const p = obj.properties[i];
      if (ts.isShorthandPropertyAssignment(p) && p.name.text === name) return p.name.text;
      if (ts.isPropertyAssignment(p) && ts.isIdentifier(p.name) && p.name.text === name) return p.initializer.getText();
    }
    return null;
  };
  /** The dependency list of the nearest useCallback/useMemo around `n`. */
  const hookDeps = (n: ts.Node): string[] | null => {
    for (let p: ts.Node | undefined = n.parent; p; p = p.parent) {
      if ((isCallTo(p, "useCallback") || isCallTo(p, "useMemo")) && p.arguments.length > 1 && ts.isArrayLiteralExpression(p.arguments[1])) {
        const els = (p.arguments[1] as ts.ArrayLiteralExpression).elements;
        const out: string[] = [];
        for (let i = 0; i < els.length; i++) out.push(els[i].getText());
        return out;
      }
    }
    return null;
  };
  const inFunction = (n: ts.Node): ts.Node | null => {
    for (let p: ts.Node | undefined = n.parent; p; p = p.parent) if (ts.isFunctionLike(p)) return p;
    return null;
  };
  const declares = (scope: ts.Node, name: string, init: string): boolean =>
    all(scope, (n) => ts.isVariableDeclaration(n) && ts.isIdentifier(n.name) && n.name.text === name && !!n.initializer && n.initializer.getText() === init).length > 0;
  {
    const page = parse("app/engineai/optimizer/page.tsx");
    const studio = all(page, (n) => ts.isFunctionDeclaration(n) && !!n.name && n.name.text === "OptimizerStudio")[0];
    check(!!studio, "PRECONDITION: the page's studio component is found");
    // One binding of the name, the state's — so every shorthand below means the state.
    const bindings = studio ? all(studio, (n) => (ts.isVariableDeclaration(n) || ts.isBindingElement(n) || ts.isParameter(n)) && ts.isIdentifier((n as any).name) && (n as any).name.text === "structureUnseen") : [];
    const stateBinding = bindings.length === 1 && ts.isBindingElement(bindings[0]) && ts.isArrayBindingPattern(bindings[0].parent)
      && /^useState<[^>]*>\(null\)$/.test((bindings[0].parent.parent as ts.VariableDeclaration).initializer!.getText());
    check(stateBinding, "`structureUnseen` in the studio is bound ONCE, by its useState — nothing shadows it", String(bindings.length));

    const scorers = studio ? all(studio, (n) => isCallTo(n, "computeDraftScores")) as ts.CallExpression[] : [];
    check(scorers.length >= 1, `PRECONDITION: the studio's own scorers are found (${scorers.length})`);
    for (let i = 0; i < scorers.length; i++) {
      const v = passed(scorers[i].arguments[0], "structureUnseen");
      const deps = hookDeps(scorers[i]);
      check(v === "structureUnseen" && !!deps && deps.indexOf("structureUnseen") >= 0,
        `computeDraftScores #${i + 1} (the live marks) passes the record itself, and re-runs when it changes`, JSON.stringify({ passes: v, deps }));
    }
    const si = studio ? all(studio, (n) => ts.isVariableDeclaration(n) && ts.isIdentifier(n.name) && n.name.text === "scoreInput")[0] as ts.VariableDeclaration : undefined;
    const memo = si && si.initializer && isCallTo(si.initializer, "useMemo") ? si.initializer : null;
    const arrow = memo && ts.isArrowFunction(memo.arguments[0]) ? memo.arguments[0] as ts.ArrowFunction : null;
    const obj = arrow && ts.isParenthesizedExpression(arrow.body) ? arrow.body.expression : undefined;
    const siDeps = memo && ts.isArrayLiteralExpression(memo.arguments[1]) ? (memo.arguments[1] as ts.ArrayLiteralExpression).elements.map((e) => e.getText()) : [];
    check(passed(obj, "structureUnseen") === "structureUnseen" && siDeps.indexOf("structureUnseen") >= 0,
      "the Score tab's input passes the record itself, and is rebuilt when it changes", JSON.stringify({ passes: passed(obj, "structureUnseen"), deps: siDeps }));

    const sets = studio ? all(studio, (n) => isCallTo(n, "setStructureUnseen")) as ts.CallExpression[] : [];
    let hydrations = 0;
    let other = "";
    for (let i = 0; i < sets.length; i++) {
      const arg = sets[i].arguments[0] ? sets[i].arguments[0].getText() : "";
      if (arg === "null") continue;
      const fn = inFunction(sets[i]);
      if (arg === "structureUnseenOfBrief(brief)" && fn && declares(fn, "brief", "sess.brief || {}")) hydrations++;
      else other += arg + " ";
    }
    check(hydrations === 1 && !other, "hydration reads the record from the session's brief through structureUnseenOfBrief, and nothing else sets it but resets to null", JSON.stringify({ hydrations, other }));

    const notices = studio ? all(studio, (n) => ts.isJsxSelfClosingElement(n) && n.tagName.getText() === "StructureNotice") as ts.JsxSelfClosingElement[] : [];
    const attr = (el: ts.JsxSelfClosingElement, name: string): string | null => {
      const ps = el.attributes.properties;
      for (let i = 0; i < ps.length; i++) {
        const a = ps[i];
        if (ts.isJsxAttribute(a) && a.name.getText() === name && a.initializer && ts.isJsxExpression(a.initializer) && a.initializer.expression) return a.initializer.expression.getText();
      }
      return null;
    };
    const mh = studio ? all(studio, (n) => ts.isVariableDeclaration(n) && ts.isIdentifier(n.name) && n.name.text === "makeHeading")[0] : undefined;
    const accepts = mh ? all(mh, (n) => isCallTo(n, "applyHeadingOffer") && (n as ts.CallExpression).arguments.map((x) => x.getText()).join(",") === "editor,offer").length : 0;
    check(notices.length === 1 && attr(notices[0], "reason") === "structureUnseen" && attr(notices[0], "html") === "body" && attr(notices[0], "onMakeHeading") === "makeHeading" && accepts === 1,
      "the notice is rendered with the record and the body, and accepts offers through applyHeadingOffer", JSON.stringify(notices.length ? { reason: attr(notices[0], "reason"), html: attr(notices[0], "html"), on: attr(notices[0], "onMakeHeading"), accepts } : null));
  }
  {
    const assess = parse("app/api/optimizer/sessions/[id]/assess/route.ts");
    const det = all(assess, (n) => ts.isVariableDeclaration(n) && ts.isIdentifier(n.name) && n.name.text === "det")[0] as ts.VariableDeclaration | undefined;
    const call = det && det.initializer && isCallTo(det.initializer, "computeDraftScores") ? det.initializer : null;
    const fn = call ? inFunction(call) : null;
    const merged = all(assess, (n) => isCallTo(n, "mergePillars") && (n as ts.CallExpression).arguments.length > 0 && (n as ts.CallExpression).arguments[0].getText() === "det").length;
    check(!!call && passed(call.arguments[0], "structureUnseen") === "structureUnseenOfBrief(brief)" && !!fn && declares(fn, "brief", "session.config_brief || {}") && merged === 1,
      "the assess route scores the saved assessment with the stored record, read through the same function, and that score is the one merged", JSON.stringify({ passes: call ? passed(call.arguments[0], "structureUnseen") : null, merged }));
  }

  console.log(failures ? `\n${failures} FAILURE(S)\n` : `\nAll checks passed.\n`);
  process.exit(failures ? 1 : 0);
}

main().catch((e) => {
  console.log(`\n✗ the check itself failed: ${e && e.stack ? e.stack : e}\n`);
  process.exit(1);
});
