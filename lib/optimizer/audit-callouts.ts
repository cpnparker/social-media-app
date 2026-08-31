/**
 * The annotated figure: the page in the middle, the findings around it, and a
 * line from each note to the thing it is about.
 *
 * ── WHY THIS IS ARITHMETIC AND NOT CSS ──────────────────────────────────────
 *
 * Callout layouts fail in one specific way: two notes want the same vertical
 * space, so they overlap, and their connector lines cross. Solved by eye it
 * looks right once, at one width, with one set of findings, and breaks on the
 * next page audited. Solved here it is a function of the pins, and a check can
 * assert the two properties that matter — no note overlaps another, and the
 * notes on each side run in the same order as the things they point at.
 *
 * ── ONE FIGURE, AND WHERE LEGIBILITY WENT ───────────────────────────────────
 *
 * An earlier version cut the page into bands, one annotated figure each. It was
 * legible, and it answered the wrong question: a reader wants to see THE PAGE,
 * once, with its problems marked on it. Six near identical crops of a page
 * whose findings are all the same kind read as one issue repeated six times.
 *
 * So the figure shows the whole page and every note sits around it. The detail
 * moves to where it belongs: each finding carries a close-up of its own
 * element, cut from the pixels that element was measured in, which is also the
 * only part of this that cannot drift.
 *
 * ── AND WHY IT IS NOW FITTED TO WIDTH, NOT HEIGHT ───────────────────────────
 *
 * The version before this one capped the HEIGHT at 560px and scaled the page to
 * suit. That is fine for a page shaped like a page. The Amrize article is 900
 * by 5063, a ratio of 1 to 5.6, and fitting 5063 into 560 left the preview
 * NINETY-EIGHT PIXELS WIDE — measured on production, in a column 1112px wide,
 * with the marks on it drawn 52 by 6. A reader cannot tell what page they are
 * looking at, and half the column is empty on either side.
 *
 * A tall page cannot be shown whole, large, in a box shaped like a printed
 * page: those two demands are the same pixels. So it is CUT INTO COLUMNS and
 * read left to right, the way a long page is shown in every audit deck. On the
 * Amrize capture that turns a 98px sliver into three strips 320px wide, 3.3
 * times the scale, in a figure 1032 by 600 that still fits one A4 landscape
 * sheet.
 *
 * That costs the callouts: a note on the left cannot reach a mark in the middle
 * column without its line crossing the first one. So the layout has two modes,
 * chosen by whether the page fits a single column, and the check drives both.
 * A page of ordinary proportions keeps the notes around it. A page that has to
 * be cut gets numbered marks and a key, which is the honest trade: the figure's
 * job is to say WHERE, and the close-up under each finding already says what.
 */

import type { AuditPin } from "./audit-visual";

/**
 * DISPLAY pixels, and fixed.
 *
 * The layout used to be computed in image pixels and scaled with the picture,
 * which meant that on a five-thousand-pixel page the notes shrank to ten pixels
 * tall and could not be read at all. A note is text: it has a size of its own
 * and does not scale with the thing it points at.
 */
export const CARD_HEIGHT = 62;

/** The least space between two notes in the same column, in display pixels. */
export const CARD_GAP = 10;

/** How wide a note is, and how far it sits from the picture. */
export const NOTE_WIDTH = 176;
export const NOTE_GAP = 16;

/** The channel between two columns of a snaked page. */
export const COLUMN_GAP = 36;

/**
 * The tallest one column of the picture may be drawn.
 *
 * Set by the paper, not by taste. A4 landscape with the 12mm margins this
 * report prints at leaves 273 by 186mm, which is about 1032 by 703 CSS pixels;
 * 650 leaves room for the figure's caption and the legend beneath it. A figure
 * taller than the sheet does not shrink to fit, it breaks across two pages, and
 * a mark on one page with its note on the next is worse than either.
 */
export const COLUMN_MAX_HEIGHT = 650;

/** The width the figure is authored for when nobody has measured a container.
 *  Also A4 landscape, so print and screen agree unless the screen is wider. */
export const DEFAULT_FIGURE_WIDTH = 1032;

/** How many columns a page may be cut into before the strips are too narrow to
 *  recognise. Past this the figure gives up and lets the column run over the
 *  height cap rather than shredding the page. */
export const MAX_COLUMNS = 4;

/**
 * The narrowest the page may be drawn and still keep its notes.
 *
 * This is the number the old layout had no opinion about, and it is the whole
 * bug: fitting to height alone drew the Amrize page 98px wide and nothing
 * objected. Below this a reader cannot tell which page they are looking at, so
 * the figure stops trying to keep the callouts and cuts the page into columns
 * instead. 260px is about where a heading in a screenshot stops being a grey
 * smear, checked against the captures this tool produces.
 */
export const MIN_CALLOUT_PREVIEW_WIDTH = 260;

