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

/**
 * Human names for the criteria a finding can carry.
 *
 * The raw key was being printed with its hyphens swapped for spaces, so a card
 * read "stat source adjacency" — machine vocabulary, in the one place the
 * writer is being asked to act. Anything not listed falls back to the old
 * de-hyphenation, which is wrong-looking rather than broken.
 */
const CRITERION_LABEL: { [k: string]: string } = {
  "stat-source-adjacency": "Figure with no source",
  "ai-tell-guard": "Reads as AI-written",
  "sentence-length-norm": "Sentence runs long",
  "question-headings": "Heading is not a question",
  "answer-first-position": "Answer buried",
  "opening-quotability": "Opening is not quotable",
  "attribution-quality": "Weak attribution",
  "unsourced-absolute-claims": "Unsourced absolute claim",
};

function criterionLabel(key: string): string {
  return CRITERION_LABEL[key] || key.replace(/-/g, " ");
}

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
  // The two layers are shown apart, because they answer different questions and
  // cost different things. The instant ones are mechanical and always on — a
  // figure with no source beside it, a forty-word sentence. The AI review reads
  // for meaning and had to be asked for. Merging them into one pile was the
  // "score vs suggestions is confusing" complaint: two lists of problems with
  // no way to tell which had actually been run.
  const active = issues.filter((i) => i.status === "active");
  const liveOpen = active.filter((i) => i.finding.id.indexOf("live:") === 0);
  const judgeOpen = active.filter((i) => i.finding.id.indexOf("live:") !== 0);
  const open = active;
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
        {(liveOpen.length > 0 || judgeOpen.length > 0) && (
          <div className="px-1 pt-1 pb-2 flex flex-col gap-1.5">
            <div className="flex items-center gap-2 text-[11px] text-muted-foreground">
              <span className="inline-flex items-center gap-1.5">
                <span className="h-1.5 w-1.5 rounded-full bg-primary" />
                {liveOpen.length} from the instant checks
              </span>
              <span className="opacity-40">·</span>
              <span className="inline-flex items-center gap-1.5">
                <span className={"h-1.5 w-1.5 rounded-full " + (hasAssessed ? "bg-emerald-500" : "bg-muted-foreground/40")} />
                {hasAssessed ? `${judgeOpen.length} from the AI review` : "AI review not run"}
              </span>
            </div>
            {/* Says what the instant layer CANNOT see, so its silence is not
                mistaken for approval. Most remaining criteria are absences — no
                byline, no dateline, no key-takeaways block — and there is no
                text to mark up for something that is not there. Those live in
                the Score tab as a checklist, which is the honest home for them. */}
            <p className="text-[11px] text-muted-foreground/80 leading-snug">
              Instant checks mark problems in text that exists. What is <em>missing</em> — a byline, a
              dateline, a takeaways block — has nothing to underline and is listed under Score.
            </p>
          </div>
        )}
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
                  {criterionLabel(f.criterion)}
                </span>
              </div>

              {/* The quoted text, always — not only when selected. Two findings
                  of the same criterion rendered as identical cards, so a draft
                  with three unsourced figures showed the same card three times
                  with no way to tell which figure each meant. The quote IS the
                  identity of the finding. */}
              <p className="text-[12px] leading-snug mb-1 font-medium">
                <span className="text-muted-foreground/60">&ldquo;</span>
                {f.quote.length > 70 ? f.quote.slice(0, 70).trimEnd() + "…" : f.quote}
                <span className="text-muted-foreground/60">&rdquo;</span>
              </p>

              <p className="text-[11.5px] leading-snug text-muted-foreground mb-1.5">{f.explanation}</p>

              {selected && (
                <>
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
                {criterionLabel(issue.finding.criterion)}
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
