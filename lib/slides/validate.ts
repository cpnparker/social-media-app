/**
 * The three geometry assertions, measured on the deck a user is about to see.
 *
 * They were written as checks 1, 2 and 11 of scripts/verify-slide-layouts.ts,
 * over roughly forty hand-written fixtures, run by hand, with no CI hook. So
 * every layout was measured and no DECK ever was: a slide whose arrangement of
 * real content falls off the canvas, or draws one box through another, was
 * caught only if somebody had thought to write that shape down as a fixture.
 * Both audits are worth having and they answer different questions — the
 * fixtures ask "can this layout be drawn badly", this asks "was this deck".
 *
 * THE SCRIPT NOW IMPORTS THESE FUNCTIONS. That is the point of the module and
 * not a tidy-up: the recorded failure mode in this repo is two copies of a rule
 * kept in step by a comment, and a runtime guard that had drifted from the
 * script would be worse than none, because the script's green would be read as
 * covering both. There is one implementation and two callers.
 *
 * WHY THESE THREE, AND IN THESE EXACT TERMS. Each carries an exclusion that
 * looks like slack and is not:
 *
 *   - OFF-CANVAS samples the four CORNERS under the full affine. Size × scale
 *     at the translate is not a bounding box: a line-chart segment is a sheared
 *     rectangle, and a full-bleed image carries scaleX: 2.
 *   - OVERLAP divides out SLIDES_TEXT_INSET.y before comparing, because Slides
 *     draws no glyph in the 3.6pt above or below the text and table cells
 *     overhang their row by exactly that, on purpose, so that ten rows do not
 *     spend 72pt on padding. It asserts on BOXES, which is what it has always
 *     asserted on; whether the two boxes draw glyphs where they meet is
 *     measured separately and decides what is said, not what is found.
 *   - OVERRUN measures INK, not boxes. Slides never shrinks or clips; it draws
 *     the text and lets it run. Plenty of boxes are deliberately tight around
 *     display type with empty space beneath, so the assertion is not that every
 *     box holds its text but that where text does run over, it runs onto
 *     nothing.
 *
 * WARNING-ONLY, AND DELIBERATELY. A check that is advisory in a script becomes
 * a refusal the day it runs at request time, and starts blocking decks that
 * shipped fine yesterday. GEOMETRY_SEVERITY below is the one seam a later
 * change flips, and what that decision needs is written beside it.
 *
 * WHERE IT RUNS, and where it deliberately does not. It runs in
 * buildSlidesDraft, once per built deck, after the pictures resolve and before
 * the preview model is walked — the one place all four chains pass through, and
 * the point at which a refusal would still precede a single slide being shown.
 * It does NOT run in draftPreview, which is what the preview route, the PDF
 * route and the conversation loader call: those re-render decks that were
 * measured when they were built, have no channel to report a fault into, and
 * would pay the cost on every page load of a conversation that contains a deck.
 * MEASURED, on the largest deck anyone has built here (41 slides): 4.0-4.4ms
 * warm over twenty runs, against 2.2-3.0ms for toPreviewModel and 2.4-2.9ms for
 * deckWarnings on the same deck, and 80ms for all 618 stored slides including
 * their builds. It is the price of one of the two things a draft already does,
 * beside a resolveDeckImages call that takes seconds.
 *
 * AND THE PUBLISH PATH IS NOT MEASURED. buildOrUpdateSlides has no advisory
 * field in its tool result, so a deck published without being drafted first —
 * a presentationId supplied, or publish: true on the first call — is built
 * unmeasured. Every ordinary deck is drafted first, which is why it was left;
 * the number to remember is that the rate below is the rate for DRAFTED decks
 * and not for all traffic.
 *
 * NOTHING IS REPAIRED HERE, and that is a decision rather than an omission.
 * placeCallouts can nudge a pin and say so because it OWNS the placement: it
 * decides where the pin goes, so moving it is part of deciding. This module
 * runs after every such decision has been made and emitted, and the emitted
 * requests are the contract boundary the preview, the PDF and the publish all
 * read. Nudging a box here would either move it in the preview and not in the
 * deck — the one failure a preview may not have — or make this module a second
 * layout engine, which is Stage 5's job and not a validator's. A fault is
 * therefore always DECLARED, never quietly corrected, and the layout that
 * produced it is fixed where it was produced.
 *
 * WHAT IT FOUND ON REAL TRAFFIC, 2026-09-17, and it is not zero. Run over the
 * 618 final-state slides of the 37 stored decks that have any (39 conversations
 * stored a draft; two stored one with no slides in it): 139 faults on 117
 * slides, 18.9%, in 27 decks — 1 off-canvas, 130 overlapping pairs, 8 overruns.
 * Of those, 31 on 15 slides in 9 decks are worth SAYING, which is the number
 * that matters and is explained below. The one off-canvas is the known live
 * defect (a single hero stat reports the whole band as its height, so a `body`
 * beneath it is placed at about 414pt on a 405pt canvas, conversation df7700f1
 * slide 15). It is left unfixed on purpose and check 46 pins it: a validator
 * that missed the one thing it was pointed at would be asleep.
 *
 * AND TWO FINDINGS ABOUT THE ASSERTIONS THEMSELVES, which is what a corpus run
 * is for. Both are cases where the fixtures could not have found the problem,
 * because a fixture set written to make layouts fail cannot pin a measure that
 * only real copy lands on.
 *
 * ONE — THE RULER. The overrun sweep measured every box at the unnamed 0.55em
 * worst case, as the check it was lifted from always had. On a battery of long
 * Roboto titles that is harmless; on real decks it is not, because all 6,694
 * stored preview text boxes name a face — Roboto 5,483, Playfair 1,093, Poppins
 * 118 — so the fallback fitted none of them. faceAdvance's own comment says
 * what it costs: Roboto over-measured by nearly a third, a bullet that draws on
 * one line counted as two. Measuring each box in the face it is drawn in takes
 * the corpus from 29 overruns on 18 slides to 8 on 6; the 21 it drops are boxes
 * counted as wrapping at 0.55em that do not wrap at their own face's advance —
 * a matrix caption of 19 characters at 8pt in a 95pt column is the type case,
 * and is why matrix read as the worst layout in the deck. Check 46i pins it in
 * both directions.
 *
 * TWO — BOXES AND GLYPHS. 108 of the 130 overlapping pairs are boxes that
 * overlap and INK that does not, and 99 of those are the photo credit and the
 * footer: two boxes on the same line at y≈381, one drawn from the right and one
 * from the left, with about 375pt of clear space between the words. Twenty-seven
 * of the thirty-seven decks carry a fault at all, and on EIGHTEEN of them every
 * fault they have is one of these. The assertion is RIGHT — it is a latent
 * collision, held off only by both strings staying short, and the script still
 * fails on it — but a sentence telling a user that two boxes are drawn on top
 * of each other is false about that deck. So the assertion is unchanged, and
 * what is RELAYED is gated on the glyphs meeting (see relayableFaults and
 * inkSpanX), which takes the deck-facing report from 99 sentences on 27 decks
 * to 18 on 9. The escalation decision needs that
 * distinction more than anything else in this file: most of what this measures
 * is one pattern in one place, and the answer to one pattern in one place is to
 * fix the layout, not to start refusing decks.
 *
 * MUTATION LOG (detached worktree, 2026-09-17). These are the assertions; the
 * check that drives them keeps its own log beside it. Every entry below was run
 * against the whole fixture battery, and the two survivors against the 1,042
 * stored slides as well, because a mutation that survives one corpus and dies
 * on the other says something about both.
 *  - KILLED: the affine reduced to `translate + size x scale`, the corner
 *    sampling gone. The sheared fixture's corner is 30pt off the page and its
 *    axis-aligned box is not, so the reduction reports nothing at all.
 *  - KILLED: SLIDES_TEXT_INSET.y dropped from the overlap comparison. 128
 *    fixture failures, nearly all of them table rows that touch by design.
 *  - KILLED: the millionth-of-a-point tolerance made exact. 9 failures, all of
 *    them a track's rows separated by 2.8e-14pt.
 *  - KILLED: the side-by-side skip removed from the overrun sweep. 7 failures:
 *    a matrix quadrant caption reads as running onto the quadrant beside it.
 *  - KILLED: the `above it` skip removed as well. 223 failures — every column
 *    heading on the slide reads as running onto the title above it.
 *  - KILLED: inkBottom measuring from the top of the PAGE rather than the top
 *    of the box (`el.y +` dropped).
 *  - KILLED (46j, RE-RUN 2026-09-17 after inkBottom MOVED to generate.ts so
 *    that the builder and this file cannot end up with two rulers): INK_LEAD
 *    loosened from 1.38 to 1.2. Still red, and still from this file's own
 *    fixture — the move changed where the code lives and nothing else.
 *  - KILLED (46n): the bold/semibold glyph branch of inkBottom deleted, so
 *    every box is measured at the mean. THIS ONE CHANGED ITS ANSWER. Against
 *    the old unnamed 0.55em it killed 14 fixtures; against Roboto's own 0.443
 *    the whole battery went green, because the mean it is protecting against is
 *    now the right mean and no fixture holds a bold label the mean under-counts
 *    — while four real overruns in the stored drafts are still found only here.
 *    A branch nothing drives is a branch the next person deletes, so 46n now
 *    holds one: twenty characters of bold Roboto that measure one line at the
 *    mean and two glyph by glyph.
 *  - KILLED: the single-glyph ornament skip removed. 23 failures — the quote
 *    mark, and every numeral in a process row. Also expected to survive, also
 *    wrong.
 *  - KILLED (46i): the face dropped from the ink measurement, which is how this
 *    module shipped its first draft. One fixture, and 21 of the 29 overruns it
 *    reported on real decks.
 *  - KILLED (46j): INK_LEAD loosened from 1.38 to 1.2. It used to survive the
 *    whole battery while halving what the validator reports on real decks (the
 *    corpus falls from 8 overruns to 3, and from 13 to 3 across every stored
 *    draft), which is the larger of the two levers in this measurement going
 *    unpinned. 46j now straddles it: four lines that land 3.8pt into the box
 *    below at 1.38 and 3.4pt clear of it at 1.2.
 *  - KILLED (46k): the ink gate forced on and forced off. On, the credit reads
 *    as drawn through the footer; off, a real collision is silently excused and
 *    the deck says nothing.
 *  - KILLED (46m): the per-slide guard around the sweeps removed, and the size
 *    guard in the off-canvas sweep removed. Both end with the validator
 *    throwing, which on the build path means the guard is what stopped the
 *    deck — the one thing this stage promises cannot happen.
 *  - KILLED (46l): MAX_NOTES turned down to 1, and the counted tail deleted.
 *    What a user is told was the only part of this module nothing drove.
 *  - KILLED (46f): the notes keyed on the slide rather than the slide and the
 *    kind. Only off-canvas and overrun faults carry a distance to sort on, so
 *    the fault that loses is always a collision: the hero stat would report its
 *    body off the page and say nothing about the text drawn through the footer.
 *  - KILLED (46h): logDeckGeometry emptied out, and its call site removed. The
 *    rate is the single input the escalation decision needs and it was the one
 *    line nothing asserted.
 *  - SURVIVED, on the fixtures AND on all 1,042 stored slides: EDGE_TOLERANCE
 *    loosened from 0.6pt to 5pt — the off-canvas counts do not move, 1 and 2.
 *    Nothing anybody has built sits between those two numbers, so no corpus
 *    available here can pin the value. It is 0.6 because it exists to absorb a
 *    sum of fractions, not to forgive a layout, and at 5pt it would forgive one.
 *  - SURVIVED THE FIXTURES, KILLED BY THE CORPUS: INK_TOLERANCE loosened from
 *    1pt to 3pt. Every fixture stays green; the stored decks lose 1 of their 8
 *    overruns and 5 of the 13 across every draft. A fixture set written to make
 *    layouts fail cannot pin a number that only real text lands on, which is
 *    the argument for running both.
 *
 * AND FOR THE FOURTH SWEEP AND THE COLUMN RULER (Stage 5, 2026-09-23; check
 * 57 drives both):
 *  - KILLED (57g): offPageFaults dropped from validateDeck. A cover whose
 *    kicker runs off the page is reported by nothing else — no box beneath it
 *    to overrun, and its box is on the canvas.
 *  - KILLED (57g, 46f): offPageFaults measuring the box instead of the ink.
 *  - KILLED (57f): the column ruler removed from measuredOnWords — overruns on
 *    composed columns the builder had fitted on words.
 *  - KILLED (57l): a written composition read on the narrow-only ruler — a
 *    bold label's second line, drawn on the next bullet, passed.
 *  - KILLED (57l), after surviving the first version of 57: offPageFaults
 *    reading columns on the count model. No composed column reached the foot
 *    of the page in the sweep; 57(l) sets one there.
 *  - Over the 1,404 stored slides the fourth sweep reports 4 lines at `read`
 *    and 14 at `present`, every one on a slide the three sweeps above had
 *    already faulted; the column ruler moves no fault on any of them.
 *
 * AND THE FIFTH, THE RIGHT EDGE (wideWordFaults, 2026-09-24):
 *  - KILLED (57n): validateDeck without it.
 *  - KILLED (57n), after surviving its first version: the builder's 3% margin
 *    read as ink.
 *  - Over the 1,404 stored slides it reports nothing: no stored column holds
 *    a word wider than itself. Turned on for every box, it read one
 *    timeline-parallel phase ("Workshop", on a slide already faulted) and the
 *    fixture battery's stat grid, "Wikipedia" 3pt past a label — the fitters
 *    of those layouts', recorded rather than ruled on here.
 */

