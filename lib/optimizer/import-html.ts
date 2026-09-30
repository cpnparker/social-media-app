/**
 * Turning imported content into the HTML the editor and the rubric expect.
 *
 * THE BUG THIS FIXES. Nothing converted imported content into HTML. A paste
 * arrived from a textarea as plain text with blank lines between paragraphs, a
 * Google Doc arrived as a plain-text export, and both were handed straight to
 * Tiptap — which parses its input as HTML, where newlines are whitespace. Every
 * imported article became ONE paragraph with no headings at all.
 *
 * That is not a cosmetic problem. Heading structure is scored: the rubric has
 * criteria for heading hierarchy, for question-shaped subheads, and for
 * answer-first structure under each one. An article whose headings were
 * silently flattened is not scored leniently — it is scored as a wall of text,
 * and the writer is shown a low number and a list of problems they do not have.
 *
 * So the fix is not "insert some paragraph tags". It is to preserve the real
 * structure wherever it can be had:
 *   - a paste carries text/html on the clipboard (Google Docs, Word, every CMS)
 *   - a Google Doc exports as HTML, not only as text
 *   - genuinely plain text is converted conservatively, marking only what is
 *     explicitly marked
 *
 * Pure and synchronous, like the rest of lib/optimizer. Its one import is the
 * chat's definition of a quote marker, which is pure string work too.
 */
import { stripQuoteMarkers } from "../ai/chat-markdown";

/**
 * Tags Tiptap can represent. Anything else is unwrapped (its children are kept)
 * rather than dropped, because dropping loses the writer's words.
 */
const KEEP = [
  "p", "br", "h1", "h2", "h3", "h4", "h5", "h6",
  "ul", "ol", "li", "blockquote", "pre", "code",
  "strong", "b", "em", "i", "s", "u", "a",
  "table", "thead", "tbody", "tr", "td", "th", "hr",
  // Images arrive with uploaded documents, which carry the figures the prose
  // refers to. Dropping them silently would leave "as the chart below shows"
  // pointing at nothing, and the alt-text criteria scoring an article that
  // appears to have no images at all.
  "img",
];

/**
 * Unknown tags that are INLINE, and so are unwrapped to NOTHING.
 *
 * The general rule elsewhere in lib/optimizer is to replace a dropped tag with
 * a SPACE, because deleting one between two words glues them together. Inline
 * tags are the exception, and Google Docs is why: it splits words across spans
 * constantly (`<span>Headlin</span><span>e</span>`), so a space here does the
 * mirror-image damage — it breaks real words apart. "Headlin e" is not more
 * recoverable than "onetwo"; it is the same bug pointing the other way.
 *
 * Block-level unknowns still get the space. Both rules are asserted in
 * scripts/verify-optimizer-import-html.ts, in both directions.
 */
const INLINE_UNWRAP = [
  "span", "font", "sup", "sub", "small", "big", "abbr", "cite", "mark", "time",
  "var", "kbd", "samp", "q", "bdi", "bdo", "ruby", "rt", "rp", "ins", "del", "wbr",
];

/** Removed WITH their contents — the content is not the writer's prose. */
const NUKE = ["script", "style", "head", "meta", "link", "noscript", "iframe", "object", "embed", "svg"];

/**
 * Strip everything dangerous or noisy from pasted/exported HTML.
 *
 * This is a whitelist over the tag vocabulary, not a blacklist over attributes:
 * every attribute is dropped except href on an anchor, so there is no event
 * handler, no style, no class and no data- attribute left to carry anything.
 *
 * NOT a substitute for DOMPurify on rendering. This runs on INGEST, and the
 * result is stored, re-parsed by Tiptap (which enforces its own schema) and
 * sanitised again on the way to the DOM. Belt and braces on purpose: the input
 * is a third-party document.
 */
export function sanitizeImportedHtml(html: string): string {
  return sanitize(html, true);
}

/**
 * The whitelist again, WITHOUT the inferences, for HTML that has already been
 * through the door once: the Optimizer's paste box sends its own editor's
 * HTML, which classifyPaste built from the clipboard with sanitizeImportedHtml.
 *
 * The client is not trusted, so the whitelist runs again. The inferences —
 * the house-template and layout-table unwraps and bold-line heading promotion
 * — do not, because they already ran on the source's OWN markup, and running
 * them on the editor's re-serialisation of it guesses again from different
 * evidence. Measured on 2026-09-23: Word and Pages mark bold with <b>, which
 * promoteBoldLineHeadings deliberately does not read; the editor writes every
 * bold run back out as <strong>, which it does — so a short bold line from
 * Word showed in the box as a bold paragraph and was STORED as an <h2> the
 * writer never saw. An invented heading is the score a writer cannot explain;
 * what the box shows is what the import stores.
 */
