/**
 * The chat markdown pipeline: model text in, HTML out.
 *
 * Lifted out of MessageBubble so it can be driven without a browser and
 * without React. It is pure string work — the component still owns the
 * sanitise and the innerHTML write, which is where the trust boundary is.
 * scripts/verify-chat-wrapping.ts renders these functions over fixtures and
 * measures the result in a real Chrome; a hand-written approximation of this
 * output would only prove the approximation wraps.
 */

export interface ParsedSource {
  number: number;
  url: string;
  title: string;
  domain: string;
  favicon: string;
}

function getDomain(url: string): string {
  try {
    const host = new URL(url).hostname.replace(/^www\./, "");
    return host;
  } catch {
    return url;
  }
}

function getFavicon(_url: string): string {
  // Deliberately returns nothing. This used to be `${origin}/favicon.ico`,
  // which made the browser fetch an attacker-chosen origin for every URL the
  // model emitted — a zero-click beacon that fired for anyone who opened the
  // thread, and one the server-side link strip cannot prevent (it is skipped
  // entirely while web search is on, so citations survive). The domain name
  // is already shown next to each source and carries the same information.
  return "";
}

function getTitleFromUrl(url: string): string {
  const domain = getDomain(url);
  const parts = domain.split(".");
  if (parts.length >= 2) {
    return parts[parts.length - 2];
  }
  return domain;
}

export function parseSourcesFromContent(content: string): {
  cleanContent: string;
  sources: ParsedSource[];
} {
  if (!content) return { cleanContent: "", sources: [] };

  const sources: ParsedSource[] = [];
  const urlToNumber = new Map<string, number>();
  let nextNum = 1;

  function addSource(url: string, title?: string): number {
    const existing = urlToNumber.get(url);
    if (existing !== undefined) return existing;
    const num = nextNum++;
    urlToNumber.set(url, num);
    sources.push({
      number: num,
      url,
      title: title || getTitleFromUrl(url),
      domain: getDomain(url),
      favicon: getFavicon(url),
    });
    return num;
  }

  let cleaned = content;

  // Remove trailing sources section
  cleaned = cleaned.replace(
    /\n+(#{1,3}\s*)?(Sources|References|Citations)\s*:?\s*\n([\s\S]*?)$/i,
    (match) => {
      const urlPattern = /https?:\/\/[^\s)\]]+/g;
      let urlMatch;
      while ((urlMatch = urlPattern.exec(match)) !== null) {
        addSource(urlMatch[0]);
      }
      return "";
    }
  );

  // [[N]](url) — Grok
  cleaned = cleaned.replace(
    /\[\[(\d+)\]\]\((https?:\/\/[^)]+)\)/g,
    (_match, _num, url) => {
      const srcNum = addSource(url);
      return `[__CITE_${srcNum}__]`;
    }
  );

  // [N](url)
  cleaned = cleaned.replace(
    /\[(\d+)\]\((https?:\/\/[^)]+)\)/g,
    (_match, _num, url) => {
      const srcNum = addSource(url);
      return `[__CITE_${srcNum}__]`;
    }
  );

  // [Title](url) — skip image markdown (![alt](url))
  cleaned = cleaned.replace(
    /(?<!!)\[([^\]]+)\]\((https?:\/\/[^)]+)\)/g,
    (_match, title, url) => {
      const srcNum = addSource(url, title);
      return `[${title}](${url})[__CITE_${srcNum}__]`;
    }
  );

  // Standalone [N]
  cleaned = cleaned.replace(/\[(\d+)\](?!\()/g, (_match, num) => {
    const n = parseInt(num, 10);
    if (n > 0 && n < nextNum) {
      return `[__CITE_${n}__]`;
    }
    return _match;
  });

  return { cleanContent: cleaned, sources };
}

/** Cell text with inline markers removed — a totals row is usually written
 *  **-48,000**, and the asterisks would otherwise make the one row that
 *  matters most read as prose: no alignment, no negative colour. */
