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
        <div className="shrink-0 h-7 w-7 rounded-full bg-primary/10 flex items-center justify-center mt-0.5">
          <Bot className="h-3.5 w-3.5 text-primary" />
        </div>
      )}
      <div
        className={cn(
          "max-w-[90%] md:max-w-[80%] rounded-xl px-4 py-2.5 text-sm leading-relaxed",
          isUser
            ? "bg-primary text-primary-foreground"
            : "bg-muted"
        )}
      >
        {/* Attachments */}
        {attachments && attachments.length > 0 && (
          <div className="mb-2 space-y-2">
            {/* Image attachments */}
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

            {/* Document attachments */}
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
                          ? "bg-primary-foreground/15 hover:bg-primary-foreground/25 text-primary-foreground"
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
          content ? <p className="whitespace-pre-wrap">{content}</p> : null
        ) : (
          <div
            className="prose prose-sm dark:prose-invert max-w-none [&_p]:mb-2 [&_p:last-child]:mb-0 [&_ul]:mb-2 [&_ol]:mb-2 [&_h1]:text-base [&_h2]:text-sm [&_h3]:text-sm [&_pre]:bg-background/50 [&_code]:text-xs"
            dangerouslySetInnerHTML={{
              __html: DOMPurify.sanitize(formatMarkdown(cleanContent, sources), {
                ADD_ATTR: ['target', 'rel', 'data-source-num'],
              }),
            }}
          />
        )}
        {isStreaming && (
          <span className="inline-block w-1.5 h-4 bg-foreground/60 animate-pulse ml-0.5 rounded-sm" />
        )}

        {/* Sources panel — Perplexity style */}
        {!isUser && sources.length > 0 && !isStreaming && (
          <div className="mt-3 pt-3 border-t border-foreground/5">
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
                    className="relative group flex items-center gap-1.5 rounded-lg border bg-background/80 hover:bg-background hover:border-primary/30 px-2.5 py-1.5 text-[11px] transition-all hover:shadow-sm max-w-[220px]"
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
                    <span className="shrink-0 text-[9px] font-medium bg-primary/10 text-primary rounded-full h-4 min-w-[16px] flex items-center justify-center px-1">
                      {src.number}
                    </span>
                    <ExternalLink className="h-2.5 w-2.5 shrink-0 text-muted-foreground/40 group-hover:text-primary transition-colors" />

                    {/* Hover tooltip with full URL */}
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
          <p className="text-xs md:text-[10px] text-muted-foreground mt-1.5 opacity-60">
            {getModelLabel(model)}
          </p>
        )}
      </div>
      {isUser && (
        <div className="shrink-0 h-7 w-7 rounded-full bg-primary flex items-center justify-center mt-0.5">
          <User className="h-3.5 w-3.5 text-primary-foreground" />
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
  // Strip TLD for cleaner display
  const parts = domain.split(".");
  if (parts.length >= 2) {
    return parts[parts.length - 2]; // e.g. "reuters" from "reuters.com"
  }
  return domain;
}

/**
 * Parse web search sources and inline citations from AI response content.
 * Handles multiple formats:
 *   - Grok: [[1]](url), [[2]](url) inline + sometimes a Sources section
 *   - Claude: [Source Title](url) inline + sometimes numbered [1], [2]
 *   - Plain URLs: https://... in text
 */
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

  // Remove trailing "Sources:", "References:" section entirely (we build our own)
  cleaned = cleaned.replace(
    /\n+(#{1,3}\s*)?(Sources|References|Citations)\s*:?\s*\n([\s\S]*?)$/i,
    (match) => {
      // Parse URLs from the sources section to include them
      const urlPattern = /https?:\/\/[^\s)\]]+/g;
      let urlMatch;
      while ((urlMatch = urlPattern.exec(match)) !== null) {
        addSource(urlMatch[0]);
      }
      return ""; // Remove the section from display
    }
  );

  // Pattern 1: [[N]](url) — Grok style
  cleaned = cleaned.replace(
    /\[\[(\d+)\]\]\((https?:\/\/[^)]+)\)/g,
    (_match, _num, url) => {
      const srcNum = addSource(url);
      return `[__CITE_${srcNum}__]`;
    }
  );

  // Pattern 2: [N](url) — numbered link
  cleaned = cleaned.replace(
    /\[(\d+)\]\((https?:\/\/[^)]+)\)/g,
    (_match, _num, url) => {
      const srcNum = addSource(url);
      return `[__CITE_${srcNum}__]`;
    }
  );

  // Pattern 3: [Title](url) — named markdown links → keep as links but also track as source
  cleaned = cleaned.replace(
    /\[([^\]]+)\]\((https?:\/\/[^)]+)\)/g,
    (_match, title, url) => {
      const srcNum = addSource(url, title);
      return `[${title}](${url})[__CITE_${srcNum}__]`;
    }
  );

  // Pattern 4: Standalone [N] references (without URL — already captured above)
  // Only convert if we have sources with that number
  cleaned = cleaned.replace(/\[(\d+)\](?!\()/g, (_match, num) => {
    const n = parseInt(num, 10);
    if (n > 0 && n < nextNum) {
      return `[__CITE_${n}__]`;
    }
    return _match; // Leave as-is if not a known citation
  });

  return { cleanContent: cleaned, sources };
}

