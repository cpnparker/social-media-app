"use client";

/**
 * Ask for a change to one slide, without having to say which slide.
 *
 * The friction this removes is small and constant: having read slide 4 and
 * decided the subtitle is wrong, the user had to look away, work out that it
 * was slide 4, and type that number back. Commenting on the slide itself
 * carries the reference, so what they write is only the change they want.
 */

import { useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";

export default function SlideCommentBox({
  slideNumber, slideTitle, onSubmit, onCancel, dark, noun = "Slide", placeholder,
}: {
  slideNumber: number;
  slideTitle?: string;
  noun?: string;
  placeholder?: string;
  onSubmit: (text: string) => void;
  onCancel: () => void;
  /** Over the lightbox the surface is dark; in the card it is not. */
  dark?: boolean;
}) {
  const [text, setText] = useState("");
  const ref = useRef<HTMLTextAreaElement>(null);

  // Opening the box IS the decision to write something, so take the caret.
  useEffect(() => { ref.current?.focus(); }, []);

  const send = () => {
    const t = text.trim();
    if (!t) return;
    onSubmit(t);
    setText("");
  };

  return (
    <div className={`rounded-lg border p-2.5 ${dark ? "bg-black/40 border-white/15" : "bg-background"}`}>
      <label className={`block text-xs mb-1.5 ${dark ? "text-white/70" : "text-muted-foreground"}`}>
        {noun} {slideNumber}{slideTitle ? ` — ${slideTitle}` : ""}: what should change?
      </label>
      <textarea
        ref={ref}
        value={text}
        onChange={(e) => setText(e.target.value)}
        onKeyDown={(e) => {
          // Enter sends, Shift+Enter breaks the line — the same contract as the
          // message composer, so the habit carries over.
          if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); send(); }
          if (e.key === "Escape") { e.preventDefault(); e.stopPropagation(); onCancel(); }
        }}
        rows={2}
        placeholder={placeholder || "e.g. tighten the subtitle, drop the third bullet, make the dates bolder"}
        className={`w-full resize-none rounded border px-2 py-1.5 text-sm outline-none focus:ring-1 focus:ring-primary/40 ${
          dark ? "bg-black/30 border-white/15 text-white placeholder:text-white/40" : "bg-background"
        }`}
      />
      <div className="flex items-center justify-end gap-2 mt-2">
        <Button size="sm" variant="ghost" onClick={onCancel}
                className={dark ? "text-white/70 hover:text-white hover:bg-white/10" : ""}>
          Cancel
        </Button>
        <Button size="sm" onClick={send} disabled={!text.trim()}>Send change</Button>
      </div>
    </div>
  );
}
