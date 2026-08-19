/**
 * Build a branded Google Slides deck in the user's own Drive.
 *
 * Shape of the operation: presentations.create makes an empty deck owned by the
 * user, then ONE batchUpdate lays down every slide. Batching matters — a deck
 * built over N round-trips can fail halfway and leave a visibly broken file in
 * somebody's Drive, whereas batchUpdate is applied atomically by Google.
 *
 * Every slide is a BLANK layout with explicit shapes rather than a predefined
 * layout with placeholders. Placeholders would inherit from Slides' own default
 * master, which is not branded, and re-styling the master through the API is
 * considerably more work than positioning the boxes ourselves — especially with
 * exact geometry already extracted (lib/slides/brand.ts). The trade-off is that
 * the generated deck has no reusable layouts; see docs/tce-slide-brand.md.
 */

import {
  COLOR, GRID, CANVAS, TYPE, TIMELINE, TIMELINE_PARALLEL, TRACK_COLORS, IMAGE, CHART,
  SERIES_LIGHT, SERIES_DARK, CARDS, QUOTE, PROCESS, LOGO_WALL, LAYOUT_STYLE, LOGO_PLACEMENT,
  rgb, logoUrl, type SlideLayout, type TypeStyle,
} from "@/lib/slides/brand";
import { getUserGoogleToken, authFailureMessage, type SlidesAuthFailure } from "@/lib/slides/token";
import { captureThumbnails } from "@/lib/slides/preview";
import { resolveImage, type ImageGenerator, type TextBand } from "@/lib/slides/images";
import { resolveIcon } from "@/lib/slides/icons";

const SLIDES_API = "https://slides.googleapis.com/v1/presentations";
const DRIVE_API = "https://www.googleapis.com/drive/v3/files";

export interface Milestone {
  /** Shown above the axis, e.g. "3 July" or "18–24 August". */
  date: string;
  /** Shown below the marker. */
  title: string;
  /** Optional supporting line under the title. */
  detail?: string;
  /** Draws a larger marker — for the phase that is current or next. */
  highlight?: boolean;
}

export interface TrackPhase {
  /** ISO date, YYYY-MM-DD. Required — proportional positioning is the whole
   *  point of this layout, and it cannot be derived from "late August". */
  start: string;
  /** ISO date. Omit for a single-day milestone, which renders as a dot. */
  end?: string;
  label: string;
}

export interface Track {
  name: string;
  phases: TrackPhase[];
}

export interface SlideInput {
  layout?: SlideLayout;
  title?: string;
  subtitle?: string;
  eyebrow?: string;
  body?: string;
  bodyRight?: string;
  milestones?: Milestone[];
  tracks?: Track[];
  /** What this slide should be a picture OF, or an exact image to use. Resolved
   *  before the deck is built, so the preview shows the real photograph. */
  image?: { url?: string; query?: string };
  /** Filled in by resolution — not supplied by the model. */
  resolvedImage?: { url: string; scrim: number; credit?: string; logo?: "white" | "navy" };
  /** Set when resolution ran and found nothing, so publishing does not quietly
   *  search again and build a deck different from the one that was approved. */
  imageUnavailable?: boolean;
  /** Thumbnails for the image-grid layout. */
  images?: { url?: string; query?: string; caption?: string }[];
  resolvedImages?: { url: string; caption?: string }[];
  /** Repeated blocks. Every part is optional: a marker alone gives numbered
   *  items, a thumbnail gives a product grid, neither gives labelled columns. */
  cards?: {
    /** "01", or a short label like "STRATEGY". Drawn as a brand chip. */
    marker?: string;
    title?: string;
    body?: string;
    /** A Lucide icon name — "target", "line-chart", "users". Drawn small above
     *  the heading, in brand navy. Cheaper and far more consistent than a
     *  photograph when the card is about an idea rather than a thing. */
    icon?: string;
    image?: { url?: string; query?: string };
    resolvedImage?: { url: string };
    resolvedIcon?: string;
  }[];
  /** A pull quote and who said it. */
  quote?: { text: string; name?: string; role?: string; image?: { url?: string; query?: string }; resolvedImage?: { url: string } };
  /** Stages, left to right. Three to five reads best. */
  stages?: { name: string; caption?: string }[];
  /** Client marks for logo-wall. Fitted whole, never cropped. */
  logos?: { url?: string; query?: string; name?: string; resolvedUrl?: string }[];
  /** Big numbers for the stat layout — three at most, or none of them lands. */
  stats?: { value: string; label: string; detail?: string }[];
  /** Data for bar-chart and line-chart. */
  chart?: {
    series: { name: string; points: { label: string; value: number }[] }[];
    /** Printed under the plot. A chart without one invites the question. */
    source?: string;
  };
  /** ISO date for the "today" rule. Defaults to the real today; drawn only if
   *  it falls inside the plotted range. */
  today?: string;
  notes?: string;
}

export interface SlidesResult {
  ok: boolean;
  url?: string;
  presentationId?: string;
  title?: string;
  slideCount?: number;
  error?: string;
  /** Set only when the failure is a connection state the user can fix. The
   *  chat layer uses it to offer a reconnect button instead of an error. */
  reason?: SlidesAuthFailure;
  /** True when an existing deck was edited rather than a new one created. */
  updated?: boolean;
  /** The deck to update could not be opened — caller may create instead. */
  notFound?: boolean;
  /** Slide thumbnails, in order, for the in-chat preview. */
  thumbnails?: string[];
}

/* ─────────────── Request builders ─────────────── */

type Req = Record<string, any>;

function pt(magnitude: number) {
  return { magnitude, unit: "PT" };
}

function textStyleRequest(objectId: string, style: TypeStyle): Req {
  // weightedFontFamily rather than fontFamily + bold: when both are set the
  // weighted one wins anyway, so setting only it avoids a contradictory pair.
  const weight = style.weight ?? (style.bold ? 700 : 400);
  return {
    updateTextStyle: {
      objectId,
      textRange: { type: "ALL" },
      style: {
        weightedFontFamily: { fontFamily: style.font, weight },
        fontSize: pt(style.size),
        foregroundColor: { opaqueColor: { rgbColor: rgb(style.color) } },
      },
      fields: "weightedFontFamily,fontSize,foregroundColor",
    },
  };
}

interface BoxOptions {
  align?: "START" | "CENTER" | "END";
  bullets?: boolean;
  lineSpacing?: number;
  /** Centre the text vertically inside its box.
   *
   *  This is how a short slide stops leaving its bottom third empty without
   *  anyone having to measure text. The box is given the whole band it may
   *  occupy and Slides centres whatever lands in it, so three bullets sit in
   *  the middle of the space and eight fill it — no estimating line heights,
   *  and no drift between what we predicted and what Google laid out. */
  vCenter?: boolean;
}

/** A positioned text box: create, fill, style. Returns [] for empty text so a
 *  missing optional field doesn't produce an empty box (or an insertText error,
 *  which is what an empty string actually causes). */
/** Markdown links in a plain string: `[label](https://…)`.
 *
 *  A syntax rather than a structured field because body copy is one string that
 *  the model already writes markdown into everywhere else in this product, and
 *  because links belong to phrases inside a sentence — a parallel array of
 *  urls could not say WHICH words are the link.
 *
 *  Returns the text with the markup removed, plus where each link now falls.
 *  Offsets are computed against the stripped string because that is what
 *  Slides will hold. */
function extractLinks(raw: string): { text: string; links: { start: number; end: number; url: string }[] } {
  const links: { start: number; end: number; url: string }[] = [];
  let text = "";
  let rest = raw;
  const re = /\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)/;
  for (let guard = 0; guard < 200; guard++) {
    const m = re.exec(rest);
    if (!m) break;
    text += rest.slice(0, m.index);
    const start = text.length;
    text += m[1];
    links.push({ start, end: text.length, url: m[2] });
    rest = rest.slice(m.index + m[0].length);
  }
  return { text: text + rest, links };
}

function textBox(
  objectId: string,
  pageObjectId: string,
  text: string | undefined,
  style: TypeStyle,
  box: { x: number; y: number; width: number; height: number },
  options: BoxOptions = {}
): Req[] {
  const source = (text ?? "").trim();
  if (!source) return [];
  const { text: content, links } = extractLinks(source);
  if (!content) return [];
  const rendered = style.caps ? content.toUpperCase() : content;

  const requests: Req[] = [
    {
      createShape: {
        objectId,
        shapeType: "TEXT_BOX",
        elementProperties: {
          pageObjectId,
          size: { width: pt(box.width), height: pt(box.height) },
          transform: { scaleX: 1, scaleY: 1, translateX: box.x, translateY: box.y, unit: "PT" },
        },
      },
    },
    { insertText: { objectId, text: rendered, insertionIndex: 0 } },
    textStyleRequest(objectId, style),
    {
      updateParagraphStyle: {
        objectId,
        textRange: { type: "ALL" },
        style: {
          alignment: options.align ?? "START",
          lineSpacing: (options.lineSpacing ?? 1.15) * 100,
          spaceBelow: pt(6),
        },
        fields: "alignment,lineSpacing,spaceBelow",
      },
    },
  ];

  // Links LAST, and carrying the brand colour with them. Setting a link makes
  // Slides apply its theme hyperlink colour and an underline, so a link applied
  // after the run style silently repaints that phrase blue — every linked
  // portfolio caption would stop looking like the deck around it.
  for (const [li, link] of links.map((l, i) => [i, l] as const)) {
    requests.push({
      updateTextStyle: {
        objectId,
        textRange: { type: "FIXED_RANGE", startIndex: link.start, endIndex: link.end },
        style: {
          link: { url: link.url },
          foregroundColor: { opaqueColor: { rgbColor: rgb(style.color) } },
          underline: true,
        },
        fields: "link,foregroundColor,underline",
      },
    });
    void li;
  }

  if (options.vCenter) {
    requests.push({
      updateShapeProperties: {
        objectId,
        shapeProperties: { contentAlignment: "MIDDLE" },
        fields: "contentAlignment",
      },
    });
  }

  // Bullets only when there is genuinely a list. A single paragraph rendered
  // with a disc reads as a stray bullet rather than a list of one.
  if (options.bullets && rendered.includes("\n")) {
    requests.push({
      createParagraphBullets: {
        objectId,
        textRange: { type: "ALL" },
        bulletPreset: "BULLET_DISC_CIRCLE_SQUARE",
      },
    });
  }
  return requests;
}