import { CANVAS, layoutOf, withDensity } from "@/lib/slides/brand";
import { SLIDES_TEXT_INSET } from "@/lib/slides/preview-style";
import {
  buildSlideRequests, faceAdvance, inkBottom, labelWidthPt, TEXT_INSET_X, compositionOf, COMPOSE_FIELDS, widestWordPt, RAGGED_KERN_MARGIN, densityOf, type SlideInput,
} from "@/lib/slides/generate";
import { previewSlideFrom, type PreviewElement, type PreviewSlide } from "@/lib/slides/preview-model";
import { normaliseSlide } from "@/lib/slides/edit";

export type GeometryFaultKind = "off-canvas" | "overlap" | "overrun" | "off-page";

export interface GeometryFault {
  kind: GeometryFaultKind;
  /** 1-based: the number on the slide, the number every other note uses. */
  slide: number;
  layout: string;
  /** Which element, in the builder's own terms — an object id suffix or the
   *  first words of the text. For the corpus run and the check, not for the
   *  model: an object id is not something anyone can act on. */
  where: string;
  /** Points past whatever it was measured against. Zero where the fault is not
   *  a distance (a pair of boxes that intersect). */
  overBy: number;
  /** OVERLAP ONLY: whether the two boxes draw GLYPHS where they meet, measured
   *  with alignment. The assertion is about boxes and stays about boxes; this
   *  says whether anybody could see it, and it is what decides whether the
   *  fault is worth a sentence. See relayableFaults. */
  inkMeets?: boolean;
  /** The sentence deckWarnings relays, naming the slide and the field. */
  note: string;
}

