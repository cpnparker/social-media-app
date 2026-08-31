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
import { buildPins, groupPins, unpinnedFindings, auditHeadline, isPlacement, cropOwners, splitCrops } from "@/lib/optimizer/audit-visual";
import { layoutFigure, CARD_HEIGHT, NOTE_WIDTH, NOTE_GAP, type Band } from "@/lib/optimizer/audit-callouts";

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
  const figure = shot ? layoutFigure(pins, shot) : null;
  const rest = unpinnedFindings(audit.checks, pins);
  // One close-up per PLACE. Three things are missing from under this H1, and
  // showing each of them the same strip of headline is the repetition this
  // report was rebuilt to stop.
  const owners = cropOwners(pins);
  const counts = auditHeadline(audit.checks);
  // An opportunity that earned a mark is shown on the picture instead; listing
  // it here as well would report one thing twice under two different headings.
  const notMeasured = audit.checks.filter(
    (c) => c.status === "info" && !pins.some((p) => p.checkId === c.id)
  );
  const [showPasses, setShowPasses] = useState(false);
  const passes = audit.checks.filter((c) => c.status === "pass");

  const fetched = (() => {
    try { return new Date(audit.fetchedAt).toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric" }); }
    catch { return ""; }
  })();

  return (
    <div className="audit-report mx-auto max-w-[72rem] px-5 py-6 text-foreground">
      <style>{`
        @media print {
          /* Landscape: the figure is a page in the middle with notes on both
             sides, and portrait leaves the middle column too narrow to read. */
          @page { size: A4 landscape; margin: 12mm; }
          html, body { height: auto !important; overflow: visible !important; }
          body { background: #fff !important; }
          /* Everything that is not the report. The app's own chrome has no
             business in a document going to a client.

             SELECTED BY WHAT CONTAINS THE REPORT, NOT BY DEPTH. This was
             \`body > *:not(.audit-print-root)\`, and the report is not a child of
             body: the shell wraps it three deep. That rule therefore hid the
             report's own ANCESTOR, and every PDF anyone printed came out
             blank. Measured on production before the fix: computed display of
             the shell "none", the report's rect 0x0, document.body.innerText 0
             characters while the report itself held 5,727. The
             \`visibility: visible\` line that was meant to rescue it could not:
             nothing was hidden by visibility, and visibility never overrides a
             display:none ancestor. */
          :has(.audit-print-root) > *:not(:has(.audit-print-root)):not(.audit-print-root) { display: none !important; }
          /* The chain down to the report is a column of flex boxes with fixed
             heights and their own scrollers. Left alone, an overflow:auto box
             prints only the part of itself that is on screen: 780px of 2,514,
             about a third of the report, and silently. */
          :has(.audit-print-root),
          .audit-print-root {
            display: block !important; position: static !important; flex: none !important;
            height: auto !important; min-height: 0 !important; max-height: none !important;
            overflow: visible !important;
          }
          /* Every status here is carried by a colour, and browsers drop
             background colours in print by default. Without this the red,
             amber and sky badges print as white circles with white numerals
             inside them, and the marks on the picture disappear. */
          .audit-print-root *, .audit-print-root *:before, .audit-print-root *:after {
            -webkit-print-color-adjust: exact !important; print-color-adjust: exact !important;
          }
          /* Print the LIGHT document whatever the app is set to. The rule
             above forces white paper, and the report's own text is
             \`text-foreground\`, which in dark mode resolves to near-white: the
             two together are white on white. Re-declaring the light tokens on
             the report is narrower than fighting each colour, and it also
             fixes the borders and the muted greys, which had the same
             problem. */
          .audit-print-root {
            color-scheme: light;
            --background: 0 0% 100%;
            --foreground: 224 71% 4%;
            --card: 0 0% 100%;
            --card-foreground: 224 71% 4%;
            --popover: 0 0% 100%;
            --popover-foreground: 224 71% 4%;
            --secondary: 220 14% 96%;
            --secondary-foreground: 224 71% 4%;
            --muted: 220 14% 96%;
            --muted-foreground: 220 9% 40%;
            --accent: 220 14% 96%;
            --accent-foreground: 224 71% 4%;
            --border: 220 13% 91%;
            --input: 220 13% 91%;
          }
          .audit-no-print { display: none !important; }
          /* Full bleed on the sheet, but the PROSE keeps its measure: the
             paragraphs carry their own max-width in ch, so widening the column
             here no longer sets remedy text at 185 characters a line. */
          .audit-report { max-width: none; padding: 0; }
          /* A finding split across a page break is a finding read twice. */
          .audit-finding { break-inside: avoid; page-break-inside: avoid; }
          figure { break-inside: avoid; page-break-inside: avoid; }
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
          <h1 className="text-[22px] font-semibold leading-tight tracking-tight mt-1 break-words">
            {audit.pageTitle || titleFromUrl(finalUrl || url)}
          </h1>
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
          <span className="text-muted-foreground">{counts.info} noted, not counted</span>
        )}
      </div>

      {/* ── The page, marked up ────────────────────────────────────────── */}
      {shot && figure ? (
        <section className="mb-7">
          <div className="flex items-baseline justify-between mb-2">
            <h2 className="text-[15px] font-semibold tracking-tight">Where the problems are</h2>
            <span className="text-[11px] text-muted-foreground">
              {pins.length} {pins.length === 1 ? "mark" : "marks"}
            </span>
          </div>
          <AnnotatedFigure band={figure} src={shot.dataUri} />
          {figure.callouts.some((c) => isPlacement(c.pin)) && (
            <p className="text-[11px] text-muted-foreground mt-2 flex items-center gap-1.5 justify-center">
              <span className="inline-block h-0 w-5 border-t-2 border-dashed border-sky-500" />
              A dashed line marks where something missing would go, rather than something already there.
            </p>
          )}
          {shot.clipped && (
            <p className="text-[11px] text-muted-foreground mt-2">
              The preview covers the first {Math.round((shot.height / shot.scale) / 100) * 100} pixels of a
              longer page. Findings below that point are listed but not marked.
            </p>
          )}
        </section>
      ) : (
        <p className="text-[12.5px] text-muted-foreground mb-6">
          No preview for this page: the render did not complete. Every finding below still applies.
        </p>
      )}

      {/* ── The marked findings, in the order they appear on the page ──── */}
      {groups.length > 0 && (
        <section className="audit-section mb-6">
          <h2 className="text-[15px] font-semibold tracking-tight mb-3">What is marked, and what to do</h2>
          <ol className="space-y-5">
            {groups.map((g) => (
              <li key={g.checkId} className="audit-finding">
                <div className="flex items-start gap-3">
                  <span className="flex flex-col gap-1 shrink-0 mt-0.5">
                    {g.ns.map((n) => (
                      <span
                        key={n}
                        className={cn(
                          "h-5 w-5 rounded-full text-white text-[11px] font-semibold flex items-center justify-center",
                          g.pins.some(isPlacement) ? "bg-sky-500" : g.status === "fail" ? "bg-red-500" : "bg-amber-500"
                        )}
                      >
                        {n}
                      </span>
                    ))}
                  </span>
                  <div className="flex-1 min-w-0">
                    {/* THE CHECK IS THE LABEL, THE FINDING IS THE HEADLINE.
                        These were the other way round, and every check here is
                        named for the state it wants: a page that skips three
                        heading levels was headed "Heading levels do not skip",
                        which is the opposite of what the finding says. A client
                        skimming the bold line read a list of passes. */}
                    <p className="text-[10.5px] uppercase tracking-wider text-muted-foreground">{g.name}</p>
                    <p className="text-[14px] font-medium leading-snug mt-0.5 max-w-[68ch]">{g.detail}</p>
                    {g.remedy && <p className="text-[12.5px] leading-relaxed mt-1.5 text-muted-foreground max-w-[78ch]">{g.remedy}</p>}
                  </div>
                </div>

                {/* The close-ups. Cut from the pixels each element was measured
                    in, so what is in the picture IS the thing being described —
                    the one part of this report that cannot point at the wrong
                    place. */}
                {(() => {
                  const { own, sharedWith } = splitCrops(g, owners);
                  return (
                    <>
                      {own.length > 0 && (
                        <div className="mt-2.5 ml-8 grid grid-cols-1 sm:grid-cols-2 gap-2.5">
                          {own.map((p) => (
                            // The card is a photograph of a white page, so it is white in
                            // both themes on purpose. Its caption therefore cannot use theme
                            // tokens: `bg-muted/40` over white with `text-muted-foreground`
                            // measured 1.08:1 in dark mode, which is invisible. Fixed
                            // neutrals, chosen against white rather than against the app.
                            <figure key={p.n} className="m-0 rounded-md border border-slate-200 overflow-hidden bg-white">
                              <div className="flex items-center gap-1.5 px-2 py-1 border-b border-slate-200 bg-slate-100">
                                <span
                                  className={cn(
                                    "h-4 w-4 rounded-full text-white text-[9.5px] font-semibold flex items-center justify-center shrink-0",
                                    isPlacement(p) ? "bg-sky-500" : p.status === "fail" ? "bg-red-500" : "bg-amber-500"
                                  )}
                                >
                                  {p.n}
                                </span>
                                <figcaption className="text-[10.5px] text-slate-600 truncate">
                                  {p.label || "on the page"}
                                </figcaption>
                              </div>
                              {/* eslint-disable-next-line @next/next/no-img-element */}
                              <img src={p.crop} alt={p.label || "The marked element"} className="block w-full" />
                            </figure>
                          ))}
                        </div>
                      )}
                      {sharedWith.length > 0 && (
                        <p className="mt-2 ml-8 text-[11.5px] text-muted-foreground">
                          Goes in the same place as {sharedWith.length === 1 ? "mark" : "marks"}{" "}
                          {sharedWith.join(" and ")}, shown above.
                        </p>
                      )}
                    </>
                  );
                })()}
              </li>
            ))}
          </ol>
        </section>
      )}

      {/* ── And the ones with nowhere to point ─────────────────────────── */}
      {rest.length > 0 && (
        <section className="audit-section mb-6">
          <h2 className="text-[15px] font-semibold tracking-tight mb-1">Not visible on the page</h2>
          <p className="text-[11.5px] text-muted-foreground mb-2.5 max-w-[78ch]">
            Nothing on the picture points at these: they sit in the page&rsquo;s code or its settings, or
            they apply across the page rather than at one spot.
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
                  {/* Same inversion as the marked findings: the check names the
                      state it wants, so it is the label and not the headline. */}
                  <p className="text-[10.5px] uppercase tracking-wider text-muted-foreground">
                    {c.name} <span className="mx-0.5">·</span> {SECTION_LABEL[c.section] || c.section}
                  </p>
                  <p className="text-[14px] font-medium leading-snug mt-0.5 max-w-[68ch]">{c.detail}</p>
                  {c.remedy && <p className="text-[12.5px] leading-relaxed mt-1 text-muted-foreground max-w-[78ch]">{c.remedy}</p>}
                </div>
              </li>
            ))}
          </ul>
        </section>
      )}

      {/* ── Not measured. Stated, because an absent check reads as a pass ─ */}
      {notMeasured.length > 0 && (
        <section className="audit-section mb-6">
          {/* "Not measured" was wrong for most of what lands here. The render
              time WAS measured; so was the absent FAQ block and the absent
              Article schema. What they have in common is that they are kept out
              of the counts, not that nobody looked. Each line says which it is. */}
          <h2 className="text-[15px] font-semibold tracking-tight mb-1">Noted, not counted</h2>
          <p className="text-[11.5px] text-muted-foreground mb-2 max-w-[78ch]">
            Deliberately left out of the figures above. Some of these were measured and are not scored;
            others could not be established at all. Either way they are not passes.
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
            <h2 className="text-[15px] font-semibold tracking-tight mb-2 hidden print:block">Passing</h2>
            <ul className="grid grid-cols-1 sm:grid-cols-2 gap-x-6 gap-y-1">
              {passes.map((c) => (
                <li key={c.id} className="text-[12px] text-muted-foreground leading-snug">{c.name}</li>
              ))}
            </ul>
          </div>
        </section>
      )}

      <footer className="mt-8 pt-3 border-t text-[11px] text-muted-foreground max-w-[78ch]">
        Checks describe how reachable, readable and quotable this page is for AI assistants. They are not
        weighted against each other and do not total to a score.
      </footer>
    </div>
  );
}

/**
 * The page, once, with every note around it and a line to each.
 *
 * ── DISPLAY PIXELS, NOT IMAGE PIXELS ────────────────────────────────────────
 *
 * The picture is scaled to fit; the notes are not, because a note is text. An
 * earlier version laid everything out in image pixels and scaled the whole
 * figure, so on a five-thousand-pixel page the notes came out ten pixels tall.
 *
 * ── AND WHAT THE PREVIEW IS FOR ─────────────────────────────────────────────
 *
 * It is a map. A page this long cannot be read at this size and is not meant to
 * be: the marks show WHERE the problems are, and the close-up under each
 * finding shows WHAT they are. Drawn full size instead, the figure is four
 * thousand pixels tall and you meet one note per screen, which reads as the
 * same problem over and over.
 */
function AnnotatedFigure({ band, src }: { band: Band; src: string }) {
  const snake = band.mode === "snake";
  // A snaked page has no notes, so it has no gutters either: the space goes to
  // the picture, which is the entire reason for cutting it into columns.
  const GUTTER = snake ? 0 : NOTE_WIDTH + NOTE_GAP;
  const W = GUTTER * 2 + band.pictureWidth;
  const H = band.height;
  // The whole capture, at the scale one column is drawn at. Each column is a
  // window onto it, shifted up by the columns before it.
  const fullImageHeight = band.previewHeight * band.columns;

  const markColour = (c: Band["callouts"][number]) =>
    isPlacement(c.pin) ? "rgb(14 165 233)" : c.pin.status === "fail" ? "rgb(239 68 68)" : "rgb(245 158 11)";

  return (
    <figure className="audit-finding m-0">
      {/* A fixed-width figure in a narrower column scrolls rather than
          collapsing. The absolute positions inside it are the marks, and a
          squeezed box moves them off the thing they point at. */}
      <div className="overflow-x-auto">
        <div className="relative mx-auto" style={{ width: W, height: H }}>
          {Array.from({ length: band.columns }).map((_, i) => (
            <div
              key={`col-${i}`}
              // ring, not border: a 1px border shrinks the content box, so the
              // picture came out 11px shorter than the box the marks are placed
              // in and every mark near the bottom pointed about 10px too low —
              // more than the height of the mark itself. A ring is painted
              // outside the layout and moves nothing.
              className="absolute overflow-hidden rounded-[3px] ring-1 ring-slate-300 bg-white"
              style={{
                left: GUTTER + i * (band.previewWidth + band.columnGap),
                top: 0,
                width: band.previewWidth,
                height: band.previewHeight,
              }}
            >
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={src}
                alt={band.columns === 1 ? "The page as it is published" : `The page as it is published, part ${i + 1} of ${band.columns}`}
                className="block max-w-none"
                style={{ width: band.previewWidth, height: fullImageHeight, marginTop: -i * band.previewHeight }}
              />
            </div>
          ))}

          {!snake && (
            <svg className="absolute inset-0 pointer-events-none" width={W} height={H}>
              {band.callouts.map((c) => {
                const cardEdge = c.side === "left" ? GUTTER - 6 : GUTTER + band.pictureWidth + 6;
                const cardY = c.top + CARD_HEIGHT / 2;
                const pinX = GUTTER + c.targetX + (c.side === "left" ? 0 : c.targetW);
                const mid = c.side === "left" ? cardEdge - 10 : cardEdge + 10;
                return (
                  <polyline
                    key={c.pin.n}
                    points={`${mid},${cardY} ${cardEdge},${cardY} ${cardEdge},${c.targetY + c.targetH / 2} ${pinX},${c.targetY + c.targetH / 2}`}
                    fill="none"
                    stroke={markColour(c)}
                    strokeWidth={1}
                    strokeLinejoin="round"
                  />
                );
              })}
            </svg>
          )}

          {band.callouts.map((c) =>
            // A PLACE, not a thing. Drawn as a dashed insertion rule across the
            // column with a caret, because a box implies there is something
            // inside it and the whole point of these is that there is not.
            isPlacement(c.pin) ? (
              <div
                key={`m-${c.pin.n}`}
                className="absolute flex items-center"
                style={{ left: GUTTER + c.targetX, top: c.targetY - 4, width: Math.max(c.targetW, 8), height: 9 }}
              >
                <span className="h-0 flex-1 border-t-2 border-dashed border-sky-500" />
                <span className="h-1.5 w-1.5 rounded-full bg-sky-500 shrink-0" />
              </div>
            ) : (
              <div
                key={`m-${c.pin.n}`}
                className={cn(
                  "absolute rounded-[2px] border-2",
                  c.pin.status === "fail" ? "border-red-500 bg-red-500/15" : "border-amber-500 bg-amber-500/15"
                )}
                style={{
                  left: GUTTER + c.targetX,
                  top: c.targetY,
                  width: Math.max(c.targetW, 6),
                  height: Math.max(c.targetH, 6),
                }}
              />
            )
          )}

          {/* On a snaked page the badge sits on the picture, because there is no
              note beside it to carry the number. */}
          {snake &&
            band.callouts.map((c) => (
              <span
                key={`b-${c.pin.n}`}
                className={cn(
                  "absolute h-[18px] w-[18px] rounded-full text-white text-[10.5px] font-semibold flex items-center justify-center ring-2 ring-white",
                  isPlacement(c.pin) ? "bg-sky-500" : c.pin.status === "fail" ? "bg-red-500" : "bg-amber-500"
                )}
                style={{ left: Math.max(0, GUTTER + c.targetX - 9), top: Math.max(0, c.targetY - 9) }}
              >
                {c.pin.n}
              </span>
            ))}

          {!snake &&
            band.callouts.map((c) => (
              <div
                key={`c-${c.pin.n}`}
                className="absolute flex items-start gap-1.5"
                style={{
                  [c.side]: 0,
                  top: c.top,
                  width: NOTE_WIDTH,
                  height: CARD_HEIGHT,
                  flexDirection: c.side === "left" ? "row" : "row-reverse",
                } as React.CSSProperties}
              >
                <span
                  className={cn(
                    "h-[17px] w-[17px] rounded-full text-white text-[10px] font-semibold flex items-center justify-center shrink-0 mt-[1px]",
                    isPlacement(c.pin) ? "bg-sky-500" : c.pin.status === "fail" ? "bg-red-500" : "bg-amber-500"
                  )}
                >
                  {c.pin.n}
                </span>
                <span className={cn("flex-1 min-w-0", c.side === "right" && "text-right")}>
                  <span className="block text-[11px] font-semibold leading-tight">{c.pin.name}</span>
                  {c.pin.label && (
                    <span className="block text-[10px] text-muted-foreground leading-snug mt-0.5 line-clamp-2 italic">
                      &ldquo;{c.pin.label}&rdquo;
                    </span>
                  )}
                </span>
              </div>
            ))}
        </div>
      </div>

      {/* The key. A snaked figure has numbers on it and nothing saying what they
          mean until several hundred pixels further down, which is exactly the
          moment a reader gives up on a picture. */}
      {snake && (
        <ul className="mt-3 mx-auto grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-x-6 gap-y-1" style={{ maxWidth: W }}>
          {band.callouts.map((c) => (
            <li key={`k-${c.pin.n}`} className="flex items-start gap-1.5 text-[11.5px] leading-snug">
              <span
                className={cn(
                  "h-[15px] w-[15px] mt-[1px] rounded-full text-white text-[9.5px] font-semibold flex items-center justify-center shrink-0",
                  isPlacement(c.pin) ? "bg-sky-500" : c.pin.status === "fail" ? "bg-red-500" : "bg-amber-500"
                )}
              >
                {c.pin.n}
              </span>
              <span className="min-w-0">
                <span className="font-medium">{c.pin.name}</span>
                {c.pin.label && <span className="text-muted-foreground"> &mdash; {c.pin.label}</span>}
              </span>
            </li>
          ))}
        </ul>
      )}
    </figure>
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
