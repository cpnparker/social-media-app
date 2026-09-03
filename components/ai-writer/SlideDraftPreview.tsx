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

import React, { useState, useEffect, useRef } from "react";
import { toast } from "sonner";
import { setSlideText, setSlideImage, moveSlide, deleteSlide } from "@/lib/slides/draft-edit";
import { Button } from "@/components/ui/button";
import { Loader2 } from "lucide-react";
import SlideLightbox from "./SlideLightbox";
import SlideCommentBox from "./SlideCommentBox";
import SlideEditPanel from "./SlideEditPanel";
import { MessageSquarePlus, Pencil, Trash2, Plus } from "lucide-react";

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
  line: string, offset: number,
  links?: { start: number; end: number; url: string }[],
  accents?: { start: number; end: number; italic?: boolean; color?: string }[]
) {
  const runs = runsOf(line, offset, links, accents);
  if (runs.length === 1 && !runs[0].url && !runs[0].italic && !runs[0].color) return line;
  return runs.map((run, i) => {
    const style: React.CSSProperties = {};
    if (run.url) style.textDecoration = "underline";
    if (run.italic) style.fontStyle = "italic";
    if ((run as any).bold) style.fontWeight = 700;
    if (run.color) style.color = run.color;
    return Object.keys(style).length ? <span key={i} style={style}>{run.text}</span> : <span key={i}>{run.text}</span>;
  });
}

function SlideThumb({
  slide, index, width = THUMB_W, onClick, onComment, onEdit, onDelete,
}: {
  slide: PreviewSlide; index: number; width?: number;
  onClick?: () => void; onComment?: () => void; onEdit?: () => void;
  onDelete?: () => void;
}) {
  const scale = width / BASE_W;
  // Two-step, in place. Delete is the only destructive control on this card and
  // it sits a few pixels from Edit, so a single click is too easy to land by
  // accident. A browser confirm() would be worse — it covers the very thumbnail
  // it is asking about. The confirm replaces the button where it already is,
  // and gives up after a few seconds so it never sits there armed.
  const [confirming, setConfirming] = useState(false);
  useEffect(() => {
    if (!confirming) return;
    const t = setTimeout(() => setConfirming(false), 4000);
    return () => clearTimeout(t);
  }, [confirming]);
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
                  : el.arrowDown
                  ? { clipPath: "polygon(30% 0%, 70% 0%, 70% 55%, 100% 55%, 50% 100%, 0% 55%, 30% 55%)" }
                  : {}),
                ...(el.dashed ? { border: "1.5px dashed #3950FF", background: el.fill || "transparent" } : {}),
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
              ...(el.vCenter || el.vBottom
                ? {
                    display: "flex",
                    flexDirection: "column" as const,
                    justifyContent: el.vBottom ? ("flex-end" as const) : ("center" as const),
                  }
                : {}),
            }}>
              {lines.length > 1
                ? lines.map((line, li) => {
                    const spacing = li < lines.length - 1 ? { marginBottom: gap } : undefined;
                    const drawn = renderRuns(line, lineOffset(lines, li), el.links, el.accents);
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
                : renderRuns(el.text || "", 0, el.links, el.accents)}
            </div>
          );
        })}
      </div>
    </div>
      {(onEdit || onComment || onDelete) && (
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
          {onDelete && (
            confirming ? (
              <button
                type="button"
                onClick={(e) => { e.stopPropagation(); setConfirming(false); onDelete(); }}
                aria-label={`Confirm delete slide ${index + 1}`}
                title="Click again to remove this slide"
                className="h-7 rounded-md px-2 bg-destructive text-destructive-foreground border border-destructive shadow-sm flex items-center gap-1 text-[11px] font-medium focus-visible:ring-2 focus-visible:ring-destructive/50"
              >
                <Trash2 className="h-3.5 w-3.5" />Remove?
              </button>
            ) : (
              <button
                type="button"
                onClick={(e) => { e.stopPropagation(); setConfirming(true); }}
                aria-label={`Delete slide ${index + 1}`}
                title="Remove this slide from the deck"
                className="h-7 w-7 rounded-md bg-background/90 border shadow-sm flex items-center justify-center text-muted-foreground hover:text-destructive focus:opacity-100 focus-visible:ring-2 focus-visible:ring-primary/40"
              >
                <Trash2 className="h-3.5 w-3.5" />
              </button>
            )
          )}
        </div>
      )}
    </div>
  );
}

/**
 * The gap between two slides, as a place to add one.
 *
 * A button BETWEEN the thumbnails rather than an "add slide" at the end,
 * because position is half the instruction: the user is pointing at where the
 * new slide goes, so they should not also have to describe where it goes. What
 * they type is only what it should SHOW.
 *
 * It sends the request to the model rather than inserting an empty slide,
 * because a new slide needs content written — which is the one thing local
 * patching cannot do. Removing a slide stays local for the mirror-image reason.
 */
