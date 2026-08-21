"use client";

/**
 * The findings panel.
 *
 * Every card shows the REWRITE, not advice about a rewrite. "Add a source to
 * this statistic" is a task; the sentence with its source already in it is a
 * decision, and a decision takes a click. That distinction is the difference
 * between this and the tools whose recommendations reviewers call generic.
 *
 * Orphans are shown, not hidden. A finding whose quote can no longer be located
 * is still true — only its anchor is lost — and a writer who fixed the sentence
 * themselves should see that the tool noticed rather than watch the note
 * silently vanish.
 */

import { cn } from "@/lib/utils";
import { Check, X, Pencil, AlertCircle } from "lucide-react";
import type { Issue } from "@/lib/optimizer/highlight-plugin";

interface Props {
  issues: Issue[];
  selectedId: string | null;
  onSelect: (id: string | null) => void;
  onApply: (id: string) => void;
  onDismiss: (id: string) => void;
  /** Findings the judge produced that never reached a card, and why. */
  diagnostics?: { dropped: number; orphaned: number; gateRejected: number } | null;
  degraded?: boolean;
  /** Whether an assessment has ever run. Without it, "nothing to fix" and
   *  "nothing has been checked" render as the same sentence and mean opposite
   *  things — the exact error the diagnostics footer exists to prevent one
   *  level down. */
  hasAssessed?: boolean;
  onAssess?: () => void;
}

const SEVERITY_DOT: { [k: string]: string } = {
  high: "bg-[hsl(var(--ai-negative))]",
  medium: "bg-amber-500",
  low: "bg-blue-500",
};

