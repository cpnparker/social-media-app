/**
 * Guards the annotated page audit — the report a client actually receives.
 *
 * Run: npx tsx scripts/verify-optimizer-audit-visual.ts --self-test
 *
 * ── WHAT IS ACTUALLY AT RISK HERE ───────────────────────────────────────────
 *
 * A PIN ON THE WRONG ELEMENT. Every other surface in this studio makes a claim
 * a writer can check against the text in front of them. This one draws a red
 * box on a picture of somebody's live page and sends it to them, and a box
 * around the wrong heading is a confident, printed, forwarded mistake. The
 * mapping from finding to element is therefore data rather than a switch, and
 * this check drives it.
 *
 * THE FINDINGS WITH NOWHERE TO POINT. Most checks are invisible: a missing meta
 * description, no canonical, no schema, a robots rule. Pinning them somewhere
 * plausible would be inventing evidence, and dropping them would make a report
 * showing six pins over a page with fourteen problems read as an audit of six
 * things. They have to come back separately and be shown.
 *
 * THE PICTURE THAT STOPS EARLY. A tall page is captured to a cap. A report
 * whose picture silently ends two thirds of the way down claims to have looked
 * at a page it only half saw.
 *
 * STILL NO SCORE. page-audit refuses to total its checks, and a client-facing
 * report is exactly where one number would be quoted back for years.
 *
 * ── MUTATION LOG ────────────────────────────────────────────────────────────
 *
 * Seventeen mutations in a detached worktree. Fifteen killed on the first pass;
 * both survivors were faults in this file rather than in the code.
 *
 * KILLED  an invisible check mapped to a nearby element                    → 1
 * KILLED  passing checks marked too                                       → 1
 * KILLED  the per-check pin cap removed                                   → 3
 * KILLED  two badges allowed on one element                               → 3
 * KILLED  unpinned findings dropped                                       → 4
 * KILLED  off-picture pins reported as on it                              → 5
 * KILLED  a zero-sized element given a zero-sized marker                   → 5
 * KILLED  the clipping flag hardcoded false                               → 9
 * KILLED  a failed screenshot rethrown, killing the audit                  → 9
 * KILLED  the route no longer asking for a picture                        → 9
 * KILLED  the print stylesheet removed                                    → 8
 * KILLED  the no-total disclaimer removed                                 → 6
 *
 * SURVIVED, then killed by rebuilding the fixture: removing the reading-order
 *   sort. The three-pin fixture had severity order and reading order AGREEING
 *   by accident, so the sort could be deleted with no observable effect. It now
 *   puts a WARNING at the top of the page and a FAILURE near the bottom, where
 *   the two orders disagree and only one of them can be right.
 *
 * SURVIVED, then killed by naming the selector: deleting the rule that stops a
 *   FINDING breaking across a page. `/break-inside: avoid/` matched the
 *   picture's own rule, so the assertion passed while the thing it was about
 *   was gone.
 */
import {
  buildPins,
  groupPins,
  unpinnedFindings,
  pinPercent,
  auditHeadline,
  CHECK_SPOTS,
  MAX_PINS,
  MAX_PINS_PER_CHECK,
} from "../lib/optimizer/audit-visual";
import { auditPage } from "../lib/optimizer/page-audit";
import type { AuditCheck } from "../lib/optimizer/page-audit";
import type { RenderSpot } from "../lib/optimizer/render";
import { layoutFigure, anyOverlap, ordersMatch, CARD_HEIGHT, FIGURE_MAX_HEIGHT } from "../lib/optimizer/audit-callouts";
import { readFileSync } from "fs";
import { join } from "path";

const root = join(__dirname, "..");
const read = (p: string) => readFileSync(join(root, p), "utf8");

let failures = 0;
const fail = (m: string) => { failures++; console.log(`  ✗ ${m}`); };
const pass = (m: string) => console.log(`  ✓ ${m}`);
const assert = (ok: boolean, m: string) => (ok ? pass(m) : fail(m));

const stripComments = (src: string) =>
  src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");

