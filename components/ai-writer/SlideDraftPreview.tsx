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
import { toast } from "sonner";
import { setSlideText, setSlideImage, moveSlide, deleteSlide } from "@/lib/slides/draft-edit";
import { Button } from "@/components/ui/button";
import { Loader2 } from "lucide-react";
import SlideLightbox from "./SlideLightbox";
import SlideCommentBox from "./SlideCommentBox";
import SlideEditPanel from "./SlideEditPanel";
import { MessageSquarePlus, Pencil } from "lucide-react";

const BASE_W = 720;
const BASE_H = 405;
/** Rendered width of one thumbnail. Two fit side by side in the chat column. */
const THUMB_W = 330;

// Types come from the server module that BUILDS the model rather than being
// restated here. A second copy is how the scrim's alpha went missing: the
// server started carrying a property the client's own interface did not know
// about, and nothing complained. `import type` is erased at compile time, so
// no server code is pulled into the bundle.
export type { PreviewElement, PreviewSlide } from "@/lib/slides/preview-model";
import type { PreviewSlide } from "@/lib/slides/preview-model";

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
  slide, index, width = THUMB_W, onClick, onComment, onEdit,
}: {
  slide: PreviewSlide; index: number; width?: number;
  onClick?: () => void; onComment?: () => void; onEdit?: () => void;
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
            // cover, not contain: the backdrop is pre-cropped to the canvas, and
            // contain would letterbox anything that is not — which is exactly the
            // bars this fixed in the deck.
            return <img key={i} src={el.src} alt="" style={{ ...base, objectFit: "cover" }} />;
          }
          if (el.kind === "rect" || el.kind === "ellipse") {
            return (
              <div key={i} style={{
                ...base,
                background: el.fill || "transparent",
                opacity: el.opacity ?? 1,
                borderRadius: el.kind === "ellipse" ? "50%" : el.rounded ? 8 : 2,
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
      {(onEdit || onComment) && (
        // Always in the DOM rather than mounted on hover, so they are reachable
        // by keyboard and do not vanish from under a moving cursor.
        <div className="absolute top-1.5 right-1.5 flex gap-1 opacity-0 group-hover:opacity-100 focus-within:opacity-100 transition-opacity">
          {onEdit && (
            <button
              type="button"
              onClick={(e) => { e.stopPropagation(); onEdit(); }}
              aria-label={`Edit slide ${index + 1}`}
              title="Edit this slide directly"
              className="h-7 w-7 rounded-md bg-background/90 border shadow-sm flex items-center justify-center focus:opacity-100 focus-visible:ring-2 focus-visible:ring-primary/40"
            >
              <Pencil className="h-3.5 w-3.5" />
            </button>
          )}
          {onComment && (
            <button
              type="button"
              onClick={(e) => { e.stopPropagation(); onComment(); }}
              aria-label={`Comment on slide ${index + 1}`}
              title="Ask the model for a change to this slide"
              className="h-7 w-7 rounded-md bg-background/90 border shadow-sm flex items-center justify-center focus:opacity-100 focus-visible:ring-2 focus-visible:ring-primary/40"
            >
              <MessageSquarePlus className="h-3.5 w-3.5" />
            </button>
          )}
        </div>
      )}
    </div>
  );
}

/** Full-bleed layouts carry text over the picture and need the gradient; an
 *  image beside text does not, and darkening it would be wrong. */
function needsGradient(draft: SlideDraft, index: number): boolean {
  const layout = (draft.slides[index] as any)?.layout;
  return layout !== "image-split" && layout !== "image-grid";
}

export default function SlideDraftPreview({
  draft, onPublish, publishing, disabled, onSlideComment, onEdit,
}: {
  draft: SlideDraft;
  onPublish: () => void;
  publishing: boolean;
  disabled?: boolean;
  /** Sends a change request scoped to one slide. */
  onSlideComment?: (index: number, text: string) => void;
  /** Direct edits, applied locally without involving the model. */
  onEdit?: (next: SlideDraft) => void;
}) {
  const count = draft.preview.slides.length;
  const [zoom, setZoom] = useState<number | null>(null);
  const [commentOn, setCommentOn] = useState<number | null>(null);
  const [editOn, setEditOn] = useState<number | null>(null);
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
                      onComment={onSlideComment ? () => { setEditOn(null); setCommentOn(i); } : undefined}
                      onEdit={onEdit ? () => { setCommentOn(null); setEditOn(i); } : undefined} />
        ))}
      </div>

      {editOn !== null && onEdit && (
        <div className="mt-2.5">
          <SlideEditPanel
            draft={draft}
            index={editOn}
            onText={(field, value) => onEdit(setSlideText(draft, editOn, field, value))}
            onImage={async (query) => {
              const res = await fetch("/api/slides/image", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ query, gradient: needsGradient(draft, editOn) }),
              });
              const j = await res.json();
              if (!res.ok) { toast.error(j.error || "Couldn't change the image."); return; }
              onEdit(setSlideImage(draft, editOn, j.url, query, j.credit));
            }}
            onMove={(delta) => {
              onEdit(moveSlide(draft, editOn, delta));
              setEditOn(Math.min(Math.max(0, editOn + delta), draft.slides.length - 1));
            }}
            onDelete={() => { onEdit(deleteSlide(draft, editOn)); setEditOn(null); }}
            onClose={() => setEditOn(null)}
          />
        </div>
      )}

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
