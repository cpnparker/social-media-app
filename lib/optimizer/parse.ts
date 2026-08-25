/**
 * Content Optimizer — draft parsing.
 *
 * Turns a draft (Tiptap HTML, or markdown from an import) into the structures
 * the scoring criteria need: blocks, plain text, words, headings, chunks,
 * sentences, statistics, links, lists and tables.
 *
 * PURE, SYNCHRONOUS, ZERO DEPENDENCIES — by requirement, not by preference.
 * This runs client-side on every (debounced) keystroke for the live score AND
 * server-side for the persisted one, and both must produce identical numbers.
 * That rules out jsdom/cheerio, so HTML is handled with a string tokenizer.
 * Where that is lossy is stated at each site rather than hidden.
 *
 * OFFSETS INDEX `ParsedDraft.text` — never the source body, never ProseMirror
 * positions. Editor re-anchoring is anchors.ts's job via quote+prefix+suffix
 * (spec §5: "offsets rot, quotes re-anchor"). Slicing `body` with an offset
 * from here is a bug.
 */

// ── Types ────────────────────────────────────────────────────────────────

export interface Range { start: number; end: number }

/**
 * Which heading levels are this document's SECTION headings.
 *
 * This was hard-coded to levels 2 and 3, which is right for a WEB PAGE — one
 * H1 is the page title, H2/H3 are the sections — and wrong for everything that
 * arrives from a word processor. Word's "Heading 1" is a top-level SECTION,
 * and the piece's title is carried separately in the session, so an uploaded
 * or pasted article has its real sections at H1 and nothing at H2 at all.
 *
 * On the founder's own imported .docx that produced a nonsense verdict: five
 * H1 section headings were discarded, three H3 PULL QUOTES became "the
 * sections", and every heading criterion then described the pull quotes.
 * "0 of 3 headings are question-shaped" was measuring three quotations, while
 * two of the five real headings are interrogative and one more is literally
 * "What is MAXtect?".
 *
 * The rule reads the document instead of assuming one: sections start at the
 * shallowest level actually used, EXCEPT where exactly one heading sits at
 * that level and it is an H1 — the web-page shape, where that lone H1 is the
 * title and sections begin one level down. URL imports therefore keep scoring
 * exactly as before.
 */
export function sectionLevels(headings: { level: number }[]): number[] {
  if (headings.length === 0) return [2, 3];
  let top = 6;
  for (let i = 0; i < headings.length; i++) if (headings[i].level < top) top = headings[i].level;
  let atTop = 0;
  for (let i = 0; i < headings.length; i++) if (headings[i].level === top) atTop++;
  const base = atTop === 1 && top === 1 ? 2 : top;
  return [base, base + 1];
}

export type BlockKind = "heading" | "prose" | "listItem" | "tableRow" | "quote" | "code";

export interface Block extends Range {
  index: number;
  kind: BlockKind;
  text: string;
  /** Headings only. */
  level?: number;
  /** listItem only: true when it came from an ordered list. */
  ordered?: boolean;
}

export interface Heading extends Range {
  level: number;
  text: string;
  textLower: string;
  blockIndex: number;
  isQuestion: boolean;
  isInterrogativeShaped: boolean;
}

export type SentenceKind = "prose" | "heading" | "listItem" | "quote" | "cell";

export interface Sentence extends Range {
  index: number;
  text: string;
  kind: SentenceKind;
  wordCount: number;
  blockIndex: number;
  chunkIndex: number;
}

export interface Chunk extends Range {
  index: number;
  heading: Heading | null;
  text: string;
  bodyText: string;
  firstSentence: Sentence | null;
  firstTwoSentences: Sentence[];
  wordCount: number;
  isEmpty: boolean;
}

export type StatKind = "percent" | "currency" | "multiplier" | "largeNumber" | "countWithUnit" | "ratio";

export interface StatMention extends Range {
  text: string;
  kind: StatKind;
  sentenceIndex: number;
  /** A source signal sits in the SAME sentence — the extraction unit an engine quotes. */
  sourced: boolean;
  /** Inside a direct quotation. An ATTRIBUTED quote's stats are sourced — the
   *  named speaker IS the source — and asking the writer to add a citation
   *  inside someone's spoken words is asking them to misquote. */
  inQuote: boolean;
}

