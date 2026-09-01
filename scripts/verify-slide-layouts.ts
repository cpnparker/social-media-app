/**
 * Every slide layout, drawn and inspected.
 *
 * The bugs this exists for were all invisible in code and obvious the moment
 * something rendered them: a standfirst overlapping the title box, a white
 * lockup on a pale sky at 1.23:1, a white lockup on off-white after the fix for
 * the pale sky was applied to a layout where the logo is not on the photograph,
 * and a preview silently dropping the scrim's alpha.
 *
 * None were reported by a user. All were found by looking at every layout at
 * once, which is a thing to run rather than to remember.
 */
import {
  buildSlideRequests, textBandsFor, splitOverflowingSlides, isoDate, isVisualSlide,
  estimateLines, drawnTextHeight, inheritContinuationImages, resolveDeckImages,
  niceTicks, isNumericColumn, fitCell, fitColumnWidths, parseAccents, deckWarnings,
  type SlideInput,
} from "../lib/slides/generate";
import { toPreviewModel } from "../lib/slides/preview-model";
import { applyEditSlide, unrenderableSlides, PAYLOAD_FIELDS, insertableLayout } from "../lib/slides/edit";
import { prepareSlidesForBuild, sourceSlideCount, fidelityAudit } from "../lib/ai/providers";
import { readFileSync } from "fs";
import { join } from "path";
import { gradientProfileFor, CONTRAST } from "../lib/slides/images";
import { CANVAS, LAYOUT_STYLE, COLOR, GRID, LAYOUTS } from "../lib/slides/brand";

const TYPE_STAT_CAP = 54;   // the multi-stat value cap; a hero must exceed it
let failures = 0;
const fail = (m: string) => { failures++; console.log(`  FAIL  ${m}`); };
const pass = (m: string) => console.log(`  ok    ${m}`);

/** Deliberately awkward content: two-line titles and long labels are what turn
 *  a comfortable layout into a collision. */
const PHOTO_DARK = { url: "p.jpg", scrim: 0, logo: "white" as const };
const PHOTO_PALE = { url: "p.jpg", scrim: 0, logo: "navy" as const };
const LONG = "A title long enough to wrap onto two lines on any layout";

const DECK: SlideInput[] = [
  { layout: "cover", title: LONG, subtitle: "Prepared for a client — August 2026", resolvedImage: PHOTO_DARK },
  { layout: "section", eyebrow: "01", title: LONG, subtitle: "A standfirst that also runs long enough to wrap." },
  { layout: "content", eyebrow: "Eyebrow", title: LONG, body: "One\nTwo\nThree" },
  { layout: "two-column", title: LONG, subtitle: "A standfirst that also runs long enough to wrap onto a second line here.",
    columns: { left: "Yesterday", right: "Today" },
    body: "Ten blue links to choose from\nYou picked the source\nThe brand controlled its own page", bodyRight: "One synthesised answer\nThe model picks the sources\nYou influence the inputs, not the page" },
  { layout: "case-study", eyebrow: "case study", title: LONG, body: "A supporting paragraph of reasonable length." },
  { layout: "dark-index", title: LONG, body: "One\nTwo\nThree\nFour" },
  { layout: "timeline", eyebrow: "Programme", title: LONG, subtitle: "A standfirst that wraps onto two lines here too.",
    milestones: [
      { date: "3 July", title: "Setup", detail: "Baseline collection begins." },
      { date: "18–24 August", title: "Questionnaire", detail: "Inputs shape the prompt set.", highlight: true },
      { date: "26–27 August", title: "Briefing", detail: "Two sessions." },
      { date: "31 August", title: "Calibration", detail: "Prompt set locked." },
    ] },
  { layout: "timeline-parallel", eyebrow: "Programme", title: LONG, subtitle: "A standfirst that wraps onto two lines.",
    today: "2026-08-19",
    tracks: [
      { name: "AuthorityOn audit", phases: [
        { start: "2026-07-03", end: "2026-08-24", label: "Setup & baseline" },
        { start: "2026-08-18", end: "2026-08-24", label: "Questionnaire" },
        { start: "2026-09-01", end: "2026-10-15", label: "Ongoing tracking" } ] },
      { name: "AI Visibility briefing", phases: [
        { start: "2026-08-26", end: "2026-08-27", label: "Briefing" },
        { start: "2026-08-31", label: "Calibration" } ] },
    ] },
  { layout: "image-split", eyebrow: "Approach", title: LONG, body: "One\nTwo\nThree", resolvedImage: PHOTO_DARK },
  { layout: "image-grid", title: LONG,
    images: Array.from({ length: 6 }, (_, i) => ({ caption: `Caption ${i + 1}` })),
    resolvedImages: Array.from({ length: 6 }, (_, i) => ({ url: "p.jpg", caption: `Caption ${i + 1}` })) },
  { layout: "feature", eyebrow: "Case study", title: LONG, body: "A supporting line under the statement.", resolvedImage: PHOTO_PALE },
  { layout: "stat", eyebrow: "Numbers", title: LONG,
    stats: [
      { value: "64 GW", label: "Global capacity", detail: "Installed by end of 2023." },
      { value: "70%", label: "Cost fall since 2010", detail: "Competitive with fossil." },
      { value: "380 GW", label: "IEA projection", detail: "Under current policies." } ] },
  { layout: "bar-chart", eyebrow: "Capacity", title: LONG,
    subtitle: "A standfirst stating the finding the bars prove, long enough to wrap onto two lines.",
    chart: { source: "Source: a report with a long name, 2024", highlight: 1,
      benchmark: { value: 20, label: "Sector average" }, callout: { point: 1, text: "Fastest-growing market" },
      series: [{ name: "GW", points: [
      { label: "United Kingdom", value: 14.7 }, { label: "China", value: 31.4 },
      { label: "Germany", value: 8.3 }, { label: "Denmark", value: 2.3 } ] }] } },
  { layout: "line-chart", eyebrow: "Momentum", title: LONG,
    subtitle: "A standfirst that also runs long enough to wrap onto a second line.",
    chart: { source: "Programme readouts", highlight: 5, benchmark: { value: 20, label: "Where you started" },
      series: [
        { name: "Rigiwald", points: [{ label: "Jan", value: 6 }, { label: "Feb", value: 11 }, { label: "Mar", value: 19 }, { label: "Apr", value: 28 }, { label: "May", value: 34 }, { label: "Jun", value: 38 }] },
        { name: "Sector average", points: [{ label: "Jan", value: 20 }, { label: "Feb", value: 21 }, { label: "Mar", value: 22 }, { label: "Apr", value: 22 }, { label: "May", value: 23 }, { label: "Jun", value: 24 }] } ] } },
  { layout: "swot", eyebrow: "Diagnostic", title: LONG, subtitle: "A standfirst that runs long enough to wrap here.",
    swot: { strengths: ["Strong brand recall in-market", "A consistent editorial voice"], weaknesses: ["Thin Wikipedia footprint", "No schema markup on key pages"],
      opportunities: ["First mover on AI visibility", "Owned data nobody else has"], threats: ["Two rivals investing fast", "Hallucinated facts spreading"] } },
  { layout: "matrix", eyebrow: "Priorities", title: LONG, subtitle: "Impact against effort, every recommendation.",
    matrix: { xAxis: ["Low effort", "High effort"], yAxis: ["Low impact", "High impact"], quadrants: ["Quick wins", "Big bets", "Fill-ins", "Time sinks"],
      items: [{ label: "Schema markup", x: 0.18, y: 0.85, highlight: true }, { label: "Wikipedia entry", x: 0.75, y: 0.9 }, { label: "Rewrite exec bios", x: 0.4, y: 0.45 }, { label: "Full site rebuild", x: 0.9, y: 0.28 }] } },
  { layout: "table", eyebrow: "The picture today", title: LONG,
    subtitle: "A standfirst above the table, long enough to wrap onto a second line.",
    table: { columns: ["Domain competing for our queries", "Shared KW", "Their traffic", "DR"], highlight: [0],
      rows: [
        ["holcim.com, the legacy parent domain", "108", "8,853", "76"],
        ["holcimgroup.com, the legacy group site", "30", "493", "47"],
        ["holcim.co.uk, a UK site on US queries", "25", "2,981", "65"],
        ["holcimalpenaconnect.com, an orphaned plant site", "19", "49", "0.9"] ] } },
  { layout: "comparison", eyebrow: "The choice", title: LONG, subtitle: "Against the two agencies you shortlisted.",
    comparison: { columns: ["Us", "Agency A", "Agency B"], rows: [
      { label: "AI-answer testing across models", cells: ["yes", "no", "no"], highlight: true },
      { label: "Weekly visibility readouts", cells: ["yes", "yes", "no"] },
      { label: "Fixed, published fee", cells: ["CHF 12,500", "CHF 20k+", "Retainer"] },
      { label: "Wikidata & entity work", cells: ["yes", "no", "no"] } ] } },
  { layout: "scatter", eyebrow: "The pattern", title: LONG, subtitle: "Hours invested against AI citations earned, per piece.",
    scatter: { xAxis: "Hours invested", yAxis: "AI citations", points: [
      { x: 2, y: 40, label: "Explainer", group: "Owned" }, { x: 8, y: 12, group: "Owned" }, { x: 3, y: 55, label: "Data study", group: "Owned" },
      { x: 12, y: 9, group: "Earned" }, { x: 9, y: 60, label: "Wikipedia", group: "Earned" }, { x: 7, y: 30, group: "Earned" } ] } },
  { layout: "venn", eyebrow: "The opportunity", title: LONG, subtitle: "The sweet spot is small and yours.",
    venn: { sets: [{ label: "What buyers ask AI" }, { label: "What you can credibly say" }], overlap: "Your content plan" } },
  { layout: "venn", eyebrow: "The model", title: "Three forces move AI visibility",
    venn: { sets: [{ label: "Authority" }, { label: "Consistency" }, { label: "Freshness" }] } },
  { layout: "stacked-bar", eyebrow: "Mix", title: LONG,
    chart: { source: "Source: delivery data", series: [
      { name: "Articles", points: [{ label: "Holcim", value: 38 }, { label: "Siemens", value: 22 }] },
      { name: "Video", points: [{ label: "Holcim", value: 26 }, { label: "Siemens", value: 18 }] },
      { name: "Infographics", points: [{ label: "Holcim", value: 19 }, { label: "Siemens", value: 11 }] } ] } },
  { layout: "cards", eyebrow: "What we do", title: LONG, cards: [
      { marker: "01", title: "Competitive share of voice", body: "Benchmarked against 4-6 peer institutions across every prompt category." },
      { marker: "02", title: "Source citation analysis", body: "Which domains, publications and pages drive AI responses in your sector." },
      { marker: "03", title: "Technical GEO foundations", body: "Full audit of the infrastructure AI crawlers rely on: schema, llms.txt, Wikidata." },
      { marker: "04", title: "Accuracy & hallucination report", body: "Every factual error or fabricated detail AI is producing about you, with a fix." } ] },
  { layout: "cards", title: "Numbered steps, with pictures", cards: [
      { marker: "01", title: "Setup", body: "A body with a [link](https://example.com/a) in it.", resolvedImage: { url: "p.jpg" } },
      { marker: "02", title: "Questionnaire", body: "Short.", resolvedImage: { url: "p.jpg" } },
      { marker: "03", title: "Briefing", body: "Short.", resolvedImage: { url: "p.jpg" } },
      { marker: "04", title: "Calibration", body: "Short.", resolvedImage: { url: "p.jpg" } } ] },
  { layout: "quote", eyebrow: "Client",
    quote: { text: "Daily, high-quality content changed how the market talks about us, and it did so faster than any campaign we have run.",
             name: "Nollaig Forrest", role: "Chief Sustainability Officer, Holcim" } },
  { layout: "process", eyebrow: "How it works", title: LONG, stages: [
      { name: "Ideation", caption: "What stories to tell and how to tell them." },
      { name: "Commissioning", caption: "Formats, briefs and talent." },
      { name: "Production", caption: "Workflow, oversight and approvals." },
      { name: "Distribution", caption: "Planning, publishing and campaigns." },
      { name: "Analytics", caption: "Insights fed back into the process." } ] },
  { layout: "logo-wall", eyebrow: "Clients", title: LONG,
    logos: Array.from({ length: 8 }, (_, i) => ({ name: `Client ${i + 1}`, resolvedUrl: "logo.png" })) },
  { layout: "closing", title: "Let's map your AI visibility", subtitle: "The next step",
    body: "hello@thecontentengine.com\nBook a 30-minute call\nthecontentengine.com", resolvedImage: PHOTO_DARK },
];

/** The same layouts fed the amounts of data a model will actually send.
 *
 *  Every one of these was a real defect found by audit rather than by use: a
 *  bar chart's source line 8pt below the bottom edge, a ten-category stacked
 *  bar whose last two rows and entire legend were off the slide, a five-track
 *  timeline whose shared axis — the reason that layout exists — was off the
 *  canvas with all its ticks, a late milestone's label at x=790 on a 720pt
 *  slide, and a negative value drawn as the LONGEST bar on a ranking chart.
 *
 *  The tool schema puts no maxItems on any of these, so "the model would not
 *  send that" was never true. */
