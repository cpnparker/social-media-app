"use client";

import { useState } from "react";
import { User, Bot, FileText, ExternalLink, ChevronDown, ChevronUp } from "lucide-react";
import { cn } from "@/lib/utils";
import DOMPurify from "dompurify";
import type { Attachment } from "@/lib/types/ai";
import { getModelLabel } from "@/lib/ai/models";

interface MessageBubbleProps {
  role: "user" | "assistant" | "system";
  content: string;
  model?: string | null;
  isStreaming?: boolean;
  attachments?: Attachment[] | null;
  userName?: string | null;
}

interface ParsedSource {
  number: number;
  url: string;
  title: string;
  domain: string;
  favicon: string;
}

export default function MessageBubble({
  role,
  content,
  model,
  isStreaming,
  attachments,
  userName,
}: MessageBubbleProps) {
  const isUser = role === "user";
  const [sourcesExpanded, setSourcesExpanded] = useState(true);
  const [hoveredSource, setHoveredSource] = useState<number | null>(null);

  const formatSize = (bytes: number) => {
    if (bytes < 1024) return `${bytes}B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)}KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)}MB`;
  };

  const isImage = (type: string) => type.startsWith("image/");

  // Parse sources from AI content (only for assistant messages)
  const { cleanContent, sources } = !isUser
    ? parseSourcesFromContent(content)
    : { cleanContent: content, sources: [] };

  return (
    <div
      className={cn(
        "flex gap-2 md:gap-3 px-3 md:px-4 py-3",
        isUser ? "justify-end" : "justify-start"
      )}
    >
      {!isUser && (
        <div className="shrink-0 h-7 w-7 rounded-full bg-foreground/[0.06] flex items-center justify-center mt-0.5">
          <Bot className="h-3.5 w-3.5 text-foreground/50" />
        </div>
      )}
      <div
        className={cn(
          "max-w-[90%] md:max-w-[80%] rounded-xl text-[15px]",
          isUser
            ? "bg-[#f0f0f0] dark:bg-[#2a2a2a] text-foreground px-4 py-2.5"
            : "bg-transparent"
        )}
      >
        {/* Attachments */}
        {attachments && attachments.length > 0 && (
          <div className="mb-2 space-y-2">
            {attachments.filter((a) => isImage(a.type)).length > 0 && (
              <div className="flex flex-wrap gap-2">
                {attachments
                  .filter((a) => isImage(a.type))
                  .map((att, i) => (
                    <a
                      key={`img-${i}`}
                      href={att.url}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="block"
                    >
                      <img
                        src={att.url}
                        alt={att.name}
                        className="max-h-48 rounded-lg object-cover hover:opacity-90 transition-opacity"
                      />
                    </a>
                  ))}
              </div>
            )}
            {attachments.filter((a) => !isImage(a.type)).length > 0 && (
              <div className="flex flex-wrap gap-1.5">
                {attachments
                  .filter((a) => !isImage(a.type))
                  .map((att, i) => (
                    <a
                      key={`doc-${i}`}
                      href={att.url}
                      target="_blank"
                      rel="noopener noreferrer"
                      className={cn(
                        "flex items-center gap-1.5 rounded-md px-2.5 py-1.5 text-xs transition-colors",
                        isUser
                          ? "bg-foreground/[0.06] hover:bg-foreground/[0.1] text-foreground"
                          : "bg-background hover:bg-background/80 border"
                      )}
                    >
                      <FileText className="h-3.5 w-3.5 shrink-0" />
                      <span className="truncate max-w-[140px]">{att.name}</span>
                      <span className="opacity-60 shrink-0">{formatSize(att.size)}</span>
                    </a>
                  ))}
              </div>
            )}
          </div>
        )}

        {isUser ? (
          content ? <p className="whitespace-pre-wrap leading-relaxed">{content}</p> : null
        ) : (
          <div
            className="ai-response"
            dangerouslySetInnerHTML={{
              __html: DOMPurify.sanitize(formatMarkdown(cleanContent, sources), {
                ADD_ATTR: ['target', 'rel', 'data-source-num', 'loading'],
              }),
            }}
          />
        )}
        {isStreaming && (
          <span className="inline-block w-1.5 h-4 bg-foreground/60 animate-pulse ml-0.5 rounded-sm" />
        )}

        {/* Sources panel */}
        {!isUser && sources.length > 0 && !isStreaming && (
          <div className="mt-4 pt-3 border-t border-border/40">
            <button
              onClick={() => setSourcesExpanded(!sourcesExpanded)}
              className="flex items-center gap-1.5 text-[11px] font-medium text-muted-foreground hover:text-foreground transition-colors mb-2"
            >
              <span>{sources.length} source{sources.length !== 1 ? "s" : ""}</span>
              {sourcesExpanded ? (
                <ChevronUp className="h-3 w-3" />
              ) : (
                <ChevronDown className="h-3 w-3" />
              )}
            </button>
            {sourcesExpanded && (
              <div className="flex flex-wrap gap-1.5">
                {sources.map((src) => (
                  <a
                    key={src.number}
                    href={src.url}
                    target="_blank"
                    rel="noopener noreferrer"
                    onMouseEnter={() => setHoveredSource(src.number)}
                    onMouseLeave={() => setHoveredSource(null)}
                    className="relative group flex items-center gap-1.5 rounded-lg border bg-background/80 hover:bg-background hover:border-foreground/20 px-2.5 py-1.5 text-[11px] transition-all hover:shadow-sm max-w-[220px]"
                  >
                    <img
                      src={src.favicon}
                      alt=""
                      className="h-3.5 w-3.5 rounded-sm shrink-0"
                      onError={(e) => {
                        (e.target as HTMLImageElement).style.display = "none";
                      }}
                    />
                    <span className="truncate text-muted-foreground group-hover:text-foreground transition-colors">
                      {src.title || src.domain}
                    </span>
                    <span className="shrink-0 text-[9px] font-medium bg-foreground/[0.07] text-muted-foreground rounded-full h-4 min-w-[16px] flex items-center justify-center px-1">
                      {src.number}
                    </span>
                    <ExternalLink className="h-2.5 w-2.5 shrink-0 text-muted-foreground/40 group-hover:text-foreground transition-colors" />
                    {hoveredSource === src.number && (
                      <div className="absolute bottom-full left-0 mb-1.5 z-50 pointer-events-none">
                        <div className="bg-popover text-popover-foreground border shadow-lg rounded-lg px-3 py-2 text-[10px] max-w-[300px]">
                          <p className="font-medium truncate">{src.title || src.domain}</p>
                          <p className="text-muted-foreground truncate mt-0.5">{src.url}</p>
                        </div>
                      </div>
                    )}
                  </a>
                ))}
              </div>
            )}
          </div>
        )}

        {!isUser && model && !isStreaming && (
          <p className="text-[10px] text-muted-foreground/60 mt-2">
            {getModelLabel(model)}
          </p>
        )}
      </div>
      {isUser && (
        <div className="shrink-0 flex flex-col items-center gap-0.5 mt-0.5">
          <div className="h-7 w-7 rounded-full bg-foreground/[0.08] flex items-center justify-center">
            <User className="h-3.5 w-3.5 text-muted-foreground" />
          </div>
          {userName && (
            <span className="text-[9px] text-muted-foreground/50 max-w-[4rem] truncate leading-none">
              {userName.split(" ")[0]}
            </span>
          )}
        </div>
      )}
    </div>
  );
}

