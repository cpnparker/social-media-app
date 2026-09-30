/**
 * A SCORECARD'S MARKS: the cells a comparison draws as a mark, the words the
 * recount reads as one, and the key that says what each mark means.
 *
 * A LEAF, like brand.ts — no imports — because two modules that cannot import
 * each other both need it. The builder (generate.ts) draws the marks and the
 * key, and recounts the totals; edit.ts retires a key the MODEL wrote once the
 * slide draws its own, and edit.ts is the seam that must not reach the builder
 * (see its header). One vocabulary in one file, so what is drawn, what is
 * counted and what is retired cannot drift apart.
 *
 * THE AMRIZE SCORECARD, 2026-09-23 (thread 3ec51a09). The comparison drew Y as
 * a tick and N as a cross, drew P as the bare letter, and drew no key, so the
 * model wrote one in `note` — twice, wrongly both times. "Y = present, P =
 * partial, N = absent" described letters the slide never shows; asked for
 * "✓ met · P partly met (half a point) · ✗ not met", it wrote "Check met - P
 * partly met (half a point) - X not met". A key is part of the drawing, and a
 * drawing the model has to finish in prose is one it will finish wrong.
 */

/** THE CELLS A COMPARISON DRAWS AS A TICK OR A CROSS, and therefore the cells
 *  a scorecard's recount reads as a yes or a no.
 *
 *  ONE LIST FOR BOTH, because the recount exists to check a total against the
 *  marks THE ROOM SEES. A word the builder draws as a tick and the recount
 *  does not know takes its whole column out of the check; a word the recount
 *  counts and the builder prints as text is a mark nobody at the table can
 *  see. Compared lower-cased and trimmed, as the builder always has. */
export const TICK_CELLS = ["yes", "y", "true", "\u2713"];
export const CROSS_CELLS = ["no", "n", "false", "\u2717", "x"];
/** Half a mark, drawn as ½ (see MARK_GLYPH for why a glyph and why that one).
 *  Every scorecard this was measured on reads it as a half: the Amrize
 *  editorial doc's "5.5 / 12" is only reachable in halves. */
export const PARTIAL_CELLS = ["p", "partial", "partly", "half", "\u00bd"];
/** A check that does not apply. Out of the denominator, not a zero: the
 *  Obama column's "6.5 / 11" is twelve checks with schema unjudgeable. */
export const NOT_APPLICABLE_CELLS = ["n/a", "na", "n.a.", "not applicable"];

/** What a whole cell MEANS as a mark. */
export type Mark = "met" | "partial" | "not" | "na";

/** THE MARK A WHOLE CELL IS DRAWN AS, or null for a cell drawn as its own words.
 *
 *  The WHOLE cell, not its first word: "P - intro does some of the job" is a
 *  mark AND a reason, and it is drawn as the words it is, letter included.
 *  Only the recount reads a qualified cell by its first word (scoreMark). */
export function cellMark(cell: unknown): Mark | null {
  const v = String(cell ?? "").trim().toLowerCase();
  if (!v) return null;
  if (TICK_CELLS.indexOf(v) >= 0) return "met";
  if (PARTIAL_CELLS.indexOf(v) >= 0) return "partial";
  if (CROSS_CELLS.indexOf(v) >= 0) return "not";
  if (NOT_APPLICABLE_CELLS.indexOf(v) >= 0) return "na";
  return null;
}

/** WHAT EACH MARK IS DRAWN AS.
 *
 *  PARTIAL IS ½, A GLYPH, AND NOT A DRAWN SHAPE — decided by what Slides AND the
 *  preview both render the same way. Measured in Chrome against Google's own
 *  Roboto webfont, the face every cell is set in (canvas widths under three
 *  different fallback fonts: a glyph Roboto carries measures the same under
 *  all three), 2026-09-23:
 *    ½ U+00BD  in Roboto (75.9 / 75.9 / 75.9 at 100px bold)
 *    ◐ U+25D0  NOT in Roboto (60.2 / 100 / 100) — the obvious half-circle
 *    ✓ ✗       NOT in Roboto either: both already come from whatever fallback
 *              font the viewer's machine has
 *  ½ is Latin-1, so Slides, its exported thumbnails and PDFs, the chat preview
 *  and the PDF preview all draw it from the deck's own font; ◐ would come from a
 *  different fallback on every machine, at a different size and weight, and a
 *  server-side export may not have one at all. A DRAWN half-circle has no shape
 *  the Slides API can make — a PIE's adjustment values are not settable — and
 *  building one out of an ellipse and a clipped rectangle is a request kind the
 *  preview does not read back, which is the preview-parity rule
 *  (verify-slide-layouts) broken for one glyph. And ½ SAYS what it scores.
 *
 *  n/a is drawn as the letters, normalised: "NA", "N/A" and "not applicable"
 *  all draw "n/a", so the key names exactly what the cells show. */
