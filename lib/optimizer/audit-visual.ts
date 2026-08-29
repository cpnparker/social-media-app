/**
 * The audit as a picture: which findings have a place on the page, where, and
 * in what order a reader should meet them.
 *
 * ── WHY THIS IS A SEPARATE, PURE MODULE ─────────────────────────────────────
 *
 * The mapping from "a check failed" to "here is the thing it failed about" is
 * the whole substance of an annotated report, and it is the part that goes
 * quietly wrong: a pin on the wrong element is a confident, printable claim
 * about a client's page. Kept pure so a check can drive it with fixture spots
 * and assert where every pin lands, rather than reading a component.
 *
 * ── THE HONESTY RULE THIS INHERITS ──────────────────────────────────────────
 *
 * Most audit checks have NO place on the page. A missing meta description, an
 * absent canonical, no schema, a robots rule: none of them are visible, and
 * pinning them somewhere plausible would be inventing evidence. They are
 * returned separately, so the report shows them as a list and says why they
 * carry no marker, rather than dropping them and leaving a reader to believe
 * the picture is the whole audit.
 */

import type { AuditCheck, AuditStatus } from "./page-audit";
import type { RenderSpot } from "./render";

/** True for the marks that say WHERE something should go, rather than what is
 *  wrong with something already there. */
export function isPlacement(pin: { kind?: string }): boolean {
  return pin.kind === "slot-top" || pin.kind === "slot-end";
}

export interface AuditPin {
  /** 1-based, in reading order down the page. What the badge shows. */
  n: number;
  checkId: string;
  name: string;
  status: "fail" | "warn" | "info";
  detail: string;
  remedy: string;
  /** The element this points at, in DOCUMENT pixels at render width. */
  x: number;
  y: number;
  w: number;
  h: number;
  /** A few words of the element, so the list can say which one. */
  label: string;
  /** The kind of spot claimed, so a placement can be drawn as a place rather
   *  than as a box around something that is not there. */
  kind?: string;
  /** A close-up of the element, cut from the pixels it was measured in. */
  crop?: string;
  cropWidth?: number;
  cropHeight?: number;
}

/**
 * Which spot kinds a check may claim, in preference order.
 *
 * Declared as data rather than a switch so the check can assert the whole table
 * at once, and so adding an audit check that forgets to declare itself shows up
 * as "no marker" rather than as a pin on whatever the switch fell through to.
 */
export const CHECK_SPOTS: { [checkId: string]: RenderSpot["kind"][] } = {
  // Missing blocks, marked where they WOULD go. A report that says a page has
  // no summary and cannot say where to put one is half a sentence.
  "tldr-visible": ["slot-top"],
  "byline-visible": ["slot-top"],
  "visible-date": ["date", "slot-top"],
  "faq-visible": ["faq", "slot-end"],
  "one-h1": ["h1"],
  "heading-hierarchy": ["heading"],
  "question-headings-live": ["heading"],
  "image-alt": ["image-no-alt"],
  "js-dependency": ["first-paragraph"],
};

/** How many pins a single check may place before it is just hatching. */
export const MAX_PINS_PER_CHECK = 3;

/** And how many the whole picture may carry before nobody reads any of them. */
export const MAX_PINS = 12;

function isMarkable(status: AuditStatus): status is "fail" | "warn" {
  return status === "fail" || status === "warn";
}

/**
 * Checks that may be marked even though they are not defects.
 *
 * `faq-visible` is held at `info` in BOTH states on purpose: the rubric does
 * not score FAQ presence, and letting it fail would smuggle a dropped criterion
 * back into the tally. But "there is no FAQ block" is still the single most
 * asked-for editorial addition on a page like this, and a report that knows
 * where one would go and does not say is withholding the useful half.
 *
 * So an opportunity is marked as a PLACE and never as a fault: sky blue, a
 * dashed rule, and its own remedy text saying it is optional. It changes no
 * count, because it is still not measured.
 *
 * An explicit list rather than a status rule, so this cannot creep: every other
 * `info` check ("not checked", "rendered in 17.2s") would be nonsense as a mark.
 */
export const PLACEMENT_OPPORTUNITIES = ["faq-visible"];

