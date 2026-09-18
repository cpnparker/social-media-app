/**
 * Getting the finished piece OUT of the studio.
 *
 * The optimiser could import content, score it and edit it, and then the writer
 * was stuck: the only way out was selecting the editor by hand. Two formats
 * cover where this content actually goes — rich text for Google Docs, Word and
 * most CMS editors, and Markdown for publishing pipelines that take it.
 *
 * Pure, synchronous and DOM-free, exactly like lib/optimizer/parse.ts and for
 * the same reason: this runs in the browser, but a converter that needs a DOM
 * cannot be tested with `npx tsx`, and an untested converter in this repo has a
 * track record. `stripTags` once glued "one<br>two" into "onetwo", and the
 * HTML/markdown parity check missed a whole class of bug because its fixture
 * emitted bare <li> where Tiptap only ever emits <li><p>.
 *
 * Tiptap 3 is the only producer of the input, so the tag vocabulary is known
 * and small: h1-h6, p, ul/ol/li (always wrapping a <p>), blockquote, strong/b,
 * em/i, code, a, table/tr/td/th, br, hr. Anything else degrades to its text
 * rather than being dropped.
 */

/** Entities Tiptap round-trips. Ampersand LAST, or &amp;lt; double-decodes. */
function decodeEntities(s: string): string {
  return s
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&");
}

/**
 * Find the matching close of `<tag ...>` starting at an open tag, counting
 * nesting. A non-greedy regex stops at the FIRST close, which turns a list
 * inside a list into two broken halves — and reads as a formatting quirk rather
 * than a bug, so nobody reports it.
 */
function matchBlock(html: string, openStart: number, tag: string): { inner: string; end: number } | null {
  const openRe = new RegExp(`<${tag}(\\s[^>]*)?>`, "gi");
  const closeRe = new RegExp(`</${tag}\\s*>`, "gi");
  const firstOpen = html.slice(openStart).match(new RegExp(`^<${tag}(\\s[^>]*)?>`, "i"));
  if (!firstOpen) return null;
  let depth = 1;
  let cursor = openStart + firstOpen[0].length;
  const innerStart = cursor;
  while (depth > 0) {
    openRe.lastIndex = cursor;
    closeRe.lastIndex = cursor;
    const nextOpen = openRe.exec(html);
    const nextClose = closeRe.exec(html);
    if (!nextClose) return null; // unbalanced; caller falls back to text
    if (nextOpen && nextOpen.index < nextClose.index) {
      depth++;
      cursor = nextOpen.index + nextOpen[0].length;
    } else {
      depth--;
      cursor = nextClose.index + nextClose[0].length;
      if (depth === 0) return { inner: html.slice(innerStart, nextClose.index), end: cursor };
    }
  }
  return null;
}

/** Inline marks only. Never called on anything containing a block tag. */
function inline(html: string): string {
  let s = html;
  s = s.replace(/<br\s*\/?>/gi, "\n");
  s = s.replace(/<(strong|b)(\s[^>]*)?>([\s\S]*?)<\/\1\s*>/gi, (_m, _t, _a, inner) => `**${inline(inner)}**`);
  s = s.replace(/<(em|i)(\s[^>]*)?>([\s\S]*?)<\/\1\s*>/gi, (_m, _t, _a, inner) => `*${inline(inner)}*`);
  s = s.replace(/<code(\s[^>]*)?>([\s\S]*?)<\/code\s*>/gi, (_m, _a, inner) => "`" + inline(inner) + "`");
  s = s.replace(/<s(\s[^>]*)?>([\s\S]*?)<\/s\s*>/gi, (_m, _a, inner) => `~~${inline(inner)}~~`);
  s = s.replace(/<a\s[^>]*href=["']([^"']*)["'][^>]*>([\s\S]*?)<\/a\s*>/gi, (_m, href, inner) => {
    const text = inline(inner).trim();
    // A link whose text IS its href is noise as [x](x); print it once.
    return !text || text === href ? href : `[${text}](${href})`;
  });
  // Anything left: substitute a SPACE, never the empty string. Deleting a tag
  // between two words glues them together, and the join is invisible in the
  // output — it just reads as a typo the writer did not make.
  s = s.replace(/<[^>]+>/g, " ");
  s = decodeEntities(s);
  // Collapse runs of spaces/tabs but keep the newlines <br> produced.
  s = s.replace(/[ \t]{2,}/g, " ").replace(/[ \t]+\n/g, "\n").replace(/\n[ \t]+/g, "\n");
  return s.trim();
}

/** Cells of one <tr>, as already-inlined strings. */
function rowCells(rowHtml: string): string[] {
  const out: string[] = [];
  const re = /<(td|th)(\s[^>]*)?>([\s\S]*?)<\/\1\s*>/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(rowHtml)) !== null) {
    // A cell holds <p>text</p>; strip the paragraph so the text lands in the
    // cell rather than breaking the row across lines.
    out.push(inline(m[3].replace(/<\/?p(\s[^>]*)?>/gi, " ")).replace(/\n+/g, " ").trim());
  }
  return out;
}

/**
 * Convert Tiptap HTML to Markdown.
 *
 * `depth` is the list-nesting level and is set by recursion, not by callers.
 */
