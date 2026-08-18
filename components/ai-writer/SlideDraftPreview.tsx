"use client";

/**
 * A deck the user can see and argue with before it becomes a file.
 *
 * Slides are drawn from the same layout the generator will use, so what is on
 * screen predicts what lands in Drive. Each slide is laid out at its true size
 * — 720 x 405 points, one point to one pixel — and then scaled down as a whole,
 * which keeps every position and font size proportionally exact rather than
 * approximated per element.
 */

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Loader2 } from "lucide-react";
import SlideLightbox from "./SlideLightbox";
import SlideCommentBox from "./SlideCommentBox";
import { MessageSquarePlus } from "lucide-react";

const BASE_W = 720;
const BASE_H = 405;
/** Rendered width of one thumbnail. Two fit side by side in the chat column. */
const THUMB_W = 330;

export interface PreviewElement {
  kind: "rect" | "ellipse" | "text" | "image";
  x: number; y: number; w: number; h: number;
  fill?: string;
  text?: string;
  font?: string;
  size?: number;
  weight?: number;
  color?: string;
  align?: "start" | "center" | "end";
  bullets?: boolean;
  src?: string;
}

export interface PreviewSlide {
  background: string;
  elements: PreviewElement[];
}

export interface SlideDraft {
  title: string;
  slides: any[];
  preview: { width: number; height: number; slides: PreviewSlide[] };
}

/** Playfair and Roboto may not be loaded in the app shell; the fallbacks are
 *  chosen to hold the same serif/sans distinction so the preview still reads
 *  the way the deck will. */
function fontStack(font?: string): string {
  if (font === "Playfair Display") return "'Playfair Display', Georgia, 'Times New Roman', serif";
  if (font === "Poppins") return "'Poppins', 'Helvetica Neue', Arial, sans-serif";
  return "'Roboto', 'Helvetica Neue', Arial, sans-serif";
}

function SlideThumb({
  slide, index, width = THUMB_W, onClick, onComment,
}: {
  slide: PreviewSlide; index: number; width?: number;
  onClick?: () => void; onComment?: () => void;
}) {
  const scale = width / BASE_W;
  return (
    <div className="relative shrink-0 group" style={{ width }}>
    <div
      className={`rounded border overflow-hidden bg-white ${onClick ? "cursor-zoom-in hover:ring-2 hover:ring-primary/40 transition-shadow" : ""}`}
      style={{ width, height: BASE_H * scale }}
      aria-label={`Slide ${index + 1}`}
      role={onClick ? "button" : undefined}
      tabIndex={onClick ? 0 : undefined}
      onClick={onClick}
      onKeyDown={onClick ? (e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); onClick(); } } : undefined}
    >
      <div
        style={{
          width: BASE_W,
          height: BASE_H,
          transform: `scale(${scale})`,
          transformOrigin: "top left",
          position: "relative",
          background: slide.background,
        }}
      >
        {slide.elements.map((el, i) => {
          const base: React.CSSProperties = {
            position: "absolute",
            left: el.x, top: el.y, width: el.w, height: el.h,
          };
          if (el.kind === "image") {
            // eslint-disable-next-line @next/next/no-img-element
            return <img key={i} src={el.src} alt="" style={{ ...base, objectFit: "contain" }} />;
          }
          if (el.kind === "rect" || el.kind === "ellipse") {
            return (
              <div key={i} style={{
                ...base,
                background: el.fill || "transparent",
                borderRadius: el.kind === "ellipse" ? "50%" : 4,
              }} />
            );
          }
          const lines = (el.text || "").split("\n");
          return (
            <div key={i} style={{
              ...base,
              color: el.color,
              fontFamily: fontStack(el.font),
              fontSize: el.size,
              fontWeight: el.weight || 400,
              lineHeight: 1.15,
              textAlign: el.align === "center" ? "center" : el.align === "end" ? "right" : "left",
              overflow: "hidden",
              whiteSpace: "pre-wrap",
            }}>
              {el.bullets && lines.length > 1
                ? lines.map((line, li) => <div key={li}>{`• ${line}`}</div>)
                : el.text}
            </div>
          );
        })}
      </div>
    </div>
      {onComment && (
        // Always in the DOM rather than mounted on hover, so it is reachable by
        // keyboard and does not vanish from under a moving cursor.
        <button
          type="button"
          onClick={(e) => { e.stopPropagation(); onComment(); }}
          aria-label={`Comment on slide ${index + 1}`}
          title="Ask for a change to this slide"
          className="absolute top-1.5 right-1.5 h-7 w-7 rounded-md bg-background/90 border shadow-sm flex items-center justify-center
                     opacity-0 group-hover:opacity-100 focus:opacity-100 focus-visible:ring-2 focus-visible:ring-primary/40 transition-opacity"
        >
          <MessageSquarePlus className="h-3.5 w-3.5" />
        </button>
      )}
    </div>
  );
}