export function resanitizeEditorHtml(html: string): string {
  return sanitize(html, false);
}

function sanitize(html: string, infer: boolean): string {
  let s = html || "";

  // Comments first — a comment can contain anything, including "<script>".
  s = s.replace(/<!--[\s\S]*?-->/g, "");

  // Word's list paragraphs, BEFORE the conditional markers below are removed:
  // the marker is the only place a Word list says whether it is numbered.
  s = wordListParagraphs(s);

  // MARKUP DECLARATIONS AND WORD'S DOWNLEVEL CONDITIONALS, which are not tags
  // and were not comments, so nothing above removed them — and the balancer
  // below keeps only runs of text and whitelisted tags, which means it quietly
  // dropped their "<" and kept the rest AS PROSE. Measured on 2026-09-23 with
  // the real clipboard payloads: a Pages or TextEdit paste (RTF converted by
  // Chrome's Cocoa writer) opened with a paragraph reading
  // `!DOCTYPE html PUBLIC "-//W3C//DTD HTML 4.01//EN" …>`, and every item of a
  // Word desktop bullet list carried `![if !supportLists]>· ![endif]>` into the
  // article, where it was scored as the writer's words.
  //
  // The HTML tokenizer ends a declaration, a processing instruction and a
  // CDATA-shaped bogus comment at the first ">", so these patterns do too —
  // anything longer would be a guess about where the browser stops. Inside a
  // list paragraph the `!supportLists` block has already gone WITH its
  // contents, above: there it is the bullet or number, and the list now says
  // that structurally. Everywhere else a conditional loses only its markers,
  // because its contents are what a browser is MEANT to show — the figure in
  // `!vml`, the break in `!supportLineBreakNewLine`, and the "1." of a
  // numbered heading, which is the heading's visible number and has no
  // structure to live in instead. Its spacer run of &nbsp; becomes one space.
  s = s.replace(/<!\[if\s+!supportLists\]>([\s\S]*?)<!\[endif\]>/gi, (_m, inner) =>
    String(inner).replace(/(?:&nbsp;|\u00a0)+/gi, " "));
  s = s.replace(/<![^>]*>/g, "");
  s = s.replace(/<\?[^>]*>/g, "");

  // A bold wrapper that says it is NOT bold. Google Docs wraps every copied
  // selection in `<b style="font-weight:normal" id="docs-internal-guid-…">`,
  // and the whitelist below keeps <b> while dropping its style — so the one
  // attribute saying "this is not bold" was the one thrown away, and every word
  // of a pasted Google Doc arrived bold (131 of 131 in the measured payload).
  // Tiptap's own Bold extension refuses this exact wrapper for this exact
  // reason; the sanitiser runs first and has to know it too. Unwrapped rather
  // than dropped — the whole document is inside it — and the orphaned </b> is
  // the balancer's to discard.
  s = s.replace(/<(b|strong)\b([^>]*)>/gi, (m, _tag, attrs) => {
    const style = (String(attrs).match(/style\s*=\s*["']([^"']*)["']/i) || [])[1] || "";
    return /font-weight\s*:\s*(normal|lighter|[1-4]00)\b/i.test(style) ? "" : m;
  });

  // ARIA HEADINGS ARE HEADINGS. Word for the web does not emit <h1>-<h6> on
  // copy: a heading paragraph arrives as `<p role="heading" aria-level="2">`,
  // and the whitelist kept the <p> and dropped both attributes — so every
  // heading in a Word Online paste became a paragraph and question-headings
  // read 0/10 on a document with five. This is NOT inference of the kind the
  // font-size note below refuses: role="heading" with an aria-level is the
  // document stating, in the accessibility vocabulary, exactly what <h2>
  // states in the HTML one. Restricted to <p>, which cannot nest, so the lazy
  // match to its own close tag is exact.
  // Gated on the attribute appearing at all: the lazy scan to </p> is cheap on
  // well-formed markup, and there is no reason to pay for it on the 500k
  // characters of a page that has no ARIA headings.
  if (/role\s*=\s*["']?heading/i.test(s)) s = s.replace(/<p\b([^>]*)>([\s\S]*?)<\/p\s*>/gi, (m, attrs, inner) => {
    // Anchored on whitespace, not \b: Word for the web also writes
    // data-aria-level on list items, and \b would read that as aria-level.
    if (!/(?:^|\s)role\s*=\s*["']?heading\b/i.test(String(attrs))) return m;
    const lv = Number((String(attrs).match(/(?:^|\s)aria-level\s*=\s*["']?(\d)/i) || [])[1] || 2);
    const level = lv >= 1 && lv <= 6 ? lv : 2;
    return `<h${level}>${inner}</h${level}>`;
  });

  // Resolve CSS classes BEFORE the <style> block is nuked.
  //
  // Verified against a real Google Docs HTML export on 2026-08-21: it emits no
  // <strong> at all, and expresses bold as `<span class="c4">` with `.c4 {
  // font-weight: 700 }` in a <style> block. Strip the block first and every
  // bold run in the document is silently lost — and key-term emphasis is a
  // scored criterion.
  //
  // Deliberately limited to font-weight and font-style. Inferring a HEADING
  // from font-size is the obvious next step and it is not taken: size is a
  // guess, and inventing heading structure produces a score the writer cannot
  // explain. Docs that use real Heading styles export real <h1>-<h6>, which
  // survive the whitelist untouched.
  const boldClasses: { [k: string]: true } = {};
  const italicClasses: { [k: string]: true } = {};
  const styleBlocks = s.match(/<style\b[^>]*>([\s\S]*?)<\/style\s*>/gi) || [];
  for (let i = 0; i < styleBlocks.length; i++) {
    const rules = styleBlocks[i].replace(/<\/?style[^>]*>/gi, "");
    const ruleRe = /\.([A-Za-z0-9_-]+)\s*\{([^}]*)\}/g;
    let rm: RegExpExecArray | null;
    while ((rm = ruleRe.exec(rules)) !== null) {
      const cls = rm[1];
      const body = rm[2];
      if (/font-weight\s*:\s*(bold|[6-9]00)/i.test(body)) boldClasses[cls] = true;
      if (/font-style\s*:\s*italic/i.test(body)) italicClasses[cls] = true;
    }
  }
  const classIsBold = (attrs: string) => {
    const cls = (String(attrs).match(/class\s*=\s*["']([^"']*)["']/i) || [])[1] || "";
    const parts = cls.split(/\s+/);
    for (let i = 0; i < parts.length; i++) if (boldClasses[parts[i]]) return true;
    return false;
  };
  const classIsItalic = (attrs: string) => {
    const cls = (String(attrs).match(/class\s*=\s*["']([^"']*)["']/i) || [])[1] || "";
    const parts = cls.split(/\s+/);
    for (let i = 0; i < parts.length; i++) if (italicClasses[parts[i]]) return true;
    return false;
  };
  // Google Docs comment and footnote ARTEFACTS.
  //
  // A commented word exports as `…Headlin</p><sup><a href="#cmnt1">[a]</a></sup><p>e…`
  // — Docs splits the paragraph around the marker. Left alone, "[a]" is
  // imported as body text and scored as prose, and the word itself arrives
  // broken across two paragraphs. Removing the marker AND the split it caused
  // is one operation, because the split exists only because of the marker.
  s = s.replace(
    /<\/p>\s*(?:<sup\b[^>]*>)?\s*<a\b[^>]*href=["']#(?:cmnt|ftnt)[^"']*["'][^>]*>[\s\S]*?<\/a\s*>\s*(?:<\/sup\s*>)?\s*<p\b[^>]*>/gi,
    ""
  );
  // Any remaining marker, not adjacent to a paragraph boundary.
  s = s.replace(/(?:<sup\b[^>]*>)?\s*<a\b[^>]*href=["']#(?:cmnt|ftnt)[^"']*["'][^>]*>[\s\S]*?<\/a\s*>\s*(?:<\/sup\s*>)?/gi, "");
  // The comment bodies Docs appends at the end of the document, each anchored
  // by an <a href="#cmnt_ref…"> back-link. They are editorial chatter about the
  // piece, not the piece.
  s = s.replace(/<div\b[^>]*>\s*<p\b[^>]*>\s*<a\b[^>]*href=["']#cmnt_ref[^"']*["'][\s\S]*?<\/div\s*>/gi, "");

  for (let i = 0; i < NUKE.length; i++) {
    const tag = NUKE[i];
    s = s.replace(new RegExp(`<${tag}\\b[\\s\\S]*?</${tag}\\s*>`, "gi"), " ");
    // Unclosed or self-closing form of the same tag.
    s = s.replace(new RegExp(`<${tag}\\b[^>]*/?>`, "gi"), " ");
  }

  // Google Docs and Word express bold and italic as inline STYLE on a span, not
  // as <strong>/<em>. Tiptap keeps no styles, so without this every bold word
  // in a pasted article silently becomes plain text — and "key term emphasis"
  // is a scored criterion.
  s = s.replace(/<span\b([^>]*)>/gi, (m, attrs) => {
    const style = (String(attrs).match(/style\s*=\s*["']([^"']*)["']/i) || [])[1] || "";
    const bold = /font-weight\s*:\s*(bold|[6-9]00)/i.test(style) || classIsBold(attrs);
    const italic = /font-style\s*:\s*italic/i.test(style) || classIsItalic(attrs);
    if (bold && italic) return "<strong><em>";
    if (bold) return "<strong>";
    if (italic) return "<em>";
    return "";
  });
  // The close tags are ambiguous (a span could have been either), so close both
  // and let the tag balancer below drop whichever has no opener.
  s = s.replace(/<\/span\s*>/gi, "</em></strong>");

  // Now the tag whitelist. An unknown tag is UNWRAPPED — replaced with a space
  // so its neighbours cannot glue together, its children kept.
  s = s.replace(/<\/?([a-zA-Z][a-zA-Z0-9]*)\b([^>]*)>/g, (full, rawTag, attrs) => {
    const tag = String(rawTag).toLowerCase();
    if (KEEP.indexOf(tag) < 0) return INLINE_UNWRAP.indexOf(tag) >= 0 ? "" : " ";
    if (full.charAt(1) === "/") return `</${tag}>`;
    if (tag === "a") {
      const href = (String(attrs).match(/href\s*=\s*["']([^"']*)["']/i) || [])[1] || "";
      // javascript:, data: and vbscript: URLs are the reason this is a
      // whitelist of schemes rather than a blacklist of strings.
      const safe = /^(https?:|mailto:|#|\/)/i.test(href.trim()) ? href.trim() : "";
      return safe ? `<a href="${safe.replace(/"/g, "&quot;")}">` : "<a>";
    }
    if (tag === "img") {
      const src = (String(attrs).match(/\bsrc\s*=\s*["']([^"']*)["']/i) || [])[1] || "";
      // Same whitelist reasoning as href, with data: deliberately excluded:
      // data:image/svg+xml carries executable script, and a base64 image would
      // also push a multi-megabyte string through the draft column on every
      // save. Uploaded images are put in blob storage and referenced by URL.
      const safeSrc = /^(https?:|\/)/i.test(src.trim()) ? src.trim() : "";
      if (!safeSrc) return " ";
      const alt = (String(attrs).match(/\balt\s*=\s*["']([^"']*)["']/i) || [])[1] || "";
      const esc = (v: string) => v.replace(/"/g, "&quot;").replace(/</g, "&lt;");
      return `<img src="${esc(safeSrc)}"${alt ? ` alt="${esc(alt)}"` : ""}>`;
    }
    if (tag === "br" || tag === "hr") return `<${tag}>`;
    return `<${tag}>`;
  });

  // A space immediately inside a tag boundary is always an artefact of
  // unwrapping, never the writer's, and it is what turns a rejoined word into
  // "Headlin e".
  let out = balanceTags(s)
    .replace(/[ \t]{2,}/g, " ")
    .replace(/>\s+</g, "><")
    .replace(/<(p|h[1-6]|li|td|th|blockquote)>\s+/gi, "<$1>")
    .replace(/\s+<\/(p|h[1-6]|li|td|th|blockquote)>/gi, "</$1>")
    // A <br> standing BETWEEN two blocks is a blank line in the source, not a
    // line break inside anything. Google Docs puts one between every block it
    // copies, and the editor wraps each in an empty paragraph of its own —
    // which is the shape unwrapLayoutTables below documents costing a real
    // piece its heading-answer score. Only between block boundaries; a <br>
    // inside a paragraph is the writer's.
    .replace(/(^|<\/(?:p|h[1-6]|ul|ol|table|blockquote|pre)>)(?:<br>)+(?=<(?:p|h[1-6]|ul|ol|table|blockquote|pre|hr)\b|$)/gi, "$1")
    .trim();

  // AFTER normalisation, deliberately. Both transforms pattern-match on tag
  // adjacency, and running them against the pre-collapse form — where every
  // unwrapped tag left a space — made their guards fail quietly on real
  // documents while passing on tidy fixtures. The final form is the only one
  // with a stable shape to match against.
  if (!infer) return out;
  out = unwrapTemplateTable(out);
  // After the house-template unwrap, which recognises only the label/value
  // shape, and before heading promotion — a heading freed from a layout cell
  // must exist before anything reasons about the heading tree.
  out = unwrapLayoutTables(out);
  out = promoteBoldLineHeadings(out);
  return out;
}

/**
 * Rebuild Word's lists from its list PARAGRAPHS.
 *
 * Word desktop (and Outlook, which uses Word's engine) does not copy a list as
 * <ul>/<li>. Each item is a paragraph carrying `mso-list:l0 level1 lfo1` in its
 * style, with the bullet or number it renders sitting inside a
 * `<![if !supportLists]>…<![endif]>` block at its start. The whitelist kept
 * the paragraphs and dropped the style, so a three-item list arrived as three
 * paragraphs each opening on a "·" — no list for the rubric's list criteria to
 * find, and the glyph scored as prose.
 *
 * The marker decides the list type, because it is the only place the
 * clipboard says: "1." / "a)" / "iv." is numbered, a glyph ("·", "o", "§",
 * "-") is not. Levels are flattened into one list — nesting would need Word's
 * list definitions from the <style> block, which a rebuilt list would then
 * have to trust, and a flat list keeps every item and every word. Headings
 * with numbering (`<h2 style="mso-list:…">`) are deliberately not touched:
 * a numbered heading is still a heading.
 */
function wordListParagraphs(html: string): string {
  if (!/mso-list\s*:\s*l\d/i.test(html)) return html;
  const PARA = /<p\b[^>]*mso-list\s*:\s*l\d+[^>]*>[\s\S]*?<\/p\s*>/gi;
  return html.replace(/(?:<p\b[^>]*mso-list\s*:\s*l\d+[^>]*>[\s\S]*?<\/p\s*>\s*)+/gi, (run) => {
    const paras = run.match(PARA) || [];
    let out = "";
    let open: "ul" | "ol" | null = null;
    for (let i = 0; i < paras.length; i++) {
      const para = paras[i];
      const markerHtml = (para.match(/<!\[if\s+!supportLists\]>([\s\S]*?)<!\[endif\]>/i) || [])[1] || "";
      const marker = markerHtml.replace(/<[^>]+>/g, "").replace(/&nbsp;|\u00a0/gi, " ").trim();
      const kind: "ul" | "ol" = /^\(?(\d{1,3}|[a-z]|[ivxlc]{1,6})[.)]$/i.test(marker) ? "ol" : "ul";
      const inner = para
        .replace(/^<p\b[^>]*>/i, "")
        .replace(/<\/p\s*>$/i, "")
        .replace(/<!\[if\s+!supportLists\]>[\s\S]*?<!\[endif\]>/gi, "");
      if (open !== kind) {
        if (open) out += `</${open}>`;
        out += `<${kind}>`;
        open = kind;
      }
      out += `<li><p>${inner}</p></li>`;
    }
    if (open) out += `</${open}>`;
    return out;
  });
}

/**
 * Drop close tags with no opener and close openers left dangling.
 *
 * Tiptap recovers from most malformed HTML, but the span→strong rewrite above
 * deliberately emits `</em></strong>` for every `</span>`, so unbalanced tags
 * are not a hypothetical here — they are produced on purpose and cleaned up
 * once, in one place.
 */
function balanceTags(html: string): string {
  // img belongs here with br and hr: it never closes. Without it the balancer
  // pushes img onto the stack and emits a stray </img> at the end of the
  // document, which ProseMirror then parses as a stray paragraph break.
  const VOID = ["br", "hr", "img"];
  const out: string[] = [];
  const stack: string[] = [];
  const re = /<\/?([a-zA-Z][a-zA-Z0-9]*)\b[^>]*>|[^<]+/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(html)) !== null) {
    const token = m[0];
    if (token.charAt(0) !== "<") { out.push(token); continue; }
    const tag = String(m[1]).toLowerCase();
    if (VOID.indexOf(tag) >= 0) { out.push(token); continue; }
    if (token.charAt(1) === "/") {
      const at = stack.lastIndexOf(tag);
      if (at < 0) continue; // close with no opener — drop it
      // Close everything opened inside it, innermost first.
      for (let i = stack.length - 1; i >= at; i--) out.push(`</${stack[i]}>`);
      stack.length = at;
    } else {
      stack.push(tag);
      out.push(token);
    }
  }
  for (let i = stack.length - 1; i >= 0; i--) out.push(`</${stack[i]}>`);
  return out.join("");
}

/**
 * Unwrap the label/value template table.
 *
 * The house Google Docs article template is a two-column table — Headline,
 * Byline, Standfirst, Article down the left, content on the right — so a real
 * imported draft arrives as ONE table whose "Article" cell holds the whole
 * piece. Everything downstream then sees a document with one chunk and no
 * headings: the judge reported "1 of 1 sections", question-heading criteria
 * scored over zero headings, and chunk-level analysis had nothing to hold.
 * Observed on the founder's own first import.
 *
 * The unwrap is deliberately conservative: it fires only when the table's left
 * column is entirely short labels and one of them is headline/title-like.
 * A data table — the thing tables are FOR — never matches, and stays a table.
 */
export function unwrapTemplateTable(html: string): string {
  const m = html.match(/<table>([\s\S]*?)<\/table>/i);
  if (!m) return html;

  const CONTENT = /^(headline|title|byline|author|standfirst|intro|introduction|article|body|copy|text)s?$/;
  const rows: { label: string; value: string }[] = [];
  let scaffoldChars = 0;
  const rowRe = /<tr>([\s\S]*?)<\/tr>/gi;
  let rm: RegExpExecArray | null;
  while ((rm = rowRe.exec(m[1])) !== null) {
    const cells = rm[1].match(/<t[dh]>[\s\S]*?<\/t[dh]>/gi) || [];
    const plain = rm[1].replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
    if (cells.length !== 2) {
      // Not label/value shaped. Tolerable as scaffold if it is small; a row
      // carrying real text means this is not the template and must survive.
      scaffoldChars += plain.length;
      continue;
    }
    const label = cells[0].replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim().toLowerCase();
    if (CONTENT.test(label)) {
      rows.push({ label, value: cells[1].replace(/^<t[dh]>/i, "").replace(/<\/t[dh]>$/i, "") });
    } else {
      // The template carries workflow rows too — "Please tick and initial",
      // sign-offs. Scaffold, not prose. Counted, because eating a row that
      // turns out to hold content is the one unforgivable outcome here.
      scaffoldChars += plain.length;
    }
  }

  // Fire only when this is unmistakably the article template: a headline-like
  // row, a body-like row holding most of the table's text, and no substantial
  // row left unaccounted for.
  const hasHeadline = rows.some((r) => /^(headline|title)s?$/.test(r.label));
  const bodyRow = rows.filter((r) => /^(article|body|copy|text)s?$/.test(r.label))[0];
  if (!hasHeadline || !bodyRow) return html;
  const bodyLen = bodyRow.value.replace(/<[^>]+>/g, "").length;
  const tableLen = m[1].replace(/<[^>]+>/g, "").length || 1;
  if (bodyLen / tableLen < 0.5) return html;
  if (scaffoldChars > 400) return html;

  const parts: string[] = [];
  for (let i = 0; i < rows.length; i++) {
    const r = rows[i];
    const inner = r.value.trim();
    if (!inner.replace(/<[^>]+>/g, "").trim()) continue;
    if (/^(headline|title)s?$/.test(r.label)) {
      parts.push(`<h1>${inner.replace(/<\/?p>/gi, "").replace(/<\/?strong>/gi, "")}</h1>`);
    } else {
      parts.push(inner);
    }
  }
  return html.replace(m[0], parts.join(""));
}

/**
 * Promote whole-line bold paragraphs to headings.
 *
 * Inside a Docs table cell, the Heading styles are unavailable-in-practice:
 * writers bold a short line instead, and the export carries it as a bold
 * paragraph. "Modernising the healthcare sector" arrived exactly that way.
 *
 * This is inference, and the rule that keeps it honest is strictness in every
 * direction at once: the ENTIRE paragraph must be bold, 2-9 words, under 70
 * characters, with no sentence-ending punctuation. A short emphatic sentence
 * ("**This changes everything.**") keeps its full stop and stays a paragraph.
 */
export function promoteBoldLineHeadings(html: string): string {
  return html.replace(
    /<p>\s*<strong>([^<]{2,70})<\/strong>\s*<\/p>/gi,
    (full, inner: string) => {
      const text = inner.trim();
      const words = text.split(/\s+/).length;
      if (words < 2 || words > 9) return full;
      if (/[.!?,;:]$/.test(text)) return full;
      return `<h2>${text}</h2>`;
    }
  );
}

function escapeHtml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

/** Inline markdown emphasis, applied to already-escaped text. */
function inlineMarks(s: string): string {
  return s
    .replace(/\*\*([^*\n]+)\*\*/g, "<strong>$1</strong>")
    .replace(/(^|[^*])\*([^*\n]+)\*/g, "$1<em>$2</em>")
    .replace(/`([^`\n]+)`/g, "<code>$1</code>")
    .replace(/\[([^\]\n]+)\]\((https?:\/\/[^\s)]+)\)/g, '<a href="$2">$1</a>');
}

/**
 * Convert genuinely plain text into HTML.
 *
 * CONSERVATIVE BY DESIGN. It marks up only what the text explicitly marks: a
 * `##` heading, a `-` or `1.` list. It deliberately does NOT guess that a short
 * line is a heading. That heuristic is tempting — a Google Docs plain-text
 * export loses heading markup entirely, so the only trace left IS a short line
 * — but guessing wrong invents structure the writer did not write, and heading
 * structure is scored. A missed heading shows up as a suggestion they can act
 * on; an invented one shows up as a score they cannot explain.
 *
 * The real answer for Google Docs is to export HTML instead, which is what
 * lib/gdrive/doc-link.ts now does. This is the floor, not the plan.
 */
export function plainTextToHtml(text: string): string {
  return plainBlocks((text || "").replace(/\r\n?/g, "\n").trim(), 0);
}

/** A line that starts a block of its own, so it ends a quoted paragraph
 *  rather than continuing it lazily. */
const STARTS_BLOCK = /^(#{1,6}\s|-{3,}$|\*{3,}$|_{3,}$|[-*+•·]\s|\d+[.)]\s)/;

/** How deep quotes nest before the rest are flattened into the one around
 *  them: each level is a recursion, and a line of two thousand ">" is not a
 *  document anyone meant. */
const MAX_QUOTE_DEPTH = 4;

function plainBlocks(src: string, depth: number): string {
  if (!src) return "";

  const lines = src.split("\n");
  const out: string[] = [];
  let listTag: "ul" | "ol" | null = null;
  let para: string[] = [];

  const flushPara = () => {
    if (!para.length) return;
    // Single newlines inside a paragraph are soft breaks, not new paragraphs —
    // a hard-wrapped document would otherwise become one paragraph per LINE.
    out.push(`<p>${inlineMarks(escapeHtml(para.join("\n"))).replace(/\n/g, "<br>")}</p>`);
    para = [];
  };
  const closeList = () => {
    if (listTag) { out.push(`</${listTag}>`); listTag = null; }
  };

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const trimmed = line.trim();

    if (!trimmed) { flushPara(); closeList(); continue; }

    const heading = trimmed.match(/^(#{1,6})\s+(.*)$/);
    if (heading) {
      flushPara(); closeList();
      out.push(`<h${heading[1].length}>${inlineMarks(escapeHtml(heading[2].trim()))}</h${heading[1].length}>`);
      continue;
    }

    if (/^(-{3,}|\*{3,}|_{3,})$/.test(trimmed)) {
      flushPara(); closeList();
      out.push("<hr>");
      continue;
    }

    // Bullets, including the • that a Docs plain-text export actually emits.
    const bullet = trimmed.match(/^[-*+•·]\s+(.*)$/);
    const numbered = trimmed.match(/^\d+[.)]\s+(.*)$/);
    if (bullet || numbered) {
      flushPara();
      const want: "ul" | "ol" = bullet ? "ul" : "ol";
      if (listTag && listTag !== want) closeList();
      if (!listTag) { out.push(`<${want}>`); listTag = want; }
      const body = (bullet ? bullet[1] : numbered![1]).trim();
      // <li><p>…</p></li>, because that is what Tiptap emits and what
      // lib/optimizer/parse.ts is built to read.
      out.push(`<li><p>${inlineMarks(escapeHtml(body))}</p></li>`);
      continue;
    }

    // A quote block, whole: every line of it, a bare ">" included, and a line
    // without a marker that carries on a quoted paragraph. ONE <blockquote>,
    // its contents converted by this same function, so a heading, a list and
    // the line break in a sign-off survive inside it. This used to make one
    // <blockquote> PER LINE: the reply in thread 74a2b95f imported as ten of
    // them, four empty, with "Cheers," and "Chris" in two different ones, and
    // a quoted "## heading" arrived as the literal text "## heading"
    // (a verifier's probe, 2026-09-23). The chat now puts every draft in a
    // quote block, so this stopped being an edge case.
    if (trimmed.charAt(0) === ">") {
      flushPara(); closeList();
      const marker = depth < MAX_QUOTE_DEPTH ? /^\s*>\s?/ : /^\s*(?:>\s?)+/;
      const body: string[] = [];
      let open = false;
      while (i < lines.length) {
        const t = lines[i].trim();
        if (t.charAt(0) === ">") {
          const inner = lines[i].replace(marker, "");
          body.push(inner);
          open = inner.trim() !== "" && !STARTS_BLOCK.test(inner.trim());
        } else if (open && t !== "" && !STARTS_BLOCK.test(t)) {
          body.push(t);
        } else {
          break;
        }
        i++;
      }
      i--;
      const inner = plainBlocks(body.join("\n").trim(), depth + 1);
      if (inner) out.push(`<blockquote>${inner}</blockquote>`);
      continue;
    }

    closeList();
    para.push(trimmed);
  }
  flushPara();
  closeList();
  return out.join("");
}

/**
 * The one entry point importers use.
 *
 * Decides whether the input is already HTML. The test is a real tag from the
 * kept vocabulary, not merely the presence of "<": prose about "a < b" is not
 * HTML, and treating it as such would strip the sentence.
 */

/**
 * Flatten LAYOUT tables — a table used for two-column page furniture rather
 * than for data — and drop headings the conversion left empty.
 *
 * Both defects came from one real .docx and both were invisible until the
 * scores were read closely.
 *
 * LAYOUT TABLES. Word writers routinely set a definition box or a row of
 * contributor cards as a table. The parser ranks a table row ABOVE a heading,
 * so a heading inside a cell never opens its own block: on the founder's
 * import, seven of nineteen headings — including "What is MAXtect?", the one
 * question-shaped heading in the piece — were absorbed into table rows and
 * were invisible to every heading criterion. unwrapTemplateTable above already
 * handles the house Google-Docs template for exactly this reason; it declines
 * a Word layout table because there is no label column to recognise. The test
 * here is different and simpler: a table whose cells contain HEADINGS is
 * carrying document structure, not data. A real data table has headings in
 * neither its cells nor its header row, so it is left alone.
 *
 * EMPTY HEADINGS. A Word paragraph styled as a heading that holds only an
 * image converts to a heading with no text once the image is lifted out.
 * Four arrived in that draft. They render as blank gaps, and page-audit's
 * own H1 regex counts them, so a document with one real H1 reported nine.
 */
export function unwrapLayoutTables(html: string): string {
  let out = html.replace(/<table\b[^>]*>([\s\S]*?)<\/table\s*>/gi, (whole, inner) => {
    if (!/<h[1-6]\b/i.test(inner)) return whole;      // a data table: untouched
    // Cell boundaries become block boundaries; everything else is already
    // block-level markup the sanitiser knows.
    return inner
      .replace(/<\/(td|th)\s*>/gi, " ")
      .replace(/<(td|th)\b[^>]*>/gi, " ")
      .replace(/<\/?(thead|tbody|tfoot|tr|colgroup|col)\b[^>]*>/gi, " ");
  });
  // Word bookmark anchors. A .docx is full of <a id="_bedn2swudz4f"></a>
  // targets; the sanitiser strips the id and leaves <a></a> behind. They are
  // invisible, but they are why the emptiness test below cannot be a regex
  // listing the whitespace it tolerates — the first version of this checked
  // for /<h1>(\s|<br>|&nbsp;)*<\/h1>/, found nothing, and reported success
  // while four blank headings sat in the document as <h1><a></a></h1>.
  out = out.replace(/<a>\s*<\/a>/gi, "");

  // Headings and paragraphs the conversion emptied, judged on TEXT CONTENT
  // rather than on a list of permitted filler. A Word paragraph styled as a
  // heading that held only an image becomes a textless heading once the image
  // is lifted; four arrived in the founder's document. They render as blank
  // gaps and page-audit's own H1 regex counts them.
  //
  // The empty PARAGRAPH case is not cosmetic either: one landed between
  // "What is MAXtect?" and the sentence answering it, and the heading-answer
  // criterion reads the block FOLLOWING a question heading — so the piece
  // scored zero for failing to answer a question it answers immediately.
  out = out.replace(/<(h[1-6]|p)\b[^>]*>([\s\S]*?)<\/\1\s*>/gi, (whole, _tag, inner) => {
    const hasText = inner.replace(/<[^>]+>/g, "").replace(/&nbsp;/gi, " ").trim().length > 0;
    // A block holding ONLY a figure has no text and is emphatically not empty.
    // Deleting on the text test alone removed every image in the document —
    // twelve of them — because Word wraps each one in its own paragraph.
    const hasMedia = /<(img|iframe|video)\b/i.test(inner);
    return hasText || hasMedia ? whole : "";
  });
  return out;
}

/**
 * A chat answer as the text a piece starts from ("Start writing").
 *
 * Two chat conventions come off at the door, because the studio is not the
 * chat. Citation tokens are how the chat numbers its sources. Image markdown
 * points at /api/media, which the editor cannot resolve and the export path
 * deliberately skips.
 *
 * And the quote block. In the chat it is not a quotation: it is the frame the
 * prompt tells every model to put a draft in, so the renderer can draw it as
 * a draft with its own Copy button. Brought into a document as a quotation,
 * the draft is misread — the studio's parser takes a <blockquote>'s prose as
 * a pull-quote, not as the body, and every paragraph of a quoted draft
 * merges into one "quote" block for the rubric to score. So the markers go,
 * and the draft arrives as it would have before drafts were framed. The
 * marker is the chat's own definition (stripQuoteMarkers), fenced code
 * included in what it leaves alone. The cost, accepted: an older reply that
 * quoted a source imports that quotation as a paragraph.
 */
export function chatAnswerToImportText(raw: string): string {
  const stripped = raw
    .replace(/\[__CITE_\d+__\]/g, "")
    .replace(/!\[[^\]]*\]\([^)]*\)/g, "");
  return stripQuoteMarkers(stripped).replace(/\n{3,}/g, "\n\n").trim();
}

export function toEditorHtml(content: string, contentIsHtml?: boolean): string {
  const s = content || "";
  if (!s.trim()) return "";
  return importsAsPlainText(s, contentIsHtml) ? plainTextToHtml(s) : sanitizeImportedHtml(s);
}

/**
 * Which door toEditorHtml will send this content through — exported so a
 * caller that must SAY an import could not see the source's headings asks the
 * same question the conversion answers, rather than re-deriving it and
 * drifting. A plain-text import is one whose headings, if it had any, were
 * lost before this code ran: plainTextToHtml marks only what the text marks.
 */
export function importsAsPlainText(content: string, contentIsHtml?: boolean): boolean {
  if (contentIsHtml === true) return false;
  if (contentIsHtml === false) return true;
  return !/<(p|div|h[1-6]|ul|ol|li|table|span|br|strong|em|b|i|a)\b[^>]*>/i.test(content || "");
}