export interface LinkRef {
  href: string;
  text: string;
  host: string;
  external: boolean;
}

export interface QuoteMention extends Range {
  text: string;
  wordCount: number;
  attributed: boolean;
}

export interface ParsedDraft {
  format: "html" | "markdown";
  title: string;
  text: string;
  blocks: Block[];
  words: { text: string; lower: string; start: number; end: number }[];
  wordCount: number;
  /** Tokens containing a letter — the denominator for keyword density, so a table of numbers cannot dilute a stuffing measurement. */
  alphaWordCount: number;
  proseWordCount: number;
  headings: Heading[];
  chunks: Chunk[];
  sentences: Sentence[];
  stats: StatMention[];
  links: LinkRef[];
  quotes: QuoteMention[];
  hasOrderedList: boolean;
  hasUnorderedList: boolean;
  hasTable: boolean;
  listItemCount: number;
}

export interface ParseInput {
  body: string;
  title?: string;
}

// ── HTML / markdown → blocks ─────────────────────────────────────────────

const BLOCK_TAGS = "p|h[1-6]|li|tr|blockquote|pre|div|section|article";

function decodeEntities(s: string): string {
  return s
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&apos;/g, "'")
    .replace(/&mdash;/g, "—")
    .replace(/&ndash;/g, "–")
    .replace(/&hellip;/g, "…")
    .replace(/&#(\d+);/g, function (_m, d) { return String.fromCharCode(parseInt(d, 10)); });
}

/**
 * Tags become a SPACE, not nothing.
 *
 * Substituting the empty string glues text across every <br> and cell
 * boundary: "one<br>two" became the single token "onetwo", so word counts,
 * every per-1,000-word density and the mean-sentence-length metric were all
 * quietly wrong on any draft using line breaks.
 */
function stripTags(s: string): string {
  return decodeEntities(s.replace(/<[^>]*>/g, " ")).replace(/\s+/g, " ").trim();
}

export function looksLikeHtml(body: string): boolean {
  return /<(?:p|div|h[1-6]|ul|ol|li|table|section|article|br)\b[^>]*>/i.test(body);
}

interface RawBlock { kind: BlockKind; text: string; level?: number; ordered?: boolean }

function htmlToRawBlocks(body: string): RawBlock[] {
  const out: RawBlock[] = [];
  // Code first, and removed rather than parsed: a fenced sample full of "%",
  // "1.5" and the word "according" would otherwise fabricate statistics and
  // source-adjacency out of thin air.
  const withoutCode = body.replace(/<pre[\s\S]*?<\/pre>/gi, " ").replace(/<code[\s\S]*?<\/code>/gi, " ");

  let orderedDepth = 0;
  const tagRe = new RegExp("<(/?)(" + BLOCK_TAGS + "|ol|ul|table)\\b[^>]*>", "gi");
  let lastIndex = 0;
  let current: { kind: BlockKind; level?: number; ordered?: boolean } | null = null;
  let buffer = "";

  const flush = function () {
    if (current) {
      const t = stripTags(buffer);
      if (t) out.push({ kind: current.kind, text: t, level: current.level, ordered: current.ordered });
    }
    buffer = "";
    current = null;
  };

  // Precedence, and the bug it fixes.
  //
  // Tiptap emits NESTED block tags: <li><p>text</p></li>,
  // <blockquote><p>…</p></blockquote>, <td><p>…</p></td>. The original code
  // flushed and re-opened on every opening tag, so the inner <p> overwrote the
  // outer <li> and every list item, table cell and pull-quote written in our
  // own editor parsed as plain prose — listItemCount 0, hasTable false, and
  // comparative-format-match scoring 0/10 on a draft that IS a ranked list.
  //
  // Worse, it made the same content score differently as HTML and as markdown,
  // breaking this file's own parity promise: the live panel scores editor HTML
  // while a streamed draft scores markdown, so the score jumped the moment the
  // writer touched the editor without changing a word.
  //
  // A weaker container never displaces a stronger one that is still open.
  const RANK: { [k: string]: number } = { prose: 1, quote: 2, heading: 3, tableRow: 4, listItem: 5 };
  let m: RegExpExecArray | null;
  while ((m = tagRe.exec(withoutCode)) !== null) {
    if (current) buffer += withoutCode.slice(lastIndex, m.index);
    lastIndex = tagRe.lastIndex;
    const closing = m[1] === "/";
    const tag = m[2].toLowerCase();

    if (tag === "ol") { orderedDepth += closing ? -1 : 1; continue; }
    if (tag === "ul" || tag === "table") continue;

    let next: { kind: BlockKind; level?: number; ordered?: boolean };
    if (/^h[1-6]$/.test(tag)) next = { kind: "heading", level: parseInt(tag.slice(1), 10) };
    else if (tag === "li") next = { kind: "listItem", ordered: orderedDepth > 0 };
    else if (tag === "tr" || tag === "td" || tag === "th") next = { kind: "tableRow" };
    else if (tag === "blockquote") next = { kind: "quote" };
    else next = { kind: "prose" };

    if (closing) {
      // Only the tag that OPENED the current block closes it. A </p> inside an
      // <li> ends the paragraph, not the list item.
      if (current && RANK[next.kind] >= RANK[current.kind]) flush();
      continue;
    }

    if (current && RANK[next.kind] <= RANK[current.kind]) {
      // A nested weaker tag: keep accumulating into the open block, but insert
      // a space so <p>a</p><p>b</p> inside one cell does not glue to "ab".
      buffer += " ";
      continue;
    }
    flush();
    current = next;
  }
  if (current) buffer += withoutCode.slice(lastIndex);
  flush();
  return out;
}

