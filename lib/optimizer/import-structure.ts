/**
 * What an import could, and could not, see of the source's structure.
 *
 * THE INCIDENT (2026-09-23). A writer pasted a feature article into the
 * Optimizer twice, ninety seconds apart. Both arrived as plain text — the
 * stored body was nothing but <p> and <br>, one storytelling heading fused
 * onto the question heading beneath it — and the studio reported "0 of 0
 * headings are question-shaped", 0/10. She concluded that the article's
 * structure, storytelling section headings over question subheadings, was bad
 * practice. It was not: two colleagues imported the SAME article as the Word
 * file, all eleven headings survived, question-headings scored 10/10 and the
 * piece 63 against her 43-45. The tool had measured the paste and reported it
 * as the writing.
 *
 * Two things were wrong and this module holds the half that is about HONESTY:
 *
 *   1. The paste box threw the structure away. Fixed in the box itself
 *      (components/optimizer/StartScreen.tsx) — classifyPaste below is the one
 *      door every paste now goes through, and it is the same conversion the
 *      import route runs.
 *   2. When the structure really IS gone — the source offered only text/plain,
 *      or offered HTML that cannot carry a heading — nothing said so. Not
 *      looking and finding nothing are different claims; the live-page audit
 *      already refuses to report "no gap found" when its render did not run,
 *      and the rubric now refuses to report "no headings" when the import
 *      could not see any. The heading criteria SKIP, with the reason, while
 *      the draft holds no section heading, and the studio says why in words.
 *
 * ONE PREDICATE, headingsUnseen(). The engine, the score panel's notice, the
 * studio banner and the paste box all ask it, so the number and the sentence
 * explaining it cannot disagree about whether headings were scored.
 *
 * THE RECORD IS PROVENANCE; THE PREDICATE IS SCORING. They were one gate and
 * that lost the record, three ways, each measured in Chrome against the real
 * box on 2026-09-23: a writer who followed the warning's own advice and marked
 * ONE storytelling line as a heading sent no record, and the studio then read
 * "0 of 1 headings are question-shaped" with nothing offering the five
 * question lines still sitting in the text as paragraphs — Catherine's
 * conclusion, reached by a different road; a plain paste whose first line was
 * "# Title" recorded nothing, and a lone H1 is the TITLE, so the studio read
 * "0 of 0", the incident's words exactly; and an undo brought the plain text
 * back without its record. So the record is now kept whenever the source's
 * headings could not be seen, whatever the draft holds, and only
 * headingsUnseen — asked every time the draft is scored — decides whether the
 * heading criteria are measured.
 *
 * Pure and synchronous, like the rest of lib/optimizer.
 */

import { toEditorHtml } from "./import-html";
import { parseDraft, sectionLevels } from "./parse";

/**
 * Why an import could not see the source's headings. Recorded on the session
 * (config_brief.structureUnseen) by the import, never inferred afterwards —
 * once the text is in the editor, "the writer wrote no headings" and "the
 * paste lost them" produce the same HTML.
 *
 *   plain-text-paste   the clipboard offered text/plain only (Paste and Match
 *                      Style, a plain-text source, or a browser that dropped
 *                      the rich flavour)
 *   rtf-paste          Pages or TextEdit: the clipboard offered RTF, which
 *                      Chrome converts with Cocoa's HTML writer — and RTF has
 *                      no heading element for that writer to emit, so the
 *                      HTML carries sizes and bold, never structure
 *   plain-text-export  the shared-Drive list, which reads a Google Doc through
 *                      Drive's text/plain export
 *   plain-text-file    an uploaded .txt
 */
export type StructureUnseenReason = "plain-text-paste" | "rtf-paste" | "plain-text-export" | "plain-text-file";

const REASONS: StructureUnseenReason[] = ["plain-text-paste", "rtf-paste", "plain-text-export", "plain-text-file"];

/** The reasons a browser may claim for a paste. The route accepts only these
 *  from a client; the other two are decided server-side, from the source. */