/**
 * Is this check an opportunity worth marking?
 *
 * The REMEDY is the gate, and it is the gate because it is the only field that
 * distinguishes the two states of an unscored check. `faq-visible` writes a
 * remedy only when the page has no FAQ; a page that already has one carries the
 * same id and the same `info` status with no remedy. Keying on the id alone
 * would mark "put an FAQ at the end" on a page whose FAQ is right there.
 */
export function isOpportunity(check: { id: string; status: AuditStatus; remedy?: string }): boolean {
  if (check.status !== "info") return false;
  if (PLACEMENT_OPPORTUNITIES.indexOf(check.id) < 0) return false;
  return !!(check.remedy && check.remedy.trim());
}

/**
 * Place the failing checks on the page.
 *
 * Fails are placed before warnings, so that when the cap bites it drops the
 * least serious rather than whatever happened to sit lowest. The NUMBERING is
 * then reassigned in reading order, because a reader follows the page, not the
 * severity: a report whose badges run 4, 1, 7 down the screen makes the reader
 * do the sorting.
 */
export function buildPins(checks: AuditCheck[], spots: RenderSpot[]): AuditPin[] {
  const byKind: { [k: string]: RenderSpot[] } = {};
  for (const s of spots) {
    if (!byKind[s.kind]) byKind[s.kind] = [];
    byKind[s.kind].push(s);
  }
  for (const k of Object.keys(byKind)) byKind[k].sort((a, b) => a.y - b.y || a.x - b.x);

  const rank = (c: AuditCheck): number => (c.status === "fail" ? 0 : c.status === "warn" ? 1 : 2);
  const severityFirst = checks
    .filter((c) => isMarkable(c.status) || isOpportunity(c))
    .slice()
    .sort((a, b) => rank(a) - rank(b));

  const claimed: AuditPin[] = [];
  const used = new Set<string>();

  for (const check of severityFirst) {
    if (claimed.length >= MAX_PINS) break;
    const declared = CHECK_SPOTS[check.id];
    if (!declared) continue;
    // An opportunity may only claim a PLACE. Marking an element would put a
    // box round something that is present and call it an improvement.
    const opportunity = isOpportunity(check);
    const kinds = opportunity ? declared.filter((k) => isPlacement({ kind: k })) : declared;
    if (!kinds.length) continue;

    let placed = 0;
    for (const kind of kinds) {
      for (const spot of byKind[kind] || []) {
        if (placed >= MAX_PINS_PER_CHECK || claimed.length >= MAX_PINS) break;
        // One badge per element. Two findings about the same heading would
        // stack two circles on top of each other, and the lower one would be
        // unreadable and unclickable.
        // One badge per ELEMENT: two boxes over one heading stack two circles
        // and the lower one cannot be read. A PLACE is different. A single spot
        // can be missing more than one thing, and under this page's H1 two are:
        // a summary block and a byline. Two notes pointing at one dashed rule
        // says that; dropping the second says the page has a byline.
        const at = `${spot.x},${spot.y},${spot.kind}`;
        if (used.has(at) && !isPlacement(spot)) continue;
        used.add(at);
        claimed.push({
          n: 0,
          checkId: check.id,
          name: check.name,
          status: check.status === "fail" ? "fail" : check.status === "warn" ? "warn" : "info",
          detail: check.detail,
          remedy: check.remedy || "",
          x: spot.x, y: spot.y, w: spot.w, h: spot.h,
          label: spot.label,
          kind: spot.kind,
          crop: spot.crop,
          cropWidth: spot.cropWidth,
          cropHeight: spot.cropHeight,
        });
        placed++;
      }
      if (placed > 0) break;
    }
  }

  claimed.sort((a, b) => a.y - b.y || a.x - b.x);
  return claimed.map((p, i) => ({ ...p, n: i + 1 }));
}

/** One finding, and every place on the page it was marked. */
export interface PinGroup {
  checkId: string;
  name: string;
  status: "fail" | "warn" | "info";
  detail: string;
  remedy: string;
  /** The badge numbers, in reading order. */
  ns: number[];
  /** A few words of each marked element, so the reader can tell them apart. */
  labels: string[];
  /** The pins themselves, for the close-ups each one carries. */
  pins: AuditPin[];
}

/**
 * Collapse the pins into one entry per finding.
 *
 * Six headings missing a question mark is ONE problem marked six times, and a
 * list that repeats the same name, evidence and remedy three times running
 * reads as three problems and wastes the page it is printed on. The badges stay
 * separate on the picture, because each one points somewhere different.
 *
 * Ordered by the FIRST badge, so the list still runs down the page.
 */