const spot = (kind: RenderSpot["kind"], y: number, x = 40, label = ""): RenderSpot =>
  ({ kind, x, y, w: 300, h: 40, label });

const check = (id: string, status: AuditCheck["status"], name = id): AuditCheck =>
  ({ id, section: "structure", name, status, detail: "d", remedy: "r" });

// ── 1. A pin lands on the thing its finding is about ───────────────────────
console.log("\n1. What a pin points at");
{
  const spots = [spot("h1", 100, 40, "The heading"), spot("image-no-alt", 800, 60, "hero.jpg"), spot("heading", 400)];
  const checks = [check("one-h1", "fail"), check("image-alt", "fail")];
  const pins = buildPins(checks, spots);

  assert(pins.length === 2, `both failing checks are placed (${pins.length})`);
  const h1Pin = pins.filter((p) => p.checkId === "one-h1")[0];
  const imgPin = pins.filter((p) => p.checkId === "image-alt")[0];
  assert(!!h1Pin && h1Pin.y === 100, "the H1 finding lands on the H1");
  assert(!!imgPin && imgPin.y === 800, "the image finding lands on the image");
  assert(imgPin.label === "hero.jpg", "and carries enough of the element to say which one it means");

  // The one that matters: a check with no declared spot kind gets NO pin, ever.
  const invented = buildPins([check("meta-description", "fail")], spots);
  assert(invented.length === 0, "a check with no place on the page is not pinned somewhere plausible");
  assert(!CHECK_SPOTS["meta-description"] && !CHECK_SPOTS["canonical"] && !CHECK_SPOTS["schema-present"],
    "and the invisible checks are absent from the table rather than mapped to something nearby");

  // Only failures and warnings. A passing check with a red box on it is a
  // report that contradicts its own summary.
  assert(buildPins([check("one-h1", "pass")], spots).length === 0, "a passing check is never marked");
  assert(buildPins([check("js-dependency", "info")], [spot("first-paragraph", 50)]).length === 0, "and neither is one that was not measured");
}

// ── 2. Numbered in reading order ───────────────────────────────────────────
//
// A reader follows the page. Badges running 4, 1, 7 down the screen make them
// do the sorting.
console.log("\n2. The order the numbers run in");
{
  // The fixture is built so severity order and reading order DISAGREE: the
  // warning sits at the TOP of the page and the failure near the bottom. An
  // earlier version had them agreeing by accident, so removing the reading-order
  // sort altogether changed nothing and the mutation survived — a fixture that
  // cannot trip the defect certifies nothing.
  const spots = [spot("image-no-alt", 120), spot("h1", 800)];
  const pins = buildPins([check("one-h1", "fail"), check("image-alt", "warn")], spots);
  assert(pins.length === 2, "two findings, two pins");
  assert(pins[0].status === "warn" && pins[0].y === 120, "the pin at the top of the page is numbered 1, even though it is only a warning");
  assert(pins[1].status === "fail" && pins[1].y === 800, "and the failure lower down is 2");
  assert(pins.map((p) => p.n).join(",") === "1,2", "the numbers follow the page, not the severity");
  assert(pins.filter((p) => p.status === "fail").length === 1, "severity survives on the pin itself, for the colour");
}

// ── 3. Caps, and what they drop ────────────────────────────────────────────
console.log("\n3. Bounded");
{
  const many: RenderSpot[] = [];
  for (let i = 0; i < 40; i++) many.push(spot("image-no-alt", 100 + i * 50));
  const pins = buildPins([check("image-alt", "fail")], many);
  assert(pins.length === MAX_PINS_PER_CHECK, `one check places at most ${MAX_PINS_PER_CHECK} pins, not ${many.length}`);

  const lots: AuditCheck[] = [];
  const lotsOfSpots: RenderSpot[] = [];
  for (const id of Object.keys(CHECK_SPOTS)) {
    lots.push(check(id, "fail"));
    for (let i = 0; i < 6; i++) lotsOfSpots.push(spot(CHECK_SPOTS[id][0], 100 + i * 30 + lots.length * 400));
  }
  const capped = buildPins(lots, lotsOfSpots);
  assert(capped.length <= MAX_PINS, `the picture carries at most ${MAX_PINS} pins (${capped.length})`);

  // When the cap bites it drops the least serious, not whatever sat lowest.
  const mixed = buildPins(
    [check("image-alt", "warn"), check("one-h1", "fail")],
    (() => { const s: RenderSpot[] = []; for (let i = 0; i < 20; i++) s.push(spot("image-no-alt", 100 + i * 20)); s.push(spot("h1", 5000)); return s; })()
  );
  assert(mixed.some((p) => p.checkId === "one-h1"), "a failure is placed even when warnings could fill the picture");

  // Two findings never stack two badges on one element.
  const oneSpot = [spot("heading", 300)];
  const stacked = buildPins([check("heading-hierarchy", "fail"), check("question-headings-live", "warn")], oneSpot);
  assert(stacked.length === 1, "one element carries one badge, not two on top of each other");
}