export const PASTE_REASONS: StructureUnseenReason[] = ["plain-text-paste", "rtf-paste"];

/**
 * Narrow a stored or posted value to a known reason. A hand-edited jsonb value
 * or a crafted POST must not put an unknown string into the engine, where it
 * would switch criteria off for a reason nobody can read.
 */
export function normaliseStructureUnseen(v: unknown): StructureUnseenReason | null {
  return typeof v === "string" && REASONS.indexOf(v as StructureUnseenReason) >= 0 ? (v as StructureUnseenReason) : null;
}

/**
 * The criteria whose measurement IS the headings. With none visible each one
 * would report a fact about the paste: question-headings "0 of 0", hierarchy
 * "no subheadings in a long draft", density "0.0 per 1,000 words", query terms
 * "0% coverage" of headings that were never seen, and heading-answer adjacency
 * has nothing to be adjacent to.
 *
 * The chunk criteria (pronoun-opening-chunks, chunk-entity-naming) are NOT
 * here. With no headings the document is one chunk, which they measure as a
 * lede — a narrower claim, but a true one about the text that is there.
 */
export const HEADING_CRITERIA = [
  "query-terms-in-headings",
  "question-headings",
  "heading-answer-adjacency",
  "heading-hierarchy",
  "heading-density",
];

/**
 * THE predicate. True when the import recorded that it could not see the
 * source's headings AND the draft holds no SECTION heading.
 *
 * The second half is what clears it. Once the writer marks a section heading
 * — or accepts an offered one — the structure in the editor is theirs, and
 * the criteria score what is there. The record itself stays on the session as
 * provenance: it is still true that the source's headings were never seen,
 * and it is what keeps the studio offering the question lines still unmarked.
 *
 * SECTION headings, not headings: the count is the one the heading criteria
 * divide by (sectionLevels). A draft whose only heading is a lone H1 has a
 * TITLE and no sections, and question-headings reads "0 of 0" on it — so a
 * predicate counting that H1 switched the criteria back on for exactly the
 * verdict the record exists to prevent.
 */
export function headingsUnseen(reason: StructureUnseenReason | string | null | undefined, sectionHeadings: number): boolean {
  return normaliseStructureUnseen(reason) !== null && sectionHeadings === 0;
}

/** Every heading parseDraft finds — the number the paste box shows the
 *  writer ("7 headings"). Not the predicate's number; see below. */
export function headingCountOf(html: string): number {
  return parseDraft({ body: html || "" }).headings.length;
}

/** Headings at the levels sectionLevels makes the draft's SECTIONS — the
 *  count question-headings, heading-density and heading-hierarchy measure.
 *  The engine calls this with its own parse, so the predicate and the
 *  criteria cannot count differently. */
export function sectionHeadingCount(headings: { level: number }[]): number {
  const lv = sectionLevels(headings);
  let n = 0;
  for (let i = 0; i < headings.length; i++) if (headings[i].level === lv[0] || headings[i].level === lv[1]) n++;
  return n;
}

/** sectionHeadingCount of editor HTML, parsed exactly as the engine parses it. */
export function sectionHeadingCountOf(html: string): number {
  return sectionHeadingCount(parseDraft({ body: html || "" }).headings);
}

/**
 * The record's place in a session's brief (config_brief), written by the
 * import route and read by the page's hydration and the assess route. One
 * pair of functions, so a key renamed on one side cannot leave the other
 * reading a field nothing writes — the stored record would simply never be
 * found, and every consumer would score "0 of 0" in good faith.
 */
export function briefStructureFields(reason: StructureUnseenReason | null): { structureUnseen?: StructureUnseenReason } {
  return reason ? { structureUnseen: reason } : {};
}

/** The record as a consumer reads it back from a stored brief, narrowed. */
export function structureUnseenOfBrief(brief: unknown): StructureUnseenReason | null {
  return brief && typeof brief === "object" ? normaliseStructureUnseen((brief as { structureUnseen?: unknown }).structureUnseen) : null;
}