function markdownToRawBlocks(body: string): RawBlock[] {
  const out: RawBlock[] = [];
  const lines = body.split(/\r?\n/);
  let para: string[] = [];
  let inFence = false;

  const flushPara = function () {
    const t = para.join(" ").replace(/\s+/g, " ").trim();
    if (t) out.push({ kind: "prose", text: stripInline(t) });
    para = [];
  };

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (/^\s*```/.test(line)) { flushPara(); inFence = !inFence; continue; }
    if (inFence) continue;

    if (!line.trim()) { flushPara(); continue; }

    const h = line.match(/^(#{1,6})\s+(.*)$/);
    if (h) { flushPara(); out.push({ kind: "heading", level: h[1].length, text: stripInline(h[2].trim()) }); continue; }

    const ol = line.match(/^\s*\d+[.)]\s+(.*)$/);
    if (ol) { flushPara(); out.push({ kind: "listItem", ordered: true, text: stripInline(ol[1]) }); continue; }

    const ul = line.match(/^\s*[-*+•]\s+(.*)$/);
    if (ul) { flushPara(); out.push({ kind: "listItem", ordered: false, text: stripInline(ul[1]) }); continue; }

    if (/^\s*\|/.test(line)) {
      flushPara();
      // The |---|---| separator row is formatting, not content.
      if (!/^[\s|:-]+$/.test(line)) out.push({ kind: "tableRow", text: stripInline(line.replace(/\|/g, " ").trim()) });
      continue;
    }

    const q = line.match(/^\s*>\s?(.*)$/);
    if (q) { flushPara(); out.push({ kind: "quote", text: stripInline(q[1]) }); continue; }

    para.push(line.trim());
  }
  flushPara();
  return out;
}

/** Markdown inline syntax → plain text, preserving link TEXT (link hrefs are collected separately). */
function stripInline(s: string): string {
  return s
    .replace(/!\[[^\]]*\]\([^)]*\)/g, " ")
    .replace(/\[([^\]]*)\]\([^)]*\)/g, "$1")
    .replace(/`([^`]*)`/g, "$1")
    .replace(/\*\*([^*]+)\*\*/g, "$1")
    .replace(/\*([^*]+)\*/g, "$1")
    .replace(/__([^_]+)__/g, "$1")
    .replace(/\s+/g, " ")
    .trim();
}

// ── Sentence splitting ───────────────────────────────────────────────────

const ABBREV: { [k: string]: boolean } = {};
const ABBREV_LIST = "mr mrs ms dr prof sr jr st vs etc eg ie cf al no fig eq approx inc ltd llc co corp dept est vol ch pp jan feb mar apr jun jul aug sept sep oct nov dec".split(" ");
for (let i = 0; i < ABBREV_LIST.length; i++) ABBREV[ABBREV_LIST[i]] = true;

/**
 * Split one block into sentences.
 *
 * Every miss UNDER-splits, so the mean sentence length can only inflate — which
 * is why the sentence-length tier band is ±4 words wide. A narrow band would be
 * measuring this splitter rather than the prose.
 */
function splitSentences(text: string): string[] {
  const out: string[] = [];
  let start = 0;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (ch !== "." && ch !== "!" && ch !== "?" && ch !== "…") continue;

    // Decimal or version number: 44.2%, v2.1
    if (ch === "." && i > 0 && /\d/.test(text[i - 1]) && /\d/.test(text[i + 1] || "")) continue;

    // Absorb trailing terminators and closing quotes/brackets.
    let j = i;
    while (j + 1 < text.length && /[.!?…]/.test(text[j + 1])) j++;
    while (j + 1 < text.length && /["'”’)\]]/.test(text[j + 1])) j++;

    const next = text[j + 1];
    if (next && !/\s/.test(next)) continue; // example.com/path

    const before = text.slice(start, i);
    const lastToken = (before.match(/([A-Za-z.]+)$/) || ["", ""])[1].toLowerCase().replace(/\.$/, "");
    if (ch === "." && lastToken && ABBREV[lastToken]) continue;
    if (ch === "." && /^[A-Z]$/.test(lastToken.toUpperCase()) && lastToken.length === 1) continue;

    const s = text.slice(start, j + 1).trim();
    if (s) out.push(s);
    start = j + 1;
  }
  const tail = text.slice(start).trim();
  if (tail) out.push(tail);
  return out;
}

// ── Statistics ───────────────────────────────────────────────────────────

/**
 * NOTE ON `%`: the trailing \b is deliberately absent from the percent
 * pattern. `%` is not a word character, so `%\b` only matches when a word
 * character follows — which for "4% once" it does not. Written with the \b,
 * this pattern silently matched NOTHING, statistic density read 0 on every
 * draft ever scored, and the sourcing guard skipped itself for want of
 * statistics. Two criteria dead, no error, plausible-looking scores. It was
 * caught by a fixture asserting a clean draft scores well, not by reading the
 * regex.
 */
const STAT_PATTERNS: { re: RegExp; kind: StatKind }[] = [
  { re: /\b\d[\d,.]*\s?%|\b\d[\d,.]*\s?(?:percent|per cent)\b/gi, kind: "percent" },
  // Magnitude words are ordered LONGEST FIRST. Regex alternation is ordered,
  // so `(?:k|m|...|million)` matches the "m" of "million" and stops — which
  // truncated "EUR 5 million" to "EUR 5 m" and left the rest of the word
  // dangling in the sentence.
  { re: /[$£€¥]\s?\d[\d,.]*(?:\s?(?:trillion|billion|million|bn|k|m))?|\b(?:usd|eur|gbp|chf)\s?\d[\d,.]*(?:\s?(?:trillion|billion|million|bn|k|m))?|\b\d[\d,.]*\s?(?:usd|eur|gbp|chf)\b/gi, kind: "currency" },
  // "10x" AND "10 times" AND "five times" — the spelled forms are how prose
  // actually states a multiplier, and the x-only pattern left "10 times the
  // compressive strength of traditional concrete" invisible to every statistic
  // criterion: the strongest material claim in a real client draft was the one
  // figure nothing asked a source for.
  { re: /\b\d+(?:\.\d+)?\s?(?:x|×)\b|\b(?:\d+(?:\.\d+)?|two|three|four|five|six|seven|eight|nine|ten|twelve|twenty|fifty|hundred)\s+times\b/gi, kind: "multiplier" },
  { re: /\b\d[\d,.]*\s?(?:trillion|billion|million|bn|k|m)\b/gi, kind: "largeNumber" },
  { re: /\b\d+\s+(?:out\s+of|of)\s+\d+\b/gi, kind: "ratio" },
  // The unit list was fintech-flavoured (merchants, transactions, migrations)
  // and missed the vocabulary of industrial and corporate content entirely —
  // tested against a real client article, "19,000 employees" and "1,000 sites"
  // did not count as statistics, so statistic-density read a figure-heavy
  // corporate explainer as thin and the naked-statistic check never looked at
  // its numbers. Units grouped by domain; all still require a leading figure.
  { re: /\b\d[\d,.]*\s+(?:basis points|days?|weeks?|months?|years?|hours?|minutes?|seconds?|users?|customers?|clients?|merchants?|companies|brands?|pages?|words?|citations?|respondents?|transactions?|migrations?|employees|workers|staff|people|jobs|members|partners|suppliers|sites?|plants?|facilities|locations?|stores?|offices?|terminals?|quarries|factories|countries|states?|provinces?|cities|regions?|markets?|projects?|buildings?|homes?|units?|installations?|tons?|tonnes?|pounds?|kilograms?|kg|litres?|liters?|gallons?|barrels?|acres?|hectares?|megawatts?|gigawatts?|kilowatts?|miles?|kilometres?|kilometers?|metres?|meters?|feet|vehicles?|trucks?|machines?)\b/gi, kind: "countWithUnit" },
];

/**
 * Source signals. Same-sentence only, deliberately: the unit an answer engine
 * quotes is the sentence, so a statistic whose attribution sits in the NEXT
 * sentence travels naked when it is extracted.
 */
/**
 * What counts as a source, and why this is stricter than it looks.
 *
 * The first version paired a bare source VERB with any capitalised word, which
 * meant "Research found 60% of buyers switch" was marked fully sourced — the
 * capitalised word was the sentence-initial common noun "Research" and the verb
 * was "found". A draft with no named source anywhere passed the naked-statistic
 * guard cleanly, and that guard is the one most likely to be trusted without
 * checking.
 *
 * So a source verb is no longer sufficient on its own. It must be paired with a
 * proper noun that is NOT merely the capitalised first word of the sentence.
 */
/** Explicit attribution — sufficient alone, wherever it appears. */
const EXPLICIT_ATTRIBUTION = /\b(?:according to|per)\s+[A-Z]|\(\s*source\s*:|\bcited by\b/i;
/** A named institutional source counts on its own — "Kessler Institute modelling shows…". */
const NAMED_SOURCE = /\b[A-Z][a-zA-Z]+\s+(?:Institute|Benchmark|Report|Study|Survey|Index|Review|Association|University|Foundation|Council|Bureau)\b/;
/** A source verb — necessary but NOT sufficient. */
const SOURCE_VERB = /\b(?:reports?|reported|found|finds|survey|surveyed|study|studies|analysis|analyses|research|modelling|modeling|data from)\b/i;
const CAPITALISED_NAME = /\b[A-Z][a-zA-Z]{2,}\b/;

/** True when a capitalised token appears somewhere other than the first word. */
function hasNonInitialProperNoun(sentence: string): boolean {
  const trimmed = sentence.replace(/^[^A-Za-z]*[A-Za-z][a-zA-Z']*\s*/, "");
  return CAPITALISED_NAME.test(trimmed);
}


/**
 * Verbs that attribute speech. Exported so the verify fixture asserts against
 * the SAME list the parser uses — a copy would drift, and the original list
 * (said/says/explains/notes/according to) drifted from real editorial usage
 * badly enough to miss "recalls" twice in one document.
 */
export const ATTRIBUTION_VERB_RE =
  /\b(?:said|says|saying|explains?|explained|notes?|noted|according to|recalls?|recalled|adds?|added|describes?|described|argues?|argued|tells?|told|continues?|continued|warns?|warned|asks?|asked|remembers?|remembered|observes?|observed|puts? it)\b/i;

export function sentenceIsSourced(text: string): boolean {
  if (EXPLICIT_ATTRIBUTION.test(text)) return true;
  if (NAMED_SOURCE.test(text)) return true;
  return SOURCE_VERB.test(text) && hasNonInitialProperNoun(text);
}

/** A bare year is a date, not a statistic — otherwise every dateline inflates evidence density. */
function isBareYear(s: string): boolean {
  return /^\s*(?:19|20)\d{2}\s*$/.test(s);
}

// ── Main parse ───────────────────────────────────────────────────────────

export function parseDraft(input: ParseInput): ParsedDraft {
  const body = input.body || "";
  const title = (input.title || "").trim();
  const format: "html" | "markdown" = looksLikeHtml(body) ? "html" : "markdown";

  const raw = format === "html" ? htmlToRawBlocks(body) : markdownToRawBlocks(body);

  // Links are collected from the SOURCE (both notations), because block text
  // deliberately keeps only link text.
  const links: LinkRef[] = [];
  const hrefRe = format === "html" ? /<a\b[^>]*href\s*=\s*["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi
                                   : /\[([^\]]*)\]\(([^)\s]+)[^)]*\)/g;
  let lm: RegExpExecArray | null;
  while ((lm = hrefRe.exec(body)) !== null) {
    const href = format === "html" ? lm[1] : lm[2];
    const text = format === "html" ? stripTags(lm[2]) : lm[1];
    const hostMatch = href.match(/^https?:\/\/([^/]+)/i);
    const host = hostMatch ? hostMatch[1].toLowerCase().replace(/^www\./, "") : "";
    links.push({ href: href, text: text, host: host, external: !!host });
  }

  // Assemble text + blocks with real offsets.
  const blocks: Block[] = [];
  let text = "";
  for (let i = 0; i < raw.length; i++) {
    const r = raw[i];
    if (text.length > 0) text += "\n\n";
    const start = text.length;
    text += r.text;
    blocks.push({
      index: i, kind: r.kind, text: r.text, level: r.level, ordered: r.ordered,
      start: start, end: text.length,
    });
  }

  // Words.
  const words: { text: string; lower: string; start: number; end: number }[] = [];
  const wordRe = /\S+/g;
  let wm: RegExpExecArray | null;
  while ((wm = wordRe.exec(text)) !== null) {
    words.push({ text: wm[0], lower: wm[0].toLowerCase(), start: wm.index, end: wm.index + wm[0].length });
  }
  let alphaWordCount = 0;
  for (let i = 0; i < words.length; i++) if (/[A-Za-z]/.test(words[i].text)) alphaWordCount++;

  let proseWordCount = 0;
  for (let i = 0; i < blocks.length; i++) {
    if (blocks[i].kind === "prose") proseWordCount += (blocks[i].text.match(/\S+/g) || []).length;
  }

  // Headings.
  const headings: Heading[] = [];
  for (let i = 0; i < blocks.length; i++) {
    const b = blocks[i];
    if (b.kind !== "heading") continue;
    const lower = b.text.toLowerCase();
    const firstWord = (lower.match(/^([a-z']+)/) || ["", ""])[1];
    headings.push({
      level: b.level || 2, text: b.text, textLower: lower,
      blockIndex: i, start: b.start, end: b.end,
      isQuestion: /\?\s*$/.test(b.text),
      isInterrogativeShaped: /\?\s*$/.test(b.text) || INTERROGATIVES[firstWord] === true,
    });
  }

  // Section levels, read from the document, shared by the chunker and the
  // engine so a heading that IS a section cannot be a section for one and not
  // the other — which is what left an H1 question heading with no chunk, and
  // therefore permanently unanswerable.
  const chunkLv = sectionLevels(headings);

  // Sentences, per block. A sentence never crosses a block boundary — which
  // removes the largest error class ("…rose 12% How to fix it Start by…") and
  // lets the ~18-word prose norm be measured over prose only.
  const sentences: Sentence[] = [];
  for (let i = 0; i < blocks.length; i++) {
    const b = blocks[i];
    const kind: SentenceKind =
      b.kind === "heading" ? "heading" :
      b.kind === "listItem" ? "listItem" :
      b.kind === "tableRow" ? "cell" :
      b.kind === "quote" ? "quote" : "prose";
    const parts = b.kind === "heading" ? [b.text] : splitSentences(b.text);
    let cursor = b.start;
    for (let p = 0; p < parts.length; p++) {
      const sTxt = parts[p];
      const at = text.indexOf(sTxt, cursor);
      const sStart = at >= 0 ? at : cursor;
      sentences.push({
        index: sentences.length, text: sTxt, kind: kind,
        wordCount: (sTxt.match(/\S+/g) || []).length,
        blockIndex: i, chunkIndex: -1,
        start: sStart, end: sStart + sTxt.length,
      });
      cursor = sStart + sTxt.length;
    }
  }

  // Chunks: a flat list of leaf sections. H2 and H3 each open one; H1 does not
  // (text before the first H2 is the lede). This is the unit a retriever
  // actually pulls, so it is what "self-contained" is measured over.
  const chunks: Chunk[] = [];
  let openHeading: Heading | null = null;
  let openStartBlock = 0;
  const pushChunk = function (endBlock: number) {
    const from = openStartBlock;
    if (from > endBlock) return;
    const startOff = blocks[from] ? blocks[from].start : 0;
    const endOff = blocks[endBlock] ? blocks[endBlock].end : startOff;
    const cIndex = chunks.length;
    const own: Sentence[] = [];
    for (let s = 0; s < sentences.length; s++) {
      if (sentences[s].blockIndex >= from && sentences[s].blockIndex <= endBlock) {
        sentences[s].chunkIndex = cIndex;
        own.push(sentences[s]);
      }
    }
    const bodySentences = own.filter(function (s) { return s.kind !== "heading"; });
    const prose = bodySentences.filter(function (s) { return s.kind === "prose"; });
    const chunkText = text.slice(startOff, endOff);
    chunks.push({
      index: cIndex, heading: openHeading, text: chunkText,
      bodyText: bodySentences.map(function (s) { return s.text; }).join(" "),
      firstSentence: prose.length > 0 ? prose[0] : (bodySentences.length > 0 ? bodySentences[0] : null),
      firstTwoSentences: bodySentences.slice(0, 2),
      wordCount: (chunkText.match(/\S+/g) || []).length,
      isEmpty: bodySentences.length === 0,
      start: startOff, end: endOff,
    });
  };
  for (let i = 0; i < blocks.length; i++) {
    const b = blocks[i];
    if (b.kind === "heading" && (b.level === chunkLv[0] || b.level === chunkLv[1])) {
      if (i > 0) pushChunk(i - 1);
      openHeading = headings.filter(function (h) { return h.blockIndex === i; })[0] || null;
      openStartBlock = i;
    }
  }
  if (blocks.length > 0) pushChunk(blocks.length - 1);

  // Statistics, with same-sentence source adjacency.
  const stats: StatMention[] = [];
  for (let s = 0; s < sentences.length; s++) {
    const sent = sentences[s];
    if (sent.kind === "heading") continue;
    const sourced = sentenceIsSourced(sent.text);
    for (let p = 0; p < STAT_PATTERNS.length; p++) {
      const re = new RegExp(STAT_PATTERNS[p].re.source, STAT_PATTERNS[p].re.flags);
      let sm: RegExpExecArray | null;
      while ((sm = re.exec(sent.text)) !== null) {
        if (isBareYear(sm[0])) continue;
        const abs = sent.start + sm.index;
        let dup = false;
        for (let d = 0; d < stats.length; d++) {
          if (stats[d].start < abs + sm[0].length && abs < stats[d].end) { dup = true; break; }
        }
        if (dup) continue;
        stats.push({
          text: sm[0], kind: STAT_PATTERNS[p].kind, sentenceIndex: s,
          sourced: sourced, start: abs, end: abs + sm[0].length, inQuote: false,
        });
      }
    }
  }

  // Quotations of >=5 words with an attribution signal nearby.
  const quotes: QuoteMention[] = [];
  const quoteRe = /["“]([^"”]{15,400})["”]/g;
  let qm: RegExpExecArray | null;
  while ((qm = quoteRe.exec(text)) !== null) {
    const inner = qm[1];
    const wc = (inner.match(/\S+/g) || []).length;
    if (wc < 5) continue;
    const around = text.slice(Math.max(0, qm.index - 160), Math.min(text.length, qm.index + qm[0].length + 160));
    const after = text.slice(qm.index + qm[0].length, Math.min(text.length, qm.index + qm[0].length + 90));
    // Three attribution shapes, each learned from a real miss on the founder's
    // own draft, where ALL SIX flagged quotes turned out to be attributed and
    // the panel said "0 attributed quotations" about a piece with ten:
    //
    //  - the VERB list had said/says/explains/notes/according-to and nothing
    //    else, so "recalls Alexander Kitchin" and "recalls how they refined…"
    //    both read as no speaker;
    //  - PULL QUOTES attribute with an em dash — "— Chris Bird, Senior
    //    Structural Engineer, TYLin" — a shape the detector did not know at
    //    all. Anchored to the text IMMEDIATELY after the closing quote and
    //    requiring a capital, because an em dash with a lowercase continuation
    //    ("…letters," — a 103-word excerpt) is prose, not a byline;
    //  - the Name-comma-title pattern demanded the title word right after the
    //    comma, so "Fine Concrete's founding partner" and "senior structural
    //    engineer" never matched. It now tolerates up to 60 characters of
    //    modifier between the comma and the title word, within one sentence.
    const attributed = ATTRIBUTION_VERB_RE.test(around)
      || /^\s*[—–]\s*[A-Z]/.test(after)
      || /\b[A-Z][a-z]+\s+[A-Z][a-z]+\s*,[^.!?]{0,60}?\b(?:CEO|CTO|CFO|COO|founder|co-founder|director|head|analyst|professor|Dr\.?|president|principal|partner|engineer|consultant|architect|strategist|officer|manager|lead)\b/i.test(around);
    quotes.push({ text: inner, wordCount: wc, attributed: attributed, start: qm.index, end: qm.index + qm[0].length });
  }

  // Stats inside quotations, marked AFTER quotes exist. An attributed quote's
  // figures are sourced — "going to last 100 years or more," with Finnegan
  // named, needs no second citation, and demanding one tells the writer to
  // rewrite the man's own sentence.
  for (let si = 0; si < stats.length; si++) {
    for (let qi = 0; qi < quotes.length; qi++) {
      if (stats[si].start >= quotes[qi].start && stats[si].end <= quotes[qi].end) {
        stats[si].inQuote = true;
        if (quotes[qi].attributed) stats[si].sourced = true;
        break;
      }
    }
  }

  let hasOrderedList = false, hasUnorderedList = false, hasTable = false, listItemCount = 0;
  for (let i = 0; i < blocks.length; i++) {
    if (blocks[i].kind === "listItem") {
      listItemCount++;
      if (blocks[i].ordered) hasOrderedList = true; else hasUnorderedList = true;
    }
    if (blocks[i].kind === "tableRow") hasTable = true;
  }

  return {
    format: format, title: title, text: text, blocks: blocks, words: words,
    wordCount: words.length, alphaWordCount: alphaWordCount, proseWordCount: proseWordCount,
    headings: headings, chunks: chunks, sentences: sentences, stats: stats,
    links: links, quotes: quotes,
    hasOrderedList: hasOrderedList, hasUnorderedList: hasUnorderedList,
    hasTable: hasTable, listItemCount: listItemCount,
  };
}

const INTERROGATIVES: { [k: string]: boolean } = {};
const INTERROGATIVE_WORDS = "what how why when where which who can should does do is are".split(" ");
for (let i = 0; i < INTERROGATIVE_WORDS.length; i++) INTERROGATIVES[INTERROGATIVE_WORDS[i]] = true;

/**
 * The first N% of the draft BY WORDS, snapped forward to a sentence end.
 *
 * By words, not characters, for one testable reason above all: the same draft
 * as editor HTML and as exported markdown must score identically, and character
 * counts differ between the two (markup residue, entity expansion, list
 * markers) while word counts do not. The snap stops a draft whose answer
 * straddles the boundary from failing on a formatting technicality.
 */
export function sliceByWords(parsed: ParsedDraft, fraction: number): Sentence[] {
  if (parsed.words.length === 0) return [];
  const cut = Math.max(1, Math.ceil(parsed.words.length * fraction));
  const cutChar = parsed.words[Math.min(cut, parsed.words.length) - 1].end;
  const out: Sentence[] = [];
  for (let i = 0; i < parsed.sentences.length; i++) {
    if (parsed.sentences[i].start <= cutChar) out.push(parsed.sentences[i]);
  }
  return out;
}

/** Word-boundary-safe term match. Ported from AuthorityOn's containsAny guard —
 *  without it "roi" matches "heroic" and "orchestration" matches "orchestrations". */
export function countTerm(haystackLower: string, termLower: string): number {
  const escaped = termLower.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const re = new RegExp("\\b" + escaped + "\\b", "g");
  const m = haystackLower.match(re);
  return m ? m.length : 0;
}

export function containsAny(haystackLower: string, terms: string[]): number {
  let n = 0;
  for (let i = 0; i < terms.length; i++) {
    if (countTerm(haystackLower, terms[i].toLowerCase()) > 0) n++;
  }
  return n;
}
