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

import { Button } from "@/components/ui/button";
import { Loader2 } from "lucide-react";

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

function SlideThumb({ slide, index }: { slide: PreviewSlide; index: number }) {
  const scale = THUMB_W / BASE_W;
  return (
    <div
      className="rounded border overflow-hidden shrink-0 bg-white"
      style={{ width: THUMB_W, height: BASE_H * scale }}
      aria-label={`Slide ${index + 1}`}
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
  );
}

export default function SlideDraftPreview({
  draft, onPublish, publishing, disabled,
}: {
  draft: SlideDraft;
  onPublish: () => void;
  publishing: boolean;
  disabled?: boolean;
}) {
  const count = draft.preview.slides.length;
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
        {draft.preview.slides.map((s, i) => <SlideThumb key={i} slide={s} index={i} />)}
      </div>

      <p className="text-xs text-muted-foreground mt-2.5">
        Ask for any changes and the preview updates. Nothing reaches your Drive until you create it.
      </p>
    </div>
  );
}