export const MARK_GLYPH: { [m: string]: string } = { met: "\u2713", partial: "\u00bd", not: "\u2717", na: "n/a" };
/** What the KEY says each mark means ON A SCORECARD — a slide that says it
 *  is scoring (isScorecardSlide). "met"/"not met" are scorecard words: on a
 *  feature comparison a tick means yes, not "met", and a key calling it met
 *  would be the key that is wrong. PLAIN_MEANING is what every other grid of
 *  marks is keyed with. */
export const MARK_MEANING: { [m: string]: string } = { met: "met", partial: "partly met", not: "not met", na: "not scored" };
export const PLAIN_MEANING: { [m: string]: string } = { met: "yes", partial: "partly", not: "no", na: "not applicable" };
/** The key's order, and the order every mark is listed in. */
export const MARK_ORDER: Mark[] = ["met", "partial", "not", "na"];

/** A comparison's own caps: four options across, eight criteria down. Past
 *  either, the rest are not drawn and the builder says which. Here rather than
 *  in the builder because the key is computed over exactly the cells that are
 *  DRAWN, and edit.ts has to ask the same question. */
export const COMPARISON_MAX_COLS = 4;
export const COMPARISON_MAX_ROWS = 8;

/** A total row's label: one that STARTS with score, total, overall or sum as
 *  a word — "SCORE", "Total score (Y = 1, P = half)", "Total checks met",
 *  "Overall". Loose on purpose, because the label is not what stops a false
 *  report; the gates in the builder's scorecardMismatches are. A row that
 *  merely starts with "Total" — the stored Amrize success-metrics table has
 *  "Total AI citations" fifth of eight, over figures — fails the mark gate,
 *  because the cells above it are figures, and a "Total seats: 50" under a
 *  feature comparison's ticks fails the denominator gate. What the label must
 *  NOT do is match inside a word: "Scorecard" and "Summary" are headings, not
 *  totals. Here, beside the marks, because a total row is also what a grid of
 *  marks leaves out when it asks whether every cell is a mark. */
const SCORE_ROW_LABEL = /^(?:score|total|overall|sum)\b/;
export function isScoreLabel(label: unknown): boolean {
  const t = String(label ?? "").toLowerCase().replace(/[{}*_`]/g, "").replace(/\s+/g, " ").trim();
  return SCORE_ROW_LABEL.test(t);
}

/** A title or standfirst that SAYS its slide is scoring something: "The
 *  12-point checklist, scored: checks 1-6" (3ec51a09). Words, because nothing
 *  else in a comparison's cells tells a scorecard from a feature grid — both
 *  are ticks and crosses. Whole words only: "Scoreboard" is not one. */
const SCORECARD_WORDS = /\b(?:scores?|scored|scoring|scorecard|checklist|checks|rubric|audit|audited|assessed|assessment|graded|grading)\b/;
export function saysScorecard(text: unknown): boolean {
  return SCORECARD_WORDS.test(String(text ?? "").toLowerCase().replace(/[{}*_`]/g, ""));
}

/** How a comparison draws its marks, and whether it draws a key for them. */
export type MarkPlan = {
  /** A partial draws as ½ and n/a in any spelling as "n/a": the slide is a
   *  scorecard, or every drawn cell is a mark (or blank). False on a feature
   *  grid of words and marks, which draws "Partial" and "n/a" as the words
   *  they are, as it always has. */
  marks: boolean;
  /** The slide says it is scoring (isScorecardSlide): its key speaks of
   *  "met", and n/a is a mark that needs one ("not scored"). */
  scorecard: boolean;
  /** The kinds the key lists, in MARK_ORDER; empty draws no key. */
  key: Mark[];
  /** What the key calls each mark. */
  meaning: { [m: string]: string };
};

/** Does the slide say it is scoring — in its title or standfirst, or with a
 *  total row in its grid? */
export function isScorecardSlide(slide: { title?: unknown; subtitle?: unknown; comparison?: { rows?: { label?: unknown }[] } | null } | null | undefined): boolean {
  if (!slide) return false;
  if (saysScorecard(slide.title) || saysScorecard(slide.subtitle)) return true;
  const rows = slide.comparison && Array.isArray(slide.comparison.rows) ? slide.comparison.rows : [];
  for (let r = 0; r < rows.length; r++) if (rows[r] && isScoreLabel(rows[r].label)) return true;
  return false;
}