function logoRequests(
  objectId: string, pageObjectId: string, layout: SlideLayout, slide?: SlideInput
): Req[] {
  const style = LAYOUT_STYLE[layout];
  if (!style.logo) return [];
  const place = LOGO_PLACEMENT[style.logoPlacement];
  // The picture only gets a say where the logo actually SITS on it — the
  // full-bleed layouts. On image-split the photograph fills the left half while
  // the lockup sits top-right over off-white, so letting a dark photo ask for
  // the white mark put a white logo on a near-white ground: invisible, and
  // introduced by the fix for the opposite problem.
  const overPhoto = style.background === null;
  const variant = (overPhoto && slide?.resolvedImage?.logo) || style.logo;
  return [
    {
      createImage: {
        objectId,
        url: logoUrl(variant),
        elementProperties: {
          pageObjectId,
          size: { width: pt(place.width), height: pt(place.height) },
          transform: { scaleX: 1, scaleY: 1, translateX: place.x, translateY: place.y, unit: "PT" },
        },
      },
    },
  ];
}

/** A filled shape with no outline — the axis rule and the milestone markers.
 *  Slides gives new shapes a default border, which reads as a stray hairline at
 *  this size, so the outline is explicitly turned off rather than left. */
function filledShape(
  objectId: string,
  pageObjectId: string,
  shapeType: "RECTANGLE" | "ROUND_RECTANGLE" | "ELLIPSE" | "RIGHT_ARROW",
  color: string,
  box: { x: number; y: number; width: number; height: number }
): Req[] {
  return [
    {
      createShape: {
        objectId,
        shapeType,
        elementProperties: {
          pageObjectId,
          size: { width: pt(box.width), height: pt(box.height) },
          transform: { scaleX: 1, scaleY: 1, translateX: box.x, translateY: box.y, unit: "PT" },
        },
      },
    },
    {
      updateShapeProperties: {
        objectId,
        shapeProperties: {
          shapeBackgroundFill: { solidFill: { color: { rgbColor: rgb(color) } } },
          outline: { propertyState: "NOT_RENDERED" },
        },
        fields: "shapeBackgroundFill.solidFill.color,outline.propertyState",
      },
    },
  ];
}

/** A real horizontal timeline: one axis, evenly spaced markers, labels above
 *  and below. Milestones are spaced by slot rather than by date, because these
 *  decks show sequence and ownership, not duration — proportional spacing would
 *  crush three August dates against one another to no benefit. */
function timelineRequests(
  page: string,
  id: (s: string) => string,
  milestones: Milestone[]
): Req[] {
  const requests: Req[] = [];
  const n = milestones.length;
  if (!n) return requests;

  requests.push(
    ...filledShape(id("axis"), page, "RECTANGLE", COLOR.periwinkle, {
      x: GRID.margin,
      y: TIMELINE.axisY - TIMELINE.axisThickness / 2,
      width: GRID.contentWidth,
      height: TIMELINE.axisThickness,
    })
  );

  const slot = GRID.contentWidth / n;
  const labelWidth = slot - TIMELINE.slotGutter;

  milestones.forEach((m, i) => {
    const centre = GRID.margin + slot * (i + 0.5);
    const size = m.highlight ? TIMELINE.markerSizeHighlight : TIMELINE.markerSize;
    const labelX = centre - labelWidth / 2;

    requests.push(
      ...filledShape(id(`dot${i}`), page, "ELLIPSE", m.highlight ? COLOR.blue : COLOR.navy, {
        x: centre - size / 2,
        y: TIMELINE.axisY - size / 2,
        width: size,
        height: size,
      }),
      ...textBox(id(`d${i}`), page, m.date, TYPE.milestoneDate, {
        x: labelX, y: TIMELINE.dateY, width: labelWidth, height: TIMELINE.dateHeight,
      }, { align: "CENTER" }),
      ...textBox(id(`t${i}`), page, m.title, TYPE.milestoneName, {
        x: labelX, y: TIMELINE.titleY, width: labelWidth, height: TIMELINE.titleHeight,
      }, { align: "CENTER" }),
      ...textBox(id(`x${i}`), page, m.detail, TYPE.milestoneText, {
        x: labelX, y: TIMELINE.detailY, width: labelWidth, height: TIMELINE.detailHeight,
      }, { align: "CENTER" }),
    );
  });
  return requests;
}

/** Parse an ISO date to a UTC timestamp. UTC deliberately: these are calendar
 *  dates, and a local-midnight reading shifts them a day either side of the
 *  meridian, which would silently move a milestone on the chart. */
function isoDate(s: string | undefined): number | null {
  if (!s) return null;
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(s.trim());
  if (!m) return null;
  const t = Date.UTC(+m[1], +m[2] - 1, +m[3]);
  return Number.isFinite(t) ? t : null;
}

const MONTHS = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];

/** Month-start ticks across the range. Months are the right grain for a
 *  programme measured in weeks; days would be unreadable and quarters useless. */
function monthTicks(min: number, max: number): { t: number; label: string }[] {
  const out: { t: number; label: string }[] = [];
  const d = new Date(min);
  let y = d.getUTCFullYear();
  let mo = d.getUTCMonth();
  // Start at the first month boundary at or after `min`.
  if (d.getUTCDate() !== 1) { mo += 1; if (mo > 11) { mo = 0; y += 1; } }
  for (let guard = 0; guard < 60; guard++) {
    const t = Date.UTC(y, mo, 1);
    if (t > max) break;
    // Year only in January (and on the first tick), so the axis does not repeat
    // "26" six times — and so "Jul 26" is never misread as the 26th of July.
    out.push({ t, label: mo === 0 || out.length === 0 ? `${MONTHS[mo]} ${y}` : MONTHS[mo] });
    mo += 1; if (mo > 11) { mo = 0; y += 1; }
  }
  return out;
}

/** Two or more workstreams on one shared, date-proportional axis.
 *
 *  Two things make this readable rather than merely correct:
 *
 *  1. Phases that overlap in time are packed onto SUB-ROWS within their track.
 *     Drawn on one row they simply cover each other, which hides the overlap —
 *     the one thing the slide exists to show.
 *  2. A phase label goes INSIDE its bar when the bar is wide enough for it, and
 *     to the right when it is not, bounded by the next bar's start. Labels
 *     floated above collide as soon as two phases begin close together.
 */
function parallelTimelineRequests(
  page: string,
  id: (s: string) => string,
  tracks: Track[],
  todayIso?: string
): Req[] {
  const requests: Req[] = [];
  const P = TIMELINE_PARALLEL;

  interface Placed {
    start: number; end: number | null; label: string; row: number;
    barX: number; barW: number; isPoint: boolean;
    inside: boolean; labelX: number; labelW: number; footprintEnd: number;
    /** A label pushed to the LEFT of its bar reads from the bar outwards, so it
     *  is set right-aligned against it. */
    alignEnd: boolean;
  }

  const stamps: number[] = [];
  const parsed = tracks.map((tr) => {
    const items = tr.phases
      .map((ph) => {
        const s = isoDate(ph.start);
        if (s === null) return null;
        const e = isoDate(ph.end);
        stamps.push(s);
        if (e !== null) stamps.push(e);
        return { start: s, end: e !== null && e > s ? e : null, label: ph.label };
      })
      .filter(Boolean) as { start: number; end: number | null; label: string }[];
    items.sort((a, b) => a.start - b.start);
    return { name: tr.name, items };
  });

  // Without at least two distinct dates there is no range to be proportional
  // to. Nothing is drawn rather than something wrong.
  if (stamps.length < 2) return requests;
  let min = Math.min(...stamps);
  let max = Math.max(...stamps);
  if (max === min) return requests;
  const pad = (max - min) * P.rangePad;
  min -= pad; max += pad;

  const plotX = GRID.margin + P.labelGutter;
  const plotW = GRID.contentWidth - P.labelGutter;
  const x = (t: number) => plotX + ((t - min) / (max - min)) * plotW;

  // Roboto at this size averages a little over half the point size per
  // character; good enough to decide inside-vs-outside without font metrics.
  const textWidth = (s: string) => s.length * 4.3;

  // Packing happens in PIXELS, not dates, and against each phase's FOOTPRINT —
  // the bar plus whatever room its label needs beside it. Packing on dates
  // alone was not enough: a one-day phase produces an eight-point bar whose
  // label is ten times wider, so two phases a week apart do not overlap as
  // dates and collide badly as drawn.
  const placedTracks = parsed.map((tr) => {
    const rowEnds: number[] = [];
    const items: Placed[] = tr.items.map((it) => {
      const isPoint = it.end === null;
      const barX = isPoint ? x(it.start) - P.pointSize / 2 : x(it.start);
      const barW = isPoint ? P.pointSize : Math.max(P.minBarWidth, x(it.end!) - x(it.start));
      const natural = textWidth(it.label) + 10;
      const inside = !isPoint && barW >= natural + 4;
      let labelX = barX + barW + 6;
      let labelW = inside ? barW - 12 : Math.min(natural, 150);
      let alignEnd = false;

      // A late phase has no room to its right: its label was drawn from the bar
      // outwards and ran off the canvas — 790pt on a 720pt slide, so the last
      // milestone in a plan was the one nobody could read. Put it on the other
      // side of the bar instead, and only clip it if there is no room there
      // either.
      if (!inside) {
        const rightEdge = GRID.margin + GRID.contentWidth;
        if (labelX + labelW > rightEdge) {
          const roomLeft = barX - 6 - plotX;
          if (roomLeft >= 40) {
            labelW = Math.min(labelW, roomLeft);
            labelX = barX - 6 - labelW;
            alignEnd = true;
          } else {
            labelW = Math.max(24, rightEdge - labelX);
          }
        }
      }
      const footprintEnd = inside ? barX + barW : Math.max(barX + barW, labelX + labelW);

      let row = rowEnds.findIndex((end) => barX >= end);
      if (row === -1) { row = rowEnds.length; rowEnds.push(footprintEnd + 8); }
      else rowEnds[row] = footprintEnd + 8;

      return { ...it, row, barX, barW, isPoint, inside, labelX, labelW, footprintEnd, alignEnd };
    });
    return { name: tr.name, items, rows: Math.max(1, rowEnds.length) };
  });

  // NOTHING may grow past the bottom of the slide. Tracks were laid out at a
  // fixed 30pt per row with no ceiling, so five tracks — or one track whose
  // phases packed onto six rows — pushed the shared date axis, and every tick
  // on it, clean off the canvas. The axis is the thing the layout exists for.
  //
  // Rows compress first, then the gap between tracks, and only then is a track
  // dropped — and a dropped track is said out loud.
  const MIN_TRACK_ROW = 18;
  const MIN_TRACK_GAP = 10;
  const tailHeight = P.axisGap + P.axisThickness + 5 + P.tickLabelHeight;
  let shown = placedTracks;
  let trackGap: number = P.trackGap;
  let rowHeight: number = P.rowHeight;
  let noteReserve = 0;
  for (let guard = 0; guard < 24; guard += 1) {
    const rows = shown.reduce((n, t) => n + t.rows, 0) || 1;
    const budget =
      CANVAS.height - GRID.margin - P.bandY - tailHeight - noteReserve - trackGap * (shown.length - 1);
    rowHeight = Math.min(P.rowHeight, budget / rows);
    if (rowHeight >= MIN_TRACK_ROW) break;
    if (trackGap > MIN_TRACK_GAP) { trackGap = MIN_TRACK_GAP; continue; }
    if (shown.length > 1) { shown = shown.slice(0, -1); noteReserve = 16; continue; }
    break;
  }
  rowHeight = Math.max(MIN_TRACK_ROW, Math.floor(rowHeight * 10) / 10);
  const barHeight = Math.max(12, rowHeight - (P.rowHeight - P.barHeight));
  const droppedTracks = placedTracks.length - shown.length;

  let cursorY = P.bandY;
  shown.forEach((tr, ti) => {
    const color = TRACK_COLORS[ti % TRACK_COLORS.length];
    const trackHeight = tr.rows * rowHeight;

    // A white band behind each track, with the slide's off-white showing
    // through the gap between. Without it, a track that packs onto three rows
    // reads as six loose bars rather than as two workstreams.
    requests.push(
      ...filledShape(id(`band${ti}`), page, "RECTANGLE", COLOR.white, {
        x: GRID.margin,
        y: cursorY - P.bandPadding,
        width: GRID.contentWidth,
        height: trackHeight + P.bandPadding,
      })
    );

    requests.push(
      ...textBox(id(`tn${ti}`), page, tr.name, TYPE.trackName, {
        x: GRID.margin,
        y: cursorY + trackHeight / 2 - 12,
        width: P.labelGutter - 12,
        height: 24,
      })
    );

    tr.items.forEach((it, pi) => {
      const barY = cursorY + it.row * rowHeight;

      requests.push(
        ...filledShape(
          id(`p${ti}_${pi}`), page,
          it.isPoint ? "ELLIPSE" : "ROUND_RECTANGLE", color,
          {
            x: it.barX,
            y: it.isPoint ? barY + barHeight / 2 - P.pointSize / 2 : barY,
            width: it.barW,
            height: it.isPoint ? P.pointSize : barHeight,
          }
        ),
        ...textBox(
          id(`pl${ti}_${pi}`), page, it.label,
          it.inside ? TYPE.phaseInBar : TYPE.phaseLabel,
          {
            x: it.inside ? it.barX + 6 : it.labelX,
            y: barY + (it.inside ? 4 : 3),
            width: it.labelW,
            height: barHeight,
          },
          it.alignEnd ? { align: "END" } : {}
        )
      );
    });

    cursorY += trackHeight + trackGap;
  });

  const axisY = cursorY - trackGap + P.axisGap;
  requests.push(
    ...filledShape(id("paxis"), page, "RECTANGLE", COLOR.periwinkle, {
      x: plotX, y: axisY, width: plotW, height: P.axisThickness,
    })
  );
  monthTicks(min, max).forEach((tick, i) => {
    requests.push(
      ...textBox(id(`tick${i}`), page, tick.label, TYPE.axisTick, {
        x: x(tick.t) - 24, y: axisY + 5, width: 48, height: P.tickLabelHeight,
      }, { align: "CENTER" })
    );
  });

  if (droppedTracks > 0) {
    requests.push(...noteBox(
      id("pdrop"), page,
      `Showing ${shown.length} of ${placedTracks.length} tracks`,
      axisY + 5 + P.tickLabelHeight
    ));
  }

  // "Today" rule last, so it sits above the bars.
  const now = new Date();
  const today = isoDate(todayIso) ??
    Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
  if (today > min && today < max) {
    const tx = x(today);
    requests.push(
      ...filledShape(id("today"), page, "RECTANGLE", COLOR.coral, {
        x: tx, y: P.bandY - 8, width: 1.4, height: axisY - P.bandY + 8,
      }),
      ...textBox(id("todaylbl"), page, "Today", TYPE.todayLabel, {
        x: tx - 22, y: P.bandY - 22, width: 44, height: 14,
      }, { align: "CENTER" })
    );
  }
  return requests;
}

