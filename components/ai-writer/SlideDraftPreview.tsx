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
import { SLIDES_TEXT_INSET, BULLET_INDENT, runsOf } from "@/lib/slides/preview-style";

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

/** Where this line starts in the box's whole text, which is what link ranges
 *  are measured against. */
function lineOffset(lines: string[], index: number): number {
  let at = 0;
  for (let i = 0; i < index; i++) at += lines[i].length + 1;   // +1 for the newline
  return at;
}

/** A line, with the linked words underlined exactly as Slides underlines them. */
function renderRuns(
  line: string, offset: number, links?: { start: number; end: number; url: string }[]
) {
  const runs = runsOf(line, offset, links);
  if (runs.length === 1 && !runs[0].url) return line;
  return runs.map((run, i) =>
    run.url
      ? <span key={i} style={{ textDecoration: "underline" }}>{run.text}</span>
      : <span key={i}>{run.text}</span>
  );
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
            // contain, because that is what SLIDES does — it scales an image to
            // fit inside the box it is given and letterboxes the remainder.
            // Photographs are pre-baked to their box's exact aspect, so contain
            // and cover are identical for them; where they are NOT baked — a
            // client logo on the logo wall, which must never be cropped — cover
            // silently cut the mark in half here and showed it whole in the
            // deck. The preview has to show the letterbox when there will be one.
            return <img key={i} src={el.src} alt="" style={{ ...base, objectFit: "contain" }} />;
          }
          if (el.kind === "rect" || el.kind === "ellipse") {
            // A rotated segment (a line-chart line) carries a full affine. It is
            // rendered as a rotated div positioned by its MIDPOINT in pt — not a
            // CSS matrix(), whose translate is taken as px while everything else
            // here is pt, which slid every line off its own data points.
            if (el.transform) {
              const t = el.transform;
              const angle = (Math.atan2(t.shearY, t.scaleX) * 180) / Math.PI;
              const cx = t.scaleX * (el.w / 2) + t.shearX * (el.h / 2) + t.translateX;
              const cy = t.shearY * (el.w / 2) + t.scaleY * (el.h / 2) + t.translateY;
              return (
                <div key={i} style={{
                  position: "absolute",
                  left: cx - el.w / 2, top: cy - el.h / 2, width: el.w, height: el.h,
                  background: el.fill || "transparent", opacity: el.opacity ?? 1,
                  transform: `rotate(${angle}deg)`,
                }} />
              );
            }
            return (
              <div key={i} style={{
                ...base,
                background: el.fill || "transparent",
                opacity: el.opacity ?? 1,
                // A RECTANGLE has square corners in Slides. The 2px default here
                // was a house style the deck does not share — visible on the
                // chart bars, the stat rules and every scrim.
                borderRadius: el.kind === "ellipse" ? "50%" : el.rounded ? 8 : 0,
                // Slides draws a RIGHT_ARROW as an arrow; a preview that draws
                // a rectangle turns the process layout's direction — the whole
                // reason that layout exists — into a row of blocks.
                ...(el.arrow
                  ? { clipPath: "polygon(0% 30%, 60% 30%, 60% 0%, 100% 50%, 60% 100%, 60% 70%, 0% 70%)" }
                  : {}),
              }} />
            );
          }
          const lines = (el.text || "").split("\n");
          // Paragraph spacing and line spacing come from the request the deck
          // will be built from, not from a number chosen here: a body set
          // tighter in the preview than in Slides is a body that looks like it
          // fits when it will overflow.
          const gap = el.spaceBelow ?? 0;
          return (
            <div key={i} style={{
              ...base,
              // Slides insets text inside its box — 0.1in left and right, 0.05in
              // top and bottom — and does not expose the setting through the
              // API, so every box has them. Drawing text flush gave the preview
              // 14pt of width per box that the deck does not have, which is
              // enough for a title to wrap here and not there.
              paddingLeft: SLIDES_TEXT_INSET.x, paddingRight: SLIDES_TEXT_INSET.x,
              paddingTop: SLIDES_TEXT_INSET.y, paddingBottom: SLIDES_TEXT_INSET.y,
              boxSizing: "border-box" as const,
              color: el.color,
              fontFamily: fontStack(el.font),
              fontSize: el.size,
              fontWeight: el.weight || 400,
              lineHeight: (el.lineSpacing ?? 115) / 100,
              textAlign: el.align === "center" ? "center" : el.align === "end" ? "right" : "left",
              // VISIBLE, because Slides does not reflow, shrink or clip: it
              // draws the text and lets it run off the slide. Clipping it here
              // made an overflowing body look like a tidy, complete slide — the
              // preview flattering the deck, which is the one direction it is
              // not allowed to be wrong in. The thumbnail's own frame still
              // cuts it at the canvas edge, exactly as Slides does.
              overflow: "visible",
              whiteSpace: "pre-wrap",
              // Mirrors Slides' contentAlignment: MIDDLE. Without it a centred
              // body renders top-aligned here and the preview stops predicting
              // the deck — the exact divergence the scrim alpha caused.
              ...(el.vCenter
                ? { display: "flex", flexDirection: "column" as const, justifyContent: "center" }
                : {}),
            }}>
              {lines.length > 1
                ? lines.map((line, li) => {
                    const spacing = li < lines.length - 1 ? { marginBottom: gap } : undefined;
                    const drawn = renderRuns(line, lineOffset(lines, li), el.links);
                    // Slides hangs a bullet: the glyph sits at the box's inset
                    // and every wrapped line lines up under the TEXT, not under
                    // the dot. An inline "• " prefix returned each continuation
                    // to the left edge and gave the preview 18pt of width the
                    // deck does not have, so the two disagreed about where
                    // every bullet wraps.
                    if (!el.bullets) return <div key={li} style={spacing}>{drawn}</div>;
                    return (
                      <div key={li} style={{ ...spacing, display: "flex" }}>
                        <span style={{ flex: `0 0 ${BULLET_INDENT}px` }}>•</span>
                        <span style={{ flex: "1 1 auto", minWidth: 0 }}>{drawn}</span>
                      </div>
                    );
                  })
                : renderRuns(el.text || "", 0, el.links)}
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
  onEdit?: (next: SlideDraft | ((cur: SlideDraft) => SlideDraft)) => void;
}) {
  const count = draft.preview.slides.length;
  // One overlay, three modes. Editing used to open a form BELOW the grid, which
  // in a twenty-slide deck put the controls a screen away from the slide they
  // changed — and at thumbnail size you cannot see what you are editing. Both
  // actions now open the slide full size and put the controls under it.
  const [rawZoom, setRawZoom] = useState<number | null>(null);
  // Clamped against the CURRENT deck. A new draft arriving while slide 9 of 12
  // was open — the model answering a comment with a shorter deck — left the
  // index pointing past the end, and every read of preview.slides[zoom] below
  // is unguarded, so the whole chat unmounted with a type error.
  const zoom = rawZoom === null ? null : rawZoom < count ? rawZoom : count > 0 ? count - 1 : null;
  const setZoom = setRawZoom;
  const [mode, setMode] = useState<"view" | "edit" | "comment">("view");
  const open = (i: number, m: "view" | "edit" | "comment") => { setZoom(i); setMode(m); };
  const slideTitle = (i: number) => (draft.slides?.[i] as any)?.title as string | undefined;
  const submitComment = (i: number) => (text: string) => {
    onSlideComment?.(i, text);
    // Closes: the request is now in the conversation, and the preview it refers
    // to is about to be replaced.
    setZoom(null);
    setMode("view");
  };
  // Bounded so a slide stays whole on screen: the point of a full view is
  // reading it without scrolling to find the rest of it. Measured only once a
  // slide has been clicked, which cannot happen during server rendering.
  // The footer grows when it holds a form, so the slide has to give way — a
  // full-size slide plus an edit panel does not fit a laptop viewport, and the
  // half that would scroll off is the controls.
  // Never let the footer claim more than 45% of a short window, or the slide
  // collapses to its floor and the thing being edited becomes unreadable — the
  // opposite of why editing moved into the overlay.
  const wanted = mode === "edit" ? 400 : mode === "comment" ? 260 : 180;
  const footerReserve = zoom === null ? wanted : Math.min(wanted, window.innerHeight * 0.45);
  const zoomWidth = zoom === null ? 0 : Math.min(
    1100,
    window.innerWidth - 140,
    Math.max(360, (window.innerHeight - footerReserve) * (BASE_W / BASE_H))
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
          <SlideThumb key={i} slide={s} index={i} onClick={() => open(i, "view")}
                      onComment={onSlideComment ? () => open(i, "comment") : undefined}
                      onEdit={onEdit ? () => open(i, "edit") : undefined} />
        ))}
      </div>

      {zoom !== null && (
        <SlideLightbox
          index={zoom} count={count} onClose={() => setZoom(null)} onIndex={(i) => { setZoom(i); setMode("view"); }}
          footer={
            mode === "edit" && onEdit ? (
              <SlideEditPanel
                key={`e${zoom}`}
                draft={draft}
                index={zoom}
                dark
                onText={(path, value) => onEdit(setSlideText(draft, zoom, path, value))}
                onImage={async (query) => {
                  const res = await fetch("/api/slides/image", {
                    method: "POST",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({ query, gradient: needsGradient(draft, zoom) }),
                  });
                  const j = await res.json();
                  if (!res.ok) { toast.error(j.error || "Couldn't change the image."); return; }
                  // Patched against the draft as it is when the picture ARRIVES,
                  // not as it was when it was asked for. Generating one takes
                  // tens of seconds, and the panel stays open and typeable
                  // throughout — so applying to the captured draft threw away
                  // every word written while waiting.
                  onEdit((cur) => setSlideImage(cur, zoom, j.url, query, j.credit, j.logo));
                }}
                onMove={(delta) => {
                  onEdit(moveSlide(draft, zoom, delta));
                  setZoom(Math.min(Math.max(0, zoom + delta), draft.slides.length - 1));
                }}
                onDelete={() => {
                  onEdit(deleteSlide(draft, zoom));
                  setZoom(null); setMode("view");
                }}
                onClose={() => setMode("view")}
                onSwitchToComment={onSlideComment ? () => setMode("comment") : undefined}
              />
            ) : mode === "comment" && onSlideComment ? (
              <SlideCommentBox
                key={`c${zoom}`}
                slideNumber={zoom + 1}
                slideTitle={slideTitle(zoom)}
                onSubmit={submitComment(zoom)}
                onCancel={() => setMode("view")}
                onSwitchToEdit={onEdit ? () => setMode("edit") : undefined}
                dark
              />
            ) : (
              // Viewing: offer the two ways to change this slide rather than
              // making the user close the overlay and find the right thumbnail.
              <div className="flex items-center justify-center gap-2">
                {onEdit && (
                  <Button size="sm" variant="secondary" onClick={() => setMode("edit")}>
                    Edit this slide
                  </Button>
                )}
                {onSlideComment && (
                  <Button size="sm" variant="secondary" onClick={() => setMode("comment")}>
                    Ask for a change
                  </Button>
                )}
              </div>
            )
          }
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
