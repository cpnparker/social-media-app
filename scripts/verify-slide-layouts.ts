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
  buildSlideRequests, textBandsFor, type SlideInput,
} from "../lib/slides/generate";
import { toPreviewModel } from "../lib/slides/preview-model";
import { gradientProfileFor, CONTRAST } from "../lib/slides/images";
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
  { layout: "cards", eyebrow: "What we do", title: LONG, cards: [
      { marker: "STRATEGY", title: "Audience first", body: "Insight, competitive analysis and data shape the plan." },
      { marker: "STORYTELLING", title: "Made by editors", body: "A repeatable editorial process built to journalistic standards." },
      { marker: "AI VISIBILITY", title: "Measured", body: "How every major model describes you today, and how to improve it." } ] },
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
  { layout: "closing", title: "Thank You", subtitle: "www.thecontentengine.com", resolvedImage: PHOTO_DARK },
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
  { layout: "logo-wall", title: "Clients whose marks we do not have",
    logos: [{ name: "Holcim", resolvedUrl: "logo.png" }, { name: "Siemens Energy" }, { name: "Hiscox" }] },
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
    const { translateX: x, translateY: y } = ep.transform;
    const w = ep.size.width.magnitude, h = ep.size.height.magnitude;
    if (x < -0.5 || y < -0.5 || x + w > CANVAS.width + 0.5 || y + h > CANVAS.height + 0.5) {
      fail(`${slide.layout}: element at ${Math.round(x)},${Math.round(y)} (${Math.round(w)}x${Math.round(h)}) leaves the canvas`);
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
const HANDLED = new Set(["createSlide", "updatePageProperties", "createShape", "createImage",
  "updateShapeProperties", "insertText", "updateTextStyle", "updateParagraphStyle", "createParagraphBullets"]);
const emitted = new Set<string>();
ALL.forEach((s, i) => buildSlideRequests(s, i, "v").forEach((r) => emitted.add(Object.keys(r)[0])));
for (const kind of Array.from(emitted)) {
  if (!HANDLED.has(kind)) fail(`${kind} is drawn in the deck but never read into the preview`);
}
if (failures === before3) pass(`all ${emitted.size} request kinds are consumed`);

/* 4. The logo has to be visible against whatever is behind it. */
const before4 = failures;
console.log(`\n4. The lockup contrasts with what is behind it`);
deck.slides.forEach((page, i) => {
  const slide = ALL[i];
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

  console.log(failures ? `\n${failures} FAILURE(S)\n` : `\nAll checks passed.\n`);
  process.exit(failures ? 1 : 0);
})();