/** Grid geometry, computed in ONE place.
 *
 *  Resolution has to know the cell's shape to crop an image to it, and drawing
 *  has to know it to place the image — and a cell is 1.70 wide with four across
 *  but nothing like that with two. Two copies of this arithmetic would drift,
 *  and the symptom would be the letterboxing this exists to prevent. */
export function gridGeometry(count: number, captioned: boolean) {
  const shown = Math.min(count, 12);
  // The band is a fixed 671x230pt, so the arrangement decides the cell shape
  // and neither obvious rule gives a good one: filling a row makes four images
  // 0.70 slivers, squaring off makes eight images 3.07 strips. Instead try
  // every arrangement up to four across and keep the one whose cell is closest
  // to a photographic 1.4 — measured in log space, so half and double are
  // penalised equally.
  const IDEAL = 1.4;
  let cols = 1, best = Infinity;
  for (let c = 1; c <= Math.min(4, shown); c++) {
    const r = Math.ceil(shown / c);
    const w = (GRID.contentWidth - IMAGE.gridGap * (c - 1)) / c;
    const h = (IMAGE.gridHeight - IMAGE.gridGap * (r - 1)) / r - (captioned ? IMAGE.gridCaptionHeight : 0);
    if (h <= 8) continue; // too many rows to show anything
    const score = Math.abs(Math.log((w / h) / IDEAL));
    if (score < best) { best = score; cols = c; }
  }
  const rows = Math.ceil(shown / cols);
  const cellW = (GRID.contentWidth - IMAGE.gridGap * (cols - 1)) / cols;
  const cellH = (IMAGE.gridHeight - IMAGE.gridGap * (rows - 1)) / rows
    - (captioned ? IMAGE.gridCaptionHeight : 0);
  return { cols, rows, cellW, cellH, aspect: cellW / Math.max(1, cellH) };
}

/** Up to twelve thumbnails on one row-and-column grid, sized so the set always
 *  fills the band rather than leaving a ragged last row. */
function gridRequests(
  page: string, id: (s: string) => string,
  images: { url: string; caption?: string }[]
): Req[] {
  if (!images.length) return [];
  const shown = images.slice(0, 12);
  const captioned = shown.some((i) => i.caption);
  const { cols, cellW, cellH } = gridGeometry(shown.length, captioned);

  const out: Req[] = [];
  shown.forEach((img, i) => {
    const c = i % cols, r = Math.floor(i / cols);
    const x = GRID.margin + c * (cellW + IMAGE.gridGap);
    const y = IMAGE.gridY + r * (cellH + IMAGE.gridGap + (captioned ? IMAGE.gridCaptionHeight : 0));
    out.push({
      createImage: {
        objectId: id(`g${i}`),
        url: img.url,
        elementProperties: {
          pageObjectId: page,
          size: { width: pt(cellW), height: pt(cellH) },
          transform: { scaleX: 1, scaleY: 1, translateX: x, translateY: y, unit: "PT" },
        },
      },
    });
    out.push(...textBox(id(`gc${i}`), page, img.caption, TYPE.gridCaption, {
      x, y: y + cellH + 2, width: cellW, height: IMAGE.gridCaptionHeight,
    }));
  });
  return out;
}

/** A full-bleed photograph with its scrim, drawn before anything else so text
 *  and the logo sit on top. Returns [] when no image resolved, which is what
 *  makes every photo layout degrade to its solid brand background. */
function backdropRequests(
  page: string, id: (s: string) => string, slide: SlideInput
): Req[] {
  // The image arrives pre-cropped to the canvas and with its gradient already
  // burnt in, so there is no scrim shape here any more — see lib/slides/images.
  const img = slide.resolvedImage;
  if (!img) return [];
  return [
    {
      createImage: {
        objectId: id("bg"),
        url: img.url,
        elementProperties: {
          pageObjectId: page,
          size: { width: pt(CANVAS.width), height: pt(CANVAS.height) },
          transform: { scaleX: 1, scaleY: 1, translateX: 0, translateY: 0, unit: "PT" },
        },
      },
    },
    ...textBox(id("credit"), page, img.credit, TYPE.credit, {
      x: GRID.margin, y: IMAGE.creditY,
      width: GRID.contentWidth, height: IMAGE.creditHeight,
    }, { align: "END" }),
  ];
}

/** Format a number the way a reader says it, not the way a machine stores it. */
function formatValue(v: number): string {
  const abs = Math.abs(v);
  if (abs >= 1_000_000_000) return `${(v / 1_000_000_000).toFixed(1).replace(/\.0$/, "")}bn`;
  if (abs >= 1_000_000) return `${(v / 1_000_000).toFixed(1).replace(/\.0$/, "")}m`;
  if (abs >= 1_000) return `${(v / 1_000).toFixed(1).replace(/\.0$/, "")}k`;
  return String(Number(v.toFixed(2)));
}

/** Up to three headline numbers.
 *
 *  Often the honest answer when a deck reaches for a chart: a single figure
 *  with a caption carries a point that a plot of one bar only decorates. */
function statRequests(
  page: string, id: (s: string) => string,
  stats: { value: string; label: string; detail?: string }[]
): Req[] {
  const shown = stats.slice(0, 3);
  if (!shown.length) return [];
  const out: Req[] = [];
  const cell = (GRID.contentWidth - CHART.statGap * (shown.length - 1)) / shown.length;

  // Centre the block of figures in the band rather than pinning it to the top.
  const groupH = CHART.statValueHeight + CHART.statLabelHeight + CHART.statDetailHeight + 4;
  const top = GRID.bodyY + Math.max(0, (GRID.bandHeight - groupH) / 2);

  // Size the number to its column instead of trusting one fixed size.
  //
  // "92.5 GW" at 54pt is wider than a third of the slide, so it wrapped, and a
  // two-line value in a one-line box overflowed downward straight through its
  // own label and detail. Poppins runs about 0.58 of the point size per
  // character, so the size that fits is solvable rather than guessable.
  //
  // Two corrections after seeing this rendered by Google rather than estimated:
  // a text box carries a default inset of 0.1in on each side, so the usable
  // width is ~15pt less than the box; and Poppins runs nearer 0.62 of the point
  // size per character than the 0.58 first assumed. At 0.58 with no inset
  // allowance, "92.5 GW" was computed to fit at 50pt and wrapped anyway.
  const INSET = 15;
  const PER_CHAR = 0.62;
  const longest = Math.max(...shown.map((s) => s.value.length), 1);
  const fitted = Math.floor((cell - INSET) / (longest * PER_CHAR));
  const valueStyle = { ...TYPE.statValue, size: Math.max(22, Math.min(TYPE.statValue.size, fitted)) };

  shown.forEach((s, i) => {
    const x = GRID.margin + i * (cell + CHART.statGap);
    out.push(
      ...textBox(id(`sv${i}`), page, s.value, valueStyle, {
        x, y: top, width: cell, height: CHART.statValueHeight,
      }),
      ...textBox(id(`sl${i}`), page, s.label, TYPE.statLabel, {
        x, y: top + CHART.statValueHeight, width: cell, height: CHART.statLabelHeight,
      }),
      ...textBox(id(`sd${i}`), page, s.detail, TYPE.statDetail, {
        x, y: top + CHART.statValueHeight + CHART.statLabelHeight + 4,
        width: cell, height: CHART.statDetailHeight,
      }),
    );
  });
  return out;
}

