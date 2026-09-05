"use client";

/**
 * The live-page audit, in the conversation.
 *
 * Deliberately NOT scored. page-audit.ts refuses to total its checks into one
 * number because they are not weighted against each other, and a small card is
 * exactly where that discipline would break — a single figure looks so much
 * tidier in a header than three counts do. So the header carries the counts and
 * the URL, and the body carries the worst four findings with what to do about
 * each.
 *
 * The "not measured" strip is load-bearing rather than decorative. An absent
 * check reads as a pass everywhere it is not stated, and the JavaScript-gap
 * comparison is absent here on purpose: it needs a browser render, which the
 * studio runs and a chat turn should not.
 */

import { Globe, AlertTriangle, AlertCircle, ArrowUpRight } from "lucide-react";
import { cn } from "@/lib/utils";

export interface PageAuditData {
  ok: true;
  url: string;
  finalUrl: string;
  redirected: boolean;
  httpStatus: number;
  counts: { pass: number; warn: number; fail: number };
  findings: { id: string; section: string; name: string; detail: string; remedy: string; status: "fail" | "warn" }[];
  moreFails: number;
  moreWarns: number;
  notMeasured: { name: string; detail: string }[];
  fetchedAt: string;
}

/** The host, for a header that has to fit — the full address is on the link. */
function hostOf(u: string): string {
  try { return new URL(u).host.replace(/^www\./, ""); } catch { return u; }
}

function pathOf(u: string): string {
  try {
    const p = new URL(u).pathname;
    return p === "/" ? "" : p;
  } catch { return ""; }
}

export default function PageAuditCard({ data }: { data: PageAuditData }) {
  const more = data.moreFails + data.moreWarns;

  return (
    <div className="rounded-xl border overflow-hidden max-w-[42rem] bg-background">
      <div className="flex items-center gap-3 px-3.5 py-2.5 border-b bg-muted/40">
        <span className="h-7 w-7 rounded-lg bg-background border flex items-center justify-center shrink-0">
          <Globe className="h-3.5 w-3.5 text-muted-foreground" />
        </span>
        <span className="flex-1 min-w-0">
          <span className="block text-[12.5px] font-semibold leading-tight truncate">
            {hostOf(data.finalUrl)}
            <span className="font-normal text-muted-foreground">{pathOf(data.finalUrl)}</span>
          </span>
          <span className="block text-[11px] text-muted-foreground leading-tight mt-0.5">
            {/* Counts, never a total — the checks are not weighted against each other. */}
            <span className="text-red-600 dark:text-red-400 font-medium">{data.counts.fail} failing</span>
            {" · "}
            <span className="text-amber-600 dark:text-amber-400 font-medium">{data.counts.warn} warnings</span>
            {" · "}
            {data.counts.pass} passing
            {data.redirected && " · redirected"}
            {data.httpStatus !== 200 && ` · HTTP ${data.httpStatus}`}
          </span>
        </span>
        <a
          href={data.finalUrl}
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex items-center gap-1 text-[11px] font-medium text-muted-foreground hover:text-foreground rounded-md px-2 py-1 shrink-0 hover:bg-muted transition-colors"
        >
          Open <ArrowUpRight className="h-3 w-3" />
        </a>
      </div>

      <div className="px-3.5 py-2.5 flex flex-col gap-2.5">
        {data.findings.length === 0 && (
          <p className="text-[12.5px] text-muted-foreground">
            Nothing failing and nothing to warn about on the checks this audit runs.
          </p>
        )}
        {data.findings.map((f) => (
          <div key={f.id} className="flex items-start gap-2.5">
            {f.status === "fail" ? (
              <AlertCircle className="h-3.5 w-3.5 text-red-600 dark:text-red-400 shrink-0 mt-0.5" />
            ) : (
              <AlertTriangle className="h-3.5 w-3.5 text-amber-600 dark:text-amber-400 shrink-0 mt-0.5" />
            )}
            <span className="flex-1 min-w-0">
              <span className="block text-[12.5px] font-medium leading-snug">{f.name}</span>
              <span className="block text-[11.5px] text-muted-foreground leading-snug">{f.detail}</span>
              {f.remedy && (
                <span className="block text-[11.5px] leading-snug mt-0.5 text-foreground/80">{f.remedy}</span>
              )}
            </span>
          </div>
        ))}
      </div>

      {(more > 0 || data.notMeasured.length > 0) && (
        <div className="px-3.5 py-2 border-t bg-muted/20 flex flex-col gap-1">
          {more > 0 && (
            <p className="text-[11.5px] text-muted-foreground">
              {data.moreFails > 0 && `${data.moreFails} more failing`}
              {data.moreFails > 0 && data.moreWarns > 0 && " and "}
              {data.moreWarns > 0 && `${data.moreWarns} more warning${data.moreWarns === 1 ? "" : "s"}`}
              {" — the full audit is in the Optimiser, on a piece imported from this URL."}
            </p>
          )}
          {/* Not a footnote. An unstated check reads as a passing one. */}
          {data.notMeasured.length > 0 && (
            <p className={cn("text-[11.5px] text-muted-foreground")}>
              Not measured: {data.notMeasured.map((n) => n.name).join(", ")}. The JavaScript-gap
              comparison needs a browser render, which the studio&rsquo;s audit runs and this one does not.
            </p>
          )}
        </div>
      )}
    </div>
  );
}