/**
 * HOW A COMPARISON DRAWS ITS MARKS, AND THE KEY IT DRAWS FOR THEM.
 *
 * ONLY A SCORECARD, OR A GRID OF MARKS, DRAWS ½ OR A KEY. A slide that says
 * it is scoring (isScorecardSlide) is one whatever its cells say — the
 * Amrize scorecard's slide 18 carried "Can't assess from doc" in one cell
 * for most of a day, and one reason written in a cell must not turn every
 * other half back into a letter. Any other grid has to be marks throughout
 * (blanks aside, and a total row's "5.5 / 12" aside); one cell of words —
 * "£40/mo", "Email + chat" — and it is a feature table that happens to say
 * "Partial" somewhere, which is drawn as the word, with "n/a" as written and
 * no key, exactly as it was before any of this existed. A ½ among prices is
 * a symbol nobody asked for, and a key above them explains a system the
 * slide does not use.
 *
 * THE KEY. Drawn when the grid uses a mark a reader cannot read unaided — ½
 * always; n/a only on a scorecard, where it means "not scored", out of the
 * denominator, and on a feature grid it reads unaided — and then it lists
 * EVERY mark the grid draws, ticks and crosses too, because a key naming two
 * of four marks is a key that has to be finished in prose. A grid of ticks
 * and crosses alone draws none, which leaves every stored feature comparison
 * as it was drawn.
 *
 * THE WORDS. "met / partly met / not met / not scored" only on a slide that
 * says it is scoring (isScorecardSlide); "yes / partly / no / not
 * applicable" on any other. A tick on a vendor comparison means yes, and a
 * key calling it "met" would be the key that is wrong — the failure a
 * verifier found in the first cut of this, on a feature grid with one
 * "Partial" in it.
 *
 * Over the DRAWN cells only — the first COMPARISON_MAX_ROWS rows and
 * COMPARISON_MAX_COLS columns — because a key naming a mark in a row that is
 * not on the slide names something nobody can see.
 */
export function comparisonMarkPlan(
  slide: { title?: unknown; subtitle?: unknown; comparison?: { columns?: unknown[]; rows?: { label?: unknown; cells?: unknown[] }[] } | null } | null | undefined
): MarkPlan {
  const scorecard = isScorecardSlide(slide);
  const meaning = scorecard ? MARK_MEANING : PLAIN_MEANING;
  const none: MarkPlan = { marks: false, scorecard, key: [], meaning };
  const cmp = slide && slide.comparison;
  if (!cmp || !Array.isArray(cmp.rows)) return none;
  const cols = Math.min(COMPARISON_MAX_COLS, Array.isArray(cmp.columns) ? cmp.columns.length : 0);
  const used: { [m: string]: boolean } = {};
  const rows = cmp.rows.slice(0, COMPARISON_MAX_ROWS);
  let words = false;
  for (let r = 0; r < rows.length; r++) {
    if (!rows[r] || isScoreLabel(rows[r].label)) continue;
    const cells = Array.isArray(rows[r].cells) ? (rows[r].cells as unknown[]) : [];
    for (let c = 0; c < Math.min(cols, cells.length); c++) {
      if (!String(cells[c] ?? "").trim()) continue;
      const m = cellMark(cells[c]);
      if (m) used[m] = true;
      else words = true;
    }
  }
  if (words && !scorecard) return none;
  const keyed = used.partial || (used.na && scorecard);
  return { marks: true, scorecard, key: keyed ? MARK_ORDER.filter((m) => used[m]) : [], meaning };
}

/** A scorecard cell read as a mark: 1, a half, 0, "na" — or null for
 *  anything else (a figure, a word, a blank), which takes its whole column out
 *  of the recount rather than guessing what it was worth.
 *
 *  THE MARK IS THE CELL'S FIRST WORD. A source scorecard writes its reason
 *  beside the mark — "P - no brand", "Y — strong", "N (labels, not
 *  questions)" — and the model copies the cell whole, which is how the Amrize
 *  doc's own table reads. A spaced hyphen or colon, either dash, an opening
 *  bracket, a comma or a semicolon ends the mark; an UNSPACED hyphen or slash
 *  does not, so "n/a" stays one word, and so does "no brand" — which is not a
 *  mark at all and must not be read as a "no". */