/** How many rows a chart may draw, and how tall each may be.
 *
 *  Nothing on a slide is allowed to grow past the canvas. The bar chart used to
 *  cap at eight and place its source line wherever the eighth bar ended, which
 *  was 8pt below the bottom edge; the stacked chart capped at nothing at all,
 *  so a ten-category series ran two rows and an entire legend off the slide,
 *  invisible in the deck AND in the preview, with nothing saying data was lost.
 *
 *  Rows are COMPRESSED to fit before any are dropped — losing a little bar
 *  height costs nothing a reader would notice, and losing a category costs them
 *  the data. Only when compression hits a floor is the set truncated, and the
 *  slide then says so out loud. */
const MAX_BARS = 8;
/** Gap plus the source line under a plot. */
const SOURCE_BLOCK = 24;
/** The right-hand slot on the source line, held for the truncation note. */
const NOTE_WIDTH = 168;
const MIN_ROW_HEIGHT = 20;
/** Legend row plus the source line under a stacked plot. */
const STACK_TAIL = 42;

function fitRows(
  total: number, cap: number, baseBarH: number, baseGap: number, tailBlock: number
): { count: number; rowH: number; barH: number } {
  const room = CANVAS.height - GRID.margin - GRID.bodyY - tailBlock;
  const baseRow = baseBarH + baseGap;
  let count = Math.max(1, Math.min(total, cap));
  let rowH = Math.min(baseRow, room / count);
  while (rowH < MIN_ROW_HEIGHT && count > 1) {
    count -= 1;
    rowH = Math.min(baseRow, room / count);
  }
  rowH = Math.floor(rowH * 10) / 10;
  const gap = Math.min(baseGap, Math.max(4, rowH * 0.3));
  return { count, rowH, barH: Math.max(10, Math.round((rowH - gap) * 10) / 10) };
}

/** "Showing the top 8 of 12" — on the source line, right-aligned, in the slot
 *  the source box gives up when there is something to say.
 *
 *  Its own box with no spec path, so it is never editable and never written
 *  back into the source string. Silence here was the real defect: a deck that
 *  quietly drops four categories reads as the whole picture. */
function noteBox(objectId: string, page: string, text: string, y: number): Req[] {
  if (!text) return [];
  return textBox(objectId, page, text, TYPE.chartAxis, {
    x: GRID.margin + GRID.contentWidth - NOTE_WIDTH, y, width: NOTE_WIDTH, height: 16,
  }, { align: "END" });
}

function droppedNote(
  objectId: string, page: string, dropped: number, total: number, y: number
): Req[] {
  if (dropped <= 0) return [];
  return noteBox(objectId, page, `Showing the top ${total - dropped} of ${total}`, y);
}

/** Horizontal bars, sorted, with the value printed at the end of each.
 *
 *  Horizontal because category names are words, and words fit beside a bar but
 *  not under one. Sorted because the ranking IS the message; input order makes
 *  the reader do the sorting. Values printed directly, so no axis scale is
 *  needed and the gridlines that would carry it can go — ink belongs to data. */
function barChartRequests(
  page: string, id: (s: string) => string,
  chart: NonNullable<SlideInput["chart"]>, onDark: boolean
): Req[] {
  const series = chart.series?.[0];
  if (!series?.points?.length) return [];
  const palette = onDark ? SERIES_DARK : SERIES_LIGHT;
  // Carry each point's ORIGINAL index through the sort. The object id has to
  // name the point in the spec, not its rank on the slide — otherwise editing
  // "Bar 1" edits whichever row happened to be first in the input, and any deck
  // whose data was not already sorted gets the wrong bar changed.
  const ranked = series.points
    .map((p, orig) => ({ ...p, orig }))
    .sort((a, b) => b.value - a.value);

  // The source line is part of the block, so it has to be inside the budget.
  // It was not: eight bars pushed it to y=397 on a 405pt canvas, where the
  // attribution for the numbers simply did not exist in the built deck.
  const fit = fitRows(ranked.length, MAX_BARS, CHART.barHeight, CHART.barGap, SOURCE_BLOCK);
  const points = ranked.slice(0, fit.count);

  // A zero BASELINE, not an absolute-value scale. Drawing |value| made a -100
  // the longest bar on a slide whose whole message is the ranking — the reader
  // saw the biggest bar against the worst number. With a baseline, a negative
  // bar runs left from zero and reads as the loss it is.
  const lo = Math.min(0, ...points.map((p) => p.value));
  const hi = Math.max(0, ...points.map((p) => p.value));
  const span = hi - lo || 1;

  const plotX = GRID.margin + CHART.labelGutter;
  const plotW = GRID.contentWidth - CHART.labelGutter - 52;
  const at = (v: number) => plotX + ((v - lo) / span) * plotW;
  const out: Req[] = [];
  // Same treatment as the stats: five bars centre in the band, eight fill it.
  const plotTop = GRID.bodyY +
    Math.max(0, (GRID.bandHeight - (points.length * fit.rowH + SOURCE_BLOCK)) / 2);

  points.forEach((p, i) => {
    const y = plotTop + i * fit.rowH;
    const x0 = at(Math.min(p.value, 0));
    const w = Math.max(2, Math.abs(at(p.value) - at(0)));
    out.push(
      ...textBox(id(`bl${p.orig}`), page, p.label, TYPE.chartCategory, {
        x: GRID.margin, y: y + 4, width: CHART.labelGutter - 10, height: fit.barH,
      }),
      ...filledShape(id(`bb${p.orig}`), page, "RECTANGLE", palette[0], {
        x: x0, y, width: w, height: fit.barH,
      }),
      // The value goes just past the bar's right-hand end, for a negative bar
      // as much as a positive one. Putting it at the far end of a negative bar
      // would drive it into the category name in the left gutter, and the minus
      // sign already says which way the bar runs.
      ...textBox(id(`bv${p.orig}`), page, formatValue(p.value), TYPE.chartValue, {
        x: x0 + w + CHART.valueGap, y: y + 4, width: 60, height: fit.barH,
      }),
    );
  });

  // A zero rule, only when the data crosses it — otherwise the left edge of the
  // plot IS zero and a line there is redundant ink.
  if (lo < 0) {
    out.push(...filledShape(id("bzero"), page, "RECTANGLE", onDark ? COLOR.periwinkle : COLOR.greyLight, {
      x: at(0), y: plotTop - 4, width: CHART.axisThickness,
      height: points.length * fit.rowH + 4,
    }));
  }

  const srcY = plotTop + points.length * fit.rowH + 8;
  const dropped = ranked.length - points.length;
  out.push(...textBox(id("csrc"), page, chart.source, TYPE.chartAxis, {
    x: GRID.margin, y: srcY,
    width: GRID.contentWidth - (dropped ? NOTE_WIDTH : 0), height: 16,
  }));
  out.push(...droppedNote(id("cdrop"), page, dropped, ranked.length, srcY));
  return out;
}

/** One stacked bar per category — composition, not ranking.
 *
 *  A single row per category rather than a grid of them, because the question
 *  a stacked bar answers is "what is this made of", and stacking is the only
 *  encoding that shows the parts and the whole at once.
 *
 *  A 2pt gap is left between segments. Without it adjacent fills of similar
 *  lightness merge into one shape and the boundary the chart exists to show
 *  disappears — the surface showing through IS the separator. */
function stackedBarRequests(
  page: string, id: (s: string) => string,
  chart: NonNullable<SlideInput["chart"]>, onDark: boolean
): Req[] {
  const series = (chart.series || []).filter((s) => s.points?.length).slice(0, 5);
  if (!series.length) return [];
  const palette = onDark ? SERIES_DARK : SERIES_LIGHT;

  // Categories come from the FIRST series; a later one missing a category
  // simply contributes nothing to that bar rather than shifting the others.
  const allCategories = series[0].points.map((p) => p.label);
  // The legend and the source line sit under the plot, so both are inside the
  // budget the rows have to fit. There was no budget at all before: ten
  // categories put two rows and the whole legend off the bottom of the slide.
  const fit = fitRows(allCategories.length, MAX_BARS, CHART.barHeight, CHART.barGap, STACK_TAIL);
  const categories = allCategories.slice(0, fit.count);

  // A stacked bar cannot draw a negative part — there is no direction for it to
  // go — so negatives are excluded from the DRAWING and from the TOTAL alike.
  // Counting them in the total while skipping them in the drawing was worse
  // than either: the printed total contradicted the bar beside it, and because
  // the scale came from those totals a single negative could push a bar clean
  // off the right-hand edge of the slide.
  let negatives = 0;
  const partOf = (cat: string, s: (typeof series)[number]) => {
    const v = s.points.find((p) => p.label === cat)?.value ?? 0;
    if (v < 0) { negatives += 1; return 0; }
    return v;
  };
  const totals = categories.map((c) => series.reduce((sum, s) => sum + partOf(c, s), 0));
  const max = Math.max(...totals) || 1;

  const plotX = GRID.margin + CHART.labelGutter;
  const plotW = GRID.contentWidth - CHART.labelGutter - 52;
  const rowH = fit.rowH;
  const plotTop = GRID.bodyY +
    Math.max(0, (GRID.bandHeight - (categories.length * rowH + STACK_TAIL)) / 2);
  const GAP = 2;

  const out: Req[] = [];
  categories.forEach((cat, ci) => {
    const y = plotTop + ci * rowH;
    let x = plotX;
    out.push(...textBox(id(`kl${ci}`), page, cat, TYPE.chartCategory, {
      x: GRID.margin, y: y + 4, width: CHART.labelGutter - 10, height: fit.barH,
    }));
    series.forEach((s, si) => {
      const v = partOf(cat, s);
      if (v <= 0) return;
      const w = (v / max) * plotW;
      out.push(...filledShape(id(`kb${ci}_${si}`), page, "RECTANGLE", palette[si % palette.length], {
        x, y, width: Math.max(1, w - GAP), height: fit.barH,
      }));
      x += w;
    });
    out.push(...textBox(id(`kt${ci}`), page, formatValue(totals[ci]), TYPE.chartValue, {
      x: x + CHART.valueGap, y: y + 4, width: 60, height: fit.barH,
    }));
  });

  // A legend is required here and cannot be replaced by direct labels: a
  // segment is often too narrow to hold its own name.
  let lx = plotX;
  const legendY = plotTop + categories.length * rowH + 6;
  series.forEach((s, si) => {
    // The label's box and the advance to the next entry are the SAME width.
    // Giving every label a fixed 110pt box while advancing by its text width
    // overlapped each legend entry with the one after it.
    const labelW = Math.min(110, Math.max(28, s.name.length * 4.6 + 6));
    out.push(
      ...filledShape(id(`kk${si}`), page, "RECTANGLE", palette[si % palette.length], {
        x: lx, y: legendY + 4, width: 9, height: 9,
      }),
      ...textBox(id(`kn${si}`), page, s.name, TYPE.chartAxis, {
        x: lx + 13, y: legendY, width: labelW, height: 16,
      }),
    );
    lx += 13 + labelW + 12;
  });

  const srcY = legendY + 20;
  const dropped = allCategories.length - categories.length;
  const note = dropped > 0
    ? `Showing the top ${categories.length} of ${allCategories.length}`
    : negatives > 0 ? "Negative values not shown" : "";
  out.push(...textBox(id("ksrc"), page, chart.source, TYPE.chartAxis, {
    x: GRID.margin, y: srcY, width: GRID.contentWidth - (note ? NOTE_WIDTH : 0), height: 16,
  }));
  out.push(...noteBox(id("kdrop"), page, note, srcY));
  return out;
}

