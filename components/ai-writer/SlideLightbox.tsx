"use client";

/**
 * Full-size view of one slide, over the conversation.
 *
 * Thumbnails sized to sit two-across in the chat column are legible as a
 * layout and not as a document — you can see that a slide has a timeline on it
 * without being able to read the timeline. This exists so a deck can be read
 * before it is agreed to, which is the point of previewing it at all.
 *
 * Deliberately renders whatever it is handed rather than owning a slide
 * renderer: a draft passes its locally drawn slide, a published deck passes
 * Google's thumbnail, and both get the same navigation.
 */

import { useCallback, useEffect } from "react";
import { X, ChevronLeft, ChevronRight } from "lucide-react";

export default function SlideLightbox({
  index, count, onClose, onIndex, children, footer, noun = "Slide",
}: {
  index: number;
  count: number;
  onClose: () => void;
  onIndex: (next: number) => void;
  children: React.ReactNode;
  /** What is being viewed. The overlay is shared by decks and images, and
   *  "Slide 1 of 1" over a photograph is just wrong. */
  noun?: string;
  /** Rendered under the slide — used for the per-slide comment box, so a
   *  change can be asked for at the moment the slide is legible enough to
   *  judge, rather than after closing and hunting for the right thumbnail. */
  footer?: React.ReactNode;
}) {
  const go = useCallback((delta: number) => {
    // Clamped rather than wrapping: a deck is a sequence, and looping from the
    // last slide to the first reads as a mis-click.
    onIndex(Math.min(count - 1, Math.max(0, index + delta)));
  }, [index, count, onIndex]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const el = e.target as HTMLElement | null;
      const typing = !!el && (el.tagName === "TEXTAREA" || el.tagName === "INPUT" || el.isContentEditable);
      if (e.key === "Escape") onClose();
      // Arrow keys move the caret while someone is writing a comment.
      else if (typing) return;
      else if (e.key === "ArrowRight") go(1);
      else if (e.key === "ArrowLeft") go(-1);
    };
    window.addEventListener("keydown", onKey);
    // The conversation behind should not scroll under the overlay.
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      window.removeEventListener("keydown", onKey);
      document.body.style.overflow = prev;
    };
  }, [go, onClose]);

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label={`${noun} ${index + 1} of ${count}`}
      onClick={onClose}
      className="fixed inset-0 z-50 bg-black/80 backdrop-blur-sm flex flex-col items-center justify-center p-4 sm:p-8"
    >
      <div className="flex items-center justify-between w-full max-w-[1100px] mb-3">
        <span className="text-xs text-white/70 tabular-nums">
          {noun} {index + 1} of {count}
        </span>
        <button
          onClick={onClose}
          aria-label="Close"
          className="h-8 w-8 rounded-lg flex items-center justify-center text-white/80 hover:text-white hover:bg-white/10"
        >
          <X className="h-4 w-4" />
        </button>
      </div>

      <div className="flex items-center gap-2 sm:gap-4 w-full justify-center">
        <button
          onClick={(e) => { e.stopPropagation(); go(-1); }}
          disabled={index === 0}
          aria-label={`Previous ${noun.toLowerCase()}`}
          className="shrink-0 h-10 w-10 rounded-full flex items-center justify-center text-white/80 hover:text-white hover:bg-white/10 disabled:opacity-25 disabled:hover:bg-transparent"
        >
          <ChevronLeft className="h-6 w-6" />
        </button>

        {/* Stops a click on the slide itself from dismissing the overlay. */}
        <div onClick={(e) => e.stopPropagation()} className="shrink-0">
          {children}
        </div>

        <button
          onClick={(e) => { e.stopPropagation(); go(1); }}
          disabled={index === count - 1}
          aria-label={`Next ${noun.toLowerCase()}`}
          className="shrink-0 h-10 w-10 rounded-full flex items-center justify-center text-white/80 hover:text-white hover:bg-white/10 disabled:opacity-25 disabled:hover:bg-transparent"
        >
          <ChevronRight className="h-6 w-6" />
        </button>
      </div>

      {footer && (
        <div onClick={(e) => e.stopPropagation()} className="w-full max-w-[1100px] mt-4">
          {footer}
        </div>
      )}
    </div>
  );
}