export function scoreMark(cell: unknown): 1 | 0.5 | 0 | "na" | null {
  const raw = String(cell ?? "").trim().toLowerCase();
  if (!raw) return null;
  const head = raw.split(/\s+[-:]\s+|\s*[\u2013\u2014(,;]\s*/)[0].trim();
  if (TICK_CELLS.indexOf(head) >= 0) return 1;
  if (PARTIAL_CELLS.indexOf(head) >= 0) return 0.5;
  if (CROSS_CELLS.indexOf(head) >= 0) return 0;
  if (NOT_APPLICABLE_CELLS.indexOf(head) >= 0) return "na";
  return null;
}

/* ─────────────── A key the model wrote ─────────────── */

/** A mark as a key writes it: the cell words, the glyphs, and the names a model
 *  gives the glyphs when it cannot type them ("Check met", "X not met"). */
const KEY_TOKENS = TICK_CELLS.concat(PARTIAL_CELLS, CROSS_CELLS, NOT_APPLICABLE_CELLS,
  ["\u2714", "\u2718", "\u00d7", "check", "tick", "cross"]);
/** What a key says a mark means. A definition has to OPEN with one of these —
 *  "n/a for all four" is not a definition, it is a sentence about schema. */
const KEY_MEANING = /^(?:not |partly |partially |fully )?(?:met|present|absent|missing|partial|partly|half|full|yes|no|pass|passed|fail|failed|applicable|scored|assessed|assessable|done|achieved|in place|n\/a)\b/;

/** One clause of a key: a mark, an optional "=" or ":", and a meaning of at most
 *  five words, optionally followed by one bracketed aside ("(half a point)"). */
function isKeyDefinition(clause: string): boolean {
  let t = clause.trim().toLowerCase().replace(/^key\s*:?\s*/, "");
  // The bracketed aside first, so it does not count against the five words.
  t = t.replace(/\s*\([^)]*\)\s*$/, "").trim();
  if (!t) return false;
  let token = "";
  for (let i = 0; i < KEY_TOKENS.length; i++) {
    const k = KEY_TOKENS[i];
    if (t.indexOf(k) === 0 && k.length > token.length) {
      const next = t.charAt(k.length);
      // The token has to END there: "no" is not the start of "none", "n" not
      // the start of "not".
      if (!next || /[\s=:]/.test(next)) token = k;
    }
  }
  if (!token) return false;
  const meaning = t.slice(token.length).replace(/^\s*(?:=|:|means|is)?\s*/, "").trim();
  if (!meaning || meaning.split(/\s+/).length > 5) return false;
  return KEY_MEANING.test(meaning);
}

/**
 * TEXT WITH ITS MARK KEY TAKEN OUT: every sentence that is nothing but mark
 * definitions — two or more of them — removed, and every other sentence kept
 * exactly as written. Returns the text unchanged when there is nothing to take.
 *
 * SENTENCE BY SENTENCE, because a model writes its key beside a real line:
 * "Y = present, P = partial, N = absent. Scored from each article's final
 * text." (3ec51a09, the first key) loses the first sentence and keeps the
 * second. A sentence that MIXES a definition with anything else is kept whole
 * — "n/a for all four, assessed separately from the live page" says why a mark
 * was given, which no key can say — because a key left beside the drawn one is
 * a duplicate, and a reason cut out of a sentence is a loss.
 *
 * Clauses are split on the separators keys are written with: commas,
 * semicolons, middle dots, bars and spaced dashes.
 */
export function withoutMarkKey(text: string): string {
  const src = String(text ?? "");
  if (!src.trim()) return src;
  // Sentences end at . ! ? followed by space or the end. Split by hand: a
  // lookbehind is not something every target this is type-checked for reads.
  const sentences: string[] = [];
  let start = 0;
  for (let i = 0; i < src.length; i++) {
    const ch = src.charAt(i);
    if ((ch === "." || ch === "!" || ch === "?" || ch === "\n") && (i + 1 === src.length || /\s/.test(src.charAt(i + 1)))) {
      sentences.push(src.slice(start, i + 1));
      start = i + 1;
    }
  }
  if (start < src.length) sentences.push(src.slice(start));
  let changed = false;
  const kept: string[] = [];
  for (let s = 0; s < sentences.length; s++) {
    const body = sentences[s].trim().replace(/[.!?]+$/, "").trim();
    const clauses = body.split(/\s*[,;\u00b7|]\s*|\s+[-\u2013\u2014]\s+/).filter((c) => c.trim() !== "");
    let defs = 0;
    for (let c = 0; c < clauses.length; c++) if (isKeyDefinition(clauses[c])) defs += 1;
    if (clauses.length >= 2 && defs === clauses.length) { changed = true; continue; }
    kept.push(sentences[s]);
  }
  if (!changed) return src;
  return kept.join("").replace(/^\s+/, "").replace(/\s+$/, "");
}