/** Card geometry, computed in ONE place — the thumbnail's box decides the crop
 *  at resolution time and the placement at draw time.
 *
 *  The thumbnail is a fraction of the card's HEIGHT rather than a square of its
 *  width. Square-by-width overflowed: with four cards the picture ate so much
 *  of the card that the body was pushed out of the bottom of its own panel. */
export function cardGeometry(count: number) {
  const cols = Math.max(1, Math.min(6, count));
  const cellW = (GRID.contentWidth - CARDS.gap * (cols - 1)) / cols;
  const innerW = cellW - CARDS.padding * 2;
  const thumbH = CARDS.height * 0.42;
  // Bound how wide a thumbnail may get relative to its height, and centre it
  // when the card is wider than that. Spanning the full card put a 3.4:1 strip
  // on a two-card slide — the same swing that made the image grid pick bad
  // crops before its arrangement was chosen by cell shape.
  const thumbW = Math.min(innerW, thumbH * 2.2);
  return { cols, cellW, innerW, thumbW, thumbH, aspect: thumbW / thumbH };
}

/** Repeated blocks across the band.
 *
 *  Deliberately ONE function rather than the three layouts the source deck
 *  appears to use. Its slide 4 is a label chip over body text with no card
 *  behind it, its slide 6 is a white card holding a thumbnail and a caption,
 *  and its slide 12 is a number beside a description. Those are not three
 *  arrangements — they are the same arrangement with different parts present,
 *  and building them separately would have produced three sets of geometry to
 *  keep in step.
 *
 *  The card panel is only drawn when there is something to hold: a thumbnail,
 *  or a body long enough to read as a block. A chip and a heading floating on
 *  the slide ground is what their pillars slide does, and boxing it would make
 *  it look heavier than they draw it.
 */
function cardsRequests(
  page: string, id: (s: string) => string,
  cards: NonNullable<SlideInput["cards"]>
): Req[] {
  const shown = cards.slice(0, 6);
  if (!shown.length) return [];
  const { cellW, thumbW, thumbH } = cardGeometry(shown.length);
  // A panel only where there is a picture to hold. Boxing a chip and two lines
  // of text produced a card that was four-fifths empty — their own pillars
  // slide sets that type straight on the slide ground, and it reads lighter.
  const panelled = shown.some((c) => c.resolvedImage?.url);

  const out: Req[] = [];
  shown.forEach((card, i) => {
    const x = GRID.margin + i * (cellW + CARDS.gap);
    let y = CARDS.y;

    if (panelled) {
      out.push(...filledShape(id(`cp${i}`), page, "RECTANGLE", COLOR.white, {
        x, y, width: cellW, height: CARDS.height,
      }));
    }
    const innerX = panelled ? x + CARDS.padding : x;
    const innerW = panelled ? cellW - CARDS.padding * 2 : cellW;
    if (panelled) y += CARDS.padding;

    if (card.resolvedImage?.url) {
      out.push({
        createImage: {
          objectId: id(`ci${i}`),
          url: card.resolvedImage.url,
          elementProperties: {
            pageObjectId: page,
            size: { width: pt(thumbW), height: pt(thumbH) },
            transform: {
              scaleX: 1, scaleY: 1,
              translateX: innerX + (innerW - thumbW) / 2, translateY: y, unit: "PT",
            },
          },
        },
      });
      y += thumbH + CARDS.titleGap;
    }

    if (card.resolvedIcon && !card.resolvedImage) {
      const size = CARDS.iconSize;
      out.push({
        createImage: {
          objectId: id(`cn${i}`),
          url: card.resolvedIcon,
          elementProperties: {
            pageObjectId: page,
            size: { width: pt(size), height: pt(size) },
            transform: { scaleX: 1, scaleY: 1, translateX: innerX, translateY: y, unit: "PT" },
          },
        },
      });
      y += size + CARDS.titleGap;
    }

    if (card.marker) {
      // A chip, not plain text: the marker is a wayfinding device and reads as
      // one only when it carries its own ground.
      const chipW = Math.min(innerW, Math.max(28, card.marker.length * 6.2 + 14));
      out.push(
        ...filledShape(id(`cm${i}`), page, "RECTANGLE", COLOR.blue, {
          x: innerX, y, width: chipW, height: CARDS.markerHeight,
        }),
        ...textBox(id(`cmt${i}`), page, card.marker, TYPE.cardMarker, {
          x: innerX + 5, y: y + 4, width: chipW - 8, height: CARDS.markerHeight,
        }),
      );
      y += CARDS.markerHeight + CARDS.titleGap;
    }

    if (card.title) {
      out.push(...textBox(id(`ct${i}`), page, card.title, TYPE.cardTitle, {
        x: innerX, y, width: innerW, height: 0.42 * 72,
      }));
      y += 0.42 * 72;
    }

    if (card.body) {
      const remaining = CARDS.y + CARDS.height - y - (panelled ? CARDS.padding : 0);
      out.push(...textBox(id(`cb${i}`), page, card.body, TYPE.cardBody, {
        x: innerX, y, width: innerW, height: Math.max(20, remaining),
      }));
    }
  });
  return out;
}

/** A pull quote, set large on navy with the speaker beneath.
 *
 *  Their deck names people — a Chief Sustainability Officer, a former CEO — and
 *  had nowhere to put them; a testimonial buried in body copy is not a
 *  testimonial. The change of ground is what makes this land as a moment
 *  rather than as another content slide. */
function quoteRequests(
  page: string, id: (s: string) => string, q: NonNullable<SlideInput["quote"]>
): Req[] {
  const out: Req[] = [
    ...textBox(id("qm"), page, "“", TYPE.quoteMark, {
      x: QUOTE.markX, y: QUOTE.markY, width: QUOTE.markWidth, height: QUOTE.markHeight,
    }),
    ...textBox(id("qt"), page, q.text, TYPE.quoteText, {
      x: QUOTE.textX, y: QUOTE.textY,
      width: q.resolvedImage ? QUOTE.textWidth - 2.1 * 72 : QUOTE.textWidth,
      height: QUOTE.textHeight,
    }),
    ...textBox(id("qn"), page, q.name, TYPE.quoteName, {
      x: QUOTE.textX, y: QUOTE.attributionY, width: QUOTE.textWidth, height: QUOTE.attributionHeight,
    }),
    ...textBox(id("qr"), page, q.role, TYPE.quoteRole, {
      x: QUOTE.textX, y: QUOTE.roleY, width: QUOTE.textWidth, height: QUOTE.roleHeight,
    }),
  ];
  if (q.resolvedImage?.url) {
    out.push({
      createImage: {
        objectId: id("qp"), url: q.resolvedImage.url,
        elementProperties: {
          pageObjectId: page,
          size: { width: pt(QUOTE.portrait.size), height: pt(QUOTE.portrait.size) },
          transform: { scaleX: 1, scaleY: 1, translateX: QUOTE.portrait.x, translateY: QUOTE.portrait.y, unit: "PT" },
        },
      },
    });
  }
  return out;
}

/** Stages carried left to right by a rule and a chevron.
 *
 *  Drawn rather than bulleted for the same reason a timeline is: a process has
 *  direction, and a list does not show it. Reuses the connector primitives the
 *  timelines already prove. */
function processRequests(
  page: string, id: (s: string) => string, stages: NonNullable<SlideInput["stages"]>
): Req[] {
  const shown = stages.slice(0, 5);
  if (!shown.length) return [];
  const gaps = shown.length - 1;
  const boxW = (GRID.contentWidth - gaps * PROCESS.connectorWidth) / shown.length;
  const out: Req[] = [];

  shown.forEach((stage, i) => {
    const x = GRID.margin + i * (boxW + PROCESS.connectorWidth);
    out.push(
      ...filledShape(id(`pb${i}`), page, "ROUND_RECTANGLE", COLOR.blue, {
        x, y: PROCESS.y, width: boxW, height: PROCESS.boxHeight,
      }),
      ...textBox(id(`pn${i}`), page, stage.name, TYPE.stageName, {
        x: x + 8, y: PROCESS.y + PROCESS.boxHeight / 2 - 9, width: boxW - 16, height: 20,
      }, { align: "CENTER" }),
      ...textBox(id(`pc${i}`), page, stage.caption, TYPE.stageCaption, {
        x, y: PROCESS.captionY, width: boxW, height: PROCESS.captionHeight,
      }, { align: "CENTER" }),
    );

    if (i < gaps) {
      const cx = x + boxW;
      const midY = PROCESS.y + PROCESS.boxHeight / 2;
      out.push(
        ...filledShape(id(`pr${i}`), page, "RECTANGLE", COLOR.periwinkle, {
          x: cx + 3, y: midY - PROCESS.connectorThickness / 2,
          width: PROCESS.connectorWidth - 6 - PROCESS.chevron, height: PROCESS.connectorThickness,
        }),
        // RIGHT_ARROW, not TRIANGLE. Slides draws a triangle pointing UP, so
        // the first render had five arrowheads aimed at the ceiling on a
        // left-to-right process — correct geometry, wrong direction.
        ...filledShape(id(`pa${i}`), page, "RIGHT_ARROW", COLOR.periwinkle, {
          x: cx + PROCESS.connectorWidth - 3 - PROCESS.chevron,
          y: midY - PROCESS.chevron / 2,
          width: PROCESS.chevron, height: PROCESS.chevron,
        }),
      );
    }
  });
  return out;
}

