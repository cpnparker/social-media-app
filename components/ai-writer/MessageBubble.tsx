"use client";

import { useState, useEffect, useRef, useMemo } from "react";
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
            ? "max-w-[85%] bg-[#f0f0f0] dark:bg-[#2a2a2a] text-foreground px-4 py-2.5"
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
              {content ? <p className="whitespace-pre-wrap leading-relaxed">{content}</p> : null}
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
            {/* Start a piece from this answer.
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
                      toast.error(j.error || "Could not start a piece from this");
                      return;
                    }
                    window.location.href = `/engineai/optimizer?session=${encodeURIComponent(j.sessionId)}`;
                  } catch {
                    toast.error("Could not start a piece from this");
                  }
                }}
                className="inline-flex items-center gap-1 text-[11px] text-muted-foreground hover:text-foreground transition-colors rounded px-1.5 py-0.5 hover:bg-muted/50"
                title="Open this answer in the Writing Studio as a new piece"
              >
                <PenLine className="h-3 w-3" />
                <span>Start a piece</span>
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

/* ─── Source extraction ─── */

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
function formatMarkdown(text: string, sources: ParsedSource[] = []): string {
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

function escapeHtml(str: string): string {
  return str
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}
