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
  estimateLines, drawnTextHeight, inheritContinuationImages, type SlideInput,
} from "../lib/slides/generate";
import { toPreviewModel } from "../lib/slides/preview-model";
import { gradientProfileFor, CONTRAST } from "../lib/slides/images";
import { CANVAS, LAYOUT_STYLE, COLOR } from "../lib/slides/brand";

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
    const { translateX: x, translateY: y, scaleX = 1, scaleY = 1 } = ep.transform;
    // Slides renders at size x scale. The check read size alone, so an element
    // scaled past the edge (scaleX:2 on a full-bleed image) reported as fitting.
    const w = ep.size.width.magnitude * scaleX, h = ep.size.height.magnitude * scaleY;
    if (x < -0.5 || y < -0.5 || x + w > CANVAS.width + 0.5 || y + h > CANVAS.height + 0.5) {
      fail(`${slide.layout}: element at ${Math.round(x)},${Math.round(y)} (${Math.round(w)}x${Math.round(h)}, scale ${scaleX}x${scaleY}) leaves the canvas`);
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

  console.log(failures ? `\n${failures} FAILURE(S)\n` : `\nAll checks passed.\n`);
  process.exit(failures ? 1 : 0);
})();
