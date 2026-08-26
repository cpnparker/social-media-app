"use client";

/**
 * The card at the mark.
 *
 * Before this, every interaction with a finding meant shuttling to the right
 * panel: click a highlight, then move your eyes 600px right to read why it was
 * highlighted, then move back to edit. A checker the writer lives with —
 * Grammarly is the reference class — explains the problem AT the text and
 * offers its actions there, because that is where the writer's attention
 * already is. The panel remains the overview; this is the working surface.
 *
 * Positioning: anchored to the START of the issue's span via coordsAtPos,
 * rendered inside the editor's scroll container so it scrolls WITH the text
 * rather than floating over the wrong sentence after a scroll. Flips above the
 * line when there is no room below.
 */

import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { findingSource } from "@/lib/optimizer/highlight-plugin";
import type { Editor } from "@tiptap/react";
import { Button } from "@/components/ui/button";
import { Check, ChevronRight, Loader2, Pencil, Sparkles, X } from "lucide-react";
import { cn } from "@/lib/utils";
import type { Issue } from "@/lib/optimizer/highlight-plugin";

/** Shared with IssueList so the two surfaces never disagree on a name. */
export const CRITERION_LABEL: { [k: string]: string } = {
  "stat-source-adjacency": "Figure with no source",
  "ai-tell-guard": "Reads as AI-written",
  "sentence-length-norm": "Sentence runs long",
  "question-headings": "Heading is not a question",
  "answer-first-position": "Answer buried",
  "opening-quotability": "Opening can't stand alone",
  "quote-attribution-quality": "Quote isn't citable",
  "chunk-self-containment": "Section depends on earlier text",
  "semantic-query-coverage": "Half-answers the target query",
  "entity-variant-drift": "Name written inconsistently",
  "experience-substantiation": "Experience claim with nothing behind it",
  "unsourced-absolute-claims": "Absolute claim, no source",
  "attributed-quotes": "Quote with no speaker",
  "current-year-stats": "Statistic is undated",
  "keyword-stuffing-guard": "Term repeated past usefulness",
  "pronoun-opening-chunks": "Section opens on a pronoun",
  "heading-answer-adjacency": "Heading's answer doesn't follow it",
  "anonymous-first-person-facts": "Fact says \"we\" — the brand doesn't travel",
  "unverifiable-superlatives": "Superlative with nothing behind it",
  "tldr-block": "Takeaway bullet can't stand alone",
  "dateline-recency": "No visible date",
};

export function criterionLabel(key: string): string {
  return CRITERION_LABEL[key] || key.replace(/-/g, " ");
}

const SEVERITY_DOT: { [k: string]: string } = {
  high: "bg-[hsl(var(--ai-negative))]",
  medium: "bg-amber-500",
  low: "bg-primary",
};

interface Props {
  editor: Editor | null;
  issue: Issue | null;
  /** The scroll container the popover positions inside. */
  containerRef: React.RefObject<HTMLDivElement | null>;
  onDismiss: (id: string) => void;
  onApply: (id: string) => void;
  onNext: () => void;
  onClose: () => void;
  /** Generate a rewrite for this finding on demand. */
  onAiFix: (id: string) => void;
  /** The rewrite that came back, when one has. */
  aiEdit?: string;
  aiFixing?: boolean;
  /** Put the caret on the span and close — the "I'll do it myself" path. */
  onManualEdit: (id: string) => void;
  applying?: boolean;
  /** How many active issues exist, for the "next" affordance. */
  activeCount: number;
}