/**
 * Simple markdown → HTML conversion for assistant messages.
 * Handles: **bold**, *italic*, `code`, ```code blocks```, headings, lists, links, citations.
 */
function formatMarkdown(text: string, sources: ParsedSource[] = []): string {
  if (!text) return "";

  let html = text;

  // Code blocks (```...```)
  html = html.replace(
    /```(\w*)\n?([\s\S]*?)```/g,
    '<pre class="rounded-md p-3 my-2 overflow-x-auto"><code>$2</code></pre>'
  );

  // Inline code
  html = html.replace(/`([^`]+)`/g, '<code class="bg-muted px-1 py-0.5 rounded text-xs">$1</code>');

  // Headings
  html = html.replace(/^### (.+)$/gm, '<h3 class="font-semibold mt-3 mb-1">$1</h3>');
  html = html.replace(/^## (.+)$/gm, '<h2 class="font-semibold mt-3 mb-1">$1</h2>');
  html = html.replace(/^# (.+)$/gm, '<h1 class="font-bold mt-3 mb-1">$1</h1>');

  // Bold and italic
  html = html.replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>");
  html = html.replace(/\*(.+?)\*/g, "<em>$1</em>");

  // Links [text](url)
  html = html.replace(
    /\[([^\]]+)\]\((https?:\/\/[^)]+)\)/g,
    '<a href="$2" target="_blank" rel="noopener" class="text-primary underline hover:text-primary/80 transition-colors">$1</a>'
  );

  // Plain URLs (not already in an href or anchor)
  html = html.replace(
    /(?<!href="|">)(https?:\/\/[^\s<)\]]+)/g,
    '<a href="$1" target="_blank" rel="noopener" class="text-primary underline hover:text-primary/80 transition-colors break-all">$1</a>'
  );

  // Citation badges [__CITE_N__]
  html = html.replace(
    /\[__CITE_(\d+)__\]/g,
    (_match, num) => {
      const n = parseInt(num, 10);
      const source = sources.find((s) => s.number === n);
      if (!source) return "";
      return `<a href="${source.url}" target="_blank" rel="noopener" data-source-num="${n}" class="inline-flex items-center justify-center h-4 min-w-[16px] px-1 text-[9px] font-semibold bg-primary/10 text-primary rounded-full hover:bg-primary/20 transition-colors no-underline align-super ml-0.5 cursor-pointer" title="${source.domain}">${n}</a>`;
    }
  );

  // Unordered lists
  html = html.replace(/^[*-] (.+)$/gm, "<li>$1</li>");
  html = html.replace(/(<li>.*<\/li>\n?)+/g, '<ul class="list-disc pl-4">$&</ul>');

  // Ordered lists
  html = html.replace(/^\d+\. (.+)$/gm, "<li>$1</li>");

  // Paragraphs (double newlines)
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
        trimmed.startsWith("<li")
      ) {
        return trimmed;
      }
      return `<p>${trimmed.replace(/\n/g, "<br/>")}</p>`;
    })
    .join("\n");

  return html;
}
