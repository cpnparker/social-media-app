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
  COLOR, GRID, CANVAS, TYPE, TIMELINE, TIMELINE_PARALLEL, TRACK_COLORS, LAYOUT_STYLE, LOGO_PLACEMENT,
  rgb, logoUrl, type SlideLayout, type TypeStyle,
} from "@/lib/slides/brand";
import { getUserGoogleToken, authFailureMessage, type SlidesAuthFailure } from "@/lib/slides/token";
import { captureThumbnails } from "@/lib/slides/preview";

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
}

/** A positioned text box: create, fill, style. Returns [] for empty text so a
 *  missing optional field doesn't produce an empty box (or an insertText error,
 *  which is what an empty string actually causes). */
function textBox(
  objectId: string,
  pageObjectId: string,
  text: string | undefined,
  style: TypeStyle,
  box: { x: number; y: number; width: number; height: number },
  options: BoxOptions = {}
): Req[] {
  const content = (text ?? "").trim();
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

function logoRequests(objectId: string, pageObjectId: string, layout: SlideLayout): Req[] {
  const style = LAYOUT_STYLE[layout];
  if (!style.logo) return [];
  const place = LOGO_PLACEMENT[style.logoPlacement];
  return [
    {
      createImage: {
        objectId,
        url: logoUrl(style.logo),
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
  shapeType: "RECTANGLE" | "ROUND_RECTANGLE" | "ELLIPSE",
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
      const labelX = barX + barW + 6;
      const labelW = inside ? barW - 12 : Math.min(natural, 150);
      const footprintEnd = inside ? barX + barW : labelX + labelW;

      let row = rowEnds.findIndex((end) => barX >= end);
      if (row === -1) { row = rowEnds.length; rowEnds.push(footprintEnd + 8); }
      else rowEnds[row] = footprintEnd + 8;

      return { ...it, row, barX, barW, isPoint, inside, labelX, labelW, footprintEnd };
    });
    return { name: tr.name, items, rows: Math.max(1, rowEnds.length) };
  });

  let cursorY = P.bandY;
  placedTracks.forEach((tr, ti) => {
    const color = TRACK_COLORS[ti % TRACK_COLORS.length];
    const trackHeight = tr.rows * P.rowHeight;

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
      const barY = cursorY + it.row * P.rowHeight;

      requests.push(
        ...filledShape(
          id(`p${ti}_${pi}`), page,
          it.isPoint ? "ELLIPSE" : "ROUND_RECTANGLE", color,
          {
            x: it.barX,
            y: it.isPoint ? barY + P.barHeight / 2 - P.pointSize / 2 : barY,
            width: it.barW,
            height: it.isPoint ? P.pointSize : P.barHeight,
          }
        ),
        ...textBox(
          id(`pl${ti}_${pi}`), page, it.label,
          it.inside ? TYPE.phaseInBar : TYPE.phaseLabel,
          {
            x: it.inside ? it.barX + 6 : it.labelX,
            y: barY + (it.inside ? 4 : 3),
            width: it.labelW,
            height: P.barHeight,
          }
        )
      );
    });

    cursorY += trackHeight + P.trackGap;
  });

  const axisY = cursorY - P.trackGap + P.axisGap;
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

  const onDark = style.onDark;
  const bodyStyle = onDark ? TYPE.bodyDark : TYPE.body;
  const titleStyle = onDark ? TYPE.slideTitleDark : TYPE.slideTitle;
  const eyebrowStyle = onDark ? TYPE.eyebrowDark : TYPE.eyebrow;

  if (layout === "cover") {
    requests.push(
      ...textBox(id("title"), page, slide.title, TYPE.coverTitle, {
        x: GRID.coverTitleX, y: GRID.coverTitleY,
        width: GRID.coverTitleWidth, height: GRID.coverTitleHeight,
      }, { align: "CENTER" }),
      ...textBox(id("sub"), page, slide.subtitle, TYPE.coverKicker, {
        x: GRID.coverKickerX, y: GRID.coverKickerY,
        width: GRID.coverKickerWidth, height: GRID.coverKickerHeight,
      }, { align: "CENTER" }),
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
        x: GRID.margin, y: GRID.bodyY - 8, width: GRID.contentWidth, height: 24,
      }),
      ...timelineRequests(page, id, slide.milestones || []),
    );
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
        x: GRID.margin, y: GRID.bodyY - 8, width: GRID.contentWidth, height: 24,
      }),
      ...parallelTimelineRequests(page, id, slide.tracks || [], slide.today),
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

  requests.push(...logoRequests(id("logo"), page, layout));
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

async function googleFetch(url: string, token: string, init: RequestInit = {}) {
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
  userEmail: string
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
  userEmail: string
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
