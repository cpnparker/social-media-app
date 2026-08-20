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
  SERIES_LIGHT, SERIES_DARK, CARDS, QUOTE, PROCESS, LOGO_WALL, RULE, LAYOUT_STYLE, LOGO_PLACEMENT,
  rgb, logoUrl, textOn, type SlideLayout, type TypeStyle,
} from "@/lib/slides/brand";
import { getUserGoogleToken, authFailureMessage, type SlidesAuthFailure } from "@/lib/slides/token";
import { captureThumbnails } from "@/lib/slides/preview";
import {
  resolveImage, selectImageSource, bakeImageSource,
  type ImageGenerator, type ImageSource, type ImageRequest, type TextBand,
} from "@/lib/slides/images";
import { resolveIcon } from "@/lib/slides/icons";
import { SLIDES_TEXT_INSET, BULLET_INDENT } from "@/lib/slides/preview-style";
import { refreshSignedMediaUrl } from "@/lib/media/signed";

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
  /** Headers for the two-column comparison — "Before"/"After", "Us"/"Them". */
  columns?: { left?: string; right?: string };
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
  /** Why the picture could not be used, when it was found but could not be
   *  prepared. Reported to the model so it can tell the user. */
  imageError?: string;
  /** How many grid thumbnails were asked for and not found. */
  imagesDropped?: number;
  /** The layout name the model asked for, when it was not one we have. */
  layoutAsked?: string;
  /** This slide is the tail of one the splitter cut in two. It takes the
   *  picture from the slide it came from rather than asking for its own. */
  continuation?: boolean;
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
  stats?: { value: string; label: string; detail?: string; primary?: boolean }[];
  /** Data for bar-chart and line-chart. */
  chart?: {
    series: { name: string; points: { label: string; value: number }[] }[];
    /** Printed under the plot. A chart without one invites the question. */
    source?: string;
    /** The points are a TIME SERIES — draw them in the given order, do not sort
     *  by value. A monthly trend sorted by value is a scrambled line. */
    sequence?: boolean;
    /** Index of the one bar that IS the point — drawn in the accent, the rest
     *  muted, so the chart argues instead of merely presenting. */
    highlight?: number;
    /** A target or reference line drawn across the plot — "industry average",
     *  "our goal" — so a bar reads as above or below it, not just as a length. */
    benchmark?: { value: number; label?: string };
    /** A short annotation tied to one bar — the reason behind the number. */
    callout?: { point: number; text: string };
  };
  /** A deck-wide art-direction note threaded into every PHOTOGRAPH query, so a
   *  deck's images read as one commission rather than a stock grab-bag. Never
   *  applied to logos, icons or a named person's portrait. */
  imageStyle?: string;
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
  /** Points after each paragraph. Raised on a short list so four bullets use
   *  the band they are given instead of pooling under the title with half the
   *  slide empty beneath them. */
  spaceBelow?: number;
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
  // A blank line between bullets is how people type a list, and Slides turns
  // every paragraph into a bullet — including the empty ones, which drew a disc
  // with nothing after it. The 6pt paragraph spacing is what separates them.
  const collapsed = options.bullets
    ? content.split("\n").map((l) => l.trim()).filter(Boolean).join("\n")
    : content;
  if (!collapsed) return [];
  const rendered = style.caps ? collapsed.toUpperCase() : collapsed;

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
          spaceBelow: pt(options.spaceBelow ?? 6),
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
  box: { x: number; y: number; width: number; height: number },
  /** 0–1. A hairline at full strength is a line; at a fifth it is structure. */
  alpha?: number
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
          shapeBackgroundFill: {
            solidFill: {
              color: { rgbColor: rgb(color) },
              ...(typeof alpha === "number" ? { alpha } : {}),
            },
          },
          outline: { propertyState: "NOT_RENDERED" },
        },
        fields: typeof alpha === "number"
          ? "shapeBackgroundFill.solidFill,outline.propertyState"
          : "shapeBackgroundFill.solidFill.color,outline.propertyState",
      },
    },
  ];
}

/** A straight line segment from (x1,y1) to (x2,y2), drawn as a thin rectangle
 *  rotated by the affine transform.
 *
 *  Slides has no polyline, so a line chart is built from these. The transform
 *  maps the rectangle's local mid-left onto the first point and mid-right onto
 *  the second — verified exact for every direction. The preview reads the same
 *  transform, so a sloped line looks identical in both.
 */
function segment(
  objectId: string, page: string, color: string,
  x1: number, y1: number, x2: number, y2: number, thickness: number, alpha?: number
): Req[] {
  const dx = x2 - x1, dy = y2 - y1;
  const L = Math.hypot(dx, dy) || 1;
  const c = dx / L, sn = dy / L;
  const T = thickness;
  return [
    {
      createShape: {
        objectId, shapeType: "RECTANGLE",
        elementProperties: {
          pageObjectId: page,
          size: { width: pt(L), height: pt(T) },
          transform: {
            scaleX: c, scaleY: c, shearX: -sn, shearY: sn,
            translateX: x1 + sn * (T / 2), translateY: y1 - c * (T / 2), unit: "PT",
          },
        },
      },
    },
    {
      updateShapeProperties: {
        objectId,
        shapeProperties: {
          shapeBackgroundFill: {
            solidFill: { color: { rgbColor: rgb(color) }, ...(typeof alpha === "number" ? { alpha } : {}) },
          },
          outline: { propertyState: "NOT_RENDERED" },
        },
        fields: typeof alpha === "number"
          ? "shapeBackgroundFill.solidFill,outline.propertyState"
          : "shapeBackgroundFill.solidFill.color,outline.propertyState",
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
  // Bounded, because the columns are the canvas width divided by the count and
  // nothing else gives. At eight the column is 84pt — about nine characters of
  // 12pt Playfair — so "Questionnaire" wraps to three lines and runs straight
  // through the detail beneath it, on every one of the eight.
  const shown = milestones.filter(Boolean).slice(0, TIMELINE.maxMilestones);
  const droppedMilestones = milestones.length - shown.length;
  const n = shown.length;
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

  // The name's band grows to fit the longest name, and the detail starts under
  // it. Both were fixed constants, so a two-line name overlapped its own
  // detail rather than pushing it down.
  let titleLines = 1;
  for (let i = 0; i < n; i++) {
    titleLines = Math.max(titleLines, estimateLines(shown[i].title, labelWidth, TYPE.milestoneName.size));
  }
  const titleHeight = Math.max(TIMELINE.titleHeight, drawnTextHeight(titleLines, TYPE.milestoneName.size));
  const detailY = TIMELINE.titleY + titleHeight + TIMELINE.bandGap;
  const noteReserve = droppedMilestones > 0 ? 20 : 0;
  const detailHeight = Math.max(24, CANVAS.height - GRID.margin - noteReserve - detailY);

  shown.forEach((m, i) => {
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
        x: labelX, y: TIMELINE.titleY, width: labelWidth, height: titleHeight,
      }, { align: "CENTER" }),
      ...textBox(id(`x${i}`), page, m.detail, TYPE.milestoneText, {
        x: labelX, y: detailY, width: labelWidth, height: detailHeight,
      }, { align: "CENTER" }),
    );
  });

  if (droppedMilestones > 0) {
    requests.push(...noteBox(
      id("mdrop"), page,
      `Showing ${n} of ${milestones.length} milestones`,
      CANVAS.height - GRID.margin - 16
    ));
  }
  return requests;
}

/** Parse an ISO date to a UTC timestamp. UTC deliberately: these are calendar
 *  dates, and a local-midnight reading shifts them a day either side of the
 *  meridian, which would silently move a milestone on the chart. */
export function isoDate(s: string | undefined): number | null {
  if (!s) return null;
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(s.trim());
  if (!m) return null;
  const y = +m[1], mo = +m[2], d = +m[3];
  const t = Date.UTC(y, mo - 1, d);
  if (!Number.isFinite(t)) return null;
  // Date.UTC NORMALISES rather than rejects: "2026-13-05" becomes 5 Jan 2027
  // and "2026-02-30" becomes 2 March. Read it back — a date that does not
  // round-trip is not the date the text says, and plotting it puts a confident
  // wrong mark on an axis every other track is then scaled against.
  //
  // The prefix match stays unanchored on purpose, so "2026-08-19T10:30:00Z"
  // still parses; a model emits those.
  const back = new Date(t);
  if (back.getUTCFullYear() !== y || back.getUTCMonth() !== mo - 1 || back.getUTCDate() !== d) {
    return null;
  }
  return t;
}

const MONTHS = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];

/** The tick label's box, and the room one label needs to itself. */
const TICK_LABEL_WIDTH = 48;
const TICK_MIN_GAP = 56;
const AVG_MONTH = (365.2425 / 12) * 86400000;

/** Ticks across the range at the finest grain whose labels do not collide —
 *  months, then 2, 3 or 6 months, then years, then decades.
 *
 *  A fixed month grain was both unreadable AND incomplete on a long programme:
 *  a seven-year plan drew sixty labels five points apart in forty-eight point
 *  boxes, and then stopped, so everything past the fifth year had no axis at
 *  all. The grain is chosen from the space available instead. */
