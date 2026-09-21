"use client";

import { useState, useEffect, useRef, useMemo, Fragment } from "react";
import SlideLightbox from "./SlideLightbox";
import SlideCommentBox from "./SlideCommentBox";
import { User, Bot, FileText, ExternalLink, ChevronDown, ChevronUp, ShieldCheck, Copy, Check, RotateCcw, Pencil, PenLine, X, ThumbsUp, ThumbsDown, CalendarClock, NotebookPen, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import DOMPurify from "dompurify";
import type { Attachment } from "@/lib/types/ai";
import { getModelLabel } from "@/lib/ai/models";
import ScheduledProposalCard, { type ScheduledProposal } from "./ScheduledProposalCard";
import { toast } from "sonner";
import { saveToNotebook, normaliseSelection } from "@/lib/notebook/client";
import { formatMarkdown, parseSourcesFromContent, splitLinkedText, type ParsedSource } from "@/lib/ai/chat-markdown";

/** A user's own message, with any URL in it rendered as a link that breaks
 *  where the model's copy of the same URL breaks.
 *
 *  Deliberately NOT dangerouslySetInnerHTML: this string is the one thing in
 *  the conversation nothing has processed, and it is safe precisely because
 *  React escapes it. The pieces come from the shared splitter instead, so the
 *  trust boundary stays put and both sides break identically. Before this, a
 *  pasted link broke at its separators when the model quoted it back and
 *  wherever the line happened to run out in the user's own message —
 *  including inside the hostname, which is the part a reader checks. */
function UserText({ text }: { text: string }) {
  const pieces = splitLinkedText(text);
  return (
    <>
      {pieces.map((piece, i) =>
        piece.url === null ? (
          <Fragment key={i}>{piece.segments[0]}</Fragment>
        ) : (
          <a
            key={i}
            href={piece.url}
            target="_blank"
            rel="noopener noreferrer"
            className="ai-link"
          >
            {piece.segments.map((seg, j) => (
              <Fragment key={j}>
                {j > 0 ? <wbr /> : null}
                {seg}
              </Fragment>
            ))}
          </a>
        )
      )}
    </>
  );
}

/** Keys must match the CHECK on intelligence.ai_message_feedback.type_reason. */
const FEEDBACK_REASONS = [
  { key: "wrong_facts", label: "Wrong facts" },
  { key: "wrong_datetime", label: "Wrong date/time" },
  { key: "made_it_up", label: "Made it up" },
  { key: "missed_data", label: "Missed data it had" },
  { key: "ignored_request", label: "Ignored what I asked" },
  { key: "tone_format", label: "Tone or format" },
] as const;

interface MessageBubbleProps {
  role: "user" | "assistant" | "system";
  content: string;
  model?: string | null;
  isStreaming?: boolean;
  attachments?: Attachment[] | null;
  userName?: string | null;
  onFactCheck?: () => void;
  onRetry?: () => void;
  onEdit?: (newContent: string) => void;
  /** Current feedback rating (1 / -1 / null) and change handler. Thumbs render only when handler provided. */
  rating?: 1 | -1 | null;
  onRate?: (rating: 1 | -1 | null) => void;
  /** Optional follow-up: WHY it was unhelpful. One tap, dismissible. */
  onRateReason?: (reason: string) => void;
  /** Promote this answer's prompt to a scheduled (recurring) task. */
  onMakeRecurring?: () => void;
  /** Needed by embedded scheduled-proposal confirmation cards. */
  workspaceId?: string | null;
  /** Identity + provenance for notebook captures and deep links. */
  messageId?: string;
  conversationId?: string;
  conversationTitle?: string | null;
  /** Change request aimed at one image in this message. Given the image's URL
   *  so the model can edit that exact file rather than generating another. */
  onImageComment?: (src: string, text: string) => void;
}

export default function MessageBubble({
  role,
  content,
  model,
  isStreaming,
  attachments,
  userName,
  onFactCheck,
  onRetry,
  onEdit,
  rating,
  onRate,
  onRateReason,
  onMakeRecurring,
  workspaceId,
  messageId,
  conversationId,
  conversationTitle,
  onImageComment,
}: MessageBubbleProps) {
  const isUser = role === "user";
  const [copied, setCopied] = useState(false);
  const [showReasons, setShowReasons] = useState(false);
  const [isEditing, setIsEditing] = useState(false);
  const [editText, setEditText] = useState(content);
  const editRef = useRef<HTMLTextAreaElement>(null);
  const contentRef = useRef<HTMLDivElement>(null);
  // Images rendered in this message, and which one is open full size. Collected
  // from the DOM at click time rather than parsed out of the markdown: the
  // rendered HTML is the thing the user actually clicked.
  const [imageUrls, setImageUrls] = useState<string[]>([]);
  const [imageZoom, setImageZoom] = useState<number | null>(null);

  // Auto-retry failed images (blob may take a moment to propagate)
  useEffect(() => {
    if (isStreaming || !contentRef.current) return;
    const images = contentRef.current.querySelectorAll<HTMLImageElement>("img[data-retry-src]");
    images.forEach((img) => {
      if (img.complete && img.naturalWidth > 0) return; // already loaded
      let retries = 0;
      const handleError = () => {
        if (retries < 3) {
          retries++;
          setTimeout(() => {
            const base = img.dataset.retrySrc || img.src;
            img.src = base + (base.includes("?") ? "&" : "?") + `r=${retries}`;
          }, 1500 * retries);
        }
      };
      img.addEventListener("error", handleError, { once: false });
    });
  }, [content, isStreaming]);
  /**
   * Highlight → "Save to notebook".
   *
   * Listens for a selection that lies inside THIS bubble and shows a chip
   * anchored to it. Native selection works fine over the sanitized innerHTML;
   * what needs care is the teardown — the chip must vanish the moment the
   * selection collapses, or it hangs over the next thing the user reads.
   */
  const [selection, setSelection] = useState<{ text: string; x: number; y: number } | null>(null);
  const [savingClip, setSavingClip] = useState(false);

  useEffect(() => {
    if (!messageId || !workspaceId) return;

    // Read the selection only once it has SETTLED. Doing this on every
    // selectionchange meant a state update per mouse-move, and the browser
    // was re-rendering the bubble instead of tracking the drag — the
    // selection stuttered and snapped to whole words and paragraphs.
    const settle = () => {
      const sel = window.getSelection();
      if (!sel || sel.isCollapsed || sel.rangeCount === 0) { setSelection(null); return; }
      const range = sel.getRangeAt(0);
      const host = contentRef.current;
      // Only claim a selection that both starts and ends inside this bubble —
      // a drag across several messages belongs to none of them.
      if (!host || !host.contains(range.startContainer) || !host.contains(range.endContainer)) {
        setSelection(null);
        return;
      }
      const text = normaliseSelection(sel.toString());
      if (!text) { setSelection(null); return; }
      const rect = range.getBoundingClientRect();
      if (!rect.width && !rect.height) { setSelection(null); return; }
      setSelection({ text, x: rect.left + rect.width / 2, y: rect.top });
    };

    // selectionchange is used ONLY to dismiss — no text extraction, no
    // geometry, and setSelection(null) on an already-null value is a no-op in
    // React, so this stays free during a drag.
    const onSelectionChange = () => {
      const sel = window.getSelection();
      if (!sel || sel.isCollapsed) setSelection(null);
    };

    document.addEventListener("selectionchange", onSelectionChange);
    document.addEventListener("mouseup", settle);
    document.addEventListener("touchend", settle);
    document.addEventListener("keyup", settle);
    return () => {
      document.removeEventListener("selectionchange", onSelectionChange);
      document.removeEventListener("mouseup", settle);
      document.removeEventListener("touchend", settle);
      document.removeEventListener("keyup", settle);
    };
  }, [messageId, workspaceId]);

  const clip = async (text: string, type: "highlight" | "answer" | "prompt") => {
    if (!workspaceId) return;
    setSavingClip(true);
    try {
      const entry = await saveToNotebook({
        workspaceId,
        quote: text,
        type,
        conversationId: conversationId || null,
        messageId: messageId || null,
      });
      if (entry) {
        toast.success("Saved to notebook");
        setSelection(null);
        window.getSelection()?.removeAllRanges();
      }
    } finally {
      setSavingClip(false);
    }
  };

  const isFactCheck = !isUser && content.includes("## 🔍 Fact Check");
  const [sourcesExpanded, setSourcesExpanded] = useState(true);
  const [hoveredSource, setHoveredSource] = useState<number | null>(null);
  // Rich hover preview for inline citation chips. The message HTML is
  // sanitized innerHTML (no React handlers possible on the chips), so we
  // delegate mouse events from the .ai-response container instead.
  const [citePreview, setCitePreview] = useState<{ num: number; x: number; y: number } | null>(null);

  const formatSize = (bytes: number) => {
    if (bytes < 1024) return `${bytes}B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)}KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)}MB`;
  };

  const isImage = (type: string) => type.startsWith("image/");

  // Extract scheduled-prompt proposal markers FIRST (they contain raw JSON that
  // must never reach the markdown/source pipeline), then parse sources.
  //
  // MEMOISED, and it matters: this chain plus the markdown render below is a
  // full parse of the message, and it used to run on EVERY render. Any state
  // change in this component — hover, rating, the selection chip — paid for it
  // again. Dragging to select fired it tens of times a second and the drag
  // stuttered.
  const { cleanContent, sources, proposals } = useMemo(() => {
    const found: ScheduledProposal[] = [];
    let bodyContent = content;
    if (!isUser && content.includes("[SCHEDULED_PROPOSAL]")) {
      bodyContent = content.replace(
        /\[SCHEDULED_PROPOSAL\]([\s\S]*?)\[\/SCHEDULED_PROPOSAL\]/g,
        (_m, json) => {
          try { found.push(JSON.parse(json)); } catch { /* partial/garbled — drop */ }
          return "";
        }
      );
    }
    const parsed = !isUser
      ? parseSourcesFromContent(bodyContent)
      : { cleanContent: content, sources: [] as ParsedSource[] };
    return { ...parsed, proposals: found };
  }, [content, isUser]);

  // The OBJECT is memoised, not just the string, and that distinction is the
  // whole fix. React compares the dangerouslySetInnerHTML prop by identity —
  // a fresh `{ __html }` literal each render makes it rewrite innerHTML even
  // when the html is byte-identical, which tears down and rebuilds every child
  // node. Any selection inside the message dies with them, so highlighting
  // cleared itself the instant the chip appeared. Verified by intercepting the
  // innerHTML setter: one write per render, sameString true, 909 → 909 chars.
  const htmlProp = useMemo(
    () => ({
      __html: DOMPurify.sanitize(formatMarkdown(cleanContent, sources), {
        ADD_ATTR: ["target", "rel", "data-source-num", "loading", "data-retry-src", "data-code-copy"],
      }),
    }),
    [cleanContent, sources]
  );

  return (
    <div
      ref={contentRef}
      id={messageId ? `msg-${messageId}` : undefined}
      className={cn(
        "flex gap-2 md:gap-3 px-3 md:px-4 py-3 rounded-xl transition-colors",
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
          "rounded-xl text-[16px]",
          isUser
            // min-w-0 is belt and braces, not the fix: a flex item's default
            // min-width is auto — a floor at its min-content width — but
            // max-w-[85%] already clamps that floor, and the bubble in the
            // bug report was at 598px, which is exactly 85% of the row. It
            // was the TEXT that overflowed it. This keeps the bubble honest
            // if the cap ever goes.
            ? "max-w-[85%] min-w-0 bg-[#f0f0f0] dark:bg-[#2a2a2a] text-foreground px-4 py-2.5"
            : "max-w-full min-w-0 flex-1 bg-transparent"
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
          isEditing ? (
            <div className="w-full">
              <textarea
                ref={editRef}
                value={editText}
                onChange={(e) => setEditText(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Escape") { setIsEditing(false); setEditText(content); }
                }}
                className="w-full bg-transparent text-[15px] leading-relaxed resize-none outline-none min-h-[60px] max-h-[300px]"
                rows={Math.min(editText.split("\n").length + 1, 10)}
                autoFocus
              />
              <div className="flex items-center gap-2 mt-2 justify-end">
                <Button
                  variant="ghost"
                  size="sm"
                  className="h-7 text-xs"
                  onClick={() => { setIsEditing(false); setEditText(content); }}
                >
                  Cancel
                </Button>
                <Button
                  size="sm"
                  className="h-7 text-xs"
                  disabled={!editText.trim() || editText.trim() === content}
                  onClick={() => {
                    if (onEdit && editText.trim() && editText.trim() !== content) {
                      onEdit(editText.trim());
                      setIsEditing(false);
                    }
                  }}
                >
                  Save & Submit
                </Button>
              </div>
            </div>
          ) : (
            <div className="group/edit relative">
              {content ? <p className="whitespace-pre-wrap leading-relaxed break-anywhere"><UserText text={content} /></p> : null}
              {onEdit && (
                <button
                  onClick={() => { setEditText(content); setIsEditing(true); }}
                  className="absolute -top-1 -right-1 p-1 rounded-md bg-background/80 border border-border/50 shadow-sm opacity-0 group-hover/edit:opacity-100 transition-opacity"
                  title="Edit message"
                >
                  <Pencil className="h-3 w-3 text-muted-foreground" />
                </button>
              )}
            </div>
          )
        ) : (
          <>
            {isFactCheck && (
              <div className="flex items-center gap-1.5 mb-2 text-[11px] font-medium text-blue-600 dark:text-blue-400">
                <ShieldCheck className="h-3.5 w-3.5" />
                <span>Fact Check</span>
              </div>
            )}
            <div
              className="ai-response"
              onClick={(e) => {
                // Delegated handler for code-block copy buttons (the HTML is
                // generated by formatMarkdown, so no per-button React handler).
                const btn = (e.target as HTMLElement).closest("[data-code-copy]");
                if (!btn) return;
                const code = btn.closest(".ai-code-wrap")?.querySelector("code");
                if (!code) return;
                navigator.clipboard.writeText(code.textContent || "");
                btn.textContent = "Copied";
                setTimeout(() => { btn.textContent = "Copy"; }, 2000);
              }}
              onMouseOver={(e) => {
                // Delegated hover for inline citation chips → rich preview
                const chip = (e.target as HTMLElement).closest("a.ai-cite") as HTMLElement | null;
                if (!chip) return;
                const num = parseInt(chip.getAttribute("data-source-num") || "", 10);
                if (!num) return;
                const r = chip.getBoundingClientRect();
                setCitePreview({ num, x: r.left + r.width / 2, y: r.top });
              }}
              onMouseOut={(e) => {
                if ((e.target as HTMLElement).closest("a.ai-cite")) setCitePreview(null);
              }}
              onClickCapture={(e) => {
                const el = e.target as HTMLElement;
                if (el.tagName !== "IMG" || !contentRef.current) return;
                const all = Array.from(
                  contentRef.current.querySelectorAll<HTMLImageElement>("img")
                ).map((n) => n.currentSrc || n.src);
                const i = all.indexOf((el as HTMLImageElement).currentSrc || (el as HTMLImageElement).src);
                if (i === -1) return;
                e.preventDefault();
                setImageUrls(all);
                setImageZoom(i);
              }}
              dangerouslySetInnerHTML={htmlProp}
            />
            {imageZoom !== null && imageUrls[imageZoom] && (
              <SlideLightbox
                noun="Image"
                index={imageZoom}
                count={imageUrls.length}
                onClose={() => setImageZoom(null)}
                onIndex={setImageZoom}
                footer={onImageComment ? (
                  <SlideCommentBox
                    key={imageZoom}
                    noun="Image"
                    slideNumber={imageZoom + 1}
                    placeholder="e.g. warmer light, lose the text, make it portrait"
                    onSubmit={(text) => {
                      onImageComment(imageUrls[imageZoom], text);
                      setImageZoom(null);
                    }}
                    onCancel={() => setImageZoom(null)}
                    dark
                  />
                ) : undefined}
              >
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={imageUrls[imageZoom]}
                  alt={`Image ${imageZoom + 1}`}
                  className="block rounded shadow-2xl"
                  style={{ maxWidth: "min(1100px, calc(100vw - 140px))", maxHeight: "calc(100vh - 260px)" }}
                />
              </SlideLightbox>
            )}
            {citePreview && (() => {
              const src = sources.find((s) => s.number === citePreview.num);
              if (!src) return null;
              return (
                <div
                  className="fixed z-50 pointer-events-none"
                  style={{ left: citePreview.x, top: citePreview.y - 8, transform: "translate(-50%, -100%)" }}
                >
                  <div className="bg-popover text-popover-foreground border shadow-lg rounded-lg px-3 py-2 max-w-[320px]">
                    <div className="flex items-center gap-2">
                      {src.favicon ? (
                        <img
                          src={src.favicon}
                          alt=""
                          className="h-4 w-4 rounded-sm shrink-0"
                          onError={(e) => { (e.target as HTMLImageElement).style.display = "none"; }}
                        />
                      ) : (
                        <span className="h-4 w-4 rounded-sm shrink-0 bg-muted-foreground/20" aria-hidden />
                      )}
                      <p className="text-xs font-medium truncate">{src.title || src.domain}</p>
                    </div>
                    <p className="text-[11px] text-muted-foreground truncate mt-0.5">{src.domain}</p>
                  </div>
                </div>
              );
            })()}
          </>
        )}
        {proposals.map((p) => (
          <ScheduledProposalCard key={p.proposalId} proposal={p} workspaceId={workspaceId} />
        ))}
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
                    {src.favicon ? (
                      <img
                        src={src.favicon}
                        alt=""
                        className="h-3.5 w-3.5 rounded-sm shrink-0"
                        onError={(e) => {
                          (e.target as HTMLImageElement).style.display = "none";
                        }}
                      />
                    ) : (
                      <span className="h-3.5 w-3.5 rounded-sm shrink-0 bg-muted-foreground/20" aria-hidden />
                    )}
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

        {!isUser && !isStreaming && (
          <div className="flex flex-wrap items-center gap-1 mt-2">
            {model && (
              <p className="text-[11px] text-muted-foreground mr-2">
                {getModelLabel(model)}
              </p>
            )}
            <button
              onClick={() => {
                // Strip markdown formatting for clean clipboard text
                const plain = content
                  .replace(/\[SCHEDULED_PROPOSAL\][\s\S]*?\[\/SCHEDULED_PROPOSAL\]/g, "")
                  .replace(/!\[[^\]]*\]\([^)]+\)/g, "")
                  .replace(/\[([^\]]+)\]\([^)]+\)/g, "$1")
                  .replace(/\*\*([^*]+)\*\*/g, "$1")
                  .replace(/^#{1,4}\s+/gm, "")
                  .replace(/^[-*]\s+/gm, "• ")
                  .replace(/\n{3,}/g, "\n\n")
                  .trim();
                navigator.clipboard.writeText(plain);
                setCopied(true);
                setTimeout(() => setCopied(false), 2000);
              }}
              className="inline-flex items-center gap-1 text-[11px] text-muted-foreground hover:text-foreground transition-colors rounded px-1.5 py-0.5 hover:bg-muted/50"
              title="Copy to clipboard"
            >
              {copied ? <Check className="h-3 w-3 text-green-500" /> : <Copy className="h-3 w-3" />}
              <span>{copied ? "Copied" : "Copy"}</span>
            </button>
            {onRetry && (
              <button
                onClick={onRetry}
                className="inline-flex items-center gap-1 text-[11px] text-muted-foreground hover:text-foreground transition-colors rounded px-1.5 py-0.5 hover:bg-muted/50"
                title="Regenerate this response"
              >
                <RotateCcw className="h-3 w-3" />
                <span>Retry</span>
              </button>
            )}
            {/* Start writing from this answer.
                Sends TWO IDS and nothing else — the route re-reads the
                conversation and the message itself and makes its own access,
                incognito and privacy decisions. The browser supplying the text
                would mean the browser supplying the provenance and the privacy
                flag with it. */}
            {conversationId && messageId && !isFactCheck && (
              <button
                onClick={async () => {
                  try {
                    const res = await fetch("/api/optimizer/import", {
                      method: "POST",
                      headers: { "Content-Type": "application/json" },
                      body: JSON.stringify({
                        workspaceId,
                        source: "chat",
                        conversationId,
                        messageId,
                      }),
                    });
                    const j = await res.json().catch(() => ({}));
                    if (!res.ok) {
                      toast.error(j.error || "Could not start content from this");
                      return;
                    }
                    window.location.href = `/engineai/optimizer?session=${encodeURIComponent(j.sessionId)}`;
                  } catch {
                    toast.error("Could not start content from this");
                  }
                }}
                className="inline-flex items-center gap-1 text-[11px] text-muted-foreground hover:text-foreground transition-colors rounded px-1.5 py-0.5 hover:bg-muted/50"
                title="Open this answer in the Writing Studio"
              >
                <PenLine className="h-3 w-3" />
                <span>Start writing</span>
              </button>
            )}
            {onFactCheck && !isFactCheck && (
              <button
                onClick={onFactCheck}
                className="inline-flex items-center gap-1 text-[11px] text-muted-foreground hover:text-foreground transition-colors rounded px-1.5 py-0.5 hover:bg-muted/50"
                title="Fact-check this response"
              >
                <ShieldCheck className="h-3 w-3" />
                <span>Fact check</span>
              </button>
            )}
            {onMakeRecurring && (
              <button
                onClick={onMakeRecurring}
                className="inline-flex items-center gap-1 text-[11px] text-muted-foreground hover:text-foreground transition-colors rounded px-1.5 py-0.5 hover:bg-muted/50"
                title="Run this prompt automatically on a schedule"
              >
                <CalendarClock className="h-3 w-3" />
                <span>Make recurring</span>
              </button>
            )}
            {messageId && workspaceId && (
              <button
                onClick={() => clip(cleanContent, isUser ? "prompt" : "answer")}
                disabled={savingClip}
                className="inline-flex items-center gap-1 text-[11px] text-muted-foreground hover:text-foreground transition-colors rounded px-1.5 py-0.5 hover:bg-muted/50 disabled:opacity-50"
                title={isUser ? "Save this prompt to your notebook" : "Save this answer to your notebook"}
              >
                {savingClip ? <Loader2 className="h-3 w-3 animate-spin" /> : <NotebookPen className="h-3 w-3" />}
                <span>Notebook</span>
              </button>
            )}
            {onRate && (
              <>
                <button
                  onClick={() => { setShowReasons(false); onRate(rating === 1 ? null : 1); }}
                  className={cn(
                    "inline-flex items-center text-[10px] transition-colors rounded px-1.5 py-0.5 hover:bg-muted/50",
                    rating === 1 ? "text-green-500" : "text-muted-foreground hover:text-foreground"
                  )}
                  title={rating === 1 ? "Remove rating" : "Helpful"}
                >
                  <ThumbsUp className="h-3 w-3" />
                </button>
                <button
                  onClick={() => {
                    const next = rating === -1 ? null : -1;
                    onRate(next);
                    // Ask only when a flag is being SET, and only once — a
                    // picker that reappears every time the thumb is toggled
                    // is a nag, and this channel is fragile enough already.
                    setShowReasons(next === -1 && !!onRateReason);
                  }}
                  className={cn(
                    "inline-flex items-center text-[10px] transition-colors rounded px-1.5 py-0.5 hover:bg-muted/50",
                    rating === -1 ? "text-red-500" : "text-muted-foreground hover:text-foreground"
                  )}
                  title={rating === -1 ? "Remove rating" : "Not helpful"}
                >
                  <ThumbsDown className="h-3 w-3" />
                </button>
              </>
            )}
          </div>
        )}
        {/* One tap, and skippable. A longer form at this volume would cost more
            signal than it gathers — an unanswered reason still counts as a
            flag, which is why nothing here is required. */}
        {showReasons && rating === -1 && onRateReason && (
          <div className="mt-1.5 flex flex-wrap items-center gap-1">
            <span className="text-[10px] text-muted-foreground mr-0.5">What went wrong?</span>
            {FEEDBACK_REASONS.map((r) => (
              <button
                key={r.key}
                onClick={() => { onRateReason(r.key); setShowReasons(false); }}
                className="text-[10px] rounded-full border border-border px-2 py-0.5 text-muted-foreground hover:text-foreground hover:bg-muted/50 transition-colors"
              >
                {r.label}
              </button>
            ))}
            <button
              onClick={() => setShowReasons(false)}
              className="text-[10px] text-muted-foreground/60 hover:text-foreground px-1"
              title="Skip"
            >
              Skip
            </button>
          </div>
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

      {/* Highlight → save. Fixed-positioned from the selection rect, so it
          tracks the text rather than the bubble. onMouseDown-preventDefault
          keeps the click from collapsing the selection before it is read. */}
      {selection && (
        <div
          className="fixed z-50"
          style={{
            left: Math.min(Math.max(selection.x, 90), (typeof window !== "undefined" ? window.innerWidth : 0) - 90),
            top: selection.y - 8,
            transform: "translate(-50%, -100%)",
          }}
          onMouseDown={(e) => e.preventDefault()}
        >
          <button
            onClick={() => clip(selection.text, "highlight")}
            disabled={savingClip}
            className="flex items-center gap-1.5 rounded-lg bg-foreground text-background shadow-lg px-2.5 py-1.5 text-xs font-medium hover:bg-foreground/90 transition-colors disabled:opacity-60"
          >
            {savingClip ? <Loader2 className="h-3 w-3 animate-spin" /> : <NotebookPen className="h-3 w-3" />}
            Save to notebook
          </button>
        </div>
      )}
    </div>
  );
}