/**
 * The skip reason shown against each heading criterion. No trailing full stop:
 * the ship checklist renders it as "Not checked — <reason>." and the pillar
 * list lower-cases it after "not scored —".
 */
export function structureUnseenSkipReason(reason: StructureUnseenReason): string {
  switch (reason) {
    case "rtf-paste": return "Pasted from Pages or TextEdit, which hand over no heading markup, so the source's headings could not be seen";
    case "plain-text-export": return "Read through a plain-text export, so the document's headings could not be seen";
    case "plain-text-file": return "Imported from a .txt file, which carries no headings, so the source's headings could not be seen";
    default: return "Pasted as plain text, so the source's headings could not be seen";
  }
}

/**
 * Which heading criteria a score ACTUALLY skipped for this import's reason —
 * read out of the engine's result rather than predicted beside it, so a panel
 * that explains the gap can only ever explain the gap the number has. Null
 * when none were (no record, or the draft now holds headings).
 */
export function structureUnseenInScores(
  scores: { pillars: { criteria: { key: string; name: string; skipped?: boolean; skipReason?: string }[] }[] } | null,
  reason: StructureUnseenReason | string | null | undefined
): { reason: StructureUnseenReason; criteria: string[] } | null {
  const r = normaliseStructureUnseen(reason);
  if (!r || !scores) return null;
  const why = structureUnseenSkipReason(r);
  const names: string[] = [];
  for (let i = 0; i < scores.pillars.length; i++) {
    const cs = scores.pillars[i].criteria;
    for (let c = 0; c < cs.length; c++) {
      if (cs[c].skipped && cs[c].skipReason === why && HEADING_CRITERIA.indexOf(cs[c].key) >= 0) names.push(cs[c].name);
    }
  }
  return names.length ? { reason: r, criteria: names } : null;
}

/** The words for the notice the writer cannot miss — before import and in the
 *  studio. Title, what happened, and what to do, in that order. */
export function structureUnseenAdvice(reason: StructureUnseenReason): { title: string; body: string; remedy: string } {
  const scoring =
    "Heading criteria are not scored until the piece has headings — a zero would describe the paste, not the writing.";
  switch (reason) {
    case "rtf-paste":
      return {
        title: "The headings did not come across",
        body: "Pages and TextEdit hand the browser formatting — sizes and bold — but no headings, so every heading arrived as an ordinary paragraph. " + scoring,
        remedy: "Mark the headings with H1 or H2, or export the document as .docx and upload that.",
      };
    case "plain-text-export":
      return {
        title: "This document came in without its headings",
        body: "The shared-document list reads a Google Doc as plain text, which keeps the words and drops the headings, links and lists. " + scoring,
        remedy: "Mark the headings with H1 or H2, or bring the document in again by pasting its link, which reads it with its structure.",
      };
    case "plain-text-file":
      return {
        title: "A .txt file has no headings to keep",
        body: "Plain text keeps the words and nothing else, so a heading in the original is an ordinary line here. " + scoring,
        remedy: "Mark the headings with H1 or H2, or upload the .docx the text came from.",
      };
    default:
      return {
        title: "The headings did not come across",
        body: "This arrived as plain text: the source handed over no headings, links or lists, so a line that was a heading is now an ordinary paragraph. " + scoring,
        remedy: "Mark the headings with H1 or H2, or bring it in again — upload the .docx, or copy from the source and paste with the ordinary paste shortcut rather than Paste and Match Style.",
      };
  }
}

