"use client";

import { User, Bot, FileText } from "lucide-react";
import { cn } from "@/lib/utils";
import type { Attachment } from "@/lib/types/ai";

interface MessageBubbleProps {
  role: "user" | "assistant" | "system";
  content: string;
  model?: string | null;
  isStreaming?: boolean;
  attachments?: Attachment[] | null;
}

export default function MessageBubble({
  role,
  content,
  model,
  isStreaming,
  attachments,
}: MessageBubbleProps) {
  const isUser = role === "user";

  const formatSize = (bytes: number) => {
    if (bytes < 1024) return `${bytes}B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)}KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)}MB`;
  };

  const isImage = (type: string) => type.startsWith("image/");

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
              __html: formatMarkdown(content),
            }}
          />
        )}
        {isStreaming && (
          <span className="inline-block w-1.5 h-4 bg-foreground/60 animate-pulse ml-0.5 rounded-sm" />
        )}
        {!isUser && model && !isStreaming && (
          <p className="text-xs md:text-[10px] text-muted-foreground mt-1.5 opacity-60">
            {model.includes("grok") ? "Grok" : "Claude"}
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

/**
 * Simple markdown → HTML conversion for assistant messages.
 * Handles: **bold**, *italic*, `code`, ```code blocks```, headings, lists, links.
 */
function formatMarkdown(text: string): string {
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

  // Links
  html = html.replace(
    /\[([^\]]+)\]\(([^)]+)\)/g,
    '<a href="$2" target="_blank" rel="noopener" class="text-primary underline">$1</a>'
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
