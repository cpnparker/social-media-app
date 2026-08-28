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
 * ── AND WHY THE PAGE IS SHOWN IN BANDS ──────────────────────────────────────
 *
 * A 4,300-pixel page shrunk to fit one figure is a thumbnail: nobody can read
 * the heading a note is about, which defeats the point of showing the page at
 * all. So the pins are grouped into bands, each band is a CROP of the capture
 * around its own findings, and each crop gets its own annotated figure. A page
 * with problems in three places produces three legible figures rather than one
 * unreadable one.
 */

import type { AuditPin } from "./audit-visual";

/** Image pixels. A band taller than this is cropped to it. */
export const BAND_MAX_HEIGHT = 560;

/** Breathing room above the first pin in a band and below the last. */
export const BAND_PADDING = 90;

/** Fixed, so the layout is exact arithmetic rather than a measurement of text
 *  that has not been rendered yet. The note carries a name and one short line;
 *  the full detail is in the list below the figures. */
export const CARD_HEIGHT = 84;

/** The least space between two notes in the same column. */
export const CARD_GAP = 12;

export interface Callout {
  pin: AuditPin;
  side: "left" | "right";
  /** Top of the note, in the FIGURE's coordinate space (image pixels from the
   *  top of the band). */
  top: number;
  /** Where the connector meets the image: the pin's own position in the band. */
  targetX: number;
  targetY: number;
}

export interface Band {
  /** Crop window on the full capture, in image pixels. */
  top: number;
  height: number;
  callouts: Callout[];
}

/**
 * Group the pins into bands, and lay the notes out around each one.
 *
 * @param pins  in reading order, already numbered
 * @param shot  the capture's dimensions and scale
 */
export function layoutBands(
  pins: AuditPin[],
  shot: { width: number; height: number; scale: number }
): Band[] {
  if (pins.length === 0) return [];

  // Everything in IMAGE pixels from here.
  const placed = pins
    .map((pin) => ({ pin, x: pin.x * shot.scale, y: pin.y * shot.scale }))
    .filter((p) => p.y <= shot.height)
    .sort((a, b) => a.y - b.y);
  if (placed.length === 0) return [];

  // ── Bands ────────────────────────────────────────────────────────────────
  // A pin joins the current band while it still fits inside the maximum crop.
  // Greedy and in order, so a band is always a contiguous slice of the page.
  const groups: (typeof placed)[] = [];
  let current: typeof placed = [placed[0]];
  for (let i = 1; i < placed.length; i++) {
    const first = current[0];
    if (placed[i].y - first.y <= BAND_MAX_HEIGHT - BAND_PADDING * 2) current.push(placed[i]);
    else { groups.push(current); current = [placed[i]]; }
  }
  groups.push(current);

  return groups.map((group) => {
    const first = group[0];
    const last = group[group.length - 1];
    const top = Math.max(0, first.y - BAND_PADDING);
    const height = Math.min(
      BAND_MAX_HEIGHT,
      Math.max(CARD_HEIGHT + BAND_PADDING, last.y - top + BAND_PADDING)
    );

    // ── Sides ──────────────────────────────────────────────────────────────
    // By where the thing SITS: something on the left of the page gets its note
    // on the left, so the connector never crosses the figure. A page whose
    // findings are all on one side would stack every note in one column, so
    // once a side holds more than half of them the rest go to the other.
    const half = shot.width / 2;
    const bySide: { left: typeof group; right: typeof group } = { left: [], right: [] };
    for (const p of group) {
      const wants: "left" | "right" = p.x + (p.pin.w * shot.scale) / 2 < half ? "left" : "right";
      const other = wants === "left" ? "right" : "left";
      if (bySide[wants].length > Math.ceil(group.length / 2) - 1 && bySide[other].length < bySide[wants].length) {
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
        // The note wants to sit level with its target. It is then pushed down
        // if that would overlap the note above it, which is the whole of the
        // no-overlap guarantee: the column is walked in order, so one pass is
        // enough and the order can never invert.
        const wanted = Math.max(0, p.y - top - CARD_HEIGHT / 2);
        const at = Math.max(wanted, cursor);
        cursor = at + CARD_HEIGHT + CARD_GAP;
        callouts.push({
          pin: p.pin,
          side,
          top: at,
          targetX: p.x,
          targetY: p.y - top,
        });
      }
    }

    callouts.sort((a, b) => a.pin.n - b.pin.n);
    return { top, height, callouts };
  });
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
