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
 *
 * ── AND WHY THE UNZIP MOVED HERE TOO (2026-09-24) ───────────────────────────
 *
 * The unzip stayed behind in the route, so a deck could be read in exactly one
 * way: attached. Chris pasted the link to "Seven things to know about working
 * with The Content Engine" an hour before an onboarding call. It was a .pptx
 * UPLOADED to Drive, which Google Slides opens natively, so to him it was a
 * Slides deck — and the Drive reader, which only knew Google's own Slides
 * export, refused it as an unsupported file type twice and the model told him
 * to paste the slides in by hand. `pptxBufferToText` is the route's helper,
 * lifted, and the route and the Drive reader both call it: one reader of a
 * deck, so a deck cannot read one way attached and another way linked.
 *
 * ── AND WHY IT IS BOUNDED (2026-09-24, the same day) ────────────────────────
 *
 * An attachment is a file the user chose. A deck in Drive is a file anyone
 * who can share with the service account chose, and review showed what one
 * crafted to hurt could do here: a tag that never closes sent the lazy
 * regexes quadratic (94 seconds of blocked event loop from 2.5 KB), and a
 * 1.4 MB zip inflated a 400 MB slide. The patterns are now linear, the zip is
 * read against a budget as it inflates, and the forty real decks read exactly
 * as they did — by SHA-256, attached and linked alike. See PPTX_XML_MAX_CHARS
 * and RUN below; verify-drive-pptx.ts section 8 drives each shape.
 */

/** Rows and cells beyond these are noise in a chat prompt, and a slide that
 *  needs more than this is a spreadsheet wearing a deck's clothes. */
export const PPTX_TABLE_MAX_ROWS = 60;
export const PPTX_TABLE_MAX_COLS = 12;

/**
 * The most slide XML one deck may decompress to, and the most slides it may
 * have, before it is refused rather than read.
 *
 * Measured, not guessed: across the forty real decks in ~/Downloads the
 * largest holds 823,649 characters of slide XML over 26 slides, the most
 * slides is 39, and the IFFIm proposal — 71 MB of file — is under a million
 * characters, because a deck's weight is its pictures. These sit some thirty
 * and fifty times above that, so no real deck is near them.
 *
 * WHY THEY EXIST (2026-09-24). Once the Drive reader could open a deck, a
 * deck was something anyone who can share a file with EngineAI could hand
 * this code. A 1.4 MB .pptx holding a 400 MB slide took the process to 2 GB
 * and still returned a 24,000-character answer; nothing asked how much XML it
 * was inflating before the text cap applied. The count is checked before
 * anything is read and the characters as they arrive, so a zip that lies
 * about its sizes in its own directory is stopped by what it actually
 * inflates to.
 */
export const PPTX_XML_MAX_CHARS = 24_000_000;
export const PPTX_MAX_SLIDES = 2_000;

/**
 * A text run.
 *
 * NEITHER PART CAN SCAN PAST THE NEXT TAG, and that is the point of it. This
 * was `<a:t(?:\s[^>]*)?>([\s\S]*?)<\/a:t>`: a lazy match that, at every `<a:t>`
 * with no `</a:t>` after it, read to the end of the slide before giving up.
 * A 2.5 KB deck whose slide was "<a:t>" 320,000 times held the event loop for
 * 94 seconds, quadrupling with every doubling — on a code path that, since the
 * Drive reader, a stranger's shared file can reach. XML allows no raw "<"
 * inside text or inside an attribute value, so stopping at "<" loses nothing
 * a real deck contains: the forty real decks read identically by SHA-256.
 */
const RUN = /<a:t(?:\s[^<>]*)?>([^<]*)<\/a:t>/g;

/**
 * Every `<tag>…</tag>` block in `xml`, in order — found with indexOf rather
 * than a lazy regex, for the reason RUN gives: `<a:tbl>[\s\S]*?<\/a:tbl>`
 * rescanned the rest of the slide from every unclosed `<a:tbl>`, and a
 * 1.8 KB deck of them held the loop for 34 seconds.
 *
 * `exact` means the open tag carries no attributes (`<a:tbl>` is only ever
 * written bare); otherwise it is a word boundary, so `<a:tc` opens a cell and
 * `<a:tcPr` does not. Scanning STOPS at the first open with no close after
 * it, which is what the lazy regex did too — slowly: any later open has even
 * less of the slide after it, so it cannot have a close either.
 */
function blocksOf(xml: string, tag: string, exact: boolean): { start: number; end: number }[] {
  const open = `<${tag}`;
  const close = `</${tag}>`;
  const out: { start: number; end: number }[] = [];
  let from = 0;
  for (;;) {
    const start = xml.indexOf(open, from);
    if (start < 0) break;
    const next = xml.charAt(start + open.length);
    const opens = exact ? next === ">" : !/[A-Za-z0-9_]/.test(next);
    if (!opens) { from = start + 1; continue; }
    const at = xml.indexOf(close, start + open.length + (exact ? 1 : 0));
    if (at < 0) break;
    out.push({ start, end: at + close.length });
    from = at + close.length;
  }
  return out;
}

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
  const rows = blocksOf(tblXml, "a:tr", false).map((b) => tblXml.slice(b.start, b.end));
  const lines: string[] = [];
  for (const row of rows.slice(0, PPTX_TABLE_MAX_ROWS)) {
    const cells = blocksOf(row, "a:tc", false).map((b) => row.slice(b.start, b.end));
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
  const tables = blocksOf(xml, "a:tbl", true);
  for (let i = 0; i < tables.length; i++) {
    const before = runsOf(xml.slice(cursor, tables[i].start));
    if (before) parts.push(before);
    const lines = tableToLines(xml.slice(tables[i].start, tables[i].end));
    if (lines.length) parts.push(`[table]\n${lines.join("\n")}`);
    cursor = tables[i].end;
  }
  const tail = runsOf(xml.slice(cursor));
  if (tail) parts.push(tail);
  return parts.join("\n").trim();
}