export interface DeckGeometry {
  faults: GeometryFault[];
  slidesChecked: number;
  /** Requests carrying an elementProperties — what off-canvas swept. */
  elementsChecked: number;
  /** Preview text boxes — what overlap swept. */
  textBoxesChecked: number;
  /** Text boxes long enough to measure as ink — what overrun swept. */
  inkBoxesChecked: number;
  /** Slides that could not be MEASURED — the builder threw, or a sweep did. A
   *  slide that cannot build is a different report's problem (the refusal
   *  path), but a validator silently measuring nothing is exactly the failure
   *  this repo has already paid for, so the count is carried rather than
   *  swallowed, and the check drives it with a slide the builder rejects. */
  unbuildable: number;
  ms: number;
}

/* ── off-canvas ─────────────────────────────────────────────────────────── */

/** Half a point of slack, which is below anything a renderer resolves and
 *  above the arithmetic. Bigger would hide a real overflow; exact would report
 *  a box placed at the margin by a sum of fractions. */
const EDGE_TOLERANCE = 0.6;

/** Every element of one slide whose drawn rectangle leaves the 720 × 405 page.
 *
 *  FOUR CORNERS UNDER THE FULL AFFINE. A line-chart segment is a sheared and
 *  scaled unit rectangle, so its width and height at the translate describe a
 *  box it does not occupy; a check on size alone also missed scaleX: 2 on a
 *  full-bleed image. The corners are the cheapest thing that is right for both.
 */
export function offCanvasFaults(
  requests: any[], slide: SlideInput, index: number
): { faults: GeometryFault[]; elements: number } {
  const faults: GeometryFault[] = [];
  const layout = String(slide.layout || "content");
  let elements = 0;
  for (let r = 0; r < requests.length; r++) {
    const values = Object.values(requests[r] || {});
    const body: any = values.length ? values[0] : undefined;
    const ep = body && body.elementProperties;
    if (!ep) continue;
    // An element with no size cannot be measured, and must not be allowed to
    // throw: this runs on the build path, where the one thing this stage
    // promises is that nothing the validator finds can stop a deck. Every
    // elementProperties the builder writes today carries a size, so nothing is
    // skipped here — and because the count below is asserted against the
    // fixtures' own, a layout that starts emitting one goes red on the count
    // rather than quietly shrinking what is swept.
    if (!ep.size || !ep.size.width || !ep.size.height) continue;
    elements++;
    const t = ep.transform || {};
    const x = t.translateX, y = t.translateY;
    const scaleX = t.scaleX === undefined ? 1 : t.scaleX;
    const scaleY = t.scaleY === undefined ? 1 : t.scaleY;
    const shearX = t.shearX === undefined ? 0 : t.shearX;
    const shearY = t.shearY === undefined ? 0 : t.shearY;
    const w = ep.size.width.magnitude, h = ep.size.height.magnitude;
    const corners: number[][] = [[0, 0], [w, 0], [0, h], [w, h]];
    // How far past the worst edge, so a note can say 9pt rather than "off".
    let over = 0;
    for (let c = 0; c < corners.length; c++) {
      const u = corners[c][0], v = corners[c][1];
      const px = scaleX * u + shearX * v + x;
      const py = shearY * u + scaleY * v + y;
      over = Math.max(over, -px, -py, px - CANVAS.width, py - CANVAS.height);
    }
    if (over > EDGE_TOLERANCE) {
      const id = String((body && body.objectId) || "");
      faults.push({
        kind: "off-canvas", slide: index + 1, layout, where: id || `${Math.round(w)}x${Math.round(h)}`,
        overBy: over,
        note: `slide ${index + 1}: the ${layout} layout draws ${describe(id, w, h)} ${Math.round(over)}pt past the edge` +
          ` of the slide, so part of it is missing from the deck and from the preview`,
      });
    }
  }
  return { faults, elements };
}

/** An element named the way a person reads a slide, not the way the builder
 *  addresses it. The suffix of an object id is the box's role — `_body`,
 *  `_title`, `_sv0` — and it is the only handle this layer has. */
function describe(objectId: string, w: number, h: number): string {
  const suffix = objectId.split("_").slice(2).join("_");
  const size = `${Math.round(w)} × ${Math.round(h)}pt`;
  return suffix ? `its \`${suffix}\` box (${size})` : `an element (${size})`;
}

/* ── overlap ────────────────────────────────────────────────────────────── */

/** Two text boxes overlapping is not the same as two boxes touching.
 *
 *  A six-row table lays its rows out by accumulating fractional heights, so the
 *  row below starts 2.8e-14pt above where the row above ended. An exact
 *  comparison reads that as a collision, eight times on one slide. The
 *  tolerance is a millionth of a point: far below what a reader or a renderer
 *  can resolve, and far above the arithmetic. */
const TOUCH_EPS = 1e-6;