function InsertGap({ afterIndex, onInsert }: { afterIndex: number; onInsert: (afterIndex: number, description: string) => void }) {
  const [open, setOpen] = useState(false);
  const [text, setText] = useState("");
  const ref = useRef<HTMLTextAreaElement | null>(null);
  useEffect(() => { if (open) ref.current?.focus(); }, [open]);

  const submit = () => {
    const description = text.trim();
    if (!description) return;
    onInsert(afterIndex, description);
    setText("");
    setOpen(false);
  };

  if (!open) {
    return (
      // A thin target that stays in the DOM for keyboard users and only shows
      // its outline on hover, so twenty of these do not turn the strip into a
      // dotted grid.
      <button
        type="button"
        onClick={() => setOpen(true)}
        aria-label={afterIndex < 0 ? "Add a slide at the start" : `Add a slide after slide ${afterIndex + 1}`}
        title={afterIndex < 0 ? "Add a slide here" : `Add a slide after slide ${afterIndex + 1}`}
        className="self-stretch w-6 shrink-0 rounded flex items-center justify-center text-muted-foreground/0 hover:text-primary hover:bg-primary/5 focus-visible:opacity-100 focus-visible:text-primary focus-visible:ring-2 focus-visible:ring-primary/40 transition-colors"
      >
        <Plus className="h-4 w-4" />
      </button>
    );
  }

  return (
    <div className="shrink-0 w-[330px] rounded border bg-background p-2.5 flex flex-col gap-2">
      <p className="text-xs font-medium">
        {afterIndex < 0 ? "New slide at the start" : `New slide after slide ${afterIndex + 1}`}
      </p>
      <textarea
        ref={ref}
        value={text}
        onChange={(e) => setText(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) { e.preventDefault(); submit(); }
          if (e.key === "Escape") { setOpen(false); setText(""); }
        }}
        rows={3}
        placeholder="What should this slide show? e.g. the four parts of strategy-lite, as cards"
        className="w-full resize-none rounded border bg-background px-2 py-1.5 text-xs focus:outline-none focus-visible:ring-2 focus-visible:ring-primary/40"
      />
      <div className="flex items-center gap-2">
        <Button size="sm" className="h-7 text-xs" onClick={submit} disabled={!text.trim()}>Add slide</Button>
        <button
          type="button"
          onClick={() => { setOpen(false); setText(""); }}
          className="text-xs text-muted-foreground hover:text-foreground"
        >
          Cancel
        </button>
      </div>
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
  draft, onPublish, publishing, disabled, onSlideComment, onEdit, onSlideInsert,
}: {
  draft: SlideDraft;
  onPublish: () => void;
  publishing: boolean;
  disabled?: boolean;
  /** Sends a change request scoped to one slide. */
  onSlideComment?: (index: number, text: string) => void;
  /** Direct edits, applied locally without involving the model. */
  onEdit?: (next: SlideDraft | ((cur: SlideDraft) => SlideDraft)) => void;
  /** Asks the model for a NEW slide at a position. -1 means before the first. */
  onSlideInsert?: (afterIndex: number, description: string) => void;
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
  // The PDF export: the server re-derives the preview from the spec and prints
  // it, so the file is what a fresh preview would show — not a snapshot of
  // whatever this component happens to have rendered.
  const [pdfBusy, setPdfBusy] = useState(false);
  const downloadPdf = async () => {
    setPdfBusy(true);
    try {
      const res = await fetch("/api/slides/pdf", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ slides: draft.slides, title: draft.title }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        toast.error(err.error || "PDF export failed");
        return;
      }
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `${(draft.title || "deck").replace(/[^\w\s-]/g, "").trim().replace(/\s+/g, "-").toLowerCase() || "deck"}.pdf`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    } finally {
      setPdfBusy(false);
    }
  };
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
        <div className="flex items-center gap-2 shrink-0">
          <Button size="sm" variant="outline" onClick={downloadPdf} disabled={pdfBusy || disabled}>
            {pdfBusy ? (
              <><Loader2 className="h-3.5 w-3.5 mr-1.5 animate-spin" />Printing…</>
            ) : "Download PDF"}
          </Button>
          <Button size="sm" onClick={onPublish} disabled={publishing || disabled}>
            {publishing ? (
              <><Loader2 className="h-3.5 w-3.5 mr-1.5 animate-spin" />Creating…</>
            ) : "Create in Google Slides"}
          </Button>
        </div>
      </div>

      <div className="flex flex-wrap gap-2 items-stretch">
        {onSlideInsert && <InsertGap afterIndex={-1} onInsert={onSlideInsert} />}
        {draft.preview.slides.map((s, i) => (
          <React.Fragment key={i}>
            <SlideThumb slide={s} index={i} onClick={() => open(i, "view")}
                        onComment={onSlideComment ? () => open(i, "comment") : undefined}
                        onEdit={onEdit ? () => open(i, "edit") : undefined}
                        // Guarded, not hidden: with one slide left there is
                        // nothing to delete down to, and a button that silently
                        // does nothing is worse than one that is not offered.
                        onDelete={onEdit && count > 1 ? () => onEdit(deleteSlide(draft, i)) : undefined} />
            {onSlideInsert && <InsertGap afterIndex={i} onInsert={onSlideInsert} />}
          </React.Fragment>
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