/**
 * The import route's decision, as a pure function so a check can drive every
 * branch rather than read the route's text.
 *
 * WHICH DOOR THE CONTENT CAME THROUGH, not what it holds. This used to return
 * null whenever the body held a heading, and that threw the record away
 * before it was ever stored in the two cases that matter most: a writer who
 * marked one heading in the box before importing (as the warning tells her
 * to), and a plain paste whose markdown produced a lone "# Title". Whether the
 * heading criteria are measured is headingsUnseen's decision, made when the
 * draft is scored; this only says whether the source's headings could be seen.
 *
 *   pasted  the paste box says so (a plain-text or RTF paste), narrowed to
 *           the two reasons a browser can know. A client that predates the
 *           box — a cached bundle mid-deploy — still sends
 *           contentIsHtml:false for its textarea text, and that path went
 *           through plainTextToHtml by construction, so the server records it
 *           from its own conversion rather than waiting to be told.
 *   gdoc    the shared-Drive list reads Drive's text/plain export.
 *   file    an uploaded .txt. (.md marks its headings explicitly, so a
 *           markdown file with none has none.)
 *
 * A client can only CLAIM a reason for a paste. Its effects are that the
 * heading criteria read "not scored" on the claimant's own draft while it
 * holds no section heading, and that the studio offers its question-shaped
 * lines — nothing to gain by lying, nothing another workspace can see — and
 * a claim for any other source, or of a server-side reason, is ignored.
 */
export function structureUnseenForImport(args: {
  source: string;
  /** Whether toEditorHtml took its plain-text door (importsAsPlainText). */
  convertedFromPlainText: boolean;
  /** The content before conversion. */
  raw: string;
  /** What the browser claimed, if anything. */
  claimed?: unknown;
  fileName?: string;
}): StructureUnseenReason | null {
  if (args.source === "pasted") {
    const claimed = normaliseStructureUnseen(args.claimed);
    if (claimed && PASTE_REASONS.indexOf(claimed) >= 0) return claimed;
    // Multi-line only, for the reason classifyPaste gives: a paste with no
    // line break cannot have carried a heading as a line of its own.
    return args.convertedFromPlainText && String(args.raw || "").replace(/\r\n?/g, "\n").trim().indexOf("\n") >= 0 ? "plain-text-paste" : null;
  }
  if (args.source === "gdoc") return args.convertedFromPlainText ? "plain-text-export" : null;
  if (args.source === "file") return /\.txt$/i.test(args.fileName || "") ? "plain-text-file" : null;
  return null;
}

// ── The paste door ───────────────────────────────────────────────────────

export interface PasteResult {
  /** Editor HTML, from the SAME conversion the import route runs. */
  html: string;
  /** Which clipboard flavour the HTML was built from. */
  kind: "html" | "plain-text";
  /**
   * Set for a plain-text paste with no line break: the text itself, to be
   * inserted AS TEXT at the caret, the way every editor inserts one — edge
   * spaces kept, the surrounding marks inherited. A paste with no line break
   * carries no block structure to convert, and converting it anyway cost it
   * its edge spaces: "brand-new " pasted mid-sentence arrived as
   * "brand-newrebuilt". Null for everything else, which goes in as `html`.
   */
  inline: string | null;
  /** Set when this paste could not have carried the source's headings. */
  structureUnseen: StructureUnseenReason | null;
}

/**
 * Turn one paste's clipboard flavours into editor HTML.
 *
 * The rich flavour wins whenever it carries any text. That is the whole fix
 * for the first half of the incident: the old box compared the textarea's
 * value with the clipboard's text/plain and used the HTML only while they
 * were EQUAL — and a textarea normalises \r\n and a lone \r to \n while
 * DataTransfer.getData returns them raw, so every paste from a source that
 * writes CR line endings (Chrome on Windows for any web page, Word and
 * Outlook on Windows) failed the comparison with no edit at all. Measured in
 * Chrome 153 against the real component. There is no comparison here to
 * fail: the text flavour is used only when there is no rich one.
 *
 * Plain text is still converted conservatively — plainTextToHtml's doctrine
 * stands. Its line endings are normalised first, so a Windows paste and a Mac
 * paste of the same words produce the same HTML.
 *
 * `structureUnseen` is set whenever the source's headings could not have
 * come through: a plain-text paste that spans more than one line, and HTML
 * written by Cocoa's RTF converter. Whether the paste HAPPENED to produce a
 * heading does not enter into it — a "# Title" line or a "## Notes" line
 * marked in the text says nothing about the headings the source had and the
 * clipboard dropped — and headingsUnseen decides, when the draft is scored,
 * whether that matters to the number. A paste with no line break records
 * nothing: it cannot have carried a heading as a line of its own.
 */