/** The horizontal span the GLYPHS occupy inside a box, which is not the box.
 *
 *  Two boxes can overlap for hundreds of points and draw nothing anywhere near
 *  each other. The photo credit is a 432pt box drawn END-aligned and the footer
 *  is a 671pt box drawn START-aligned, both on the same line at y≈381: the
 *  boxes intersect across about 375pt in which neither draws a glyph. On the
 *  stored decks that ONE pattern is 99 of 130 reported pairs, and on eighteen of
 *  the thirty-seven decks it is every fault the deck has.
 *
 *  MEASURED GENEROUSLY, ON PURPOSE, because this only ever SUPPRESSES a report.
 *  Every approximation in it leans wide: Roboto and Playfair through the
 *  measured glyph tables — Roboto's is semibold-to-bold, an upper bound for the
 *  regular weight most body copy is drawn at — the 6% sizing margin left in
 *  rather than divided out, and a bullet's hanging indent ignored because the
 *  disc itself is drawn at the inset. A pair this says is apart is apart. */
function inkSpanX(el: PreviewElement): { from: number; to: number } {
  const size = el.size || 10;
  const inner = Math.max(0, el.w - TEXT_INSET_X);
  const face = el.font === "Roboto" || el.font === "Playfair Display" ? el.font : undefined;
  const paras = String(el.text || "").split("\n");
  let widest = 0;
  for (let i = 0; i < paras.length; i++) {
    const w = face
      ? labelWidthPt(paras[i], size, { face, caps: !!el.caps })
      // A face with no glyph table — Poppins — measured at its own mean, with
      // the same margin the tables carry, so both routes lean the same way.
      : paras[i].trim().length * size * faceAdvance(el.font, !!el.caps) * 1.06;
    // A line wider than the box wraps, so no line is drawn wider than the box.
    widest = Math.max(widest, Math.min(inner, w));
  }
  const left = el.x + SLIDES_TEXT_INSET.x;
  if (el.align === "end") return { from: left + inner - widest, to: left + inner };
  if (el.align === "center") return { from: left + (inner - widest) / 2, to: left + (inner + widest) / 2 };
  return { from: left, to: left + widest };
}

export function overlapFaults(
  page: PreviewSlide, slide: SlideInput, index: number
): { faults: GeometryFault[]; texts: number } {
  const layout = String(slide.layout || "content");
  const faults: GeometryFault[] = [];
  const texts: PreviewElement[] = [];
  for (let i = 0; i < page.elements.length; i++) {
    if (page.elements[i].kind === "text") texts.push(page.elements[i]);
  }
  // Once per box rather than once per pair: the sweep below is O(n²) and the
  // measurement is the expensive part of it.
  const spans: { from: number; to: number }[] = [];
  for (let i = 0; i < texts.length; i++) spans.push(inkSpanX(texts[i]));
  for (let a = 0; a < texts.length; a++) {
    for (let b = a + 1; b < texts.length; b++) {
      const p = texts[a], q = texts[b];
      // The vertical INSET is not content: Slides never draws a glyph in the
      // 3.6pt above or below the text, and table cells overhang their row by
      // exactly that so that ten rows do not spend 72pt on padding. Two cells
      // whose insets touch are not two texts that touch.
      const iy = SLIDES_TEXT_INSET.y;
      const py0 = p.y + iy, py1 = p.y + Math.max(0, p.h - iy);
      const qy0 = q.y + iy, qy1 = q.y + Math.max(0, q.h - iy);
      const apart = p.x + p.w <= q.x + TOUCH_EPS || q.x + q.w <= p.x + TOUCH_EPS
        || py1 <= qy0 + TOUCH_EPS || qy1 <= py0 + TOUCH_EPS;
      if (apart) continue;
      // The BOXES overlap, which is what this assertion has always been about
      // and still is. Whether the GLYPHS do is a second question, and the
      // answer decides what the fault says rather than whether it is one.
      // Strictly disjoint, not "nearly apart": the spans above are already
      // generous, so a pair whose ink comes within a point of touching is
      // reported rather than excused. This gate exists to drop the pairs that
      // are 375pt clear, not to shave the close ones.
      const inkMeets = spans[a].to > spans[b].from + TOUCH_EPS
        && spans[b].to > spans[a].from + TOUCH_EPS;
      faults.push({
        kind: "overlap", slide: index + 1, layout, where: `${clip(p.text, 18)} / ${clip(q.text, 18)}`,
        overBy: 0, inkMeets,
        note: inkMeets
          ? `slide ${index + 1}: ${pair(p, q)} overlap, and both draw text where they meet` +
            ` — "${clip(p.text, 28)}" over "${clip(q.text, 28)}"`
          : `slide ${index + 1}: ${pair(p, q)} overlap, though their text does not meet` +
            ` — "${clip(p.text, 28)}" beside "${clip(q.text, 28)}"`,
      });
    }
  }
  return { faults, texts: texts.length };
}

/* ── ink overrun ────────────────────────────────────────────────────────── */

/** A point of slack on every comparison: the same reason as EDGE_TOLERANCE,
 *  at the scale a line box is measured to. */
const INK_TOLERANCE = 1;

/** Where the last line's ink lands, measured from the top of the box.
 *
 *  MEASURED IN generate.ts NOW, and re-exported here under the name everything
 *  already imports. It moved because the BUILDER has to ask the same question
 *  at build time: the deck frame's hairlines are full-bleed rects, and this
 *  sweep compares text with text, so a rule drawn along the baseline of a
 *  chart's source line is invisible to it — which is exactly what shipped on
 *  ten of the 618 stored slides before the frame learned to measure. Two
 *  rulers would have made the frame's decision and this file's verdict
 *  disagree, and the disagreement would have been the bug. The line box, the
 *  bold branch and the face it measures in are all unchanged; the comment that
 *  explains them travels with the code.
 *
 *  It is typed structurally there, so a PreviewElement still satisfies it. */
export { inkBottom };

/** The thickest filled rectangle that is a RULE rather than a block: the
 *  title's accent segment is 3pt, every hairline is 1pt, and a panel, a bar or
 *  a tint is tens of points. And it has to be a line — four times as long as
 *  it is thick — so a small square marker is not a rule. */
const RULE_MAX_THICKNESS = 3;

/** How far past a rule the measured ink must reach before it is a crossing, in
 *  ems of the text's own size. The ruler measures LINE BOXES, and the bottom
 *  third of a last line's box — its descenders and half its leading — holds no
 *  ink for most words and none at all for a figure or a caps label. Measured
 *  on the fixtures and the 94 stored drafts: every label that SITS on its rule
 *  by design (a line chart's benchmark label, its last point's value above the
 *  zero rule, 7-9pt, 1.3-2.6pt into the box's foot) is inside 0.35em, and every
 *  real crossing — a wrapped second line, 10-11pt past — is well outside it. */
const RULE_CLEAR_EM = 0.35;

