"use client";

/**
 * Direct controls for one slide: change its words, change its picture, move it,
 * remove it.
 *
 * Everything here except the picture is instant and local. Slide geometry is
 * fixed by the brand grid, so new text needs no re-layout — and a model
 * round-trip to change a heading is slow, spends tokens re-emitting untouched
 * slides, and lets it reword them on the way past.
 */

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Loader2, Trash2, ArrowUp, ArrowDown, ImageIcon } from "lucide-react";
import type { SlideDraft } from "./SlideDraftPreview";
import { editableFields } from "@/lib/slides/draft-edit";

export default function SlideEditPanel({
  draft, index, onText, onImage, onMove, onDelete, onClose, onSwitchToComment, dark,
}: {
  draft: SlideDraft;
  index: number;
  onText: (path: any, value: string) => void;
  /** Hand over to the model without closing the overlay first. */
  onSwitchToComment?: () => void;
  onImage: (query: string) => Promise<void>;
  onMove: (delta: number) => void;
  onDelete: () => void;
  onClose: () => void;
  dark?: boolean;
}) {
  const fields = editableFields(draft, index);
  const [imageQuery, setImageQuery] = useState("");
  const [busy, setBusy] = useState(false);
  const hasImage = (draft.slides[index] as any)?.resolvedImage?.url;

  const label = dark ? "text-white/70" : "text-muted-foreground";
  const input = `w-full resize-none rounded border px-2 py-1.5 text-sm outline-none focus:ring-1 focus:ring-primary/40 ${
    dark ? "bg-black/30 border-white/15 text-white placeholder:text-white/40" : "bg-background"
  }`;

  const changeImage = async () => {
    if (!imageQuery.trim()) return;
    setBusy(true);
    try { await onImage(imageQuery.trim()); setImageQuery(""); }
    finally { setBusy(false); }
  };

  return (
    <div className={`rounded-lg border p-3 ${dark ? "bg-black/40 border-white/15" : "bg-background"}`}>
      <div className="flex items-center justify-between mb-2.5">
        <span className={`text-xs font-medium ${dark ? "text-white/80" : ""}`}>Slide {index + 1}</span>
        <div className="flex items-center gap-1">
          <button onClick={() => onMove(-1)} disabled={index === 0} aria-label="Move slide up"
                  className={`h-7 w-7 rounded flex items-center justify-center disabled:opacity-25 ${dark ? "hover:bg-white/10 text-white/80" : "hover:bg-muted"}`}>
            <ArrowUp className="h-3.5 w-3.5" />
          </button>
          <button onClick={() => onMove(1)} disabled={index === draft.slides.length - 1} aria-label="Move slide down"
                  className={`h-7 w-7 rounded flex items-center justify-center disabled:opacity-25 ${dark ? "hover:bg-white/10 text-white/80" : "hover:bg-muted"}`}>
            <ArrowDown className="h-3.5 w-3.5" />
          </button>
          <button onClick={onDelete} disabled={draft.slides.length <= 1} aria-label="Delete slide"
                  title={draft.slides.length <= 1 ? "A deck needs at least one slide" : "Delete this slide"}
                  className={`h-7 w-7 rounded flex items-center justify-center disabled:opacity-25 ${dark ? "hover:bg-white/10 text-white/80" : "hover:bg-muted"} text-destructive`}>
            <Trash2 className="h-3.5 w-3.5" />
          </button>
        </div>
      </div>

      <div className="space-y-2.5 max-h-[38vh] overflow-y-auto pr-1">
        {fields.map(({ path, label: name, value, multiline }) => (
          <div key={path.join(".")}>
            <label className={`block text-[11px] mb-1 ${label}`}>{name}</label>
            <textarea
              value={value}
              rows={multiline ? 3 : 1}
              onChange={(e) => onText(path, e.target.value)}
              className={input}
              placeholder={multiline ? "One bullet per line" : ""}
            />
          </div>
        ))}
        {fields.length === 0 && (
          <p className={`text-xs ${label}`}>This slide has no editable text.</p>
        )}

        <div>
          <label className={`block text-[11px] mb-1 ${label}`}>
            {hasImage ? "Change the picture" : "Add a picture"}
          </label>
          <div className="flex gap-2">
            <input
              value={imageQuery}
              onChange={(e) => setImageQuery(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); void changeImage(); } }}
              placeholder="e.g. wind turbines at dusk"
              className={input}
            />
            <Button size="sm" onClick={() => void changeImage()} disabled={busy || !imageQuery.trim()} className="shrink-0">
              {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <ImageIcon className="h-3.5 w-3.5" />}
            </Button>
          </div>
        </div>
      </div>

      <div className="flex items-center justify-between mt-3">
        {onSwitchToComment ? (
          <Button size="sm" variant="ghost" onClick={onSwitchToComment}
                  className={dark ? "text-white/70 hover:text-white hover:bg-white/10" : ""}>
            Ask for a change instead
          </Button>
        ) : <span />}
        <Button size="sm" variant="ghost" onClick={onClose}
                className={dark ? "text-white/70 hover:text-white hover:bg-white/10" : ""}>
          Done
        </Button>
      </div>
    </div>
  );
}
