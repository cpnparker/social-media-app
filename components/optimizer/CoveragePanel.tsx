"use client";

/**
 * Fan-out coverage and the novelty gap.
 *
 * These are the two the research argues hardest for, and they are deliberately
 * NOT scores. Coverage is a content brief — "here are the six questions this
 * piece does not answer" — and novelty is an argument: here is what a model
 * says without you, and here is what your piece knows that it does not. Both
 * are lists a writer can act on, which is the whole reason they earn a tab.
 *
 * Run on DEMAND, unlike the page audit. The audit is one fetch; this is three
 * model calls, so it costs money per press and the button says so rather than
 * firing on open.
 */

import { useCallback, useState } from "react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { AlertTriangle, Check, Info, Loader2, Sparkles, X } from "lucide-react";
import type { CoverageResult } from "@/lib/optimizer/coverage";

interface Props {
  sessionId: string;
  workspaceId: string | null;
  /** Highlight the passage that answers a sub-query. */
  onReveal?: (start: number, end: number) => void;
}

export default function CoveragePanel({ sessionId, workspaceId, onReveal }: Props) {
  const [data, setData] = useState<(CoverageResult & { cached?: boolean }) | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const run = useCallback(async () => {
    if (!workspaceId) { setError("Select a workspace first"); return; }
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/optimizer/sessions/${encodeURIComponent(sessionId)}/coverage`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ workspaceId }),
      });
      const d = await res.json();
      if (!res.ok) { setError(d.error || "The analysis did not complete"); return; }
      setData(d);
    } catch {
      setError("Could not reach the analysis service");
    } finally {
      setLoading(false);
    }
  }, [sessionId, workspaceId]);

  if (!data) {
    return (
      <div className="h-full overflow-y-auto p-4">
        <div className="rounded-xl border bg-card p-4">
          <h3 className="text-[13.5px] font-semibold mb-1">What else would an engine ask?</h3>
          <p className="text-[12px] text-muted-foreground leading-relaxed mb-3">
            An engine does not match your page to one question. It breaks the question into
            sub-queries and answers each from whichever passage fits best. This works out which
            sub-queries you already answer, and — separately — which of your claims a model does
            not already know, since it has no reason to cite you for something it can say itself.
          </p>
          {error && (
            <p className="text-[12px] text-[hsl(var(--ai-negative))] mb-2">{error}</p>
          )}
          <Button size="sm" onClick={run} disabled={loading || !workspaceId}>
            {loading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Sparkles className="h-3.5 w-3.5" />}
            {loading ? "Analysing…" : "Run the analysis"}
          </Button>
          <p className="text-[11px] text-muted-foreground mt-2">
            Three model calls. The result is cached against this draft, so reopening is free until you edit.
          </p>
        </div>
      </div>
    );
  }

  const { fanout, novelty, notAssessable } = data;

  return (
    <div className="h-full overflow-y-auto">
      <div className="p-4 flex flex-col gap-4">

        <div className="flex items-center justify-between">
          <span className="text-[11px] text-muted-foreground">
            {data.cached ? "From the last run on this draft" : "Fresh run"}
          </span>
          <Button size="sm" variant="outline" onClick={run} disabled={loading}>
            {loading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : null} Re-run
          </Button>
        </div>

        {/* What could not be assessed, first-class rather than silent. */}
        {notAssessable && notAssessable.length > 0 && (
          <div className="rounded-xl border border-amber-500/40 bg-amber-500/10 px-3.5 py-2.5">
            <div className="text-[12px] font-semibold mb-1">Not assessed</div>
            {notAssessable.map((n, i) => (
              <p key={i} className="text-[11.5px] leading-snug text-muted-foreground">{n}</p>
            ))}
          </div>
        )}

        {fanout && (
          <div className="rounded-xl border bg-card p-4">
            <div className="flex items-baseline justify-between mb-1">
              <span className="text-[13.5px] font-semibold">Sub-query coverage</span>
              <span className="text-[15px] font-bold tabular-nums">
                {fanout.coveredCount}<span className="text-muted-foreground font-normal">/{fanout.subQueries.length}</span>
              </span>
            </div>
            <p className="text-[11.5px] text-muted-foreground mb-3">
              Decomposed from <span className="text-foreground">&ldquo;{fanout.primaryQuery}&rdquo;</span>
            </p>
            <div className="flex flex-col gap-1.5">
              {fanout.subQueries.map((q, i) => (
                <div
                  key={i}
                  className={cn(
                    "flex gap-2 rounded-lg px-2.5 py-2 text-[12.5px]",
                    q.covered ? "bg-emerald-500/5" : "bg-amber-500/5",
                    q.covered && q.start >= 0 && onReveal ? "cursor-pointer hover:bg-emerald-500/10" : ""
                  )}
                  onClick={() => { if (q.covered && q.start >= 0 && onReveal) onReveal(q.start, q.end); }}
                >
                  <div className="pt-0.5 shrink-0">
                    {q.covered
                      ? <Check className="h-3.5 w-3.5 text-emerald-600 dark:text-emerald-400" />
                      : <X className="h-3.5 w-3.5 text-amber-600 dark:text-amber-500" />}
                  </div>
                  <div className="min-w-0">
                    <div className={q.covered ? "text-muted-foreground" : "font-medium"}>{q.query}</div>
                    {q.covered && q.evidence && (
                      <div className="text-[11.5px] text-muted-foreground/70 mt-0.5 line-clamp-2">
                        &ldquo;{q.evidence}&rdquo;
                      </div>
                    )}
                  </div>
                </div>
              ))}
            </div>
            <p className="text-[11px] text-muted-foreground leading-relaxed mt-3 pt-3 border-t">
              Cover a gap by adding a passage to THIS piece. Do not spin up a page per question —
              that is scaled content abuse under Google&apos;s own guidance, and a thin page per
              query variant does not make a site stronger.
            </p>
          </div>
        )}

        {novelty && (
          <div className="rounded-xl border bg-card p-4">
            <div className="flex items-baseline justify-between mb-1">
              <span className="text-[13.5px] font-semibold">Novelty gap</span>
              <span className="text-[15px] font-bold tabular-nums">{novelty.noveltyPct}%</span>
            </div>
            <p className="text-[11.5px] text-muted-foreground mb-3">
              Measured against what <span className="text-foreground">{novelty.measuredAgainst}</span> says
              with no sources. An engine has no reason to cite you for something it already knows —
              one model, one day, so read the list rather than the number.
            </p>

            {novelty.novel.length > 0 && (
              <>
                <div className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground mb-1.5">
                  Yours alone — this is the citation case
                </div>
                <div className="flex flex-col gap-1.5 mb-3">
                  {novelty.novel.map((c, i) => (
                    <div
                      key={i}
                      className={cn("rounded-lg bg-emerald-500/5 px-2.5 py-2", onReveal ? "cursor-pointer hover:bg-emerald-500/10" : "")}
                      onClick={() => onReveal && onReveal(c.start, c.end)}
                    >
                      <div className="text-[12.5px] font-medium">{c.claim}</div>
                      <div className="text-[11.5px] text-muted-foreground/70 mt-0.5 line-clamp-2">&ldquo;{c.quote}&rdquo;</div>
                    </div>
                  ))}
                </div>
              </>
            )}

            {novelty.commodity.length > 0 && (
              <>
                <div className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground mb-1.5">
                  Already known — no reason to cite anyone
                </div>
                <div className="flex flex-col gap-1.5">
                  {novelty.commodity.map((c, i) => (
                    <div
                      key={i}
                      className={cn("rounded-lg bg-muted/40 px-2.5 py-2", onReveal ? "cursor-pointer hover:bg-muted/70" : "")}
                      onClick={() => onReveal && onReveal(c.start, c.end)}
                    >
                      <div className="text-[12.5px] text-muted-foreground">{c.claim}</div>
                      <div className="text-[11.5px] text-muted-foreground/60 mt-0.5 line-clamp-2">&ldquo;{c.quote}&rdquo;</div>
                    </div>
                  ))}
                </div>
                <p className="text-[11px] text-muted-foreground leading-relaxed mt-3 pt-3 border-t">
                  Commodity claims are not bad writing and should not simply be cut — removing them
                  strips the vocabulary that gets the page retrieved in the first place. Add what
                  only you know alongside them.
                </p>
              </>
            )}

            <details className="mt-3 pt-3 border-t">
              <summary className="text-[11.5px] text-muted-foreground cursor-pointer">
                What the model said without your article
              </summary>
              <p className="text-[11.5px] text-muted-foreground/80 leading-relaxed mt-2 whitespace-pre-wrap">
                {novelty.parametricAnswer}
              </p>
            </details>
          </div>
        )}
      </div>
    </div>
  );
}