/** Client marks on a clean ground, fitted whole. */
function logoWallRequests(
  page: string, id: (s: string) => string,
  logos: NonNullable<SlideInput["logos"]>
): Req[] {
  // A client whose mark could not be found is still a client: their name is
  // set instead. Dropping the cell silently shortened the credibility slide,
  // and filling it with a stock photograph would have been worse.
  const shown = logos.filter((l) => l.resolvedUrl || l.name?.trim()).slice(0, 12);
  if (!shown.length) return [];
  const cols = Math.min(shown.length, shown.length <= 4 ? shown.length : shown.length <= 8 ? 4 : 6);
  const rows = Math.ceil(shown.length / cols);
  const cellW = (GRID.contentWidth - LOGO_WALL.gap * (cols - 1)) / cols;
  const cellH = (LOGO_WALL.height - LOGO_WALL.gap * (rows - 1)) / rows;

  return shown.flatMap((logo, i) => {
    const c = i % cols, r = Math.floor(i / cols);
    const x = GRID.margin + c * (cellW + LOGO_WALL.gap) + LOGO_WALL.inset;
    const y = LOGO_WALL.y + r * (cellH + LOGO_WALL.gap) + LOGO_WALL.inset;
    if (!logo.resolvedUrl) {
      return textBox(id(`lw${i}`), page, logo.name, TYPE.logoWallName, {
        x, y, width: cellW - LOGO_WALL.inset * 2, height: cellH - LOGO_WALL.inset * 2,
      }, { align: "CENTER", vCenter: true });
    }
    return [{
      createImage: {
        objectId: id(`lw${i}`), url: logo.resolvedUrl!,
        elementProperties: {
          pageObjectId: page,
          size: { width: pt(cellW - LOGO_WALL.inset * 2), height: pt(cellH - LOGO_WALL.inset * 2) },
          transform: {
            scaleX: 1, scaleY: 1,
            translateX: GRID.margin + c * (cellW + LOGO_WALL.gap) + LOGO_WALL.inset,
            translateY: LOGO_WALL.y + r * (cellH + LOGO_WALL.gap) + LOGO_WALL.inset,
            unit: "PT",
          },
        },
      },
    }];
  });
}

/** One slide → its full request list. Exported so the layout geometry can be
 *  exercised without a Google round-trip; nothing else should call it. */
export function buildSlideRequests(slide: SlideInput, index: number, run = "r0"): Req[] {
  const layout: SlideLayout = slide.layout || (index === 0 ? "cover" : "content");
  const style = LAYOUT_STYLE[layout];
  // Object ids are scoped to this RUN, not just the slide index. On an update
  // the deck still holds the previous run's shapes when the new ones are
  // created, and Slides rejects a batch that reuses an existing objectId.
  const page = `${run}_s${index}`;
  const id = (suffix: string) => `${run}_s${index}_${suffix}`;

  const requests: Req[] = [
    {
      createSlide: {
        objectId: page,
        insertionIndex: index,
        slideLayoutReference: { predefinedLayout: "BLANK" },
      },
    },
    {
      updatePageProperties: {
        objectId: page,
        pageProperties: {
          // A photo-led layout with no image supplied falls back to navy —
          // neutral and on-brand, where a default white slide would not be.
          pageBackgroundFill: {
            solidFill: { color: { rgbColor: rgb(style.background ?? COLOR.navy) } },
          },
        },
        fields: "pageBackgroundFill.solidFill.color",
      },
    },
  ];

  // Photograph first, so every text box lands on top of it.
  if (style.background === null || layout === "feature") {
    requests.push(...backdropRequests(page, id, slide));
  }

  const onDark = style.onDark;
  const bodyStyle = onDark ? TYPE.bodyDark : TYPE.body;
  const titleStyle = onDark ? TYPE.slideTitleDark : TYPE.slideTitle;
  const eyebrowStyle = onDark ? TYPE.eyebrowDark : TYPE.eyebrow;

  if (layout === "cover") {
    requests.push(
      ...textBox(id("title"), page, slide.title, TYPE.coverTitle, {
        x: GRID.coverTitleX, y: GRID.coverTitleY,
        width: GRID.coverTitleWidth, height: GRID.coverTitleHeight,
      }),
      ...textBox(id("sub"), page, slide.subtitle, TYPE.coverKicker, {
        x: GRID.coverKickerX, y: GRID.coverKickerY,
        width: GRID.coverKickerWidth, height: GRID.coverKickerHeight,
      }),
    );
  } else if (layout === "closing") {
    requests.push(
      ...textBox(id("title"), page, slide.title, TYPE.coverTitle, {
        x: GRID.margin, y: GRID.closingTitleY,
        width: GRID.contentWidth, height: GRID.closingTitleHeight,
      }, { align: "CENTER" }),
      ...textBox(id("sub"), page, slide.subtitle, TYPE.coverKicker, {
        x: GRID.margin, y: GRID.closingSubtitleY,
        width: GRID.contentWidth, height: GRID.closingSubtitleHeight,
      }, { align: "CENTER" }),
    );
  } else if (layout === "section") {
    requests.push(
      ...textBox(id("eyebrow"), page, slide.eyebrow, TYPE.eyebrowDark, {
        x: GRID.margin, y: GRID.eyebrowY,
        width: GRID.eyebrowWidth, height: GRID.eyebrowHeight,
      }),
      ...textBox(id("title"), page, slide.title, TYPE.sectionTitle, {
        x: GRID.margin, y: CANVAS.height / 2 - 50,
        width: GRID.contentWidth, height: 100,
      }),
      ...textBox(id("body"), page, slide.subtitle, TYPE.bodyDark, {
        x: GRID.margin, y: CANVAS.height / 2 + 55,
        width: GRID.contentWidth, height: 60,
      }),
    );
  } else if (layout === "timeline") {
    requests.push(
      ...textBox(id("eyebrow"), page, slide.eyebrow, eyebrowStyle, {
        x: GRID.margin, y: GRID.eyebrowY,
        width: GRID.eyebrowWidth, height: GRID.eyebrowHeight,
      }),
      ...textBox(id("title"), page, slide.title, titleStyle, {
        x: GRID.margin, y: GRID.titleY, width: GRID.contentWidth, height: GRID.titleHeight,
      }),
      ...textBox(id("sub"), page, slide.subtitle, bodyStyle, {
        x: GRID.margin, y: GRID.bodyY, width: GRID.contentWidth, height: 20,
      }),
      ...timelineRequests(page, id, slide.milestones || []),
    );
  } else if (layout === "quote") {
    requests.push(
      ...textBox(id("eyebrow"), page, slide.eyebrow, eyebrowStyle, {
        x: GRID.margin, y: GRID.eyebrowY,
        width: GRID.eyebrowWidth, height: GRID.eyebrowHeight,
      }),
      ...(slide.quote ? quoteRequests(page, id, slide.quote) : []),
    );
  } else if (layout === "process" || layout === "logo-wall") {
    requests.push(
      ...textBox(id("eyebrow"), page, slide.eyebrow, eyebrowStyle, {
        x: GRID.margin, y: GRID.eyebrowY,
        width: GRID.eyebrowWidth, height: GRID.eyebrowHeight,
      }),
      ...textBox(id("title"), page, slide.title, titleStyle, {
        x: GRID.margin, y: GRID.titleY, width: GRID.contentWidth, height: GRID.titleHeight,
      }),
      ...(layout === "process"
        ? processRequests(page, id, slide.stages || [])
        : logoWallRequests(page, id, slide.logos || [])),
    );
  } else if (layout === "cards") {
    requests.push(
      ...textBox(id("eyebrow"), page, slide.eyebrow, eyebrowStyle, {
        x: GRID.margin, y: GRID.eyebrowY,
        width: GRID.eyebrowWidth, height: GRID.eyebrowHeight,
      }),
      ...textBox(id("title"), page, slide.title, titleStyle, {
        x: GRID.margin, y: GRID.titleY, width: GRID.contentWidth, height: GRID.titleHeight,
      }),
      ...cardsRequests(page, id, slide.cards || []),
    );
  } else if (layout === "stat" || layout === "bar-chart" || layout === "stacked-bar") {
    requests.push(
      ...textBox(id("eyebrow"), page, slide.eyebrow, eyebrowStyle, {
        x: GRID.margin, y: GRID.eyebrowY,
        width: GRID.eyebrowWidth, height: GRID.eyebrowHeight,
      }),
      ...textBox(id("title"), page, slide.title, titleStyle, {
        x: GRID.margin, y: GRID.titleY, width: GRID.contentWidth, height: GRID.titleHeight,
      }),
    );
    if (layout === "stat") requests.push(...statRequests(page, id, slide.stats || []));
    else if (slide.chart) {
      requests.push(...(layout === "stacked-bar"
        ? stackedBarRequests(page, id, slide.chart, onDark)
        : barChartRequests(page, id, slide.chart, onDark)));
    }
  } else if (layout === "timeline-parallel") {
    requests.push(
      ...textBox(id("eyebrow"), page, slide.eyebrow, eyebrowStyle, {
        x: GRID.margin, y: GRID.eyebrowY,
        width: GRID.eyebrowWidth, height: GRID.eyebrowHeight,
      }),
      ...textBox(id("title"), page, slide.title, titleStyle, {
        x: GRID.margin, y: GRID.titleY, width: GRID.contentWidth, height: GRID.titleHeight,
      }),
      ...textBox(id("sub"), page, slide.subtitle, bodyStyle, {
        x: GRID.margin, y: GRID.bodyY, width: GRID.contentWidth, height: 20,
      }),
      ...parallelTimelineRequests(page, id, slide.tracks || [], slide.today),
    );
  } else if (layout === "feature") {
    requests.push(
      ...textBox(id("eyebrow"), page, slide.eyebrow, TYPE.eyebrowDark, {
        x: GRID.margin, y: GRID.eyebrowY,
        width: GRID.eyebrowWidth, height: GRID.eyebrowHeight,
      }),
      ...textBox(id("title"), page, slide.title, TYPE.featureTitle, {
        x: GRID.margin, y: IMAGE.overlayTitleY,
        width: GRID.contentWidth * 0.72, height: IMAGE.overlayTitleHeight,
      }),
      ...textBox(id("body"), page, slide.body, TYPE.featureBody, {
        x: GRID.margin, y: IMAGE.overlayBodyY,
        width: GRID.contentWidth * 0.72, height: IMAGE.overlayBodyHeight,
      }),
    );
  } else if (layout === "image-split") {
    // Image bleeds off the left edge; text takes the right half. Bleeding
    // rather than insetting is what makes it read as editorial instead of as a
    // picture pasted into a document.
    if (slide.resolvedImage) {
      requests.push({
        createImage: {
          objectId: id("half"),
          url: slide.resolvedImage.url,
          elementProperties: {
            pageObjectId: page,
            size: { width: pt(IMAGE.splitWidth), height: pt(CANVAS.height) },
            transform: { scaleX: 1, scaleY: 1, translateX: 0, translateY: 0, unit: "PT" },
          },
        },
      });
    }
    requests.push(
      ...textBox(id("eyebrow"), page, slide.eyebrow, eyebrowStyle, {
        x: IMAGE.splitTextX, y: GRID.eyebrowY,
        width: IMAGE.splitTextWidth, height: GRID.eyebrowHeight,
      }),
      ...textBox(id("title"), page, slide.title, titleStyle, {
        x: IMAGE.splitTextX, y: GRID.titleY,
        width: IMAGE.splitTextWidth, height: GRID.titleHeight,
      }),
      ...textBox(id("body"), page, slide.body, bodyStyle, {
        x: IMAGE.splitTextX, y: GRID.bodyY,
        width: IMAGE.splitTextWidth, height: GRID.bodyHeight,
      }, { bullets: true }),
    );
  } else if (layout === "image-grid") {
    requests.push(
      ...textBox(id("eyebrow"), page, slide.eyebrow, eyebrowStyle, {
        x: GRID.margin, y: GRID.eyebrowY,
        width: GRID.eyebrowWidth, height: GRID.eyebrowHeight,
      }),
      ...textBox(id("title"), page, slide.title, titleStyle, {
        x: GRID.margin, y: GRID.titleY, width: GRID.contentWidth, height: GRID.titleHeight,
      }),
      ...gridRequests(page, id, slide.resolvedImages || []),
    );
  } else if (layout === "two-column") {
    requests.push(
      ...textBox(id("eyebrow"), page, slide.eyebrow, eyebrowStyle, {
        x: GRID.margin, y: GRID.eyebrowY,
        width: GRID.eyebrowWidth, height: GRID.eyebrowHeight,
      }),
      ...textBox(id("title"), page, slide.title, titleStyle, {
        x: GRID.margin, y: GRID.titleY, width: GRID.contentWidth, height: GRID.titleHeight,
      }),
      ...textBox(id("left"), page, slide.body, bodyStyle, {
        x: GRID.columnLeftX, y: GRID.columnY,
        width: GRID.columnWidth, height: GRID.columnHeight,
      }, { bullets: true }),
      ...textBox(id("right"), page, slide.bodyRight, bodyStyle, {
        x: GRID.columnRightX, y: GRID.columnY,
        width: GRID.columnWidth, height: GRID.columnHeight,
      }, { bullets: true }),
    );
  } else {
    // content, case-study, dark-index all share the title + body skeleton;
    // the eyebrow is what makes a case study read as one.
    requests.push(
      ...textBox(id("eyebrow"), page, slide.eyebrow, eyebrowStyle, {
        x: GRID.margin, y: GRID.eyebrowY,
        width: GRID.eyebrowWidth, height: GRID.eyebrowHeight,
      }),
      ...textBox(id("title"), page, slide.title, titleStyle, {
        x: GRID.margin, y: GRID.titleY, width: GRID.contentWidth, height: GRID.titleHeight,
      }),
      ...textBox(id("body"), page, slide.body, bodyStyle, {
        x: GRID.margin, y: GRID.bodyY, width: GRID.contentWidth, height: GRID.bodyHeight,
      }, { bullets: true }),
    );
  }

  requests.push(...logoRequests(id("logo"), page, layout, slide));
  return requests;
}