const STRESS: SlideInput[] = [
  { layout: "bar-chart", title: "Twelve categories, more than fit",
    chart: { source: "Source: internal data", series: [{ name: "GW", points:
      Array.from({ length: 12 }, (_, i) => ({ label: `Category ${i + 1}`, value: 100 - i * 7 })) }] } },
  { layout: "bar-chart", title: "A ranking that crosses zero",
    chart: { source: "Source: internal data", series: [{ name: "Change", points: [
      { label: "Growth", value: 5 }, { label: "Flat", value: 0 }, { label: "Churn", value: -100 } ] }] } },
  { layout: "stacked-bar", title: "Ten categories and a negative part",
    chart: { source: "Source: internal data", series: [
      { name: "Gross", points: Array.from({ length: 10 }, (_, i) => ({ label: `Category ${i + 1}`, value: 40 + i })) },
      { name: "Adjustment", points: Array.from({ length: 10 }, (_, i) => ({ label: `Category ${i + 1}`, value: -20 - i })) } ] } },
  { layout: "timeline-parallel", title: "Five tracks with late labels", today: "2026-08-19",
    tracks: Array.from({ length: 5 }, (_, i) => ({ name: `Workstream ${i + 1}`, phases: [
      { start: "2026-01-01", end: "2026-03-01", label: `Phase ${i + 1}` },
      { start: "2026-06-01", label: "A late milestone with a long label" } ] })) },
  { layout: "table", title: "Twenty rows and eight columns, more than fit",
    table: {
      columns: Array.from({ length: 8 }, (_, j) => `A column heading number ${j + 1}`),
      rows: Array.from({ length: 20 }, (_, i) =>
        Array.from({ length: 8 }, (_, j) => (j === 0 ? `A first-column label that runs on, row ${i + 1}` : String((i + 1) * (j + 1) * 137)))),
      highlight: [0, 19] } },
  { layout: "logo-wall", title: "Clients whose marks we do not have",
    logos: [{ name: "Holcim", resolvedUrl: "logo.png" }, { name: "Siemens Energy" }, { name: "Hiscox" }] },
  { layout: "timeline", title: "Eight milestones in six slots",
    milestones: Array.from({ length: 8 }, (_, i) => ({
      date: `${i + 1} July`, title: "Questionnaire and baseline", detail: "Baseline collection begins across every market." })) },
  { layout: "timeline-parallel", title: "Seven years and a backwards phase", today: "2026-08-19",
    tracks: [
      { name: "Programme", phases: [{ start: "2026-01-01", end: "2033-06-30", label: "Long haul" }] },
      { name: "Second", phases: [
        { start: "2027-01-01", end: "2029-06-30", label: "Middle" },
        { start: "2030-01-01", end: "2026-01-01", label: "Runs backwards" } ] } ] },
  { layout: "timeline-parallel", title: "A fortnight", today: "2026-09-15",
    tracks: [{ name: "Sprint", phases: [{ start: "2026-09-10", end: "2026-09-25", label: "Build" }] }] },
  { layout: "stacked-bar", title: "Six parts and a category only the sixth carries",
    chart: { source: "Source: delivery data", series: [
      { name: "Articles", points: [{ label: "Holcim", value: 38 }] },
      { name: "Video", points: [{ label: "Holcim", value: 26 }] },
      { name: "Infographics", points: [{ label: "Holcim", value: 19 }] },
      { name: "Social", points: [{ label: "Holcim", value: 12 }] },
      { name: "Newsletters", points: [{ label: "Holcim", value: 8 }] },
      { name: "Events", points: [{ label: "Holcim", value: 5 }, { label: "Siemens", value: 30 }] } ] } },
  { layout: "process", title: "Seven stages in five boxes", stages: Array.from({ length: 7 }, (_, i) => ({
      name: `Stage ${i + 1}`, caption: "What happens at this point in the work." })) },
];

/* 1. Nothing may fall off the canvas. */
console.log(`\n1. Every element stays on the 720x405 canvas`);
// Indexed loop, not .entries(): tsconfig sets no target, so iterating an
// iterator needs downlevelIteration and fails the production build.
const ALL = DECK.concat(STRESS);
for (let i = 0; i < ALL.length; i++) {
  const slide = ALL[i];
  for (const req of buildSlideRequests(slide, i, "v")) {
    const body: any = Object.values(req)[0];
    const ep = body?.elementProperties;
    if (!ep) continue;
    const t = ep.transform;
    const { translateX: x, translateY: y, scaleX = 1, scaleY = 1, shearX = 0, shearY = 0 } = t;
    const w = ep.size.width.magnitude, h = ep.size.height.magnitude;
    // Sample the FOUR corners under the full affine — a line-chart segment is a
    // sheared/rotated rectangle, so size×scale at the translate is not its
    // bounding box. A check on size alone also missed scaleX:2 on a full-bleed
    // image.
    const corners: [number, number][] = [[0, 0], [w, 0], [0, h], [w, h]];
    let off = false;
    for (const [u, v] of corners) {
      const px = scaleX * u + shearX * v + x;
      const py = shearY * u + scaleY * v + y;
      if (px < -0.6 || py < -0.6 || px > CANVAS.width + 0.6 || py > CANVAS.height + 0.6) off = true;
    }
    if (off) {
      fail(`${slide.layout}: element ${body.objectId || ""} (${Math.round(w)}x${Math.round(h)}) leaves the canvas`);
    }
  }
}
if (!failures) pass(`all ${ALL.length} layouts fit, including ${STRESS.length} overloaded ones`);

/* 2. Text boxes must not sit on top of each other. */
const before2 = failures;
console.log(`\n2. No two text boxes overlap`);
const deck = toPreviewModel(ALL);
deck.slides.forEach((page, i) => {
  const texts = page.elements.filter((e) => e.kind === "text");
  for (let a = 0; a < texts.length; a++) {
    for (let b = a + 1; b < texts.length; b++) {
      const p = texts[a], q = texts[b];
      const apart = p.x + p.w <= q.x || q.x + q.w <= p.x || p.y + p.h <= q.y || q.y + q.h <= p.y;
      if (!apart) fail(`${ALL[i].layout}: "${String(p.text).slice(0, 18)}" overlaps "${String(q.text).slice(0, 18)}"`);
    }
  }
});
if (failures === before2) pass("no collisions, including with two-line titles");

/* 3. The preview must consume everything the builder emits. */
const before3 = failures;
console.log(`\n3. The preview drops nothing the deck is told`);
// Two halves, because each catches what the other cannot.
//
// The LIST half catches a NEW kind the builder starts emitting that nobody
// taught the preview. The ROUND-TRIP half catches the preview silently
// DROPPING a kind it claims to handle — which the list alone cannot see: this
// check stayed green while preview-model's createParagraphBullets branch was
// renamed to nonsense and every bulleted body previewed as plain paragraphs.
// A hardcoded list asserts the kind was WRITTEN DOWN, not that it is used.
const HANDLED = new Set(["createSlide", "updatePageProperties", "createShape", "createImage",
  "updateShapeProperties", "insertText", "updateTextStyle", "updateParagraphStyle", "createParagraphBullets"]);
const emitted = new Set<string>();
ALL.forEach((s, i) => buildSlideRequests(s, i, "v").forEach((r) => emitted.add(Object.keys(r)[0])));
for (const kind of Array.from(emitted)) {
  if (!HANDLED.has(kind)) fail(`${kind} is drawn in the deck but never read into the preview`);
}

// Round-trip: one fixture per kind, asserting the semantic EFFECT each kind
// exists to carry actually lands on the preview element.
const rt = toPreviewModel([
  { layout: "content", title: "Round trip", subtitle: "A standfirst.", body: "One\nTwo" },
  { layout: "cover", title: "Cover", subtitle: "Kicker", resolvedImage: PHOTO_DARK },
  { layout: "stat", title: "Numbers", stats: [{ value: "64 GW", label: "Capacity", detail: "Detail." }] },
]);
const rtFail = (kind: string, what: string) => fail(`${kind} is emitted but its effect never reaches the preview: ${what}`);
{
  if (rt.slides.length !== 3) rtFail("createSlide", `expected 3 slides, got ${rt.slides.length}`);
  const [content, cover, stat] = rt.slides;
  if (content.background.toLowerCase() !== "#f8f8f8") rtFail("updatePageProperties", `content background is ${content.background}, not the off-white ground`);
  const body = content.elements.find((e) => e.kind === "text" && /One/.test(String(e.text)));
  if (!body) rtFail("insertText", "the body text is missing entirely");
  else {
    if (!body.bullets) rtFail("createParagraphBullets", "a two-line body is not marked as bullets");
    if (!body.font || !body.size || !body.color) rtFail("updateTextStyle", "the body has no font, size or colour");
    if (typeof body.spaceBelow !== "number") rtFail("updateParagraphStyle", "paragraph spacing was dropped");
    if (body.w <= 0 || body.h <= 0) rtFail("createShape", "the body box has no geometry");
  }
  void stat;
  const photo = cover.elements.find((e) => e.kind === "image" && !e.src?.includes("logo_engine"));
  if (!photo?.src) rtFail("createImage", "the cover photograph never reaches the preview");
  // CENTER alignment: the timeline's milestone labels are set centred.
  const centred = toPreviewModel([{ layout: "timeline", title: "T", milestones: [
    { date: "3 July", title: "Setup", detail: "Baseline." },
    { date: "18 July", title: "Run", detail: "Fieldwork." } ] }])
    .slides[0].elements.some((e) => e.kind === "text" && e.align === "center");
  if (!centred) rtFail("updateParagraphStyle", "CENTER alignment on timeline labels never reaches the preview");
  // contentAlignment MIDDLE: a logo-wall cell holding a client NAME is
  // vertically centred in its cell.
  const vcentred = toPreviewModel([{ layout: "logo-wall", title: "T", logos: [{ name: "Holcim" }] }])
    .slides[0].elements.some((e) => e.kind === "text" && e.vCenter);
  if (!vcentred) rtFail("updateShapeProperties", "contentAlignment MIDDLE never sets vCenter");
}
if (failures === before3) pass(`all ${emitted.size} request kinds are consumed, and each one's effect round-trips`);

/* 4. The logo has to be visible against whatever is behind it. */
const before4 = failures;
console.log(`\n4. The lockup contrasts with what is behind it`);
deck.slides.forEach((page, i) => {
  const slide = ALL[i];
  const logo = page.elements.find((e) => e.kind === "image" && e.src?.includes("logo_engine"));
  if (!logo) return;
  const white = logo.src!.includes("white");
  const style = LAYOUT_STYLE[slide.layout!];
  if (style.background === null) {
    // Over a photograph the CONTRAST is measured at bake time and delivered as
    // resolvedImage.logo. The check used to stop here, so nothing asserted the
    // builder actually APPLIES that choice — inverting it (a white mark on a
    // pale sky, the historical bug) left every check green. Assert the drawn
    // lockup matches the variant the picture carries.
    const want = (slide as any).resolvedImage?.logo;
    if (want && ((want === "white") !== white)) {
      fail(`${slide.layout}: picture asked for the ${want} lockup, ${white ? "white" : "navy"} was drawn`);
    }
    return;
  }
  const darkGround = style.background === COLOR.navy || style.background === COLOR.blue;
  if (white && !darkGround) fail(`${slide.layout}: white lockup on ${style.background}`);
  if (!white && darkGround) fail(`${slide.layout}: navy lockup on ${style.background}`);
});
if (failures === before4) pass("no lockup is drawn on a ground it cannot be seen against, photo or flat");

/* 5. A link must not cost a box its typography in the preview. */
const before5 = failures;
console.log(`\n5. Styling survives a markdown link`);
const linked = toPreviewModel([
  { layout: "cover", title: "Our work with [Holcim](https://holcim.com)", subtitle: "Plain subtitle" },
  { layout: "content", title: "Portfolio", body: "See [the case study](https://example.com/a)\nAnd [another](https://example.com/b)" },
]);
for (const page of linked.slides) {
  for (const el of page.elements) {
    if (el.kind !== "text") continue;
    if (!el.font || !el.size || !el.weight) {
      fail(`"${String(el.text).slice(0, 24)}" lost its ${!el.font ? "font" : !el.size ? "size" : "weight"}`);
    }
  }
}
if (failures === before5) pass("a linked title keeps its face, size and weight");

/* 6. White text must clear 4.5:1 WHERE THE LAYOUT ACTUALLY WRITES IT.
 *
 *  Over a deliberately blown-out picture: a pale sky is the case the gradient
 *  was getting wrong, and it was getting it wrong silently because the only
 *  guarantee it made was at the very bottom edge of the canvas. */
