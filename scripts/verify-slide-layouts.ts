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
  buildSlideRequests, type SlideInput,
} from "../lib/slides/generate";
import { toPreviewModel } from "../lib/slides/preview-model";
import { CANVAS, LAYOUT_STYLE, COLOR } from "../lib/slides/brand";

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
  { layout: "two-column", title: LONG, body: "Left one\nLeft two", bodyRight: "Right one\nRight two" },
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
    chart: { source: "Source: a report with a long name, 2024", series: [{ name: "GW", points: [
      { label: "United Kingdom", value: 14.7 }, { label: "China", value: 31.4 },
      { label: "Germany", value: 8.3 }, { label: "Denmark", value: 2.3 } ] }] } },
  { layout: "stacked-bar", eyebrow: "Mix", title: LONG,
    chart: { source: "Source: delivery data", series: [
      { name: "Articles", points: [{ label: "Holcim", value: 38 }, { label: "Siemens", value: 22 }] },
      { name: "Video", points: [{ label: "Holcim", value: 26 }, { label: "Siemens", value: 18 }] },
      { name: "Infographics", points: [{ label: "Holcim", value: 19 }, { label: "Siemens", value: 11 }] } ] } },
  { layout: "closing", title: "Thank You", subtitle: "www.thecontentengine.com", resolvedImage: PHOTO_DARK },
];

/* 1. Nothing may fall off the canvas. */
console.log(`\n1. Every element stays on the 720x405 canvas`);
// Indexed loop, not .entries(): tsconfig sets no target, so iterating an
// iterator needs downlevelIteration and fails the production build.
for (let i = 0; i < DECK.length; i++) {
  const slide = DECK[i];
  for (const req of buildSlideRequests(slide, i, "v")) {
    const body: any = Object.values(req)[0];
    const ep = body?.elementProperties;
    if (!ep) continue;
    const { translateX: x, translateY: y } = ep.transform;
    const w = ep.size.width.magnitude, h = ep.size.height.magnitude;
    if (x < -0.5 || y < -0.5 || x + w > CANVAS.width + 0.5 || y + h > CANVAS.height + 0.5) {
      fail(`${slide.layout}: element at ${Math.round(x)},${Math.round(y)} (${Math.round(w)}x${Math.round(h)}) leaves the canvas`);
    }
  }
}
if (!failures) pass(`all ${DECK.length} layouts fit`);

/* 2. Text boxes must not sit on top of each other. */
const before2 = failures;
console.log(`\n2. No two text boxes overlap`);
const deck = toPreviewModel(DECK);
deck.slides.forEach((page, i) => {
  const texts = page.elements.filter((e) => e.kind === "text");
  for (let a = 0; a < texts.length; a++) {
    for (let b = a + 1; b < texts.length; b++) {
      const p = texts[a], q = texts[b];
      const apart = p.x + p.w <= q.x || q.x + q.w <= p.x || p.y + p.h <= q.y || q.y + q.h <= p.y;
      if (!apart) fail(`${DECK[i].layout}: "${String(p.text).slice(0, 18)}" overlaps "${String(q.text).slice(0, 18)}"`);
    }
  }
});
if (failures === before2) pass("no collisions, including with two-line titles");

/* 3. The preview must consume everything the builder emits. */
const before3 = failures;
console.log(`\n3. The preview drops nothing the deck is told`);
const HANDLED = new Set(["createSlide", "updatePageProperties", "createShape", "createImage",
  "updateShapeProperties", "insertText", "updateTextStyle", "updateParagraphStyle", "createParagraphBullets"]);
const emitted = new Set<string>();
DECK.forEach((s, i) => buildSlideRequests(s, i, "v").forEach((r) => emitted.add(Object.keys(r)[0])));
for (const kind of Array.from(emitted)) {
  if (!HANDLED.has(kind)) fail(`${kind} is drawn in the deck but never read into the preview`);
}
if (failures === before3) pass(`all ${emitted.size} request kinds are consumed`);

/* 4. The logo has to be visible against whatever is behind it. */
const before4 = failures;
console.log(`\n4. The lockup contrasts with what is behind it`);
deck.slides.forEach((page, i) => {
  const slide = DECK[i];
  const logo = page.elements.find((e) => e.kind === "image" && e.src?.includes("logo_engine"));
  if (!logo) return;
  const white = logo.src!.includes("white");
  const style = LAYOUT_STYLE[slide.layout!];
  if (style.background === null) return; // over a photograph, measured at bake time
  const darkGround = style.background === COLOR.navy || style.background === COLOR.blue;
  if (white && !darkGround) fail(`${slide.layout}: white lockup on ${style.background}`);
  if (!white && darkGround) fail(`${slide.layout}: navy lockup on ${style.background}`);
});
if (failures === before4) pass("no lockup is drawn on a ground it cannot be seen against");

console.log(failures ? `\n${failures} FAILURE(S)\n` : `\nAll checks passed.\n`);
process.exit(failures ? 1 : 0);