/**
 * A whole deck as text.
 *
 * `files` is a map of the zip's slide entries to their XML, already read. The
 * zip is opened by pptxBufferToText below, not here, so this stays a function
 * of strings the check can drive with strings as well as with a real file.
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

/**
 * A .pptx file's bytes, as the text above — for EVERY path that reads a deck.
 *
 * The chat's attachment extractor and the Drive reader both call this, and
 * neither keeps an unzip of its own. That is the whole point of it being here:
 * two copies of "which zip entries are slides" is how an attached deck and the
 * same deck linked from Drive would come to read differently, with nothing
 * going red. verify-drive-pptx.ts drives the Drive reader over real decks and
 * asserts its text is this function's to the byte.
 *
 * SLIDES ONLY, not speaker notes. The attachment path never read
 * ppt/notesSlides/, and what a deck says should not depend on which road it
 * came in by; if notes are ever wanted, they are added here, once, for both.
 *
 * jszip is imported when a deck is actually read, so the string functions
 * above stay importable without a zip library, as they always were.
 *
 * Undefined when the zip holds no slide with text in it. THROWS on bytes that
 * are not a zip at all — a password-protected .pptx is an encrypted container
 * rather than a zip — and, marked so isDeckTooLarge can tell, on a deck past
 * PPTX_MAX_SLIDES or PPTX_XML_MAX_CHARS, so the caller can say which it was.
 */
export async function pptxBufferToText(buffer: Buffer): Promise<string | undefined> {
  const JSZipModule: any = await import("jszip");
  const JSZip = JSZipModule.default ?? JSZipModule;
  const zip = await JSZip.loadAsync(buffer);

  const slideFiles = Object.keys(zip.files).filter((name) => /^ppt\/slides\/slide\d+\.xml$/.test(name));
  if (slideFiles.length === 0) return undefined;
  if (slideFiles.length > PPTX_MAX_SLIDES) {
    throw deckTooLarge(`the deck has ${slideFiles.length.toLocaleString()} slides, and EngineAI reads at most ${PPTX_MAX_SLIDES.toLocaleString()}`);
  }

  const slides: { name: string; xml: string }[] = [];
  let left = PPTX_XML_MAX_CHARS;
  for (const name of slideFiles) {
    const xml = await readWithin(zip.files[name], left);
    left -= xml.length;
    slides.push({ name, xml });
  }
  // deckToText keeps <a:tbl> blocks as rows. Joining every run with a space —
  // which is what the route's first version did — turned a competitor table
  // into "concrete calculator 238,000 asphalt calculator 11,000", and the model
  // had to guess which number belonged to which row.
  return (deckToText(slides) || "").trim() || undefined;
}

/**
 * One zip entry as a string — stopped, not finished, once it passes `budget`.
 *
 * This is `entry.async("string")` taken apart: `async` is `internalStream`
 * plus an accumulator that joins every chunk at the end, so the text is the
 * same to the byte, and the only difference is that this one counts as it
 * goes and pauses the inflater the moment the count is over. Asking the zip
 * how big an entry is would be asking the attacker: the size in its central
 * directory is whatever the file says, and jszip only compares it with the
 * truth after inflating the lot.
 */
function readWithin(entry: any, budget: number): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: string[] = [];
    let chars = 0;
    let settled = false;
    const stream = entry.internalStream("string");
    stream
      .on("data", (chunk: string) => {
        if (settled) return;
        chars += chunk.length;
        if (chars > budget) {
          settled = true;
          stream.pause();
          reject(deckTooLarge(`its slides inflate to more than ${PPTX_XML_MAX_CHARS.toLocaleString()} characters of XML`));
          return;
        }
        chunks.push(chunk);
      })
      .on("error", (err: any) => {
        if (settled) return;
        settled = true;
        reject(err);
      })
      .on("end", () => {
        if (settled) return;
        settled = true;
        resolve(chunks.join(""));
      })
      .resume();
  });
}

/** Marked with a property rather than an Error subclass, as docs.ts marks its
 *  refusals: `instanceof` on a subclass of Error depends on the compile
 *  target, and tsconfig sets none. */
function deckTooLarge(why: string): Error {
  const err: any = new Error(`Deck too large to read: ${why}.`);
  err.deckTooLarge = true;
  return err;
}

/** True for the error pptxBufferToText throws when a deck is past its caps —
 *  as opposed to one that would not open at all. */
export function isDeckTooLarge(err: any): boolean {
  return !!(err && err.deckTooLarge);
}