/** Text that runs out of its box and through a RULE drawn under it.
 *
 *  The sweep below compares text with TEXT, so a line of copy drawn through a
 *  hairline was invisible to it: a comparison cell that wrapped ran its second
 *  line straight through the rule under its row — "N - no brand, no keyword",
 *  the Amrize scorecard, 2026-09-23 — and validateDeck reported slide 18's one
 *  text-on-text overrun and nothing for slide 17, whose rows were crossed three
 *  times. A rule is a shape, and it is drawn precisely where the next row
 *  starts, so it is the first thing an overrun lands on. The same gates as
 *  the text sweep: the ink must leave its own box, and the rule must sit at
 *  or below the box's foot, under the words rather than beside them.
 *
 *  AND OVER THEM, for a box drawn MIDDLE-anchored. Its block is centred on
 *  the box's middle, so a block taller than the box leaves it by the TOP as
 *  far as by the foot, and the rule above a comparison row is exactly as close
 *  as the rule below it. Looking only downwards, the last row of a scorecard —
 *  which has no row rule beneath it — could run through the rule above it and
 *  be reported by nothing. The head of a first line box is leading and the
 *  room above the ascenders, about as deep as the foot of a last line with no
 *  descenders, so the same clearance is allowed at both ends — and Chrome
 *  agrees where it was put to the test: a first-row cell whose block reaches
 *  1.8pt past the header rule by this measure draws clear of it (check 54e),
 *  while a third-row cell, 5.8pt past the rule above it, draws through.
 *
 *  Each crossing comes back with how far past the rule the ink reaches, and
 *  which side of the box it is on. */
function ruleCrossings(
  el: PreviewElement, bottom: number, rects: PreviewElement[]
): { rule: PreviewElement; over: number; above: boolean }[] {
  const hit: { rule: PreviewElement; over: number; above: boolean }[] = [];
  const clear = Math.max(INK_TOLERANCE, RULE_CLEAR_EM * (el.size || 10));
  // Where a centred block's first line starts: as far above the middle as its
  // foot is below it. A box anchored at the top cannot leave it upwards.
  const centred = !!el.vCenter && el.h > 0;
  const top = centred ? 2 * el.y + el.h - bottom : el.y;
  for (let r = 0; r < rects.length; r++) {
    const rule = rects[r];
    if (rule.h > RULE_MAX_THICKNESS || rule.w < 4 * rule.h) continue;
    const beside = el.x + el.w <= rule.x + 1 || rule.x + rule.w <= el.x + 1;
    if (beside) continue;
    if (rule.y >= el.y + el.h - INK_TOLERANCE) {
      if (bottom > rule.y + clear) hit.push({ rule, over: bottom - rule.y, above: false });
    } else if (centred && rule.y + rule.h <= el.y + INK_TOLERANCE) {
      if (top < rule.y + rule.h - clear) hit.push({ rule, over: rule.y + rule.h - top, above: true });
    }
  }
  return hit;
}

/** THE BOXES MEASURED ON WORDS: a comparison's middle-anchored cells and
 *  labels, which the builder FITS to their rows on the wrap ruler
 *  (fitComparisonCell). Measured here with anything else, a cell the builder
 *  wrapped to four lines is read as three, and a cell the builder never
 *  fitted — the shape this sweep exists to catch — is read as fitting. Every
 *  other box keeps the ruler it was drawn with, which is the builder's own
 *  rule for the same ruler: it is taken where it is asked for.
 *
 *  AND A COLUMN OF A BAND THAT ASKED FOR IT: every column of a composition
 *  (three-column is one) and of the photo rail, whose blocks bulletBlock
 *  wraps on words wherever the measure is narrow (`ragged: true`). Read with
 *  the count model instead, a 196pt column the builder had fitted to its band
 *  was reported as running over it — on generated compositions that was
 *  every fault the builder had not declared, and against the builder's own
 *  ruler there were none at `read`. inkBottom still only takes the wrap ruler
 *  where the measure is narrow enough to need it, as the builder does — and a
 *  WRITTEN composition's column at every measure, with its bold runs in the
 *  bold face (`words`), because that is how bulletBlock fitted it. Read on the
 *  narrow-only ruler, a bold label that wrapped in a 374pt column was read as
 *  one line, and the second line drawn on the next bullet passed. The
 *  column is known by its path, which pathOf gives every paragraph box of
 *  `body`, `bodyRight` and `bodyThird`. */
function measuredOnWords(
  el: PreviewElement, layout: string, columns: ColumnRuler = null
): { ragged?: boolean; words?: boolean; boldRanges?: { start: number; end: number }[] } | null {
  if (layout === "comparison" && !!el.vCenter) return { ragged: true };
  // AND A WRITTEN COMPOSITION'S STANDFIRST, which the builder boxes on words
  // too (composedBand): read on the count model, a two-line standfirst boxed
  // for two would be reported running into the columns it sits above.
  if (columns === "words" && el.path && el.path.length === 1 && el.path[0] === "subtitle") {
    const bold: { start: number; end: number }[] = [];
    const acc = el.accents || [];
    for (let i = 0; i < acc.length; i++) if (acc[i].bold) bold.push({ start: acc[i].start, end: acc[i].end });
    return { words: true, boldRanges: bold };
  }
  if (!columns || !el.path || el.path.length !== 1 || COMPOSE_FIELDS.indexOf(String(el.path[0])) < 0) return null;
  if (columns === "ragged") return { ragged: true };
  // A WRITTEN COMPOSITION'S COLUMN, on the ruler bulletBlock fitted it on:
  // words at every measure, and its bold runs — the lead-in, the **label** —
  // in the bold face, read off the box's own styled ranges.
  const bold: { start: number; end: number }[] = [];
  const acc = el.accents || [];
  for (let i = 0; i < acc.length; i++) if (acc[i].bold) bold.push({ start: acc[i].start, end: acc[i].end });
  return { words: true, boldRanges: bold };
}

/** How a slide's columns were measured when they were drawn: on words where
 *  the measure is narrow (`ragged` — three-column's derived columns and the
 *  photo rail), on words at every measure with bold runs in bold (`words` —
 *  a written composition), or not as columns at all. Asked of the slide AS
 *  THE BUILDER DRAWS IT, normalised, because an image-split slide carrying
 *  `bodyRight` is stored as one layout and drawn as another. */
type ColumnRuler = "ragged" | "words" | null;
function columnRuler(slide: SlideInput, index: number): ColumnRuler {
  const drawn = normaliseSlide(slide);
  const as = layoutOf(drawn.layout, index);
  if (as === "photo-rail") return "ragged";
  // AT THE SLIDE'S OWN DENSITY: whether a composition is drawn at all is
  // measured (composeDecision), and `present`'s band is not `read`'s.
  const comp = withDensity(densityOf(slide), () => compositionOf(drawn, as, index));
  return comp ? (comp.written ? "words" : "ragged") : null;
}