/** Speaker notes need a second pass: they live on a notes page whose shape id
 *  Google assigns when the slide is created, so it cannot be referenced in the
 *  same batchUpdate that creates it. Best-effort — a deck that lands without
 *  its notes is still the deck the user asked for. */
async function applySpeakerNotes(
  presentationId: string,
  slides: SlideInput[],
  token: string
): Promise<void> {
  if (!slides.some((s) => s.notes?.trim())) return;

  const fields = "slides(objectId,slideProperties(notesPage(notesProperties(speakerNotesObjectId))))";
  const read = await googleFetch(`${SLIDES_API}/${presentationId}?fields=${encodeURIComponent(fields)}`, token);
  if (!read.ok) {
    console.warn(`[Slides] could not read notes pages (${read.status})`);
    return;
  }

  const pages: any[] = read.json?.slides || [];
  const requests: Req[] = [];
  slides.forEach((slide, i) => {
    const text = slide.notes?.trim();
    const notesId = pages[i]?.slideProperties?.notesPage?.notesProperties?.speakerNotesObjectId;
    if (text && notesId) requests.push({ insertText: { objectId: notesId, text, insertionIndex: 0 } });
  });
  if (!requests.length) return;

  const res = await googleFetch(`${SLIDES_API}/${presentationId}:batchUpdate`, token, {
    method: "POST",
    body: JSON.stringify({ requests }),
  });
  if (!res.ok) console.warn(`[Slides] speaker notes failed (${res.status}) — deck itself is fine`);
}

/* ─────────────── Orchestration ─────────────── */

/** Every Google call in this file, and it NEVER throws.
 *
 *  It used to. A 45s timeout or a dropped socket rejected instead of returning
 *  {ok:false}, and each caller had been written on the assumption that a failure
 *  arrives as a status code. So the batchUpdate timeout skipped the cleanup that
 *  promises to leave nothing behind and orphaned a titled, empty presentation in
 *  the user's Drive; and a timeout on the speaker notes — which run AFTER the
 *  deck is finished and are best-effort by design — threw past the success
 *  return and reported a complete, correct deck as a failure.
 *
 *  status 0 means the request never got an answer, which is a different thing
 *  from a rejection and callers that can act on the difference do. */
async function googleFetch(url: string, token: string, init: RequestInit = {}) {
  try {
    const res = await fetch(url, {
      ...init,
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
        ...(init.headers || {}),
      },
      // The chat lambda is 300s and the stall guard does not cover tool
      // execution, so an unbounded fetch could burn the whole turn.
      signal: AbortSignal.timeout(45_000),
    });
    const json = await res.json().catch(() => ({} as any));
    return { ok: res.ok, status: res.status, json };
  } catch (err: any) {
    const message = err?.name === "TimeoutError" || err?.name === "AbortError"
      ? "Google did not answer in time"
      : err?.message || "Could not reach Google";
    console.warn(`[Slides] ${init.method || "GET"} ${url.split("?")[0]} failed: ${message}`);
    return { ok: false, status: 0, json: { error: { message } } as any };
  }
}

/**
 * Split a slide whose body will not fit, rather than letting it overflow.
 *
 * Slides does not reflow or shrink text to fit a box — it draws it and lets it
 * run past the edge, off the bottom of the slide. So an over-long body silently
 * loses its last bullets, and nothing in the deck says so.
 *
 * Splitting rather than shrinking is deliberate: type size is part of the brand
 * and a slide set two points smaller than its neighbours reads as a mistake,
 * where a second slide reads as a deck. The continuation keeps the title with a
 * marker so it is obviously the same thought, not a new one.
 *
 * Estimated, not measured — there is no text metric server-side. The estimate
 * is deliberately generous: splitting a slide that would have fit is a smaller
 * error than dropping the words that did not.
 */
export function splitOverflowingSlides(slides: SlideInput[]): SlideInput[] {
  const CHARS_PER_LINE = 118;   // 671pt of Roboto Light at 10pt, with margin
  const MAX_LINES = 11;         // 202pt of body box at ~11.5pt line height

  const linesFor = (text: string) =>
    text.split("\n").reduce((n, line) => n + Math.max(1, Math.ceil(line.length / CHARS_PER_LINE)), 0);

  const out: SlideInput[] = [];
  for (const slide of slides) {
    const body = slide.body;
    // Only prose layouts overflow this way; a chart's geometry is bounded.
    const splittable = !slide.chart && !slide.stats && !slide.milestones && !slide.tracks;
    if (!body || !splittable || linesFor(body) <= MAX_LINES) {
      out.push(slide);
      continue;
    }

    const lines = body.split("\n");
    const first: string[] = [];
    let used = 0;
    while (lines.length && used + Math.max(1, Math.ceil(lines[0].length / CHARS_PER_LINE)) <= MAX_LINES) {
      const line = lines.shift()!;
      used += Math.max(1, Math.ceil(line.length / CHARS_PER_LINE));
      first.push(line);
    }
    // A single bullet longer than a whole slide cannot be split by lines; let
    // it through rather than emitting an empty slide and looping.
    if (!first.length) { out.push(slide); continue; }

    out.push({ ...slide, body: first.join("\n") });
    out.push({
      ...slide,
      title: `${slide.title || ""} (continued)`.trim(),
      body: lines.join("\n"),
      // The picture, eyebrow and speaker notes belong to the first half only.
      image: undefined, resolvedImage: undefined, eyebrow: undefined, notes: undefined,
    });
  }
  return out;
}

/**
 * Turn every slide's image BRIEF into an actual picture, before anything is
 * drawn or previewed.
 *
 * Resolution happens once, up front, for a reason: the preview and the built
 * deck must show the same photograph. Resolving lazily at draw time would give
 * a draft one Unsplash hit and the published deck another, and the preview
 * would stop predicting the deck — which is the one thing it has to do.
 *
 * Slides resolve concurrently, and a slide whose image cannot be found simply
 * keeps its solid brand background rather than failing the deck.
 */
/** Where this layout will draw text on top of the photograph, as fractions of
 *  the canvas — read from the layout ITSELF rather than listed by hand.
 *
 *  Listing them by hand is what went wrong: the gradient was built for a cover,
 *  whose title sits across the foot, and every other full-bleed layout inherited
 *  a shape that was never measured against where its own words land. A closing
 *  slide writes across the middle and a feature slide starts at the very top,
 *  and both were given a picture that is lightest exactly there.
 *
 *  Derived from the same request list the deck is built from, so a box that
 *  moves takes its gradient with it. */
export function textBandsFor(slide: SlideInput, index: number): TextBand[] {
  const raw: TextBand[] = [];
  for (const req of buildSlideRequests({ ...slide, resolvedImage: undefined }, index, "band")) {
    const shape = (req as any).createShape;
    if (!shape || shape.shapeType !== "TEXT_BOX") continue;
    const y = shape.elementProperties.transform.translateY;
    const h = shape.elementProperties.size.height.magnitude;
    const top = Math.max(0, Math.min(1, y / CANVAS.height));
    const bottom = Math.max(0, Math.min(1, (y + h) / CANVAS.height));
    if (bottom > top) raw.push({ top, bottom });
  }
  // The photo credit is added by hand, because it is the one box that cannot be
  // derived: it exists only once the image has been resolved, and this runs to
  // decide how to bake that image. White 6pt type on an unmeasured foot is
  // exactly the case that leaves a photographer's name invisible.
  raw.push({
    top: IMAGE.creditY / CANVAS.height,
    bottom: (IMAGE.creditY + IMAGE.creditHeight) / CANVAS.height,
  });

  // Merged, because eight overlapping boxes is eight measurements of nearly the
  // same pixels.
  raw.sort((a, b) => a.top - b.top);
  const merged: TextBand[] = [];
  for (const band of raw) {
    const last = merged[merged.length - 1];
    if (last && band.top <= last.bottom + 0.02) last.bottom = Math.max(last.bottom, band.bottom);
    else merged.push({ ...band });
  }
  return merged;
}

