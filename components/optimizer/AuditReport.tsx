"use client";

/**
 * The live-page audit as something you can hand to a client.
 *
 * ── WHAT MAKES THIS DIFFERENT FROM THE LIST ─────────────────────────────────
 *
 * The audit panel is a working surface: a writer runs it, reads the checks, and
 * fixes things. This is the same findings arranged as a DELIVERABLE — the page
 * as it actually looks, with the problems circled on it, and the reasoning
 * beside them. A client who has never heard of a canonical tag understands a
 * red box around their own hero image immediately.
 *
 * ── THE DESIGN DECISIONS, AND WHY ───────────────────────────────────────────
 *
 * NUMBERED BADGES ON THE ELEMENT, matched by a numbered list. The alternative,
 * leader lines from the element to a margin note, looks better in a mockup and
 * breaks the moment the picture is a different width: lines cross, labels
 * collide, and the whole thing has to be re-solved for print. A badge sits on
 * its element at any width, and the number is the connection.
 *
 * NUMBERED IN READING ORDER, not by severity. A reader follows the page. Badges
 * running 4, 1, 7 down the screen make them do the sorting.
 *
 * SEVERITY IN THE COLOUR AND THE LIST, so the picture stays readable while the
 * list still leads with what matters most.
 *
 * NO SCORE. page-audit refuses to total its checks because they are not
 * weighted against each other, and a client-facing report is exactly where a
 * single number would be quoted back for years.
 *
 * ── PRINT ───────────────────────────────────────────────────────────────────
 *
 * Print is a first-class layout here, not an afterthought: the whole point is a
 * PDF someone can send. App chrome is dropped, the picture is capped so it
 * cannot eat a whole page on its own, findings avoid breaking across a page,
 * and the URL and date are repeated in the printed header because a page two
 * arriving on its own should still say what it is about.
 */

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { AlertCircle, AlertTriangle, ExternalLink, Printer } from "lucide-react";
import type { AuditCheck, PageAuditResult } from "@/lib/optimizer/page-audit";
import type { RenderShot, RenderSpot } from "@/lib/optimizer/render";
import { buildPins, groupPins, unpinnedFindings, pinPercent, auditHeadline } from "@/lib/optimizer/audit-visual";

const SECTION_LABEL: { [k: string]: string } = {
  rendering: "How it renders",
  indexability: "Whether it can be indexed",
  identity: "Who it says it is",
  structure: "How it is structured",
  images: "Images",
  schema: "Machine-readable markup",
  links: "Links",
  freshness: "Freshness",
};