export interface Callout {
  pin: AuditPin;
  side: "left" | "right";
  /** Top of the note, in DISPLAY pixels from the top of the figure. */
  top: number;
  /** Where the connector meets the picture, in display pixels, measured from
   *  the top left of the PICTURE (not of the figure). */
  targetX: number;
  targetY: number;
  targetW: number;
  targetH: number;
  /** Which column of a snaked page this mark landed in. 0 when the page fits
   *  one column. */
  column: number;
}

export interface Band {
  /** How the figure is drawn. "callouts" puts notes around the page and a line
   *  to each; "snake" cuts the page into columns and numbers the marks. */
  mode: "callouts" | "snake";
  /** One column of the picture, in display pixels. */
  previewWidth: number;
  previewHeight: number;
  /** How many columns the page was cut into, and the channel between them. */
  columns: number;
  columnGap: number;
  /** The picture as a whole: every column plus the channels between them. */
  pictureWidth: number;
  /** image pixels per display pixel for the picture as drawn. The renderer
   *  needs this to size the <img> exactly, because a picture drawn at a
   *  slightly different size from the box the marks are placed in is a report
   *  whose marks point at the wrong thing. */
  previewScale: number;
  /** The figure as a whole: the picture, or the notes if they run longer. */
  height: number;
  callouts: Callout[];
}

/**
 * How many columns this page has to be cut into, and at what scale.
 *
 * Exported because it is the whole decision: everything the reader complains
 * about (a sliver, a figure that breaks across pages, strips too narrow to
 * read) is this arithmetic coming out wrong, and a check should be able to run
 * it directly rather than infer it from a rendered box.
 */
export function fitColumns(
  shot: { width: number; height: number },
  pictureWidth: number,
  maxHeight: number
): { columns: number; columnWidth: number; columnHeight: number; scale: number } {
  for (let n = 1; n <= MAX_COLUMNS; n++) {
    const colW = (pictureWidth - (n - 1) * COLUMN_GAP) / n;
    const scale = colW / Math.max(1, shot.width);
    const colH = (shot.height / n) * scale;
    if (colH <= maxHeight || n === MAX_COLUMNS) {
      return { columns: n, columnWidth: colW, columnHeight: colH, scale };
    }
  }
  // Unreachable: the loop always returns at n === MAX_COLUMNS.
  const scale = pictureWidth / Math.max(1, shot.width);
  return { columns: 1, columnWidth: pictureWidth, columnHeight: shot.height * scale, scale };
}

/**
 * Which of the two layouts this page gets, and why.
 *
 * Separated from the layout so a check can ask the question directly. The rule
 * is about the READER: keep the callouts as long as the page can still be drawn
 * wide enough to recognise, and cut it into columns when it cannot. Deciding it
 * on the aspect ratio alone would be the same mistake in a different unit.
 */
export function chooseMode(
  shot: { width: number; height: number },
  availableWidth: number,
  maxHeight: number
): { mode: Band["mode"]; calloutPreviewWidth: number } {
  const withNotes = Math.max(160, availableWidth - 2 * (NOTE_WIDTH + NOTE_GAP));
  const scale = Math.min(maxHeight / Math.max(1, shot.height), withNotes / Math.max(1, shot.width));
  const previewW = shot.width * scale;
  return { mode: previewW >= MIN_CALLOUT_PREVIEW_WIDTH ? "callouts" : "snake", calloutPreviewWidth: previewW };
}

/**
 * ONE figure: the whole page, with every note placed around it.
 *
 * The first version cut the page into bands and gave each its own figure. It
 * was legible, and it was the wrong answer to the question asked: a reader
 * wants to see THE PAGE, once, with its problems marked on it.
 *
 * Legibility is not lost, it moves. The preview carries the map; each finding
 * carries a close-up of its own element underneath. Overview, then detail,
 * which is how an audit report worth reading is arranged.
 */