export async function resolveDeckImages(
  slides: SlideInput[],
  generate?: ImageGenerator
): Promise<void> {
  await Promise.all(
    slides.map(async (slide, slideIndex) => {
      // `imageUnavailable` means we already tried and could not find one. It
      // is checked as well as `resolvedImage` because publishing re-runs this
      // whole resolution: a slide that previewed as flat navy — because
      // Unsplash 403'd on the demo tier, or the generator was rate-limited —
      // could pick up a picture nobody had reviewed on the way into Drive, and
      // the deck the user approved is not the deck they got. A retry is still
      // available: changing the image in the preview resolves it explicitly.
      if (slide.image && !slide.resolvedImage && !slide.imageUnavailable) {
        // Crop to the SHAPE OF THE BOX the image will sit in. Baking everything
        // to 16:9 and dropping it into a tall half-slide letterboxes exactly the
        // way the full-bleed cover used to, which is the bug this closes.
        // Gradient only where text sits on the picture.
        const split = slide.layout === "image-split";
        // Tell the baker where this layout's lockup will land, so it measures
        // the part of the picture the mark actually sits on.
        const style = LAYOUT_STYLE[slide.layout || "content"];
        const place = LOGO_PLACEMENT[style.logoPlacement];
        const r = await resolveImage(slide.image, generate, {
          aspect: split ? IMAGE.splitWidth / CANVAS.height : CANVAS.width / CANVAS.height,
          gradient: !split,
          textBands: split ? undefined : textBandsFor(slide, slideIndex),
          logoRegion: {
            x: place.x / CANVAS.width, y: place.y / CANVAS.height,
            w: place.width / CANVAS.width, h: place.height / CANVAS.height,
          },
        });
        if (r) slide.resolvedImage = { url: r.url, scrim: r.scrim, credit: r.credit, logo: r.logo };
        else slide.imageUnavailable = true;
      }
      if (slide.quote?.image && !slide.quote.resolvedImage) {
        const r = await resolveImage(slide.quote.image, generate, { aspect: 1, gradient: false });
        if (r) slide.quote.resolvedImage = { url: r.url };
      }
      if (slide.logos?.length) {
        await Promise.all(slide.logos.map(async (l) => {
          if (l.resolvedUrl) return;
          // contain, never cover: a cropped client mark is a misused trademark.
          // trademark, so a mark that cannot be found stays missing rather than
          // being filled in by stock photography or a generated picture.
          const r = await resolveImage({ url: l.url, query: l.query }, generate,
            { aspect: 2, gradient: false, fit: "contain", trademark: true });
          if (r) l.resolvedUrl = r.url;
        }));
      }
      if (slide.cards?.length) {
        const cardAspect = cardGeometry(slide.cards.length).aspect;
        await Promise.all(slide.cards.map(async (card) => {
          if (card.icon && !card.resolvedIcon) {
            const icon = await resolveIcon(card.icon);
            if (icon) card.resolvedIcon = icon;
          }
          if (!card.image || card.resolvedImage) return;
          const r = await resolveImage(card.image, generate, { aspect: cardAspect, gradient: false });
          if (r) card.resolvedImage = { url: r.url };
        }));
      }
      if (slide.images?.length && !slide.resolvedImages) {
        const cellAspect = gridGeometry(
          slide.images.length, slide.images.some((i) => i.caption)
        ).aspect;
        const out = await Promise.all(
          slide.images.slice(0, 12).map(async (spec) => {
            // Cropped to the CELL's own shape, from the same calculation the
            // drawing uses. No text sits on a grid cell, so no gradient.
            const r = await resolveImage(spec, generate, { aspect: cellAspect, gradient: false });
            return r ? { url: r.url, caption: spec.caption } : null;
          })
        );
        const kept = out.filter(Boolean) as { url: string; caption?: string }[];
        if (kept.length) slide.resolvedImages = kept;
      }
    })
  );
}

/** Short unique prefix for one generation run. Base36 of the clock plus a few
 *  random characters: unique enough within a single presentation, and short
 *  enough to leave room under the 50-character objectId limit. */
function runId(): string {
  return `r${Date.now().toString(36)}${Math.random().toString(36).slice(2, 5)}`;
}

/** Replace every slide in an existing deck, keeping the FILE.
 *
 *  This is the difference between "make it more visual" changing the deck the
 *  user has open and handing them a second link to a near-identical file. The
 *  URL, revision history and any comments survive; only the slides are swapped.
 *
 *  New slides are created first and the old ones deleted in the same batch, so
 *  the deck is never momentarily empty and the whole swap is one atomic update.
 */
export async function updateSlides(
  presentationId: string,
  title: string,
  slides: SlideInput[],
  userEmail: string,
  generateImageFn?: ImageGenerator
): Promise<SlidesResult> {
  const auth = await getUserGoogleToken(userEmail);
  if (!auth.ok || !auth.accessToken) {
    const reason = auth.reason as SlidesAuthFailure;
    return { ok: false, error: authFailureMessage(reason), reason };
  }
  const token = auth.accessToken;

  const existing = await googleFetch(
    `${SLIDES_API}/${presentationId}?fields=slides(objectId)`, token
  );
  if (!existing.ok) {
    // 404 here usually means the deck was created by something other than this
    // app: drive.file only reaches files we made. Reported, not worked around.
    return {
      ok: false,
      notFound: existing.status === 404 || existing.status === 403,
      error: `Could not open that deck to update it: ${existing.json?.error?.message || `HTTP ${existing.status}`}`,
    };
  }
  const oldIds: string[] = (existing.json?.slides || []).map((s: any) => s.objectId);

  slides = splitOverflowingSlides(slides);
  await resolveDeckImages(slides, generateImageFn);

  const run = runId();
  const requests: Req[] = slides.flatMap((slide, i) => buildSlideRequests(slide, i, run));
  for (const objectId of oldIds) requests.push({ deleteObject: { objectId } });

  const updated = await googleFetch(`${SLIDES_API}/${presentationId}:batchUpdate`, token, {
    method: "POST",
    body: JSON.stringify({ requests }),
  });
  if (!updated.ok) {
    const detail = updated.json?.error?.message || `HTTP ${updated.status}`;
    console.warn(`[Slides] update failed: ${detail}`);
    // No cleanup here, deliberately: the batch is atomic, so a failure leaves
    // the user's existing deck exactly as it was. Deleting would destroy it.
    return { ok: false, error: `Could not update the slides: ${detail}` };
  }

  // Keep the filename in step with the deck's own title.
  await googleFetch(`${DRIVE_API}/${presentationId}?supportsAllDrives=true`, token, {
    method: "PATCH",
    body: JSON.stringify({ name: title }),
  });

  await applySpeakerNotes(presentationId, slides, token);

  return {
    ok: true,
    presentationId,
    url: `https://docs.google.com/presentation/d/${presentationId}/edit`,
    title,
    slideCount: slides.length,
    updated: true,
    thumbnails: await captureThumbnails(presentationId, token),
  };
}

export async function generateSlides(
  title: string,
  slides: SlideInput[],
  userEmail: string,
  generateImageFn?: ImageGenerator
): Promise<SlidesResult> {
  if (!userEmail) return { ok: false, error: "No signed-in user to create the deck for." };
  if (!slides?.length) return { ok: false, error: "No slides to build." };

  const auth = await getUserGoogleToken(userEmail);
  if (!auth.ok || !auth.accessToken) {
    const reason = auth.reason as SlidesAuthFailure;
    return { ok: false, error: authFailureMessage(reason), reason };
  }
  const token = auth.accessToken;

  const created = await googleFetch(SLIDES_API, token, {
    method: "POST",
    body: JSON.stringify({ title }),
  });
  if (!created.ok || !created.json?.presentationId) {
    const detail = created.json?.error?.message || `HTTP ${created.status}`;
    console.warn(`[Slides] create failed: ${detail}`);
    // A disabled API is the one failure with an actionable fix, and its message
    // is otherwise opaque enough that it looks like a permissions problem.
    if (/has not been used|is disabled/i.test(detail)) {
      return { ok: false, error: "The Google Slides API isn't enabled on this project yet." };
    }
    return { ok: false, error: `Could not create the presentation: ${detail}` };
  }

  const presentationId: string = created.json.presentationId;
  const defaultSlideId: string | undefined = created.json.slides?.[0]?.objectId;

  slides = splitOverflowingSlides(slides);
  await resolveDeckImages(slides, generateImageFn);

  const run = runId();
  const requests: Req[] = slides.flatMap((slide, i) => buildSlideRequests(slide, i, run));
  // Delete Slides' own starter slide LAST — removing it first would leave the
  // deck momentarily empty, and insertionIndex is evaluated as requests apply.
  if (defaultSlideId) requests.push({ deleteObject: { objectId: defaultSlideId } });

  const updated = await googleFetch(`${SLIDES_API}/${presentationId}:batchUpdate`, token, {
    method: "POST",
    body: JSON.stringify({ requests }),
  });

  if (!updated.ok) {
    const detail = updated.json?.error?.message || `HTTP ${updated.status}`;
    console.warn(`[Slides] batchUpdate failed: ${detail}`);

    // A request that never got an answer is not the same as one that was
    // refused. Google frequently finishes a batch we stopped waiting for, so
    // ASK before destroying: deleting a deck that was in fact built correctly,
    // and telling the user it failed, is the worse of the two mistakes.
    if (updated.status === 0) {
      const check = await googleFetch(
        `${SLIDES_API}/${presentationId}?fields=${encodeURIComponent("slides(objectId)")}`,
        token
      );
      const built: any[] = check.json?.slides || [];
      if (check.ok && built.length >= slides.length) {
        console.log(`[Slides] batch completed despite the timeout — ${built.length} slides present`);
        await applySpeakerNotes(presentationId, slides, token);
        return {
          ok: true,
          presentationId,
          url: `https://docs.google.com/presentation/d/${presentationId}/edit`,
          title,
          slideCount: slides.length,
          thumbnails: await captureThumbnails(presentationId, token),
        };
      }
    }

    // Leave nothing behind. An empty "Untitled presentation" appearing in
    // someone's Drive after a failed request is worse than no file at all.
    const cleanup = await googleFetch(`${DRIVE_API}/${presentationId}?supportsAllDrives=true`, token, {
      method: "DELETE",
    });
    if (!cleanup.ok) console.warn(`[Slides] could not clean up ${presentationId} (${cleanup.status})`);
    return { ok: false, error: `Could not build the slides: ${detail}` };
  }

  await applySpeakerNotes(presentationId, slides, token);

  return {
    ok: true,
    presentationId,
    url: `https://docs.google.com/presentation/d/${presentationId}/edit`,
    title,
    slideCount: slides.length,
    thumbnails: await captureThumbnails(presentationId, token),
  };
}