console.log(`\n6. The baked gradient carries text on a bright photograph`);
(async () => {
  const before6 = failures;
  const sharp = (await import("sharp")).default;
  // Bright at the top, brighter in the middle, still bright at the foot — the
  // shape of a beach or a snow scene, which is what breaks a bottom-weighted
  // gradient.
  const photo = await sharp({
    create: { width: 1600, height: 900, channels: 3, background: { r: 236, g: 238, b: 232 } },
  }).jpeg().toBuffer();

  for (const layout of ["cover", "closing", "feature"] as const) {
    const slide: SlideInput = {
      layout, eyebrow: "Case study", title: "A statement that runs to two lines on this layout",
      subtitle: "A supporting line beneath it", body: "A supporting line beneath it",
    };
    const bands = textBandsFor(slide, layout === "cover" ? 0 : 3);
    if (!bands.length) { fail(`${layout}: no text bands derived`); continue; }
    const { profile } = await gradientProfileFor(photo, sharp, bands);
    const at = (d: number) => {
      for (let i = 1; i < profile.length; i++) {
        const [d0, a0] = profile[i - 1], [d1, a1] = profile[i];
        if (d <= d1) return a0 + ((d - d0) / (d1 - d0)) * (a1 - a0);
      }
      return profile[profile.length - 1][1];
    };
    // The picture's own luminance, composited with the navy the gradient lays
    // over it, has to leave white text above 4.5:1.
    const raw = 0.2126 * Math.pow((236 / 255 + 0.055) / 1.055, 2.4)
      + 0.7152 * Math.pow((238 / 255 + 0.055) / 1.055, 2.4)
      + 0.0722 * Math.pow((232 / 255 + 0.055) / 1.055, 2.4);
    for (const band of bands) {
      for (const d of [band.top + 0.01, (band.top + band.bottom) / 2, band.bottom - 0.01]) {
        const alpha = at(d);
        const seen = alpha * CONTRAST.navyLuminance + (1 - alpha) * raw;
        const ratio = 1.05 / (seen + 0.05);
        if (ratio < 4.4) {
          fail(`${layout}: white text at depth ${d.toFixed(2)} sits at ${ratio.toFixed(2)}:1 (alpha ${alpha.toFixed(2)})`);
        }
      }
    }
  }
  if (failures === before6) pass("every text band on cover, closing and feature clears 4.5:1");

  /* 7. A slide that drops data has to SAY it dropped data.
   *
   *  Asserted on the string, not on the geometry: a check that only measured
   *  boxes passed a build with the note deleted, because the layout is
   *  perfectly valid without it. Silence is the defect. */
  const before7 = failures;
  console.log(`\n7. Dropped data is admitted on the slide`);
  const saysSomething = (slide: SlideInput, pattern: RegExp, what: string) => {
    const said = buildSlideRequests(slide, 0, "n")
      .filter((r: any) => r.insertText)
      .map((r: any) => r.insertText.text as string);
    if (!said.some((t) => pattern.test(t))) fail(`${what}: nothing on the slide says so (${pattern})`);
  };
  const manyPoints = Array.from({ length: 12 }, (_, i) => ({ label: `C${i + 1}`, value: 100 - i * 5 }));
  saysSomething({ layout: "bar-chart", title: "T", chart: { series: [{ name: "Revenue", points: manyPoints }] } },
    /top 8 of 12/, "a 12-bar chart truncated to 8");
  saysSomething({ layout: "bar-chart", title: "T", chart: { series: [
    { name: "Revenue", points: manyPoints }, { name: "Cost", points: [{ label: "C1", value: 4 }] } ] } },
    /of 2 series/, "a bar chart handed two series");
  saysSomething({ layout: "timeline", title: "T", milestones: Array.from({ length: 8 }, (_, i) => ({
    date: `${i + 1} July`, title: "Setup", detail: "Detail." })) },
    /6 of 8 milestones/, "a timeline of 8 milestones");
  saysSomething({ layout: "process", title: "T", stages: Array.from({ length: 7 }, (_, i) => ({ name: `S${i}` })) },
    /first 5 of 7 stages/, "a process of 7 stages");
  saysSomething({ layout: "timeline-parallel", title: "T", tracks: [
    { name: "A", phases: [{ start: "2026-01-01", end: "2026-06-01", label: "Fine" }] },
    { name: "B", phases: [{ start: "2026-02-01", end: "2026-01-01", label: "Backwards" }] } ] },
    /unusable dates/, "a phase whose end precedes its start");
  // And a single-series chart that fits must say NOTHING — a note on every
  // slide is noise, and noise is how a real one goes unread.
  const quiet = buildSlideRequests(
    { layout: "bar-chart", title: "T", chart: { source: "Source: x", series: [{ name: "Revenue", points: manyPoints.slice(0, 4) }] } },
    0, "n"
  ).filter((r: any) => r.insertText).map((r: any) => r.insertText.text as string);
  if (quiet.some((t) => /Showing/.test(t))) fail("a chart that dropped nothing still printed a note");
  if (failures === before7) pass("every truncation names itself, and nothing else does");

  /* 8. A date that is not the date it claims must not be plotted. */
  const before8 = failures;
  console.log(`\n8. Impossible dates are refused, not rolled over`);
  for (const bad of ["2026-13-05", "2026-02-30", "2026-09-31", "2026-00-15", "2026-08-00"]) {
    if (isoDate(bad) !== null) fail(`${bad} was accepted (Date.UTC rolls it into a different date)`);
  }
  for (const good of ["2026-08-19", "2028-02-29", "2026-08-19T10:30:00Z"]) {
    if (isoDate(good) === null) fail(`${good} was refused`);
  }
  if (failures === before8) pass("out-of-range components are refused, real dates and datetimes are not");

  /* 9. The splitter measures the box the layout actually draws into. */
  const before9 = failures;
  console.log(`\n9. A body is split against its OWN box, not the widest one`);
  // Five bullets fit the full-width body box and do NOT fit the half-width one.
  // A splitter measuring both against 671pt leaves the second overflowing.
  const five = Array.from({ length: 5 }, (_, i) => `Bullet ${i + 1}: ${"x".repeat(110)}`).join("\n");
  const wide = splitOverflowingSlides([{ layout: "content", title: "T", body: five }]);
  const narrow = splitOverflowingSlides([{ layout: "image-split", title: "T", body: five }]);
  if (wide.length !== 1) fail(`the full-width layout split a body that fits it (${wide.length} slides)`);
  if (narrow.length < 2) fail(`the half-width layout did not split a body too tall for its box`);
  const eleven = Array.from({ length: 11 }, (_, i) => `Bullet ${i + 1}: ${"x".repeat(110)}`).join("\n");
  const short = splitOverflowingSlides([{ layout: "content", title: "T", body: "One\nTwo\nThree" }]);
  if (short.length !== 1) fail("a three-bullet slide was split");
  const long = splitOverflowingSlides([{ layout: "image-split", title: "T", body: eleven }]);
  if (splitOverflowingSlides(long).length !== long.length) fail("splitting is not a fixpoint");
  if (failures === before9) pass("half-width layouts split sooner, short slides not at all, and it settles");

  /* 10. Every layout that shows something is counted as visual. */
  const before10 = failures;
  console.log(`\n10. The visual audit recognises the visual layouts`);
  const visualFixtures: [string, SlideInput][] = [
    ["cards", { layout: "cards", title: "T", cards: [{ marker: "01", title: "A" }] }],
    ["logo-wall", { layout: "logo-wall", title: "T", logos: [{ name: "Holcim" }] }],
    ["process", { layout: "process", title: "T", stages: [{ name: "A" }, { name: "B" }] }],
    ["quote", { layout: "quote", quote: { text: "A line.", name: "A Person" } }],
    ["stat", { layout: "stat", title: "T", stats: [{ value: "1", label: "One" }] }],
  ];
  for (const [name, slide] of visualFixtures) {
    if (!isVisualSlide(slide)) fail(`${name} is not counted as a visual slide`);
  }
  if (isVisualSlide({ layout: "content", title: "T", body: "Just words" })) {
    fail("a prose slide is counted as visual");
  }
  if (failures === before10) pass("cards, logo walls, processes, quotes and stats all count");

  /* 11. Text that outgrows its box must not land on other text.
   *
   *  Check 2 compares BOXES and passed happily while a three-line title was
   *  drawn through the first two lines of its own body — the boxes did not
   *  overlap, the ink did. Slides never shrinks or clips: it draws the text and
   *  lets it run. So the thing to assert is not that every box holds its text
   *  (plenty of boxes are deliberately tight around display type, with empty
   *  space beneath) but that where text DOES run over, it runs into nothing. */
  const before11 = failures;
  console.log(`\n11. Text that overflows its box lands on nothing`);
  const LONG_TITLE = "AI platforms aren't a new channel. They're a new layer above every channel you already have";
  const INK: SlideInput[] = ALL.concat([
    { layout: "content", title: LONG_TITLE, body: "One\nTwo\nThree" },
    { layout: "image-split", title: LONG_TITLE, body: "One\nTwo\nThree", resolvedImage: PHOTO_DARK },
    { layout: "two-column", title: LONG_TITLE, body: "Left", bodyRight: "Right" },
    { layout: "case-study", eyebrow: "CASE STUDY", title: LONG_TITLE, body: "One\nTwo" },
    { layout: "dark-index", title: LONG_TITLE, body: "One\nTwo" },
    { layout: "bar-chart", title: LONG_TITLE, chart: { source: "Source: x", series: [{ name: "S", points: [{ label: "A", value: 1 }] }] } },
    { layout: "stat", title: LONG_TITLE, stats: [{ value: "64 GW", label: "Capacity", detail: "A detail line." }] },
    { layout: "cover", title: LONG_TITLE, subtitle: "A kicker", resolvedImage: PHOTO_DARK },
    { layout: "feature", title: LONG_TITLE, body: "A line under it", resolvedImage: PHOTO_DARK },
    { layout: "closing", title: LONG_TITLE, subtitle: "www.thecontentengine.com", resolvedImage: PHOTO_DARK },
  ]);
  const inkOf = (el: { text?: string; w: number; size?: number; bullets?: boolean }) => {
    const paras = String(el.text || "").split("\n");
    let lines = 0;
    for (const para of paras) lines += Math.max(1, estimateLines(para, el.w, el.size || 10, el.bullets));
    // One inset (the top), and the real line box rather than the splitter's
    // deliberately generous one — this is measuring collision, not deciding it.
    return 3.6 + lines * (el.size || 10) * 1.38 + Math.max(0, paras.length - 1) * (el.bullets ? 6 : 0);
  };
  toPreviewModel(INK).slides.forEach((page, i) => {
    const texts = page.elements.filter((e) => e.kind === "text" && e.text);
    for (const el of texts) {
      // A single glyph is an ornament — the quote mark — and its line box is
      // mostly the space a descender would use. Measuring it as ink says it
      // collides with everything under it, which it visibly does not.
      if (String(el.text).trim().length <= 1) continue;
      const bottom = el.y + inkOf(el);
      if (bottom <= el.y + el.h + 1) continue;    // stays inside its own box
      for (const other of texts) {
        if (other === el) continue;
        const sideBySide = el.x + el.w <= other.x + 1 || other.x + other.w <= el.x + 1;
        if (sideBySide || other.y < el.y + el.h) continue;   // beside it, or above it
        if (bottom > other.y + 1) {
          fail(`${INK[i].layout}: "${String(el.text).slice(0, 24)}…" overruns its box onto "${String(other.text).slice(0, 20)}…"`);
        }
      }
    }
  });
  if (failures === before11) pass(`no text on ${INK.length} slides is drawn over other text`);

  /* 12. What splitting a slide produces has to be a slide worth looking at. */
  const before12 = failures;
  console.log(`\n12. A continuation is a real slide, not a leftover`);
  // In the REAL order: the model sends an image QUERY, the splitter runs, and
  // resolution happens after. A fixture that pre-sets `resolvedImage` proves
  // nothing — that is how a continuation shipped with no picture while this
  // check was green.
  const spilled = splitOverflowingSlides([{
    layout: "image-split", title: "A heading", image: { query: "offshore wind at dusk" },
    body: Array.from({ length: 7 }, (_, i) => `Bullet ${i + 1}: ${"x".repeat(110)}`).join("\n"),
  }]);
  if (spilled.length < 2) fail("the fixture did not split; the check is measuring nothing");
  if (spilled.some((s) => (s as any).resolvedImage)) {
    fail("the fixture resolved an image before splitting — it is not testing the real order");
  }
  // Resolution is I/O, so stand in for it: only the first half carries a query.
  spilled[0].resolvedImage = PHOTO_DARK;
  inheritContinuationImages(spilled);
  for (let i = 1; i < spilled.length; i++) {
    if (!spilled[i].resolvedImage) {
      fail("a continuation of an image layout has no picture — half the slide is then empty");
    }
    if (spilled[i].image) fail("a continuation kept its image query — it will buy a second photograph");
  }
  const share = spilled.map((s) => (s.body || "").split("\n").length);
  if (Math.min(...share) < Math.max(...share) / 3) {
    fail(`the split is lopsided (${share.join(" / ")} bullets) — the last slide is a fragment`);
  }
  // And an empty line between bullets must not become an empty bullet.
  const gappy = toPreviewModel([{ layout: "content", title: "T", body: "One\n\nTwo\n\nThree" }]);
  const bulleted = gappy.slides[0].elements.find((e) => e.kind === "text" && e.bullets);
  if (String(bulleted?.text).split("\n").some((l) => !l.trim())) {
    fail("a blank line between bullets is drawn as an empty bullet");
  }
  const twoCol = splitOverflowingSlides([{
    layout: "two-column", title: "T", bodyRight: "Right column",
    body: Array.from({ length: 9 }, (_, i) => `Bullet ${i + 1}: ${"x".repeat(110)}`).join("\n"),
  }]);
  if (twoCol.length > 1 && twoCol.slice(1).some((s) => s.bodyRight)) {
    fail("a two-column continuation repeated the whole right-hand column");
  }
  if (failures === before12) pass("continuations keep their picture, carry their share, and skip blank bullets");

  /* 13. The prose slide — the one most decks are mostly made of — is designed.
   *
   *  Measured, it carried 12.5% ink, not one drawn object, 116 characters to a
   *  line and the bottom 47% of the canvas empty. These are the floors under
   *  the fix, so nobody quietly returns it to a document. */
  const before13 = failures;
  console.log(`\n13. A prose slide is a designed object`);
  const proseBody = "Interpretation of findings against your mission\nAn impact and effort matrix for every recommendation\nDeliverables: the full diagnostic report and a roadmap\nFee: CHF 12,500 ex. VAT";
  const proseSlides: SlideInput[] = [
    { layout: "content", title: "The plan to act on it", subtitle: "What happens after the diagnostic.", body: proseBody },
    { layout: "content", title: "The plan to act on it", body: proseBody, resolvedImage: PHOTO_DARK },
    { layout: "case-study", eyebrow: "CASE STUDY", title: "Holcim", body: proseBody },
  ];
  toPreviewModel(proseSlides).slides.forEach((page, i) => {
    const name = `${proseSlides[i].layout}${proseSlides[i].resolvedImage ? " + rail" : ""}`;
    const drawn = page.elements.filter((e) => e.kind === "rect" || e.kind === "ellipse");
    if (!drawn.length) fail(`${name}: not one drawn element on the slide`);
    const body = page.elements.find((e) => e.kind === "text" && e.bullets);
    if (!body) { fail(`${name}: no body`); return; }
    // A measure, not a document width: 116 characters to a line is why it read
    // as a page rather than a slide.
    const chars = Math.floor((body.w - 14.4 - 18) / ((body.size || 10) * 0.55));
    if (chars > 100) fail(`${name}: body measure is ${chars} characters a line`);
    if (body.y + body.h < CANVAS.height * 0.85) {
      fail(`${name}: the body stops at ${Math.round(body.y + body.h)} of ${CANVAS.height} — the band foot is unused`);
    }
    if (proseSlides[i].resolvedImage) {
      const pic = page.elements.find((e) => e.kind === "image" && !e.src?.includes("logo_engine"));
      if (!pic) fail(`${name}: the picture it resolved is never drawn`);
      else if (pic.x + pic.w < CANVAS.width - 1 || pic.y + pic.h < CANVAS.height - 1) {
        fail(`${name}: the rail does not bleed to the edges`);
      }
    }
  });
  // A rail narrows the body to 432pt. A body that overflows THAT column must
  // split, at draft time (image is a query, not yet resolved) as at publish.
  // The original check used four short bullets — the "invisible with short
  // labels" pattern — and missed the rail measuring against the wide column.
  const railBody = Array.from({ length: 11 }, (_, i) => `Bullet ${i + 1}: ${"x".repeat(85)}`).join("\n");
  const railDraft = splitOverflowingSlides([{ layout: "content", title: "T", image: { query: "wind" }, body: railBody }]);
  if (railDraft.length < 2) fail("a rail slide's overflowing body was not split (measured against the wide column?)");
  const railPub = splitOverflowingSlides([{ layout: "case-study", title: "T", resolvedImage: PHOTO_DARK, body: railBody }]);
  if (railPub.length < 2) fail("a resolved rail slide's overflowing body was not split");
  if (failures === before13) pass("a rule, a measure, the whole band, the picture drawn, and the rail body split against its own column");

  /* 14. Charts can argue: a sequence keeps its order, a highlight lands accent. */
  const before14 = failures;
  console.log(`\n14. A chart can be a time series and can point at one bar`);
  const months = ["Jan","Feb","Mar","Apr","May","Jun"].map((m, i) => ({ label: m, value: 6 + i * 6 }));
  const seqLabels = buildSlideRequests({ layout: "bar-chart", title: "T", chart: { sequence: true, series: [{ name: "%", points: months }] } }, 0, "n")
    .filter((r: any) => r.insertText && /_bl\d/.test(r.insertText.objectId || "")).map((r: any) => r.insertText.text);
  if (seqLabels.join(",") !== "Jan,Feb,Mar,Apr,May,Jun") fail(`a sequence chart was re-ordered: ${seqLabels.join(",")}`);
  const rankLabels = buildSlideRequests({ layout: "bar-chart", title: "T", chart: { series: [{ name: "%", points: months }] } }, 0, "n")
    .filter((r: any) => r.insertText && /_bl\d/.test(r.insertText.objectId || "")).map((r: any) => r.insertText.text);
  if (rankLabels[0] !== "Jun") fail(`a ranking chart did not sort biggest-first: ${rankLabels.join(",")}`);
  const fillsOf = (slide: SlideInput) => buildSlideRequests(slide, 0, "n")
    .filter((r: any) => r.updateShapeProperties && /_bb\d/.test(r.updateShapeProperties.objectId || ""))
    .map((r: any) => JSON.stringify(r.updateShapeProperties.shapeProperties.shapeBackgroundFill.solidFill.color.rgbColor));
  const hi = fillsOf({ layout: "bar-chart", title: "T", chart: { highlight: 1, series: [{ name: "x", points: [{ label: "A", value: 4 }, { label: "B", value: 4 }, { label: "C", value: 9 }] }] } });
  if (new Set(hi).size < 2) fail("a highlighted chart drew every bar the same colour");
  const plain = fillsOf({ layout: "bar-chart", title: "T", chart: { series: [{ label: "A", value: 4 }, { label: "B", value: 9 }].length ? [{ name: "x", points: [{ label: "A", value: 4 }, { label: "B", value: 9 }] }] : [] } });
  if (new Set(plain).size !== 1) fail("an un-highlighted chart drew bars in different colours");
  if (failures === before14) pass("sequence keeps order, ranking sorts, highlight isolates one bar");

  /* 15. A single stat is a hero, and no stat is ever dropped. */
  const before15 = failures;
  console.log(`\n15. One number earns the whole slide; several keep all of them`);
  const heroSize = (slide: SlideInput) => {
    const st = buildSlideRequests(slide, 0, "n").find((r: any) => r.updateTextStyle && /_sv0$/.test(r.updateTextStyle.objectId || "")) as any;
    return st?.updateTextStyle.style.fontSize.magnitude ?? 0;
  };
  const solo = heroSize({ layout: "stat", title: "Fee", stats: [{ value: "CHF 12,500", label: "Fixed fee", detail: "Delivered in six weeks." }] });
  if (solo <= TYPE_STAT_CAP) fail(`a lone stat was not enlarged (${solo}pt)`);
  const svCount = (slide: SlideInput) => buildSlideRequests(slide, 0, "n").filter((r: any) => r.insertText && /_sv\d/.test(r.insertText.objectId || "")).length;
  if (svCount({ layout: "stat", title: "T", stats: [{ value: "a", label: "1" }, { value: "b", label: "2", primary: true }, { value: "c", label: "3" }] }) !== 3) {
    fail("a primary flag among three stats dropped the others");
  }
  if (failures === before15) pass("a single stat scales up; primary among several drops nothing");

  /* 16. A section with a photo draws it; a numeric eyebrow becomes a numeral. */
  const before16 = failures;
  console.log(`\n16. A section divider draws its photograph and its numeral`);
  const secPhoto = buildSlideRequests({ layout: "section", eyebrow: "02", title: "The plan", subtitle: "x", resolvedImage: PHOTO_DARK }, 0, "n");
  if (!secPhoto.some((r: any) => r.createImage && /_bg$/.test(r.createImage.objectId || ""))) {
    fail("a section with a resolved image never drew the backdrop (paid and dropped)");
  }
  if (!secPhoto.some((r: any) => r.insertText && r.insertText.text === "02" && /_num$/.test(r.insertText.objectId || ""))) {
    fail("a numeric section eyebrow did not become a numeral");
  }
  const secWord = buildSlideRequests({ layout: "section", eyebrow: "PART ONE", title: "T" }, 0, "n");
  if (secWord.some((r: any) => /_num$/.test((r.insertText?.objectId) || ""))) fail("a worded eyebrow was mis-drawn as a numeral");
  if (failures === before16) pass("photo drawn, numeric eyebrow becomes a numeral, worded eyebrow stays an eyebrow");

  /* 17. The evidence slide argues: standfirst drawn, benchmark on scale, callout on canvas. */
  const before17 = failures;
  console.log(`\n17. A chart carries a finding, a benchmark and a callout`);
  const ev: SlideInput = { layout: "bar-chart", title: "You are behind on the metric that compounds",
    subtitle: "Sector visibility scores, and where you sit against the average.",
    chart: { highlight: 1, benchmark: { value: 61, label: "Sector average" }, callout: { point: 1, text: "New CFO paused spend" },
      source: "AI Visibility Index", series: [{ name: "Score", points: [
        { label: "Best in sector", value: 74 }, { label: "You", value: 18 }, { label: "Rival", value: 52 } ] }] } };
  const evReqs = buildSlideRequests(ev, 0, "n");
  const drew = (suffix: string) => evReqs.some((r: any) => (r.insertText?.objectId || "").endsWith(suffix) || (r.createShape?.objectId || "").endsWith(suffix));
  if (!drew("_sub")) fail("a chart standfirst was dropped (the discarded-subtitle defect)");
  if (!drew("_bmk")) fail("a benchmark line was not drawn");
  if (!drew("_cnote")) fail("a chart callout was not drawn");
  // the standfirst pushes the plot down — the first bar must sit below it
  const evPage = toPreviewModel([ev]).slides[0];
  const evSub = evPage.elements.find((e) => e.kind === "text" && /Sector visibility/.test(String(e.text)));
  const evBar = evPage.elements.find((e) => e.kind === "rect" && e.fill && e.y > (evSub ? evSub.y : 0) + 10);
  if (!evSub || !evBar) fail("standfirst or plot missing on the evidence slide");
  if (failures === before17) pass("standfirst drawn and the plot sits below it, benchmark and callout on canvas");

  /* 18. The comparison slide is designed; the closing slide acts. */
  const before18 = failures;
  console.log(`\n18. Two-column is a comparison, closing is an action`);
  const tc = buildSlideRequests({ layout: "two-column", title: "Search vs synthesis", subtitle: "How buyers find you changed.",
    columns: { left: "Yesterday", right: "Today" }, body: "Ten links\nYou choose", bodyRight: "One answer\nThe model chooses" }, 0, "n");
  const tcDrew = (sfx: string) => tc.some((r: any) => (r.insertText?.objectId || "").endsWith(sfx) || (r.createShape?.objectId || "").endsWith(sfx));
  if (!tcDrew("_lh") || !tcDrew("_rh")) fail("two-column headers not drawn");
  if (!tcDrew("_vrule")) fail("two-column divider not drawn");
  if (!tcDrew("_rulea")) fail("two-column title rule not drawn");
  const cl = buildSlideRequests({ layout: "closing", title: "Let's map it", subtitle: "Next step",
    body: "hello@x.com\nBook a call", resolvedImage: PHOTO_DARK }, 0, "n");
  if (!cl.some((r: any) => r.insertText && (r.insertText.objectId || "").endsWith("_body"))) {
    fail("a closing slide with a body drew no action lines");
  }
  if (failures === before18) pass("comparison has headers, a divider and a rule; the close carries its actions");

  /* 19. A cover without a photo is designed, not a plain navy slide. */
  const before19 = failures;
  console.log(`\n19. The no-photo cover has a composition of its own`);
  const npCover = buildSlideRequests({ layout: "cover", title: "AI Visibility for Rigiwald", subtitle: "A diagnostic" }, 0, "n");
  if (!npCover.some((r: any) => (r.createShape?.objectId || "").endsWith("_crule"))) {
    fail("a cover with no photo drew no accent rule — it is the plain navy slide again");
  }
  const npCentred = toPreviewModel([{ layout: "cover", title: "AI Visibility", subtitle: "x" }]).slides[0]
    .elements.some((e) => e.kind === "text" && e.align === "center");
  if (!npCentred) fail("the no-photo cover title is not centred");
  // the photo cover keeps its bottom-left composition (no accent rule, not centred)
  const phCover = buildSlideRequests({ layout: "cover", title: "T", subtitle: "x", resolvedImage: PHOTO_DARK }, 0, "n");
  if (phCover.some((r: any) => (r.createShape?.objectId || "").endsWith("_crule"))) {
    fail("the photo cover drew the no-photo composition");
  }
  if (failures === before19) pass("no-photo cover is centred with an accent rule; the photo cover is unchanged");

  /* 20. A line chart: segments connect the dots, in the preview as in the deck. */
  const before20 = failures;
  console.log(`\n20. A line chart connects its points, and the preview agrees`);
  const lc: SlideInput = { layout: "line-chart", title: "Revenue compounded", subtitle: "Quarterly, CHF k.",
    chart: { highlight: 3, benchmark: { value: 100, label: "Break-even" }, source: "Internal",
      series: [
        { name: "MRR", points: [{ label: "Q1", value: 120 }, { label: "Q2", value: 180 }, { label: "Q3", value: 210 }, { label: "Q4", value: 340 }] },
        { name: "Cost", points: [{ label: "Q1", value: 90 }, { label: "Q2", value: 110 }, { label: "Q3", value: 120 }, { label: "Q4", value: 140 }] } ] } };
  const lreqs = buildSlideRequests(lc, 0, "n");
  const segCount = lreqs.filter((r: any) => (r.createShape?.objectId || "").match(/_ls\d/)).length;
  const dotCount = lreqs.filter((r: any) => (r.createShape?.objectId || "").match(/_ld\d/)).length;
  if (segCount !== 6) fail(`a two-series 4-point line drew ${segCount} segments, expected 6`);
  if (dotCount !== 8) fail(`a two-series 4-point line drew ${dotCount} dots, expected 8`);
  if (!lreqs.some((r: any) => (r.createShape?.objectId || "").endsWith("_lbmk"))) fail("line-chart benchmark not drawn");
  if (!lreqs.some((r: any) => (r.insertText?.objectId || "").match(/_ln\d/))) fail("line-chart legend not drawn for two series");
  // Each segment's endpoints must land on two consecutive dots — the deck and
  // the preview both derive from these requests, so if they connect here they
  // connect on screen. Recover endpoints from the affine and match to dots.
  const dotCentres: [number, number][] = [];
  for (const r of lreqs as any[]) {
    const cs = r.createShape;
    if (!cs || !/_ld\d/.test(cs.objectId)) continue;
    const t = cs.transform || cs.elementProperties.transform;
    const sz = cs.elementProperties.size;
    dotCentres.push([t.translateX + sz.width.magnitude / 2, t.translateY + sz.height.magnitude / 2]);
  }
  const near = (a: [number, number], b: [number, number]) => Math.hypot(a[0] - b[0], a[1] - b[1]) < 1.5;
  let disconnected = 0;
  for (const r of lreqs as any[]) {
    const cs = r.createShape;
    if (!cs || !/_ls\d/.test(cs.objectId)) continue;
    const t = cs.elementProperties.transform, sz = cs.elementProperties.size;
    const L = sz.width.magnitude, T = sz.height.magnitude;
    const start: [number, number] = [t.scaleX * 0 + t.shearX * (T / 2) + t.translateX, t.shearY * 0 + t.scaleY * (T / 2) + t.translateY];
    const end: [number, number] = [t.scaleX * L + t.shearX * (T / 2) + t.translateX, t.shearY * L + t.scaleY * (T / 2) + t.translateY];
    if (!dotCentres.some((d) => near(d, start)) || !dotCentres.some((d) => near(d, end))) disconnected++;
  }
  if (disconnected > 0) fail(`${disconnected} line segment(s) do not land on their data points`);
  if (failures === before20) pass("segments connect consecutive points, benchmark and legend drawn, nothing off-canvas");

  /* 20b. A line chart that crosses zero says where zero is. */
  //
  // THE DEFECT. The line chart drew ONE horizontal rule, at the bottom of the
  // plot — which is the padded MINIMUM, not zero. On monthly profit running
  // -25k in January to +17k in August the scale ran -28,360 to +20,360, so the
  // only rule on the chart sat at -28,360 and every loss-making month was drawn
  // ABOVE it. January read as the low point of a rising line rather than as a
  // loss, and there was no y value anywhere on the slide: the layout reserved
  // 34px at the left for labels it never wrote. Reported from a real deck.
  const before20b = failures;
  console.log(`\n20b. A line chart across zero draws the zero line and its scale`);
  const lossPoints = [-25000, -18000, -9000, -3000, 2000, 6000, 11000, 17000]
    .map((v, i) => ({ label: ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug"][i], value: v }));
  const lossSlide: SlideInput = { layout: "line-chart", title: "The monthly trend",
    chart: { sequence: true, yAxisLabel: "Net profit (CHF)", source: "Management accounts",
      series: [{ name: "Net profit", points: lossPoints }] } };
  const lreq2 = buildSlideRequests(lossSlide, 0, "n");

  const ruleY = (suffix: string): number | null => {
    for (const r of lreq2 as any[]) {
      if (!r.createShape || !(r.createShape.objectId || "").endsWith(suffix)) continue;
      return r.createShape.elementProperties.transform.translateY;
    }
    return null;
  };
  const baseY = ruleY("_laxis");
  const zeroY = ruleY("_lzero");
  if (baseY == null) fail("line-chart lost its baseline");
  if (zeroY == null) fail("a line chart crossing zero drew no zero rule — the loss months sit above the only line on it");
  // The precondition that makes the rest meaningful: the two rules must be in
  // DIFFERENT places. Drawing the zero rule on top of the baseline would
  // satisfy "a zero rule exists" and change nothing a reader can see.
  if (baseY != null && zeroY != null && Math.abs(baseY - zeroY) < 20) {
    fail(`the zero rule is drawn on the baseline (${zeroY?.toFixed(1)} vs ${baseY?.toFixed(1)}), so it marks nothing`);
  }
  // And zero must sit ABOVE the baseline, because every value is above the
  // padded minimum. If it came out below, the scale is inverted.
  if (baseY != null && zeroY != null && zeroY >= baseY) fail("zero is drawn at or below the bottom of the plot");

  // The scale itself. Without y values the plot has no magnitude at all: the
  // only number on the old chart was the last point's own label.
  const yTicks = (lreq2 as any[]).filter((r) => (r.insertText?.objectId || "").match(/_lyt\d/)).map((r) => r.insertText.text);
  if (yTicks.length < 3) fail(`line-chart drew ${yTicks.length} y-axis values, expected at least 3`);
  if (yTicks.indexOf("0") < 0) fail(`the y axis does not label zero (${yTicks.join(", ")})`);
  if (!yTicks.some((t: string) => t.indexOf("-") === 0)) fail(`the y axis labels no negative value, on a chart whose point is a loss (${yTicks.join(", ")})`);
  // The labels have to sit in the gutter the layout reserves, not over the plot.
  for (const r of lreq2 as any[]) {
    if (!(r.createShape?.objectId || "").match(/_lyt\d/)) continue;
    const t = r.createShape.elementProperties;
    if (t.transform.translateX + t.size.width.magnitude > GRID.margin + 34 + 1) {
      fail("a y-axis label runs into the plot area");
      break;
    }
  }
  if (!lreq2.some((r: any) => r.insertText?.text === "Net profit (CHF)")) fail("yAxisLabel was given and not drawn");

  // NOT drawn when the data does not cross zero: the baseline already IS the
  // floor there, and a second rule on it is redundant ink. Same rule the bar
  // chart follows, and the reason this is a condition rather than always-on.
  const allPositive = buildSlideRequests({ layout: "line-chart", title: "T",
    chart: { sequence: true, series: [{ name: "R", points: [{ label: "Q1", value: 120 }, { label: "Q2", value: 180 }, { label: "Q3", value: 340 }] }] } }, 0, "n");
  if (allPositive.some((r: any) => (r.createShape?.objectId || "").endsWith("_lzero"))) {
    fail("a chart entirely above zero drew a zero rule anyway");
  }

  // The preview has to carry both rules, or the deck is right and the picture
  // of it is wrong — which is how a correct deck showed a wrong preview for a
  // day when the scrim lost its alpha.
  const lossPrev = toPreviewModel([lossSlide]).slides[0].elements as any[];
  const prevRules = lossPrev.filter((e) => !e.text && e.h <= 2 && e.w > 300);
  if (prevRules.length < 2) fail(`the preview shows ${prevRules.length} of the chart's 2 horizontal rules`);
  if (!lossPrev.some((e) => e.text === "0")) fail("the preview does not show the y-axis zero label");
  if (!lossPrev.some((e) => e.text === "Net profit (CHF)")) fail("the preview does not show the y-axis label");

  // The tick maths itself, driven directly.
  const t1 = niceTicks(-28360, 20360);
  if (t1.indexOf(0) < 0) fail("niceTicks omitted zero from a range that crosses it");
  if (t1.some((v) => Math.abs(v) > 0 && Math.abs(v) < 1)) fail("niceTicks produced values finer than the data warrants");
  // TWO fractional ranges, because they catch different halves of the fix.
  // 0.5..0.9 drifts only when the ticks are ACCUMULATED (v += step), which is
  // what shipped first. 0.25..0.75 drifts even computed as first + i*step, so
  // it is the one that proves the rounding earns its place — without it the
  // axis reads 0.30000000000000004. A single range would have certified half
  // the fix.
  for (const [lo, hi] of [[0.5, 0.9], [0.25, 0.75], [1.15, 1.65]] as [number, number][]) {
    const t = niceTicks(lo, hi);
    if (t.some((v) => String(v).length > 6)) fail(`niceTicks drifted on ${lo}..${hi} (${t.join(", ")})`);
  }
  if (niceTicks(0, 0).length !== 0) fail("niceTicks invented ticks for an empty range");
  if (niceTicks(10, 0).length !== 0) fail("niceTicks accepted an inverted range");
  for (const [lo, hi] of [[-5, 5], [0, 108], [980, 1020], [-1200000, 300000]] as [number, number][]) {
    const t = niceTicks(lo, hi);
    if (t.length < 2 || t.length > 12) fail(`niceTicks gave ${t.length} ticks for ${lo}..${hi}`);
    for (let i = 1; i < t.length; i++) if (t[i] <= t[i - 1]) fail(`niceTicks is not ascending for ${lo}..${hi}`);
    if (t[0] < lo || t[t.length - 1] > hi) fail(`niceTicks stepped outside ${lo}..${hi}`);
  }
  if (failures === before20b) pass("zero rule drawn only when the data crosses zero, y values labelled in the reserved gutter, preview agrees");

  /* 20c. A data table lines its figures up and admits what it dropped. */
  const before20c = failures;
  console.log(`\n20c. A data table`);
  {
    const assertTable = (ok: boolean, m: string) => { if (!ok) fail(m); };
    const spec: SlideInput = { layout: "table", title: "Legacy domains",
      table: { columns: ["Domain", "Shared KW", "Their traffic", "DR"], highlight: [0],
        rows: [
          ["holcim.com", "108", "8,853", "76"],
          ["holcimgroup.com", "30", "493", "47"],
          ["holcim.co.uk", "25", "2,981", "65"] ] } };
    const tr = buildSlideRequests(spec, 0, "n");
    const cells = (tr as any[]).filter((r) => (r.insertText?.objectId || "").match(/_tc\d+_\d+$/));
    if (cells.length !== 12) fail(`a 3x4 table drew ${cells.length} cells, expected 12`);

    // THE REASON THIS LAYOUT EXISTS. `comparison` centres every cell, and a
    // column of centred numbers cannot be read down because the digits do not
    // line up. Column 0 is text and must stay left; 1-3 are figures.
    const alignOf = (suffix: string): string | undefined => {
      for (const r of tr as any[]) {
        if (r.updateParagraphStyle?.objectId?.endsWith(suffix)) return r.updateParagraphStyle.style?.alignment;
      }
      return undefined;
    };
    if (alignOf("_tc0_0") !== "START") fail(`the text column is not left-aligned (${alignOf("_tc0_0")})`);
    for (const j of [1, 2, 3]) {
      if (alignOf(`_tc0_${j}`) !== "END") fail(`numeric column ${j} is not right-aligned (${alignOf(`_tc0_${j}`)})`);
      if (alignOf(`_th${j}`) !== "END") fail(`the heading over numeric column ${j} is not right-aligned`);
    }
    // And the detection is on the CELLS, not the heading: "Shared KW" is text.
    if (!isNumericColumn(["108", "30", "25"])) fail("a column of integers is not read as numeric");
    if (isNumericColumn(["holcim.com", "holcimgroup.com"])) fail("a column of domains is read as numeric");
    if (!isNumericColumn(["8,853", "n/a", "2,981", "493"])) fail("one non-numeric cell flips a numeric column");
    if (isNumericColumn([])) fail("an empty column is read as numeric");

    const tint = (tr as any[]).filter((r) => (r.createShape?.objectId || "").endsWith("_trb0"));
    if (tint.length !== 1) fail("the highlighted row is not tinted");
    if ((tr as any[]).some((r) => (r.createShape?.objectId || "").endsWith("_trb1"))) fail("a row that was not highlighted is tinted");

    // Saying what was dropped, in BOTH dimensions. A table that quietly shows
    // the first twelve of twenty reads as the whole set.
    const over = buildSlideRequests({ layout: "table", title: "T",
      table: { columns: Array.from({ length: 8 }, (_, j) => `C${j + 1}`),
        rows: Array.from({ length: 20 }, (_, i) => Array.from({ length: 8 }, (_, j) => String(i * j))) } }, 0, "n");
    const drop = (over as any[]).filter((r) => (r.insertText?.objectId || "").endsWith("_tdrop")).map((r) => r.insertText.text)[0];
    if (!drop) fail("a truncated table says nothing about what it dropped");
    else {
      if (drop.indexOf("12 of 20 rows") < 0) fail(`the drop note does not name the rows (${drop})`);
      if (drop.indexOf("6 of 8 columns") < 0) fail(`the drop note does not name the columns (${drop})`);
    }

    // A NARROW COLUMN MUST STILL FIT ITS OWN FIGURES. Sharing the width in
    // proportion to character counts starved the last column: beside one column
    // of long domain names, "DR" got 29px and its value 0.9 came out as "0…".
    // Found by looking at a rendered slide, not by any assertion here.
    const real: SlideInput = { layout: "table", title: "Legacy domains",
      table: { columns: ["Domain competing for Amrize queries", "Shared KW", "Their traffic", "DR"],
        rows: [
          ["holcim.com - legacy parent", "108", "8,853", "76"],
          ["holcimgroup.com - legacy parent", "30", "493", "47"],
          ["holcim.co.uk - a UK site on US queries", "25", "2,981", "65"],
          ["holcimalpenaconnect.com - orphaned plant site", "19", "49", "0.9"] ] } };
    const drawn = (buildSlideRequests(real, 0, "n") as any[])
      .filter((r) => (r.insertText?.objectId || "").match(/_t[ch]/))
      .map((r) => r.insertText.text as string);
    // The precondition: this table genuinely has a wide column beside narrow
    // ones, which is the shape that caused it.
    assertTable(drawn.some((t) => t.length > 30) && drawn.some((t) => t.length <= 3),
      "precondition: the fixture mixes a wide text column with narrow numeric ones");
    const clipped = drawn.filter((t) => t.slice(-1) === "\u2026");
    assertTable(clipped.length === 0, `a table that fits clipped ${clipped.length} cell(s): ${clipped.join(", ")}`);
    for (const want of ["0.9", "8,853", "holcimalpenaconnect.com - orphaned plant site"]) {
      assertTable(drawn.indexOf(want) >= 0, `"${want}" is drawn in full`);
    }

    // NARROW COLUMNS ARE PROTECTED, PROSE COLUMNS TAKE THE HIT. Shrinking every
    // column by the same PERCENTAGE is what shipped, and a real ten-row action
    // table exposed it: "2 hours" was drawn as "2 ho…" while the two prose
    // columns still had two hundred pixels each. A column of figures is either
    // complete or useless; prose reads fine with an ellipsis.
    const action = [
      ["1", "Publish llms.txt at the root", "Web team", "2 hours", "Makes the citable surface explicit to AI crawlers"],
      ["3", "FAQ blocks with FAQPage schema on the four business pages", "Story Lab + web", "2 days", "Largest single AEO gain; targets People Also Ask"],
      ["7", "Create the /ca/en/ tree, sitemap and hreflang", "Web team", "1 week", "Fixes the largest structural gap in the audit"],
      ["10", "Stand up the measurement and tracking", "TC Digital + client", "1 day", "Without it there is no defensible before-and-after"],
    ];
    const dense = buildSlideRequests({ layout: "table", title: "The first 30 days",
      table: { columns: ["#", "Action", "Owner", "Effort", "Expected outcome"], rows: action } } as SlideInput, 0, "n");
    const denseCells = (dense as any[]).filter((r) => (r.insertText?.objectId || "").match(/_tc\d+_\d+$/)).map((r) => r.insertText.text as string);
    assertTable(denseCells.length === 20, `precondition: the dense fixture drew all its cells (${denseCells.length})`);
    // Column 3 is Effort. Every one of its values must survive whole.
    const effort = denseCells.filter((_, i) => i % 5 === 3);
    assertTable(effort.join("|") === "2 hours|2 days|1 week|1 day",
      `a narrow column of values is never clipped (${effort.join("|")})`);
    const shortCols = denseCells.filter((_, i) => i % 5 === 0 || i % 5 === 3);
    assertTable(shortCols.every((t) => t.slice(-1) !== "\u2026"), "nor is the index column");
    // And the prose columns are where the ellipsis lands, which is the trade.
    assertTable(denseCells.some((t) => t.slice(-1) === "\u2026"), "precondition: this table genuinely does not fit, so something must be cut");

    // The allocation itself, driven directly.
    const w = fitColumnWidths([28, 294, 106, 52, 259], 637);
    assertTable(Math.abs(w.reduce((a, b) => a + b, 0) - 637) < 1, `the widths add up to the space (${Math.round(w.reduce((a, b) => a + b, 0))})`);
    assertTable(w[0] === 28 && w[3] === 52, `columns that fit keep exactly what they need (${w[0]}, ${w[3]})`);
    assertTable(Math.abs(w[1] - w[4]) < 1, "and the ones that do not share what is left equally");
    const roomy = fitColumnWidths([50, 60], 400);
    assertTable(Math.abs(roomy.reduce((a, b) => a + b, 0) - 400) < 1, "spare room is given out, not left blank");
    assertTable(roomy[1] > roomy[0], "in proportion, so the wider column stays wider");

    // A TABLE CAN KEEP ITS COMMENTARY. A real source slide carried a table PLUS
    // two analysis panels beside it; with nowhere to put them the model moved
    // the analysis into speaker notes and spare closing slides, and the
    // converted slide showed the numbers with none of the argument.
    const railed = buildSlideRequests({ layout: "table", title: "Baselines and targets",
      bodyRight: "Renegotiate the AI citation target: propose 150 or more.\nSplit the traffic target: branded and non-branded from day one.",
      table: { columns: ["Metric", "Baseline", "12 mo"], rows: [["Organic traffic, US", "7,316", "15,000"], ["Total AI citations", "26", "500"]] } } as SlideInput, 0, "n");
    const railText = (railed as any[]).filter((r) => (r.insertText?.objectId || "").endsWith("_trail")).map((r) => r.insertText.text)[0] || "";
    assertTable(railText.indexOf("Renegotiate") >= 0, "commentary passed as bodyRight is drawn beside the table");
    // The rail must not overlap the table, and the table's own figures must
    // still come out whole at the narrower width.
    // The rail's left edge and the table's right edge BOTH derive from tableW,
    // so comparing them to each other can never fail — that mutation survived.
    // What actually breaks when the table keeps its full width is the rail's
    // own box: zero or negative width, or off the canvas.
    let tableRight = 0, railLeft = 1e9, railW = 0;
    for (const r of railed as any[]) {
      const cs = r.createShape; if (!cs) continue;
      const t = cs.elementProperties; const x = t.transform.translateX, w = t.size.width.magnitude * (t.transform.scaleX || 1);
      if (/_trh$/.test(cs.objectId)) tableRight = x + w;
      if (/_trail$/.test(cs.objectId)) { railLeft = x; railW = w; }
    }
    assertTable(tableRight > 0 && railLeft > tableRight, `the rail starts after the table ends (${Math.round(tableRight)} < ${Math.round(railLeft)})`);
    assertTable(railW >= 150, `the rail is wide enough to read (${Math.round(railW)}px)`);
    assertTable(railLeft + railW <= CANVAS.width - GRID.margin + 1, `and stays on the canvas (${Math.round(railLeft + railW)} of ${CANVAS.width})`);
    const railedCells = (railed as any[]).filter((r) => (r.insertText?.objectId || "").match(/_tc\d+_\d+$/)).map((r) => r.insertText.text as string);
    assertTable(["7,316", "15,000", "26", "500"].every((v) => railedCells.indexOf(v) >= 0), "and every figure survives the narrower table");
    // Without bodyRight the table keeps the full width, or every existing deck
    // gets a phantom gutter.
    const plain = buildSlideRequests({ layout: "table", title: "T",
      table: { columns: ["A", "B"], rows: [["x", "1"]] } } as SlideInput, 0, "n");
    assertTable(!(plain as any[]).some((r) => (r.createShape?.objectId || "").endsWith("_trail")), "no rail is drawn when none was given");

    // A CELL IS ONE LINE. Left to wrap, a long label pushes its row into the
    // next one, which the overloaded fixture caught as an overlap.
    const long = "A first-column label that runs on and on well past the width of any column";
    const cut = fitCell(long, 120, 9);
    if (cut.length >= long.length) fail("a long cell is not truncated");
    if (cut.slice(-1) !== "\u2026") fail(`a truncated cell does not end in an ellipsis (${JSON.stringify(cut.slice(-3))})`);
    if (fitCell("108", 120, 9) !== "108") fail("a short cell is truncated when it fits");
    if (fitCell("", 120, 9) !== "") fail("an empty cell becomes something");

    // A table with no rows, or no columns, draws nothing rather than a header
    // over empty space.
    if (buildSlideRequests({ layout: "table", title: "T", table: { columns: ["A"], rows: [] } }, 0, "n")
      .some((r: any) => (r.insertText?.objectId || "").match(/_th\d/))) fail("a table with no rows still drew its header");

    // The preview must show the same cells, or the deck is right and the
    // picture of it is wrong.
    const prev = toPreviewModel([spec]).slides[0].elements as any[];
    for (const want of ["holcim.com", "8,853", "Shared KW"]) {
      if (!prev.some((e) => e.text === want)) fail(`the preview is missing the table cell "${want}"`);
    }
    if (!prev.some((e) => !e.text && e.fill === "#e6f1fb")) fail("the preview does not tint the highlighted row");
  }
  if (failures === before20c) pass("figures right-aligned under their headings, highlight tinted, cells kept to one line, drops declared, preview agrees");

  /* 20d. A deck can be built up a few slides at a time. */
  //
  // WHY THIS MATTERS. `generate_slides` REPLACES the deck, so the only way to
  // add a slide used to be to resend every slide — and a thirty-five slide deck
  // is more than one call emits before it is cut off. editSlide could append,
  // but only text layouts and `cards`: it had no field for a table or a chart,
  // so a deck containing one could not be built in pieces at all. That is the
  // wall a real client conversion hit.
  const before20d = failures;
  console.log(`\n20d. Appending a slide that needs a payload`);
  {
    const assertEdit = (ok: boolean, m: string) => { if (!ok) fail(m); };
    const deck: any[] = [
      { layout: "cover", title: "Cover" },
      { layout: "content", title: "Two", body: "A line" },
    ];
    const before = JSON.stringify(deck);

    const tableSpec = { columns: ["Domain", "Shared KW", "DR"], rows: [["holcim.com", "108", "76"], ["holcim.co.uk", "25", "65"]] };
    const grown = applyEditSlide(deck, { insertAfter: 2, layout: "table", title: "Legacy domains", table: tableSpec } as any);
    assertEdit(grown.length === 3, `the deck grew by one (${grown.length})`);
    assertEdit(grown[2].layout === "table", `the appended slide keeps its layout (${grown[2].layout})`);
    assertEdit((grown[2].table?.rows || []).length === 2, "and carries its rows");
    assertEdit(JSON.stringify(deck) === before, "the original array is not mutated");
    assertEdit(JSON.stringify(grown[0]) === JSON.stringify(deck[0]) && JSON.stringify(grown[1]) === JSON.stringify(deck[1]),
      "every other slide is byte-for-byte what it was");

    // And it MUST still refuse what it cannot draw, or the guard that stopped
    // blank slides is simply gone. This is the same rule unrenderableSlides
    // applies to a whole deck, so an insert cannot pass here and be reported
    // blank there.
    let refused = "";
    try { applyEditSlide(deck, { insertAfter: 2, layout: "table", title: "No rows" } as any); }
    catch (e: any) { refused = e.message; }
    assertEdit(refused.indexOf("`table`") >= 0, `a table slide with no table is refused, naming the field (${refused.slice(0, 70)})`);
    assertEdit(unrenderableSlides(grown).length === 0, "the grown deck has nothing unrenderable in it");

    // Every payload a layout can be drawn from must be carryable, or some
    // layout is still unappendable and the wall is only partly gone.
    for (const field of PAYLOAD_FIELDS) {
      assertEdit(/^[a-z]+$/i.test(field), `payload field "${field}" is a plain name`);
    }
    for (const l of ["table", "stat", "bar-chart", "swot", "timeline", "quote"]) {
      const need = insertableLayout(l, {}).needs;
      assertEdit(!!need && PAYLOAD_FIELDS.indexOf(need) >= 0, `${l} declares a payload this tool can carry (${need})`);
    }

    // The tool SCHEMA has to offer them, or the model cannot send what the
    // server now accepts — the two lists drifting is the failure this repo
    // keeps paying for.
    const prov = readFileSync(join(__dirname, "..", "lib/ai/providers.ts"), "utf8");
    const schemaAt = prov.indexOf("editSlide: {");
    const schemaEnd = prov.indexOf("generate_slides", schemaAt);
    assertEdit(schemaAt > 0 && schemaEnd > schemaAt, "precondition: the editSlide schema block was located");
    const schema = prov.slice(schemaAt, schemaEnd);
    const missing = PAYLOAD_FIELDS.filter((f) => !new RegExp(`\\n\\s+${f}: \\{`).test(schema));
    assertEdit(/insertSlides: \{/.test(schema), "the schema offers insertSlides, or a long deck still takes a dozen turns");
    assertEdit(missing.length === 0, `editSlide accepts these server-side but does not offer them: ${missing.join(", ")}`);
    for (const l of ["table", "stat", "bar-chart", "timeline"]) {
      assertEdit(schema.indexOf(`"${l}"`) >= 0, `the layout enum offers "${l}"`);
    }

    // SEVERAL AT ONCE. One slide per call is arithmetically hopeless: the tool
    // is capped at three calls a turn, so a 35-slide deck would take a dozen
    // turns of the user typing "continue".
    const many = applyEditSlide(deck, { insertAfter: 2, insertSlides: [
      { layout: "content", title: "A", body: "x" },
      { layout: "table", title: "B", table: tableSpec },
      { layout: "stat", title: "C", stats: [{ value: "71", label: "DR" }] },
    ] } as any);
    assertEdit(many.length === 5, `three slides appended in one call (${many.length})`);
    assertEdit(many.map((s: any) => s.layout).join(",") === "cover,content,content,table,stat",
      `in the order given (${many.map((s: any) => s.layout).join(",")})`);
    assertEdit(unrenderableSlides(many).length === 0, "and none of them is blank");
    assertEdit(JSON.stringify(deck) === before, "the original deck is still not mutated");

    // A batch must not smuggle past the guard one at a time would apply.
    let batchRefused = "";
    try { applyEditSlide(deck, { insertAfter: 2, insertSlides: [{ layout: "content", title: "Fine", body: "y" }, { layout: "table", title: "Bad" }] } as any); }
    catch (e: any) { batchRefused = e.message; }
    assertEdit(batchRefused.indexOf("slide 2 of the batch") >= 0,
      `a blank slide inside a batch is refused, saying which one (${batchRefused.slice(0, 90)})`);
    let emptyBatch = "";
    try { applyEditSlide(deck, { insertAfter: 2, insertSlides: [] } as any); } catch (e: any) { emptyBatch = e.message; }
    assertEdit(emptyBatch.indexOf("empty") >= 0, "an empty batch is refused");

    // REMOVING slides. The tool could add and change but not remove, so taking
    // two invented closing slides out of a 34-slide conversion meant resending
    // all 34 — the call that gets cut off. Found comparing a generated deck
    // against the source it was converted from.
    const six: any[] = Array.from({ length: 6 }, (_, i) => ({ layout: "content", title: `S${i + 1}`, body: "x" }));
    const cut = applyEditSlide(six, { removeSlides: [5, 6] } as any);
    assertEdit(cut.length === 4, `two slides removed (${cut.length})`);
    assertEdit(cut.map((s: any) => s.title).join(",") === "S1,S2,S3,S4", "and the right two went");
    assertEdit(six.length === 6, "without mutating the deck it was given");
    // Numbers are 1-based against the deck ON SCREEN, so removing 1 and 3 must
    // not take 1 and 4 — an off-by-one here deletes the wrong client slide.
    const gap = applyEditSlide(six, { removeSlides: [1, 3] } as any);
    assertEdit(gap.map((s: any) => s.title).join(",") === "S2,S4,S5,S6", `numbers are 1-based (${gap.map((s: any) => s.title).join(",")})`);

    let badNum = "";
    try { applyEditSlide(six, { removeSlides: [99] } as any); } catch (e: any) { badNum = e.message; }
    assertEdit(/between 1 and 6/.test(badNum) && /Nothing has been removed/.test(badNum),
      `an out-of-range number removes nothing and says so (${badNum.slice(0, 60)})`);
    let all = "";
    try { applyEditSlide(six, { removeSlides: [1, 2, 3, 4, 5, 6] } as any); } catch (e: any) { all = e.message; }
    assertEdit(/every slide/.test(all), "and a deck cannot be emptied");
    // Combining a removal with an insert renumbers under the model's feet.
    let combo = "";
    try { applyEditSlide(six, { removeSlides: [1], insertAfter: 2, insertSlides: [{ layout: "content", title: "n", body: "b" }] } as any); }
    catch (e: any) { combo = e.message; }
    assertEdit(/cannot be combined/.test(combo), "a removal and an insert in one call is refused");
    assertEdit(/removeSlides: \{/.test(readFileSync(join(__dirname, "..", "lib/ai/providers.ts"), "utf8")),
      "and the schema offers removeSlides, or the model cannot ask for it");

    // Patching an existing slide's payload, which is "change the table on
    // slide 14" without regenerating the deck.
    const patched = applyEditSlide(grown, { slideNumber: 3, table: { columns: ["A"], rows: [["1"]] } } as any);
    assertEdit((patched[2].table?.rows || []).length === 1, "a payload can be replaced on an existing slide");
    assertEdit(patched[2].layout === "table", "and the layout is left alone when it is not being changed");
    assertEdit(patched[2].title === "Legacy domains", "and so is the title");

    // A payload-only edit is a real change; it used to be rejected as none.
    let none = "";
    try { applyEditSlide(grown, { slideNumber: 3 } as any); } catch (e: any) { none = e.message; }
    assertEdit(none.indexOf("No change") >= 0, "an edit with nothing in it is still refused");
  }
  if (failures === before20d) pass("a payload slide can be appended and patched, blanks are still refused, and the schema offers every field the server takes");

  /* 20e. A deck built earlier in the same turn is still there. */
  //
  // THE DEFECT, reproduced on production. `slides_draft` is written when the
  // assistant message is SAVED, at the end of the turn. A second
  // generate_slides call in the same turn — which is exactly how a long deck is
  // built — looked the deck up, found nothing, fell through to the model's own
  // `slides` array (EMPTY, because the schema tells it not to resend when
  // editing) and produced a 0-SLIDE deck that replaced the eleven already
  // drafted. The model reported it honestly and the eleven slides were gone.
  const before20e = failures;
  console.log(`\n20e. The second call in a turn can see the first call's deck`);
  {
    const assertTurn = (ok: boolean, m: string) => { if (!ok) fail(m); };
    const conv = `verify-${process.pid}-${failures}`;
    // Wrapped, because the interesting failures here THROW. Left to escape, an
    // exception kills the script before it prints anything, and a mutation that
    // causes one looks exactly like a mutation that changed nothing.
    try {
    const first = await prepareSlidesForBuild(
      { title: "Amrize", slides: [{ layout: "cover", title: "Cover" }, { layout: "content", title: "Two", body: "x" }] },
      conv
    );
    assertTurn(first.slides.length === 2, `the first call builds its slides (${first.slides.length})`);

    // The database has NOT been written at this point. This is the whole test.
    const second = await prepareSlidesForBuild(
      { slides: [], editSlide: { insertAfter: 2, insertSlides: [
        { layout: "table", title: "Legacy domains", table: { columns: ["Domain", "DR"], rows: [["holcim.com", "76"]] } },
        { layout: "content", title: "Next", body: "y" },
      ] } },
      conv
    );
    assertTurn(second.slides.length === 4, `the second call appends to it rather than replacing it (${second.slides.length})`);
    assertTurn(second.edited === true, "and is reported as an edit");
    assertTurn(second.slides[0].title === "Cover" && second.slides[1].title === "Two",
      "the slides from the first call survive");
    assertTurn(second.slides[2].layout === "table", "and the appended table slide is there");
    assertTurn(second.title === "Amrize", "the deck keeps its title");

    // A third call sees the second's work too, or a deck can only ever be built
    // in two batches.
    const third = await prepareSlidesForBuild(
      { slides: [], editSlide: { insertAfter: 4, insertSlides: [{ layout: "content", title: "Last", body: "z" }] } },
      conv
    );
    assertTurn(third.slides.length === 5, `and a third call sees the second's (${third.slides.length})`);

    // AN EMPTY DECK IS NEVER BUILT. This is the hole that destroyed a real deck
    // twice on production: whatever the model got wrong about the shape of its
    // call, `slides` arrived as [] and a 0-slide deck REPLACED the twelve
    // already drafted. No request means "delete the deck".
    let emptied = "";
    try { await prepareSlidesForBuild({ slides: [] }, conv); } catch (e: any) { emptied = e.message; }
    assertTurn(emptied.indexOf("at least one slide") >= 0,
      `an empty slides array is refused rather than replacing the deck (${emptied.slice(0, 70)})`);
    assertTurn(emptied.indexOf("insertSlides") >= 0, "and the refusal shows the call it should have made");
    // The deck is genuinely untouched by that refusal.
    const still = await prepareSlidesForBuild(
      { slides: [], editSlide: { insertAfter: 5, insertSlides: [{ layout: "content", title: "After", body: "q" }] } }, conv);
    assertTurn(still.slides.length === 6, `the deck survived the refused call (${still.slides.length})`);

    // THE INSERT FIELDS AT THE TOP LEVEL. The model nests them under editSlide
    // about as often as it does not, and a misplaced insertSlides used to mean
    // `slides` was read instead — which was empty, so the deck was replaced
    // with nothing. Folded in rather than refused: the intent is unambiguous.
    const flat = await prepareSlidesForBuild(
      { slides: [], insertAfter: 6, insertSlides: [{ layout: "content", title: "Flat", body: "r" }] } as any, conv);
    assertTurn(flat.slides.length === 7, `insertSlides at the top level still appends (${flat.slides.length})`);
    assertTurn(flat.slides[6].title === "Flat", "and puts the slide where it was asked for");

    // NO SILENT FALLTHROUGH. An edit with no deck to edit must fail loudly. It
    // used to build whatever `slides` held, which was empty.
    let threw = "";
    try {
      await prepareSlidesForBuild({ slides: [], editSlide: { insertAfter: 0, title: "Orphan", body: "b" } }, null);
    } catch (e: any) { threw = e.message; }
    assertTurn(threw.indexOf("no deck") >= 0, `an edit with no deck to edit is an error, not a 0-slide deck (${threw.slice(0, 80)})`);
    } catch (e: any) {
      fail(`building a deck across calls in one turn threw: ${String(e?.message || e).slice(0, 120)}`);
    }
  }
  if (failures === before20e) pass("a deck built earlier in the turn is found and appended to, and an edit with no deck fails loudly");

  /* 20f. A conversion is not told to redesign itself. */
  //
  // THE DEFECT, from a real client conversion. Asked to "make this presentation
  // in TCE format, keep the content the same", the deck came back with six
  // Quick Win slides collapsed into one cards slide, a section divider and a
  // closing slide the source does not have, and reworded titles. The cause was
  // not the model being loose: visualAudit is appended to EVERY draft result
  // and tells it to "name the ones whose numbers should be a stat or a bar, the
  // sets of like things that should be cards ... then say what you would change
  // and offer to redraw it". Correct advice for a deck being authored, and the
  // opposite of what was asked for here.
  const before20f = failures;
  console.log(`\n20f. A conversion keeps its own shape`);
  {
    const assertFid = (ok: boolean, m: string) => { if (!ok) fail(m); };
    const prov = readFileSync(join(__dirname, "..", "lib/ai/providers.ts"), "utf8");

    // The nag exists and is the pushy one — precondition, or the rest is about
    // a string that no longer says what it used to.
    assertFid(/offer to redraw it/.test(prov), "precondition: the restructuring advice is still in visualAudit");
    assertFid(/function visualAudit\(slides: any\[\], preserve = false\)/.test(prov),
      "visualAudit takes a preserve flag");
    // And it is short-circuited BEFORE the pushy branch, not after it.
    const va = prov.slice(prov.indexOf("function visualAudit("), prov.indexOf("function visualAudit(") + 2600);
    const guardAt = va.indexOf("if (preserve)");
    const pushAt = va.indexOf("offer to redraw it");
    assertFid(guardAt > 0 && pushAt > guardAt, "the preserve branch returns before the restructuring advice");
    assertFid(/do not restructure it/i.test(va), "and says plainly that this is a conversion");

    // Every chain passes the flag, or a conversion is faithful on Claude and
    // redesigned on Grok. Four chains, four call sites: this repo has shipped
    // that exact drift before.
    const wired = (prov.match(/visualAudit\(draft\.slides, [a-zA-Z.?]+\?\.fidelity === "preserve"\)/g) || []).length;
    assertFid(wired === 4, `all four provider chains pass the fidelity flag (${wired} of 4)`);

    // The model has to be able to SET it.
    assertFid(/fidelity: \{/.test(prov), "generate_slides accepts a fidelity parameter");
    assertFid(/enum: \["preserve", "restyle"\]/.test(prov), "with the two values named");
    const fid = prov.slice(prov.indexOf("fidelity: {"), prov.indexOf("fidelity: {") + 1400);
    for (const phrase of ["keep the content the same", "do not merge slides", "ONE source slide becomes ONE output slide"]) {
      assertFid(fid.indexOf(phrase) >= 0, `the description says "${phrase}"`);
    }

    // A SPLIT SLIDE BREAKS ONE-TO-ONE, so it has to be reported. The server
    // splits a slide whose body overflows, which is how "(continued)" appeared
    // in a deck the user had asked to keep 1:1 — with nothing saying so.
    // The MECHANISM first, run rather than read: a slide whose body overflows
    // really is split, so there really is something to report.
    const longBody = Array.from({ length: 60 }, (_, i) => `A bullet line number ${i + 1} that carries enough words to take a full line on its own`).join("\n");
    const splitOut = splitOverflowingSlides([{ layout: "content", title: "Long", body: longBody }] as SlideInput[]);
    assertFid(splitOut.length > 1, `precondition: an overflowing slide really is split by the server (${splitOut.length})`);
    assertFid(splitOut.length - 1 > 0, "so the count the model is told is a real number");
    // And the count is COMPUTED, not merely mentioned. Grepping for the word
    // alone passed with the assignment deleted, because the reporting lines
    // still contained it.
    assertFid(/splitCount = slides\.length - rawSlides\.length/.test(prov),
      "the draft computes how many slides the server added");
    const reported = (prov.match(/splitCount > 0 \?/g) || []).length;
    assertFid(reported === 4, `and every chain reports it to the model (${reported} of 4)`);
    assertFid(/TELL THE USER which ones/.test(prov), "naming which slides were split");

    // A COUNT IS CHECKABLE, ADVICE IS NOT. Telling the model not to merge
    // slides is advice, and it merged six Quick Win slides into one cards slide
    // anyway. The pptx reader emits "--- Slide N ---" per slide, so on a
    // conversion the server knows what the deck is supposed to come out at.
    const src = sourceSlideCount([{ role: "user", content: "x", attachments: [
      { url: "u", name: "d.pptx", type: "application/vnd.openxmlformats-officedocument.presentationml.presentation",
        extractedText: "--- Slide 1 ---\nA\n\n--- Slide 2 ---\nB\n\n--- Slide 3 ---\nC" },
    ] }] as any);
    assertFid(src === 3, `the source slide count is read from the extracted text (${src})`);
    assertFid(sourceSlideCount([]) === 0, "and is zero when nothing is attached, so nothing is claimed");
    assertFid(sourceSlideCount([{ role: "user", content: "x", attachments: [
      { url: "u", name: "d.txt", type: "text/plain", extractedText: "no slide markers here" } ] }] as any) === 0,
      "and zero for a document that is not a deck");

    assertFid(fidelityAudit(35, 35) === "", "a deck that matches its source says nothing");
    assertFid(fidelityAudit(0, 0) === "", "and nothing is said when the source is unknown");
    const short = fidelityAudit(32, 35);
    assertFid(short.indexOf("35") >= 0 && short.indexOf("32") >= 0, `both counts are named (${short.slice(0, 60)})`);
    assertFid(/FEWER/.test(short), "and which way it went");
    assertFid(/merged, split or added/.test(short), "with what to say about it");
    assertFid(/Do NOT describe the deck as a faithful copy/.test(short),
      "and it is forbidden from calling a shortened deck faithful");
    assertFid(/MORE/.test(fidelityAudit(38, 35)), "a deck longer than its source is caught too");

    const audited = (prov.match(/fidelityAudit\(draft\.slides\.length, sourceSlideCount\(messages\)\)/g) || []).length;
    assertFid(audited === 4, `all four chains run the fidelity audit (${audited} of 4)`);
  }
  if (failures === before20f) pass("a preserve conversion is not told to restructure, all four chains pass the flag, and server-side splits are declared");

  /* 20g. The brand system from the master template. */
  //
  // Ported from the tce-deck-rebrand kit, which is the brand extracted from the
  // JERA Nex bp master. Three things: the accent phrase (braces in a headline
  // become ONE italic phrase, lime on dark grounds — the colour flip the design
  // system calls the brand's strongest recognisable detail), the footer
  // furniture, and the statement layout.
  const before20g = failures;
  console.log(`\n20g. Accent phrase, footer, statement`);
  {
    const assertBrand = (ok: boolean, m: string) => { if (!ok) fail(m); };

    // The parser, driven directly.
    const pa = parseAccents("Great storytelling can {change the world}");
    assertBrand(pa.text === "Great storytelling can change the world", `braces are stripped (${pa.text})`);
    assertBrand(pa.ranges.length === 1 && pa.ranges[0].start === 23 && pa.ranges[0].end === 39,
      `and the range lands on the phrase (${JSON.stringify(pa.ranges)})`);
    assertBrand(parseAccents("No braces").ranges.length === 0, "text without braces is untouched");
    assertBrand(parseAccents("Unmatched {stays").text === "Unmatched {stays", "an unmatched brace stays literal");
    assertBrand(parseAccents("{a} and {b}").ranges.length === 2, "two phrases give two ranges");
    assertBrand(parseAccents("empty {} pair").ranges.length === 0, "an empty pair marks nothing");

    // On a DARK ground the phrase turns lime; on a light ground italic only.
    // Derived from the ink, so no call site can get it wrong.
    const coverReqs = buildSlideRequests({ layout: "cover", title: "Response to {Request for Proposal}" } as SlideInput, 0, "n");
    const coverTexts = (coverReqs as any[]).filter((r) => r.insertText).map((r) => r.insertText.text);
    assertBrand(!coverTexts.some((t: string) => t.indexOf("{") >= 0), "no brace ever reaches a slide");
    const coverAccent = (coverReqs as any[]).find((r) => r.updateTextStyle?.textRange?.type === "FIXED_RANGE" && r.updateTextStyle.style?.italic);
    assertBrand(!!coverAccent, "the cover title carries the accent range");
    assertBrand(coverAccent.updateTextStyle.fields.indexOf("foregroundColor") >= 0, "lime on the dark cover");
    const stReqs = buildSlideRequests({ layout: "statement", title: "One {big} idea" } as SlideInput, 0, "n");
    const stAccent = (stReqs as any[]).find((r) => r.updateTextStyle?.textRange?.type === "FIXED_RANGE" && r.updateTextStyle.style?.italic);
    assertBrand(!!stAccent && stAccent.updateTextStyle.fields === "italic", "italic ONLY on the light ground — the flip is the dark-ground detail");

    // The preview carries the range, or the deck styles words the preview
    // draws plain.
    const prevEls = toPreviewModel([{ layout: "cover", title: "Response to {Request for Proposal}" } as SlideInput]).slides[0].elements as any[];
    const covEl = prevEls.find((e) => e.text && e.text.indexOf("Request") >= 0);
    assertBrand(!!covEl?.accents?.length && covEl.accents[0].italic === true, "the preview keeps the accent range");
    assertBrand(covEl.text.indexOf("{") < 0, "and its text is clean");

    // Braces in ROBOTO fields pass through untouched — user content is never
    // silently rewritten outside the headline voice.
    const bodyReqs = buildSlideRequests({ layout: "content", title: "T", body: "keep {these} braces" } as SlideInput, 0, "n");
    const bodyTexts = (bodyReqs as any[]).filter((r) => r.insertText).map((r) => r.insertText.text);
    assertBrand(bodyTexts.some((t: string) => t.indexOf("{these}") >= 0), "braces in body copy are left alone");

    // FOOTER. On content slides, numbered by the builder; never on the cover
    // or the closing, which is the master's own rule.
    const c5 = buildSlideRequests({ layout: "content", title: "T", body: "x" } as SlideInput, 4, "n");
    const c5texts = (c5 as any[]).filter((r) => r.insertText).map((r) => r.insertText.text);
    assertBrand(c5texts.indexOf("The Content Engine") >= 0, "the footer names the house");
    assertBrand(c5texts.indexOf("5") >= 0, "and numbers the page from the builder's own index");
    for (const l of ["cover", "closing"] as const) {
      const t = (buildSlideRequests({ layout: l, title: "T" } as SlideInput, 0, "n") as any[])
        .filter((r) => r.insertText).map((r) => r.insertText.text);
      assertBrand(t.indexOf("The Content Engine") < 0, `no footer on the ${l}`);
    }
    // The footer lives in the margin band, below every layout's content floor.
    for (const r of c5 as any[]) {
      if (!(r.createShape?.objectId || "").match(/_ft[ln]$/)) continue;
      // Below 392.5, measured: the chart layouts draw their source line 12pt
      // into the margin band, so "inside the margin" was not low enough and
      // the first footer position collided with every chart's source note.
      assertBrand(r.createShape.elementProperties.transform.translateY >= CANVAS.height - 12,
        "the footer sits on the last points of the canvas, under every layout's bottom furniture");
    }

    // STATEMENT: in the catalogue everywhere a layout has to be known.
    assertBrand(LAYOUTS.indexOf("statement" as any) >= 0, "statement is a real layout");
    const st2 = buildSlideRequests({ layout: "statement", eyebrow: "THE ARGUMENT", title: "One sentence that is the whole point", subtitle: "A lead below it." } as SlideInput, 0, "n");
    const st2texts = (st2 as any[]).filter((r) => r.insertText).map((r) => r.insertText.text);
    assertBrand(st2texts.indexOf("One sentence that is the whole point") >= 0, "it draws its sentence");
    assertBrand(st2texts.indexOf("A lead below it.") >= 0, "and its lead");
    const inserted = applyEditSlide([{ layout: "cover", title: "C" }], { insertAfter: 1, layout: "statement", title: "S" } as any);
    assertBrand(inserted.length === 2 && inserted[1].layout === "statement", "and editSlide can insert one");

    // GROUND RHYTHM + the dash rule, in deckWarnings.
    const darkDeck = Array.from({ length: 6 }, () => ({ layout: "stat", title: "X", stats: [{ value: "1", label: "l" }] }));
    // /dark grounds/ also matches the ADJACENT warning's text, which is how
    // killing the ratio branch survived: the other warning answered for it.
    assertBrand(/house ratio is roughly 70% light/.test(deckWarnings(darkDeck as any)), "an all-dark deck is flagged against the 70% light ratio");
    assertBrand(/in a row/.test(deckWarnings(darkDeck as any)), "and so are adjacent dark slides");
    assertBrand(/em or en dashes/.test(deckWarnings([{ layout: "content", title: "A — B", body: "x" }] as any)), "an em dash is flagged against the house hyphen rule");
    assertBrand(deckWarnings([{ layout: "content", title: "A", body: "x" }] as any) === "", "a clean deck stays quiet");
  }
  if (failures === before20g) pass("braces become the accent phrase with the dark-ground lime flip, the footer is numbered by the builder, statement exists, and the rhythm rules advise");

  /* 21. The analysis formats draw their structure. */
  const before21 = failures;
  console.log(`\n21. SWOT, matrix and comparison draw their parts`);
  const sw = buildSlideRequests({ layout: "swot", title: "T", swot: { strengths: ["a"], weaknesses: ["b"], opportunities: ["c"], threats: ["d"] } }, 0, "n");
  const swPanels = sw.filter((r: any) => (r.createShape?.objectId || "").match(/_q[swot]$/)).length;
  if (swPanels !== 4) fail(`SWOT drew ${swPanels} quadrant panels, expected 4`);
  if (sw.filter((r: any) => (r.insertText?.objectId || "").match(/_qh/)).length !== 4) fail("SWOT is missing quadrant headers");
  const mx = buildSlideRequests({ layout: "matrix", title: "T", matrix: { xAxis: ["l", "h"], yAxis: ["l", "h"], items: [{ label: "A", x: 0.2, y: 0.8, highlight: true }, { label: "B", x: 0.7, y: 0.3 }] } }, 0, "n");
  if (mx.filter((r: any) => (r.createShape?.objectId || "").match(/_md\d/)).length !== 2) fail("matrix did not plot both items");
  if (!mx.some((r: any) => (r.createShape?.objectId || "").endsWith("_mvx"))) fail("matrix vertical axis not drawn");
  const cm = buildSlideRequests({ layout: "comparison", title: "T", comparison: { columns: ["Us", "Them"], rows: [{ label: "Testing", cells: ["yes", "no"] }, { label: "Fee", cells: ["CHF 1", "CHF 2"] }] } }, 0, "n");
  const ticks = cm.filter((r: any) => r.insertText && (r.insertText.text === "\u2713" || r.insertText.text === "\u2717")).length;
  if (ticks !== 2) fail(`comparison drew ${ticks} tick/cross glyphs, expected 2 (one yes, one no)`);
  if (cm.filter((r: any) => (r.insertText?.objectId || "").match(/_ch\d/)).length !== 2) fail("comparison header columns not drawn");
  if (failures === before21) pass("SWOT has four panels and headers, matrix plots its items on axes, comparison draws ticks and headers");

  /* 22. Scatter plots its points on two axes; a Venn draws its overlapping sets. */
  const before22 = failures;
  console.log(`\n22. Scatter and Venn draw their marks`);
  const scReqs = buildSlideRequests({ layout: "scatter", title: "T", scatter: { xAxis: "H", yAxis: "C", points: [
    { x: 1, y: 8, group: "A" }, { x: 9, y: 60, group: "B" }, { x: 5, y: 30, group: "A" } ] } }, 0, "n");
  const sdots = scReqs.filter((r: any) => (r.createShape?.objectId || "").match(/_sd\d/));
  if (sdots.length !== 3) fail(`scatter plotted ${sdots.length} points, expected 3`);
  if (!scReqs.some((r: any) => (r.createShape?.objectId || "").endsWith("_sxa")) || !scReqs.some((r: any) => (r.createShape?.objectId || "").endsWith("_sya"))) fail("scatter is missing an axis");
  // two groups → two legend swatches
  if (scReqs.filter((r: any) => (r.createShape?.objectId || "").match(/_sk\d/)).length !== 2) fail("scatter legend missing for two groups");
  // points must spread: the two extreme values land far apart vertically
  const sy = sdots.map((r: any) => r.createShape.elementProperties.transform.translateY);
  if (Math.max(...sy) - Math.min(...sy) < 80) fail("scatter points do not spread on the y-axis");
  const v2 = buildSlideRequests({ layout: "venn", title: "T", venn: { sets: [{ label: "A" }, { label: "B" }], overlap: "both" } }, 0, "n");
  if (v2.filter((r: any) => (r.createShape?.objectId || "").match(/_vc\d/)).length !== 2) fail("2-set Venn did not draw two circles");
  if (!v2.some((r: any) => r.insertText && r.insertText.text === "both")) fail("2-set Venn overlap label not drawn");
  const v3 = buildSlideRequests({ layout: "venn", title: "T", venn: { sets: [{ label: "A" }, { label: "B" }, { label: "C" }] } }, 0, "n");
  if (v3.filter((r: any) => (r.createShape?.objectId || "").match(/_vc\d/)).length !== 3) fail("3-set Venn did not draw three circles");
  // A "Name (Descriptor)" set label splits into a name and a lighter gloss.
  const v3d = buildSlideRequests({ layout: "venn", title: "T", venn: { sets: [{ label: "Team knowledge (Digital Authority Briefing)" }, { label: "B" }, { label: "C" }] } }, 0, "n");
  if (!v3d.some((r: any) => r.insertText && r.insertText.text === "Team knowledge") || !v3d.some((r: any) => r.insertText && r.insertText.text === "Digital Authority Briefing")) {
    fail("a Venn set label with a parenthetical was not split into name + descriptor");
  }
  if (failures === before22) pass("scatter plots and spreads its points; Venn draws its sets with name-over-descriptor labels");

  /* 23. An attached image lands on the slide, and a REGION of it crops correctly.
   *
   *  A screenshot of the user's own product cannot be approximated by stock or
   *  a generator — it has to be the actual file, cropped to the part the slide
   *  is about. The crop maths is percentage-based (the model cannot know pixel
   *  dimensions) and must clamp rather than throw when a region overshoots. */
  const before23 = failures;
  console.log(`\n23. An attached image, and a region of it, reach the slide`);
  {
    const sharpMod = (await import("sharp")).default;
    const W = 1440, H = 900;
    const src = await sharpMod({ create: { width: W, height: H, channels: 3, background: { r: 240, g: 244, b: 250 } } }).png().toBuffer();
    const supplier = async (i: number) => (i === 1 ? { bytes: src, contentType: "image/png" } : null);

    // The crop the resolver performs, asserted directly: percentages → pixels.
    const pct = (v: number) => Math.max(0, Math.min(100, v)) / 100;
    const crop = async (r: { x: number; y: number; width: number; height: number }) => {
      const left = Math.round(pct(r.x) * W), top = Math.round(pct(r.y) * H);
      const width = Math.max(8, Math.min(W - left, Math.round(pct(r.width) * W)));
      const height = Math.max(8, Math.min(H - top, Math.round(pct(r.height) * H)));
      return sharpMod(src).extract({ left, top, width, height }).png().toBuffer();
    };
    const right = await sharpMod(await crop({ x: 70, y: 0, width: 30, height: 100 })).metadata();
    if (right.width !== 432 || right.height !== 900) {
      fail(`a 30%-wide region of a 1440x900 image cropped to ${right.width}x${right.height}, expected 432x900`);
    }
    // Overshoot must clamp to the edge, not throw — a model estimating "the
    // right third" from a picture will overshoot.
    try {
      const over = await sharpMod(await crop({ x: 80, y: 0, width: 50, height: 100 })).metadata();
      if ((over.width || 0) !== 288) fail(`an overshooting region clamped to ${over.width}px, expected 288`);
    } catch (e: any) {
      fail(`an overshooting region threw instead of clamping: ${e?.message}`);
    }

    // A slide asking for an attachment that is not there must SAY so, not
    // silently draw nothing.
    // Asserted on the MESSAGE, not just the flag: a later fallback in the
    // normal image chain also sets imageUnavailable ("no image could be found"),
    // so a flag-only assertion passes even when the attachment branch is gone —
    // it would report the check green for the wrong reason.
    const missing: SlideInput[] = [{ layout: "image-split", title: "T", body: "x", image: { attachment: 9 } }];
    await resolveDeckImages(missing, undefined, supplier);
    if (!/attachment 9/.test(missing[0].imageError || "")) {
      fail(`a missing attachment was not reported as one (imageError: "${missing[0].imageError || "none"}")`);
    }
    // A slide with no image at all is untouched by the attachment path.
    const plain: SlideInput[] = [{ layout: "content", title: "T", body: "a\nb" }];
    await resolveDeckImages(plain, undefined, supplier);
    if (plain[0].resolvedImage || plain[0].imageUnavailable) fail("a slide with no image was altered by the attachment path");
  }
  if (failures === before23) pass("a region crops to the right pixels, overshoot clamps, a missing attachment is reported");

  /* 24. Text that sits ON something is centred IN it, and a stacked bar shows
   *     its split.
   *
   *  Both were found by Chris looking at a real deck, and every geometric check
   *  above passed straight over them — nothing here asked whether a label was
   *  centred in its own ground, or whether a chart's numbers were the numbers
   *  the chart exists to show.
   *
   *  The chip: its text box was nudged down 4pt while keeping the chip's full
   *  height, so it overhung the bottom, and nothing centred it vertically. The
   *  numeral sat visibly high in its blue box. An offset is a GUESS at
   *  centring; contentAlignment is centring, and it survives a type-size change.
   *
   *  The stacked bar: only the row TOTAL was labelled. On the budget slide both
   *  rows totalled 12k, so the chart's only two numbers were identical and the
   *  split was left to be estimated by eye.
   */
  const before24 = failures;
  console.log(`\n24. A chip centres its text, and a stacked bar labels its parts`);
  {
    const cardsSlide: SlideInput = {
      layout: "cards", title: "What strategy-lite actually covers",
      // Title lengths chosen so the line counts genuinely DIFFER. The first
      // version of this fixture used the four real headings from the deck, and
      // at a four-card width every one of them wrapped to exactly two lines —
      // so per-card heights and a shared height produced identical geometry and
      // the assertion passed against the behaviour it was written to catch.
      // Measured, not eyeballed: "Audit" is one line, the long one is five.
      cards: [
        { marker: "01", title: "Audit", body: "How the brand surfaces in AI answers." },
        { marker: "02", title: "Digital media vs. impact", body: "Activity mapped against demonstrated reach." },
        { marker: "03", title: "Objectives and audience priorities that run long enough to wrap several times", body: "Goals and ranking." },
        { marker: "04", title: "Calendar", body: "The practical brief writers work from." },
      ],
    };
    const reqs = buildSlideRequests(cardsSlide, 0, "p24a") as any[];
    const shapes = new Map<string, any>();
    for (const r of reqs) if (r.createShape) shapes.set(r.createShape.objectId, r.createShape.elementProperties);
    const geom = (o: any) => o && {
      x: o.transform.translateX, y: o.transform.translateY,
      w: o.size.width.magnitude, h: o.size.height.magnitude,
    };

    const chipIds = Array.from(shapes.keys()).filter((k) => /cm\d+$/.test(k));
    if (chipIds.length !== 4) fail(`expected 4 marker chips, found ${chipIds.length}`);
    for (const cid of chipIds) {
      const tid = cid.replace(/cm(\d+)$/, "cmt$1");
      const t = geom(shapes.get(tid));
      const c = geom(shapes.get(cid));
      if (!t) { fail(`chip ${cid} has no text box`); continue; }
      if (t.x !== c.x || t.y !== c.y || t.w !== c.w || t.h !== c.h) {
        fail(`chip ${cid}: text box (${t.x},${t.y} ${t.w}x${t.h}) does not cover the chip (${c.x},${c.y} ${c.w}x${c.h}) — an offset is not centring`);
      }
    }

    const vcentred = reqs
      .filter((r) => r.updateShapeProperties?.shapeProperties?.contentAlignment === "MIDDLE")
      .map((r) => r.updateShapeProperties.objectId);
    const align = new Map<string, string>();
    for (const r of reqs) {
      if (r.updateParagraphStyle?.style?.alignment) align.set(r.updateParagraphStyle.objectId, r.updateParagraphStyle.style.alignment);
    }
    for (const cid of chipIds) {
      const tid = cid.replace(/cm(\d+)$/, "cmt$1");
      if (vcentred.indexOf(tid) === -1) fail(`chip text ${tid} is not vertically centred (no contentAlignment MIDDLE)`);
      if (align.get(tid) !== "CENTER") fail(`chip text ${tid} is not horizontally centred (alignment ${align.get(tid) || "unset"})`);
    }

    // Bodies share a baseline. The headings above are deliberately one-line and
    // two-line: measured per card, they started their bodies at different
    // heights and the row read as four adjacent columns rather than a grid.
    const bodyTops = Array.from(shapes.keys()).filter((k) => /cb\d+$/.test(k)).map((k) => geom(shapes.get(k))!.y);
    if (bodyTops.length !== 4) fail(`expected 4 card bodies, found ${bodyTops.length}`);
    else if (new Set(bodyTops).size !== 1) fail(`card bodies start at ${bodyTops.join(", ")} — a one-line and a two-line heading broke the row's baseline`);

    // A shared band leaves slack under the SHORT headings. Bottom-aligning puts
    // that slack above the heading, under the chip, instead of opening a hole
    // between the heading and its body.
    const bottomAligned = reqs
      .filter((r) => r.updateShapeProperties?.shapeProperties?.contentAlignment === "BOTTOM")
      .map((r) => r.updateShapeProperties.objectId);
    const titleIds = Array.from(shapes.keys()).filter((k) => /ct\d+$/.test(k));
    for (const tid of titleIds) {
      if (bottomAligned.indexOf(tid) === -1) fail(`card title ${tid} is not bottom-aligned — a one-line heading leaves a hole above its body`);
    }
    // And the PREVIEW must carry it, or it draws the heading at the top of the
    // band while the deck draws it at the bottom.
    const pm = toPreviewModel([cardsSlide]);
    const previewTitles = (pm.slides?.[0]?.elements ?? []).filter((e: any) => e.kind === "text" && e.vBottom);
    if (previewTitles.length !== titleIds.length) {
      fail(`preview shows ${previewTitles.length} bottom-aligned text boxes, the deck has ${titleIds.length} — the preview would disagree with the deck`);
    }

    // The stacked bar, in the exact shape that produced two bars both labelled
    // 12k: different compositions, identical totals.
    const stacked: SlideInput = {
      layout: "stacked-bar", title: "Where the budget is estimated to go",
      chart: { series: [
        { name: "Strategy-lite", points: [{ label: "Option 3 (low production)", value: 5 }, { label: "Option 3 (high production)", value: 4 }] },
        { name: "Production", points: [{ label: "Option 3 (low production)", value: 7 }, { label: "Option 3 (high production)", value: 8 }] },
      ] },
    };
    const sreqs = buildSlideRequests(stacked, 1, "p24b") as any[];
    const stexts = new Map<string, string>();
    for (const r of sreqs) if (r.insertText) stexts.set(r.insertText.objectId, r.insertText.text);
    const segLabels = Array.from(stexts.entries()).filter(([k]) => /kv\d+_\d+/.test(k)).map(([, v]) => v);
    if (segLabels.length !== 4) {
      fail(`expected 4 segment labels on a 2x2 stacked bar, found ${segLabels.length} (${segLabels.join(", ") || "none"}) — the split is unlabelled`);
    } else {
      // The values themselves, not merely four labels: repeating the total in
      // every segment would satisfy a count and still say nothing.
      for (const want of ["5", "7", "4", "8"]) {
        if (!segLabels.some((l) => l.replace(/[^\d.]/g, "") === want)) {
          fail(`segment value ${want} is not drawn (labels: ${segLabels.join(", ")})`);
        }
      }
    }

    // A segment too narrow for its own label draws nothing, rather than
    // spilling across the neighbouring colour and reading as its value.
    const lopsided: SlideInput = {
      layout: "stacked-bar", title: "T",
      chart: { series: [
        { name: "Tiny", points: [{ label: "Row", value: 0.4 }] },
        { name: "Huge", points: [{ label: "Row", value: 999 }] },
      ] },
    };
    const lreqs = buildSlideRequests(lopsided, 2, "p24c") as any[];
    const lseg = lreqs.filter((r) => r.insertText && /kv\d+_\d+/.test(r.insertText.objectId));
    if (lseg.length !== 1) fail(`a sliver should stay bare and a wide segment should be labelled: got ${lseg.length} segment labels, expected 1`);
  }
  if (failures === before24) pass("chip text covers its chip and is centred both ways; stacked segments carry their values, slivers stay bare");

  console.log(failures ? `\n${failures} FAILURE(S)\n` : `\nAll checks passed.\n`);
  process.exit(failures ? 1 : 0);
})();