export function classifyPaste(flavours: { html?: string | null; text?: string | null }): PasteResult {
  const rawHtml = String(flavours.html || "");
  const text = String(flavours.text || "").replace(/\r\n?/g, "\n");

  if (rawHtml.trim()) {
    const html = toEditorHtml(rawHtml, true);
    // Some sources put an html flavour on the clipboard that holds no words —
    // an image alone, a bare <meta charset>. Falling through to the text is
    // right then: the rich flavour had nothing to keep.
    if (html.replace(/<[^>]+>/g, "").replace(/&nbsp;/g, " ").trim() || /<img\b/i.test(html)) {
      const fromRtf = /<meta\b[^>]*content\s*=\s*["']?Cocoa HTML Writer/i.test(rawHtml);
      return { html, kind: "html", inline: null, structureUnseen: fromRtf ? "rtf-paste" : null };
    }
  }

  // Blank lines at either end are not lines of the paste — copying a line
  // from a text editor usually brings its newline with it — while spaces are
  // part of the words and stay.
  const bare = text.replace(/^\s*\n/, "").replace(/\n\s*$/, "");
  const multiLine = bare.indexOf("\n") >= 0;
  return {
    html: toEditorHtml(text, false),
    kind: "plain-text",
    inline: !multiLine && bare ? bare : null,
    structureUnseen: multiLine ? "plain-text-paste" : null,
  };
}

// ── Offering the question headings a plain-text import lost ──────────────

/**
 * A line that reads like a question heading, offered to the writer.
 *
 * WHY ONLY QUESTIONS, and why only OFFERED. Measured on 2026-09-23 over every
 * real paste in optimizer_sessions, adjudicated line by line: a line that is
 * one sentence ending in "?" was a heading 23 times in 23 (Wilson 86-100%),
 * finding 74% of the real headings. The obvious companion rule — a short line
 * with no full stop — was right 75% of the time on real pastes and 31% on
 * pages copied from the web, where it offers captions, attribution lines,
 * "Share" and "Learn more". A rule wrong one time in four does not get to
 * touch a scored document, even as a suggestion, so it is not built.
 *
 * The question rule is not applied either. plainTextToHtml's doctrine stands
 * for anything automatic: an invented heading is a score the writer cannot
 * explain. Its misses are known (a FAQ block's questions, which a source did
 * not mark as headings, are the whole of its false positives on copied pages),
 * which is exactly why each line is offered on its own, never pre-selected,
 * and applied only by the writer's click.
 */
export interface HeadingOffer {
  /** The line's text, as the rubric will read it. Also its identity: the
   *  document moves between computing an offer and accepting it, so the
   *  line is found again by its words, not by an index that has gone stale. */
  text: string;
}

interface TopBlock { tag: string; start: number; end: number; inner: string }

/** Top-level blocks of editor HTML. Tiptap's output is well-formed, so a depth
 *  count over tags is exact; void elements never open a level. */
function topLevelBlocks(html: string): TopBlock[] {
  const VOID: { [k: string]: true } = { br: true, hr: true, img: true, col: true, wbr: true };
  const out: TopBlock[] = [];
  const re = /<(\/?)([a-zA-Z][a-zA-Z0-9]*)\b[^>]*?(\/?)>/g;
  let depth = 0;
  let open: { tag: string; start: number; innerStart: number } | null = null;
  let m: RegExpExecArray | null;
  while ((m = re.exec(html)) !== null) {
    const closing = m[1] === "/";
    const tag = m[2].toLowerCase();
    if (VOID[tag] || m[3] === "/") {
      if (depth === 0) out.push({ tag, start: m.index, end: m.index + m[0].length, inner: "" });
      continue;
    }
    if (!closing) {
      if (depth === 0) open = { tag, start: m.index, innerStart: m.index + m[0].length };
      depth++;
    } else {
      depth--;
      if (depth === 0 && open) {
        out.push({ tag: open.tag, start: open.start, end: m.index + m[0].length, inner: html.slice(open.innerStart, m.index) });
        open = null;
      }
    }
  }
  return out;
}

function decodeText(s: string): string {
  return s.replace(/<[^>]+>/g, "")
    .replace(/&nbsp;/g, " ").replace(/&lt;/g, "<").replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&amp;/g, "&")
    .replace(/\s+/g, " ").trim();
}