/* ─── Source extraction ─── */

function getDomain(url: string): string {
  try {
    const host = new URL(url).hostname.replace(/^www\./, "");
    return host;
  } catch {
    return url;
  }
}

function getFavicon(url: string): string {
  try {
    const origin = new URL(url).origin;
    return `${origin}/favicon.ico`;
  } catch {
    return "";
  }
}

function getTitleFromUrl(url: string): string {
  const domain = getDomain(url);
  const parts = domain.split(".");
  if (parts.length >= 2) {
    return parts[parts.length - 2];
  }
  return domain;
}

function parseSourcesFromContent(content: string): {
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
        let tableHtml = '<div class="ai-table-wrap"><table class="ai-table"><thead><tr>';
        for (const cell of headerCells) {
          tableHtml += `<th>${applyInlineFormatting(cell, sources)}</th>`;
        }
        tableHtml += "</tr></thead><tbody>";

        for (const row of dataLines) {
          const cells = parseRow(row);
          tableHtml += "<tr>";
          for (const cell of cells) {
            tableHtml += `<td>${applyInlineFormatting(cell, sources)}</td>`;
          }
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
function formatMarkdown(text: string, sources: ParsedSource[] = []): string {
  if (!text) return "";

  let html = text;

  // Code blocks (extract before escaping & to avoid double-escape)
  html = html.replace(
    /```(\w*)\n?([\s\S]*?)```/g,
    (_m, lang, code) =>
      `<pre class="ai-code-block"><code>${escapeHtml(code.replace(/\n$/, ""))}</code></pre>`
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

  // Images ![alt](url) — render as full-width inline images
  // Use a replacer function to HTML-escape the alt text (prompts can contain quotes)
  html = html.replace(
    /!\[([^\]]*)\]\((https?:\/\/[^)]+)\)/g,
    (_m, alt, url) =>
      `<div class="ai-generated-image-wrap my-3"><a href="${url}" target="_blank" rel="noopener"><img src="${url}" alt="${escapeHtml(alt)}" class="ai-generated-image rounded-lg max-w-full" loading="lazy" /></a></div>`
  );

  // Links [text](url)
  html = html.replace(
    /\[([^\]]+)\]\((https?:\/\/[^)]+)\)/g,
    '<a href="$2" target="_blank" rel="noopener" class="ai-link">$1</a>'
  );

  // Plain URLs (skip URLs already inside href="", src="", or ">...)
  html = html.replace(
    /(?<!href="|src="|">)(https?:\/\/[^\s<)\]"]+)/g,
    '<a href="$1" target="_blank" rel="noopener" class="ai-link break-all">$1</a>'
  );

  // Citation badges
  html = html.replace(
    /\[__CITE_(\d+)__\]/g,
    (_match, num) => {
      const n = parseInt(num, 10);
      const source = sources.find((s) => s.number === n);
      if (!source) return "";
      return `<a href="${source.url}" target="_blank" rel="noopener" data-source-num="${n}" class="ai-cite" title="${source.domain}">${n}</a>`;
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
      return `<a href="${source.url}" target="_blank" rel="noopener" data-source-num="${n}" class="ai-cite" title="${source.domain}">${n}</a>`;
    }
  );
  return html;
}

function escapeHtml(str: string): string {
  return str
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}