function monthTicks(
  min: number, max: number, plotW: number
): { t: number; label: string }[] {
  const out: { t: number; label: string }[] = [];
  const span = max - min;
  if (!(span > 0) || !(plotW > 0)) return out;

  const needMonths = (TICK_MIN_GAP / plotW) * (span / AVG_MONTH);
  const STEPS = [1, 2, 3, 6, 12, 24, 60, 120, 300, 600, 1200];
  let step = 0;
  for (let i = 0; i < STEPS.length; i++) {
    if (STEPS[i] >= needMonths) { step = STEPS[i]; break; }
  }
  if (!step) step = Math.ceil(needMonths / 12) * 12;

  // Walk an absolute month index snapped up to the step grid, so quarters land
  // on Jan/Apr/Jul/Oct and year steps land on Januaries.
  const start = new Date(min);
  let index = start.getUTCFullYear() * 12 + start.getUTCMonth();
  if (start.getUTCDate() !== 1) index += 1;
  index = Math.ceil(index / step) * step;

  for (let guard = 0; guard < 400; guard++) {
    const y = Math.floor(index / 12), mo = index % 12;
    const t = Date.UTC(y, mo, 1);
    if (t > max) break;
    if (t >= min) {
      // Year only in January (and on the first tick), so the axis does not
      // repeat "26" six times — and so "Jul 26" is never misread as a date.
      // At a year-or-coarser grain every label carries its year.
      const withYear = step >= 12 || mo === 0 || out.length === 0;
      out.push({ t, label: withYear ? `${MONTHS[mo]} ${y}` : MONTHS[mo] });
    }
    index += step;
  }
  // A range shorter than a month can produce no boundary at all. An axis with
  // no labels is a rule with no meaning, so fall back to naming its ends.
  if (out.length < 2) {
    const label = (t: number) => {
      const d = new Date(t);
      return `${d.getUTCDate()} ${MONTHS[d.getUTCMonth()]}`;
    };
    return [{ t: min, label: label(min) }, { t: max, label: label(max) }];
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
  let droppedPhases = 0;
  const parsed = tracks.map((tr) => {
    const items = tr.phases
      .map((ph) => {
        const s = isoDate(ph.start);
        // An end that was SUPPLIED but does not parse, or that falls before its
        // start, is not a phase that can be placed. Letting it fall through to
        // `end: null` drew it as a dot on its start date — claiming a
        // single-day milestone the input never described — and its stamp still
        // stretched the shared axis every other track is scaled against.
        const e = ph.end ? isoDate(ph.end) : null;
        if (s === null || (ph.end && (e === null || e < s))) { droppedPhases += 1; return null; }
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
  let noteReserve = droppedPhases > 0 ? 16 : 0;
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
          // Inside the bar the label sits on the TRACK's colour, so the colour
          // is measured against it. White was hard-coded and is 2.95:1 on the
          // coral track.
          it.inside ? { ...TYPE.phaseInBar, color: textOn(color) } : TYPE.phaseLabel,
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
  monthTicks(min, max, plotW).forEach((tick, i) => {
    requests.push(
      ...textBox(id(`tick${i}`), page, tick.label, TYPE.axisTick, {
        x: x(tick.t) - TICK_LABEL_WIDTH / 2, y: axisY + 5, width: TICK_LABEL_WIDTH,
        height: P.tickLabelHeight,
      }, { align: "CENTER" })
    );
  });

  const noteParts: string[] = [];
  if (droppedTracks > 0) noteParts.push(`${shown.length} of ${placedTracks.length} tracks`);
  if (droppedPhases > 0) {
    noteParts.push(`${droppedPhases} phase${droppedPhases === 1 ? "" : "s"} with unusable dates omitted`);
  }
  if (noteParts.length) {
    requests.push(...noteBox(
      id("pdrop"), page, `Showing ${noteParts.join(" · ")}`, axisY + 5 + P.tickLabelHeight
    ));
  }

  // "Today" rule last, so it sits above the bars.
  const now = new Date();
  const today = isoDate(todayIso) ??
    Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
  if (today > min && today < max) {
    const tx = x(today);
    requests.push(
      ...filledShape(id("today"), page, "RECTANGLE", COLOR.coralDeep, {
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
    ...creditRequests(id("credit"), page, img.credit, { x: GRID.margin, width: GRID.contentWidth }, true),
  ];
}

/** The photographer's line.
 *
 *  Its own helper because the split layout needs it too and did not have it:
 *  the resolver produced a credit for every Unsplash photograph and only the
 *  full-bleed path ever drew one, so half the stock pictures in a deck went out
 *  uncredited. textBox returns [] for an empty string, so owned, supplied and
 *  generated images still draw nothing. */
function creditRequests(
  objectId: string, page: string, credit: string | undefined,
  box: { x: number; width: number }, onDark: boolean
): Req[] {
  return textBox(objectId, page, credit, onDark ? TYPE.credit : TYPE.creditOnLight, {
    x: box.x, y: IMAGE.creditY, width: box.width, height: IMAGE.creditHeight,
  }, { align: "END" });
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
/** One number, as big as it can be drawn, centred on the ground. The crescendo
 *  slide is allowed to shout when it carries a single thing. */
function heroStat(
  page: string, id: (s: string) => string,
  stat: { value: string; label: string; detail?: string }
): Req[] {
  // Poppins runs ~0.62 of the point size per character; solve the size that
  // fills the content width, floored so a short value does not become absurd
  // and capped so a long one still fits with the box insets.
  const INSET = 20;
  const labelH = 26;
  const detailH = stat.detail ? 40 : 0;
  const LEAD = 1.5;   // one Poppins line's drawn height as a fraction of the size
  // Bounded by BOTH the content width AND the vertical band — a short value
  // ("0", "64 GW") would otherwise scale so large it ran off the bottom.
  const byWidth = (GRID.contentWidth - INSET) / (Math.max(stat.value.length, 1) * 0.62);
  const byHeight = (GRID.bandHeight - labelH - (detailH ? detailH + 8 : 0)) / LEAD;
  const size = Math.max(54, Math.min(150, Math.floor(Math.min(byWidth, byHeight))));
  const valueH = size * LEAD;
  const groupH = valueH + labelH + (detailH ? detailH + 8 : 0);
  const top = GRID.bodyY + Math.max(0, (GRID.bandHeight - groupH) / 2);
  const out: Req[] = [
    ...textBox(id("sv0"), page, stat.value, { ...TYPE.statValue, size }, {
      x: GRID.margin, y: top, width: GRID.contentWidth, height: valueH,
    }, { align: "CENTER" }),
    ...textBox(id("sl0"), page, stat.label, TYPE.statLabel, {
      x: GRID.margin, y: top + valueH, width: GRID.contentWidth, height: labelH,
    }, { align: "CENTER" }),
  ];
  if (stat.detail) {
    out.push(...textBox(id("sd0"), page, stat.detail, TYPE.statDetail, {
      x: GRID.margin, y: top + valueH + labelH + 8, width: GRID.contentWidth, height: detailH,
    }, { align: "CENTER" }));
  }
  return out;
}

function statRequests(
  page: string, id: (s: string) => string,
  stats: { value: string; label: string; detail?: string; primary?: boolean }[]
): Req[] {
  const shown = stats.filter(Boolean).slice(0, 3);
  if (!shown.length) return [];

  // A SINGLE stat is the moment the slide exists for — the fee, the headline
  // number — and it earns the whole canvas. statRequests used to size every
  // value to the longest string and cap at 54pt, so a lone "CHF 12,500" sat
  // small in a sea of navy. One stat is drawn big and centred.
  //
  // `primary` among several does NOT drop the others (that would lose data);
  // it tints that column so the eye lands on it. The single-stat hero is the
  // real fix for the ask slide the audit flagged.
  if (shown.length === 1) return heroStat(page, id, shown[0]);

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
    // The primary column keeps the others' size but takes the lime accent, so
    // one of three numbers reads as THE number without shrinking the rest.
    const thisValue = s.primary ? { ...valueStyle, color: COLOR.lime } : valueStyle;
    out.push(
      ...textBox(id(`sv${i}`), page, s.value, thisValue, {
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

/** Fit a heading into the room above the body, growing UPWARD and shrinking
 *  only when it must.
 *
 *  The title box was a fixed 45pt and the body began the instant it ended — no
 *  gap at all — and Slides does not shrink text to fit a box: it draws it and
 *  lets it run. So a three-line title was drawn straight through the first two
 *  lines of its own body, on a slide that looked fine in code and was
 *  unreadable in Drive. Nothing caught it, because the BOXES did not overlap;
 *  the ink did.
 *
 *  Upward, because the space between the eyebrow and the title is dead — 48pt
 *  of it — while everything below the title is spoken for by charts, plots and
 *  columns that are positioned from the grid. Growing up costs nothing and
 *  needs no layout to change. The font only shrinks when even that is not
 *  enough, and never below a size a room can read.
 */
const TITLE_GAP = 12;
const TITLE_MIN_SIZE = 14;

export function fitHeading(
  text: string | undefined,
  style: TypeStyle,
  width: number,
  opts: { bottom: number; minTop: number; minHeight: number; minSize?: number }
): { style: TypeStyle; y: number; height: number } {
  const floor = opts.minSize ?? TITLE_MIN_SIZE;
  const room = Math.max(opts.minHeight, opts.bottom - opts.minTop);
  let size = style.size;
  let need = drawnTextHeight(Math.max(1, estimateLines(text, width, size)), size);
  while (need > room && size > floor) {
    size -= 1;
    need = drawnTextHeight(Math.max(1, estimateLines(text, width, size)), size);
  }
  const height = Math.min(Math.max(need, opts.minHeight), room);
  return { style: size === style.size ? style : { ...style, size }, y: opts.bottom - height, height };
}

/** The layout to draw, from whatever the model actually said.
 *
 *  `LAYOUT_STYLE[slide.layout]` was read straight from the tool argument, so a
 *  name outside the enum returned undefined and the next line threw — taking
 *  out the WHOLE deck, not one slide, and surfacing as "Google Slides creation
 *  failed" for a call that never reached Google. The aliases are the sibling
 *  .pptx tool's enum, which the model sees in the same turn and reaches for. */
const LAYOUT_ALIASES: Record<string, SlideLayout> = {
  title: "cover", blank: "content", bullets: "content", text: "content",
  image: "feature", photo: "feature", chart: "bar-chart", divider: "section",
  agenda: "content", "thank-you": "closing", end: "closing",
};

export function layoutOf(raw: string | undefined, index: number): SlideLayout {
  if (raw && Object.prototype.hasOwnProperty.call(LAYOUT_STYLE, raw)) return raw as SlideLayout;
  return LAYOUT_ALIASES[(raw || "").toLowerCase()] ?? (index === 0 ? "cover" : "content");
}

/** A deliberately generous estimate of how many lines a string takes in a box,
 *  and how far down the box its last line reaches.
 *
 *  Generous because the consequence of under-estimating is text running off the
 *  slide, and the consequence of over-estimating is a little white space. Slides
 *  does not reflow or shrink to fit — it draws and lets it run — so nothing
 *  downstream corrects a bad guess.
 *
 *  Exported so the layout check measures with the same primitive the layout
 *  does; two estimators would drift and the check would stop meaning anything. */
export const TEXT_INSET_X = SLIDES_TEXT_INSET.x * 2;
export const TEXT_INSET_Y = SLIDES_TEXT_INSET.y * 2;
const PER_CHAR = 0.55;              // widest average advance across the deck's faces
const LINE_LEAD = 1.45;             // 115% paragraph spacing on a ~1.26em face

export function estimateLines(
  text: string | undefined, boxWidth: number, size: number, bullets = false
): number {
  const s = (text ?? "").trim();
  if (!s) return 0;
  const usable = Math.max(size, boxWidth - TEXT_INSET_X - (bullets ? BULLET_INDENT : 0));
  const perLine = Math.max(1, Math.floor(usable / (size * PER_CHAR)));
  const paras = s.split("\n");
  let lines = 0;
  for (let i = 0; i < paras.length; i++) {
    lines += Math.max(1, Math.ceil(paras[i].trim().length / perLine));
  }
  return lines;
}

/** Where the last line's ink lands, measured from the top of the box.
 *
 *  `paragraphs` is separate from `lines` because Slides' 6pt spaceBelow falls
 *  between PARAGRAPHS, not between wrapped lines — counting it per line
 *  over-estimated a wrapping body by a third and split slides that fitted. */
export function drawnTextHeight(
  lines: number, size: number, spaceBelow = 0, paragraphs = 1
): number {
  if (lines <= 0) return 0;
  return TEXT_INSET_Y + lines * size * LINE_LEAD + Math.max(0, paragraphs - 1) * spaceBelow;
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
/** Legend row plus the source line under a stacked plot. A second legend row is
 *  reserved unconditionally: whether the names wrap is not known until they are
 *  laid out, and a budget that assumes they will not is how the legend left the
 *  slide in the first place. */
const LEGEND_ROWS = 2;
const LEGEND_ROW_HEIGHT = 16;
const STACK_TAIL = 42 + LEGEND_ROW_HEIGHT;

function fitRows(
  total: number, cap: number, baseBarH: number, baseGap: number, tailBlock: number,
  bandTop: number = GRID.bodyY
): { count: number; rowH: number; barH: number } {
  const room = CANVAS.height - GRID.margin - bandTop - tailBlock;
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
/** Wide enough for its own text, so a two-clause note is not clipped by a
 *  fixed slot. Right-aligned to the content edge, so growing it grows leftwards
 *  and it can never leave the canvas. */
function noteWidth(text: string): number {
  if (!text) return 0;
  const measured = Math.ceil(text.length * TYPE.chartAxis.size * 0.55 + 15);
  return Math.min(GRID.contentWidth - 140, Math.max(NOTE_WIDTH, measured));
}

function noteBox(objectId: string, page: string, text: string, y: number): Req[] {
  if (!text) return [];
  const w = noteWidth(text);
  return textBox(objectId, page, text, TYPE.chartAxis, {
    x: GRID.margin + GRID.contentWidth - w, y, width: w, height: 16,
  }, { align: "END" });
}

function clip(s: string, n: number): string {
  return s.length <= n ? s : `${s.slice(0, n - 1)}…`;
}

/** What a bar chart is NOT showing, in one line.
 *
 *  Both clauses matter and neither was said. Truncation to the top eight was
 *  silent, and a second series was discarded entirely — this layout draws one
 *  series by design, and a model that sends two got a slide that looked like
 *  the whole picture. */
export function barChartNote(
  chart: NonNullable<SlideInput["chart"]>, total: number, drawn: number
): string {
  const parts: string[] = [];
  const supplied = chart.series?.length || 0;
  if (supplied > 1) {
    parts.push(`“${clip(chart.series?.[0]?.name || "the first series", 18)}” of ${supplied} series`);
  }
  if (total > drawn) parts.push(`${supplied > 1 ? "" : "the "}top ${drawn} of ${total}`);
  return parts.length ? `Showing ${parts.join(" · ")}` : "";
}

/** A line chart: change over time. The one device the bar layouts cannot give,
 *  because a trend is a shape, not a set of lengths.
 *
 *  Points are spaced evenly by INDEX across the plot, not by date — the points
 *  carry free-text x labels ("Jan", "Q1", "2024"), and spacing them by a parsed
 *  date would break the moment a label is not a date. Y is scaled from the data
 *  (padded, and including zero when the range is close to it, so a line does not
 *  float in a misleading crop). Up to three series, each its own colour with a
 *  legend; segments are rotated rectangles because Slides has no polyline.
 */
function lineChartRequests(
  page: string, id: (s: string) => string,
  chart: NonNullable<SlideInput["chart"]>, onDark: boolean, bandTop: number = GRID.bodyY
): Req[] {
  const series = (chart.series || []).filter((sx) => sx.points?.length).slice(0, 3);
  if (!series.length) return [];
  const palette = onDark ? SERIES_DARK : SERIES_LIGHT;
  const axisColor = onDark ? COLOR.periwinkle : COLOR.greyLight;

  // X labels come from the FIRST series; a shorter series simply stops early.
  const labels = series[0].points.map((p) => p.label);
  const n = labels.length;
  if (n < 2) return [];   // a single point is not a line

  const allValues = series.flatMap((sx) => sx.points.map((p) => p.value));
  const bench = chart.benchmark && Number.isFinite(chart.benchmark.value) ? chart.benchmark : null;
  if (bench) allValues.push(bench.value);
  let lo = Math.min(...allValues);
  let hi = Math.max(...allValues);
  // Include zero when the data sits near it, so the line is not floated on a
  // cropped axis that exaggerates the slope.
  if (lo > 0 && lo < hi * 0.5) lo = 0;
  if (hi < 0 && hi > lo * 0.5) hi = 0;
  const pad = (hi - lo) * 0.08 || 1;
  lo -= pad; hi += pad;
  const span = hi - lo || 1;

  const legendH = series.length > 1 ? 20 : 0;
  const plotX = GRID.margin + 34;                       // room for y at the left
  const plotW = GRID.contentWidth - 34;
  const bandBottom = CANVAS.height - GRID.margin;
  const plotTop = bandTop + 6;
  const plotBottom = bandBottom - 18 - legendH;         // room for x labels + legend
  const plotH = Math.max(40, plotBottom - plotTop);

  const xAt = (i: number) => plotX + (n === 1 ? 0 : (i / (n - 1)) * plotW);
  const yAt = (v: number) => plotBottom - ((v - lo) / span) * plotH;

  const out: Req[] = [];

  // A faint baseline/axis along the bottom.
  out.push(...filledShape(id("laxis"), page, "RECTANGLE", axisColor, {
    x: plotX, y: plotBottom, width: plotW, height: CHART.axisThickness,
  }));

  // The benchmark, if any — a reference rule across the plot.
  if (bench) {
    out.push(...filledShape(id("lbmk"), page, "RECTANGLE", COLOR.coralDeep, {
      x: plotX, y: yAt(bench.value), width: plotW, height: 1.2,
    }));
    if (bench.label?.trim()) {
      out.push(...textBox(id("lbml"), page, bench.label, TYPE.benchmarkLabel, {
        x: plotX, y: yAt(bench.value) - 12, width: 150, height: 12,
      }));
    }
  }

  // X labels under the axis.
  labels.forEach((lab, i) => {
    out.push(...textBox(id(`lx${i}`), page, lab, TYPE.axisTick, {
      x: xAt(i) - 24, y: plotBottom + 4, width: 48, height: 14,
    }, { align: "CENTER" }));
  });

  // Each series: segments, then dots on top, then endpoint value labels.
  series.forEach((sx, si) => {
    const color = palette[si % palette.length];
    const pts = sx.points.slice(0, n);
    for (let i = 0; i < pts.length - 1; i++) {
      out.push(...segment(id(`ls${si}_${i}`), page, color,
        xAt(i), yAt(pts[i].value), xAt(i + 1), yAt(pts[i + 1].value), 2.4));
    }
    pts.forEach((p, i) => {
      const focus = typeof chart.highlight === "number" && chart.highlight === i;
      const r = focus ? 5 : 3.5;
      out.push(...filledShape(id(`ld${si}_${i}`), page, "ELLIPSE", color, {
        x: xAt(i) - r, y: yAt(p.value) - r, width: r * 2, height: r * 2,
      }));
    });
    // Label the LAST point (and the highlighted one) — not every point, which
    // would be a wall of numbers.
    const lastI = pts.length - 1;
    const labelAt = (i: number) => {
      const p = pts[i];
      const above = i === 0 || p.value >= pts[i - 1].value;
      out.push(...textBox(id(`lv${si}_${i}`), page, formatValue(p.value),
        { ...TYPE.chartValue, color: onDark ? COLOR.white : COLOR.navy }, {
          x: Math.min(xAt(i) - 20, GRID.margin + GRID.contentWidth - 44),
          y: above ? yAt(p.value) - 18 : yAt(p.value) + 6, width: 44, height: 14,
        }, { align: i === lastI ? "END" : "CENTER" }));
    };
    labelAt(lastI);
    if (typeof chart.highlight === "number" && chart.highlight !== lastI && chart.highlight < pts.length) {
      labelAt(chart.highlight);
    }
  });

  // Legend for multiple series.
  if (series.length > 1) {
    let lx = plotX;
    const ly = plotBottom + 20;
    series.forEach((sx, si) => {
      const w = Math.min(120, Math.max(34, (sx.name || "").length * 4.6 + 16));
      out.push(
        ...filledShape(id(`lk${si}`), page, "RECTANGLE", palette[si % palette.length], {
          x: lx, y: ly + 3, width: 10, height: 3,
        }),
        ...textBox(id(`ln${si}`), page, sx.name, TYPE.chartAxis, {
          x: lx + 14, y: ly, width: w, height: 14,
        }),
      );
      lx += 14 + w + 10;
    });
  }

  out.push(...textBox(id("lsrc"), page, chart.source, TYPE.chartAxis, {
    x: GRID.margin, y: CANVAS.height - GRID.margin - 2, width: GRID.contentWidth, height: 14,
  }));
  return out;
}

/** Horizontal bars, sorted, with the value printed at the end of each.
 *
 *  Horizontal because category names are words, and words fit beside a bar but
 *  not under one. Sorted because the ranking IS the message; input order makes
 *  the reader do the sorting. Values printed directly, so no axis scale is
 *  needed and the gridlines that would carry it can go — ink belongs to data. */
function barChartRequests(
  page: string, id: (s: string) => string,
  chart: NonNullable<SlideInput["chart"]>, onDark: boolean, bandTop: number = GRID.bodyY
): Req[] {
  const series = chart.series?.[0];
  if (!series?.points?.length) return [];
  const palette = onDark ? SERIES_DARK : SERIES_LIGHT;
  // Carry each point's ORIGINAL index through the sort. The object id has to
  // name the point in the spec, not its rank on the slide — otherwise editing
  // "Bar 1" edits whichever row happened to be first in the input, and any deck
  // whose data was not already sorted gets the wrong bar changed.
  // A TIME SERIES keeps its order — sorting a monthly trend by value scrambles
  // the line the chart exists to show. A ranking sorts, and carries each
  // point's ORIGINAL index through the sort so the object id names the point in
  // the spec, not its rank on the slide (editing "Bar 1" must not move a row).
  const indexed = series.points.map((p, orig) => ({ ...p, orig }));
  const ranked = chart.sequence ? indexed : indexed.slice().sort((a, b) => b.value - a.value);

  // The source line is part of the block, so it has to be inside the budget.
  // It was not: eight bars pushed it to y=397 on a 405pt canvas, where the
  // attribution for the numbers simply did not exist in the built deck.
  const fit = fitRows(ranked.length, MAX_BARS, CHART.barHeight, CHART.barGap, SOURCE_BLOCK, bandTop);
  // A ranking truncated to the top N drops the SMALLEST; a sequence truncated
  // from the front would drop the earliest months and lie about where the line
  // starts, so a sequence keeps its most recent points instead.
  const points = chart.sequence ? ranked.slice(-fit.count) : ranked.slice(0, fit.count);

  // A zero BASELINE, not an absolute-value scale. Drawing |value| made a -100
  // the longest bar on a slide whose whole message is the ranking — the reader
  // saw the biggest bar against the worst number. With a baseline, a negative
  // bar runs left from zero and reads as the loss it is.
  const bench = chart.benchmark && Number.isFinite(chart.benchmark.value) ? chart.benchmark : null;
  const lo = Math.min(0, ...points.map((p) => p.value), bench ? bench.value : 0);
  const hi = Math.max(0, ...points.map((p) => p.value), bench ? bench.value : 0);
  const span = hi - lo || 1;

  const plotX = GRID.margin + CHART.labelGutter;
  const plotW = GRID.contentWidth - CHART.labelGutter - 52;
  const at = (v: number) => plotX + ((v - lo) / span) * plotW;
  const out: Req[] = [];
  // Same treatment as the stats: five bars centre in the band, eight fill it.
  const bandH = GRID.bodyY + GRID.bandHeight - bandTop;
  const plotTop = bandTop +
    Math.max(0, (bandH - (points.length * fit.rowH + SOURCE_BLOCK)) / 2);

  // A highlighted bar is the whole point of the slide: it is drawn in the
  // accent and every other bar is muted to a neutral, so the eye lands on the
  // one that carries the argument instead of reading six equal blues. With no
  // highlight the chart is uniform, as before.
  const hasFocus = typeof chart.highlight === "number" &&
    chart.highlight >= 0 && chart.highlight < series.points.length;
  const muted = onDark ? COLOR.periwinkle : COLOR.greyLight;
  const focusFill = onDark ? COLOR.tealSoft : COLOR.blue;

  points.forEach((p, i) => {
    const y = plotTop + i * fit.rowH;
    const x0 = at(Math.min(p.value, 0));
    const w = Math.max(2, Math.abs(at(p.value) - at(0)));
    const isFocus = hasFocus && p.orig === chart.highlight;
    const barFill = hasFocus ? (isFocus ? focusFill : muted) : palette[0];
    const labelStyle = isFocus ? { ...TYPE.chartValue, color: onDark ? COLOR.tealSoft : COLOR.blue } : TYPE.chartValue;
    out.push(
      ...textBox(id(`bl${p.orig}`), page, p.label, TYPE.chartCategory, {
        x: GRID.margin, y: y + 4, width: CHART.labelGutter - 10, height: fit.barH,
      }),
      ...filledShape(id(`bb${p.orig}`), page, "RECTANGLE", barFill, {
        x: x0, y, width: w, height: fit.barH,
      }),
      // The value goes just past the bar's right-hand end, for a negative bar
      // as much as a positive one. Putting it at the far end of a negative bar
      // would drive it into the category name in the left gutter, and the minus
      // sign already says which way the bar runs.
      ...textBox(id(`bv${p.orig}`), page, formatValue(p.value), labelStyle, {
        x: x0 + w + CHART.valueGap, y: y + 4, width: 60, height: fit.barH,
      }),
    );
  });

  // A benchmark: a vertical rule across the whole plot at its value, with a
  // small caps label above it, so every bar reads as above or below the target.
  // Drawn in the deep coral so it is plainly a REFERENCE, not one of the bars.
  if (bench) {
    const bx = at(bench.value);
    const plotBottom = plotTop + points.length * fit.rowH;
    out.push(...filledShape(id("bmk"), page, "RECTANGLE", COLOR.coralDeep, {
      x: bx, y: plotTop - 10, width: 1.4, height: plotBottom - plotTop + 10,
    }));
    if (bench.label?.trim()) {
      // The label sits above the rule, clamped so it cannot leave the canvas on
      // either side — the plot's right edge is where a naive placement overran.
      const lw = Math.min(150, Math.max(40, bench.label.length * 4.4 + 10));
      const lx = Math.min(GRID.margin + GRID.contentWidth - lw, Math.max(GRID.margin, bx - lw / 2));
      out.push(...textBox(id("bml"), page, bench.label, TYPE.benchmarkLabel, {
        x: lx, y: plotTop - 22, width: lw, height: 14,
      }, { align: bx - lw / 2 < GRID.margin ? "START" : "CENTER" }));
    }
  }

  // A zero rule, only when the data crosses it — otherwise the left edge of the
  // plot IS zero and a line there is redundant ink.
  if (lo < 0) {
    out.push(...filledShape(id("bzero"), page, "RECTANGLE", onDark ? COLOR.periwinkle : COLOR.greyLight, {
      x: at(0), y: plotTop - 4, width: CHART.axisThickness,
      height: points.length * fit.rowH + 4,
    }));
  }

  const srcY = plotTop + points.length * fit.rowH + 8;
  const note = barChartNote(chart, ranked.length, points.length);
  out.push(...textBox(id("csrc"), page, chart.source, TYPE.chartAxis, {
    x: GRID.margin, y: srcY,
    width: GRID.contentWidth - (note ? noteWidth(note) : 0), height: 16,
  }));
  out.push(...noteBox(id("cdrop"), page, note, srcY));

  // A callout: one short line explaining a single bar, drawn to the RIGHT of
  // that bar's value in the deep coral, clamped to the canvas. Only when the
  // bar is actually on the slide (a callout on a truncated bar has nowhere to
  // point). The audit's warning was that a naive placement after the longest
  // value box ran off at 711pt; this clamps the width to the room that is left
  // and skips the callout, with a note, when there is too little.
  if (chart.callout && typeof chart.callout.point === "number" && chart.callout.text?.trim()) {
    const idx = points.findIndex((p) => p.orig === chart.callout!.point);
    if (idx >= 0) {
      const p = points[idx];
      const y = plotTop + idx * fit.rowH;
      const valueEnd = at(p.value) + CHART.valueGap + 44;   // past the value box
      const rightEdge = GRID.margin + GRID.contentWidth;
      const room = rightEdge - valueEnd;
      if (room >= 60) {
        out.push(...textBox(id("cnote"), page, chart.callout.text, TYPE.calloutText, {
          x: valueEnd, y: y + 3, width: room, height: fit.barH,
        }));
      } else {
        // No room beside the bar — the finding still gets said, on the source
        // line's own slot, rather than silently dropped.
        out.push(...noteBox(id("cnote"), page, chart.callout.text, srcY + 18));
      }
    }
  }
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
  chart: NonNullable<SlideInput["chart"]>, onDark: boolean, bandTop: number = GRID.bodyY
): Req[] {
  const supplied = (chart.series || []).filter((s) => s.points?.length);
  if (!supplied.length) return [];
  const palette = onDark ? SERIES_DARK : SERIES_LIGHT;

  // A stacked bar cannot draw a negative part — there is no direction for it to
  // go — so negatives leave the DRAWING and the TOTAL alike, and are counted so
  // the slide can say so. Counting them in the total while skipping them in the
  // drawing was worse than either: the printed total contradicted the bar
  // beside it, and because the scale came from those totals a single negative
  // could push a bar clean off the right-hand edge of the slide.
  let negatives = 0;
  const valuesOf = (list: typeof supplied) => {
    const m = new Map<string, number>();
    for (let i = 0; i < list.length; i++) {
      const pts = list[i].points || [];
      for (let j = 0; j < pts.length; j++) {
        if (pts[j].value < 0) { negatives += 1; continue; }
        // Duplicate labels SUM. `find` returned the first and lost the rest, so
        // [{Other,10},{Other,15}] drew 10 twice and printed a total short by 15.
        m.set(pts[j].label, (m.get(pts[j].label) || 0) + pts[j].value);
      }
    }
    return m;
  };

  // Five colours in the palette, and `palette[si % length]` would paint a sixth
  // part in the FIRST part's blue. Dropping the sixth instead left a printed
  // total that excluded it — a wrong number on the slide, not just a missing
  // one. So the remainder is grouped, which is coarser but true.
  const MAX_PARTS = palette.length;
  const folded = Math.max(0, supplied.length - MAX_PARTS);
  const parts: { name: string; values: Map<string, number> }[] = [];
  for (let i = 0; i < Math.min(supplied.length, MAX_PARTS); i++) {
    parts.push({ name: supplied[i].name, values: valuesOf([supplied[i]]) });
  }
  if (folded > 0) parts.push({ name: "Other", values: valuesOf(supplied.slice(MAX_PARTS)) });
  const series = parts;
  // "Other" is not a series, so it does not take a series colour.
  const fillFor = (si: number) => (si < MAX_PARTS ? palette[si] : (onDark ? COLOR.greyLight : COLOR.ink));

  // Categories are the UNION of every part's labels, in first-appearance order.
  // Taking them from the first series alone dropped any category the first
  // series happened not to carry — silently, and from the totals as well.
  // Derived from the aggregation rather than a second pass over the raw points,
  // so a label carried only by negative values cannot enter as an empty row.
  const union = new Map<string, number>();
  for (let i = 0; i < series.length; i++) {
    const keys = Array.from(series[i].values.keys());
    for (let j = 0; j < keys.length; j++) union.set(keys[j], 1);
  }
  const allCategories = Array.from(union.keys());
  // The legend and the source line sit under the plot, so both are inside the
  // budget the rows have to fit. There was no budget at all before: ten
  // categories put two rows and the whole legend off the bottom of the slide.
  const fit = fitRows(allCategories.length, MAX_BARS, CHART.barHeight, CHART.barGap, STACK_TAIL, bandTop);
  const categories = allCategories.slice(0, fit.count);

  const partOf = (cat: string, s: (typeof series)[number]) => s.values.get(cat) ?? 0;
  const totals = categories.map((c) => series.reduce((sum, s) => sum + partOf(c, s), 0));
  const max = Math.max(...totals) || 1;

  const plotX = GRID.margin + CHART.labelGutter;
  const plotW = GRID.contentWidth - CHART.labelGutter - 52;
  const rowH = fit.rowH;
  const bandH = GRID.bodyY + GRID.bandHeight - bandTop;
  const plotTop = bandTop +
    Math.max(0, (bandH - (categories.length * rowH + STACK_TAIL)) / 2);
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
      out.push(...filledShape(id(`kb${ci}_${si}`), page, "RECTANGLE", fillFor(si), {
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
  //
  // It WRAPS. Five series with ordinary names — "Sponsored articles",
  // "Infographics and charts" — ran the last entries off the right-hand edge of
  // the slide, because the row only ever advanced and never asked whether the
  // next entry still fit.
  const legendRight = GRID.margin + GRID.contentWidth;
  const legendTop = plotTop + categories.length * rowH + 6;
  let lx = GRID.margin;
  let legendRow = 0;
  series.forEach((s, si) => {
    // The label's box and the advance to the next entry are the SAME width.
    // Giving every label a fixed 110pt box while advancing by its text width
    // overlapped each legend entry with the one after it.
    // Sized with the text-box insets included. Without them a nine-character
    // series name wrapped to two lines inside a box one line tall, and the
    // second line landed on the source attribution underneath.
    const labelW = Math.min(
      132, Math.max(34, Math.ceil(s.name.length * TYPE.chartAxis.size * 0.55) + TEXT_INSET_X)
    );
    if (lx + 13 + labelW > legendRight && lx > GRID.margin && legendRow < LEGEND_ROWS - 1) {
      legendRow += 1;
      lx = GRID.margin;
    }
    const ly = legendTop + legendRow * LEGEND_ROW_HEIGHT;
    out.push(
      ...filledShape(id(`kk${si}`), page, "RECTANGLE", fillFor(si), {
        x: lx, y: ly + 4, width: 9, height: 9,
      }),
      ...textBox(id(`kn${si}`), page, s.name, TYPE.chartAxis, {
        x: lx + 13, y: ly, width: Math.min(labelW, Math.max(28, legendRight - lx - 13)), height: 16,
      }),
    );
    lx += 13 + labelW + 12;
  });
  const legendY = legendTop + legendRow * LEGEND_ROW_HEIGHT;

  const srcY = legendY + 20;
  const note = stackedNote(allCategories.length, categories.length, supplied.length, folded, negatives);
  out.push(...textBox(id("ksrc"), page, chart.source, TYPE.chartAxis, {
    x: GRID.margin, y: srcY, width: GRID.contentWidth - (note ? noteWidth(note) : 0), height: 16,
  }));
  out.push(...noteBox(id("kdrop"), page, note, srcY));
  return out;
}

/** What a stacked bar is not showing, in one line and in priority order —
 *  a dropped category first, then a folded part, then a negative. Only the
 *  first that applies is said: the slot is one line, and three clauses read as
 *  a disclaimer rather than a fact. */
export function stackedNote(
  categories: number, drawn: number, suppliedParts: number, folded: number, negatives: number
): string {
  if (categories > drawn) return `Showing the top ${drawn} of ${categories}`;
  if (folded > 0) return `Showing ${suppliedParts - folded} of ${suppliedParts} parts, rest as “Other”`;
  if (negatives > 0) return "Negative values not shown";
  return "";
}

/** Does this slide show the reader something other than words?
 *
 *  Read by the audit that tells the model how visual a deck is, so a miscount
 *  is not cosmetic: cards, logo walls, process diagrams and quotes were all
 *  counted as prose, so a deck that was five-sixths visual was reported as
 *  "ONLY 1 of 6 (17%)" and the model dutifully told the user it was flat and
 *  offered to fix slides that were already fine. */
export function isVisualSlide(slide: SlideInput | undefined): boolean {
  if (!slide) return false;
  const cards = slide.cards || [];
  const logos = slide.logos || [];
  return Boolean(
    slide.resolvedImage ||
    (slide.resolvedImages && slide.resolvedImages.length) ||
    slide.chart ||
    (slide.stats && slide.stats.length) ||
    (slide.milestones && slide.milestones.length) ||
    (slide.tracks && slide.tracks.length) ||
    // The process layout draws its chevrons from the stages alone, and a quote
    // is a designed slide on navy whether or not it carries a portrait.
    (slide.stages && slide.stages.length) ||
    slide.quote ||
    cards.some((c) => (c.resolvedImage && c.resolvedImage.url) || c.resolvedIcon || c.marker) ||
    logos.some((l) => l.resolvedUrl || l.name)
  );
}

/** What the deck could not do, in a sentence the model can relay.
 *
 *  The slide says it too — a truncated chart carries its own note — but the
 *  model is the one having the conversation, and a user who is told "four of
 *  your six pictures could not be found" can supply them. Silence here meant
 *  the model described a deck that was quietly missing things. */
export function deckWarnings(slides: SlideInput[]): string {
  const notes: string[] = [];
  for (let i = 0; i < slides.length; i++) {
    const s = slides[i];
    const n = i + 1;
    if (s.layoutAsked) notes.push(`slide ${n} asked for layout "${s.layoutAsked}", drawn as "${s.layout}"`);
    if (s.imageUnavailable) notes.push(`slide ${n} has no photograph — ${s.imageError || "none could be found"}`);
    if (s.imagesDropped) {
      const asked = (s.images || []).length;
      notes.push(`slide ${n} shows ${asked - s.imagesDropped} of ${asked} thumbnails; the rest could not be found`);
    }
  }
  if (!notes.length) return "";
  return ` TELL THE USER, briefly and without apologising: ${notes.join("; ")}.`;
}

/** Where a prose slide's picture goes: down the right, bleeding to the right
 *  and bottom edges.
 *
 *  A content slide with an `image.query` resolved a photograph, cropped it,
 *  baked a gradient into it and uploaded it to Blob — and then drew nothing,
 *  because only the full-bleed layouts call backdropRequests. The picture was
 *  paid for and discarded, AND isVisualSlide counted the slide as visual on the
 *  strength of it, so the audit reported a deck as illustrated when every slide
 *  was text. */
export function railBox(
  slide: SlideInput
): { url: string; x: number; y: number; width: number; height: number } | null {
  const url = slide.resolvedImage?.url;
  const layout = slide.layout;
  if (!url || (layout !== "content" && layout !== "case-study")) return null;
  const x = GRID.margin + GRID.proseNarrow + IMAGE.railGap;
  return { url, x, y: GRID.bodyY, width: CANVAS.width - x, height: CANVAS.height - GRID.bodyY };
}

/** The rule under a title: a short accent segment, then a hairline. */
function ruleRequests(
  objectId: string, page: string, y: number, width: number, onDark: boolean
): Req[] {
  const accent = onDark ? COLOR.tealSoft : COLOR.blue;
  const hair = onDark ? COLOR.greyLight : COLOR.navy;
  return [
    ...filledShape(`${objectId}a`, page, "RECTANGLE", accent, {
      x: GRID.margin, y, width: RULE.accentWidth, height: RULE.thickness,
    }),
    ...filledShape(`${objectId}b`, page, "RECTANGLE", hair, {
      x: GRID.margin + RULE.accentWidth, y: y + (RULE.thickness - RULE.hairlineThickness) / 2,
      width: Math.max(0, width - RULE.accentWidth), height: RULE.hairlineThickness,
    }, RULE.hairlineAlpha),
  ];
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
  const shown = cards.filter(Boolean).slice(0, 6);
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
      // + the 14.4pt Slides insets, which the old formula did not allow for, so
      // "01" in a 26pt chip wrapped onto a second line and ran into the heading.
      const chipW = Math.min(
        innerW,
        Math.max(34, Math.ceil(card.marker.length * TYPE.cardMarker.size * 0.6) + TEXT_INSET_X + 10)
      );
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
  // A quote is set to FIT rather than split or overflow.
  //
  // Splitting is wrong here — half a testimonial on each of two slides is not
  // two slides — and overflowing runs the last line straight through the
  // speaker's name, which is the one thing on the slide that has to stay
  // legible. So the type comes down instead, and only as far as it must: a
  // 180-character quote is untouched at 22pt.
  const textWidth = q.resolvedImage ? QUOTE.textWidth - 2.1 * 72 : QUOTE.textWidth;
  const CHAR_RATIO = 0.5;   // Playfair's average glyph, as a fraction of its size
  const LINE = 1.15;
  let quoteSize = TYPE.quoteText.size;
  while (quoteSize > 13) {
    const perLine = Math.max(12, Math.floor(textWidth / (quoteSize * CHAR_RATIO)));
    const lines = Math.ceil((q.text?.length || 0) / perLine);
    if (lines * quoteSize * LINE <= QUOTE.textHeight) break;
    quoteSize -= 1;
  }

  const out: Req[] = [
    ...textBox(id("qm"), page, "“", TYPE.quoteMark, {
      x: QUOTE.markX, y: QUOTE.markY, width: QUOTE.markWidth, height: QUOTE.markHeight,
    }),
    ...textBox(id("qt"), page, q.text, { ...TYPE.quoteText, size: quoteSize }, {
      x: QUOTE.textX, y: QUOTE.textY,
      width: textWidth,
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
/** Five stages fill the width; a sixth would be a 100pt box with a two-word
 *  caption. Bounded, and said out loud rather than quietly trimmed. */
const MAX_STAGES = 5;

function processRequests(
  page: string, id: (s: string) => string, stages: NonNullable<SlideInput["stages"]>
): Req[] {
  const shown = stages.filter(Boolean).slice(0, MAX_STAGES);
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

  if (stages.length > shown.length) {
    out.push(...noteBox(
      id("sdrop"), page, `Showing the first ${shown.length} of ${stages.length} stages`,
      CANVAS.height - GRID.margin - 16
    ));
  }
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
  const shown = logos.filter((l) => l && (l.resolvedUrl || l.name?.trim())).slice(0, 12);
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
  const layout: SlideLayout = layoutOf(slide.layout, index);
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

  // Photograph first, so every text box lands on top of it. A section divider
  // is photo-led when it has a picture (the prompt asks for one) and falls back
  // to the flat blue ground when it does not — the image used to be resolved,
  // and paid for, then never drawn.
  const sectionPhoto = layout === "section" && !!slide.resolvedImage;
  if (style.background === null || layout === "feature" || sectionPhoto) {
    requests.push(...backdropRequests(page, id, slide));
  }

  const onDark = style.onDark;
  const bodyStyle = onDark ? TYPE.bodyDark : TYPE.body;
  const eyebrowStyle = onDark ? TYPE.eyebrowDark : TYPE.eyebrow;

  // The heading, fitted to the room it actually has. Every layout below draws
  // its title from THIS, not from the grid constants, so a long title can never
  // again be drawn through the body underneath it.
  // Prose layouts set their title on the same measure as their body, so the
  // two align and the heading is fitted to the width it will actually occupy.
  const isProse = layout === "content" || layout === "case-study" || layout === "dark-index";
  const proseColumn = isProse
    ? (railBox(slide) ? GRID.proseNarrow : GRID.proseWidth)
    : GRID.contentWidth;
  const titleWidth = layout === "image-split" ? IMAGE.splitTextWidth : proseColumn;
  const heading = fitHeading(slide.title, onDark ? TYPE.slideTitleDark : TYPE.slideTitle, titleWidth, {
    bottom: GRID.bodyY - TITLE_GAP,
    minTop: GRID.eyebrowY + GRID.eyebrowHeight + 6,
    minHeight: GRID.titleHeight,
  });
  const titleStyle = heading.style;
  const titleBox = { y: heading.y, height: heading.height };

  if (layout === "cover") {
    if (!slide.resolvedImage) {
      // A COVER WITH NO PHOTOGRAPH used to be a plain navy slide with a title in
      // the corner — the dullest possible opening. Designed instead: an accent
      // rule, a centred title, the kicker beneath, on navy. The photo cover is
      // still the default (the prompt asks for an image.query), but the deck no
      // longer opens on nothing when there is not one.
      const np = fitHeading(slide.title, TYPE.coverTitle, GRID.contentWidth, {
        bottom: CANVAS.height / 2 + 20, minTop: CANVAS.height * 0.24,
        minHeight: GRID.coverTitleHeight, minSize: 22,
      });
      requests.push(
        ...filledShape(id("crule"), page, "RECTANGLE", COLOR.lime, {
          x: (CANVAS.width - RULE.accentWidth) / 2, y: np.y - 22, width: RULE.accentWidth, height: RULE.thickness,
        }),
        ...textBox(id("title"), page, slide.title, np.style, {
          x: GRID.margin, y: np.y, width: GRID.contentWidth, height: np.height,
        }, { align: "CENTER" }),
        ...textBox(id("sub"), page, slide.subtitle, TYPE.closingKicker, {
          x: GRID.margin, y: np.y + np.height + 12, width: GRID.contentWidth, height: 28,
        }, { align: "CENTER" }),
      );
    } else {
      // Bottom-anchored over the photo: the kicker sits under it and a three-line
      // title used to be drawn straight over it.
      const cover = fitHeading(slide.title, TYPE.coverTitle, GRID.coverTitleWidth, {
        bottom: GRID.coverKickerY - 10,
        minTop: CANVAS.height * 0.3,
        minHeight: GRID.coverTitleHeight,
        minSize: 20,
      });
      requests.push(
        ...textBox(id("title"), page, slide.title, cover.style, {
          x: GRID.coverTitleX, y: cover.y,
          width: GRID.coverTitleWidth, height: cover.height,
        }),
        ...textBox(id("sub"), page, slide.subtitle, TYPE.coverKicker, {
          x: GRID.coverKickerX, y: GRID.coverKickerY,
          width: GRID.coverKickerWidth, height: GRID.coverKickerHeight,
        }),
      );
    }
  } else if (layout === "closing") {
    const closing = fitHeading(slide.title, TYPE.coverTitle, GRID.contentWidth, {
      bottom: GRID.closingSubtitleY - 10,
      minTop: GRID.eyebrowY + GRID.eyebrowHeight + 6,
      minHeight: GRID.closingTitleHeight,
      minSize: 20,
    });
    requests.push(
      ...textBox(id("title"), page, slide.title, closing.style, {
        x: GRID.margin, y: closing.y,
        width: GRID.contentWidth, height: closing.height,
      }, { align: "CENTER" }),
      ...textBox(id("sub"), page, slide.subtitle, TYPE.closingKicker, {
        x: GRID.margin, y: GRID.closingSubtitleY,
        width: GRID.contentWidth, height: GRID.closingSubtitleHeight,
      }, { align: "CENTER" }),
    );
    // The close ACTS: a bare "Thank You" ends the deck on nothing, so a body —
    // one action per line, an email, a next step, a URL — is drawn centred
    // beneath the sign-off. The deck's last slide is the one that says what to
    // do now.
    if (slide.body?.trim()) {
      const lines = slide.body.split("\n").map((l) => l.trim()).filter(Boolean);
      const y = GRID.closingSubtitleY + GRID.closingSubtitleHeight + 14;
      const h = Math.min(CANVAS.height - GRID.margin - y, lines.length * 22 + 8);
      requests.push(...textBox(id("body"), page, lines.join("\n"), TYPE.closingAction, {
        x: GRID.margin, y, width: GRID.contentWidth, height: Math.max(22, h),
      }, { align: "CENTER", spaceBelow: 8 }));
    }
  } else if (layout === "section") {
    // A NUMERIC eyebrow ("01", "3") is the divider's index — drawn large in the
    // brand lime, the source deck's signature divider device. A worded eyebrow
    // ("PART ONE") stays a normal eyebrow. This is not the killed "parse Part N"
    // regex; it only treats a bare number as a numeral, so it cannot misfire on
    // "Teil 02" or any localised label.
    const numeral = slide.eyebrow?.trim().match(/^\d{1,2}$/)?.[0];
    if (numeral) {
      requests.push(...textBox(id("num"), page, numeral, TYPE.sectionNumeral, {
        x: GRID.margin, y: GRID.eyebrowY, width: 252, height: 100,
      }));
    } else {
      requests.push(...textBox(id("eyebrow"), page, slide.eyebrow, TYPE.eyebrowDark, {
        x: GRID.margin, y: GRID.eyebrowY,
        width: GRID.eyebrowWidth, height: GRID.eyebrowHeight,
      }));
    }
    requests.push(
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
        x: GRID.margin, y: titleBox.y, width: GRID.contentWidth, height: titleBox.height,
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
        x: GRID.margin, y: titleBox.y, width: GRID.contentWidth, height: titleBox.height,
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
        x: GRID.margin, y: titleBox.y, width: GRID.contentWidth, height: titleBox.height,
      }),
      ...cardsRequests(page, id, slide.cards || []),
    );
  } else if (layout === "stat" || layout === "bar-chart" || layout === "stacked-bar" || layout === "line-chart") {
    requests.push(
      ...textBox(id("eyebrow"), page, slide.eyebrow, eyebrowStyle, {
        x: GRID.margin, y: GRID.eyebrowY,
        width: GRID.eyebrowWidth, height: GRID.eyebrowHeight,
      }),
      ...textBox(id("title"), page, slide.title, titleStyle, {
        x: GRID.margin, y: titleBox.y, width: GRID.contentWidth, height: titleBox.height,
      }),
    );

    // The standfirst — the FINDING the chart proves, in a sentence, under an
    // assertion title. On the chart layouts the subtitle used to be dropped
    // entirely: the one slot for a takeaway line was discarded on exactly the
    // slides that carry evidence. When present it takes the top of the band and
    // the plot starts beneath it.
    let chartBandTop = GRID.bodyY;
    if (slide.subtitle?.trim() && layout !== "stat") {
      const standStyle = onDark ? TYPE.standfirstDark : TYPE.standfirst;
      const standH = drawnTextHeight(
        estimateLines(slide.subtitle, GRID.contentWidth, standStyle.size), standStyle.size
      );
      requests.push(...textBox(id("sub"), page, slide.subtitle, standStyle, {
        x: GRID.margin, y: GRID.bodyY, width: GRID.contentWidth, height: standH,
      }));
      chartBandTop = GRID.bodyY + standH + 8;
    }

    if (layout === "stat") requests.push(...statRequests(page, id, slide.stats || []));
    else if (slide.chart) {
      requests.push(...(
        layout === "stacked-bar" ? stackedBarRequests(page, id, slide.chart, onDark, chartBandTop)
        : layout === "line-chart" ? lineChartRequests(page, id, slide.chart, onDark, chartBandTop)
        : barChartRequests(page, id, slide.chart, onDark, chartBandTop)));
    }
  } else if (layout === "timeline-parallel") {
    requests.push(
      ...textBox(id("eyebrow"), page, slide.eyebrow, eyebrowStyle, {
        x: GRID.margin, y: GRID.eyebrowY,
        width: GRID.eyebrowWidth, height: GRID.eyebrowHeight,
      }),
      ...textBox(id("title"), page, slide.title, titleStyle, {
        x: GRID.margin, y: titleBox.y, width: GRID.contentWidth, height: titleBox.height,
      }),
      ...textBox(id("sub"), page, slide.subtitle, bodyStyle, {
        x: GRID.margin, y: GRID.bodyY, width: GRID.contentWidth, height: 20,
      }),
      ...parallelTimelineRequests(page, id, slide.tracks || [], slide.today),
    );
  } else if (layout === "feature") {
    const feature = fitHeading(slide.title, TYPE.featureTitle, GRID.contentWidth * 0.72, {
      bottom: IMAGE.overlayBodyY - 10,
      minTop: CANVAS.height * 0.28,
      minHeight: IMAGE.overlayTitleHeight,
      minSize: 18,
    });
    requests.push(
      ...textBox(id("eyebrow"), page, slide.eyebrow, TYPE.eyebrowDark, {
        x: GRID.margin, y: GRID.eyebrowY,
        width: GRID.eyebrowWidth, height: GRID.eyebrowHeight,
      }),
      ...textBox(id("title"), page, slide.title, feature.style, {
        x: GRID.margin, y: feature.y,
        width: GRID.contentWidth * 0.72, height: feature.height,
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
        x: IMAGE.splitTextX, y: titleBox.y,
        width: IMAGE.splitTextWidth, height: titleBox.height,
      }),
      ...textBox(id("body"), page, slide.body, bodyStyle, {
        x: IMAGE.splitTextX, y: GRID.bodyY,
        width: IMAGE.splitTextWidth, height: GRID.bodyHeight,
      }, { bullets: true }),
      // In the TEXT column, not on the picture. On the picture it would sit
      // beside what it credits, but this layout resolves with gradient:false —
      // nothing measures that corner, so a 6pt light line over an unknown
      // photograph is exactly the invisible credit this is here to stop.
      ...creditRequests(id("credit"), page, slide.resolvedImage?.credit,
        { x: IMAGE.splitTextX, width: IMAGE.splitTextWidth }, false),
    );
  } else if (layout === "image-grid") {
    requests.push(
      ...textBox(id("eyebrow"), page, slide.eyebrow, eyebrowStyle, {
        x: GRID.margin, y: GRID.eyebrowY,
        width: GRID.eyebrowWidth, height: GRID.eyebrowHeight,
      }),
      ...textBox(id("title"), page, slide.title, titleStyle, {
        x: GRID.margin, y: titleBox.y, width: GRID.contentWidth, height: titleBox.height,
      }),
      ...gridRequests(page, id, slide.resolvedImages || []),
    );
  } else if (layout === "two-column") {
    // The comparison slide, designed. It was two bare bullet piles — no rule,
    // no headers, no divider, ~55% dead paper — and it catches exactly the
    // before/after and pricing content that closes a deal. Now: a rule under
    // the title, an optional standfirst, per-column headers over an accent
    // underline, and a hairline down the middle so the two sides read as a
    // comparison rather than two lists that happen to share a slide.
    requests.push(
      ...textBox(id("eyebrow"), page, slide.eyebrow, eyebrowStyle, {
        x: GRID.margin, y: GRID.eyebrowY,
        width: GRID.eyebrowWidth, height: GRID.eyebrowHeight,
      }),
      ...textBox(id("title"), page, slide.title, titleStyle, {
        x: GRID.margin, y: titleBox.y, width: GRID.contentWidth, height: titleBox.height,
      }),
      ...ruleRequests(id("rule"), page, GRID.bodyY - RULE.gapAbove, GRID.contentWidth, onDark),
    );

    let colTop = GRID.columnY;
    if (slide.subtitle?.trim()) {
      const standStyle = onDark ? TYPE.standfirstDark : TYPE.standfirst;
      const standH = drawnTextHeight(
        estimateLines(slide.subtitle, GRID.contentWidth, standStyle.size), standStyle.size
      );
      requests.push(...textBox(id("sub"), page, slide.subtitle, standStyle, {
        x: GRID.margin, y: GRID.bodyY, width: GRID.contentWidth, height: standH,
      }));
      colTop = GRID.bodyY + standH + 12;
    }

    // A hairline between the columns.
    const midX = (GRID.columnLeftX + GRID.columnWidth + GRID.columnRightX) / 2;
    requests.push(...filledShape(id("vrule"), page, "RECTANGLE", onDark ? COLOR.greyLight : COLOR.navy, {
      x: midX, y: colTop, width: RULE.hairlineThickness, height: CANVAS.height - GRID.margin - colTop,
    }, RULE.hairlineAlpha));

    let bodyTop = colTop;
    const headStyle = onDark ? { ...TYPE.columnHeader, color: COLOR.white } : TYPE.columnHeader;
    if (slide.columns?.left?.trim() || slide.columns?.right?.trim()) {
      requests.push(
        ...textBox(id("lh"), page, slide.columns?.left, headStyle, {
          x: GRID.columnLeftX, y: colTop, width: GRID.columnWidth, height: 20,
        }),
        ...textBox(id("rh"), page, slide.columns?.right, headStyle, {
          x: GRID.columnRightX, y: colTop, width: GRID.columnWidth, height: 20,
        }),
        ...filledShape(id("lhu"), page, "RECTANGLE", onDark ? COLOR.tealSoft : COLOR.blue, {
          x: GRID.columnLeftX, y: colTop + 22, width: RULE.accentWidth, height: RULE.thickness,
        }),
        ...filledShape(id("rhu"), page, "RECTANGLE", onDark ? COLOR.tealSoft : COLOR.blue, {
          x: GRID.columnRightX, y: colTop + 22, width: RULE.accentWidth, height: RULE.thickness,
        }),
      );
      bodyTop = colTop + 34;
    }

    const colH = CANVAS.height - GRID.margin - bodyTop;
    requests.push(
      ...textBox(id("left"), page, slide.body, bodyStyle, {
        x: GRID.columnLeftX, y: bodyTop, width: GRID.columnWidth, height: colH,
      }, { bullets: true }),
      ...textBox(id("right"), page, slide.bodyRight, bodyStyle, {
        x: GRID.columnRightX, y: bodyTop, width: GRID.columnWidth, height: colH,
      }, { bullets: true }),
    );
  } else {
    // content, case-study, dark-index all share the title + body skeleton;
    // the eyebrow is what makes a case study read as one.
    //
    // This is the slide most decks are mostly made of, and measured it carried
    // 12.5% ink, no drawn object of any kind, 116 characters to a line, and the
    // bottom 47% of the canvas empty. Four things change that, none of them a
    // new layout: a measure, a rule, a middle step in the type scale, and the
    // photograph the slide already asked for and used to throw away.
    const rail = railBox(slide);
    const proseWidth = proseColumn;

    if (rail) {
      requests.push({
        createImage: {
          objectId: id("rail"), url: rail.url,
          elementProperties: {
            pageObjectId: page,
            size: { width: pt(rail.width), height: pt(rail.height) },
            transform: { scaleX: 1, scaleY: 1, translateX: rail.x, translateY: rail.y, unit: "PT" },
          },
        },
      });
    }

    requests.push(
      ...textBox(id("eyebrow"), page, slide.eyebrow, eyebrowStyle, {
        x: GRID.margin, y: GRID.eyebrowY,
        width: GRID.eyebrowWidth, height: GRID.eyebrowHeight,
      }),
      ...textBox(id("title"), page, slide.title, titleStyle, {
        x: GRID.margin, y: titleBox.y, width: proseWidth, height: titleBox.height,
      }),
      ...ruleRequests(id("rule"), page, GRID.bodyY - RULE.gapAbove, proseWidth, onDark),
    );

    // The standfirst takes the room it needs and the bullets start under it.
    let bodyTop = GRID.bodyY;
    if (slide.subtitle?.trim()) {
      const standStyle = onDark ? TYPE.standfirstDark : TYPE.standfirst;
      const standHeight = drawnTextHeight(
        estimateLines(slide.subtitle, proseWidth, standStyle.size), standStyle.size
      );
      requests.push(...textBox(id("sub"), page, slide.subtitle, standStyle, {
        x: GRID.margin, y: bodyTop, width: proseWidth, height: standHeight,
      }));
      bodyTop += standHeight + 10;
    }

    // Four bullets in a 241pt band left 47% of the canvas empty below them.
    // The paragraphs are spread through the band instead — up to a limit, past
    // which a list stops reading as a list and starts reading as loose lines.
    const bodyHeight = Math.max(40, GRID.bodyY + GRID.bandHeight - bodyTop);
    const paras = (slide.body || "").split("\n").map((l) => l.trim()).filter(Boolean);
    let bodySpacing = 6;
    if (paras.length > 1) {
      let lines = 0;
      for (const para of paras) lines += Math.max(1, estimateLines(para, proseWidth, bodyStyle.size, true));
      const natural = drawnTextHeight(lines, bodyStyle.size, 6, paras.length);
      const slack = bodyHeight - natural;
      if (slack > 0) bodySpacing = Math.min(22, 6 + slack / (paras.length - 1));
    }

    requests.push(
      ...textBox(id("body"), page, slide.body, bodyStyle, {
        x: GRID.margin, y: bodyTop, width: proseWidth,
        // Down to the foot of the band, not the old fixed height that stopped
        // 39pt short of it and pooled every list under the title.
        height: bodyHeight,
      }, { bullets: true, spaceBelow: bodySpacing }),
      ...(rail
        ? creditRequests(id("credit"), page, slide.resolvedImage?.credit,
            { x: GRID.margin, width: proseWidth }, onDark)
        : []),
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
  const out: SlideInput[] = [];
  for (let i = 0; i < slides.length; i++) {
    // A FIXPOINT, not one pass. Splitting a body in two used to assume the
    // remainder fitted; a body three times the box produced one full slide and
    // one that still overflowed.
    const pending: SlideInput[] = [slides[i]];
    for (let guard = 0; guard < 12 && pending.length; guard += 1) {
      const slide = pending.shift() as SlideInput;
      const pieces = splitOnce(slide, out.length);
      if (pieces.length === 1) { out.push(pieces[0]); continue; }
      out.push(pieces[0]);
      pending.unshift(...pieces.slice(1));
    }
    // Whatever the guard did not resolve still belongs in the deck.
    for (let j = 0; j < pending.length; j++) out.push(pending[j]);
  }
  return out;
}

/** The box a layout actually draws `body` into, found by PROBING the builder.
 *
 *  Measured rather than listed, the same trick textBandsFor uses, because the
 *  estimate has to follow the geometry: the splitter measured every body
 *  against the full 671pt content width, and image-split draws it into 315pt.
 *  A body it judged to be eight lines was sixteen in the box it landed in, so
 *  the slide that most needed splitting was the one never split. */
const PROBE = "\u241E";

function bodyBox(
  slide: SlideInput, index: number, field: "body" | "bodyRight"
): { width: number; height: number; size: number; bullets: boolean } | undefined {
  // The probe must measure the box this slide will END UP with, not the box it
  // has right now. On content/case-study a picture becomes a RIGHT-HAND RAIL
  // that narrows the body from 540pt to 432pt — but splitting runs BEFORE image
  // resolution, so the slide carries only `image: {query}` and railBox, which
  // keys on resolvedImage, would report no rail and measure the wide column. A
  // body that overflows the narrow column then never splits and runs off the
  // slide. So: if the slide WILL carry a rail (it has an image intent, resolved
  // or not), the probe gets a stub resolvedImage to force the narrow measure.
  const willRail = (slide.resolvedImage?.url || slide.image?.query || slide.image?.url) &&
    (slide.layout === "content" || slide.layout === "case-study");
  const probe: any = {
    ...slide,
    resolvedImage: willRail ? { url: "probe", scrim: 0 } : undefined,
  };
  probe[field] = `${PROBE}\n${PROBE}`;
  const reqs = buildSlideRequests(probe, index, "m") as any[];
  let id: string | undefined;
  for (const r of reqs) {
    if (r.insertText && String(r.insertText.text).indexOf(PROBE) >= 0) { id = r.insertText.objectId; break; }
  }
  if (!id) return undefined;   // this layout does not draw that field at all
  let width = 0, height = 0, size = TYPE.body.size, bullets = false;
  for (const r of reqs) {
    if (r.createShape && r.createShape.objectId === id) {
      width = r.createShape.elementProperties.size.width.magnitude;
      height = r.createShape.elementProperties.size.height.magnitude;
    }
    if (r.updateTextStyle && r.updateTextStyle.objectId === id && r.updateTextStyle.style?.fontSize) {
      size = r.updateTextStyle.style.fontSize.magnitude;
    }
    if (r.createParagraphBullets && r.createParagraphBullets.objectId === id) bullets = true;
  }
  return { width, height, size, bullets };
}

/** How much room a block of paragraphs needs in a given box. */
function blockHeight(
  paras: string[], box: { width: number; size: number; bullets: boolean }
): number {
  let lines = 0;
  for (let i = 0; i < paras.length; i++) {
    lines += Math.max(1, estimateLines(paras[i], box.width, box.size, box.bullets));
  }
  return drawnTextHeight(lines, box.size, SPACE_BELOW, paras.length);
}

const SPACE_BELOW = 6;

/** One split, or none. */
function splitOnce(slide: SlideInput, index: number): SlideInput[] {
  const body = slide.body;
  // Only prose layouts overflow this way; a chart's geometry is bounded.
  const splittable = !slide.chart && !slide.stats && !slide.milestones && !slide.tracks &&
    !slide.cards && !slide.quote && !slide.stages && !slide.logos;
  if (!body || !splittable) return [slide];

  const box = bodyBox(slide, index, "body");
  if (!box || box.width <= 0) return [slide];

  const paras = body.split("\n");
  if (blockHeight(paras, box) <= box.height) return [slide];

  let take = 0;
  for (let i = 0; i < paras.length; i++) {
    if (take && blockHeight(paras.slice(0, i + 1), box) > box.height) break;
    take = i + 1;
  }
  // A single paragraph taller than the whole box cannot be split by lines; let
  // it through rather than emitting an empty slide and looping.
  if (!take || take >= paras.length) return [slide];

  // BALANCE. Filling the first slide to the brim and leaving one bullet on the
  // second is how a deck ends up with a slide carrying a title and the words
  // "Fee: CHF 6,000". If the remainder would be nearly empty, split down the
  // middle instead — as long as the first half still fits.
  const rest = () => paras.slice(take);
  if (blockHeight(rest(), box) < box.height * 0.4 && take > 1) {
    const middle = Math.ceil(paras.length / 2);
    if (middle < take && blockHeight(paras.slice(0, middle), box) <= box.height) take = middle;
  }

  return [
    { ...slide, body: paras.slice(0, take).join("\n") },
    {
      ...slide,
      // "(continued)" once, however many times a body has to be split — a
      // fixpoint over a very long body otherwise produced "T (continued)
      // (continued) (continued)".
      title: /\(continued\)\s*$/.test(slide.title || "")
        ? slide.title
        : `${slide.title || ""} (continued)`.trim(),
      body: rest().join("\n"),
      // The eyebrow and the speaker notes belong to the first half — an eyebrow
      // repeated reads as a new section starting. The picture is INHERITED
      // instead of re-requested: dropping it left an image-split slide as a
      // column of text beside half a slide of nothing, and keeping the query
      // would buy a second, different photograph for the same point. See
      // inheritContinuationImages, which runs after resolution — splitting
      // happens BEFORE it, so there is nothing to copy yet at this moment.
      // bodyRight goes with the eyebrow: the spread copies it, so a two-column
      // slide whose LEFT column overflowed repeated its whole right column on
      // the continuation.
      image: undefined, eyebrow: undefined, notes: undefined, bodyRight: undefined,
      continuation: true,
    },
  ];
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

/** Give every continuation the picture of the slide it was cut from.
 *
 *  Run AFTER resolution, because splitting runs before it: at the moment the
 *  slide is cut there is only an image QUERY, and nothing to copy. Keeping the
 *  query on the tail instead would buy a second, different photograph for the
 *  same point — and pay for it. This was shipped once as `resolvedImage` left
 *  on the continuation, which did nothing at all: the field is empty when the
 *  splitter runs, and the check that was supposed to prove otherwise used a
 *  fixture with the picture already resolved.
 */
export function inheritContinuationImages(slides: SlideInput[]): void {
  for (let i = 1; i < slides.length; i++) {
    const slide = slides[i];
    if (!slide.continuation || slide.resolvedImage) continue;
    const parent = slides[i - 1];
    if (parent.resolvedImage) slide.resolvedImage = parent.resolvedImage;
  }
}

/** Reissue the capability URLs a persisted draft carries.
 *
 *  They last thirty days; the draft in the thread lasts for ever. A deck
 *  reopened five weeks later handed Google links it could only 404 — and one
 *  unfetchable image fails the whole batchUpdate, so the deck did not build at
 *  all rather than building with a gap. Anything not minted by us passes
 *  through untouched. */
export function refreshDeckImageUrls(slides: SlideInput[]): void {
  for (let i = 0; i < slides.length; i++) {
    const s: any = slides[i];
    if (s.resolvedImage?.url) s.resolvedImage.url = refreshSignedMediaUrl(s.resolvedImage.url);
    if (s.quote?.resolvedImage?.url) {
      s.quote.resolvedImage.url = refreshSignedMediaUrl(s.quote.resolvedImage.url);
    }
    for (const r of s.resolvedImages || []) if (r?.url) r.url = refreshSignedMediaUrl(r.url);
    for (const l of s.logos || []) if (l?.resolvedUrl) l.resolvedUrl = refreshSignedMediaUrl(l.resolvedUrl);
    for (const c of s.cards || []) {
      if (c?.resolvedImage?.url) c.resolvedImage.url = refreshSignedMediaUrl(c.resolvedImage.url);
      if (c?.resolvedIcon) c.resolvedIcon = refreshSignedMediaUrl(c.resolvedIcon);
    }
  }
}

export async function resolveDeckImages(
  slides: SlideInput[],
  generate?: ImageGenerator
): Promise<void> {
  // Normalise the layout name ONCE, here, because every build path goes through
  // this function. A slide asking for "title" or "bullets" — names the sibling
  // .pptx tool uses, which the model sees in the same turn — is drawn as the
  // nearest real layout instead of throwing, and the substitution is recorded
  // on the slide so the deck can be described accurately afterwards.
  slides.forEach((slide, i) => {
    const asked = slide.layout as string | undefined;
    const used = layoutOf(asked, i);
    if (asked && asked !== used) {
      slide.layoutAsked = asked;
      console.warn(`[Slides] slide ${i + 1}: unknown layout "${asked}" — drawn as "${used}"`);
    }
    slide.layout = used;
  });

  // A deck-wide art-direction note, set once by the model, threaded into every
  // PHOTOGRAPH query so a deck's images read as one commission — a beach cover
  // and a factory feature can share "muted, cinematic, cool light" instead of
  // being two unrelated stock grabs. Never applied to a `url` (an exact image),
  // and never to logos, icons or a named person's portrait.
  const deckStyle = slides.find((sx) => sx.imageStyle?.trim())?.imageStyle?.trim();
  const styled = (req: ImageRequest): ImageRequest => {
    if (req.url || !req.query || !deckStyle) return req;
    return { ...req, query: `${req.query}. ${deckStyle}` };
  };

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
        // A prose slide's picture is a rail down the right, not a backdrop, so
        // it is cropped to the rail's own shape. Baking it 16:9 and dropping it
        // into a 239x272 box is the letterboxing every other path fixed.
        const railShape = slide.layout === "content" || slide.layout === "case-study"
          ? { width: CANVAS.width - (GRID.margin + GRID.proseNarrow + IMAGE.railGap),
              height: CANVAS.height - GRID.bodyY }
          : null;
        // Tell the baker where this layout's lockup will land, so it measures
        // the part of the picture the mark actually sits on.
        const style = LAYOUT_STYLE[layoutOf(slide.layout, slideIndex)];
        const place = LOGO_PLACEMENT[style.logoPlacement];
        const r = await resolveImage(styled(slide.image), generate, {
          aspect: railShape
            ? railShape.width / railShape.height
            : split ? IMAGE.splitWidth / CANVAS.height : CANVAS.width / CANVAS.height,
          // No text sits on the rail or the split picture, so neither is
          // darkened; a gradient there would dim a photograph for nothing.
          gradient: !split && !railShape,
          textBands: split || railShape ? undefined : textBandsFor(slide, slideIndex),
          logoRegion: {
            x: place.x / CANVAS.width, y: place.y / CANVAS.height,
            w: place.width / CANVAS.width, h: place.height / CANVAS.height,
          },
        });
        // `unusable` means the bake failed on a picture that CARRIES TEXT. The
        // baked gradient is the contrast mechanism there — the flat scrim
        // rectangle it replaced is gone — so using the raw file would put white
        // type on raw daylight. The designed navy ground is better, and the
        // reason is recorded rather than swallowed.
        if (r && !r.unusable) {
          slide.resolvedImage = { url: r.url, scrim: r.scrim, credit: r.credit, logo: r.logo };
        } else {
          slide.imageUnavailable = true;
          slide.imageError = r?.unusable || "no image could be found for it";
        }
      }
      if (slide.quote?.image && !slide.quote.resolvedImage) {
        // trademark:true — the same guard the logos use, for the same reason.
        // A quote is attributed to a real named person, and the owned→stock→
        // generated chain would answer a "portrait of a CSO" query with a stock
        // photograph of a stranger, printed under that person's name. A missing
        // portrait must stay missing. A supplied `url` (an actual photo of the
        // person) still resolves — trademark only blocks the search/generate.
        const r = await resolveImage(slide.quote.image, generate, {
          aspect: 1, gradient: false, trademark: true,
        });
        if (r) slide.quote.resolvedImage = { url: r.url };
      }
      if (slide.logos?.length) {
        await Promise.all(slide.logos.map(async (l) => {
          if (!l || l.resolvedUrl) return;
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
          if (!card) return;
          if (card.icon && !card.resolvedIcon) {
            const icon = await resolveIcon(card.icon);
            if (icon) card.resolvedIcon = icon;
          }
          if (!card.image || card.resolvedImage) return;
          const r = await resolveImage(styled(card.image), generate, { aspect: cardAspect, gradient: false });
          if (r) card.resolvedImage = { url: r.url };
        }));
      }
      if (slide.images?.length && !slide.resolvedImages) {
        const specs = slide.images.slice(0, 12);
        // WHICH pictures we get has to be settled before the shape to crop them
        // to can be. The crop came from the requested set and the cells from the
        // survivors, so six asked for and four found baked a 1.70 crop into a
        // 2.29 cell — and Slides letterboxes rather than stretches, which is
        // 57pt of dead ground per cell. The caption flip does the same thing:
        // whether ANY image carries a caption changes the cell height, and it
        // was read over the requested set too.
        const found = (await Promise.all(specs.map(async (spec) => {
          if (!spec) return null;
          const src = await selectImageSource(styled(spec), generate);
          return src ? { src, caption: spec.caption } : null;
        }))).filter(Boolean) as { src: ImageSource; caption?: string }[];

        if (found.length) {
          const aspect = gridGeometry(found.length, found.some((f) => f.caption)).aspect;
          // No text sits on a grid cell, so no gradient.
          slide.resolvedImages = await Promise.all(found.map(async (f) => ({
            url: (await bakeImageSource(f.src, { aspect, gradient: false })).url,
            caption: f.caption,
          })));
        }
        if (found.length < specs.length) {
          slide.imagesDropped = specs.length - found.length;
          console.warn(`[SlideImages] grid: ${slide.imagesDropped} of ${specs.length} images not found`);
        }
      }
    })
  );

  // Tails of split slides take the picture of the slide they came from.
  inheritContinuationImages(slides);
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
  refreshDeckImageUrls(slides);
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
  refreshDeckImageUrls(slides);
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