function plainCell(cell: string): string {
  return cell.replace(/\*\*/g, "").replace(/`/g, "").replace(/^\*|\*$/g, "").trim();
}

const NUMERIC_CELL = /^[-+(]?\s*(?:CHF|GBP|USD|EUR|£|\$|€)?\s*[\d][\d,.\s]*\s*%?\)?$/i;

function isNumericCell(cell: string): boolean {
  const c = plainCell(cell);
  return c !== "" && NUMERIC_CELL.test(c);
}

/**
 * Line-by-line markdown table detection — more robust than regex.
 * Finds lines starting & ending with | and converts to HTML tables.
 * Tolerates blank lines between table rows (common AI output pattern).
 */
function convertMarkdownTables(html: string, sources: ParsedSource[]): string {
  const lines = html.split('\n');
  const result: string[] = [];
  let i = 0;

  const isTableRow = (line: string) => /^\|.+\|$/.test(line.trim());
  const isSepRow = (line: string) => /^\|[\s\-:|]+\|$/.test(line.trim());

  while (i < lines.length) {
    const trimmed = lines[i].trim();
    if (isTableRow(trimmed)) {
      // Collect table rows, skipping blank lines between them
      const tableLines: string[] = [trimmed];
      let j = i + 1;
      while (j < lines.length) {
        const next = lines[j].trim();
        if (isTableRow(next)) {
          tableLines.push(next);
          j++;
        } else if (next === "" && j + 1 < lines.length && isTableRow(lines[j + 1].trim())) {
          // Skip single blank line if next non-blank line is a table row
          j++;
        } else {
          break;
        }
      }

      if (tableLines.length >= 2) {
        // Filter out separator rows and identify header
        const sepIdx = tableLines.findIndex((l) => isSepRow(l));
        let headerLine: string;
        let dataLines: string[];

        if (sepIdx === 0 && tableLines.length > 1) {
          // First line is separator — use second line as header, rest as data
          headerLine = tableLines[1];
          dataLines = tableLines.slice(2).filter((l) => !isSepRow(l));
        } else if (sepIdx > 0) {
          // Normal: header, separator, data
          headerLine = tableLines[0];
          dataLines = tableLines.slice(1).filter((l) => !isSepRow(l));
        } else {
          // No separator found — first line is header, rest are data
          headerLine = tableLines[0];
          dataLines = tableLines.slice(1);
        }

        const parseRow = (row: string) =>
          row.split("|").slice(1, -1).map((cell: string) => cell.trim());

        const headerCells = parseRow(headerLine);
        const dataCells = dataLines.map(parseRow);

        // Decide alignment per column from the BODY, so a figures column stays
        // right-aligned even when one cell reads "n/a" — and so a table of
        // prose is left untouched. A totals row is usually written **-48,000**,
        // hence stripping the markers before testing.
        const colCount = Math.max(headerCells.length, ...dataCells.map((r) => r.length), 0);
        const numericCol: boolean[] = [];
        for (let c = 0; c < colCount; c++) {
          const vals = dataCells
            .map((r) => plainCell(r[c] ?? ""))
            .filter((v) => v !== "" && v !== "—" && v !== "-" && v !== "–");
          numericCol[c] =
            c > 0 && vals.length > 0 && vals.filter(isNumericCell).length >= Math.ceil(vals.length / 2);
        }

        // Only a table with real figures gets the content-sized treatment; a
        // table of prose must wrap instead of scrolling sideways.
        const hasFigures = numericCol.some(Boolean);

        // When one column holds long prose it takes the slack, and the short
        // label columns beside it get squeezed until "Audit Committee Chair"
        // breaks over three lines. Keep short columns on one line so the long
        // one absorbs the wrapping — but only when there IS a long column to
        // absorb it, or a wide table of medium cells would overflow.
        const colLen: number[] = [];
        for (let c = 0; c < colCount; c++) {
          colLen[c] = Math.max(
            plainCell(headerCells[c] ?? "").length,
            ...dataCells.map((r) => plainCell(r[c] ?? "").length),
            0
          );
        }
        const hasLongCol = colLen.some((l) => l > 40);
        const tightCol = colLen.map((l) => hasLongCol && l <= 24);
        let tableHtml =
          `<div class="ai-table-wrap"><table class="ai-table${hasFigures ? " ai-table-figures" : ""}"><thead><tr>`;
        headerCells.forEach((cell, c) => {
          const hc = [numericCol[c] ? "ai-num" : "", tightCol[c] ? "ai-tight" : ""].filter(Boolean).join(" ");
          tableHtml += `<th${hc ? ` class="${hc}"` : ""}>${applyInlineFormatting(cell, sources)}</th>`;
        });
        tableHtml += "</tr></thead><tbody>";

        for (const cells of dataCells) {
          const isTotal = /^\*\*.+\*\*$/.test((cells[0] ?? "").trim());
          tableHtml += isTotal ? '<tr class="ai-total">' : "<tr>";
          cells.forEach((cell, c) => {
            const bare = plainCell(cell);
            const cls = [
              numericCol[c] ? "ai-num" : "",
              tightCol[c] ? "ai-tight" : "",
              numericCol[c] && isNumericCell(bare) && /^[-(]/.test(bare) ? "ai-neg" : "",
            ].filter(Boolean).join(" ");
            tableHtml += `<td${cls ? ` class="${cls}"` : ""}>${applyInlineFormatting(cell, sources)}</td>`;
          });
          tableHtml += "</tr>";
        }
        tableHtml += "</tbody></table></div>";
        result.push(tableHtml);
        i = j;
      } else {
        result.push(lines[i]);
        i++;
      }
    } else {
      result.push(lines[i]);
      i++;
    }
  }

  return result.join('\n');
}

/**
 * Markdown → HTML with proper table support, typography, and structure.
 */
export function formatMarkdown(text: string, sources: ParsedSource[] = []): string {
  if (!text) return "";

  let html = text;

  // Code blocks — two modes:
  // 1. With a language tag (```python, ```js, etc.) → actual code, escape HTML
  // 2. Without a language tag (```) → draft content (social post, caption, email)
  //    Render as a styled content card with formatting preserved.
  html = html.replace(
    /```(\w*)\n?([\s\S]*?)```/g,
    (_m, lang, code) => {
      const trimmed = code.replace(/\n$/, "");
      if (lang) {
        // Real code block — escape and render as <pre>, with a language badge
        // and a copy button (handled via delegated click on the container).
        return `<div class="ai-code-wrap"><div class="ai-code-bar"><span class="ai-code-lang">${escapeHtml(lang)}</span><button type="button" class="ai-code-copy" data-code-copy>Copy</button></div><pre class="ai-code-block"><code>${escapeHtml(trimmed)}</code></pre></div>`;
      }
      // Draft content card — preserve formatting so hashtags, [Embed], etc. get styled.
      // We use a sentinel class and process inline formatting later (after the main pipeline).
      return `<div class="ai-content-card">${trimmed}</div>`;
    }
  );

  // Inline code (before other inline formatting)
  html = html.replace(/`([^`]+)`/g, (_m, code) =>
    `<code class="ai-inline-code">${escapeHtml(code)}</code>`
  );

  // Escape bare & in remaining text (not inside already-processed code blocks)
  // Avoids browser misinterpreting "e&'s" as a malformed HTML entity
  html = html.replace(/&(?!amp;|lt;|gt;|quot;|#\d+;|#x[\da-fA-F]+;)/g, "&amp;");

  // Tables — line-by-line detection (handles edge cases the regex misses)
  html = convertMarkdownTables(html, sources);

  // Headings
  html = html.replace(/^#### (.+)$/gm, '<h4 class="ai-h4">$1</h4>');
  html = html.replace(/^### (.+)$/gm, '<h3 class="ai-h3">$1</h3>');
  html = html.replace(/^## (.+)$/gm, '<h2 class="ai-h2">$1</h2>');
  html = html.replace(/^# (.+)$/gm, '<h1 class="ai-h1">$1</h1>');

  // Horizontal rules
  html = html.replace(/^---+$/gm, '<hr class="ai-hr" />');

  // Bold and italic
  html = html.replace(/\*\*\*(.+?)\*\*\*/g, "<strong><em>$1</em></strong>");
  html = html.replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>");
  html = html.replace(/(?<!\*)\*([^*]+?)\*(?!\*)/g, "<em>$1</em>");

  // Images ![alt](url) — render as full-width inline images.
  //
  // SECURITY: the host allowlist lives HERE, in the renderer, not only in the
  // server's post-stream scrub. Tokens are painted as they stream, so by the
  // time the server rewrites the final text the browser has already issued the
  // request — which is a zero-click exfiltration channel when the reply was
  // built from attacker-controlled content (an email body, a shared Drive
  // doc). Only our own media proxy and blob host may become an <img>;
  // anything else renders as inert text so the user can still see what was
  // suggested.
  html = html.replace(
    /!\[([^\]]*)\]\(([^)\s]+)\)/g,
    (_m, alt, url) => {
      const u = String(url);
      const allowed =
        u.startsWith("/api/media/") ||
        /^https?:\/\/[a-z0-9-]+\.public\.blob\.vercel-storage\.com\//i.test(u) ||
        /^https?:\/\/[a-z0-9-]+\.blob\.vercel-storage\.com\//i.test(u);
      if (!allowed) {
        console.warn("[MessageBubble] blocked non-allowlisted image host:", u.slice(0, 80));
        return `<span class="text-muted-foreground/60 text-xs">[image from an untrusted source was not loaded]</span>`;
      }
      return `<div class="ai-generated-image-wrap my-3"><a href="${u}" target="_blank" rel="noopener"><img src="${u}" alt="${escapeHtml(alt)}" class="ai-generated-image rounded-lg max-w-full" loading="lazy" data-retry-src="${u}" /></a></div>`;
    }
  );

  // Strip any remaining image markdown with non-matching URLs (model-fabricated)
  // These have invalid/partial URLs and would otherwise show as raw text
  html = html.replace(/!\[([^\]]*)\]\([^)]+\)/g, "");

  // Document download cards — render 📄 [Download filename.pptx](/api/media/...) as styled download buttons
  html = html.replace(
    /📄\s*\[Download ([^\]]+)\]\((\/api\/media\/[^)]+)\)/g,
    (_m, filename, url) =>
      `<a href="${url}" download="${escapeHtml(filename)}" class="ai-download-card"><span class="ai-download-icon">📄</span><span class="ai-download-info"><span class="ai-download-name">${escapeHtml(filename)}</span><span class="ai-download-action">Click to download</span></span></a>`
  );

  // Links [text](url)
  html = html.replace(
    /\[([^\]]+)\]\((https?:\/\/[^)]+)\)/g,
    '<a href="$2" target="_blank" rel="noopener" class="ai-link">$1</a>'
  );

  // Also handle download links without the emoji prefix (fallback).
  // Extension list, not a bare .pptx: a .docx link that misses both card
  // regexes is not rendered at all — the generic link rule below only matches
  // absolute http(s) URLs, so a relative /api/media/ link survives as literal
  // markdown text and the user sees "[Download Report.docx](/api/media/...)".
  html = html.replace(
    /\[Download ([^\]]+\.(?:pptx|docx|xlsx|pdf|csv))\]\((\/api\/media\/[^)]+)\)/g,
    (_m, filename, url) =>
      `<a href="${url}" download="${escapeHtml(filename)}" class="ai-download-card"><span class="ai-download-icon">📄</span><span class="ai-download-info"><span class="ai-download-name">${escapeHtml(filename)}</span><span class="ai-download-action">Click to download</span></span></a>`
  );

  // Plain URLs (skip URLs already inside href="", src="", or ">...)
  //
  // The href is the URL untouched; only the VISIBLE text gets <wbr> — a
  // zero-width break opportunity — after each path separator. The class used
  // to be break-all, which made the line fill to the last pixel and snap the
  // URL mid-word; with the prose rule (overflow-wrap: anywhere) the browser
  // takes these offered breaks first and only cuts inside a segment when one
  // segment alone still does not fit. Same href, same textContent — <wbr>
  // adds no character, so copying the link text still yields the URL.
  //
  // Outside <pre> only. A URL in a shell command is an argument, not a link:
  // linking it put a blue underlined fragment mid-command, and the <wbr> was
  // worse than cosmetic — Chrome honours it under `white-space: pre`, so a
  // one-line command was DISPLAYED folded over three lines while its text
  // stayed 94 characters. The reader cannot see which of those is true.
  html = outsidePre(html, (part) =>
    part.replace(
      /(?<!href="|src="|">)(https?:\/\/[^\s<)\]"]+)/g,
      (_m, url) => `<a href="${url}" target="_blank" rel="noopener" class="ai-link">${breakableUrl(url)}</a>`
    )
  );

  // Citation badges
  html = html.replace(
    /\[__CITE_(\d+)__\]/g,
    (_match, num) => {
      const n = parseInt(num, 10);
      const source = sources.find((s) => s.number === n);
      if (!source) return "";
      return `<a href="${source.url}" target="_blank" rel="noopener" data-source-num="${n}" class="ai-cite" aria-label="Source ${n}: ${source.domain}">${n}</a>`;
    }
  );

  // Media placeholders: [Embed], [Image], [Video], [Carousel], [Infographic], etc.
  html = html.replace(
    /\[(Embed|Image|Video|Carousel|Infographic|Reel|Graphic|GIF|Story|Slide(?:\s*\d+)?|Photo|Banner|Cover|Thumbnail|Animation|Chart|Map|Audio|Podcast|Poll|Quote Card|Meme)\]/gi,
    (_m, label) => {
      const iconMap: Record<string, string> = {
        video: '▶', reel: '▶', gif: '▶', animation: '▶',
        audio: '♪', podcast: '♪',
        image: '◻', photo: '◻', graphic: '◻', banner: '◻',
        cover: '◻', thumbnail: '◻', meme: '◻',
        carousel: '◫', infographic: '◫',
        chart: '◫', map: '◫',
        embed: '⊞', poll: '☐',
        'quote card': '❝',
      };
      const key = label.toLowerCase().replace(/\s*\d+$/, '');
      const icon = iconMap[key] || '⊞';
      return `<div class="ai-media-placeholder"><span class="ai-media-icon">${icon}</span><span>${escapeHtml(label)}</span></div>`;
    }
  );

  // Hashtags: #Word (min 2 chars, starts with letter, not inside tags/URLs)
  html = html.replace(
    /(?<![&\w/])#([A-Za-z]\w{1,})/g,
    '<span class="ai-hashtag">#$1</span>'
  );

  // Ordered lists (handle nested content)
  html = html.replace(/^(\d+)\. (.+)$/gm, '<li class="ai-oli" value="$1">$2</li>');

  // Unordered lists
  html = html.replace(/^[*-] (.+)$/gm, '<li class="ai-uli">$1</li>');

  // Collapse ALL whitespace between consecutive list items to a single newline.
  // AI models often output blank lines between bullets which breaks list grouping.
  html = html.replace(/<\/li>\s+<li /g, "</li>\n<li ");

  // Wrap consecutive list items
  html = html.replace(
    /(<li class="ai-uli">[\s\S]*?<\/li>\n?)+/g,
    '<ul class="ai-ul">$&</ul>'
  );
  html = html.replace(
    /(<li class="ai-oli"[\s\S]*?<\/li>\n?)+/g,
    '<ol class="ai-ol">$&</ol>'
  );

  // Strip newlines inside wrapped lists so paragraph splitter can never break them
  html = html.replace(/<ul class="ai-ul">[\s\S]*?<\/ul>/g, (m) => m.replace(/\n+/g, ""));
  html = html.replace(/<ol class="ai-ol">[\s\S]*?<\/ol>/g, (m) => m.replace(/\n+/g, ""));

  // Content cards: convert internal newlines to <br/> so the card stays as one block.
  // Double newlines become a spacer; single newlines become line breaks.
  html = html.replace(
    /<div class="ai-content-card">([\s\S]*?)<\/div>/g,
    (_m, inner) => {
      const formatted = inner.trim().replace(/\n\n+/g, '<div class="ai-card-spacer"></div>').replace(/\n/g, "<br/>");
      return `<div class="ai-content-card">${formatted}</div>`;
    }
  );

  // Paragraphs
  html = html
    .split(/\n\n+/)
    .map((block) => {
      const trimmed = block.trim();
      if (!trimmed) return "";
      if (
        trimmed.startsWith("<h") ||
        trimmed.startsWith("<pre") ||
        trimmed.startsWith("<ul") ||
        trimmed.startsWith("<ol") ||
        trimmed.startsWith("<li") ||
        trimmed.startsWith("<div") ||
        trimmed.startsWith("<hr") ||
        trimmed.startsWith("<table") ||
        trimmed.startsWith("<img")
      ) {
        return trimmed;
      }
      return `<p class="ai-p">${trimmed.replace(/\n/g, "<br/>")}</p>`;
    })
    .join("\n");

  return html;
}

/** Apply inline formatting only (bold, italic, code, links, citations) */
function applyInlineFormatting(text: string, sources: ParsedSource[] = []): string {
  let html = text;
  html = html.replace(/`([^`]+)`/g, '<code class="ai-inline-code">$1</code>');
  html = html.replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>");
  html = html.replace(/(?<!\*)\*([^*]+?)\*(?!\*)/g, "<em>$1</em>");
  html = html.replace(
    /\[([^\]]+)\]\((https?:\/\/[^)]+)\)/g,
    '<a href="$2" target="_blank" rel="noopener" class="ai-link">$1</a>'
  );
  html = html.replace(
    /\[__CITE_(\d+)__\]/g,
    (_match, num) => {
      const n = parseInt(num, 10);
      const source = sources.find((s) => s.number === n);
      if (!source) return "";
      return `<a href="${source.url}" target="_blank" rel="noopener" data-source-num="${n}" class="ai-cite" aria-label="Source ${n}: ${source.domain}">${n}</a>`;
    }
  );
  return html;
}