export default function IssueList({
  issues, selectedId, onSelect, onApply, onDismiss, diagnostics, degraded, hasAssessed, onAssess,
}: Props) {
  const open = issues.filter((i) => i.status === "active");
  const orphaned = issues.filter((i) => i.status === "orphaned");
  const done = issues.filter((i) => i.status === "resolved" || i.status === "dismissed");

  return (
    <div className="flex flex-col min-h-0 h-full">
      {degraded && (
        <div className="shrink-0 mx-3 mt-2 rounded-lg border border-amber-500/40 bg-amber-500/10 px-2.5 py-2">
          <p className="text-[11.5px] leading-snug text-amber-700 dark:text-amber-400">
            Suggestions were not quality-checked this run. They are still anchored and safe to apply,
            but nothing filtered the weak ones.
          </p>
        </div>
      )}

      <div className="flex-1 min-h-0 overflow-y-auto px-3 py-2 flex flex-col gap-1.5">
        {open.length === 0 && orphaned.length === 0 && !hasAssessed && (
          <div className="px-1 py-3 flex flex-col gap-2 items-start">
            <p className="text-[12.5px] text-muted-foreground leading-snug">
              This draft hasn&apos;t been assessed yet. The live score on the other tab is the
              deterministic half; an assessment adds the judgement half and anchors suggestions
              to specific sentences.
            </p>
            {onAssess && (
              <button
                onClick={onAssess}
                className="h-7 px-2.5 rounded-lg bg-primary text-primary-foreground text-[12px] font-semibold"
              >
                Assess this draft
              </button>
            )}
          </div>
        )}
        {open.length === 0 && orphaned.length === 0 && hasAssessed && done.length === 0 && (
          <p className="text-[12.5px] text-muted-foreground px-1 py-3 leading-snug">
            Assessed — nothing outstanding. The judge found no anchored issues in this draft.
          </p>
        )}
        {open.length === 0 && orphaned.length === 0 && hasAssessed && done.length > 0 && (
          <p className="text-[12.5px] text-muted-foreground px-1 py-3 leading-snug">
            All suggestions handled. Re-assess to check the draft as it stands now.
          </p>
        )}

        {open.map((issue) => {
          const f = issue.finding;
          const selected = selectedId === f.id;
          return (
            <div
              key={f.id}
              onClick={() => onSelect(selected ? null : f.id)}
              className={cn(
                "rounded-xl border bg-card p-2.5 cursor-pointer transition-colors",
                selected ? "border-primary/50 bg-primary/[0.04]" : "hover:border-foreground/20"
              )}
            >
              <div className="flex items-center gap-2 mb-1">
                <span className={cn("w-[7px] h-[7px] rounded-full shrink-0", SEVERITY_DOT[f.severity])} />
                <span className="text-[12px] font-semibold flex-1 min-w-0 truncate">
                  {f.criterion.replace(/-/g, " ")}
                </span>
              </div>

              <p className="text-[11.5px] leading-snug text-muted-foreground mb-1.5">{f.explanation}</p>

              {selected && (
                <>
                  <p className="text-[11.5px] leading-snug text-muted-foreground/80 mb-1.5 line-clamp-2">
                    &ldquo;{f.quote}&rdquo;
                  </p>
                  {f.suggestedEdit ? (
                    <div className="rounded-lg border border-emerald-500/25 bg-emerald-500/[0.06] px-2.5 py-2 mb-2">
                      <p className="text-[12px] leading-snug">{f.suggestedEdit}</p>
                    </div>
                  ) : (
                    <p className="text-[11px] text-muted-foreground mb-2 italic">
                      No single-span rewrite for this one — it needs a judgement call.
                    </p>
                  )}
                  <div className="flex items-center gap-1.5">
                    {f.suggestedEdit && (
                      <button
                        onClick={(e) => { e.stopPropagation(); onApply(f.id); }}
                        className="inline-flex items-center gap-1.5 h-7 px-2.5 rounded-lg bg-primary text-primary-foreground text-[12px] font-semibold"
                      >
                        <Check className="h-3 w-3" /> Apply
                      </button>
                    )}
                    <button
                      onClick={(e) => { e.stopPropagation(); onSelect(f.id); }}
                      className="inline-flex items-center gap-1.5 h-7 px-2.5 rounded-lg border text-[12px] font-medium"
                      title="Jump to it in the draft and edit by hand"
                    >
                      <Pencil className="h-3 w-3" /> Edit
                    </button>
                    <button
                      onClick={(e) => { e.stopPropagation(); onDismiss(f.id); }}
                      className="inline-flex items-center gap-1.5 h-7 px-2.5 rounded-lg text-[12px] font-medium text-muted-foreground"
                    >
                      <X className="h-3 w-3" /> Dismiss
                    </button>
                  </div>
                </>
              )}
            </div>
          );
        })}

        {orphaned.map((issue) => (
          <div key={issue.finding.id} className="rounded-xl border border-dashed bg-muted/30 p-2.5">
            <div className="flex items-center gap-2 mb-1">
              <AlertCircle className="h-3 w-3 text-muted-foreground shrink-0" />
              <span className="text-[12px] font-semibold flex-1 min-w-0 truncate text-muted-foreground">
                {issue.finding.criterion.replace(/-/g, " ")}
              </span>
              <button
                onClick={() => onDismiss(issue.finding.id)}
                className="text-[11px] text-muted-foreground hover:text-foreground shrink-0"
              >
                Dismiss
              </button>
            </div>
            <p className="text-[11.5px] leading-snug text-muted-foreground line-through mb-1">
              &ldquo;{issue.finding.quote.slice(0, 90)}&rdquo;
            </p>
            <p className="text-[11px] text-muted-foreground">
              Couldn&apos;t find this passage any more — the text has changed since it was assessed.
            </p>
          </div>
        ))}

        {done.length > 0 && (
          <p className="text-[11px] text-muted-foreground px-1 pt-1">
            {done.filter((d) => d.status === "resolved").length} applied ·{" "}
            {done.filter((d) => d.status === "dismissed").length} dismissed
          </p>
        )}
      </div>

      {/* What the judge produced that never reached a card. "Found nothing" and
          "found eight and every quote was unmatchable" mean opposite things and
          would otherwise look identical. */}
      {diagnostics && (diagnostics.dropped > 0 || diagnostics.orphaned > 0 || diagnostics.gateRejected > 0) && (
        <div className="shrink-0 px-4 py-2 border-t">
          <p className="text-[10.5px] text-muted-foreground leading-snug">
            {diagnostics.gateRejected > 0 && `${diagnostics.gateRejected} suggestion${diagnostics.gateRejected === 1 ? "" : "s"} filtered as weak or unsupported. `}
            {diagnostics.dropped > 0 && `${diagnostics.dropped} could not be quoted back to the draft. `}
            {diagnostics.orphaned > 0 && `${diagnostics.orphaned} could not be located.`}
          </p>
        </div>
      )}
    </div>
  );
}