export function htmlToMarkdown(html: string, depth = 0): string {
  if (!html) return "";
  const blocks: string[] = [];
  let i = 0;
  const pad = "  ".repeat(depth);

  while (i < html.length) {
    const rest = html.slice(i);

    const heading = rest.match(/^<h([1-6])(\s[^>]*)?>/i);
    if (heading) {
      const found = matchBlock(html, i, `h${heading[1]}`);
      if (found) {
        const text = inline(found.inner);
        if (text) blocks.push(`${"#".repeat(Number(heading[1]))} ${text}`);
        i = found.end;
        continue;
      }
    }

    if (/^<hr\s*\/?>/i.test(rest)) {
      blocks.push("---");
      i += rest.match(/^<hr\s*\/?>/i)![0].length;
      continue;
    }

    if (/^<blockquote(\s[^>]*)?>/i.test(rest)) {
      const found = matchBlock(html, i, "blockquote");
      if (found) {
        const body = htmlToMarkdown(found.inner, depth);
        if (body) {
          blocks.push(
            body
              .split("\n")
              .map((l) => (l ? `> ${l}` : ">"))
              .join("\n")
          );
        }
        i = found.end;
        continue;
      }
    }

    const list = rest.match(/^<(ul|ol)(\s[^>]*)?>/i);
    if (list) {
      const tag = list[1].toLowerCase();
      const found = matchBlock(html, i, tag);
      if (found) {
        const items = listItems(found.inner);
        const lines: string[] = [];
        for (let n = 0; n < items.length; n++) {
          const marker = tag === "ol" ? `${n + 1}.` : "-";
          // An item is its own text plus, possibly, a nested list. Split them:
          // the text goes on the marker's line, the nested list keeps its own
          // indentation from the recursive call.
          const text = htmlToMarkdown(items[n], depth + 1).trim();
          const parts = text.split("\n");
          lines.push(`${pad}${marker} ${parts[0]}`);
          for (let k = 1; k < parts.length; k++) {
            // Blank lines come from the paragraph/list block join and would
            // make this a "loose" list — extra vertical space in every renderer
            // downstream, for a list the writer wrote tight.
            if (!parts[k].trim()) continue;
            // A nested list already carries indentation from the depth+1 call.
            // Re-indenting it would double the pad at every level, so leading
            // whitespace means "leave this alone".
            lines.push(/^\s/.test(parts[k]) ? parts[k] : `${pad}  ${parts[k]}`);
          }
        }
        if (lines.length) blocks.push(lines.join("\n"));
        i = found.end;
        continue;
      }
    }

    if (/^<table(\s[^>]*)?>/i.test(rest)) {
      const found = matchBlock(html, i, "table");
      if (found) {
        const rows: string[][] = [];
        const rowRe = /<tr(\s[^>]*)?>([\s\S]*?)<\/tr\s*>/gi;
        let rm: RegExpExecArray | null;
        while ((rm = rowRe.exec(found.inner)) !== null) rows.push(rowCells(rm[2]));
        if (rows.length) {
          const width = rows[0].length;
          const line = (cells: string[]) => `| ${cells.concat(Array(Math.max(0, width - cells.length)).fill("")).slice(0, width).join(" | ")} |`;
          const out = [line(rows[0]), `| ${Array(width).fill("---").join(" | ")} |`];
          for (let r = 1; r < rows.length; r++) out.push(line(rows[r]));
          blocks.push(out.join("\n"));
        }
        i = found.end;
        continue;
      }
    }

    if (/^<p(\s[^>]*)?>/i.test(rest)) {
      const found = matchBlock(html, i, "p");
      if (found) {
        const text = inline(found.inner);
        if (text) blocks.push(text);
        i = found.end;
        continue;
      }
    }

    // Unrecognised markup, or text sitting outside any block. Take the run up
    // to the next block-level tag and treat it as a paragraph rather than
    // discarding it — losing the writer's words is worse than mis-formatting.
    const nextBlock = rest.slice(1).search(/<(h[1-6]|p|ul|ol|blockquote|table|hr)(\s|>|\/)/i);
    const chunkEnd = nextBlock < 0 ? html.length : i + 1 + nextBlock;
    const chunk = html.slice(i, chunkEnd);
    const text = inline(chunk);
    if (text) blocks.push(text);
    i = chunkEnd;
  }

  return blocks.join("\n\n").replace(/\n{3,}/g, "\n\n").trim();
}

/** Top-level <li> children of one list's inner HTML, in order. */
function listItems(inner: string): string[] {
  const out: string[] = [];
  let i = 0;
  while (i < inner.length) {
    const at = inner.slice(i).search(/<li(\s|>)/i);
    if (at < 0) break;
    const start = i + at;
    const found = matchBlock(inner, start, "li");
    if (!found) break;
    out.push(found.inner);
    i = found.end;
  }
  return out;
}

/**
 * Plain text, block-aware.
 *
 * Used as the text/plain half of a rich-text copy, so that pasting into a
 * plain field gives readable prose rather than one glued line. This is
 * deliberately NOT `textContent`: that concatenates across block boundaries and
 * turns a heading and the paragraph under it into one word.
 */
export function htmlToPlainText(html: string): string {
  return htmlToMarkdown(html)
    .replace(/^#{1,6}\s+/gm, "")
    .replace(/^\s*>\s?/gm, "")
    .replace(/\*\*([\s\S]*?)\*\*/g, "$1")
    .replace(/(^|[^*])\*([^*\n]+)\*/g, "$1$2")
    .replace(/~~([\s\S]*?)~~/g, "$1")
    .replace(/`([^`]*)`/g, "$1")
    .replace(/\[([^\]]*)\]\(([^)]*)\)/g, "$1 ($2)")
    .trim();
}