// ── 3b. One problem marked six times is still one problem ──────────────────
//
// Seen on the first real report: three identical "Question-shaped headings"
// entries in a row, each repeating the same evidence and the same remedy. That
// reads as three problems and wastes the page it is printed on.
console.log("\n3b. Grouping");
{
  const spots = [spot("heading", 100, 40, "Scale digital content"), spot("heading", 300, 40, "Raise brand awareness"), spot("heading", 500, 40, "Grow audiences"), spot("h1", 200, 40, "The title")];
  const pins = buildPins([check("question-headings-live", "warn"), check("one-h1", "fail")], spots);
  const groups = groupPins(pins);

  assert(pins.length === 4, `four badges on the picture (${pins.length})`);
  assert(groups.length === 2, `but two entries in the list (${groups.length})`);
  const headings = groups.filter((g) => g.checkId === "question-headings-live")[0];
  assert(!!headings && headings.ns.length === 3, "the repeated finding carries all three of its badge numbers");
  assert(headings.labels.length === 3, "and names each element it marked, so they can be told apart");
  assert(groups[0].ns[0] < groups[1].ns[0], "the list still runs down the page, ordered by first badge");
  // The picture keeps every badge: each one points somewhere different.
  assert(pins.filter((p) => p.checkId === "question-headings-live").length === 3, "the badges are not collapsed on the picture itself");
}

// ── 4. Everything else is shown, not dropped ───────────────────────────────
console.log("\n4. The findings with nowhere to point");
{
  const checks = [
    check("one-h1", "fail"),
    check("meta-description", "fail"),
    check("canonical", "warn"),
    check("og-tags", "pass"),
  ];
  const pins = buildPins(checks, [spot("h1", 100)]);
  const rest = unpinnedFindings(checks, pins);

  assert(rest.length === 2, `the two invisible problems come back separately (${rest.length})`);
  assert(rest.map((c) => c.id).indexOf("meta-description") >= 0, "including the missing description");
  assert(rest.map((c) => c.id).indexOf("og-tags") < 0, "and a passing check is not listed as a problem");
  assert(pins.length + rest.length === checks.filter((c) => c.status === "fail" || c.status === "warn").length,
    "every failure and warning is either marked or listed — none is dropped");
}

