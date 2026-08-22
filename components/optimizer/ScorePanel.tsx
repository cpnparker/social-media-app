"use client";

/**
 * The live score panel.
 *
 * Scores from the deterministic engine only — no LLM call, no network. That is
 * what makes it safe to run while the writer types: same text, same number,
 * every time, in about a millisecond. The LLM judge's findings arrive later
 * (M3) and are shown alongside these, never blended into them silently.
 *
 * Two display rules the research forces:
 *
 *  - Retrievability and Citability are shown SEPARATELY, because optimising
 *    prose for extraction can measurably reduce retrieval. A single number
 *    would hide the one trade-off a writer most needs to see.
 *  - The letter grade is the headline and the number is secondary. Writers work
 *    toward a grade; a number encourages point-chasing at the margin, which is
 *    where this rubric is least meaningful.
 *
 * Sizing note: this panel lives inside `.engine-ai-scope`, which inflates every
 * Tailwind text-xs/text-sm by ~20% above 1024px. Bracket sizes (text-[13px])
 * escape that, which is why they are used throughout a dense panel like this.
 */

import { useMemo, useState } from "react";
import { computeDraftScores } from "@/lib/optimizer/engine";
import type { DraftInput } from "@/lib/optimizer/engine";
import type { CriterionResult } from "@/lib/optimizer/types";
import { cn } from "@/lib/utils";

interface Props {
  input: DraftInput;
  /** Hidden while a generation is streaming — a score climbing token by token is noise, not feedback. */
  muted?: boolean;
  /** Supplied by the studio so the panel can CLOSE the gap it reports rather
   *  than only naming it. Imported content arrives with no target query, which
   *  skips the heaviest pillar; sending the writer back to a brief form they
   *  never filled in is not a fix they will make. */
  onAddQuery?: (query: string) => void;
}

function gradeTone(score: number): string {
  if (score >= 80) return "text-emerald-600 dark:text-emerald-400";
  if (score >= 65) return "text-blue-600 dark:text-blue-400";
  if (score >= 50) return "text-amber-600 dark:text-amber-400";
  return "text-[hsl(var(--ai-negative))]";
}

function barTone(score: number): string {
  if (score >= 80) return "bg-emerald-500";
  if (score >= 65) return "bg-blue-500";
  if (score >= 50) return "bg-amber-500";
  return "bg-[hsl(var(--ai-negative))]";
}