export function overrunFaults(
  page: PreviewSlide, slide: SlideInput, index: number
): { faults: GeometryFault[]; measured: number } {
  const layout = String(slide.layout || "content");
  const faults: GeometryFault[] = [];
  const texts: PreviewElement[] = [];
  const rects: PreviewElement[] = [];
  for (let i = 0; i < page.elements.length; i++) {
    const e = page.elements[i];
    if (e.kind === "text" && e.text) texts.push(e);
    else if (e.kind === "rect" && !e.transform) rects.push(e);
  }
  let measured = 0;
  const onWords = columnRuler(slide, index);
  for (let i = 0; i < texts.length; i++) {
    const el = texts[i];
    // A single glyph is an ornament — the quote mark — and its line box is
    // mostly the space a descender would use. Measuring it as ink says it
    // collides with everything under it, which it visibly does not.
    if (String(el.text).trim().length <= 1) continue;
    measured++;
    const ruler = measuredOnWords(el, layout, onWords);
    const bottom = inkBottom(ruler ? { ...el, ...ruler } : el);
    if (bottom <= el.y + el.h + INK_TOLERANCE) continue;   // stays inside its own box
    for (let j = 0; j < texts.length; j++) {
      const other = texts[j];
      if (other === el) continue;
      const sideBySide = el.x + el.w <= other.x + 1 || other.x + other.w <= el.x + 1;
      if (sideBySide || other.y < el.y + el.h) continue;    // beside it, or above it
      if (bottom > other.y + INK_TOLERANCE) {
        faults.push({
          kind: "overrun", slide: index + 1, layout, where: `${clip(el.text, 24)} onto ${clip(other.text, 20)}`,
          overBy: bottom - other.y,
          note: `slide ${index + 1}: ${field(el, "the text")} runs ${Math.round(bottom - other.y)}pt past its box` +
            ` and is drawn through ${field(other, "the box beneath it")}` +
            ` — "${clip(el.text, 28)}" over "${clip(other.text, 28)}"`,
        });
      }
    }
    // ONE fault per box for the rules it crosses, measured to the first: a
    // cell that runs through its row's hairline and the next one is one
    // sentence, not two — and a centred cell through the rules above AND
    // below it is one sentence that names both.
    const crossed = ruleCrossings(el, bottom, rects);
    if (crossed.length) {
      let first = crossed[0];
      let up = false, down = false;
      for (let c = 0; c < crossed.length; c++) {
        if (crossed[c].over > first.over) first = crossed[c];
        if (crossed[c].above) up = true; else down = true;
      }
      const where = up && down ? "the rules above and beneath it" : up ? "the rule above it" : "the rule beneath it";
      faults.push({
        kind: "overrun", slide: index + 1, layout, where: `${clip(el.text, 24)} onto a rule`,
        overBy: first.over,
        note: `slide ${index + 1}: ${field(el, "the text")} runs ${Math.round(first.over)}pt past its box` +
          ` and is drawn through ${where} — "${clip(el.text, 28)}"`,
      });
    }
  }
  return { faults, measured };
}

/* ── ink off the page ───────────────────────────────────────────────────── */

/** WORDS WHOSE INK RUNS PAST THE FOOT OF THE SLIDE, which none of the three
 *  sweeps above can say.
 *
 *  Off-canvas measures BOXES, and a box the builder clamped to its band is on
 *  the canvas however much text it holds: bulletBlock never draws a box past
 *  its band, because Slides draws a box's text from its top and lets it run.
 *  The overrun sweep measures ink, but only onto ANOTHER box or rule beneath
 *  it, and at the foot of the page there may be none — a cover, a closing
 *  slide, a page whose frame yielded its bottom rule to the very ink running
 *  through it. So a column of words could leave the slide with every box on
 *  it and nothing beneath it, and all three sweeps stay green.
 *
 *  ON A PAGE WITH ITS CHROME THIS IS RARELY THE ONLY REPORT, and that was
 *  measured rather than assumed: over 4,000 generated compositions with the
 *  running head and the folio on the page, every ink past the canvas was
 *  also an overrun through them. What this adds is the right sentence — the
 *  words are not on the slide, not merely drawn through its footer — and a
 *  report on the pages that carry nothing below the words to be drawn
 *  through. Measured with the ruler the overrun sweep uses, so the two never
 *  disagree about where one box's ink ends. */
export function offPageFaults(
  page: PreviewSlide, slide: SlideInput, index: number
): { faults: GeometryFault[]; measured: number } {
  const layout = String(slide.layout || "content");
  const faults: GeometryFault[] = [];
  let measured = 0;
  const onWords = columnRuler(slide, index);
  for (let i = 0; i < page.elements.length; i++) {
    const el = page.elements[i];
    if (el.kind !== "text" || !el.text || String(el.text).trim().length <= 1) continue;
    measured++;
    const ruler = measuredOnWords(el, layout, onWords);
    const bottom = inkBottom(ruler ? { ...el, ...ruler } : el);
    const over = bottom - CANVAS.height;
    if (over <= INK_TOLERANCE) continue;
    faults.push({
      kind: "off-page", slide: index + 1, layout, where: clip(el.text, 24),
      overBy: over,
      note: `slide ${index + 1}: ${field(el, "the text")} runs ${Math.round(over)}pt off the foot of the slide,` +
        ` so its last lines are not in the deck or the preview — "${clip(el.text, 28)}"`,
    });
  }
  return { faults, measured };
}

/* ── ink past the right edge ─────────────────────────────────────────────── */

/** A WORD WIDER THAN ITS BOX, whose ink runs out of the box's RIGHT edge.
 *
 *  Every sweep above measures ink DOWNWARD. A word wider than the measure
 *  takes a line of its own and overhangs — the renderer does not break it —
 *  so the line count is right, the box is the right height, and the overhang
 *  is invisible to all four: in a column of a composition it was drawn
 *  straight across the next column's words, and a 400-character word in
 *  every column of every composition reported nothing (a verifier's edge
 *  shape, 2026-09-23).
 *
 *  Reported as an OVERRUN, because it is one — ink past its box — in the one
 *  direction the other sweeps do not look. Measured with the builder's own
 *  glyph tables (widestWordPt), bold where the box or its styled runs are,
 *  so the builder's fit and this verdict agree. Over the 1,404 stored slides
 *  it reports nothing: no stored column holds a word wider than itself. */