export function layoutFigure(
  pins: AuditPin[],
  shot: { width: number; height: number; scale: number },
  opts?: { availableWidth?: number; maxHeight?: number }
): Band {
  const availableWidth = Math.max(320, opts?.availableWidth || DEFAULT_FIGURE_WIDTH);
  const maxHeight = opts?.maxHeight || COLUMN_MAX_HEIGHT;

  // First ask the cheap question: can this page be drawn wide enough to keep
  // its notes? If it can, nothing else changes.
  const withNotes = Math.max(160, availableWidth - 2 * (NOTE_WIDTH + NOTE_GAP));
  const chosen = chooseMode(shot, availableWidth, maxHeight);
  const mode = chosen.mode;

  // A snaked page gives its notes' width back to the picture: there is nowhere
  // for a note to point from once the page is in columns, so the space is
  // better spent on the page itself. On the Amrize article that is the whole
  // difference between 98px and 320px per column.
  const pictureWidth = mode === "callouts" ? withNotes : availableWidth;
  const fitted =
    mode === "callouts"
      ? (() => {
          const scale = Math.min(maxHeight / Math.max(1, shot.height), withNotes / Math.max(1, shot.width));
          return { columns: 1, columnWidth: shot.width * scale, columnHeight: shot.height * scale, scale };
        })()
      : fitColumns(shot, pictureWidth, maxHeight);

  const { columns, columnWidth, columnHeight, scale } = fitted;
  // Where one column ends and the next begins, in IMAGE pixels.
  const sliceImageHeight = shot.height / columns;

  const placed = pins
    .map((pin) => {
      const imgX = pin.x * shot.scale;
      const imgY = pin.y * shot.scale;
      const column = Math.min(columns - 1, Math.max(0, Math.floor(imgY / sliceImageHeight)));
      return {
        pin,
        column,
        x: column * (columnWidth + COLUMN_GAP) + imgX * scale,
        y: (imgY - column * sliceImageHeight) * scale,
        w: Math.max(pin.w * shot.scale * scale, 3),
        h: Math.max(pin.h * shot.scale * scale, 3),
      };
    })
    .filter((p) => p.y <= columnHeight)
    .sort((a, b) => a.column - b.column || a.y - b.y);

  const callouts: Callout[] = [];

  if (mode === "snake") {
    // No notes and no connectors: a line from the left margin to a mark in the
    // middle column has to cross the first column to get there, and a figure
    // with lines drawn over the page it is showing is worse than a key.
    for (const p of placed) {
      callouts.push({
        pin: p.pin, side: "left", top: 0,
        targetX: p.x, targetY: p.y, targetW: p.w, targetH: p.h, column: p.column,
      });
    }
    callouts.sort((a, b) => a.pin.n - b.pin.n);
    return {
      mode, previewWidth: columnWidth, previewHeight: columnHeight,
      columns, columnGap: COLUMN_GAP, pictureWidth, previewScale: scale,
      height: columnHeight, callouts,
    };
  }

  const half = columnWidth / 2;
  const bySide: { left: typeof placed; right: typeof placed } = { left: [], right: [] };
  for (const p of placed) {
    // A note goes on the side its subject sits on, so a connector never crosses
    // the page. Once a side holds more than half of them the rest go opposite,
    // or a page whose findings are all on the left stacks every note into one
    // column beside an empty gutter.
    const wants: "left" | "right" = p.x + p.w / 2 < half ? "left" : "right";
    const other = wants === "left" ? "right" : "left";
    if (bySide[wants].length > Math.ceil(placed.length / 2) - 1 && bySide[other].length < bySide[wants].length) {
      bySide[other].push(p);
    } else {
      bySide[wants].push(p);
    }
  }

  for (const side of ["left", "right"] as const) {
    const column = bySide[side].slice().sort((a, b) => a.y - b.y);
    let cursor = 0;
    for (const p of column) {
      // Level with its target, then pushed down if that would overlap the note
      // above. One pass, walked in order, so the order can never invert and two
      // notes can never share the same space.
      const wanted = Math.max(0, p.y - CARD_HEIGHT / 2);
      const at = Math.max(wanted, cursor);
      cursor = at + CARD_HEIGHT + CARD_GAP;
      callouts.push({
        pin: p.pin, side, top: at,
        targetX: p.x, targetY: p.y, targetW: p.w, targetH: p.h, column: p.column,
      });
    }
  }

  callouts.sort((a, b) => a.pin.n - b.pin.n);

  const deepest = callouts.reduce((n, c) => Math.max(n, c.top + CARD_HEIGHT), 0);
  return {
    mode, previewWidth: columnWidth, previewHeight: columnHeight,
    columns, columnGap: COLUMN_GAP, pictureWidth, previewScale: scale,
    height: Math.max(columnHeight, deepest + 4),
    callouts,
  };
}

/**
 * Does any note in this band overlap another on its own side?
 *
 * Exported for the check rather than used by the renderer: the layout above is
 * supposed to make it impossible, and a property worth guaranteeing is worth
 * being able to test.
 */
export function anyOverlap(band: Band): boolean {
  if (band.mode !== "callouts") return false;
  for (const side of ["left", "right"] as const) {
    const col = band.callouts.filter((c) => c.side === side).sort((a, b) => a.top - b.top);
    for (let i = 1; i < col.length; i++) {
      if (col[i].top < col[i - 1].top + CARD_HEIGHT) return true;
    }
  }
  return false;
}

/** Do the notes on each side run in the same order as the things they point
 *  at? Crossed connectors are the other way a callout layout goes wrong. */
export function ordersMatch(band: Band): boolean {
  if (band.mode !== "callouts") return true;
  for (const side of ["left", "right"] as const) {
    const col = band.callouts.filter((c) => c.side === side).sort((a, b) => a.top - b.top);
    for (let i = 1; i < col.length; i++) {
      if (col[i].targetY < col[i - 1].targetY) return false;
    }
  }
  return true;
}

/** Does every mark sit inside the picture it is drawn on? A mark outside the
 *  columns points at nothing and is the failure a snake introduces. */
export function marksInsidePicture(band: Band): boolean {
  for (const c of band.callouts) {
    if (c.targetX < -0.5 || c.targetY < -0.5) return false;
    if (c.targetX > band.pictureWidth + 0.5) return false;
    if (c.targetY > band.previewHeight + 0.5) return false;
  }
  return true;
}
