/**
 * A .pptx, as text a model can read — including its tables.
 *
 * ── WHAT WAS WRONG ──────────────────────────────────────────────────────────
 *
 * The extractor pulled every `<a:t>` run in a slide and joined them with
 * SPACES. For prose that is fine. For a table it destroys the only thing that
 * made it a table: a competitor row arrived as
 *
 *     concrete calculator 238,000 asphalt calculator 11,000 aggregate calculator 700
 *
 * and the model had to guess which number belonged to which keyword. Eleven of
 * the thirty-five slides in the deck this was found on are tables, and they are
 * the slides carrying the figures — which is exactly where a guess is most
 * expensive, because a wrong one is repeated to a client as a measurement.
 *
 * ── HOW IT READS THEM NOW ───────────────────────────────────────────────────
 *
 * The slide is walked in document order, alternating between ordinary shapes
 * and `<a:tbl>` blocks. A table becomes one row per line with ` | ` between
 * cells, which is the same shape `workbookToText` emits for a spreadsheet: two
 * paths into the same model, one convention, and a reader that has learned to
 * read one can read the other.
 *
 * Document order matters and is why this is a walk rather than two passes. A
 * table's heading usually sits immediately above it, and hoisting every table
 * to the end of the slide separates the two.
 *
 * ── AND WHY IT IS ITS OWN MODULE ────────────────────────────────────────────
 *
 * It used to live inside the messages route, where nothing could reach it. The
 * check now builds a real .pptx in memory — real zip, real slide XML, real
 * `<a:tbl>` markup — and runs this over it. A mock of a deck would only prove
 * the mock works.
 */

/** Rows and cells beyond these are noise in a chat prompt, and a slide that
 *  needs more than this is a spreadsheet wearing a deck's clothes. */
export const PPTX_TABLE_MAX_ROWS = 60;
export const PPTX_TABLE_MAX_COLS = 12;

const RUN = /<a:t(?:\s[^>]*)?>([\s\S]*?)<\/a:t>/g;

function unescapeXml(s: string): string {
  return s
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    // LAST, or "&amp;lt;" becomes "<" instead of "&lt;".
    .replace(/&amp;/g, "&");
}

/** Every text run in a fragment, joined with spaces. Ordinary shapes. */
export function runsOf(xml: string): string {
  return Array.from(xml.matchAll(RUN), (m) => unescapeXml(m[1])).join(" ").replace(/\s+/g, " ").trim();
}

/**
 * One `<a:tbl>` as lines.
 *
 * A cell's own runs are joined WITHOUT a separator, not with a space: PowerPoint
 * splits a single word across runs whenever the formatting changes inside it, so
 * "238,000" arrives as three runs when the thousands separator is styled, and
 * joining on a space yields "238 , 000".
 */
export function tableToLines(tblXml: string): string[] {
  const rows = Array.from(tblXml.matchAll(/<a:tr\b[\s\S]*?<\/a:tr>/g), (m) => m[0]);
  const lines: string[] = [];
  for (const row of rows.slice(0, PPTX_TABLE_MAX_ROWS)) {
    const cells = Array.from(row.matchAll(/<a:tc\b[\s\S]*?<\/a:tc>/g), (m) => m[0]);
    const texts = cells.slice(0, PPTX_TABLE_MAX_COLS).map((c) =>
      Array.from(c.matchAll(RUN), (m) => unescapeXml(m[1])).join("").replace(/\s+/g, " ").trim()
    );
    // A row of nothing is a spacer row in the source and carries no meaning.
    if (!texts.some((t) => t !== "")) continue;
    lines.push(texts.join(" | "));
  }
  if (rows.length > PPTX_TABLE_MAX_ROWS) {
    lines.push(`… ${PPTX_TABLE_MAX_ROWS} of this table's ${rows.length} rows are shown.`);
  }
  return lines;
}

/**
 * One slide's XML as text, with its tables kept as tables.
 *
 * Walked rather than regexed in two passes so a table stays where it was: its
 * heading is usually the shape directly above it.
 */
export function slideXmlToText(xml: string): string {
  const parts: string[] = [];
  let cursor = 0;
  const tableAt = /<a:tbl>[\s\S]*?<\/a:tbl>/g;
  let m: RegExpExecArray | null;
  while ((m = tableAt.exec(xml)) !== null) {
    const before = runsOf(xml.slice(cursor, m.index));
    if (before) parts.push(before);
    const lines = tableToLines(m[0]);
    if (lines.length) parts.push(`[table]\n${lines.join("\n")}`);
    cursor = m.index + m[0].length;
  }
  const tail = runsOf(xml.slice(cursor));
  if (tail) parts.push(tail);
  return parts.join("\n").trim();
}

/**
 * A whole deck as text.
 *
 * `files` is a map of the zip's slide entries to their XML, already read. Kept
 * out of this module so it does not depend on a zip library and the check can
 * drive it with strings as well as with a real file.
 */
export function deckToText(slides: { name: string; xml: string }[]): string {
  const ordered = slides
    .slice()
    .sort((a, b) => slideNumber(a.name) - slideNumber(b.name));
  const out: string[] = [];
  for (let i = 0; i < ordered.length; i++) {
    const text = slideXmlToText(ordered[i].xml);
    if (text) out.push(`--- Slide ${i + 1} ---\n${text}`);
  }
  return out.join("\n\n");
}

export function slideNumber(name: string): number {
  const m = name.match(/slide(\d+)\.xml$/);
  return m ? parseInt(m[1], 10) : 0;
}
