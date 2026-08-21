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
 * Pure, synchronous and dependency-free, like the rest of lib/optimizer.
 */

/**
 * Tags Tiptap can represent. Anything else is unwrapped (its children are kept)
 * rather than dropped, because dropping loses the writer's words.
 */
const KEEP = [
  "p", "br", "h1", "h2", "h3", "h4", "h5", "h6",
  "ul", "ol", "li", "blockquote", "pre", "code",
  "strong", "b", "em", "i", "s", "u", "a",
  "table", "thead", "tbody", "tr", "td", "th", "hr",
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
  let s = html || "";

  // Comments first — a comment can contain anything, including "<script>".
  s = s.replace(/<!--[\s\S]*?-->/g, "");

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
    .trim();

  // AFTER normalisation, deliberately. Both transforms pattern-match on tag
  // adjacency, and running them against the pre-collapse form — where every
  // unwrapped tag left a space — made their guards fail quietly on real
  // documents while passing on tidy fixtures. The final form is the only one
  // with a stable shape to match against.
  out = unwrapTemplateTable(out);
  out = promoteBoldLineHeadings(out);
  return out;
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
  const VOID = ["br", "hr"];
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
  const src = (text || "").replace(/\r\n?/g, "\n").trim();
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

    if (trimmed.charAt(0) === ">") {
      flushPara(); closeList();
      out.push(`<blockquote><p>${inlineMarks(escapeHtml(trimmed.replace(/^>\s?/, "")))}</p></blockquote>`);
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
export function toEditorHtml(content: string, contentIsHtml?: boolean): string {
  const s = content || "";
  if (!s.trim()) return "";
  const looksLikeHtml =
    contentIsHtml === true ||
    (contentIsHtml !== false && /<(p|div|h[1-6]|ul|ol|li|table|span|br|strong|em|b|i|a)\b[^>]*>/i.test(s));
  return looksLikeHtml ? sanitizeImportedHtml(s) : plainTextToHtml(s);
}