export default function IssuePopover({
  editor, issue, containerRef, onDismiss, onApply, onNext, onClose,
  onAiFix, aiEdit, aiFixing, onManualEdit, applying, activeCount,
}: Props) {
  const popRef = useRef<HTMLDivElement | null>(null);
  const [pos, setPos] = useState<{ top: number; left: number; above: boolean } | null>(null);

  // Position against the span start, in the CONTAINER's coordinate space.
  // Recomputed when the issue changes and when the container resizes; scrolling
  // needs nothing because the popover lives inside the scrolled element.
  useLayoutEffect(() => {
    if (!editor || !issue || issue.status !== "active" || !containerRef.current) {
      setPos(null);
      return;
    }
    try {
      const coords = editor.view.coordsAtPos(Math.min(issue.from, editor.state.doc.content.size));
      const box = containerRef.current.getBoundingClientRect();
      const top = coords.bottom - box.top + containerRef.current.scrollTop;
      const left = Math.max(12, Math.min(coords.left - box.left, box.width - 340));
      // Flip above when the mark sits in the bottom quarter of the viewport.
      const above = coords.bottom > window.innerHeight - 220;
      setPos({
        top: above ? coords.top - box.top + containerRef.current.scrollTop : top,
        left,
        above,
      });
    } catch {
      setPos(null);
    }
  }, [editor, issue, containerRef]);

  // Escape closes; it is the one keyboard affordance nobody has to learn.
  useEffect(() => {
    if (!issue) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [issue, onClose]);

  if (!issue || issue.status !== "active" || !pos) return null;
  const f = issue.finding;
  const source = findingSource(f.id);
  const isLive = source === "live";

  return (
    <div
      ref={popRef}
      className={cn(
        "absolute z-30 w-[330px] rounded-xl border bg-popover text-popover-foreground shadow-lg",
        "p-3 flex flex-col gap-2",
        pos.above && "-translate-y-full -mt-2"
      )}
      style={{ top: pos.top + (pos.above ? 0 : 6), left: pos.left }}
      // The editor treats outside mousedown as blur; keep the caret where it is.
      onMouseDown={(e) => e.preventDefault()}
    >
      <div className="flex items-center gap-2">
        <span className={cn("w-[7px] h-[7px] rounded-full shrink-0", SEVERITY_DOT[f.severity] || SEVERITY_DOT.low)} />
        <span className="text-[12.5px] font-semibold flex-1 min-w-0 truncate">{criterionLabel(f.criterion)}</span>
        <span className="text-[10px] uppercase tracking-wide text-muted-foreground shrink-0">
          {isLive ? "instant" : "AI review"}
        </span>
        <button onClick={onClose} className="p-0.5 rounded hover:bg-muted shrink-0" aria-label="Close">
          <X className="h-3.5 w-3.5 text-muted-foreground" />
        </button>
      </div>

      <p className="text-[12px] leading-snug text-muted-foreground">{f.explanation}</p>

      {(f.suggestedEdit || aiEdit) && (
        <div className="rounded-lg border border-emerald-500/25 bg-emerald-500/[0.06] px-2.5 py-2">
          <p className="text-[10.5px] font-semibold uppercase tracking-wide text-muted-foreground mb-1">
            Suggested rewrite
          </p>
          <p className="text-[12px] leading-snug">{f.suggestedEdit || aiEdit}</p>
        </div>
      )}

      <div className="flex items-center gap-1.5 pt-0.5 flex-wrap">
        {(f.suggestedEdit || aiEdit) ? (
          <Button size="sm" className="h-7 px-2.5 text-[12px]" disabled={applying} onClick={() => onApply(f.id)}>
            {applying ? <Loader2 className="h-3 w-3 animate-spin" /> : <Check className="h-3 w-3" />}
            Apply
          </Button>
        ) : (
          <Button size="sm" className="h-7 px-2.5 text-[12px]" disabled={!!aiFixing} onClick={() => onAiFix(f.id)}>
            {aiFixing ? <Loader2 className="h-3 w-3 animate-spin" /> : <Sparkles className="h-3 w-3" />}
            {aiFixing ? "Writing…" : "Fix with AI"}
          </Button>
        )}
        <Button size="sm" variant="outline" className="h-7 px-2.5 text-[12px]" onClick={() => onManualEdit(f.id)}>
          <Pencil className="h-3 w-3" />
          Edit
        </Button>
        <Button size="sm" variant="ghost" className="h-7 px-2.5 text-[12px] text-muted-foreground" onClick={() => onDismiss(f.id)}>
          Dismiss
        </Button>
        <div className="flex-1" />
        {activeCount > 1 && (
          <Button size="sm" variant="ghost" className="h-7 px-2 text-[12px] text-muted-foreground" onClick={onNext}>
            Next
            <ChevronRight className="h-3 w-3" />
          </Button>
        )}
      </div>
    </div>
  );
}