export function wideWordFaults(
  page: PreviewSlide, slide: SlideInput, index: number
): { faults: GeometryFault[]; measured: number } {
  const layout = String(slide.layout || "content");
  const faults: GeometryFault[] = [];
  let measured = 0;
  for (let i = 0; i < page.elements.length; i++) {
    const el = page.elements[i];
    if (el.kind !== "text" || !el.text || el.transform || String(el.text).trim().length <= 1) continue;
    // A COLUMN'S WORDS, by path — the case with a neighbour to be drawn
    // across. A label or a cell is fitted by its own layout, and turned on
    // there this reads the fixture battery's stat grid, whose "Wikipedia" sits
    // 3pt past a label box on the fixture — a finding about the stat grid's
    // fitter, recorded, and not this sweep's to rule on.
    if (!el.path || el.path.length !== 1 || COMPOSE_FIELDS.indexOf(String(el.path[0])) < 0) continue;
    measured++;
    const size = el.size || 10;
    const inner = el.w - TEXT_INSET_X;
    const bold = el.font === "Roboto" && (el.weight || 400) >= 600;
    const runs: { start: number; end: number }[] = [];
    const acc = el.accents || [];
    for (let a = 0; a < acc.length; a++) if (acc[a].bold) runs.push({ start: acc[a].start, end: acc[a].end });
    const paras = String(el.text).split("\n");
    let from = 0;
    let worst = { word: "", width: 0 };
    for (let p = 0; p < paras.length; p++) {
      const lead = paras[p].length - paras[p].replace(/^\s+/, "").length;
      const mine: { start: number; end: number }[] = [];
      for (let r = 0; r < runs.length; r++) {
        const a = Math.max(runs[r].start, from + lead) - from - lead, b = Math.min(runs[r].end, from + paras[p].length) - from - lead;
        if (b > a) mine.push({ start: a, end: b });
      }
      const w = widestWordPt(paras[p], size, el.font, { bold, boldRanges: mine });
      if (w.width > worst.width) worst = w;
      from += paras[p].length + 1;
    }
    // THE INK, with the builder's kerning margin divided back out, as inkBottom
    // divides out labelWidthPt's: the builder errs wide so that it fits, and
    // this is asking whether the word did. Left in, the matrix's "IMPACT" —
    // 8pt bold in a 44pt axis label — was reported 1pt past a box it sits in.
    const over = worst.width / RAGGED_KERN_MARGIN - inner;
    if (over <= INK_TOLERANCE) continue;
    faults.push({
      kind: "overrun", slide: index + 1, layout, where: clip(el.text, 24),
      overBy: over,
      note: `slide ${index + 1}: ${field(el, "the text")} holds a word wider than its box, which runs ${Math.round(over)}pt past the box's right edge`
        + ` — "${clip(worst.word, 28)}"`,
    });
  }
  return { faults, measured };
}

/* ── the deck ───────────────────────────────────────────────────────────── */

/** Every geometry fault in a deck, measured on the requests that will be
 *  drawn.
 *
 *  ONE BUILD PER SLIDE, and the preview derived from those same requests
 *  rather than from a second build. Partly cost, mostly correctness: nobody has
 *  established that buildSlideRequests is deterministic (the plan flags it as
 *  an open question), and a validator measuring a different build from the one
 *  the user is shown would be measuring the wrong deck. */
export function validateDeck(slides: SlideInput[], runId = "check"): DeckGeometry {
  const started = Date.now();
  const out: DeckGeometry = {
    faults: [], slidesChecked: 0, elementsChecked: 0, textBoxesChecked: 0,
    inkBoxesChecked: 0, unbuildable: 0, ms: 0,
  };
  for (let i = 0; i < slides.length; i++) {
    const slide = slides[i];
    // THE WHOLE SLIDE, INCLUDING THE SWEEPS, inside the guard. A sweep reads
    // shapes the builder emits, and the builder is where the next five stages
    // of work happen; the first element shape a sweep does not expect must cost
    // that slide's measurement and nothing else. It may not cost the DECK,
    // because this runs on the build path and the one thing this stage promises
    // is that nothing it finds can stop a deck being built.
    try {
      const requests = buildSlideRequests(slide, i, runId) as any[];
      const off = offCanvasFaults(requests, slide, i);
      const page = previewSlideFrom(slide, requests);
      const over = overlapFaults(page, slide, i);
      const ink = overrunFaults(page, slide, i);
      const past = offPageFaults(page, slide, i);
      const wide = wideWordFaults(page, slide, i);
      out.slidesChecked++;
      out.elementsChecked += off.elements;
      out.textBoxesChecked += over.texts;
      out.inkBoxesChecked += ink.measured;
      for (let f = 0; f < off.faults.length; f++) out.faults.push(off.faults[f]);
      for (let f = 0; f < over.faults.length; f++) out.faults.push(over.faults[f]);
      for (let f = 0; f < ink.faults.length; f++) out.faults.push(ink.faults[f]);
      for (let f = 0; f < past.faults.length; f++) out.faults.push(past.faults[f]);
      for (let f = 0; f < wide.faults.length; f++) out.faults.push(wide.faults[f]);
    } catch {
      out.unbuildable++;
    }
  }
  out.ms = Date.now() - started;
  return out;
}

/** How many of each kind, in the order they are reported. */
export function faultCounts(g: DeckGeometry): { "off-canvas": number; overlap: number; overrun: number; "off-page": number } {
  const counts = { "off-canvas": 0, overlap: 0, overrun: 0, "off-page": 0 };
  for (let i = 0; i < g.faults.length; i++) counts[g.faults[i].kind]++;
  return counts;
}

/** The faults worth SAYING OUT LOUD, which is not every fault measured.
 *
 *  THE ASSERTIONS ARE UNCHANGED — the script still fails on every pair of boxes
 *  that overlap, which is the migration — but the sentence a model relays to a
 *  user has to be true of the DECK, and on real traffic most of them were not.
 *  108 of the 130 overlapping pairs in the stored decks are boxes that overlap
 *  and ink that does not; 99 of those are the photo credit and the footer,
 *  which share a line and are kept apart by their alignment alone. Eighteen of
 *  the thirty-seven stored decks have nothing else wrong with them at all, so
 *  without this the dominant user-visible effect of the whole stage would be a
 *  note that is false about the deck it describes.
 *
 *  A box overlap with no ink in it is still a fault and still counted: it is a
 *  latent collision — the credit and the footer only miss each other while both
 *  strings stay short — and the layout is what should stop relying on that. It
 *  is simply not worth a sentence to somebody who cannot see it. */
export function relayableFaults(g: DeckGeometry): GeometryFault[] {
  const out: GeometryFault[] = [];
  for (let i = 0; i < g.faults.length; i++) {
    if (g.faults[i].kind === "overlap" && !g.faults[i].inkMeets) continue;
    out.push(g.faults[i]);
  }
  return out;
}

/** The most notes worth relaying at once.
 *
 *  A deck whose layout has gone wrong produces the same fault on every slide,
 *  and forty sentences of it is how a warning stops being read — the reason
 *  deckWarnings clips its own dropped-text list to three. The tail is counted
 *  rather than dropped, so nothing is hidden. */
const MAX_NOTES = 5;