export default function AuditReport({
  url,
  finalUrl,
  audit,
  shot,
  spots,
  clientName,
}: {
  url: string;
  finalUrl: string;
  audit: PageAuditResult;
  shot: RenderShot | null;
  spots: RenderSpot[];
  clientName?: string | null;
}) {
  const pins = buildPins(audit.checks, spots || []);
  const groups = groupPins(pins);
  const rest = unpinnedFindings(audit.checks, pins);
  const counts = auditHeadline(audit.checks);
  const notMeasured = audit.checks.filter((c) => c.status === "info");
  const [showPasses, setShowPasses] = useState(false);
  const passes = audit.checks.filter((c) => c.status === "pass");

  const fetched = (() => {
    try { return new Date(audit.fetchedAt).toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric" }); }
    catch { return ""; }
  })();

  return (
    <div className="audit-report mx-auto max-w-[54rem] px-5 py-6 text-foreground">
      <style>{`
        @media print {
          @page { size: A4; margin: 14mm 12mm; }
          body { background: #fff !important; }
          /* Everything that is not the report. The app's own chrome has no
             business in a document going to a client. */
          body > *:not(.audit-print-root) { display: none !important; }
          .audit-print-root, .audit-print-root * { visibility: visible; }
          .audit-print-root { position: absolute; inset: 0; width: 100%; }
          .audit-no-print { display: none !important; }
          .audit-report { max-width: none; padding: 0; }
          /* A finding split across a page break is a finding read twice. */
          .audit-finding { break-inside: avoid; page-break-inside: avoid; }
          .audit-shot { break-inside: avoid; page-break-inside: avoid; max-height: 190mm; }
          .audit-section { break-before: auto; }
          a[href]:after { content: ""; }
        }
      `}</style>

      {/* ── Header ─────────────────────────────────────────────────────── */}
      <header className="flex items-start gap-4 border-b pb-4 mb-5">
        <div className="flex-1 min-w-0">
          <p className="text-[11px] uppercase tracking-wider text-muted-foreground">
            Page audit{clientName ? ` · ${clientName}` : ""}
          </p>
          <h1 className="text-[19px] font-semibold leading-tight mt-1 break-words">{titleFromUrl(finalUrl || url)}</h1>
          <a
            href={finalUrl || url}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-1 text-[12px] text-muted-foreground hover:text-foreground break-all mt-0.5"
          >
            {finalUrl || url} <ExternalLink className="h-3 w-3 shrink-0 audit-no-print" />
          </a>
          <p className="text-[11.5px] text-muted-foreground mt-1">
            Checked {fetched}. How well an AI assistant can reach, read and cite this page.
          </p>
        </div>
        <Button
          variant="outline"
          size="sm"
          onClick={() => window.print()}
          className="audit-no-print shrink-0 h-8 text-[12px]"
        >
          <Printer className="h-3.5 w-3.5 mr-1.5" /> Print / PDF
        </Button>
      </header>

      {/* ── Counts, never a total ──────────────────────────────────────── */}
      <div className="flex flex-wrap items-center gap-x-5 gap-y-1.5 mb-5 text-[12.5px]">
        <span className="inline-flex items-center gap-1.5">
          <span className="h-2.5 w-2.5 rounded-full bg-red-500" />
          <strong className="tabular-nums">{counts.fail}</strong> failing
        </span>
        <span className="inline-flex items-center gap-1.5">
          <span className="h-2.5 w-2.5 rounded-full bg-amber-500" />
          <strong className="tabular-nums">{counts.warn}</strong> to improve
        </span>
        <span className="inline-flex items-center gap-1.5 text-muted-foreground">
          <span className="h-2.5 w-2.5 rounded-full bg-emerald-500" />
          <strong className="tabular-nums text-foreground">{counts.pass}</strong> passing
        </span>
        {counts.info > 0 && (
          <span className="text-muted-foreground">{counts.info} not measured</span>
        )}
      </div>

      {/* ── The page, marked up ────────────────────────────────────────── */}
      {shot ? (
        <section className="mb-6">
          <h2 className="text-[13px] font-semibold mb-2">On the page</h2>
          <div className="audit-shot relative border rounded-lg overflow-hidden bg-white">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={shot.dataUri} alt={`Screenshot of ${finalUrl || url}`} className="block w-full" />
            {pins.map((pin) => {
              const at = pinPercent(pin, shot);
              if (at.offPicture) return null;
              return (
                <div
                  key={`${pin.checkId}-${pin.n}`}
                  className="absolute"
                  style={{ left: `${at.left}%`, top: `${at.top}%`, width: `${at.width}%`, height: `${at.height}%` }}
                >
                  <span
                    className={cn(
                      "absolute inset-0 rounded-[3px] border-2",
                      pin.status === "fail" ? "border-red-500/90 bg-red-500/10" : "border-amber-500/90 bg-amber-500/10"
                    )}
                  />
                  {/* The badge hangs off the top-left corner so it never covers
                      the thing it is pointing at. */}
                  <span
                    className={cn(
                      "absolute -top-2.5 -left-2.5 h-5 w-5 rounded-full text-white text-[11px] font-semibold",
                      "flex items-center justify-center shadow",
                      pin.status === "fail" ? "bg-red-500" : "bg-amber-500"
                    )}
                  >
                    {pin.n}
                  </span>
                </div>
              );
            })}
          </div>
          {shot.clipped && (
            <p className="text-[11px] text-muted-foreground mt-1.5">
              The picture covers the first {Math.round((shot.height / shot.scale) / 100) * 100} pixels of a
              longer page. Findings below that point are listed but not marked.
            </p>
          )}
        </section>
      ) : (
        <p className="text-[12.5px] text-muted-foreground mb-6">
          No screenshot for this page: the render did not complete. Every finding below still applies.
        </p>
      )}

      {/* ── The marked findings, in the order they appear on the page ──── */}
      {pins.length > 0 && (
        <section className="audit-section mb-6">
          <h2 className="text-[13px] font-semibold mb-2.5">What is marked</h2>
          <ol className="space-y-3.5">
            {groups.map((g) => (
              <li key={g.checkId} className="audit-finding flex items-start gap-3">
                {/* Every badge for this finding, together. Six headings missing
                    a question mark is one problem marked six times, not six
                    problems. */}
                <span className="flex flex-col gap-1 shrink-0 mt-0.5">
                  {g.ns.map((n) => (
                    <span
                      key={n}
                      className={cn(
                        "h-5 w-5 rounded-full text-white text-[11px] font-semibold flex items-center justify-center",
                        g.status === "fail" ? "bg-red-500" : "bg-amber-500"
                      )}
                    >
                      {n}
                    </span>
                  ))}
                </span>
                <div className="flex-1 min-w-0">
                  <p className="text-[13px] font-medium leading-snug">{g.name}</p>
                  <p className="text-[12.5px] text-muted-foreground leading-snug mt-0.5">{g.detail}</p>
                  {g.labels.length > 0 && (
                    <ul className="mt-1 space-y-0.5">
                      {g.labels.map((l, i) => (
                        <li key={i} className="text-[11.5px] text-muted-foreground italic leading-snug line-clamp-1">
                          {g.ns[i]}. &ldquo;{l}&rdquo;
                        </li>
                      ))}
                    </ul>
                  )}
                  {g.remedy && <p className="text-[12.5px] leading-snug mt-1.5">{g.remedy}</p>}
                </div>
              </li>
            ))}
          </ol>
        </section>
      )}

      {/* ── And the ones with nowhere to point ─────────────────────────── */}
      {rest.length > 0 && (
        <section className="audit-section mb-6">
          <h2 className="text-[13px] font-semibold mb-1">Not visible on the page</h2>
          <p className="text-[11.5px] text-muted-foreground mb-2.5">
            These live in the page&rsquo;s code or its site settings rather than in what a reader sees, so
            there is nothing to mark on the picture.
          </p>
          <ul className="space-y-3">
            {rest.map((c) => (
              <li key={c.id} className="audit-finding flex items-start gap-2.5">
                {c.status === "fail" ? (
                  <AlertCircle className="h-4 w-4 text-red-500 shrink-0 mt-0.5" />
                ) : (
                  <AlertTriangle className="h-4 w-4 text-amber-500 shrink-0 mt-0.5" />
                )}
                <div className="flex-1 min-w-0">
                  <p className="text-[13px] font-medium leading-snug">
                    {c.name}
                    <span className="ml-1.5 text-[10.5px] font-normal uppercase tracking-wide text-muted-foreground">
                      {SECTION_LABEL[c.section] || c.section}
                    </span>
                  </p>
                  <p className="text-[12.5px] text-muted-foreground leading-snug mt-0.5">{c.detail}</p>
                  {c.remedy && <p className="text-[12.5px] leading-snug mt-1">{c.remedy}</p>}
                </div>
              </li>
            ))}
          </ul>
        </section>
      )}

      {/* ── Not measured. Stated, because an absent check reads as a pass ─ */}
      {notMeasured.length > 0 && (
        <section className="audit-section mb-6">
          <h2 className="text-[13px] font-semibold mb-1">Not measured</h2>
          <p className="text-[11.5px] text-muted-foreground mb-2">
            Looked for and not established. These are not passes.
          </p>
          <ul className="space-y-1.5">
            {notMeasured.map((c) => (
              <li key={c.id} className="text-[12px] text-muted-foreground leading-snug">
                <span className="text-foreground">{c.name}.</span> {c.detail}
              </li>
            ))}
          </ul>
        </section>
      )}

      {/* ── What is already right ──────────────────────────────────────── */}
      {passes.length > 0 && (
        <section className="audit-section">
          <button
            onClick={() => setShowPasses((v) => !v)}
            className="audit-no-print text-[12.5px] font-medium text-muted-foreground hover:text-foreground"
          >
            {showPasses ? "Hide" : "Show"} the {passes.length} checks this page passes
          </button>
          <div className={cn("mt-2", !showPasses && "hidden print:block")}>
            <h2 className="text-[13px] font-semibold mb-2 hidden print:block">Passing</h2>
            <ul className="grid grid-cols-1 sm:grid-cols-2 gap-x-6 gap-y-1">
              {passes.map((c) => (
                <li key={c.id} className="text-[12px] text-muted-foreground leading-snug">{c.name}</li>
              ))}
            </ul>
          </div>
        </section>
      )}

      <footer className="mt-8 pt-3 border-t text-[10.5px] text-muted-foreground">
        Checks describe how reachable, readable and quotable this page is for AI assistants. They are not
        weighted against each other and do not total to a score.
      </footer>
    </div>
  );
}

/** A human title for the header: the last path segment, tidied. */
function titleFromUrl(u: string): string {
  try {
    const { pathname, hostname } = new URL(u);
    const last = pathname.split("/").filter(Boolean).pop();
    if (!last) return hostname.replace(/^www\./, "");
    return last
      .replace(/\.(html?|php|aspx?)$/i, "")
      .replace(/[-_]+/g, " ")
      .replace(/\b\w/g, (m) => m.toUpperCase());
  } catch {
    return u;
  }
}
