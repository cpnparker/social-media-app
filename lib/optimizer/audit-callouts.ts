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

/**
 * The tallest the preview may be drawn.
 *
 * A page is often several thousand pixels tall, and a figure that tall is not a
 * preview: it is the page again, scrolled past one note at a time, which is
 * exactly how the banded version felt. Capped, the preview becomes what it is
 * for — a map of WHERE the problems are — and the close-up under each finding
 * carries what they are.
 */
export const FIGURE_MAX_HEIGHT = 560;

export interface Callout {
  pin: AuditPin;
  side: "left" | "right";
  /** Top of the note, in DISPLAY pixels from the top of the figure. */
  top: number;
  /** Where the connector meets the picture, in display pixels. */
  targetX: number;
  targetY: number;
  targetW: number;
  targetH: number;
}

export interface Band {
  /** The picture, scaled to fit, in display pixels. */
  previewWidth: number;
  previewHeight: number;
  /** The figure as a whole: the picture, or the notes if they run longer. */
  height: number;
  callouts: Callout[];
}

/**
 * ONE figure: the whole page, with every note placed around it.
 *
 * The first version cut the page into bands and gave each its own figure. It
 * was legible, and it was the wrong answer to the question asked: a reader
 * wants to see THE PAGE, once, with its problems marked on it. Six near
 * identical crops of a page whose findings are all the same kind read as the
 * same issue repeated six times rather than as one page with six marks.
 *
 * Legibility is not lost, it moves. The preview carries the map; each finding
 * carries a close-up of its own element underneath. Overview, then detail,
 * which is how an audit report worth reading is arranged.
 */
export function layoutFigure(
  pins: AuditPin[],
  shot: { width: number; height: number; scale: number },
  maxHeight = FIGURE_MAX_HEIGHT
): Band {
  // Everything below is in DISPLAY pixels: the picture is scaled to fit, and
  // the notes are not, because a note is text.
  const fit = Math.min(1, maxHeight / Math.max(1, shot.height));
  const previewH = shot.height * fit;
  const previewW = shot.width * fit;

  const placed = pins
    .map((pin) => ({
      pin,
      x: pin.x * shot.scale * fit,
      y: pin.y * shot.scale * fit,
      w: Math.max(pin.w * shot.scale * fit, 3),
      h: Math.max(pin.h * shot.scale * fit, 3),
    }))
    .filter((p) => p.y <= previewH)
    .sort((a, b) => a.y - b.y);

  const half = previewW / 2;
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

  const callouts: Callout[] = [];
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
      callouts.push({ pin: p.pin, side, top: at, targetX: p.x, targetY: p.y, targetW: p.w, targetH: p.h });
    }
  }

  callouts.sort((a, b) => a.pin.n - b.pin.n);

  const deepest = callouts.reduce((n, c) => Math.max(n, c.top + CARD_HEIGHT), 0);
  return {
    previewWidth: previewW,
    previewHeight: previewH,
    height: Math.max(previewH, deepest + 4),
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
  for (const side of ["left", "right"] as const) {
    const col = band.callouts.filter((c) => c.side === side).sort((a, b) => a.top - b.top);
    for (let i = 1; i < col.length; i++) {
      if (col[i].targetY < col[i - 1].targetY) return false;
    }
  }
  return true;
}