export default function ScorePanel({ input, muted, onAddQuery }: Props) {
  // Recomputed on every render of a changed body. The engine is pure and takes
  // ~1ms on a 2,500-word draft, so memoising on the body string is enough —
  // there is no need for a worker or a debounce inside the panel itself.
  const scores = useMemo(() => {
    try {
      return computeDraftScores(input);
    } catch {
      return null;
    }
  }, [input.body, input.title, input.targetQueries, input.format, input.brandName, input.unattributed]);

  const [queryDraft, setQueryDraft] = useState("");

  if (!scores) {
    return (
      <div className="p-4 text-[13px] text-muted-foreground">
        Could not score this draft.
      </div>
    );
  }

  // A pillar counts as scored when at least one criterion applied to it. This
  // is the same test the pillar list below uses, deliberately — two different
  // definitions of "scored" would let the headline and the list disagree.
  let scoredPillars = 0;
  for (const p of scores.pillars) {
    let applicable = 0;
    for (const c of p.criteria) if (!c.skipped) applicable++;
    if (applicable > 0) scoredPillars++;
  }
  const needsQuery = !input.targetQueries || input.targetQueries.length === 0;

  const open: CriterionResult[] = [];
  for (const p of scores.pillars) {
    for (const c of p.criteria) {
      if (!c.skipped && !c.passed) open.push(c);
    }
  }
  // Sort by the GAP — which is the number each card prints as "+N".
  // The previous comparator reduced algebraically to (max + earned) descending,
  // so a criterion at 8/10 (printing "+2") sorted above one at 0/10 (printing
  // "+10"). The list was visibly not ordered by the number on it.
  open.sort((a, b) => (b.maxPoints - b.earned) - (a.maxPoints - a.earned));

  return (
    <div className={cn("flex flex-col min-h-0 h-full", muted && "opacity-50 pointer-events-none")}>
      {/* Headline */}
      <div className="shrink-0 px-4 py-3 border-b">
        <div className="flex items-center gap-3">
          <div className="flex flex-col items-center justify-center w-[62px] h-[62px] rounded-full border-2 shrink-0">
            <span className={cn("text-[19px] font-bold leading-none tabular-nums", gradeTone(scores.overall))}>
              {Math.round(scores.overall)}
            </span>
            <span className="text-[10px] font-semibold text-muted-foreground">{scores.grade}</span>
          </div>
          <div className="flex-1 min-w-0 flex flex-col gap-1.5">
            <div className="flex items-center justify-between">
              <span className="text-[13px] font-semibold">Optimisation Score</span>
              <span className="text-[10px] font-semibold px-1.5 py-0.5 rounded bg-emerald-500/10 text-emerald-600 dark:text-emerald-400">
                LIVE
              </span>
            </div>
            <Meter label="Retrievability" value={scores.retrievability} />
            <Meter label="Citability" value={scores.citability} />
          </div>
        </div>
      </div>

      {/* Coverage.
          The headline number is a percentage of what COULD be scored, so a
          draft with no target query shows a healthy figure computed without the
          heaviest pillar in the rubric. Printing that alone is the most
          plausible way this panel could mislead someone: the score looks
          finished. Say what it covers, and offer the fix here rather than
          somewhere the writer would have to go looking for. */}
      {scoredPillars < scores.pillars.length && (
        <div className="shrink-0 px-4 py-2.5 border-b bg-amber-500/[0.07] flex flex-col gap-2">
          <p className="text-[11.5px] leading-relaxed">
            <span className="font-semibold">
              {scoredPillars} of {scores.pillars.length} pillars scored.
            </span>{" "}
            {needsQuery
              ? "Relevance is the heaviest pillar and it has nothing to measure against until you say what question this piece should answer."
              : "The unscored ones are listed below with the reason."}
          </p>
          {needsQuery && onAddQuery && (
            <div className="flex items-center gap-1.5">
              <input
                value={queryDraft}
                onChange={(e) => setQueryDraft(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && queryDraft.trim()) {
                    onAddQuery(queryDraft.trim());
                    setQueryDraft("");
                  }
                }}
                placeholder="e.g. what is generative engine optimisation"
                className="flex-1 min-w-0 h-7 rounded-lg border bg-background px-2 text-[12px] outline-none focus:border-primary"
              />
              <button
                disabled={!queryDraft.trim()}
                onClick={() => { onAddQuery(queryDraft.trim()); setQueryDraft(""); }}
                className="h-7 shrink-0 rounded-lg bg-primary px-2.5 text-[12px] font-medium text-primary-foreground disabled:opacity-40"
              >
                Add
              </button>
            </div>
          )}
        </div>
      )}

      {/* Pillars.
          A pillar with every criterion skipped is NOT a zero — the engine drops
          it from the weighting entirely. Rendering it as a red 0 bar put a
          number on screen that contradicted the headline above it and offered
          nothing to fix, which is the "a view that drops data must say so" rule
          in CLAUDE.md, broken. It now says why it was not scored. */}
      <div className="shrink-0 px-4 py-3 border-b flex flex-col gap-2">
        {scores.pillars.map((p) => {
          const applicable = p.criteria.filter((c) => !c.skipped).length;
          if (applicable === 0) {
            const why = p.criteria.length > 0 && p.criteria[0].skipReason ? p.criteria[0].skipReason : "not applicable";
            return (
              <div key={p.name} className="flex items-center gap-2">
                <span className="text-[11.5px] text-muted-foreground w-[150px] truncate">{p.name}</span>
                <span className="flex-1 text-[11px] text-muted-foreground/80 italic truncate">
                  not scored — {why.toLowerCase()}
                </span>
              </div>
            );
          }
          return <Meter key={p.name} label={p.name} value={p.score} wide />;
        })}
      </div>

      {/* What to fix */}
      <div className="flex-1 min-h-0 overflow-y-auto px-3 py-2">
        <div className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground px-1 pb-1.5">
          {open.length === 0 ? "Nothing outstanding" : `${open.length} to address`}
        </div>
        {open.map((c) => (
          <div key={c.key} className="rounded-xl border bg-card p-2.5 mb-1.5">
            <div className="flex items-center gap-2 mb-0.5">
              <span className="text-[12px] font-semibold flex-1 min-w-0 truncate">{c.name.split(" — ")[0]}</span>
              <span
                className="text-[10px] font-semibold text-muted-foreground shrink-0"
                title="How strong the research behind this check is: A causal, B observational, C mechanistic, D house practice"
              >
                {c.evidence}
              </span>
              <span className="text-[11px] font-semibold text-primary tabular-nums shrink-0">
                +{c.maxPoints - c.earned}
              </span>
            </div>
            <p className="text-[11.5px] leading-snug text-muted-foreground">
              {c.name.indexOf(" — ") > 0 ? c.name.split(" — ")[1] : c.penalty ? "Guard not clear" : "Not yet met"}
            </p>
          </div>
        ))}
      </div>

      <div className="shrink-0 px-4 py-2 border-t">
        <p className="text-[10.5px] text-muted-foreground leading-snug">
          Rubric v{scores.rubricVersion} · evidence-graded. Predicts citation-readiness among retrieved
          content — no tool can promise AI traffic.
        </p>
      </div>
    </div>
  );
}

function Meter({ label, value, wide }: { label: string; value: number; wide?: boolean }) {
  return (
    <div className="flex items-center gap-2">
      <span className={cn("text-[11.5px] text-muted-foreground shrink-0", wide ? "w-[150px] truncate" : "w-[78px]")}>
        {label}
      </span>
      <div className="flex-1 h-1 rounded-full bg-muted overflow-hidden">
        <div className={cn("h-full rounded-full", barTone(value))} style={{ width: `${Math.max(0, Math.min(100, value))}%` }} />
      </div>
      <span className="text-[11.5px] font-semibold w-[22px] text-right tabular-nums">{Math.round(value)}</span>
    </div>
  );
}