// ── 4b. The annotated figure ───────────────────────────────────────────────
//
// A callout layout fails in exactly two ways, and both are geometric: two notes
// want the same vertical space and overlap, or the notes on one side run in a
// different order from the things they point at, so the connectors cross. Both
// are properties of the arithmetic, so both can be asserted rather than
// eyeballed at one width with one set of findings.
console.log("\n4b. Notes around the page");
{
  const shot = { width: 900, height: 4000, scale: 900 / 1280 };
  const crowd: RenderSpot[] = [];
  // Six things within a few pixels of each other, three a side: the case that
  // makes a naive "put the note level with its target" layout collapse.
  for (let i = 0; i < 6; i++) crowd.push(spot("image-no-alt", 700 + i * 12, i % 2 === 0 ? 60 : 900));
  const pins = buildPins([check("image-alt", "fail"), check("one-h1", "warn")], crowd.concat([spot("h1", 2600)]));
  const fig = layoutFigure(pins, shot);

  // ONE figure, not one per finding. Six near identical crops of a page whose
  // findings are all the same kind read as one issue repeated six times, which
  // is exactly how the banded version was reported.
  assert(fig.callouts.length === pins.length, `every pin gets a note on the one figure (${fig.callouts.length})`);
  assert(!anyOverlap(fig), "no note overlaps another in its column, even with six findings a dozen pixels apart");
  assert(ordersMatch(fig), "and the notes run in the same order as the things they point at, so the lines cannot cross");
  // THE PICTURE IS SCALED, THE NOTES ARE NOT. Laid out in image pixels and
  // scaled with the figure, a note on a five-thousand-pixel page came out ten
  // pixels tall. And a figure drawn at full size is four thousand pixels of
  // scrolling, one note per screen, which is what "one repeated issue" felt
  // like.
  assert(fig.previewHeight <= FIGURE_MAX_HEIGHT + 1, `the preview is capped at ${FIGURE_MAX_HEIGHT}px (${Math.round(fig.previewHeight)})`);
  assert(fig.previewWidth > 0 && fig.previewHeight > 0, "and keeps a real size");
  assert(Math.abs(fig.previewWidth / fig.previewHeight - shot.width / shot.height) < 0.01, "at the page's own proportions");

  const deepest = fig.callouts.reduce((n: number, c) => Math.max(n, c.top + CARD_HEIGHT), 0);
  assert(fig.height >= deepest, "the figure is tall enough for the notes, so a long column cannot run off the bottom");
  assert(fig.height >= fig.previewHeight, "and at least as tall as the picture");

  // A very tall page must not shrink its notes with it.
  const tall = layoutFigure(pins, { width: 900, height: 9000, scale: 0.703 });
  assert(tall.callouts.every((c) => c.top >= 0), "notes on a very long page still sit inside the figure");
  assert(tall.previewHeight <= FIGURE_MAX_HEIGHT + 1, "whose preview is capped rather than drawn at full length");

  const sides = new Set(fig.callouts.map((c) => c.side));
  assert(sides.size === 2, "notes are placed on both sides of the page");

  // A pin past the bottom of a clipped capture has nothing to point at.
  const off = layoutFigure(buildPins([check("one-h1", "fail")], [spot("h1", 99999)]), shot);
  assert(off.callouts.length === 0, "a finding past the end of the capture is left out of the figure rather than drawn off the edge");
}

// ── 4c. The close-ups, which are the part that cannot drift ────────────────
//
// A mark drawn at a coordinate depends on that coordinate still describing the
// page when the picture was assembled, and four separate things turned out to
// break that. A crop carries its own evidence: whatever is in it IS the
// element, because it was cut from the pixels the element was measured in.
console.log("\n4c. Close-ups");
{
  const withCrop: RenderSpot = { ...spot("heading", 300, 40, "A heading"), crop: "data:image/jpeg;base64,AAAA", cropWidth: 620, cropHeight: 120 };
  const pins = buildPins([check("heading-hierarchy", "fail")], [withCrop]);
  assert(pins.length === 1 && pins[0].crop === "data:image/jpeg;base64,AAAA", "a pin carries the close-up of its own element");

  const grouped = groupPins(pins);
  assert(grouped[0].pins.length === 1 && !!grouped[0].pins[0].crop, "and the grouped finding still has it, so the report can show one per mark");

  const render = stripComments(read("lib/optimizer/render.ts"));
  assert(/CROP_KINDS\.indexOf\(sp\.kind\) >= 0 && cropped < MAX_CROPS/.test(render),
    "only the kinds a finding can point at are cropped, and the number is bounded — each one is an image inside a JSON response");
  assert(/sharpLib\(tile\)\s*\n?\s*\.extract\(\{ left: 0, top, width: 1280, height \}\)/.test(render),
    "and each crop is cut from THIS tile, the screenshot the element was measured in");
  const cropAt = render.indexOf("CROP_KINDS.indexOf");
  const tileAt = render.indexOf("const tile = (await page.screenshot");
  assert(tileAt > 0 && cropAt > tileAt, "cut after the tile is photographed, from the same pixels");

  const ui = stripComments(read("components/optimizer/AuditReport.tsx"));
  assert(/g\.pins\.filter\(\(p\) => p\.crop\)/.test(ui), "the report shows a close-up per mark");
  assert(/alt=\{p\.label \|\| "The marked element"\}/.test(ui), "with alt text, because a report gets forwarded and read in a mail client");
}

