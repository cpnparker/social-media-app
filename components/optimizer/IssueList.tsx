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
import { findingSource } from "@/lib/optimizer/highlight-plugin";
import { lensDisclosure } from "@/lib/optimizer/mark-policy";
import { Check, X, Pencil, AlertCircle , Loader2, Sparkles } from "lucide-react";
import type { Issue } from "@/lib/optimizer/highlight-plugin";
import { criterionLabel } from "@/components/optimizer/IssuePopover";

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
  /** False when this kind of document is not scored — changes the empty state. */
  scored?: boolean;
  onAssess?: () => void;
  /** On-demand rewrite for a finding that arrived without one. */
  onAiFix?: (id: string) => void;
  aiEdits?: { [id: string]: string };
  aiFixingId?: string | null;
  /** What is running, and whether a person may change it. */
  lens?: "engine" | "plain";
  canRaiseLens?: boolean;
  onSetLens?: (next: "engine" | "plain" | null) => void;
  /** Hand the finished piece to the Optimiser. Writer only. */
  onHandOff?: () => void;
  /** Below the shared word floor: nothing is being checked YET. */
  belowFloor?: boolean;
}

const SEVERITY_DOT: { [k: string]: string } = {
  high: "bg-[hsl(var(--ai-negative))]",
  medium: "bg-amber-500",
  low: "bg-blue-500",
};

export default function IssueList({
  issues, selectedId, onSelect, onApply, onDismiss, diagnostics, degraded, hasAssessed, scored, onAssess,
  onAiFix, aiEdits, aiFixingId, lens, canRaiseLens, onSetLens, onHandOff, belowFloor,
}: Props) {
  // The two layers are shown apart, because they answer different questions and
  // cost different things. The instant ones are mechanical and always on — a
  // figure with no source beside it, a forty-word sentence. The AI review reads
  // for meaning and had to be asked for. Merging them into one pile was the
  // "score vs suggestions is confusing" complaint: two lists of problems with
  // no way to tell which had actually been run.
  const active = issues.filter((i) => i.status === "active");
  // Source-tested through one function rather than two copies of the same
  // prefix test, so a third producer cannot be silently misfiled as a judge
  // finding by whichever copy nobody updated.
  const liveOpen = active.filter((i) => findingSource(i.finding.id) === "live");
  const judgeOpen = active.filter((i) => findingSource(i.finding.id) === "judge");
  const open = active;
  const orphaned = issues.filter((i) => i.status === "orphaned");
  const done = issues.filter((i) => i.status === "resolved" || i.status === "dismissed");

  return (
    <div className="flex flex-col min-h-0 h-full">
      {/* WHAT IS AND IS NOT RUNNING. Not looking and finding nothing are
          different claims; a clean panel that says nothing lets a writer read
          "no issues" off a document nobody checked. The string is fixed —
          lensDisclosure takes no arguments — because the reason a piece is on
          the plain lens can be that it was silently recognised as the unnamed
          type, and a message that varied by reason would eventually say so. */}
      {lens === "plain" && !belowFloor && (
        <div className="shrink-0 mx-3 mt-2 rounded-lg border bg-muted/40 px-2.5 py-2">
          <p className="text-[11.5px] leading-snug text-muted-foreground">
            {lensDisclosure()}
          </p>
          {canRaiseLens && (
            // Points at the control rather than being a second copy of it. Two
            // buttons doing the same thing in two places is how one of them
            // ends up wired to something slightly different.
            <p className="mt-1 text-[11px] text-muted-foreground/80">
              Change it with <span className="font-medium text-foreground">AI checks off</span> at the top.
            </p>
          )}
        </div>
      )}
      {/* The escape. It sits here rather than in the popover because this is the
          list a writer is reading when the advice stops making sense — a cover
          letter told its salutation should "carry the answer, quotably". One
          click, permanent for this piece, on both surfaces. Retroactive by
          construction: the wrong marks appear once, then a person corrects them
          — which is the trade taken over guessing the document's kind from a
          salutation regex. */}
      {lens === "engine" && canRaiseLens && !belowFloor && liveOpen.length > 0 && (
        <div className="shrink-0 mx-3 mt-2">
          <p className="text-[11px] text-muted-foreground/80">
            These check whether an assistant would cite this page. If that is not what this
            piece is for, switch <span className="font-medium text-foreground">AI checks on</span> off
            at the top.
          </p>
        </div>
      )}
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
        {/* Below the floor nothing has been checked, and it says so. It used to
            show a clean list, which reads as "no problems found" on a document
            no check had looked at. */}
        {belowFloor && (
          <p className="text-[12.5px] text-muted-foreground px-1 py-3 leading-snug">
            Nothing is being checked yet — there isn&apos;t enough written to check.
          </p>
        )}
        {!belowFloor && open.length === 0 && orphaned.length === 0 && !hasAssessed && (
          <div className="px-1 py-3 flex flex-col gap-2 items-start">
            <p className="text-[12.5px] text-muted-foreground leading-snug">
              {/* `scored` was destructured and never read, so this pointed a
                  Writer at a Score tab that surface does not have. */}
              {scored
                ? "This draft hasn\u2019t been assessed yet. The live score on the other tab is the deterministic half; an assessment adds the judgement half and anchors suggestions to specific sentences."
                : "Nothing outstanding in the instant checks."}
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
        {onHandOff && !belowFloor && (
          <div className="mt-3 pt-3 border-t">
            <button
              onClick={onHandOff}
              className="text-[12px] font-medium text-foreground hover:underline underline-offset-2"
            >
              Check this for AI citability &rarr;
            </button>
            <p className="text-[11px] text-muted-foreground mt-1 leading-relaxed">
              Opens it in the Optimiser, which scores it the way an assistant reads it.
            </p>
          </div>
        )}
        {!belowFloor && open.length === 0 && orphaned.length === 0 && hasAssessed && done.length === 0 && (
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
                  {(f.suggestedEdit || (aiEdits && aiEdits[f.id])) ? (
                    <div className="rounded-lg border border-emerald-500/25 bg-emerald-500/[0.06] px-2.5 py-2 mb-2">
                      <p className="text-[12px] leading-snug">{f.suggestedEdit || (aiEdits && aiEdits[f.id])}</p>
                    </div>
                  ) : null}
                  <div className="flex items-center gap-1.5 flex-wrap">
                    {(f.suggestedEdit || (aiEdits && aiEdits[f.id])) ? (
                      <button
                        onClick={(e) => { e.stopPropagation(); onApply(f.id); }}
                        className="inline-flex items-center gap-1.5 h-7 px-2.5 rounded-lg bg-primary text-primary-foreground text-[12px] font-semibold"
                      >
                        <Check className="h-3 w-3" /> Apply
                      </button>
                    ) : onAiFix ? (
                      <button
                        onClick={(e) => { e.stopPropagation(); onAiFix(f.id); }}
                        disabled={aiFixingId === f.id}
                        className="inline-flex items-center gap-1.5 h-7 px-2.5 rounded-lg bg-primary text-primary-foreground text-[12px] font-semibold disabled:opacity-60"
                      >
                        {aiFixingId === f.id ? <Loader2 className="h-3 w-3 animate-spin" /> : <Sparkles className="h-3 w-3" />}
                        {aiFixingId === f.id ? "Writing…" : "Fix with AI"}
                      </button>
                    ) : null}
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