/** The faults as sentences for deckWarnings, which is already threaded into
 *  the tool result on all four chains.
 *
 *  ONE SENTENCE PER SLIDE PER KIND, worst first. A line chart's date axis is
 *  nine separate boxes over one takeaway note, and nine sentences saying so is
 *  how a warning stops being read — the same reason deckWarnings clips its own
 *  dropped-text list to three. Every fault is still in `faults`; this is what
 *  is worth saying out loud, not what was found. */
export function geometryNotes(g: DeckGeometry): string[] {
  const relayable = relayableFaults(g);
  if (!relayable.length) return [];
  const notes: string[] = [];
  // Worst first: a box 40pt off the page is a different slide from one 2pt off,
  // and a fault with a distance outranks one without.
  const sorted = relayable.slice().sort((a, b) => b.overBy - a.overBy || a.slide - b.slide);
  // PER SLIDE AND PER KIND. One slide can carry two different faults — the hero
  // stat that runs off the canvas also draws its body over the footer — and
  // they are two different things to fix in two different places. Keying on the
  // slide alone would drop whichever sorted second, and that is a collision
  // every time: only off-canvas and overrun faults carry a distance to sort on.
  const said: { [k: string]: true } = {};
  let counted = 0;
  for (let i = 0; i < sorted.length; i++) {
    const key = `${sorted[i].slide}:${sorted[i].kind}`;
    if (said[key]) continue;
    said[key] = true;
    if (notes.length < MAX_NOTES) notes.push(sorted[i].note); else counted++;
  }
  if (counted) {
    // Counted over what would have been SAID, not over every pair measured: a
    // tail promising forty more faults, most of which nobody could see, is the
    // same overstatement the notes themselves avoid.
    notes.push(`and ${counted} more geometry fault${counted > 1 ? "s" : ""} across the deck`);
  }
  return notes;
}

/* ── the escalation seam ────────────────────────────────────────────────── */

export type GeometrySeverity = "advisory" | "refuse";

/**
 * THE ONE SEAM. Flipping this to "refuse" turns every fault above into a
 * refusal that stops the build; nothing else has to change.
 *
 * It is "advisory" because a check that is advisory in a script becomes a
 * refusal the day it runs at request time, and would start blocking decks that
 * shipped fine yesterday — including the ones this was written to find, which
 * are real slides in real client decks that users published and used.
 *
 * WHAT THE DECISION NEEDS, so that whoever flips it is not guessing: a week of
 * real traffic with the rate in the logs (logDeckGeometry writes one line per
 * build, tagged [SlideGeometry]), and a reading of it that answers two
 * questions. How many decks carry at least one fault worth reporting — if it is
 * most of them, refusing is a product outage, not a guard. And how many of
 * those faults are the same defect in one layout — if they are, the layout is
 * what to fix, and refusing would only move the failure from the deck to the
 * conversation. The stored decks answer both for the traffic up to today, and
 * the answer is not yet a refusal: 9 of 37 decks carry something worth saying,
 * and 11 of the 31 are one line chart's date axis under one takeaway note.
 *
 * The kinds will very likely escalate separately, and off-canvas is the
 * candidate: it loses words outright, it is 1 slide in 618, and it is a defect
 * in one layout rather than a fact about the deck. Two boxes that touch by a
 * point are ugly and readable.
 */
export const GEOMETRY_SEVERITY: GeometrySeverity = "advisory";

/**
 * What a refusal would say, or null because nothing refuses today.
 *
 * The severity is a PARAMETER with the constant as its default, so the seam can
 * be driven end to end by a check rather than asserted to exist — this repo has
 * reported a live hole as closed on the strength of a line existing. The build
 * path calls this on every deck and acts on the answer; today the answer is
 * always null, and the day GEOMETRY_SEVERITY changes it will not be.
 */
export function geometryRefusal(
  g: DeckGeometry, severity: GeometrySeverity = GEOMETRY_SEVERITY
): string | null {
  if (severity !== "refuse") return null;
  // What it would refuse ON is what it would SAY, so a deck whose only faults
  // are box overlaps nobody can see is not a deck to refuse. A refusal with
  // nothing after the colon would be the worst of both.
  const notes = geometryNotes(g);
  if (!notes.length) return null;
  return `Cannot build this deck: ${notes.join("; ")}. Nothing was built;` +
    ` shorten the text on those slides or move it to a field the layout draws.`;
}

/** One line per built deck, so the rate is a measurement rather than a memory.
 *  Read with `vercel logs --query [SlideGeometry]`.
 *
 *  BOTH OVERLAP NUMBERS, because they answer different questions and the flip
 *  decision needs both: how many pairs of boxes intersect, and how many of
 *  those draw text where they meet — which is what a user would see and what
 *  the model was told. On the stored decks those are 130 and 20.
 *
 *  The tag is the CALL SITE, and today there is one: `draft`. A deck published
 *  without a draft first goes through buildOrUpdateSlides, which has no
 *  advisory channel in its tool result and is not measured, so this rate is the
 *  rate for DRAFTED decks and not for all traffic. Every ordinary deck is
 *  drafted first; widening it is a separate small change. */
export function logDeckGeometry(g: DeckGeometry, where: string): void {
  const c = faultCounts(g);
  const relayed = relayableFaults(g).length;
  console.log(
    `[SlideGeometry] ${where}: ${g.slidesChecked} slides, ${g.elementsChecked} elements,` +
    ` ${g.textBoxesChecked} text boxes, ${g.faults.length} faults` +
    ` (off-canvas ${c["off-canvas"]}, overlap ${c.overlap}, overrun ${c.overrun}, off-page ${c["off-page"]}),` +
    ` ${relayed} worth reporting` +
    `${g.unbuildable ? `, ${g.unbuildable} unmeasurable` : ""} in ${g.ms}ms — ${GEOMETRY_SEVERITY}`
  );
}

/* ── shared wording ─────────────────────────────────────────────────────── */

function clip(t: string | undefined, n: number): string {
  const s = String(t === undefined ? "" : t).replace(/\s+/g, " ").trim();
  return s.length > n ? s.slice(0, n - 1) + "…" : s;
}

/** A box named by the spec field it came from where the preview knows one, and
 *  by its role where it does not. "slide 7 drops a field" is not actionable;
 *  "slide 7's `body`" is. Most boxes on a rich slide — a chart's axis labels, a
 *  matrix caption — have no path, which is why the notes quote the words too. */
function field(el: PreviewElement, fallback = "a text box"): string {
  if (el.path && el.path.length) return `\`${el.path.join(".")}\``;
  return fallback;
}

/** Two boxes named together, without saying "a text box and a text box". */
function pair(p: PreviewElement, q: PreviewElement): string {
  const named = (p.path && p.path.length) || (q.path && q.path.length);
  return named ? `${field(p)} and ${field(q)}` : "two text boxes";
}