// ── 5. Placing a pin on a picture ──────────────────────────────────────────
console.log("\n5. Geometry");
{
  const shot = { width: 900, height: 900, scale: 900 / 1280 };
  const at = pinPercent({ n: 1, checkId: "x", name: "x", status: "fail", detail: "", remedy: "", x: 640, y: 640, w: 128, h: 64, label: "" }, shot);
  assert(Math.round(at.left) === 50, `an element halfway across the render sits halfway across the picture (${at.left.toFixed(1)}%)`);
  assert(at.width > 0 && at.height > 0, "and has a real size");
  assert(at.offPicture === false, "an element inside the capture is on the picture");

  const below = pinPercent({ n: 1, checkId: "x", name: "x", status: "fail", detail: "", remedy: "", x: 0, y: 9000, w: 100, h: 20, label: "" }, shot);
  assert(below.offPicture === true, "and one past the bottom of a clipped capture is honestly reported as off it");

  const tiny = pinPercent({ n: 1, checkId: "x", name: "x", status: "fail", detail: "", remedy: "", x: 10, y: 10, w: 0, h: 0, label: "" }, shot);
  assert(tiny.width > 0 && tiny.height > 0, "a zero-sized element still gets a visible marker");
}

// ── 6. Counts, and still no score ──────────────────────────────────────────
console.log("\n6. No total");
{
  const PAGE = `<!doctype html><html><head><title>T</title></head><body><article><h1>A</h1>${
    Array.from({ length: 12 }, (_, i) => `<p>Paragraph ${i} with enough words in it to read as real prose for the audit.</p>`).join("")
  }<img src="/a.jpg"></article></body></html>`;
  const audit = auditPage(
    { page: PAGE, finalUrl: "https://example.com/a", httpStatus: 200, brandNames: [], targetQueries: [], render: null, robotsTxt: null, llmsTxt: null },
    new Date("2026-08-28T00:00:00Z")
  );
  const counts = auditHeadline(audit.checks);
  assert(counts.fail + counts.warn + counts.pass + counts.info === audit.checks.length, "every check is counted exactly once");
  assert(counts.fail === audit.counts.fail && counts.warn === audit.counts.warn && counts.pass === audit.counts.pass,
    "and the report's counts are the audit's own, not a second tally");

  // Whitespace-normalised before matching. JSX wraps its own prose across
  // lines, so "not weighted against each other" arrives with a newline and
  // eight spaces inside it — and an assertion that does not know this fails on
  // copy that is present and correct.
  const ui = stripComments(read("components/optimizer/AuditReport.tsx")).replace(/\s+/g, " ");
  assert(/counts\.fail/.test(ui) && /counts\.warn/.test(ui) && /counts\.pass/.test(ui), "it shows the three counts instead");
  assert(/not weighted against each other/.test(ui), "and says why there is no total");
  // The word "score" is allowed exactly where it is REFUSED. What must not
  // exist is arithmetic producing one.
  assert(/do not total to a score/.test(ui), "the report states plainly that the checks do not total");
  assert(
    !/(counts\.fail|counts\.warn|counts\.pass)\s*[+\-*/]\s*(counts|\d)/.test(ui),
    "and nothing in it combines the counts into a figure"
  );
  assert(!/Math\.round\(\s*\(?\s*counts\./.test(ui), "nor rounds one into existence");
}

// ── 7. The report says what it could not show ──────────────────────────────
console.log("\n7. Honesty in the report");
{
  const ui = stripComments(read("components/optimizer/AuditReport.tsx"));
  assert(/shot\.clipped/.test(ui), "a picture that stops early says so");
  assert(/unpinnedFindings/.test(ui), "the findings with nowhere to point are rendered");
  assert(/Not visible on the page/.test(ui), "under a heading that explains why they carry no marker");
  assert(/status === "info"/.test(ui) && /Not measured/.test(ui), "and the unmeasured checks are shown as unmeasured");
  assert(/These are not passes/.test(ui), "stated in words, because an absent check reads as a passing one");
  assert(/No preview for this page/.test(ui), "and a failed render degrades to the findings rather than to nothing");
}

// ── 8. It is built to be printed ───────────────────────────────────────────
console.log("\n8. Print");
console.log("   (the whole point: a PDF someone can send to a client)");
{
  const ui = read("components/optimizer/AuditReport.tsx");
  assert(/@media print/.test(ui), "there is a print stylesheet");
  assert(/@page \{ size: A4/.test(ui), "on a real page size");
  // Named per selector. `/break-inside: avoid/` alone matched the picture's own
  // rule, so deleting the one that governs FINDINGS survived the check.
  assert(/\.audit-finding \{[^}]*break-inside: avoid/.test(ui), "a finding does not break across two pages");
  // The figure now, rather than the old single picture: each annotated band is
  // a <figure> and must survive a page break intact, or a note lands on one
  // page and the thing it points at on the next.
  assert(/figure \{[^}]*break-inside: avoid/.test(ui), "and neither does an annotated figure");
  assert(/audit-no-print/.test(ui) && /display: none !important/.test(ui), "and the app's own chrome is dropped from the printed document");
  assert(/window\.print\(\)/.test(ui), "with a control that prints it");

  const panel = read("components/optimizer/PageAudit.tsx");
  assert(/setView\("report"\)/.test(panel), "the panel offers the report");
  assert(/audit-print-root/.test(panel), "and marks the region print targets");
}

// ── 9. The picture is actually captured, and bounded ───────────────────────
console.log("\n9. Capture");
{
  const render = stripComments(read("lib/optimizer/render.ts"));
  assert(/opts\?\.shot/.test(render), "the screenshot is opt-in — most callers do not want the cost");
  assert(/SHOT_MAX_HEIGHT/.test(render) && /clipped: docHeight > SHOT_MAX_HEIGHT/.test(render),
    "a tall page is captured to a cap and the clipping is recorded rather than hidden");

  // THE VIEWPORT NEVER CHANGES DURING A CAPTURE, and this is the whole reason
  // the marks land where they should. A clipped screenshot taller than the
  // viewport is taken by expanding the viewport, which re-lays-out the page:
  // sections sized in viewport units move, and coordinates measured before
  // describe a page that no longer exists. Measured on a real page: a heading
  // at y=2,390 became y=3,650, and it did not converge across rounds — 4,357,
  // 6,196, 8,709 — because taller sections make a taller document.
  const shotRegion = render.slice(render.indexOf("let shot: RenderShot | null = null"), render.indexOf("await close();"));
  assert(!/setViewport/.test(shotRegion), "the viewport is never resized while the page is being measured or photographed");
  assert(/const tile = \(await page\.screenshot\(\{ type: "png" \}\)\)/.test(shotRegion),
    "each tile is a plain viewport screenshot — a clip is measured in DOCUMENT coordinates and photographed the top of the page every time");
  assert(/const at: number = await page\.evaluate\(`Math\.round\(window\.scrollY\)`\)/.test(shotRegion),
    "and its real scroll position is read back, because the last tile cannot reach its nominal offset");

  // MEASURED INSIDE THE TILE, at the instant it is photographed. A page with
  // scroll-driven layout is not the same shape at scroll 0 as at scroll 2,400,
  // so coordinates taken once at the top described a layout that no longer
  // existed lower down and every mark drifted further off the further it sat.
  // An element's position is this tile's offset plus its offset within the
  // tile: correct by construction rather than by timing.
  assert(/const tileSpots: any\[\] = await page\.evaluate/.test(shotRegion), "the elements are measured tile by tile");
  assert(/spotted\.push\(\{ \.\.\.sp, y: sp\.y \+ at,/.test(shotRegion),
    "and their positions are the tile's own offset plus their offset within it");
  assert(/if \(r\.top < 0 \|\| r\.top > window\.innerHeight - 8\) return;/.test(shotRegion),
    "an element outside this viewport belongs to the tile that actually photographed it");

  // NO TILE PAINTS OVER ROWS ALREADY PHOTOGRAPHED. The last tile cannot reach
  // its nominal offset, so it overlaps the one before it; composited whole it
  // overwrites those rows with pixels laid out at a different scroll position,
  // and every element measured in the earlier tile stops matching what is under
  // its mark. This was the cause that made SOME marks right and others wrong on
  // the same page, which is what finally identified it.
  assert(/const overlap = Math\.max\(0, covered - at\)/.test(shotRegion), "an overlapping tile is cropped rather than composited whole");
  assert(/\.extract\(\{ left: 0, top: overlap/.test(shotRegion), "by the size of the overlap");
  assert(/top: at \+ overlap/.test(shotRegion), "and placed below what is already there");
  assert(/if \(sp\.y < overlap\) continue;/.test(shotRegion),
    "and an element inside that overlap keeps the measurement from the tile that photographed it");
  assert(/position;\n              if \(pos !== "fixed"\) continue;/.test(shotRegion) || /pos !== "fixed"/.test(shotRegion),
    "a fixed header is hidden for every tile but the first, or it repeats down the picture");
  assert(/quality: 72/.test(render) && /resize\(\{ width: SHOT_WIDTH \}\)/.test(render), "and the image is scaled and compressed before it is sent");
  // Failure to capture must not cost the audit.
  const region = render.slice(render.indexOf("let shot: RenderShot | null = null"), render.indexOf("await close();"));
  assert(/catch \(e: any\)/.test(region) && !/throw/.test(region), "a screenshot that fails is warned about, never thrown — an audit without a picture is still an audit");

  // The page must STOP MOVING before it is measured or captured. Revealing a
  // hidden section starts its images loading, and one that arrives afterwards
  // pushes everything below it down — so the marks were drawn from coordinates
  // the picture no longer agreed with, every box above its heading, the gap
  // growing further down the page.
  assert(/im\.complete/.test(render) && /documentElement\.scrollHeight/.test(render),
    "the capture waits for every image and for the document height to stop changing");
  assert(/i < 20/.test(render), "and the wait is bounded — a page with a carousel never settles");
  // The settle comes before the capture loop, and the measurement now happens
  // INSIDE it — one tile at a time, beside the screenshot of that tile.
  const settleAt = render.indexOf("im.complete");
  const loopAt = render.indexOf("for (let i = 0; i < tiles; i++)");
  const measureSpotsAt = render.indexOf("const tileSpots");
  const shootAt = render.indexOf('page.screenshot({ type: "png" })');
  assert(settleAt > 0 && settleAt < loopAt, "the settle happens before anything is measured or photographed");
  assert(loopAt < measureSpotsAt && measureSpotsAt < shootAt,
    "and each tile is measured and photographed together, in that order");

  // A label quotes the client's own words back at them, so it must be the
  // WHOLE string. innerText omits anything hidden at that instant, and a page
  // that splits its headings into per-letter spans for an animation therefore
  // produced "Boo t your trategic event communication" in a client report.
  assert(/el\.textContent \|\| el\.getAttribute\("alt"\)/.test(render),
    "a spot's label is taken from the complete text, not from what happens to be visible");
  assert(!/\(el\.innerText \|\| el\.getAttribute\("alt"\)/.test(render), "and innerText is not used for it");

  // THE ESCAPE. Every regex inside these blocks is a TEMPLATE LITERAL handed to
  // page.evaluate as a string, where \s is not a valid escape and collapses to a
  // bare "s". A single-backslash \s therefore compiles to /s+/g in the browser
  // and replaces every letter s with a space: a client's heading reached the
  // report as "Boo t your trategic event communication ". The file's original
  // author knew this; the line added beside theirs did not.
  const evals = render.split("page.evaluate(`").slice(1).join("");
  const singleS = (evals.match(/replace\(\/(?<!\\)\\s\+/g) || []).length;
  assert(singleS === 0, `no regex inside an evaluated block escapes whitespace with a single backslash (${singleS} found)`);
  assert(/replace\(\/\\\\s\+\/g/.test(evals), "and the ones that need it use the double backslash");

  // The consent overlay, which is not part of the page being audited.
  assert(/cookie" i\]/.test(render) && /consent" i\]/.test(render), "a cookie banner is hidden before the picture is taken");
  assert(/pos === "fixed" \|\| pos === "sticky"/.test(render),
    "and only when it is fixed or sticky — hiding every element named cookie would take real content with it");
  // Scroll-reveal sections. A capture full of empty bands looks like a broken
  // tool rather than a page with problems.
  assert(/animation:none !important;transition:none !important/.test(render), "animations are stopped before the capture");
  assert(/parseFloat\(cs\.opacity\) > 0\.05/.test(render), "and elements left invisible by a scroll reveal are shown");
  // HEADINGS, which the first version's selector omitted — so a page whose
  // section headings fade in produced numbered boxes around visibly nothing,
  // and every pin on a heading pointed at blank space.
  const revealSel = render.slice(render.indexOf("querySelectorAll(\n            \"h1"), render.indexOf("querySelectorAll(\n            \"h1") + 200);
  assert(/h1,h2,h3/.test(revealSel), "including headings, which is what a heading pin points at");
  assert(/!\(el\.textContent \|\| ""\)\.trim\(\) && !el\.querySelector\("img"\)/.test(render),
    "only where they carry content — a decorative hidden layer stays hidden");

  const hideAt = render.indexOf('[id*="cookie"');
  const measureAt = render.indexOf("const measured");
  assert(measureAt > 0 && hideAt > measureAt, "hidden AFTER the measurement pass, so it cannot change a single finding");

  const route = stripComments(read("app/api/optimizer/sessions/[id]/audit/route.ts"));
  assert(/renderPage\(fetched\.finalUrl, 20_000, \{ shot: true \}\)/.test(route), "the audit route asks for one");
  assert(/shot: render\.shot/.test(route) && /spots: render\.spots/.test(route), "and passes it to the client");
}

// ── Self-test ──────────────────────────────────────────────────────────────
if (process.argv.includes("--self-test")) {
  console.log("\n── self-test: each detector against input that should trip it ──");
  let selfFail = 0;
  const must = (ok: boolean, what: string) => {
    if (ok) console.log(`  ✓ fires on ${what}`);
    else { selfFail++; console.log(`  ✗ SILENT on ${what}`); }
  };

  must(buildPins([check("meta-description", "fail")], [spot("h1", 10)]).length === 0, "an invisible check being pinned");
  must(buildPins([check("one-h1", "pass")], [spot("h1", 10)]).length === 0, "a passing check being marked");
  const many: RenderSpot[] = [];
  for (let i = 0; i < 30; i++) many.push(spot("image-no-alt", i * 40));
  must(buildPins([check("image-alt", "fail")], many).length <= MAX_PINS_PER_CHECK, "an uncapped pin count");
  must(pinPercent({ n: 1, checkId: "x", name: "x", status: "fail", detail: "", remedy: "", x: 0, y: 99999, w: 10, h: 10, label: "" },
    { width: 900, height: 900, scale: 0.7 }).offPicture, "a pin past the bottom being placed anyway");
  const rest = unpinnedFindings([check("meta-description", "fail")], []);
  must(rest.length === 1, "an unpinned finding being dropped");
  must(/(counts\.fail|counts\.pass)\s*[+\-*/]\s*(counts|\d)/.test("const total = counts.pass + counts.fail;"),
    "the counts being combined into a figure");
  must(!/not weighted against each other/.test("a report with no disclaimer"), "the disclaimer going missing");

  if (selfFail > 0) {
    console.log(`\n✗ ${selfFail} detector(s) silent — refusing to report the run above as meaningful.`);
    process.exit(1);
  }
  console.log("  all detectors fire");
}

console.log(failures === 0 ? "\n✓ the audit report holds\n" : `\n✗ ${failures} failure(s)\n`);
process.exit(failures === 0 ? 0 : 1);
