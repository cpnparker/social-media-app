"use client";

/**
 * The live-page audit view — the "Page audit" tab of a URL-imported session.
 *
 * Two layers, visually separate because they answer different questions:
 * the PAGE checks (title tag, schema, images, dates — furniture the draft
 * rubric deliberately does not score) and the CONTENT scores (the same rubric
 * the editor runs, computed over the live page's text).
 *
 * NO COMPOSITE SCORE, deliberately. Pass/warn/fail counts and a pillar
 * breakdown, never one blended number — a single "page score" over furniture
 * plus prose would invite before/after claims the evidence cannot carry, which
 * is the exact dishonesty the rubric's evidence grades exist to prevent.
 */

import { useCallback, useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import {
  AlertCircle, AlertTriangle, CheckCircle2, ExternalLink, Info, Loader2, RefreshCw,
} from "lucide-react";
import type { PageAuditResult, AuditCheck } from "@/lib/optimizer/page-audit";
import type { DraftScores } from "@/lib/optimizer/types";

interface AuditResponse {
  url: string;
  finalUrl: string;
  audit: PageAuditResult;
  liveScores: DraftScores | null;
  liveWords: number;
  render?: { ran: boolean; reason: string | null; ms: number } | null;
}

interface Props {
  sessionId: string;
  workspaceId: string;
  sourceUrl: string;
}

const SECTION_LABEL: { [k: string]: string } = {
  rendering: "What an AI crawler actually receives",
  indexability: "Can it be crawled and cited at all?",
  identity: "Identity — what a result carries",
  structure: "Structure — how it chunks",
  images: "Images",
  schema: "Structured data — machine readability",
  freshness: "Freshness",
  links: "Links",
};
const SECTION_ORDER = ["rendering", "indexability", "identity", "structure", "images", "schema", "freshness", "links"];

function StatusIcon({ s }: { s: AuditCheck["status"] }) {
  if (s === "pass") return <CheckCircle2 className="h-4 w-4 text-emerald-600 dark:text-emerald-400 shrink-0" />;
  if (s === "fail") return <AlertCircle className="h-4 w-4 text-[hsl(var(--ai-negative))] shrink-0" />;
  if (s === "warn") return <AlertTriangle className="h-4 w-4 text-amber-500 shrink-0" />;
  return <Info className="h-4 w-4 text-muted-foreground/60 shrink-0" />;
}

export default function PageAudit({ sessionId, workspaceId, sourceUrl }: Props) {
  const [data, setData] = useState<AuditResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const run = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/optimizer/sessions/${encodeURIComponent(sessionId)}/audit`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ workspaceId }),
      });
      const d = await res.json();
      if (!res.ok) { setError(d.error || "Audit failed"); return; }
      setData(d);
    } catch {
      setError("Could not reach the audit service");
    } finally {
      setLoading(false);
    }
  }, [sessionId, workspaceId]);

  // Runs on open. The audit is one fetch and no model call — free enough that
  // an empty tab with a "Run" button would just be a click tax.
  useEffect(() => { run(); }, [run]);

  if (loading && !data) {
    return (
      <div className="flex-1 min-h-0 flex items-center justify-center">
        <div className="flex flex-col items-center gap-2 text-muted-foreground">
          <Loader2 className="h-5 w-5 animate-spin" />
          <p className="text-[13px]">Fetching the live page…</p>
        </div>
      </div>
    );
  }
  if (error && !data) {
    return (
      <div className="flex-1 min-h-0 flex items-center justify-center p-8">
        <div className="max-w-md text-center flex flex-col gap-3">
          <p className="text-sm text-muted-foreground">{error}</p>
          <Button size="sm" variant="outline" onClick={run} className="mx-auto">
            <RefreshCw className="h-3.5 w-3.5" /> Try again
          </Button>
        </div>
      </div>
    );
  }
  if (!data) return null;

  const { audit, liveScores, liveWords } = data;
  const bySection: { [k: string]: AuditCheck[] } = {};
  for (const c of audit.checks) {
    (bySection[c.section] = bySection[c.section] || []).push(c);
  }

  return (
    <div className="flex-1 min-h-0 overflow-y-auto">
      <div className="mx-auto w-full max-w-[46rem] px-6 py-6 flex flex-col gap-5">

        {error && data && (
          <div className="rounded-xl border border-amber-500/40 bg-amber-500/10 px-3.5 py-2.5 text-[12.5px]">
            <b>The re-audit failed:</b> {error} — the results below are from the earlier fetch at{" "}
            {new Date(data.audit.fetchedAt).toLocaleTimeString()}, not the current page.
          </div>
        )}

        {data.render && !data.render.ran && (
          <div className="rounded-xl border border-amber-500/40 bg-amber-500/10 px-3.5 py-2.5 text-[12.5px]">
            <b>The technical render did not run.</b> {data.render.reason} — the checks below read the
            page&apos;s served HTML, which is what an AI crawler sees anyway. What is missing is the
            comparison that would reveal content only appearing after JavaScript runs.
          </div>
        )}

        {/* Header: what was audited, when, and the honest tallies. */}
        <div className="flex items-start gap-3">
          <div className="flex-1 min-w-0">
            <h2 className="text-[17px] font-bold tracking-tight">Live page audit</h2>
            <a
              href={data.finalUrl} target="_blank" rel="noreferrer"
              className="inline-flex items-center gap-1 text-[12.5px] text-muted-foreground hover:text-foreground truncate max-w-full"
            >
              <span className="truncate">{data.finalUrl}</span>
              <ExternalLink className="h-3 w-3 shrink-0" />
            </a>
            <p className="text-[11.5px] text-muted-foreground mt-0.5">
              Fetched {new Date(audit.fetchedAt).toLocaleTimeString()} — re-run after publishing a fix to see it land.
            </p>
          </div>
          <Button size="sm" variant="outline" onClick={run} disabled={loading} className="shrink-0">
            {loading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <RefreshCw className="h-3.5 w-3.5" />}
            Re-audit
          </Button>
        </div>

        <div className="grid grid-cols-3 gap-2">
          <div className="rounded-xl border bg-card px-3 py-2.5">
            <div className="text-[22px] font-bold tabular-nums text-emerald-600 dark:text-emerald-400">{audit.counts.pass}</div>
            <div className="text-[11.5px] text-muted-foreground">passing</div>
          </div>
          <div className="rounded-xl border bg-card px-3 py-2.5">
            <div className="text-[22px] font-bold tabular-nums text-amber-600 dark:text-amber-500">{audit.counts.warn}</div>
            <div className="text-[11.5px] text-muted-foreground">worth fixing</div>
          </div>
          <div className="rounded-xl border bg-card px-3 py-2.5">
            <div className="text-[22px] font-bold tabular-nums text-[hsl(var(--ai-negative))]">{audit.counts.fail}</div>
            <div className="text-[11.5px] text-muted-foreground">blocking</div>
          </div>
        </div>

        {/* The content layer: same rubric, live text. */}
        {liveScores && (
          <div className="rounded-xl border bg-card p-4">
            <div className="flex items-baseline justify-between mb-1">
              <span className="text-[13.5px] font-semibold">The published text, through the same rubric</span>
              <span className="text-[12px] text-muted-foreground">{liveWords} words</span>
            </div>
            <p className="text-[12px] text-muted-foreground mb-3">
              What the live page would score if it were your draft. The Optimise tab is where you improve it;
              this is the published baseline it improves on.
            </p>
            {(() => {
              let scored = 0;
              for (const p of liveScores.pillars) if (p.criteria.filter((c) => !c.skipped).length > 0) scored++;
              if (scored >= liveScores.pillars.length) return null;
              return (
                <p className="text-[11.5px] rounded-lg bg-amber-500/10 text-amber-700 dark:text-amber-500 px-2.5 py-1.5 mb-2">
                  Measured on {scored} of {liveScores.pillars.length} pillars — Relevance has nothing to score
                  until a target query is set on the Optimise tab. This number is a partial view, not a verdict.
                </p>
              );
            })()}
            <div className="flex items-center gap-4 mb-2">
              <span className="text-[26px] font-bold tabular-nums leading-none">{Math.round(liveScores.overall)}</span>
              <div className="flex-1 flex flex-col gap-1.5">
                <Bar label="Retrievability" v={liveScores.retrievability} />
                <Bar label="Citability" v={liveScores.citability} />
              </div>
            </div>
            <div className="grid grid-cols-2 gap-x-5 gap-y-1">
              {liveScores.pillars.map((p) => {
                const applicable = p.criteria.filter((c) => !c.skipped).length;
                return (
                  <div key={p.name} className="flex items-center justify-between gap-2">
                    <span className="text-[11.5px] text-muted-foreground truncate">{p.name}</span>
                    <span className="text-[11.5px] font-semibold tabular-nums">
                      {applicable === 0 ? "—" : Math.round(p.score)}
                    </span>
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {/* The page layer, by section. */}
        {SECTION_ORDER.filter((sec) => bySection[sec]?.length).map((sec) => (
          <div key={sec}>
            <h3 className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground px-1 pb-1.5">
              {SECTION_LABEL[sec] || sec}
            </h3>
            <div className="rounded-xl border bg-card divide-y">
              {bySection[sec].map((c) => (
                <div key={c.id} className="px-3.5 py-2.5 flex gap-2.5">
                  <div className="pt-0.5"><StatusIcon s={c.status} /></div>
                  <div className="flex-1 min-w-0">
                    <div className="text-[13px] font-medium">{c.name}</div>
                    <div className={cn("text-[12px] leading-snug", c.status === "pass" ? "text-muted-foreground/80" : "text-muted-foreground")}>
                      {c.detail}
                    </div>
                    {c.remedy && c.status !== "pass" && (
                      <div className="text-[11.5px] leading-snug text-foreground/80 mt-1 pl-2 border-l-2 border-border">
                        {c.remedy}
                      </div>
                    )}
                  </div>
                </div>
              ))}
            </div>
          </div>
        ))}

        <p className="text-[11px] text-muted-foreground leading-relaxed pb-4">
          No composite score, deliberately: pass/warn/fail counts and the rubric&apos;s own pillar numbers, never one
          blended figure — page furniture and prose carry different evidence, and a single number over both would
          claim more than the research supports. Structured data is reported as machine-readability, not as a
          ranking promise.
        </p>
      </div>
    </div>
  );
}

function Bar({ label, v }: { label: string; v: number }) {
  return (
    <div className="flex items-center gap-2">
      <span className="text-[11px] text-muted-foreground w-[86px]">{label}</span>
      <div className="flex-1 h-1.5 rounded-full bg-muted overflow-hidden">
        <div
          className={cn("h-full rounded-full", v >= 65 ? "bg-emerald-500" : v >= 45 ? "bg-amber-500" : "bg-[hsl(var(--ai-negative))]")}
          style={{ width: `${Math.max(2, Math.min(100, v))}%` }}
        />
      </div>
      <span className="text-[11px] font-semibold tabular-nums w-6 text-right">{Math.round(v)}</span>
    </div>
  );
}