export default function SlideDraftPreview({
  draft, onPublish, publishing, disabled, onSlideComment,
}: {
  draft: SlideDraft;
  onPublish: () => void;
  publishing: boolean;
  disabled?: boolean;
  /** Sends a change request scoped to one slide. */
  onSlideComment?: (index: number, text: string) => void;
}) {
  const count = draft.preview.slides.length;
  const [zoom, setZoom] = useState<number | null>(null);
  const [commentOn, setCommentOn] = useState<number | null>(null);
  const slideTitle = (i: number) => (draft.slides?.[i] as any)?.title as string | undefined;
  const submitComment = (i: number) => (text: string) => {
    onSlideComment?.(i, text);
    // Both surfaces close: the request is now in the conversation, and the
    // preview it refers to is about to be replaced.
    setCommentOn(null);
    setZoom(null);
  };
  // Bounded so a slide stays whole on screen: the point of a full view is
  // reading it without scrolling to find the rest of it. Measured only once a
  // slide has been clicked, which cannot happen during server rendering.
  const zoomWidth = zoom === null ? 0 : Math.min(
    1100,
    window.innerWidth - 140,
    (window.innerHeight - 180) * (BASE_W / BASE_H)
  );
  return (
    <div className="flex-1 min-w-0 rounded-lg border bg-muted/30 px-3 py-3">
      <div className="flex items-center justify-between gap-3 mb-3">
        <div className="min-w-0">
          <p className="text-sm font-medium truncate">{draft.title}</p>
          <p className="text-xs text-muted-foreground">
            Draft preview · {count} slide{count === 1 ? "" : "s"} · not saved to Drive
          </p>
        </div>
        <Button size="sm" onClick={onPublish} disabled={publishing || disabled} className="shrink-0">
          {publishing ? (
            <><Loader2 className="h-3.5 w-3.5 mr-1.5 animate-spin" />Creating…</>
          ) : "Create in Google Slides"}
        </Button>
      </div>

      <div className="flex flex-wrap gap-2">
        {draft.preview.slides.map((s, i) => (
          <SlideThumb key={i} slide={s} index={i} onClick={() => setZoom(i)}
                      onComment={onSlideComment ? () => setCommentOn(i) : undefined} />
        ))}
      </div>

      {commentOn !== null && (
        <div className="mt-2.5">
          <SlideCommentBox
            slideNumber={commentOn + 1}
            slideTitle={slideTitle(commentOn)}
            onSubmit={submitComment(commentOn)}
            onCancel={() => setCommentOn(null)}
          />
        </div>
      )}

      {zoom !== null && (
        <SlideLightbox
          index={zoom} count={count} onClose={() => setZoom(null)} onIndex={setZoom}
          footer={onSlideComment ? (
            <SlideCommentBox
              key={zoom}
              slideNumber={zoom + 1}
              slideTitle={slideTitle(zoom)}
              onSubmit={submitComment(zoom)}
              onCancel={() => setZoom(null)}
              dark
            />
          ) : undefined}
        >
          <SlideThumb slide={draft.preview.slides[zoom]} index={zoom} width={zoomWidth} />
        </SlideLightbox>
      )}

      <p className="text-xs text-muted-foreground mt-2.5">
        Click a slide to read it full size, or use the comment button on a slide to ask for a change to just that one. Nothing reaches your Drive until you create it.
      </p>
    </div>
  );
}