/** Run a replace over everything EXCEPT the inside of a <pre> block.
 *
 *  A fenced code block is already HTML by the time the inline passes run, so
 *  a pass that does not say otherwise reaches into it and rewrites the code.
 *  Splitting on the block and skipping the odd entries is the cheap version of
 *  lifting it out to a placeholder; it keeps the block's own position in the
 *  string, which the paragraph splitter below depends on. */
function outsidePre(html: string, fn: (part: string) => string): string {
  const parts = html.split(/(<pre[\s\S]*?<\/pre>)/);
  for (let i = 0; i < parts.length; i += 2) parts[i] = fn(parts[i]);
  return parts.join("");
}

/** Where a URL may be broken: after each path separator, never inside a
 *  percent-escape or a host label. Returned as the pieces between those
 *  points, because the two sides of the conversation need them in different
 *  shapes — the model's HTML joins them with <wbr>, the user's React puts a
 *  <wbr/> element between them — and one definition is what makes the same
 *  URL break in the same places whoever typed it.
 *
 *  `&amp;` is matched as one unit and kept whole: splitting an entity would
 *  print the entity rather than the ampersand. */
export function urlPieces(url: string): string[] {
  const out: string[] = [];
  const re = /(&amp;|[/?#=&_-])/g;
  let last = 0;
  let m: RegExpExecArray | null;
  while ((m = re.exec(url)) !== null) {
    const end = m.index + m[0].length;
    out.push(url.slice(last, end));
    last = end;
  }
  if (last < url.length) out.push(url.slice(last));
  return out.length > 0 ? out : [url];
}

/** Visible link text with a break opportunity after each path separator. */
function breakableUrl(url: string): string {
  return urlPieces(url).join("<wbr>");
}

export interface LinkedPiece {
  /** The href, or null for ordinary text. */
  url: string | null;
  /** The visible text, already split where a break may be offered: one entry
   *  for ordinary text, one per URL segment for a link. */
  segments: string[];
}

/** Plain typed text → links and text, for a surface that renders React nodes
 *  rather than HTML.
 *
 *  The user's message is the one string in the conversation the model never
 *  touched, and it is safe today because React escapes it. So the link
 *  treatment it was missing cannot arrive as HTML — it arrives as pieces the
 *  component turns into nodes, and the trust boundary stays where it is.
 *
 *  The URL pattern is deliberately the same character class as the model-side
 *  pass above, so the same paste is linked over the same span of text on both
 *  sides, trailing full stop and all. */
export function splitLinkedText(text: string): LinkedPiece[] {
  const out: LinkedPiece[] = [];
  const re = /(https?:\/\/[^\s<)\]"]+)/g;
  let last = 0;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null) {
    if (m.index > last) out.push({ url: null, segments: [text.slice(last, m.index)] });
    out.push({ url: m[0], segments: urlPieces(m[0]) });
    last = m.index + m[0].length;
  }
  if (last < text.length) out.push({ url: null, segments: [text.slice(last)] });
  return out;
}

function escapeHtml(str: string): string {
  return str
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}