/** The question shape, as measured: ends in "?" (closing quotes allowed),
 *  3-25 words, one sentence, and does not open like a quotation, an
 *  attribution or a list item. */
function isQuestionLine(t: string): boolean {
  if (!/\?["”’)\]]*$/.test(t)) return false;
  const words = (t.match(/\S+/g) || []).length;
  if (words < 3 || words > 25) return false;
  if (/^[“"‘'«—–\-•·*]/.test(t)) return false;
  const guarded = t.replace(/\b(Mr|Mrs|Ms|Dr|St|Inc|Ltd|U\.S|e\.g|i\.e|vs)\./g, "$1");
  if (/[.!?]["”’)]?\s+[A-Z“"‘]/.test(guarded)) return false;
  return true;
}

/**
 * Question-shaped lines in top-level paragraphs, in document order. Lines
 * inside lists, quotes and tables are never offered — a heading does not live
 * there — and neither is a line already inside a heading.
 */
export function likelyQuestionHeadings(html: string): HeadingOffer[] {
  const out: HeadingOffer[] = [];
  const seen: { [k: string]: true } = {};
  const blocks = topLevelBlocks(html || "");
  for (let b = 0; b < blocks.length; b++) {
    if (blocks[b].tag !== "p") continue;
    const segs = blocks[b].inner.split(/<br\s*\/?>/i);
    for (let i = 0; i < segs.length; i++) {
      const t = decodeText(segs[i]);
      if (!t || seen[t] || !isQuestionLine(t)) continue;
      seen[t] = true;
      out.push({ text: t });
    }
  }
  return out;
}

/**
 * Make one offered line a heading, splitting its paragraph at the line breaks
 * around it. The fused shape from the incident —
 * `<p>Landmarks that carry…<br>What building materials…?</p>` — becomes
 * `<p>Landmarks that carry…</p><h2>What building materials…?</h2>`, and the
 * storytelling line above it is left for the writer to mark: it is a statement,
 * and statements are not offered.
 *
 * Returns null when the line is no longer there, so the caller can say so
 * rather than silently doing nothing.
 */
export function promoteLineToHeading(html: string, offer: HeadingOffer, level?: 1 | 2 | 3): string | null {
  const lv = level || 2;
  const blocks = topLevelBlocks(html || "");
  for (let b = 0; b < blocks.length; b++) {
    const blk = blocks[b];
    if (blk.tag !== "p") continue;
    const segs = blk.inner.split(/<br\s*\/?>/i);
    for (let i = 0; i < segs.length; i++) {
      if (decodeText(segs[i]) !== offer.text) continue;
      const before = segs.slice(0, i).join("<br>");
      const after = segs.slice(i + 1).join("<br>");
      const parts: string[] = [];
      if (decodeText(before)) parts.push(`<p>${before}</p>`);
      parts.push(`<h${lv}>${segs[i].trim()}</h${lv}>`);
      if (decodeText(after)) parts.push(`<p>${after}</p>`);
      return html.slice(0, blk.start) + parts.join("") + html.slice(blk.end);
    }
  }
  return null;
}