export function groupPins(pins: AuditPin[]): PinGroup[] {
  const order: string[] = [];
  const by: { [id: string]: PinGroup } = {};
  for (const p of pins) {
    if (!by[p.checkId]) {
      by[p.checkId] = { checkId: p.checkId, name: p.name, status: p.status, detail: p.detail, remedy: p.remedy, ns: [], labels: [], pins: [] };
      order.push(p.checkId);
    }
    by[p.checkId].ns.push(p.n);
    by[p.checkId].pins.push(p);
    if (p.label) by[p.checkId].labels.push(p.label);
  }
  return order.map((id) => by[id]).sort((a, b) => a.ns[0] - b.ns[0]);
}

/**
 * Which mark owns each close-up.
 *
 * Three things are missing from under this page's H1, so three marks point at
 * one spot and three findings carry a close-up cut from the same two pixels.
 * Printed, that is the same strip of headline three times running, which is
 * precisely the "one issue repeated" look the banded version was rebuilt to
 * escape. The first mark at a spot shows the picture; the rest say whose.
 *
 * Keyed on the crop itself rather than on the coordinates, because the crop IS
 * the evidence: two pins with identical pixels are looking at the same thing
 * whatever their rects say.
 */
export function cropOwners(pins: AuditPin[]): { [crop: string]: number } {
  const owners: { [crop: string]: number } = {};
  const ordered = pins.slice().sort((a, b) => a.n - b.n);
  for (let i = 0; i < ordered.length; i++) {
    const c = ordered[i].crop;
    if (!c) continue;
    if (owners[c] === undefined) owners[c] = ordered[i].n;
  }
  return owners;
}

/** A finding's close-ups: the ones it shows, and the marks it shares a place
 *  with. */
export interface CropSplit {
  own: AuditPin[];
  sharedWith: number[];
}

export function splitCrops(group: PinGroup, owners: { [crop: string]: number }): CropSplit {
  const own: AuditPin[] = [];
  const sharedWith: number[] = [];
  for (let i = 0; i < group.pins.length; i++) {
    const p = group.pins[i];
    if (!p.crop) continue;
    if (owners[p.crop] === p.n) own.push(p);
    else if (sharedWith.indexOf(owners[p.crop]) < 0) sharedWith.push(owners[p.crop]);
  }
  return { own, sharedWith: sharedWith.sort((a, b) => a - b) };
}

/**
 * The findings with nowhere to point, and the passes.
 *
 * Split out rather than dropped. A report that shows six pins over a page with
 * fourteen findings, and says nothing about the other eight, reads as an audit
 * of six things.
 */
export function unpinnedFindings(checks: AuditCheck[], pins: AuditPin[]): AuditCheck[] {
  const pinned = new Set(pins.map((p) => p.checkId));
  return checks.filter((c) => isMarkable(c.status) && !pinned.has(c.id));
}

/** Where a pin sits on a rendered image, as percentages, so the picture can be
 *  any width — a screen, a print column — and the badges follow it. */
export function pinPercent(
  pin: AuditPin,
  shot: { width: number; height: number; scale: number }
): { left: number; top: number; width: number; height: number; offPicture: boolean } {
  const px = pin.x * shot.scale;
  const py = pin.y * shot.scale;
  const pw = Math.max(pin.w * shot.scale, 8);
  const ph = Math.max(pin.h * shot.scale, 8);
  return {
    left: (px / shot.width) * 100,
    top: (py / shot.height) * 100,
    width: (pw / shot.width) * 100,
    height: (ph / shot.height) * 100,
    // Past the bottom of a clipped capture. The list still carries the finding;
    // the picture simply cannot show it, and the report says so.
    offPicture: py > shot.height,
  };
}

/** The one-line summary a report header carries. Counts, never a total: the
 *  checks are not weighted against each other. */
export function auditHeadline(checks: AuditCheck[]): { fail: number; warn: number; pass: number; info: number } {
  const out = { fail: 0, warn: 0, pass: 0, info: 0 };
  for (const c of checks) {
    if (c.status === "fail") out.fail++;
    else if (c.status === "warn") out.warn++;
    else if (c.status === "pass") out.pass++;
    else out.info++;
  }
  return out;
}
