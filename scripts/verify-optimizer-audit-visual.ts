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

  // A zero-height element would otherwise be an invisible box with a badge
  // floating beside nothing.
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
  assert(/No screenshot for this page/.test(ui), "and a failed render degrades to the findings rather than to nothing");
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
  assert(/\.audit-shot \{[^}]*break-inside: avoid/.test(ui), "and neither does the picture");
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
  assert(/quality: 72/.test(render) && /resize\(\{ width: SHOT_WIDTH \}\)/.test(render), "and the image is scaled and compressed before it is sent");
  // Failure to capture must not cost the audit.
  const region = render.slice(render.indexOf("let shot: RenderShot | null = null"), render.indexOf("await close();"));
  assert(/catch \(e: any\)/.test(region) && !/throw/.test(region), "a screenshot that fails is warned about, never thrown — an audit without a picture is still an audit");

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
