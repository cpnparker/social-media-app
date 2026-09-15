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
  niceTicks, isNumericColumn, fitCell, fitColumnWidths, parseAccents, parseBold, deckWarnings, cardGeometry, bandHeightFor,
  CAPS_WIDEN, faceAdvance, stripImageMarkdown, drawnText, TEXT_INSET_X, TEXT_INSET_Y, pillWidth, droppedContent, fitHeading, FOOTER_Y, captionParagraphs, splitStageOwner, slideStyle,
  labelWidthPt,
  type SlideInput,
} from "../lib/slides/generate";
import { toPreviewModel } from "../lib/slides/preview-model";
import { applyEditSlide, unrenderableSlides, PAYLOAD_FIELDS, insertableLayout, normaliseSlide, SlideCallRefusal } from "../lib/slides/edit";
import { slidesFailure, parseSlidesArguments, SLIDES_FAILED_FOR_USER, type SlidesTurnState } from "../lib/slides/failure";
import { createToolLoopGuard } from "../lib/ai/tool-loop-guard";
import { deckToHtml, safeSrc } from "../lib/slides/pdf-html";
import { SLIDES_TEXT_INSET, NATURAL_LINE } from "../lib/slides/preview-style";
import { prepareSlidesForBuild, sourceSlideCount, fidelityAudit, SLIDES_GEN_OPENAI_TOOL, unresolvedSlidesNotice, createStreamingResponse } from "../lib/ai/providers";
import { draftPreview } from "../lib/slides/preview-model";
import { readFileSync } from "fs";
import { createServer } from "http";
import { join } from "path";
import { gradientProfileFor, CONTRAST } from "../lib/slides/images";
import { CANVAS, LAYOUT_STYLE, COLOR, GRID, LAYOUTS, NOTE, SECTION, TYPE, PROCESS } from "../lib/slides/brand";

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
  // The stat GRID (four or more figures, light ground) — the reference deck's
  // page 3. Labels of deliberately different lengths, so the row's shared
  // label height carries real slack and the centring rule has something to
  // measure; and a takeaway, so the bar has to follow the cards.
  { layout: "stat", eyebrow: "Context", title: LONG,
    note: "The correction that matters: search did not collapse, it split.",
    stats: [
      { value: "1B", label: "ChatGPT weekly active users", detail: "passed 1 billion, Aug 2026" },
      { value: "950M", label: "Gemini app monthly active users", detail: "Q2 2026 - AI Overviews reach 2.5B+" },
      { value: "68%", label: "of Google searches end without a click", detail: "SparkToro / Similarweb, Jan-Apr 2026" },
      { value: "+120%", label: "more clicks when you ARE cited in the AI Overview", detail: "Seer Interactive, 53 brands", tone: "teal" },
      { value: "4-5x", label: "conversion rate", detail: "reported range across 2026 studies" } ] },
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
  // Four across, numeral BESIDE the name, owners run into the captions the
  // way the model writes them, and a takeaway - the page-23 shape, so the
  // canvas, overlap and ink sweeps all see the beside variant too.
  { layout: "process", eyebrow: "Module 5", title: LONG, note: "Why this matters: the map is only as good as the corrections your team makes in step two.", stages: [
      { name: "We draft", caption: "Ahead of Session 2 we drafted a first entity mapping, based on our understanding of your business from public sources. Owner: TCE" },
      { name: "We refine together", caption: "Together we refine the proposed entity mapping, correcting any errors and hallucinations, and updating any obsolete information. Owner: TCE + your team" },
      { name: "You prioritise", caption: "Your team evaluates and assigns priority tiers and attributes to the retained entities in the mapping. Owner: your team" },
      { name: "We connect", caption: "We configure our AI visibility tool, AuthorityOn, from your work, so it interrogates the models on your selected entities and priority levels. Owner: TCE + your team" } ] },
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
  // The hub, as a deck uses it and overloaded: nine and eight connections with
  // long labels, a standfirst and a takeaway bar, so the pitch compresses and
  // three nodes are declared rather than drawn.
  { layout: "hub", title: "Everything TCE runs on, in {one place}", subtitle: "It reads only what you can already see.",
    hub: { title: "EngineAI", caption: "Picks the model, fetches the data, builds the answer", groups: [
      { name: "Engine company data", tone: "blue", items: ["Engine app", "Clients & contracts", "Tasks", "Resourcing", "Finance", "HR leave"]
        .map((title) => ({ title, icon: "briefcase", resolvedIcon: "icon.png" })) },
      { name: "Your own work tools", tone: "teal", items: ["Email", "Calendar", "Slack", "Microsoft 365", "Google Drive", "MeetingBrain"]
        .map((title) => ({ title, icon: "mail", resolvedIcon: "icon.png" })) } ] } },
  { layout: "hub", title: LONG, subtitle: "A standfirst that also runs long enough to wrap onto a second line under the title here.",
    note: "Why this matters: every answer starts from the company's own records rather than from the open web, and says which it used.",
    hub: { title: "A platform with a long name", caption: "A caption long enough to need more than one line inside the hub", groups: [
      { name: "Company data", tone: "blue", items: Array.from({ length: 9 }, (_, i) => ({ title: `Internal source number ${i + 1}`, resolvedIcon: "icon.png" })) },
      { name: "Work tools", tone: "teal", items: Array.from({ length: 8 }, (_, i) => ({ title: `External tool number ${i + 1}`, resolvedIcon: "icon.png" })) } ] } },
  // The layer diagram, overloaded: five bands, one with eight cells carrying
  // text, two captions, a suppressed arrow — every feature at its ceiling.
  { layout: "layers", title: "AI Is Not a New Channel - It's a New Layer",
    layers: [
      { title: "Your audience", style: "blue" },
      { title: "AI synthesis layer", caption: "ChatGPT · Gemini · Claude · Perplexity · Copilot · Google AI Overviews - reads, compares and synthesises across every channel below", style: "dashed" },
      { title: "Traditional channels", style: "lav", cells: [
        { title: "Website", text: "Owned content" }, { title: "LinkedIn", text: "Company + expert" },
        { title: "YouTube", text: "Video + transcript" }, { title: "Earned media", text: "News + editorial" },
        { title: "Wikipedia", text: "Wikidata entity" }, { title: "Industry pubs", text: "Trade + research" },
        { title: "Newsletters", text: "Email + web" }, { title: "Podcasts", text: "Audio + transcript" } ] },
      { title: "Social platforms", caption: "Indirect signals only - visuals are not readable by AI", style: "grey", arrow: "up" },
      { title: "Brands", style: "teal", arrow: false } ] },
  // Toned cards with the spanning strip and a takeaway bar, all at once.
  { layout: "cards", title: "The Three Answer Disciplines in 2026",
    subtitle: "Three disciplines share one goal - being the answer, and a standfirst long enough to wrap onto a second line so the row has to move down under it.",
    cards: [
      { title: "AEO - Answer Engine Optimisation", body: "Be the answer. Won on the page, in weeks.", tone: "blue" },
      { title: "GEO - Generative Engine Optimisation", body: "Be cited. Won around the brand, over months.", tone: "teal" },
      { title: "SXO - Search Experience Optimisation", body: "Be useful. The umbrella discipline, detailed below.", tone: "amber" } ],
    strip: { title: "SXO in detail - the sub-disciplines it governs", items: [
      { title: "SEO", text: "Organic search" }, { title: "SEA", text: "Paid search" },
      { title: "SEM", text: "SEO and SEA together" }, { title: "SMO", text: "Social media" },
      { title: "CRO", text: "Conversion rate" }, { title: "UX", text: "Speed, clarity, intent" } ] },
    note: "This workshop focuses on AEO and GEO - we flag which tactic serves which throughout." },
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
      // A box's vertical INSET is not content: Slides never draws a glyph in
      // the 3.6pt above or below the text. Table cells overhang their row by
      // exactly that, on purpose, so that ten rows do not spend 72pt on
      // padding — two cells whose insets touch are not two texts that touch.
      const iy = SLIDES_TEXT_INSET.y;
      const py0 = p.y + iy, py1 = p.y + Math.max(0, p.h - iy), qy0 = q.y + iy, qy1 = q.y + Math.max(0, q.h - iy);
      const apart = p.x + p.w <= q.x || q.x + q.w <= p.x || py1 <= qy0 || qy1 <= py0;
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
  // Through the RESOLVER, like every reader in the builder: a stat slide's
  // ground depends on its figure count, and reading the table directly made
  // this check report a navy lockup on the light grid.
  const style = slideStyle(slide, i);
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
  // Seven bullets fit the full-width body box and do NOT fit the half-width
  // one. A splitter measuring both against 671pt leaves the second overflowing.
  //
  // Re-pointed from five 110-character bullets when the estimator learned each
  // face's real advance. That fixture had been calibrated against a measure a
  // third too wide, and once the measure was right it fitted BOTH boxes — the
  // check went red saying the narrow layout had stopped splitting, when what
  // had actually changed was that the body now fitted. The property is
  // unchanged; only the size of body that exercises it moved.
  const seven = Array.from({ length: 7 }, (_, i) => `Bullet ${i + 1}: ${"x".repeat(80)}`).join("\n");
  const wide = splitOverflowingSlides([{ layout: "content", title: "T", body: seven }]);
  const narrow = splitOverflowingSlides([{ layout: "image-split", title: "T", body: seven }]);
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
   *  space beneath) but that where text DOES run over, it runs into nothing.
   *
   *  Semibold and bold Roboto are measured per glyph (labelWidthPt, margin
   *  divided out) since 2026-09-15, when hub nodes began to be sized that way.
   *  MUTATION LOG (detached worktree): killed — a process stage name drawn
   *  14pt narrower than it was measured ("Commissioning" runs onto its
   *  caption); killed — the sizing margin left in, which reports that same
   *  name, 73.9pt in 76.2, as overrunning while it draws on one line. */
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
  const inkOf = (el: { text?: string; w: number; size?: number; bullets?: boolean; font?: string; weight?: number }) => {
    const paras = String(el.text || "").split("\n");
    let lines = 0;
    // A semibold or bold Roboto box is measured glyph by glyph, with the same
    // primitive the layouts size those boxes with. Counted at the unnamed
    // 0.55em mean instead, a hub label sized to its measured width — it holds
    // one line, in Roboto, with 6% to spare — was reported as two lines
    // running onto the node below, and a mean that cries wolf here is one
    // nobody believes when it is right. (Its text is already in capitals when
    // the style draws them, so it is measured as drawn.) The sizing margin is
    // divided back out: this is the real ink, like the line box below, and
    // with the 6% left in, "Commissioning" — 73.9pt in 76.2pt, which draws on
    // one line — was reported as running onto its own caption.
    const bold = el.font === "Roboto" && (el.weight || 400) >= 600 && !el.bullets;
    for (const para of paras) {
      lines += bold
        ? Math.max(1, Math.ceil(labelWidthPt(para, el.size || 10) / 1.06 / Math.max(1, el.w - TEXT_INSET_X) - 1e-9))
        : Math.max(1, estimateLines(para, el.w, el.size || 10, el.bullets));
    }
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
  // AND THE RULE MUST CLEAR THE LOGO. The accent rule is drawn 22pt above the
  // title, and the title's ceiling used to be a bare fraction of the canvas
  // (0.24). That put the rule at y=103 while the cover logo runs 55.4 to
  // 111.6 — a lime bar through the middle of the wordmark, on the opening
  // slide of a deck that went to a client. Nothing caught it: every other
  // check on a cover looks at the title and the kicker, and the logo is placed
  // by a table nothing else on that slide goes near.
  {
    // The logo is a createImage, not a createShape — reading only shapes is
    // how a check that looks for the logo finds nothing and passes anyway.
    const geomOf = (reqs: any[], suffix: string) => {
      for (const r of reqs) {
        const o = r.createShape || r.createImage;
        if (o && String(o.objectId).endsWith(suffix)) {
          return { y: o.elementProperties.transform.translateY, h: o.elementProperties.size.height.magnitude };
        }
      }
      return null;
    };
    // A two-line title, because that is what pushes the composition upward and
    // it is the case that actually collided.
    const LONG_TITLE = "Building Authority on AI: from SEO to GEO";
    const long = buildSlideRequests(
      { layout: "cover", title: LONG_TITLE, subtitle: "A strategic workshop" }, 0, "nl") as any[];
    const rule = geomOf(long, "_crule");
    const logo = geomOf(long, "_logo");
    const ttl = geomOf(long, "_title");
    if (!rule || !logo || !ttl) {
      fail(`the no-photo cover is missing a rule, logo or title (rule=${!!rule} logo=${!!logo} title=${!!ttl})`);
    } else {
      // PRECONDITION: the title really does wrap to two lines here, or this
      // asserts nothing about the case that failed. Measured from the FITTED
      // SIZE, not from the box height — fitHeading floors the box at
      // GRID.coverTitleHeight, so a one-word title produces the same height as
      // a wrapped one and a height test can never fail. (It did not: shortening
      // the fixture to "Short" survived the mutation run that found this.)
      let titleSize = 0;
      for (const r of long) {
        if (r.updateTextStyle && String(r.updateTextStyle.objectId).endsWith("_title")) {
          titleSize = r.updateTextStyle.style?.fontSize?.magnitude || 0;
        }
      }
      const titleLines = titleSize ? estimateLines(LONG_TITLE, GRID.contentWidth, titleSize) : 0;
      if (titleLines < 2) {
        fail(`the cover fixture's title draws on ${titleLines} line(s) at ${titleSize}pt — a one-line title does not push the composition up, so this proves nothing about the collision`);
      }
      if (rule.y < logo.y + logo.h) {
        fail(`the cover accent rule (y ${rule.y.toFixed(1)}) is drawn inside the logo (${logo.y.toFixed(1)} to ${(logo.y + logo.h).toFixed(1)}) — a lime bar through the wordmark`);
      }
      if (rule.y + rule.h > ttl.y) fail(`the cover accent rule overlaps its own title`);
      if (ttl.y + ttl.h > CANVAS.height) fail(`the cover title runs off the bottom of the slide`);
    }
  }
  if (failures === before19) pass("no-photo cover is centred with an accent rule that clears the logo; the photo cover is unchanged");

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
    // This fixture used to HAVE to cut something — every cell rendered on one
    // line, so the prose columns carried an ellipsis and the check asserted
    // where the cut landed. Cells wrap now, rows size to their content, and
    // this table fits whole: the correct assertion flipped from "the cut lands
    // on prose" to "there is no cut". On a real client scorecard the old
    // engine truncated nearly every substantive cell while half the slide sat
    // empty.
    assertTable(denseCells.every((t) => t.slice(-1) !== "\u2026"),
      "a table that fits when wrapped is not cut at all");

    // The cut-placement property still holds where a cut is genuinely
    // unavoidable: a full twelve rows of long prose, at the one-line floor.
    const overTbl = buildSlideRequests({ layout: "table", title: "Overflow",
      table: { columns: ["#", "Action", "Owner", "Effort", "Expected outcome"],
        rows: Array.from({ length: 12 }, (_, i) => [String(i + 1),
          `A deliberately long action description that cannot fit on a single drawn line of a table cell no matter the split, row ${i + 1}`,
          "TC Digital + the client web team", "2 hours",
          `An equally long expected outcome sentence that also exceeds one drawn line at cell size, row ${i + 1}`]) } } as SlideInput, 0, "n");
    const overCells = (overTbl as any[]).filter((r) => (r.insertText?.objectId || "").match(/_tc\d+_\d+$/)).map((r) => r.insertText.text as string);
    assertTable(overCells.some((t) => t.slice(-1) === "\u2026"), "a truly overflowing table still cuts something");
    assertTable(overCells.filter((_, i) => i % 5 === 3).every((t) => t.slice(-1) !== "\u2026"),
      "and the cut still lands on prose, never on the narrow values");

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
      // The table's right edge is its header band's (the hairline it used to
      // be read from is gone: the band replaced it).
      if (/_thb$/.test(cs.objectId)) tableRight = x + w;
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
    //
    // READ FROM THE TOOL OBJECT, NOT THE FILE. This was a regex over
    // providers.ts for `hub: {` inside the editSlide block, and it stayed green
    // while generate_slides' own slide items declared no `hub` at all: 38c9d10
    // put the hub's schema on generate_document, and editSlide's bare-object
    // `hub` line matched the pattern. The model was sent a slide without the
    // field, guessed where its parts went, and was refused in front of the user
    // (2026-09-15). So the assertion is on what the model RECEIVES: every
    // payload is a declared property of `slides.items`, of
    // `editSlide.insertSlides.items` (the route long decks are built on), and
    // of `editSlide` itself, with a real shape rather than a bare object.
    //
    // MUTATION LOG for the size and single-route half (detached worktree,
    // 2026-09-15):
    //   killed  S1 insertSlides.items back to the full item schema: 72,546
    //           characters over the 55,000 ceiling, and the layout guidance and
    //           the table's guidance each counted twice
    //   killed  S2 one editSlide payload back to its full schema: the table's
    //           guidance counted twice — the ceiling alone would not see a
    //           single payload, which is why the count exists
    //   killed  S3 the hub pointer losing "INSIDE `hub`", on both routes
    //   killed  S4 leanSchema dropping nested properties: the hub declares no
    //           groups of titled items on either route. (A properties object
    //           left EMPTY passes the shapeless test, which checks presence.)
    //   killed  M1 `columns` out of PAYLOAD_FIELDS (a two-column insert and a
    //           columns-only patch both lose it); M2 `columns` off the editSlide
    //           schema; M3 notes no longer copied by a single insert
    const params: any = (SLIDES_GEN_OPENAI_TOOL as any).function.parameters;
    const itemProps = params?.properties?.slides?.items?.properties;
    const editProps = params?.properties?.editSlide?.properties;
    const insertProps = editProps?.insertSlides?.items?.properties;
    assertEdit(!!itemProps && !!editProps && !!insertProps, "precondition: slides.items, editSlide and editSlide.insertSlides.items all declare properties");
    if (itemProps && editProps && insertProps) {
      const notInItems = PAYLOAD_FIELDS.filter((f) => !itemProps[f]);
      const notInInsert = PAYLOAD_FIELDS.filter((f) => !insertProps[f]);
      const notInEdit = PAYLOAD_FIELDS.filter((f) => !editProps[f]);
      assertEdit(notInItems.length === 0, `slides[] does not declare payloads the builder draws: ${notInItems.join(", ")}`);
      assertEdit(notInInsert.length === 0, `editSlide.insertSlides[] does not declare: ${notInInsert.join(", ")}`);
      assertEdit(notInEdit.length === 0, `editSlide accepts these server-side but does not offer them: ${notInEdit.join(", ")}`);
      // "Same shape as in `slides`" on a bare object is a promise nothing kept.
      const shapeless = PAYLOAD_FIELDS.filter((f) => {
        const s = editProps[f];
        if (!s) return false;
        if (s.type === "object") return !s.properties;
        if (s.type === "array") return !s.items || (s.items.type === "object" && !s.items.properties);
        return false;
      });
      assertEdit(shapeless.length === 0, `editSlide declares these payloads as shapeless objects: ${shapeless.join(", ")}`);
      const hubSchema = itemProps.hub;
      assertEdit(!!(hubSchema && hubSchema.properties && hubSchema.properties.groups && hubSchema.properties.groups.items &&
        hubSchema.properties.groups.items.properties && hubSchema.properties.groups.items.properties.items),
        "a slide's hub declares its groups and their items INSIDE `hub`");
      assertEdit(/INSIDE `hub`/.test(String(hubSchema && hubSchema.description || "")),
        "and the hub's description says caption and groups go inside it, not beside the slide title");
      // The routes that point back at `slides` keep the SHAPE and the one
      // sentence the incident turned on, even with the rest of the prose gone.
      const routes: [string, any][] = [["editSlide.insertSlides[]", insertProps], ["editSlide", editProps]];
      for (let r = 0; r < routes.length; r++) {
        const route = routes[r][0];
        const h = routes[r][1].hub;
        assertEdit(!!(h && h.properties && h.properties.groups && h.properties.groups.items && h.properties.groups.items.properties &&
          h.properties.groups.items.properties.items && h.properties.groups.items.properties.items.items &&
          h.properties.groups.items.properties.items.items.properties && h.properties.groups.items.properties.items.items.properties.title),
          `${route}: the hub declares groups of titled items inside it`);
        assertEdit(/INSIDE `hub`/.test(String(h && h.description || "")), `${route}: the hub's description still says caption and groups go INSIDE it`);
      }
      // EVERY SLIDE FIELD reaches the single-slide route, or is named here as
      // deliberately not. `columns` was declared on slides[] and insertSlides[]
      // and on neither editSlide nor the copy applyEditSlide makes, so a
      // two-column insert lost its headers with no report.
      const SINGLE_ROUTE_EXCLUDED = ["image"];   // imageQuery stands in for it
      const missingOnEdit = Object.keys(itemProps).filter((k) => !editProps[k] && SINGLE_ROUTE_EXCLUDED.indexOf(k) < 0);
      assertEdit(missingOnEdit.length === 0, `editSlide does not offer these slide fields, and nothing says why: ${missingOnEdit.join(", ")}`);
    }
    // SIZE. Declaring the slide once and expanding it on every route made this
    // tool 85,364 characters, from 30,863 — about eleven thousand input tokens
    // on every EngineAI request, for the same schema sent three times. The
    // guidance now goes out once (on slides[]) and the other routes carry the
    // shape. The ceiling is the measured 50,618 plus room for a layout or two;
    // passing it is a decision to take, not a thing to discover on an invoice.
    const toolJson = JSON.stringify(SLIDES_GEN_OPENAI_TOOL);
    const TOOL_CEILING = 55000;
    assertEdit(toolJson.length <= TOOL_CEILING, `generate_slides is ${toolJson.length} characters, over its ${TOOL_CEILING} ceiling — is some guidance being sent more than once?`);
    const guidance = "A LONG DOCUMENT IS BUILT IN BATCHES, AND THE FIRST CALL IS NOT THE WHOLE DECK";
    const guidanceCopies = toolJson.split(guidance).length - 1;
    assertEdit(guidanceCopies === 1, `the layout guidance is sent ${guidanceCopies} times in generate_slides; once is the design`);
    const tableGuidance = "A source slide that carries commentary BESIDE its table";
    assertEdit(toolJson.split(tableGuidance).length - 1 === 1, `a payload's guidance is sent ${toolJson.split(tableGuidance).length - 1} times; the other routes should carry its shape only`);
    // And the single-slide route KEEPS what it now declares.
    const twoCol = applyEditSlide(deck, { insertAfter: 2, layout: "two-column", title: "Us and them", body: "Slow", bodyRight: "Fast",
      columns: { left: "Us", right: "Them" }, notes: "Say the second column louder" } as any);
    assertEdit(!!twoCol[2].columns && twoCol[2].columns.left === "Us" && twoCol[2].notes === "Say the second column louder",
      `a two-column insert through the single-slide fields keeps its column headers and notes (${JSON.stringify({ columns: twoCol[2].columns, notes: twoCol[2].notes })})`);
    let recolumned: any[] = [];
    try { recolumned = applyEditSlide(twoCol, { slideNumber: 3, columns: { left: "Before", right: "After" } } as any); } catch (e: any) { assertEdit(false, `a columns-only patch is refused: ${String(e && e.message).slice(0, 80)}`); }
    assertEdit(!!recolumned[2] && recolumned[2].columns && recolumned[2].columns.left === "Before", "a columns-only patch changes the headers");
    assertEdit(!!(editProps && editProps.insertSlides), "the schema offers insertSlides, or a long deck still takes a dozen turns");
    const layoutEnum: string[] = (editProps && editProps.layout && editProps.layout.enum) || [];
    for (const l of ["table", "stat", "bar-chart", "timeline", "hub"]) {
      assertEdit(layoutEnum.indexOf(l) >= 0, `the layout enum offers "${l}"`);
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

    assertFid(fidelityAudit(35, 35, true) === "", "a deck that matches its source says nothing");
    assertFid(fidelityAudit(0, 0, true) === "", "and nothing is said when the source is unknown");

    // A SHORT deck is unfinished work, not a talking point. A 38-page client
    // programme came back as 34 slides ending at the source's page 32 — the
    // tail (channels, KPIs, takeaways, appendix) simply gone — and the old
    // wording had the model offer to put the slides back instead of putting
    // them back. The user shipped the incomplete deck.
    const short = fidelityAudit(34, 38, true);
    assertFid(short.indexOf("38") >= 0 && short.indexOf("34") >= 0, `both counts are named (${short.slice(0, 60)})`);
    assertFid(/INCOMPLETE/.test(short), "a short conversion is called incomplete, not different");
    assertFid(/CONTINUE NOW without asking/.test(short), "and the instruction is to finish it, not to offer to");
    assertFid(/insertAfter: 34/.test(short), "with the exact append call to make");
    assertFid(/Do NOT tell the user the conversion is complete/.test(short),
      "and it may not describe the deck as done");
    // Fires for RESTYLE too — merging changes the middle; truncation eats the
    // tail — but with two slides of tolerance for genuine merging.
    assertFid(/INCOMPLETE/.test(fidelityAudit(30, 38, false)), "a restyle six short is truncation, not editing");
    assertFid(fidelityAudit(36, 38, false) === "", "while a restyle two short is within editorial tolerance");
    assertFid(fidelityAudit(36, 38, true) !== "", "which preserve does not get — one-for-one means one-for-one");

    const long = fidelityAudit(38, 35, true);
    assertFid(/MORE/.test(long), "a deck longer than its source is caught too");
    assertFid(fidelityAudit(38, 35, false) === "", "but only under preserve — a restyle may split freely");

    const audited = (prov.match(/fidelityAudit\(draft\.slides\.length, sourceSlideCount\(messages\), /g) || []).length;
    assertFid(audited === 4, `all four chains run the fidelity audit unconditionally (${audited} of 4)`);
    assertFid(!/fidelity === "preserve" \? fidelityAudit/.test(prov),
      "and no chain still gates the audit on the preserve flag — a forgotten flag was a silenced audit");

    // A PDF IS THE CONVERSION THIS AUDIT WAS WRITTEN FOR, AND IT COULD NOT SEE IT.
    //
    // `sourceSlideCount` could only count the pptx reader's "--- Slide N ---"
    // markers. A PDF has none, so sourceCount was 0, `fidelityAudit` returned
    // "" on its first line, and the one server-side thing that refuses to let
    // a short conversion be called finished was silent for the exact journey
    // it exists for. pdf-parse hands the route `numpages`; the route read it
    // and threw it away. The 38-page programme that this whole section is
    // named after was a PDF.
    //
    // Both ENDS are pinned here, because a marker only one side writes is a
    // marker nobody reads: the route's literal is lifted out of its own source
    // and fed to the reader.
    const routeSrc = readFileSync(join(__dirname, "..", "app/api/ai/conversations/[id]/messages/route.ts"), "utf8");
    const emits = /return pages > 0 \? `--- PDF: \$\{pages\} pages ---\\n\$\{text\}` : text;/.test(routeSrc);
    assertFid(emits, "the PDF reader records its page count instead of discarding numpages");
    assertFid(/const pages = Number\(\(data as any\)\.numpages\) \|\| 0;/.test(routeSrc),
      "and takes it from pdf-parse rather than guessing");
    const pdfCount = sourceSlideCount([{ role: "user", content: "x", attachments: [
      { url: "u", name: "programme.pdf", type: "application/pdf",
        extractedText: "--- PDF: 38 pages ---\nBuilding Authority on AI ... " } ] }] as any);
    assertFid(pdfCount === 38, `a PDF's page count is read as its source length (${pdfCount})`);
    assertFid(fidelityAudit(34, pdfCount, true).indexOf("INCOMPLETE") >= 0,
      "so 34 slides from a 38-page PDF is now called incomplete — it was silent before");
    // Not every "PDF" line is a count: prose must not be mistaken for one.
    assertFid(sourceSlideCount([{ role: "user", content: "x", attachments: [
      { url: "u", name: "d.pdf", type: "application/pdf", extractedText: "see --- PDF: 12 pages --- inline" } ] }] as any) === 0,
      "and a mention mid-line is not a page count");

    // THE SCHEMA MAY NOT LIE ABOUT THE MODEL'S OWN BUDGET. It told the model
    // it had three calls a turn while the guard granted six — a model
    // rationing itself to three at a dozen slides each stops around thirty-six
    // and, with the audit silent, has no reason to notice it stopped.
    const guardSrc = readFileSync(join(__dirname, "..", "lib/ai/tool-loop-guard.ts"), "utf8");
    const budget = Number((guardSrc.match(/generate_slides:\s*(\d+)/) || [])[1]);
    assertFid(budget > 0, `the guard's slide budget is readable (${budget})`);
    const claimed = (prov.match(/capped at (\w+) calls a turn/) || [])[1];
    const WORD: { [k: string]: number } = { one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8 };
    assertFid(WORD[claimed] === budget,
      `the schema tells the model it has "${claimed}" calls a turn while the guard grants ${budget}`);

    // AND THE CONVERSION RULE MUST BE IN THE TOOL'S OWN DESCRIPTION, not buried
    // in a per-slide enum where it competes with the always-on house rule that
    // says "10-25 slides". The batching instruction lived inside
    // slides.items.properties.layout.description — read last, if at all.
    const desc = (prov.match(/name: "generate_slides",\n\s*description:\n?\s*"([\s\S]*?)",\n/) || [])[1] || "";
    assertFid(desc.length > 0, "the generate_slides description is readable");
    assertFid(/HOUSE LENGTH GUIDANCE DOES NOT APPLY TO A CONVERSION/.test(desc),
      "the tool description overrides the house length rule for a conversion");
    assertFid(/BUILT IN BATCHES/.test(desc) && /insertAfter/.test(desc),
      "and carries the batching recipe itself, not only inside a layout enum");
    assertFid(/preserve/.test(desc), "and names the fidelity mode a conversion needs");
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
    assertBrand(c5texts.some((t: string) => t.indexOf("The Content Engine") === 0), "the footer names the house");
    // NO page number. It was static text, so it lied the moment the user
    // merged two slides by hand, and they removed it from every page.
    assertBrand(c5texts.indexOf("5") < 0, "and carries no page number — a static number is wrong after the first manual edit");
    // The deck's title joins the footer once the builder stamps it.
    const stamped = buildSlideRequests({ layout: "content", title: "T", body: "x", footer: "The Content Engine · Building Authority on AI" } as SlideInput, 4, "n");
    const stampedTexts = (stamped as any[]).filter((r) => r.insertText).map((r) => r.insertText.text);
    assertBrand(stampedTexts.indexOf("The Content Engine · Building Authority on AI") >= 0, "and names the deck when the builder has stamped it");
    for (const l of ["cover", "closing"] as const) {
      const t = (buildSlideRequests({ layout: l, title: "T" } as SlideInput, 0, "n") as any[])
        .filter((r) => r.insertText).map((r) => r.insertText.text);
      assertBrand(t.indexOf("The Content Engine") < 0, `no footer on the ${l}`);
    }
    // The footer lives in the margin band, below every layout's content floor.
    for (const r of c5 as any[]) {
      if (!(r.createShape?.objectId || "").match(/_ft[ln]$/)) continue;
      const fy = r.createShape.elementProperties.transform.translateY;
      // CLEAR OF THE BEZEL. At 1.5pt from the edge the footer sat inside the
      // overscan of most projectors — cropped, or stuck to the frame — and
      // the user removed it. The reference's credit line is ~15pt clear.
      assertBrand(CANVAS.height - fy >= 22, `the footer sits at least 22pt above the bottom edge, clear of projector overscan (${fy.toFixed(1)})`);
      // And still below every layout's floor: the takeaway bar's own bottom.
      assertBrand(fy >= NOTE.bottom + 4, `the footer (${fy.toFixed(1)}) sits below the takeaway bar's floor (${NOTE.bottom})`);
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

  /* 20h. Panels, and the PDF print of the preview. */
  const before20h = failures;
  console.log(`\n20h. The panel device, and the PDF export`);
  {
    const assertP = (ok: boolean, m: string) => { if (!ok) fail(m); };

    // THE PANEL. The master's rounded card beside the prose, blue with white
    // ink or soft lavender, up to four titled items with drops declared.
    const withPanel: SlideInput = { layout: "content", title: "A disciplined engine", body: "Prose beside the panel.",
      panel: { title: "A combination of:", items: [
        { title: "Process", text: "A disciplined workflow." },
        { title: "People", text: "Editors and analysts." },
        { title: "Platform", text: "The tooling underneath." },
        { title: "Proof", text: "Measured outcomes." },
        { title: "Extra", text: "Past the ceiling." } ] } };
    const pr = buildSlideRequests(withPanel, 0, "n");
    const prTexts = (pr as any[]).filter((r) => r.insertText).map((r) => r.insertText.text);
    assertP(prTexts.indexOf("A combination of:") >= 0, "the panel title is drawn");
    assertP(["Process", "People", "Platform", "Proof"].every((t) => prTexts.indexOf(t) >= 0), "with its four items");
    assertP(prTexts.indexOf("Extra") < 0, "the fifth is dropped — the kit's ceiling is four");
    assertP(prTexts.some((t: string) => t.indexOf("Showing 4 of 5") >= 0), "and the drop is declared on the slide");
    const round = (pr as any[]).find((r) => r.createShape?.shapeType === "ROUND_RECTANGLE");
    assertP(!!round, "the card is a rounded rectangle");
    // The panel replaces the rail and narrows the prose: the title must be
    // measured against the narrow column, or fitHeading fits it to a width the
    // panel is about to take a third of.
    const titleReq = (pr as any[]).find((r) => (r.createShape?.objectId || "").endsWith("_title"));
    assertP(titleReq.createShape.elementProperties.size.width.magnitude <= GRID.proseNarrow + 1,
      `the title is measured against the narrowed prose (${Math.round(titleReq.createShape.elementProperties.size.width.magnitude)})`);
    assertP(!(pr as any[]).some((r) => (r.createShape?.objectId || "").endsWith("_rail") || (r.createImage?.objectId || "").endsWith("_rail")),
      "and the photo rail gives way — the master carries a panel or an image, never both");
    // No panel content may cross the card's right edge.
    const cardRight = round.createShape.elementProperties.transform.translateX + round.createShape.elementProperties.size.width.magnitude;
    for (const r of pr as any[]) {
      if (!(r.createShape?.objectId || "").match(/_pn[htb]\d*$/)) continue;
      const t = r.createShape.elementProperties;
      assertP(t.transform.translateX + t.size.width.magnitude <= cardRight + 0.5, "panel text stays inside the card");
    }
    // The soft variant flips fill and ink.
    const soft = buildSlideRequests({ ...withPanel, panel: { ...withPanel.panel!, style: "soft" } }, 0, "n");
    const softRound = (soft as any[]).find((r) => r.createShape?.shapeType === "ROUND_RECTANGLE");
    const softFill = (soft as any[]).find((r) => r.updateShapeProperties?.objectId === softRound.createShape.objectId);
    const c = softFill.updateShapeProperties.shapeProperties.shapeBackgroundFill.solidFill.color.rgbColor;
    assertP(Math.abs(c.red - 0.882) < 0.01 && c.blue === 1, "the soft variant is the lavender fill");
    // And an edit can carry it.
    assertP(PAYLOAD_FIELDS.indexOf("panel") >= 0, "editSlide can carry a panel");

    // THE PDF. Pure first: the HTML is the preview model, escaped, at 960x540.
    const evil: SlideInput = { layout: "content", title: 'Injection <script>document.title="pwned"</script>', body: "safe" };
    const deck = [
      { layout: "cover", title: "Response to {Request for Proposal}" } as SlideInput,
      evil,
      { layout: "table", title: "Figures", table: { columns: ["A", "B"], rows: [["x", "1"], ["y", "2"]] } } as SlideInput,
    ];
    const html = deckToHtml(toPreviewModel(deck), "Brand test");
    assertP(html.indexOf("<script>") < 0, "slide text cannot inject markup into the print browser");
    assertP(html.indexOf("&lt;script&gt;") >= 0, "it arrives escaped instead of dropped");
    assertP((html.match(/<section class="slide"/g) || []).length === 3, "one page per slide");
    assertP(html.indexOf(`width:960px;height:540px`) >= 0, "on the master template's 960x540 canvas");
    // The ELEMENTS scale too, not only the page box: printing at Slides points
    // inside a 960px page draws the deck in the top-left three-quarters. The
    // margin lands at 24.48 x 4/3 = 32.64, and that exact left proves the
    // scale reached the elements.
    assertP(html.indexOf("left:32.64px") >= 0, "elements are scaled to the 960 canvas, not left at Slides points");
    assertP(/font-style:italic/.test(html), "the accent phrase prints italic");
    assertP(/#c0ff7e/i.test(html), "and lime on the dark cover");
    assertP(html.indexOf("{Request") < 0, "braces do not leak into the print");
    assertP(/@page \{ size: 10in 5.625in/.test(html), "the page is 10 by 5.625 inches");
    assertP(safeSrc("https://x.test/a.png") !== null && safeSrc("data:image/png;base64,AA") !== null,
      "web and data images pass");
    assertP(safeSrc("file:///etc/passwd") === null && safeSrc("chrome://settings") === null,
      "file and chrome URLs never reach the print browser");
  }
  if (failures === before20h) pass("the panel draws inside its card with drops declared, and the PDF is the escaped preview at 960x540");

  /* 20i. A published deck is the user's file, and a deck gets a real name. */
  //
  // Chris hand-edited a deck EngineAI had created in Drive; a later chat turn
  // ran the in-place update and REPLACED every slide. His work was gone. The
  // policy is absolute now: once created, a Drive deck is never written again —
  // edits continue on the draft, publishing again creates a new file. Two locks:
  // prepareSlidesForBuild strips every presentationId, and buildOrUpdateSlides
  // ignores the parameter outright.
  const before20i = failures;
  console.log(`\n20i. Drive decks are never touched again, and get real names`);
  {
    const assertI = (ok: boolean, m: string) => { if (!ok) fail(m); };
    const conv = `verify-pub-${process.pid}`;
    // Build a deck, as a turn would, with the model TRYING to pass an id.
    const built = await prepareSlidesForBuild(
      { title: "", presentationId: "someones-drive-file", slides: [{ layout: "cover", title: "Finance Update 2026" }, { layout: "content", title: "Two", body: "x" }] },
      conv
    );
    assertI(built.presentationId === undefined, "a model-supplied presentationId is stripped on a full build");
    // And on the edit path, where the stored deck may carry a published id.
    const edited = await prepareSlidesForBuild(
      { slides: [], editSlide: { insertAfter: 2, insertSlides: [{ layout: "content", title: "Three", body: "y" }] }, presentationId: "someones-drive-file" },
      conv
    );
    assertI(edited.presentationId === undefined, "and on an edit, even when the stored deck was published");
    assertI(edited.slides.length === 3, "while the edit itself still lands");
    // The publish button route must have no update path left at all.
    const pubRoute = readFileSync(join(__dirname, "..", "app/api/slides/publish/route.ts"), "utf8");
    assertI(pubRoute.indexOf("updateSlides") < 0, "the publish route cannot update a Drive file");
    const prov2 = readFileSync(join(__dirname, "..", "lib/ai/providers.ts"), "utf8");
    assertI(/void presentationId;/.test(prov2), "buildOrUpdateSlides ignores the id outright — the second lock");
    assertI(!/await updateSlides\(/.test(prov2), "and no chat path calls updateSlides at all");

    // THE NAME. "Presentation" as a Drive filename is how a folder fills with
    // files nobody can tell apart. The cover's own title stands in.
    assertI(built.title === "Finance Update 2026", `an untitled deck takes its cover title (${built.title})`);
    const named = await prepareSlidesForBuild({ title: "Q3 Review", slides: [{ layout: "cover", title: "Other" }] }, `${conv}-b`);
    assertI(named.title === "Q3 Review", "a given title still wins");
    const bare = await prepareSlidesForBuild({ slides: [{ layout: "content", body: "x", title: "" }, { layout: "content", title: "Real", body: "y" }] }, `${conv}-c`);
    assertI(bare.title === "Presentation", "and the generic word only when there is truly nothing to name it by");

    // EXECUTION-PHASE PROGRESS: the image resolver ticks, so the minutes-long
    // photo phase cannot read as a hang.
    const ticks: [number, number][] = [];
    await resolveDeckImages(
      [{ layout: "content", title: "T", body: "x", image: { url: "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==" } } as SlideInput,
       { layout: "content", title: "U", body: "y" } as SlideInput],
      undefined, undefined,
      (done, total) => ticks.push([done, total])
    );
    assertI(ticks.length >= 1, `the resolver reports progress (${ticks.length} ticks)`);
    assertI(ticks.every(([, t]) => t === 1), `against the real pending count, not the slide count (${JSON.stringify(ticks)})`);
    const wired2 = (prov2.match(/slides_progress: \{ images: \{ done, total \} \}/g) || []).length;
    assertI(wired2 === 4, `all four chains stream image progress (${wired2} of 4)`);
  }
  {
    const assertI = (ok: boolean, m: string) => { if (!ok) fail(m); };
    // THE NOTE, when a deck already exists in Drive. Without it the model told
    // the user "that should be visible now — try refreshing" about a Drive file
    // the policy forbids touching. All four chains must carry it, gated on the
    // flag the DB row answers.
    const prov3 = readFileSync(join(__dirname, "..", "lib/ai/providers.ts"), "utf8");
    const noted = (prov3.match(/A DECK ALREADY EXISTS IN DRIVE/g) || []).length;
    assertI(noted === 4, `all four chains tell the model about an existing Drive deck (${noted} of 4)`);
    assertI((prov3.match(/prepared\.publishedBefore \?/g) || []).length === 4, "gated on the flag, not always-on");
    assertI(/publishedBefore = !!dbDraft\?\.published\?\.presentationId/.test(prov3),
      "and the flag is answered by the DATABASE row, which the Create button stamps from another process");
  }
  if (failures === before20i) pass("no path can write into a Drive deck, decks take their cover's name, the photo phase reports progress, and an existing Drive deck is named to the model");

  /* 20i-bis. The devices the source deck uses on nearly every page. */
  //
  // A 38-page client deck was converted and came back visibly poorer than the
  // original. Three causes, all in the engine rather than the content:
  //
  //   - `stat` was capped at THREE figures. A page carrying seven rendered as
  //     three, with four silently gone. A slide that looks finished and is
  //     missing more than half its data is the worst failure available here.
  //   - There was nowhere to put the "Why this matters:" sentence the source
  //     puts along the foot of almost every page, so it went into `subtitle`
  //     (competing with the standfirst) or into `body` (reading as one more
  //     bullet), and the most quotable line on the page lost its emphasis.
  //   - Two columns were always bare lists with a hairline. The source tints
  //     them and inks the headings to match, which is how it carries "what
  //     does not work" against "what does".
  const before20ib = failures;
  console.log(`\n20i-bis. Stat grid, takeaway bar, tinted columns`);
  {
    const assertD = (ok: boolean, m: string) => { if (!ok) fail(m); };

    // SEVEN FIGURES, all of them drawn.
    const seven = ["1B", "950M", "68%", "+120%", "4-5x", "36%", "38%"];
    const statSlide: SlideInput = {
      layout: "stat", title: "The Search Landscape Has Changed",
      stats: seven.map((v, i) => ({ value: v, label: `label ${i}`, detail: `source ${i}`, primary: i === 3 })),
    };
    const sr = buildSlideRequests(statSlide, 0, "n") as any[];
    const sTexts = sr.filter((r) => r.insertText).map((r) => r.insertText.text);
    for (const v of seven) assertD(sTexts.indexOf(v) >= 0, `stat grid draws ${v} — a capped layout dropped four of these`);
    for (let i = 0; i < 7; i++) assertD(sTexts.indexOf(`source ${i}`) >= 0, `and keeps caption ${i}, which the half-height card used to clip`);
    // Two rows, and a card behind each figure so the grid is drawn for the eye.
    const cards = sr.filter((r) => (r.createShape?.objectId || "").match(/_sc\d+$/));
    assertD(cards.length === 7, `every figure gets a card (${cards.length})`);
    const ys = Array.from(new Set(cards.map((r) => Math.round(r.createShape.elementProperties.transform.translateY))));
    assertD(ys.length === 2, `laid out in two rows (${ys.length})`);
    // The primary card is the MINT one, and its ink is chosen from the CARD
    // rather than the ground — blue on navy and mint on mint were both shipped
    // by taking it from the slide.
    const primaryCard = sr.find((r) => (r.createShape?.objectId || "").endsWith("_sc3"));
    const primaryFill = sr.find((r) => r.updateShapeProperties?.objectId === primaryCard.createShape.objectId);
    const pc = primaryFill.updateShapeProperties.shapeProperties.shapeBackgroundFill.solidFill.color.rgbColor;
    assertD(Math.abs(pc.red - 0.882) < 0.02 && Math.abs(pc.green - 0.961) < 0.02,
      `the primary figure takes the mint card (${JSON.stringify(pc)})`);
    // AND ITS INK COMES FROM THE CARD, not from the slide. `stat` is a DARK
    // layout, so taking the ink from the ground put lime on mint (invisible)
    // and brand blue on navy (unreadable). This is the assertion that was
    // missing: the fill check above passed happily with the ink wrong.
    const inkOf = (sfx: string) => {
      const r = sr.find((q) => q.updateTextStyle?.objectId?.endsWith(sfx) && q.updateTextStyle.style?.foregroundColor);
      const c = r?.updateTextStyle?.style?.foregroundColor?.opaqueColor?.rgbColor || {};
      return [c.red || 0, c.green || 0, c.blue || 0].map((v: number) => Math.round(v * 255)).join(",");
    };
    const primaryInk = inkOf("_sv3");
    const otherInk = inkOf("_sv0");
    assertD(primaryInk === "15,110,86",
      `the figure on the mint card is inked dark teal whatever the ground (${primaryInk})`);
    assertD(primaryInk !== otherInk,
      "and differs from the figures on the dark cards, which is the whole point of marking it");
    // The purpose of the old "never brand blue" rule was that a figure must be
    // readable on WHAT IS BEHIND IT. The grid moved to off-white cards, where
    // brand blue is the reference's own ink for its landscape figures, so the
    // rule is now the measurement it always stood for: every figure clears
    // 4.5:1 against its own card's tint.
    {
      const fillOf = (sfx: string) => {
        const r = sr.find((q: any) => q.updateShapeProperties?.objectId?.endsWith(sfx));
        const c = r?.updateShapeProperties?.shapeProperties?.shapeBackgroundFill?.solidFill?.color?.rgbColor || {};
        return [c.red || 0, c.green || 0, c.blue || 0];
      };
      const lum = (ch: number[]) => {
        const f = ch.map((v) => (v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4)));
        return 0.2126 * f[0] + 0.7152 * f[1] + 0.0722 * f[2];
      };
      const ratio = (a: number[], b: number[]) => {
        const la = lum(a), lb = lum(b);
        return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05);
      };
      const inkRgb = (sfx: string) => {
        const r = sr.find((q: any) => q.updateTextStyle?.objectId?.endsWith(sfx) && q.updateTextStyle.style?.foregroundColor);
        const c = r?.updateTextStyle?.style?.foregroundColor?.opaqueColor?.rgbColor || {};
        return [c.red || 0, c.green || 0, c.blue || 0];
      };
      for (let i = 0; i < 5; i++) {
        const card = fillOf(`_sc${i}`), ink = inkRgb(`_sv${i}`);
        if (!card.some(Boolean) && !ink.some(Boolean)) continue;
        const r = ratio(ink, card);
        assertD(r >= 4.5, `figure ${i} is ${r.toFixed(2)}:1 on its own card — a number nobody can read`);
      }
    }
    // Four or fewer keeps the original one-row treatment untouched.
    const three = buildSlideRequests({ layout: "stat", title: "T",
      stats: [{ value: "1", label: "a" }, { value: "2", label: "b" }, { value: "3", label: "c" }] } as SlideInput, 0, "n") as any[];
    assertD(!three.some((r) => (r.createShape?.objectId || "").match(/_sc\d+$/)),
      "three figures stay the plain one-row treatment, uncarded");
    // Past the ceiling, the drop is DECLARED.
    const nine = buildSlideRequests({ layout: "stat", title: "T",
      stats: Array.from({ length: 9 }, (_, i) => ({ value: `${i}`, label: `l${i}` })) } as SlideInput, 0, "n") as any[];
    const nineTexts = nine.filter((r) => r.insertText).map((r) => r.insertText.text);
    assertD(nineTexts.some((t: string) => /Showing 8 of 9 figures/.test(t)),
      "past the ceiling the slide says how many it dropped");

    // THE TAKEAWAY BAR, on any layout, shortening the band rather than
    // overlapping it.
    const noted: SlideInput = { layout: "content", title: "T", body: "prose",
      note: "Why this matters: the sentence that tells the reader what to do with the slide above it." };
    const nr = buildSlideRequests(noted, 0, "n") as any[];
    const bar = nr.find((r) => (r.createShape?.objectId || "").endsWith("_noteBar"));
    assertD(!!bar, "the takeaway bar is drawn");
    const barTop = bar.createShape.elementProperties.transform.translateY;
    const barH = bar.createShape.elementProperties.size.height.magnitude;
    assertD(barTop + barH <= 389, `it clears the footer (${(barTop + barH).toFixed(1)})`);
    assertD(bandHeightFor(noted) < GRID.bandHeight,
      "and the content band above it is shortened, so the two can never overlap");
    assertD(bandHeightFor({}) === GRID.bandHeight, "while a slide without one keeps the full band");
    // The bold lead-in is a RUN, so the sentence still wraps as one paragraph.
    const lead = nr.find((r) => r.updateTextStyle?.style?.bold && r.updateTextStyle.textRange?.type === "FIXED_RANGE");
    assertD(!!lead, "the lead-in is drawn bold");
    assertD(lead.updateTextStyle.textRange.endIndex === "Why this matters:".length,
      `ending at the colon (${lead?.updateTextStyle?.textRange?.endIndex})`);
    // No content may be drawn inside the bar's own band.
    for (const r of nr) {
      const oid = r.createShape?.objectId || "";
      if (!oid || /_(noteBar|noteTxt|ftl|ftn|logo)$/.test(oid)) continue;
      const t = r.createShape.elementProperties;
      assertD(t.transform.translateY + t.size.height.magnitude <= barTop + 1,
        `${oid.split("_").pop()} stops above the takeaway bar`);
    }

    // TINTED COLUMNS. The tint makes the card a LIGHT surface whatever the
    // ground, so heading and body ink come from the tone, not the slide.
    const toned: SlideInput = { layout: "two-column", title: "T",
      columns: { left: "What AIO does not do", right: "What AIO is genuinely good for" },
      body: "left one", bodyRight: "right one", tones: ["coral", "teal"] };
    const tr = buildSlideRequests(toned, 0, "n") as any[];
    const panels = tr.filter((r) => (r.createShape?.objectId || "").match(/_t[lr]$/));
    assertD(panels.length === 2, `both columns get a tinted panel (${panels.length})`);
    assertD(panels.every((r) => r.createShape.shapeType === "ROUND_RECTANGLE"), "as rounded cards");
    const lh = tr.find((r) => r.updateTextStyle?.objectId?.endsWith("_lh") && r.updateTextStyle.style?.foregroundColor);
    const rh = tr.find((r) => r.updateTextStyle?.objectId?.endsWith("_rh") && r.updateTextStyle.style?.foregroundColor);
    const hex = (c: any) => [c.red, c.green, c.blue].map((v: number) => Math.round((v || 0) * 255)).join(",");
    assertD(hex(lh.updateTextStyle.style.foregroundColor.opaqueColor.rgbColor) !== hex(rh.updateTextStyle.style.foregroundColor.opaqueColor.rgbColor),
      "and their headings are inked differently, which is what carries the contrast");
    // The hairline is the PLAIN treatment's device. Drawing both looked wrong.
    assertD(!tr.some((r) => (r.createShape?.objectId || "").endsWith("_vrule")),
      "the hairline gives way to the cards rather than being drawn over them");
    const plain = buildSlideRequests({ ...toned, tones: undefined }, 0, "n") as any[];
    assertD(plain.some((r) => (r.createShape?.objectId || "").endsWith("_vrule")),
      "while a plain two-column keeps its hairline");
    assertD(!plain.some((r) => (r.createShape?.objectId || "").match(/_t[lr]$/)),
      "and gets no panels");
  }
  if (failures === before20ib) pass("seven figures survive as seven, the takeaway bar owns its own band, and tinted columns carry the contrast");

  /* 20i-quater. Three collisions Google drew that the estimator did not. */
  //
  // The 39-slide deck was built, published, and then READ BACK from Google —
  // which is the only way these three were ever going to surface. All three are
  // the same mistake in three places: a box sized by assumption rather than by
  // measurement, drawing over its neighbour or out through its own edge.
  //
  //   - A stat label got a fixed 0.3in. "MORE CLICKS WHEN YOU ARE CITED IN THE
  //     AI OVERVIEW" wrapped to three lines and its own source line was drawn
  //     through the third. The estimator said two lines because the label is
  //     CAPS and PER_CHAR is a mixed-case average.
  //   - A panel's cursor walked down at fixed sizes and never looked at the box
  //     it was inside, so the fourth item's second line landed on the slide
  //     below the rounded corner.
  //   - A status pill's width was the token's advance plus a flat 16pt, which
  //     did not even cover the text box's own 14.4pt inset. Every capsule on
  //     the channel scorecard wrapped inside itself: "ME / D", "NON / E".
  //
  // MUTATION LOG
  //   - stat label height back to the fixed CHART constant  → KILLED
  //   - panel plan ladder bypassed (always PLANS[0])        → KILLED
  //   - pill width back to the flat `+ 16`                  → KILLED
  //   - pillWidth loses the inset (the shipped bug, exactly) → KILLED
  //   - pillWidth stops reading the token's length           → KILLED
  //   - the `pillW <= inner(j)` fallback removed             → SURVIVED, and
  //     kept. The first attempt to pin it was a "narrow table" fixture that
  //     drew eight ordinary pills: fitColumnWidths will not leave a status
  //     column tight enough, so the loop asserting the fallback ran entirely
  //     against the branch it meant to exclude — a check testing NOTHING while
  //     reporting a pass. The branch is genuinely unreachable through today's
  //     tables; it is a guard for a future narrower column, and no assertion
  //     here can honestly claim to hold it. What IS pinned is pillWidth, at
  //     the seam, where both mutations above die.
  //   - caps widening removed from the STAT LABEL           → SURVIVED, and
  //     kept anyway. At the four-column width the mixed-case estimate already
  //     reaches three lines, so CAPS_WIDEN changes nothing there; what fixed
  //     slide 3 was measuring the label AT ALL. The constant is load-bearing
  //     for the PILL, where its mutation is killed. Recorded rather than
  //     tidied away: the widening is the correct measurement, but no assertion
  //     here depends on it, and a later reader should not think one does.
  const before20iq = failures;
  console.log(`\n20i-quater. Boxes measured against what Google actually draws`);
  {
    const assertQ = (ok: boolean, m: string) => { if (!ok) fail(m); };

    // CAPS ARE WIDER, and the estimator must say so or every caps box is
    // measured short.
    assertQ(CAPS_WIDEN > 1, `an all-caps run is measured wider than mixed case (${CAPS_WIDEN})`);
    const phrase = "MORE CLICKS WHEN YOU ARE CITED IN THE AI OVERVIEW";
    // Swept rather than pinned to one width: at most widths the two round to
    // the same integer, and an assertion tuned to a single lucky width would
    // pass on a CAPS_WIDEN of 1.0001 and prove nothing.
    let everWider = false;
    for (let w = 90; w <= 260; w += 5) {
      const mixed = estimateLines(phrase, w, 10, false, false);
      const caps = estimateLines(phrase, w, 10, false, true);
      assertQ(caps >= mixed, `caps never wraps to FEWER lines than mixed case (w=${w}: ${mixed} → ${caps})`);
      if (caps > mixed) everWider = true;
    }
    assertQ(everWider, "and wraps to more lines across the widths a stat column actually takes");

    // THE STAT LABEL, in the exact shape that collided: four figures, one row,
    // the fourth carrying the long caps label with a source line under it.
    const four: SlideInput = {
      layout: "stat", title: "The Search Landscape Has Changed",
      stats: [
        { value: "1B", label: "ChatGPT weekly active users", detail: "passed 1 billion, Aug 2026" },
        { value: "950M", label: "Gemini app monthly active users", detail: "Q2 2026 · AI Overviews reach 2.5B+" },
        { value: "68%", label: "of Google searches end without a click", detail: "SparkToro / Similarweb, Jan-Apr 2026" },
        { value: "+120%", label: "More clicks when you are cited in the AI Overview", detail: "Seer Interactive, 53 brands, 5.47M queries" },
      ],
    };
    const fr = buildSlideRequests(four, 0, "n") as any[];
    const boxOf = (sfx: string) => {
      const r = fr.find((q) => (q.createShape?.objectId || "").endsWith(sfx));
      const e = r?.createShape?.elementProperties;
      return e ? { y: e.transform.translateY, h: e.size.height.magnitude } : null;
    };
    // FOUR is the grid's threshold now, not five. The reference's page 3 sets
    // seven figures as 4 + 3 bordered cards on a light ground; ours drew four
    // as a 54pt navy hero row and demoted the other three to bullets, so the
    // takeaway's "note the second row" pointed at a row that did not exist.
    assertQ(fr.filter((r) => (r.createShape?.objectId || "").match(/_sc\d+$/)).length === 4,
      "four figures are drawn as four cards, not a hero row");
    for (let i = 0; i < 4; i++) {
      const label = boxOf(`_sl${i}`);
      const detail = boxOf(`_sd${i}`);
      assertQ(!!label && !!detail, `column ${i} draws both its label and its source line`);
      if (label && detail) {
        assertQ(label.y + label.h <= detail.y + 0.5,
          `column ${i}'s source line starts below its label, not through it ` +
          `(label ends ${(label.y + label.h).toFixed(1)}, source starts ${detail.y.toFixed(1)})`);
      }
    }
    // The long label is the one that must have grown the row. If every label
    // box is still the old fixed height, the fix did not happen.
    const l3 = boxOf("_sl3")!;
    assertQ(l3.h > 22, `the wrapping label is given the height it needs (${l3.h.toFixed(1)}pt)`);

    // AND THE BODY BELOW THEM. Fixing the label collision immediately caused a
    // second one: the stat band was a flat 56% of the content band, so a taller
    // figure block ran straight through the first supporting bullet. This is
    // the slide as it actually is — four figures AND a body — and the two must
    // not touch.
    const withBody: SlideInput = { ...four, body:
      "**4-5x** conversion rate of AI-referred visitors - reported range across 2026 studies\n" +
      "**36%** of informational queries now show an AI Overview - commercial 8%, transactional 5%\n" +
      "**38%** of AI Overview citations come from pages in the organic top 10 - down from 76%" };
    const wr = buildSlideRequests(withBody, 0, "n") as any[];
    const wbox = (sfx: string) => {
      const r = wr.find((q) => (q.createShape?.objectId || "").endsWith(sfx));
      const e = r?.createShape?.elementProperties;
      return e ? { y: e.transform.translateY, h: e.size.height.magnitude } : null;
    };
    const bodyBox = wbox("_body");
    assertQ(!!bodyBox, "the supporting bullets are drawn");
    const statsBottom = Math.max(...["_sd0", "_sd1", "_sd2", "_sd3"].map((s) => {
      const b = wbox(s); return b ? b.y + b.h : 0;
    }));
    assertQ(!!bodyBox && bodyBox.y >= statsBottom,
      `the bullets start below the source lines, not through them ` +
      `(figures end ${statsBottom.toFixed(1)}, bullets start ${bodyBox?.y.toFixed(1)})`);
    assertQ(!!bodyBox && bodyBox.y + bodyBox.h <= GRID.bodyY + GRID.bandHeight + 1,
      "and the bullets still end inside the band");
    // And the whole block still sits inside the band.
    const lowest = Math.max(...["_sd0", "_sd1", "_sd2", "_sd3"].map((s) => {
      const b = boxOf(s); return b ? b.y + b.h : 0;
    }));
    assertQ(lowest <= GRID.bodyY + GRID.bandHeight + 1,
      `and the row still ends inside the band (${lowest.toFixed(1)} vs ${(GRID.bodyY + GRID.bandHeight).toFixed(1)})`);

    // THE PANEL, with the four items that ran out through its bottom edge.
    const panelled: SlideInput = {
      layout: "content", eyebrow: "MODULE 2", title: "What Is an Entity? Think {Nodes, Not Strings}",
      subtitle: "An entity is a distinct, identifiable thing that Google and AI platforms understand as a real-world object, with attributes, relationships and sentiment attached.",
      body: "Entities form a network of interconnected nodes.\nGoogle's Knowledge Graph links entities together.\nYour job: make the links explicit.",
      panel: {
        title: "The entity types around your brand",
        items: [
          { title: "Person and Organisation", text: "A named CEO; a listed company." },
          { title: "Place and Concept", text: "A head-office city; low-carbon construction." },
          { title: "Product and Event", text: "A flagship platform; an industry expo." },
          { title: "Partner", text: "Alliances, awards and methods that link back to you." },
        ],
      },
    };
    const pr = buildSlideRequests(panelled, 0, "n") as any[];
    const panelShape = pr.find((r) => (r.createShape?.objectId || "").endsWith("_pnl"));
    assertQ(!!panelShape, "the panel is drawn");
    const pe = panelShape.createShape.elementProperties;
    const panelBottom = pe.transform.translateY + pe.size.height.magnitude;
    const panelTop = pe.transform.translateY;
    let escaped = 0;
    for (const r of pr) {
      const oid = r.createShape?.objectId || "";
      if (!/_(pnt|pnh\d+|pnb\d+|pnm\d+|pnd)$/.test(oid)) continue;
      const t = r.createShape.elementProperties;
      const bottom = t.transform.translateY + t.size.height.magnitude;
      if (bottom > panelBottom - 1 || t.transform.translateY < panelTop - 1) {
        escaped++;
        fail(`panel content ${oid.split("_").pop()} escapes the panel ` +
          `(ends ${bottom.toFixed(1)}, panel ends ${panelBottom.toFixed(1)})`);
      }
    }
    assertQ(escaped === 0, "nothing is drawn outside the one box on the slide with a hard drawn edge");
    // All four items are still there — the fix must tighten before it drops.
    for (const t of ["Person and Organisation", "Place and Concept", "Product and Event", "Partner"]) {
      assertQ(pr.some((r) => r.insertText?.text === t), `the panel keeps "${t}"`);
    }
    // A panel that genuinely cannot hold its items says so rather than
    // silently drawing three of four.
    const stuffed = buildSlideRequests({
      ...panelled,
      panel: {
        title: "A panel whose items cannot possibly fit",
        items: Array.from({ length: 4 }, (_, i) => ({
          title: `Item ${i} with a heading long enough to wrap onto two lines by itself`,
          text: "And a body paragraph that keeps going well past the point where four of these could share one panel, so that something has to give and the layout has to say which.".repeat(2),
        })),
      },
    } as SlideInput, 0, "n") as any[];
    const declared = stuffed.filter((r) => r.insertText && /Showing \d+ of \d+ items/.test(r.insertText.text));
    assertQ(declared.length === 1, `an overstuffed panel declares what it dropped (${declared.length})`);

    // THE PILL. A status token that wraps is not a pill.
    const scorecard: SlideInput = {
      layout: "table", title: "Every Channel, Scored for GEO and AEO",
      table: {
        columns: ["Channel", "GEO (cited by LLMs)", "AEO (answer surfaces)", "Why"],
        rows: [
          ["Website - entity pages, FAQs, guides", "HIGH", "HIGH", "The canonical source for both RAG retrieval and featured snippets."],
          ["Wikipedia / Wikidata", "HIGH", "MED", "Most-cited source by Gemini and Perplexity."],
          ["LinkedIn - long-form, newsletters", "HIGH", "LOW", "#2 after Reddit; 11% of AI answers cite a LinkedIn URL."],
          ["Tier-1 press & analyst reports", "HIGH", "MED", "Training-data heavyweights."],
          ["YouTube (with transcripts)", "MED", "HIGH", "Transcripts feed LLMs."],
          ["Podcasts (published transcripts)", "MED", "LOW", "Premium authority signal."],
          ["Reddit & forums", "HIGH", "MED", "The most-cited domain in Semrush's study."],
          ["Email newsletter (send-only)", "NONE", "NONE", "Invisible to LLMs unless also published on the web."],
          ["Newsletter archive (HTML / LinkedIn)", "MED", "MED", "Clean structure plus a public archive."],
          ["X / Instagram / TikTok", "LOW", "LOW", "Visual-first or closed to general crawlers."],
        ],
      },
    };
    const sc = buildSlideRequests(scorecard, 0, "n") as any[];
    const pills = sc.filter((r) => (r.createShape?.objectId || "").match(/_tp\d+_\d+$/));
    assertQ(pills.length > 0, `the scorecard draws status pills (${pills.length})`);
    // Every pill must be wide enough for its token ON ONE LINE, inset included.
    for (const p of pills) {
      const oid = p.createShape.objectId;
      const w = p.createShape.elementProperties.size.width.magnitude;
      const txt = sc.find((r) => r.insertText?.objectId === oid.replace("_tp", "_tc"));
      if (!txt) continue;
      const token = txt.insertText.text as string;
      const styleReq = sc.find((r) => r.updateTextStyle?.objectId === txt.insertText.objectId && r.updateTextStyle.style?.fontSize);
      const size = styleReq?.updateTextStyle?.style?.fontSize?.magnitude ?? 9;
      const needed = token.length * 0.55 * CAPS_WIDEN * size + TEXT_INSET_X;
      assertQ(w >= needed,
        `pill "${token}" is wide enough to hold it on one line at ${size}pt ` +
        `(${w.toFixed(1)}pt, needs ${needed.toFixed(1)}pt) — this is the "ME / D" wrap`);
    }
    // THE FALLBACK, at its seam rather than through the table.
    //
    // Driving this through a table proves nothing: fitColumnWidths never leaves
    // a status column narrow enough to refuse a capsule, so a "narrow table"
    // fixture drew eight perfectly good pills and the assertion below it ran
    // against the branch it was meant to exclude. That is the check that
    // silently tests NOTHING, and it is why pillWidth is exported.
    for (const [token, size] of [["MED", 6], ["NONE", 6], ["MEDIUM", 9], ["HIGH", 8]] as [string, number][]) {
      const w = pillWidth(token, size);
      const inkWidth = token.length * size * 0.55 * CAPS_WIDEN;
      assertQ(w - TEXT_INSET_X >= inkWidth,
        `"${token}" at ${size}pt has room for its own glyphs inside the box inset ` +
        `(${(w - TEXT_INSET_X).toFixed(1)}pt usable, ${inkWidth.toFixed(1)}pt of ink)`);
    }
    // The inset is the part the old formula missed, so pin it explicitly: a
    // width that ignores it is smaller than one that does not.
    assertQ(pillWidth("NONE", 6) > "NONE".length * 6 * 0.55 + 16,
      "and the capsule is wider than the flat +16 that shipped the wrap");
    // Wider token, wider capsule; larger type, wider capsule. Both monotonic,
    // or the formula is not measuring anything.
    assertQ(pillWidth("MEDIUM", 8) > pillWidth("MED", 8), "a longer token needs a wider capsule");
    assertQ(pillWidth("MED", 12) > pillWidth("MED", 6), "and larger type needs a wider capsule");

    // EVERY LAYOUT THAT CAN CARRY A NOTE, not just the one that was checked.
    //
    // The existing takeaway-bar assertion drove a `content` slide, and content
    // was the layout that had been fixed. Meanwhile swot, matrix, comparison,
    // scatter and venn all measured down to the PAGE EDGE and knew nothing
    // about the bar: on the published deck the comparison slide's seventh row
    // — "Measure / CTR, ranking positions / Citation share-of-voice" — was
    // drawn underneath it. Present in the file, invisible on the slide, and
    // nothing anywhere said so.
    const NOTE = "E-E-A-T - Experience, Expertise, Authoritativeness, Trust - is now scored at the entity level, not just the page level.";
    const withNote: [string, SlideInput][] = [
      ["comparison", { layout: "comparison", title: "Keywords vs Entities", note: NOTE,
        comparison: { columns: ["Keyword SEO", "Entity / GEO"], rows: [
          { label: "Focus", cells: ["Strings of text", "Real-world things"] },
          { label: "Signal", cells: ["Keyword frequency", "Semantic relevance"] },
          { label: "Ranking unit", cells: ["A page", "A brand reputation"] },
          { label: "Target", cells: ["SERP position 1-10", "AI citations"] },
          { label: "Content goal", cells: ["Match the query", "Answer intent"] },
          { label: "Link strategy", cells: ["Backlinks to URLs", "Brand mentions"] },
          { label: "Measure", cells: ["CTR, ranking positions", "Citation share-of-voice"] },
        ] } }],
      ["swot", { layout: "swot", title: "T", note: NOTE,
        swot: { strengths: ["a", "b"], weaknesses: ["c"], opportunities: ["d"], threats: ["e"] } }],
      ["matrix", { layout: "matrix", title: "T", note: NOTE,
        matrix: { xAxis: ["low", "high"], yAxis: ["low", "high"], items: [{ label: "One", x: 1, y: 2 }, { label: "Two", x: 3, y: 1 }] } }],
      ["scatter", { layout: "scatter", title: "T", note: NOTE,
        scatter: { xAxis: "x", yAxis: "y", points: [{ label: "a", x: 1, y: 2 }, { label: "b", x: 3, y: 4 }] } }],
      ["venn", { layout: "venn", title: "T", note: NOTE,
        venn: { sets: [{ label: "One" }, { label: "Two" }, { label: "Three" }], overlap: "Both" } }],
      ["table", { layout: "table", title: "T", note: NOTE,
        table: { columns: ["A", "B"], rows: Array.from({ length: 9 }, (_, i) => [`row ${i}`, "value"]) } }],
    ];
    for (const [name, s] of withNote) {
      const reqs = buildSlideRequests(s, 0, "n") as any[];
      const noteBar = reqs.find((r) => (r.createShape?.objectId || "").endsWith("_noteBar"));
      assertQ(!!noteBar, `${name} draws its takeaway bar`);
      if (!noteBar) continue;
      const bt = noteBar.createShape.elementProperties;
      const bar = { x: bt.transform.translateX, y: bt.transform.translateY, w: bt.size.width.magnitude, h: bt.size.height.magnitude };
      // A full-width bar is cleared VERTICALLY; the Venn's sidebar sits beside
      // the diagram, so "above it" is only one of three ways to be clear of it.
      // For the five full-width bars this reduces to the old assertion exactly.
      if (name !== "venn" && Math.abs(bar.w - GRID.contentWidth) > 0.6) fail(`${name}: the takeaway bar is ${bar.w.toFixed(1)}pt wide, not the full measure — the 2-D rule below must not hide a shrunken bar`);
      for (const r of reqs) {
        const oid = r.createShape?.objectId || "";
        if (!oid || /_(noteBar|noteHead|noteTxt|ftl|ftn|logo)$/.test(oid)) continue;
        const t = r.createShape.elementProperties;
        if (t.transform.scaleX !== 1 || t.transform.scaleY !== 1) continue;
        const x = t.transform.translateX, y = t.transform.translateY;
        const right = x + t.size.width.magnitude, bottom = y + t.size.height.magnitude;
        const clear = bottom <= bar.y + 1 || right <= bar.x + 1 || x >= bar.x + bar.w - 1;
        assertQ(clear,
          `${name}: ${oid.split("_").pop()} keeps clear of the takeaway ` +
          `(ends ${bottom.toFixed(1)}/${right.toFixed(1)}, takeaway at y ${bar.y.toFixed(1)} x ${bar.x.toFixed(1)}-${(bar.x + bar.w).toFixed(1)})`);
      }
    }
  }
  if (failures === before20iq) pass("caps are measured as caps: stat labels clear their sources, panels hold their items, and pills hold their tokens");

  /* 20i-ter. The title block does not eat the slide. */
  //
  // Measured against the source deck this engine was asked to reproduce: our
  // title block consumed 185pt to its 96, so content began 52% down the slide
  // where the source begins it at 30%. Every layout started too low, and the
  // slides that were marginal split into a second slide they did not need — a
  // three-item column plus a takeaway bar was one such.
  //
  // Pinned as a PROPORTION rather than a number, because the failure was never
  // "bodyY is 133", it was "content starts halfway down the page".
  const before20it = failures;
  console.log(`\n20i-ter. Density`);
  {
    const assertT = (ok: boolean, m: string) => { if (!ok) fail(m); };
    const startsAt = GRID.bodyY / CANVAS.height;
    assertT(startsAt < 0.30, `content starts in the top third of the slide (${Math.round(startsAt * 100)}%)`);
    assertT(startsAt > 0.18, `but not so high that the title block is cramped (${Math.round(startsAt * 100)}%)`);
    // The band still ends where it did — clear of the takeaway bar and the
    // footer. Moving the top up without growing the band would have thrown
    // away the room instead of using it.
    const bandBottom = GRID.bodyY + GRID.bandHeight;
    assertT(bandBottom > 370 && bandBottom < 380,
      `and the band still ends just above the footer (${bandBottom.toFixed(1)})`);
    assertT(GRID.columnY === GRID.bodyY, "the column band tracks the body band rather than drifting from it");
    // The title still has room for two lines between the eyebrow and the body.
    const room = GRID.bodyY - (GRID.eyebrowY + GRID.eyebrowHeight);
    assertT(room >= 44, `two lines of title still fit above the body (${room.toFixed(1)}pt)`);
  }
  if (failures === before20it) pass("content starts in the top third, and the band still ends above the footer");

  /* 20j. The layer diagram, and the toned card row. */
  //
  // Both come from converting a real client deck whose two hardest pages were
  // a layered architecture picture and a three-discipline card row with a
  // spanning sub-band. The geometric sweeps above already cover collisions;
  // this section pins the SEMANTICS - order, arrows, tones - and the preview's
  // fidelity to them.
  const before20j = failures;
  console.log(`\n20j. Layers and toned cards`);
  {
    const assertL = (ok: boolean, m: string) => { if (!ok) fail(m); };
    const layersFixture = ALL.find((sl) => sl.layout === "layers")!;
    const lr = buildSlideRequests(layersFixture, 0, "n") as any[];

    // Bands render TOP FIRST, in the order given: the whole claim of the
    // diagram is vertical order, so the builder scrambling it is the one
    // failure that changes the meaning while passing every collision check.
    const bandYs: number[] = [];
    for (let i = 0; i < 5; i++) {
      const r = lr.find((q) => q.createShape?.objectId?.endsWith(`_ly${i}`));
      assertL(!!r, `band ${i} is drawn`);
      if (r) bandYs.push(r.createShape.elementProperties.transform.translateY);
    }
    for (let i = 1; i < bandYs.length; i++) {
      assertL(bandYs[i] > bandYs[i - 1], `band ${i} sits below band ${i - 1}`);
    }

    // Arrows between bands - and NOT after a band that suppressed its arrow.
    const downs = lr.filter((q) => q.createShape?.shapeType === "DOWN_ARROW");
    const ups = lr.filter((q) => q.createShape?.shapeType === "UP_ARROW");
    assertL(downs.length === 3 && ups.length === 1, `three down connectors and one up for five bands (${downs.length} down, ${ups.length} up)`);
    assertL(!!ups[0] && String(ups[0].createShape.objectId).endsWith("_lya3"), "the up arrow is the one under the social band — brands feed the channels");
    // The dashed emphasis band really is dashed.
    const dashed = lr.find((q) => q.updateShapeProperties?.shapeProperties?.outline?.dashStyle === "DASH");
    assertL(!!dashed, "the synthesis band carries its dashed outline");
    // Cells: all eight, with their text.
    const texts = lr.filter((q) => q.insertText).map((q) => q.insertText.text);
    for (const t of ["Website", "Wikidata entity", "Podcasts", "Audio + transcript"]) {
      assertL(texts.indexOf(t) >= 0, `cell content "${t}" is drawn`);
    }

    // THE PREVIEW KEEPS ALL OF IT. An arrow drawn as a grey block, or a dashed
    // band drawn solid, is the preview lying about the deck again.
    const pv = toPreviewModel([layersFixture]).slides[0].elements as any[];
    assertL(pv.filter((e) => e.arrowDown).length === 3 && pv.filter((e) => (e as any).arrowUp).length === 1,
      "the preview keeps three down arrows and the up arrow as arrows");
    assertL(pv.some((e) => e.dashed), "and the dashed outline as dashed");
    // And the PDF prints them - the print is a pure function of the preview.
    const html = deckToHtml(toPreviewModel([layersFixture]), "t");
    assertL(html.indexOf("clip-path:polygon(30% 0%") >= 0, "the PDF draws the down arrow as an arrow");
    assertL(html.indexOf("dashed #3950FF") >= 0, "and the dashed band as dashed");

    // CONTAINMENT. The overrun sweep compares text with TEXT; nothing asserts
    // that a cell's caption stays inside the white cell that frames it — and
    // the first cut of this layout put every cell caption below its cell and
    // the sweep stayed green. A framed text that escapes its frame is wrong in
    // a way only geometry against the PANEL can catch.
    const insideSomeRect = (el: any, pred: (r: any) => boolean) =>
      pv.some((r: any) => r.kind === "rect" && pred(r) &&
        el.x >= r.x - 0.5 && el.y >= r.y - 0.5 &&
        el.x + el.w <= r.x + r.w + 0.5 && el.y + el.h <= r.y + r.h + 0.5);
    for (const t of ["Owned content", "Audio + transcript", "Website", "Podcasts"]) {
      const el = pv.find((e: any) => e.text === t);
      assertL(!!el && insideSomeRect(el, (r) => String(r.fill).toLowerCase() === `#${COLOR.tintBlue.toLowerCase()}`),
        `cell text "${t}" sits inside its white cell`);
    }
    const cap = pv.find((e: any) => /reads, compares and synthesises/.test(String(e.text || "")));
    assertL(!!cap && insideSomeRect(cap, (r) => r.h < 200),
      "the synthesis caption stays inside its band");

    // Arrow SUPPRESSION, on a fixture where it is not the last band — on the
    // main fixture the arrow:false band is last, which slice(0,-1) skips
    // anyway, so that flag was otherwise untested.
    const three = buildSlideRequests({ layout: "layers", title: "T", layers: [
      { title: "A" }, { title: "B", arrow: false }, { title: "C" } ] } as SlideInput, 0, "n") as any[];
    assertL(three.filter((q) => q.createShape?.shapeType === "DOWN_ARROW").length === 1,
      "arrow: false suppresses the connector below its own band");

    // TONED CARDS. Each toned card gets a panel and its 3pt accent bar; the
    // strip sits BELOW the card row and holds all six cells.
    const cardsFixture = ALL.find((sl) => sl.layout === "cards" && (sl as any).strip)!;
    const cr = buildSlideRequests(cardsFixture, 0, "n") as any[];
    for (let i = 0; i < 3; i++) {
      assertL(cr.some((q) => q.createShape?.objectId?.endsWith(`_ca${i}`)), `card ${i} carries its accent bar`);
      assertL(cr.some((q) => q.createShape?.objectId?.endsWith(`_cp${i}`) && q.createShape.shapeType === "ROUND_RECTANGLE"), `and its tinted panel`);
    }
    const stripPanel = cr.find((q) => q.createShape?.objectId?.endsWith("_strip"));
    assertL(!!stripPanel, "the strip band is drawn");
    const cardPanel = cr.find((q) => q.createShape?.objectId?.endsWith("_cp0"));
    assertL(stripPanel.createShape.elementProperties.transform.translateY >
      cardPanel.createShape.elementProperties.transform.translateY +
      cardPanel.createShape.elementProperties.size.height.magnitude,
      "and it sits below the card row, not on it");
    const ctexts = cr.filter((q) => q.insertText).map((q) => q.insertText.text);
    for (const t of ["SEO", "UX", "Speed, clarity, intent"]) {
      assertL(ctexts.indexOf(t) >= 0, `strip cell "${t}" is drawn`);
    }
    // The subtitle pushed the row down - CARDS.y was a fixed constant once,
    // and a standfirst overlapping the card row is how that would resurface.
    assertL(ctexts.some((t: string) => /standfirst long enough/.test(t)), "the cards slide draws its standfirst");
  }
  if (failures === before20j) pass("the layer diagram keeps its order, arrows and dash - in the deck, the preview and the print - and toned cards carry their accents with the strip below");

  /* 20k. The diff round: what a real client conversion was still missing. */
  //
  // A 38-page programme was converted, rendered, and diffed page against page.
  // Everything in this section is a root cause from that diff: cells clipped
  // while slides sat half empty, status words where the source has coloured
  // pills, bold lead-ins flattened, five-card rows crushed to slivers, a
  // continuation slide padded with its parent's framing.
  const before20k = failures;
  console.log(`\n20k. Conversion-diff fixes`);
  {
    const assertD = (ok: boolean, m: string) => { if (!ok) fail(m); };

    // BOLD RUNS. "**Focus:** entity authority" — the marker is stripped, the
    // range lands on the words, and the preview carries it.
    const pbold = parseBold("**Focus:** entity authority and mentions");
    assertD(pbold.text === "Focus: entity authority and mentions", `markers stripped (${pbold.text})`);
    assertD(pbold.ranges.length === 1 && pbold.ranges[0].start === 0 && pbold.ranges[0].end === 6,
      `the range lands on the lead-in (${JSON.stringify(pbold.ranges)})`);
    assertD(parseBold("no markers").ranges.length === 0, "text without markers is untouched");
    assertD(parseBold("unmatched ** stays").text === "unmatched ** stays", "an unmatched marker stays literal");
    const boldSlide: SlideInput = { layout: "content", title: "T",
      body: "**It does not lift your ranking.** Volume is not authority.\n**It rarely earns citations.** Models discount templated prose." };
    const br = buildSlideRequests(boldSlide, 0, "n") as any[];
    assertD(!br.some((q) => q.insertText && String(q.insertText.text).indexOf("**") >= 0),
      "no literal asterisks reach the slide");
    assertD(br.some((q) => q.updateTextStyle?.style?.bold === true && q.updateTextStyle

?.textRange?.type === "FIXED_RANGE"),
      "the bold ranges are applied");
    const bpv = toPreviewModel([boldSlide]).slides[0].elements as any[];
    const bel = bpv.find((e) => /lift your ranking/.test(String(e.text || "")));
    assertD(!!bel?.accents?.some((a: any) => a.bold), "and the preview keeps them");

    // PILLS. A scorecard's HIGH/MED/LOW render as coloured pills, not words.
    const score: SlideInput = { layout: "table", title: "Scores",
      table: { columns: ["Channel", "GEO", "AEO"], rows: [["Website", "HIGH", "HIGH"], ["Email", "NONE", "NONE"], ["Press", "MED", "LOW"]] } };
    const sr = buildSlideRequests(score, 0, "n") as any[];
    const pills = sr.filter((q) => (q.createShape?.objectId || "").match(/_tp\d+_\d+$/));
    assertD(pills.length === 6, `every status value gets a pill (${pills.length} of 6)`);
    assertD(pills.every((q) => q.createShape.shapeType === "ROUND_RECTANGLE"), "drawn as pills, not boxes");
    // And the first column never turns into one — "HIGH" as a channel name is
    // far-fetched, but the rule is cheap to state and the mistake silent.
    assertD(!sr.some((q) => (q.createShape?.objectId || "").match(/_tp\d+_0$/)), "label columns are never pilled");
    // Except a TIER token, which is the row's identity and pilled in the source.
    const tiers = buildSlideRequests({ layout: "table", title: "Tiers",
      table: { columns: ["Tier", "What"], rows: [["P1 · CORE", "x"], ["P2 · SUPPORT", "y"], ["HIGH", "z"]] } } as SlideInput, 0, "n") as any[];
    const tierPills = tiers.filter((q) => (q.createShape?.objectId || "").match(/_tp\d+_0$/));
    assertD(tierPills.length === 2, `P1/P2 in the first column are pills (${tierPills.length} of 2)`);
    assertD(!tiers.some((q) => (q.createShape?.objectId || "").endsWith("_tp2_0")), "while HIGH in a label column still is not");

    // WRAPPED CELLS. The ten-row scorecard fits every word.
    const scorecard = ALL.find((sl) => sl.layout === "table" && (sl.table?.rows || []).length >= 9);
    if (scorecard) {
      const scr = buildSlideRequests(scorecard, 0, "n") as any[];
      const cells = scr.filter((q) => (q.insertText?.objectId || "").match(/_tc\d+_\d+$/)).map((q) => q.insertText.text as string);
      assertD(cells.every((t) => t.slice(-1) !== "\u2026"),
        "a dense scorecard wraps and steps its type down rather than clipping its argument");
    }

    // THE SPLITTER'S CONTINUATION carries no cloned framing.
    const longBody = Array.from({ length: 30 }, (_, i) => `Paragraph ${i + 1} of a body that cannot fit on one slide, written long enough to wrap.`).join("\n");
    const splitOut = splitOverflowingSlides([{ layout: "content", title: "Long",
      subtitle: "The standfirst that belongs to the FIRST half only.",
      note: "Why this matters: the takeaway that must not be cloned.",
      body: longBody } as SlideInput]);
    assertD(splitOut.length >= 2, `the long body splits (${splitOut.length})`);
    for (let i = 1; i < splitOut.length; i++) {
      assertD(!splitOut[i].subtitle, `continuation ${i} does not repeat the standfirst`);
      assertD(!splitOut[i].note, `continuation ${i} does not repeat the takeaway`);
    }
    // Structured layouts never split — a split copies everything but the body,
    // so a table slide would print its table twice.
    const tableLong = splitOverflowingSlides([{ layout: "table", title: "T", body: longBody,
      table: { columns: ["A"], rows: [["x"]] } } as SlideInput]);
    assertD(tableLong.length === 1, "a table slide is never split into two tables");
    // MUTATION SURVIVOR, recorded rather than forced: removing `!slide.table`
    // from the splittable guard does not fail this assertion, because the
    // table layout draws bodyRight as its rail and never draws `body` at all —
    // the splitter's probe finds no body box and declines on its own. The
    // guard is defence in depth for the day a table gains a body path; the
    // probe is what actually protects today.

    // FIVE OR SIX CARDS WRAP. One row of six was 103pt a card.
    assertD(cardGeometry(6).rows === 2 && cardGeometry(6).cols === 3, "six cards set as a 2x3 grid");
    assertD(cardGeometry(5).rows === 2, "five as 2+3");
    assertD(cardGeometry(4).rows === 1, "four stay on one row");
    assertD(cardGeometry(6).cellW > cardGeometry(6).cols * 30, "and each card is wide enough to read");

    // THE NOTE BAR holds a real takeaway. Was capped at three lines; the
    // fourth sentence — usually the punchline — silently clipped.
    const longNote = "Why this matters: " + Array.from({ length: 5 }, (_, i) =>
      `sentence ${i + 1} of a takeaway written at the length real client decks actually use, with a named mechanism, a consequence, and the action it implies for the team next quarter.`).join(" ");
    // Long enough to need more than the old three-line cap, or this proves
    // nothing — the first version of this fixture was two lines and "passed"
    // against the old clamp too.
    assertD(estimateLines(longNote, GRID.contentWidth - 18, 8) >= 4,
      `precondition: the fixture needs at least four lines (${estimateLines(longNote, GRID.contentWidth - 18, 8)})`);
    const nr = buildSlideRequests({ layout: "content", title: "T", body: "x", note: longNote } as SlideInput, 0, "n") as any[];
    const bar = nr.find((q) => (q.createShape?.objectId || "").endsWith("_noteBar"));
    assertD(!!bar && bar.createShape.elementProperties.size.height.magnitude > 58,
      `the note bar grows past the old three-line cap (${bar?.createShape.elementProperties.size.height.magnitude})`);
  }
  if (failures === before20k) pass("bold survives to the preview, statuses are pills, dense tables wrap whole, continuations carry no cloned framing, six cards make a grid, and the takeaway keeps its punchline");

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
  const texts = (rs: any[]) => rs.filter((r: any) => r.insertText).map((r: any) => String(r.insertText.text).toLowerCase());
  const v2 = buildSlideRequests({ layout: "venn", title: "T", venn: { sets: [{ label: "A" }, { label: "B" }], overlap: "both" } }, 0, "n") as any[];
  if (v2.filter((r: any) => (r.createShape?.objectId || "").match(/_vc\d/)).length !== 2) fail("2-set Venn did not draw two circles");
  // Case-insensitive: set names are caps now, as the reference letters them.
  if (texts(v2).indexOf("both") === -1) fail("2-set Venn overlap label not drawn");
  const v3 = buildSlideRequests({ layout: "venn", title: "T", venn: { sets: [{ label: "A" }, { label: "B" }, { label: "C" }] } }, 0, "n");
  if (v3.filter((r: any) => (r.createShape?.objectId || "").match(/_vc\d/)).length !== 3) fail("3-set Venn did not draw three circles");
  // "Name (Descriptor)" AND "Name - descriptor" split into a name and a lighter
  // gloss: the delivered deck wrote every label with a dash and got nine-word names.
  const v3d = buildSlideRequests({ layout: "venn", title: "T", venn: { sets: [{ label: "Team knowledge (Digital Authority Briefing)" }, { label: "Direct - LinkedIn, newsletters" }, { label: "C" }] } }, 0, "n") as any[];
  const t3 = texts(v3d);
  if (t3.indexOf("team knowledge") === -1 || t3.indexOf("digital authority briefing") === -1) fail("a Venn set label with a parenthetical was not split into name + descriptor");
  if (t3.indexOf("direct") === -1 || t3.indexOf("linkedin, newsletters") === -1) fail("a Venn set label with a dash was not split into name + descriptor");

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

    // The heading sits at the TOP of its block, under the chip. Bottom-aligning
    // it put the row's slack ABOVE the heading — a 54px hole between the
    // number and the name on every card, which the reviewers read as
    // "four half-filled forms". The shared block height stays (bodies share a
    // baseline, asserted above); the slack now falls between a short heading
    // and its body, where the reference deck leaves it.
    const bottomAligned = reqs
      .filter((r) => r.updateShapeProperties?.shapeProperties?.contentAlignment === "BOTTOM")
      .map((r) => r.updateShapeProperties.objectId);
    const titleIds = Array.from(shapes.keys()).filter((k) => /ct\d+$/.test(k));
    for (const tid of titleIds) {
      if (bottomAligned.indexOf(tid) !== -1) fail(`card title ${tid} is bottom-aligned — the slack lands between chip and heading and reads as a hole`);
    }
    // And the PREVIEW agrees: no bottom-aligned text on this slide in either.
    const pm = toPreviewModel([cardsSlide]);
    const previewTitles = (pm.slides?.[0]?.elements ?? []).filter((e: any) => e.kind === "text" && e.vBottom);
    if (previewTitles.length !== 0) {
      fail(`preview shows ${previewTitles.length} bottom-aligned text boxes, the deck has 0 — the preview would disagree with the deck`);
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

  /* 25. A PILL COLUMN IS ONE DEVICE, AND THE PRINT INSETS LIKE THE DECK
   *
   * Two defects found on the same slide, from the same photograph.
   *
   * FIRST, the tier column drew ONE pill. "P1 · CORE" fitted its 84pt column
   * at 9pt; "P2 · SUPPORT" and "P3 · LONG TAIL" needed 96 and 108, missed the
   * width test one cell at a time, and fell through to the plain-text branch.
   * A three-row ladder rendered as one capsule and two bare labels. Every
   * per-cell assertion passed the whole time, because per-cell is the bug: the
   * column is the unit, and it now steps down to one size that fits its
   * LONGEST token or draws no pills at all.
   *
   * SECOND, the print. Slides insets text 7.2pt horizontally and 3.6pt
   * vertically inside EVERY box, the engine sizes every box as inset + text,
   * and the chat preview has applied that padding since it was written.
   * pdf-html never did — so the PDF drew every line high and left of the deck,
   * and on a 16pt capsule that put the label at the top with an empty band
   * under it. That is what was actually reported.
   *
   * MUTATION LOG
   *   - pill sized per cell instead of per column   → KILLED (one size assertion)
   *   - vCenter dropped from the pill label         → KILLED
   *   - the capsule and its label given different rects → KILLED
   *   - the inset dropped from pdf-html             → KILLED
   *   - overflow:hidden restored in pdf-html        → KILLED
   *   - the fixture widened so no step-down happens → KILLED (precondition)
   *
   * SURVIVOR, kept because it says something about the fixture: shortening
   * ONE row's prose does not widen the tier column, because fitColumnWidths
   * sizes a column from its WIDEST cell, and the other two rows still carry
   * paragraphs. The precondition only fires when EVERY prose cell is short —
   * verified by doing exactly that, which turns it red. So the squeeze is a
   * property of the table as a whole, and a future edit that trims a single
   * row will not quietly disarm this section.
   */
  const before25 = failures;
  console.log(`\n25. A pill column is one device, and the print insets like the deck`);
  {
    // Prose columns wide enough to squeeze the tier column below what the
    // longest tier token wants at body size. That squeeze IS the fixture.
    const tiers: SlideInput = {
      layout: "table", title: "Not all entities are equal",
      table: {
        columns: ["Tier", "What belongs here", "What we do with it", "Volume"],
        rows: [
          ["P1 · CORE", "Master entity plus satellites directly linked to revenue and strategic goals: flagship products, key spokespeople, demand-driven concepts", "Full treatment: dedicated pages, schema, relationships mapped, editorial calendar, KPI tracking", "10-15 entities"],
          ["P2 · SUPPORT", "Supporting experts, secondary products, partners, awards, recurring events, validation concepts", "Pages plus schema, relationships to P1 only, quarterly review", "20-40 entities"],
          ["P3 · LONG TAIL", "Everything else worth knowing about - locations, minor brands, historical items", "Documented in the map, structured data where cheap, no active campaign", "Everything else"],
        ],
      },
    };
    const treqs = buildSlideRequests(tiers, 0, "p25a") as any[];
    const tshapes = new Map<string, any>();
    for (const r of treqs) if (r.createShape) tshapes.set(r.createShape.objectId, r.createShape.elementProperties);
    const tgeom = (o: any) => o && {
      x: o.transform.translateX, y: o.transform.translateY,
      w: o.size.width.magnitude, h: o.size.height.magnitude,
    };
    const sizeOf = new Map<string, number>();
    for (const r of treqs) {
      if (r.updateTextStyle?.style?.fontSize?.magnitude !== undefined) {
        sizeOf.set(r.updateTextStyle.objectId, r.updateTextStyle.style.fontSize.magnitude);
      }
    }

    const tierPills = Array.from(tshapes.keys()).filter((k) => /tp\d+_0$/.test(k));
    if (tierPills.length !== 3) {
      fail(`the tier column drew ${tierPills.length} of 3 pills — a column that pills some rows and not others is the defect this section exists for`);
    }

    // PRECONDITION: the column must genuinely be too narrow for the longest
    // token at body size, or nothing here is being tested. Body size is read
    // from a prose cell; the pill size from a pill label.
    const bodySize = sizeOf.get("p25a_s0_tc0_1");
    const pillSizes: number[] = [];
    for (let i = 0; i < 3; i++) {
      const v = sizeOf.get(`p25a_s0_tc${i}_0`);
      if (v !== undefined) pillSizes.push(v);
    }
    const headW = tgeom(tshapes.get("p25a_s0_th0"))?.w;
    if (bodySize === undefined || headW === undefined) {
      fail(`fixture did not build a readable table (bodySize=${bodySize}, tier column width=${headW})`);
    } else if (pillWidth("P3 · LONG TAIL", bodySize) <= headW) {
      fail(`fixture is too roomy: "P3 · LONG TAIL" fits the tier column at body size ${bodySize}, so no step-down happens and this section proves nothing`);
    }

    // ONE size across the column.
    if (pillSizes.length !== 3) {
      fail(`expected 3 tier pill labels, found ${pillSizes.length}`);
    } else if (new Set(pillSizes).size !== 1) {
      fail(`tier pills drew at ${pillSizes.join(", ")}pt — a pill column is one device, not three type sizes`);
    }

    // Capsule and label are the SAME rectangle, centred both ways.
    const tvcentred: string[] = [];
    for (const r of treqs) {
      if (r.updateShapeProperties?.shapeProperties?.contentAlignment === "MIDDLE") tvcentred.push(r.updateShapeProperties.objectId);
    }
    const talign = new Map<string, string>();
    for (const r of treqs) {
      if (r.updateParagraphStyle?.style?.alignment) talign.set(r.updateParagraphStyle.objectId, r.updateParagraphStyle.style.alignment);
    }
    for (const pid of tierPills) {
      const lid = pid.replace(/tp(\d+)_0$/, "tc$1_0");
      const cap = tgeom(tshapes.get(pid));
      const lab = tgeom(tshapes.get(lid));
      if (!lab) { fail(`pill ${pid} has no label box`); continue; }
      if (lab.x !== cap.x || lab.y !== cap.y || lab.w !== cap.w || lab.h !== cap.h) {
        fail(`pill ${pid}: label (${lab.x},${lab.y} ${lab.w}x${lab.h}) does not cover the capsule (${cap.x},${cap.y} ${cap.w}x${cap.h}) — an offset is a guess at centring`);
      }
      if (tvcentred.indexOf(lid) === -1) {
        fail(`pill label ${lid} is not vertically centred (no contentAlignment MIDDLE) — this is the reported defect: the word sits at the top of its own capsule`);
      }
      if (talign.get(lid) !== "CENTER") {
        fail(`pill label ${lid} is not horizontally centred (alignment ${talign.get(lid) || "unset"})`);
      }
    }

    // THE PRINT. Every text box in the PDF carries Slides' own inset, scaled
    // 720pt → 960px, or the print is not a print of the preview.
    const html = deckToHtml(toPreviewModel([tiers]), "Tiers");
    const padX = SLIDES_TEXT_INSET.x * (4 / 3);
    const padY = SLIDES_TEXT_INSET.y * (4 / 3);
    if (html.indexOf(`padding:${padY}px ${padX}px`) === -1) {
      fail(`the PDF does not inset its text boxes by Slides' own ${SLIDES_TEXT_INSET.y}/${SLIDES_TEXT_INSET.x}pt — every line prints high and left of the deck`);
    }
    if (html.indexOf("box-sizing:border-box") === -1) {
      fail(`the PDF's text padding is not inside the measured box — without border-box the inset grows the box instead of insetting the text`);
    }
    if (/text-align:[a-z]+;overflow:hidden;/.test(html)) {
      fail(`the PDF hides overflowing text — Slides draws it and lets it run, and hiding it lets an overflowing slide print as a tidy one`);
    }
    // LINE HEIGHT. Slides' 115% is 115% of the face's ~1.26em, and the engine
    // sizes every box on exactly that (LINE_LEAD = 1.449). A preview drawing
    // CSS line-height 1.15 — of the font SIZE — ran a fifth tighter than the
    // deck, so a body that overflows in Slides fitted in the picture. The
    // print must draw the default box at the engine's own lead.
    const expectLead = (1.15 * NATURAL_LINE).toFixed(3);
    const leads = html.match(/line-height:([0-9.]+);/g) || [];
    const defaults = leads.filter((l) => Math.abs(parseFloat(l.replace(/[^0-9.]/g, "")) - parseFloat(expectLead)) < 0.002);
    if (!leads.length) fail("the PDF sets no line-height at all");
    else if (!defaults.length) fail(`the PDF draws its default line spacing at ${leads[0]} — the engine measures at ${expectLead}, so the print runs tighter than the deck`);
    // And the 105% table cells at 105% of the same face height.
    if (!leads.some((l) => Math.abs(parseFloat(l.replace(/[^0-9.]/g, "")) - 1.05 * NATURAL_LINE) < 0.002)) {
      fail("the PDF's table cells are not drawn at 105% of the face height");
    }
  }
  if (failures === before25) pass("a pill column steps down as one, its labels centre in their capsules, and the print carries Slides' own inset");

  /* 26. A SLIDE MAY NOT SILENTLY SWALLOW ITS OWN CONTENT
   *
   * A 39-slide deck was built, checked against every geometry assertion in
   * this file, reviewed page by page and published to the user's Drive. Slide
   * 24 was four empty blue boxes.
   *
   * Its spec said `stages: [{ title, body }]`. `processRequests` read
   * `name`/`caption`. Every sibling layout — cards, layers, panel — uses
   * title/body, so the shape was the natural guess and the wrong one. The
   * slide had a `stages` key, so `unrenderableSlides` passed it. Nothing drew
   * anything, nothing said anything, and the empty slide shipped.
   *
   * Two more of the same kind were in the same deck: `venn.overlap` supplied
   * with THREE sets (only the two-set branch letters it) and `eyebrow` on a
   * cover (which draws title and subtitle only).
   *
   * The assertion is not a table of which layout reads which field — that
   * table is exactly what drifts. It builds the slide and asks whether the
   * words in the spec are in the text the deck will contain.
   *
   * MUTATION LOG
   *   - the stages title/body alias removed        → KILLED
   *   - droppedContent returns [] always           → KILLED
   *   - deckWarnings stops relaying the drop       → KILLED
   *   - the audit reports a slide that is fine     → KILLED (false-positive gate)
   */
  const before26 = failures;
  console.log(`\n26. A slide may not silently swallow its own content`);
  {
    // THE EXACT SHAPE THAT SHIPPED EMPTY.
    const process: SlideInput = {
      layout: "process", title: "Entity mapping",
      stages: [
        { title: "We draft", body: "Ahead of session two we drafted a first entity mapping from public sources." },
        { title: "We refine together", body: "Together we correct errors, hallucinations and obsolete information." },
        { title: "You prioritise", body: "Your team assigns priority tiers to the retained entities." },
      ] as any,
    };
    const preqs = buildSlideRequests(process, 0, "p26a") as any[];
    // Compared case-insensitively: TYPE.stageName is a caps style, so the
    // deck draws "WE REFINE TOGETHER" and the spec says "We refine together".
    const ptext = preqs.filter((r) => r.insertText).map((r) => r.insertText.text).join(" | ").toLowerCase();
    if (ptext.indexOf("we refine together") === -1) {
      fail(`a process slide written {title, body} draws no stage names — this is the four-empty-boxes bug (${ptext.slice(0, 80)})`);
    }
    if (ptext.indexOf("your team assigns priority tiers") === -1) {
      fail(`a process slide written {title, body} draws no stage captions`);
    }
    const pdrop = droppedContent(process, 0);
    if (pdrop.length) fail(`a well-formed process slide reports ${pdrop.length} false drop(s): ${JSON.stringify(pdrop[0])}`);

    // NO FALSE POSITIVES on an ordinary slide, or the report is noise and gets
    // ignored, which is the same as not having it.
    const fine: SlideInput = {
      layout: "content", eyebrow: "MODULE 4", title: "Where AI answers are generated",
      subtitle: "The spread is the insight, and it is fixable.",
      body: "Wikipedia and Wikidata are the shared reference layer\nTier-one press carries the citation weight\nLinkedIn profiles beat company pages",
      note: "One fix lifts every engine at once, because entity clarity is model-agnostic.",
    };
    const fdrop = droppedContent(fine, 1);
    if (fdrop.length) fail(`an ordinary content slide reports ${fdrop.length} false drop(s): ${JSON.stringify(fdrop)}`);

    // AND IT MUST FIRE when content genuinely cannot be drawn. A cover draws
    // its title and subtitle and nothing else.
    const cover: SlideInput = {
      layout: "cover", title: "Building authority on AI",
      subtitle: "From SEO to GEO",
      eyebrow: "4-HOUR WORKSHOP · TWO SESSIONS · VIRTUAL · CUSTOMISED PER CLIENT",
    };
    // PRECONDITION: the eyebrow really is absent from what the cover draws.
    const creqs = buildSlideRequests(cover, 0, "p26c") as any[];
    const ctext = creqs.filter((r) => r.insertText).map((r) => r.insertText.text).join(" | ");
    if (ctext.toUpperCase().indexOf("CUSTOMISED PER CLIENT") !== -1) {
      fail(`the cover fixture no longer drops its eyebrow, so this assertion proves nothing — pick a field the cover really ignores`);
    } else {
      const cdrop = droppedContent(cover, 0);
      if (!cdrop.length) fail(`a cover carrying an eyebrow it cannot draw reports nothing — the audit is blind`);
      else if (cdrop.join(" ").indexOf("CUSTOMISED PER CLIENT") === -1) {
        fail(`the audit fired but did not name the lost text (${JSON.stringify(cdrop)}) — "a field was dropped" is not actionable`);
      }
      // Relayed to the model, with the instruction that matters.
      const warn = deckWarnings([cover]);
      if (warn.indexOf("never draws") === -1) fail(`deckWarnings does not relay the drop: ${JSON.stringify(warn.slice(0, 120))}`);
      if (warn.indexOf("do NOT describe that content as being in the deck") === -1) {
        fail(`the warning does not forbid the answer the user actually got — a deck described as containing words that are not on it`);
      }
    }
  }
  if (failures === before26) pass("text that a layout cannot draw is named, reported, and never passed off as being in the deck");

  /* 27. BOXES HUG THEIR WORDS, SIT INSIDE THE MARGIN, AND SAY WHERE THEY END
   *
   * The reference deck the client actually presented sizes every tinted box
   * to the text it holds and leaves the slack at the FOOT of the slide; the
   * takeaway bar sits a few points under the boxes it comments on. Ours
   * stretched every panel to the band, pinned the bar to the bottom, and on
   * 20 of 38 pages a paragraph sat in the top third of a slab of tint. The
   * user called it "boxes mis-sized with lots of wasted space" and corrected
   * it by hand on lots of pages.
   *
   * Four assertions, each of which a mutation run found missing:
   *   - a two-column panel's height tracks its content, and sits inside the
   *     margin rather than 12pt past it on both sides;
   *   - the takeaway bar starts NOTE.gap under the content, not at the foot;
   *   - the splitter judges a slide against the room it HAS, not the box it
   *     drew for a two-line probe — that bug turned a 39-slide deck into 53;
   *   - a table cell is the full row tall and centres its text.
   *
   * MUTATION LOG
   *   - two-column panel stretched to the band     → KILLED
   *   - panel drawn 12pt past the margin           → KILLED
   *   - takeaway pinned to the foot again          → KILLED
   *   - splitter probes the hug, not the ceiling   → KILLED (only with UNEQUAL columns;
   *     equal ones prop the probe up to the need — recorded as a survivor first)
   *   - cards fill the band again                  → KILLED
   *   - table cell not centred                     → KILLED
   */
  const before27 = failures;
  console.log(`\n27. Boxes hug their words, sit inside the margin, and say where they end`);
  {
    const geomOf = (reqs: any[], suffix: string) => {
      for (const r of reqs) {
        const o = r.createShape || r.createImage;
        if (o && String(o.objectId).endsWith(suffix)) {
          const t = o.elementProperties.transform;
          return { x: t.translateX, y: t.translateY, w: o.elementProperties.size.width.magnitude, h: o.elementProperties.size.height.magnitude };
        }
      }
      return null;
    };

    // TWO-COLUMN. Five short bullets a side — the Keyword Era page — with a
    // takeaway. Short on purpose: if the panel is not far under its ceiling
    // the assertion says nothing.
    const cols: SlideInput = {
      layout: "two-column", title: "The keyword era",
      columns: { left: "How it works", right: "Limitations now emerging" },
      body: "Match user queries with exact keywords\nOptimise meta tags and URLs\nBuild backlinks\nTrack rankings\nSuccess = blue links clicked",
      // The RIGHT column is deliberately shorter than the left. The two panels
      // share one height, so with equal columns the right one props the
      // splitter's probe box up to exactly what the left needs, and the
      // "probes the hug, not the ceiling" mutation survives. Unequal, the
      // hugged probe is shorter than the left column and the bug shows.
      bodyRight: "Treats every query as a string\nNo strategy for AI answers",
      tones: ["grey", "coral"],
      note: "Keywords aren't dead: they're the floor, not the ceiling.",
    };
    const creqs = buildSlideRequests(cols, 0, "p27a") as any[];
    const tl = geomOf(creqs, "_tl"), tr = geomOf(creqs, "_tr"), bar = geomOf(creqs, "_noteBar");
    if (!tl || !tr || !bar) fail(`two-column fixture drew no panels or no takeaway (tl=${!!tl} tr=${!!tr} bar=${!!bar})`);
    else {
      const ceiling = NOTE.bottom - bar.h - NOTE.gap - tl.y;
      // PRECONDITION: the content is genuinely short of the ceiling.
      if (tl.h > ceiling * 0.75) fail(`fixture is too tall (panel ${tl.h.toFixed(0)} of ${ceiling.toFixed(0)} available) — a panel near its ceiling cannot show that panels hug`);
      if (tl.h > ceiling * 0.75) { /* nothing more to prove */ }
      else {
        if (tl.h >= ceiling - 1) fail(`the two-column panel is stretched to the band (${tl.h.toFixed(0)} of ${ceiling.toFixed(0)}) — five bullets in a slab of tint`);
        if (Math.abs(tl.h - tr.h) > 0.5) fail(`the two panels differ in height (${tl.h.toFixed(1)} vs ${tr.h.toFixed(1)}) — a pair reads as a pair only at one height`);
        // Inside the margin.
        if (Math.abs(tl.x - GRID.columnLeftX) > 0.5) fail(`the left panel starts at ${tl.x.toFixed(1)}, not on the column edge ${GRID.columnLeftX.toFixed(1)} — it overhangs the title and the takeaway`);
        const rightEdge = tr.x + tr.w, contentRight = GRID.margin + GRID.contentWidth;
        if (rightEdge > contentRight + 0.5) fail(`the right panel ends at ${rightEdge.toFixed(1)}, past the content edge ${contentRight.toFixed(1)}`);
        // The takeaway follows the content.
        const expectBarTop = tl.y + tl.h + NOTE.gap;
        if (Math.abs(bar.y - expectBarTop) > 0.5) fail(`the takeaway bar starts at ${bar.y.toFixed(1)}, not ${NOTE.gap}pt under the panels (${expectBarTop.toFixed(1)}) — pinned to the foot, the room's eye crosses a void to find it`);
      }
      // THE SPLITTER sees the ceiling: this slide fits, so it must not split.
      const kept = splitOverflowingSlides([JSON.parse(JSON.stringify(cols))]);
      if (kept.length !== 1) fail(`a two-column slide that fits was split into ${kept.length} — the splitter is measuring against the hugged box, not the room`);
      // And it still splits a slide that genuinely does not fit (or the
      // assertion above passes for the wrong reason).
      const long = { ...cols, body: Array.from({ length: 22 }, (_, i) => `A deliberately long bullet that wraps at least once at column width, number ${i + 1}`).join("\n") };
      if (splitOverflowingSlides([JSON.parse(JSON.stringify(long))]).length < 2) fail("the splitter no longer splits a column that genuinely overflows");
    }

    // CARDS. Three one-line bodies and a takeaway: the cards must not fill
    // the band, and the bar must sit under them.
    const cards: SlideInput = {
      layout: "cards", title: "Three pillars",
      cards: [
        { title: "Authority", body: "Credibility signals AI looks for.", tone: "blue" },
        { title: "Consistency", body: "The same facts everywhere AI reads.", tone: "teal" },
        { title: "Relevance", body: "Structure AI can parse and cite.", tone: "amber" },
      ],
      note: "Triangulation: models check third parties for agreement.",
    };
    const kreqs = buildSlideRequests(cards, 0, "p27b") as any[];
    const cp0 = geomOf(kreqs, "_cp0"), kbar = geomOf(kreqs, "_noteBar");
    if (!cp0 || !kbar) fail("cards fixture drew no card or no takeaway");
    else {
      const room = NOTE.bottom - kbar.h - NOTE.gap - cp0.y;
      if (cp0.h > room * 0.6) fail(`a one-line card is ${cp0.h.toFixed(0)}pt tall in ${room.toFixed(0)} of room — cards are filling the band again`);
      if (Math.abs(kbar.y - (cp0.y + cp0.h + NOTE.gap)) > 0.5) fail(`the takeaway under the cards starts at ${kbar.y.toFixed(1)}, not ${NOTE.gap}pt under them`);
    }

    // TABLE CELLS: full row height, centred, overhanging the row by half the
    // inset each side so the text — not the box — is what meets its neighbour.
    const tbl: SlideInput = { layout: "table", title: "Tiers",
      table: { columns: ["Tier", "What belongs here", "Volume"], rows: [
        ["P1", "Master entity plus satellites directly linked to revenue and strategic goals", "10-15"],
        ["P2", "Supporting experts, secondary products, partners", "20-40"],
      ] } };
    const treqs = buildSlideRequests(tbl, 0, "p27c") as any[];
    const centred = new Set<string>();
    for (const r of treqs) if (r.updateShapeProperties?.shapeProperties?.contentAlignment === "MIDDLE") centred.add(r.updateShapeProperties.objectId);
    const cellIds = treqs.filter((r) => r.createShape && /_tc\d+_[12]$/.test(r.createShape.objectId)).map((r) => r.createShape.objectId);
    if (cellIds.length < 4) fail(`expected at least 4 prose cells, found ${cellIds.length}`);
    for (const cid of cellIds) {
      if (!centred.has(cid)) fail(`table cell ${cid} is not vertically centred — a one-line cell sits level with the third line of its two-line neighbour`);
    }
    const zebra = geomOf(treqs, "_tz1"), cell1 = geomOf(treqs, "_tc1_1");
    if (!zebra || !cell1) fail(`no zebra row or cell to measure (zebra=${!!zebra} cell=${!!cell1})`);
    else if (Math.abs((zebra.y - cell1.y) - TEXT_INSET_Y / 2) > 0.5 || Math.abs((cell1.h - zebra.h) - TEXT_INSET_Y) > 0.5) {
      fail(`the cell box does not overhang its row by half the inset each side (row y ${zebra.y.toFixed(1)} h ${zebra.h.toFixed(1)}, cell y ${cell1.y.toFixed(1)} h ${cell1.h.toFixed(1)}) — the row pitch is paying for padding again`);
    }
  }
  if (failures === before27) pass("panels and cards hug their words inside the margin, the takeaway follows them, the splitter measures the room, and cells centre in their rows");

  /* 28. THE SECTION DIVIDER IS ONE LOCKUP
   *
   * The reference's divider is a 111pt block - kicker, two-line title,
   * subtitle - with 16pt and 13pt of air in it, centred on the page as a
   * group. Ours drew the kicker in the page-header slot at y=36, the title in
   * a fixed 100pt box at y=152 and the subtitle at a fixed y=257: three
   * orphaned lines with 125pt and 76pt of empty blue between them, and the
   * kicker reading as a running header. The reviewers: "the three lines never
   * read as belonging to each other".
   *
   * MUTATION LOG
   *   - kicker back in the header slot            → KILLED
   *   - fixed title y / fixed 100pt box            → KILLED (stack + centring)
   *   - sectionTitle back to 26                    → KILLED
   *   - kicker drawn in TYPE.eyebrowDark (11pt)    → KILLED
   *   - subtitle back to TYPE.bodyDark             → KILLED
   *   - subtitle id back to "body"                 → KILLED (preview path)
   *   - fitHeading ignores the caller's lead       → KILLED
   *   - long title no longer fitted down           → KILLED (stress)
   */
  const before28 = failures;
  console.log(`\n28. The section divider is one lockup`);
  {
    const geomOf = (reqs: any[], suffix: string) => {
      for (const r of reqs) {
        const o = r.createShape || r.createImage;
        if (o && String(o.objectId).endsWith(suffix)) {
          const t = o.elementProperties.transform;
          return { x: t.translateX, y: t.translateY, w: o.elementProperties.size.width.magnitude, h: o.elementProperties.size.height.magnitude };
        }
      }
      return null;
    };
    const styleOf = (reqs: any[], suffix: string) => {
      for (const r of reqs) if (r.updateTextStyle && String(r.updateTextStyle.objectId).endsWith(suffix) && r.updateTextStyle.textRange?.type === "ALL") return r.updateTextStyle.style;
      return null;
    };
    const paraOf = (reqs: any[], suffix: string) => {
      for (const r of reqs) if (r.updateParagraphStyle && String(r.updateParagraphStyle.objectId).endsWith(suffix)) return r.updateParagraphStyle.style;
      return null;
    };

    // FIXTURE A: the reference's page 4.
    const A: SlideInput = { layout: "section", eyebrow: "SESSION 1 · 2 HOURS · VIRTUAL", title: "Understand & {Diagnose}",
      subtitle: "Build shared vocabulary. See what AI sees. Understand how a brand earns its place in an AI answer." };
    const ar = buildSlideRequests(A, 3, "p28a") as any[];
    const kick = geomOf(ar, "_eyebrow"), ttl = geomOf(ar, "_title"), sub = geomOf(ar, "_sub");
    if (!kick || !ttl || !sub) fail(`the divider drew no kicker, title or subtitle (kicker=${!!kick} title=${!!ttl} sub=${!!sub}) — the subtitle must be id "sub", not "body"`);
    else {
      if (kick.y < 100) fail(`the kicker sits at y=${kick.y.toFixed(1)} — in the page-header slot, not in the lockup`);
      if (Math.abs(ttl.y - (kick.y + kick.h)) > SECTION.kickerGap + 0.5) fail(`the title (${ttl.y.toFixed(1)}) does not follow the kicker (${(kick.y + kick.h).toFixed(1)}) — not one stack`);
      if (Math.abs(sub.y - (ttl.y + ttl.h)) > SECTION.subtitleGap + 0.5) fail(`the subtitle (${sub.y.toFixed(1)}) does not follow the title (${(ttl.y + ttl.h).toFixed(1)})`);
      const centre = (kick.y + sub.y + sub.h) / 2;
      if (Math.abs(centre - CANVAS.height / 2) > 0.5) fail(`the lockup centres at ${centre.toFixed(1)}, not on the canvas (${CANVAS.height / 2})`);
      // PRECONDITION for the measured-box assertion: the title really is one line.
      const ttlLines = estimateLines("Understand & Diagnose", GRID.contentWidth, TYPE.sectionTitle.size);
      if (ttlLines !== 1) fail(`fixture A's title measures ${ttlLines} lines — the one-line assertion below is vacuous`);
      else if (ttl.h > drawnTextHeight(1, TYPE.sectionTitle.size, 0, 1, SECTION.titleLead) + 0.5) fail(`a one-line title gets a ${ttl.h.toFixed(1)}pt box — the old fixed 100pt, not a measured one`);
      const ts = styleOf(ar, "_title"), tp = paraOf(ar, "_title");
      if (!ts || ts.fontSize?.magnitude !== TYPE.sectionTitle.size) fail(`the divider title is not drawn at TYPE.sectionTitle (${ts?.fontSize?.magnitude})`);
      if (TYPE.sectionTitle.size < 30) fail(`TYPE.sectionTitle is ${TYPE.sectionTitle.size} — the reference's block is ~31pt and ours read a third the height`);
      if (!tp || Math.abs(tp.lineSpacing - SECTION.titleLead * 100) > 0.01) fail(`the title is drawn at ${tp?.lineSpacing}% — not the ${SECTION.titleLead * 100}% it was fitted at`);
      if (!tp || (tp.spaceBelow?.magnitude ?? 6) !== 0) fail(`a stacked divider title opens a paragraph gap (spaceBelow ${tp?.spaceBelow?.magnitude})`);
      const ks = styleOf(ar, "_eyebrow");
      if (!ks || ks.fontSize?.magnitude !== TYPE.sectionKicker.size) fail(`the kicker is not drawn at TYPE.sectionKicker (${ks?.fontSize?.magnitude})`);
      if (!(TYPE.sectionKicker.size < TYPE.eyebrowDark.size && TYPE.sectionKicker.size >= 7.5)) fail(`the kicker (${TYPE.sectionKicker.size}) must be lighter than a page eyebrow (${TYPE.eyebrowDark.size}) and never under 7.5`);
      const ss = styleOf(ar, "_sub");
      if (!ss || ss.fontSize?.magnitude !== TYPE.standfirstDark.size) fail(`the subtitle is not the standfirst voice (${ss?.fontSize?.magnitude} vs ${TYPE.standfirstDark.size})`);
      if (ar.some((r) => r.createShape && /_body$/.test(String(r.createShape.objectId)))) fail(`the divider still draws a "_body" box — the preview would edit slide.body, which a divider never draws`);
      const pel = toPreviewModel([A]).slides[0].elements as any[];
      if (!pel.some((e) => JSON.stringify(e.path) === JSON.stringify(["subtitle"]))) fail("the preview has no element on path [subtitle] for the divider");
      if (pel.some((e) => JSON.stringify(e.path) === JSON.stringify(["body"]))) fail("the preview maps the divider's subtitle to path [body]");
    }

    // FIXTURE D: over a photograph the subtitle is the colour the gradient was solved for.
    const Dp: SlideInput = { ...A, eyebrow: "PART ONE", resolvedImage: PHOTO_DARK } as any;
    const dr = buildSlideRequests(Dp, 3, "p28d") as any[];
    const ds = styleOf(dr, "_sub");
    const white = ds?.foregroundColor?.opaqueColor?.rgbColor;
    if (!white || Math.abs(white.red - 1) > 0.01 || Math.abs(white.green - 1) > 0.01 || Math.abs(white.blue - 1) > 0.01) fail(`over a photograph the subtitle is not white (${JSON.stringify(white)}) — the gradient is solved for white, the grey lands under 4.5:1`);

    // FIXTURE B: the numeral keeps its slot and the lockup starts under it.
    const Bn: SlideInput = { layout: "section", eyebrow: "01", title: "A deliberately long divider title that wraps to two", subtitle: "Build your map, refine and prioritise it." };
    const br = buildSlideRequests(Bn, 3, "p28b") as any[];
    const num = geomOf(br, "_num"), bt = geomOf(br, "_title"), bs = geomOf(br, "_sub");
    if (!num || !bt || !bs) fail("fixture B drew no numeral, title or subtitle");
    else {
      if (Math.abs(num.y - GRID.eyebrowY) > 0.5 || Math.abs(num.h - SECTION.numeralHeight) > 0.5) fail(`the numeral left its slot (y ${num.y.toFixed(1)} h ${num.h.toFixed(1)})`);
      if (bt.y < num.y + num.h - 0.5) fail(`the lockup (title y ${bt.y.toFixed(1)}) starts inside the numeral box (ends ${(num.y + num.h).toFixed(1)})`);
      const lines = estimateLines(Bn.title, GRID.contentWidth, TYPE.sectionTitle.size);
      if (lines !== 2) fail(`fixture B's title measures ${lines} lines, not the two the case is about`);
    }

    // FIXTURE C (stress): a long title is fitted DOWN, and the stack clears the bar and the footer.
    const Cs: SlideInput = { layout: "section", eyebrow: "PART TWO",
      title: "A very long section divider title that goes on and on across the whole width of the slide, and then keeps going for another clause, and one more clause after that for good measure so it cannot fit",
      subtitle: "A two-line subtitle that explains what this part of the programme covers, who it is for, and why the sequence of the modules within it matters to the outcome.",
      note: "A two-line takeaway bar under the divider, which is rare but allowed, and which the lockup must never be drawn through however long the title above it turns out to be." };
    const cr = buildSlideRequests(Cs, 3, "p28c") as any[];
    const ct = geomOf(cr, "_title"), cs = geomOf(cr, "_sub"), ck = geomOf(cr, "_eyebrow"), bar = geomOf(cr, "_noteBar");
    const cstyle = styleOf(cr, "_title");
    const need32 = estimateLines(Cs.title, GRID.contentWidth, TYPE.sectionTitle.size);
    if (need32 < 5) fail(`the stress title measures only ${need32} lines at ${TYPE.sectionTitle.size}pt — the ladder never runs and this proves nothing`);
    if (!ct || !cs || !ck || !bar || !cstyle) fail("the stress divider drew incompletely");
    else {
      const fitted = cstyle.fontSize?.magnitude;
      if (!(fitted < TYPE.sectionTitle.size && fitted >= SECTION.titleMinSize)) fail(`a long title is drawn at ${fitted}pt — not fitted down (floor ${SECTION.titleMinSize})`);
      if (cs.y + cs.h > GRID.bodyY + bandHeightFor(Cs) + 0.5) fail(`the stack ends at ${(cs.y + cs.h).toFixed(1)}, past the band's floor ${(GRID.bodyY + bandHeightFor(Cs)).toFixed(1)}`);
      if (bar.y < cs.y + cs.h + NOTE.gap - 0.5) fail(`the takeaway bar (${bar.y.toFixed(1)}) is drawn through the subtitle (ends ${(cs.y + cs.h).toFixed(1)})`);
      if (ck.y < SECTION.minTop - 0.5) fail(`the kicker climbed back into the header slot (${ck.y.toFixed(1)})`);
      for (const r of cr) {
        const o = r.createShape; if (!o) continue;
        const bottom = o.elementProperties.transform.translateY + o.elementProperties.size.height.magnitude;
        if (/_(eyebrow|title|sub)$/.test(o.objectId) && bottom > FOOTER_Y - 4) fail(`${o.objectId} ends at ${bottom.toFixed(1)}, on the footer`);
      }
    }

    // fitHeading measures at the caller's lead; callers that pass none are unchanged.
    const at = fitHeading("One line", TYPE.sectionTitle, 600, { bottom: 400, minTop: 0, minHeight: 0, lineSpacing: SECTION.titleLead }).height;
    const dflt = fitHeading("One line", TYPE.sectionTitle, 600, { bottom: 400, minTop: 0, minHeight: 0 }).height;
    if (Math.abs(at - dflt) < 0.01) fail("fitHeading's lineSpacing option changes nothing — the precondition of the next two assertions fails");
    if (Math.abs(at - drawnTextHeight(1, TYPE.sectionTitle.size, 0, 1, SECTION.titleLead)) > 0.01) fail(`fitHeading at the divider's lead gives ${at.toFixed(2)}, not the measured ${drawnTextHeight(1, TYPE.sectionTitle.size, 0, 1, SECTION.titleLead).toFixed(2)}`);
    if (Math.abs(dflt - drawnTextHeight(1, TYPE.sectionTitle.size)) > 0.01) fail("fitHeading without a lead no longer measures at LINE_LEAD");
    // The drawn box must cover the ink model check 11 measures with.
    if (1.26 * SECTION.titleLead < 1.38 - 0.001) fail(`SECTION.titleLead ${SECTION.titleLead} draws a box (${(1.26 * SECTION.titleLead).toFixed(3)}/line) thinner than the 1.38 ink box the collision check measures — a three-line title would be reported as running onto its subtitle; grow subtitleGap first`);
  }
  if (failures === before28) pass("kicker, title and subtitle stack as one measured lockup centred on the page; a long title shrinks rather than pushing the subtitle onto the bar");

  /* 29. PHASE B: WHAT EACH REDESIGNED LAYOUT IS
   *
   * Five mutations survived the first run of this section's absence: the
   * process card's name could go back to white caps, its owner clause could
   * stay buried in the caption, the Venn's labels could be forced outside,
   * its sidebar could revert to a full-width bar, and the stat grid could be
   * drawn on navy again — all with a green battery. Every one of those is a
   * reviewer finding from the deck the client presented INSTEAD of ours, so
   * each gets an assertion that names it.
   *
   * MUTATION LOG
   *   - process name back to white caps          → KILLED
   *   - owner clause left in the caption          → KILLED
   *   - venn labels forced outside                → KILLED
   *   - venn note back to the full-width bar      → KILLED
   *   - stat grid drawn on the navy ground        → KILLED
   */
  const before29 = failures;
  console.log(`\n29. Phase B: what each redesigned layout is`);
  {
    const geomOf = (reqs: any[], suffix: string) => {
      for (let i = 0; i < reqs.length; i++) {
        const o = reqs[i].createShape || reqs[i].createImage;
        if (o && String(o.objectId).endsWith(suffix)) {
          const t = o.elementProperties.transform;
          return { x: t.translateX, y: t.translateY, w: o.elementProperties.size.width.magnitude, h: o.elementProperties.size.height.magnitude };
        }
      }
      return null;
    };
    const textOf = (reqs: any[], suffix: string) => {
      for (let i = 0; i < reqs.length; i++) if (reqs[i].insertText && String(reqs[i].insertText.objectId).endsWith(suffix)) return String(reqs[i].insertText.text);
      return "";
    };
    const styleOf = (reqs: any[], suffix: string) => {
      for (let i = 0; i < reqs.length; i++) {
        const u = reqs[i].updateTextStyle;
        if (u && u.textRange?.type === "ALL" && String(u.objectId).endsWith(suffix)) return u.style;
      }
      return null;
    };

    // PROCESS: a card, not a pill. Mixed-case bold name, owner split off.
    const proc: SlideInput = { layout: "process", title: "Entity mapping", stages: [
      { name: "We draft", caption: "Ahead of session two we drafted a first entity mapping from public sources. Owner: TCE" },
      { name: "We refine together", caption: "Together we correct errors and obsolete information. Owner: TCE + your team" },
      { name: "You prioritise", caption: "Your team assigns priority tiers. Owner: your team" },
    ] };
    const pr = buildSlideRequests(proc, 0, "p29a") as any[];
    const nameStyle = styleOf(pr, "_ps0");
    if (!nameStyle) fail("the process card draws no name (ps0)");
    else {
      if (textOf(pr, "_ps0") !== "We draft") fail(`the step name is drawn as "${textOf(pr, "_ps0")}" — the caps pill label is back`);
      if ((nameStyle.fontSize?.magnitude || 0) < 10) fail(`the step name is ${nameStyle.fontSize?.magnitude}pt — the reference sets it at 10.5, ours was a 9pt caps label`);
      const fg = nameStyle.foregroundColor?.opaqueColor?.rgbColor || {};
      const isWhite = (fg.red || 0) > 0.95 && (fg.green || 0) > 0.95 && (fg.blue || 0) > 0.95;
      if (isWhite) fail("the step name is white — it is navy on a light card now, not a label inside a blue pill");
    }
    if (/owner\s*:/i.test(textOf(pr, "_pc0"))) fail(`the description still carries its owner clause: "${textOf(pr, "_pc0").slice(-28)}"`);
    if (textOf(pr, "_po0") !== "Owner: TCE") fail(`the owner is not on its own line (po0 = "${textOf(pr, "_po0")}")`);
    { const c0 = geomOf(pr, "_pb0"), o0 = geomOf(pr, "_po0");
      if (c0 && o0 && o0.y + o0.h > c0.y + c0.h + 0.5) fail("the owner line runs past the foot of its card"); }
    if (splitStageOwner("Some prose about owners: with a colon", undefined).owner !== "") {
      fail("a mid-sentence 'owner:' is being read as an owner clause");
    }

    // VENN: labels inside their own exclusive regions, note as a sidebar.
    const vn: SlideInput = { layout: "venn", title: "Three arenas",
      venn: { sets: [
        { label: "Owned website - entity pages, schema, FAQs" },
        { label: "Direct - LinkedIn, newsletters, executives" },
        { label: "Indirect - PR, Wikipedia, analysts" },
      ], overlap: "Triangulation: one story AI can verify three ways" },
      note: "Sequence matters: fix the website first, then expand into direct and earned." };
    const vr = buildSlideRequests(vn, 0, "p29b") as any[];
    const c0 = geomOf(vr, "_vc0"), c1 = geomOf(vr, "_vc1"), c2 = geomOf(vr, "_vc2");
    if (!c0 || !c1 || !c2) fail("the venn drew fewer than three circles");
    else {
      const R = c0.w / 2;
      const centre = (g: { x: number; y: number; w: number; h: number }) => [g.x + g.w / 2, g.y + g.h / 2];
      const cs = [centre(c0), centre(c1), centre(c2)];
      for (let i = 0; i < 3; i++) {
        const lab = geomOf(vr, `_vn${i}`);
        if (!lab) { fail(`the venn drew no label vn${i}`); continue; }
        const lc = [lab.x + lab.w / 2, lab.y + lab.h / 2];
        const d = (k: number) => Math.hypot(lc[0] - cs[k][0], lc[1] - cs[k][1]);
        // INSIDE its own circle and outside the other two: its exclusive region.
        if (d(i) >= R) fail(`venn label ${i} sits ${d(i).toFixed(0)}pt from its circle's centre (R ${R.toFixed(0)}) — outside the circle it names`);
        for (let k = 0; k < 3; k++) if (k !== i && d(k) < R) fail(`venn label ${i} sits inside circle ${k} as well — not an exclusive region`);
      }
      // Separation: the overlaps are lenses, not a near-total eclipse.
      const gap = Math.hypot(cs[0][0] - cs[1][0], cs[0][1] - cs[1][1]);
      if (gap < R) fail(`the venn's circles are ${gap.toFixed(0)}pt apart at R ${R.toFixed(0)} — the overlap swallows the sets`);
    }
    const vbar = geomOf(vr, "_noteBar");
    if (!vbar) fail("the venn slide drew no takeaway at all");
    else {
      if (vbar.w >= GRID.contentWidth - 1) fail(`the venn's takeaway is a full-width bar (${vbar.w.toFixed(0)}pt) — the reference sets it as a callout beside the diagram`);
      if (Math.abs(vbar.x + vbar.w - (GRID.margin + GRID.contentWidth)) > 1) fail(`the venn's callout is not against the right margin (ends ${(vbar.x + vbar.w).toFixed(1)})`);
      if (!textOf(vr, "_noteHead")) fail("the callout has no heading — the note's lead-in before the colon is what the presenter says out loud");
    }

    // STAT GRID: four or more figures are cards on the LIGHT ground.
    const sg: SlideInput = { layout: "stat", title: "The landscape", stats: [
      { value: "1B", label: "ChatGPT weekly active users", detail: "Aug 2026" },
      { value: "950M", label: "Gemini app monthly users", detail: "Q2 2026" },
      { value: "68%", label: "of searches end without a click", detail: "SparkToro" },
      { value: "+120%", label: "more clicks when cited", detail: "Seer", primary: true },
    ] };
    const gr = buildSlideRequests(sg, 0, "p29c") as any[];
    const bg = gr.find((r: any) => r.updatePageProperties)?.updatePageProperties?.pageProperties?.pageBackgroundFill?.solidFill?.color?.rgbColor || {};
    const dark = (bg.red || 0) < 0.3 && (bg.green || 0) < 0.3;
    if (dark) fail("a four-figure stat slide is still drawn on navy — the grid is a light page, and on navy it read as a section break that was not one");
    if (!gr.some((r: any) => r.updateShapeProperties?.shapeProperties?.outline?.outlineFill)) {
      fail("the stat cards carry no border — on off-white the tint alone is too faint to read as a card");
    }
    // And the lockup follows the ground, or it is invisible on it.
    const logo = gr.find((r: any) => (r.createImage?.objectId || "").endsWith("_logo"));
    if (!logo) fail("the stat grid drew no logo");
    else if (String(logo.createImage.url).indexOf("white") >= 0) fail("the grid carries the WHITE lockup on a light page");
    // Three figures keep the navy hero row the reviewers preferred.
    const heroReqs = buildSlideRequests({ ...sg, stats: sg.stats!.slice(0, 3) }, 0, "p29d") as any[];
    const hbg = heroReqs.find((r: any) => r.updatePageProperties)?.updatePageProperties?.pageProperties?.pageBackgroundFill?.solidFill?.color?.rgbColor || {};
    if (!((hbg.red || 0) < 0.3 && (hbg.green || 0) < 0.3)) fail("three figures no longer draw the navy hero row — the reviewers scored that ours-better and it must survive");
  }
  if (failures === before29) pass("a process step is a card with its owner on its own line, the venn labels inside its circles with the note beside them, and four figures are a light grid");

  /* 30. A LABEL INSIDE A SHAPE IS CENTRED IN IT
   *
   * "Make sure labels are always centred in pills and in heading boxes. Your
   * version had them aligned with the top or bottom and looked silly."
   *
   * The cause is always the same: a row shares ONE box height so that the
   * things below it line up — the tallest heading in a card row, the tallest
   * label in a stat grid — and then a short label is drawn at the top of that
   * shared box with the slack under it. Bottom-aligning moves the hole rather
   * than removing it; centring is the only placement that reads as deliberate
   * at every line count.
   *
   * This asserts the RULE, not four fixes: every text box that a filled shape
   * covers, with more than 4pt of slack around its own drawn text, must carry
   * contentAlignment MIDDLE. Driven over every fixture in DECK and STRESS, so
   * a new layout inherits it the day it is written.
   *
   * THE EXCEPTION, named rather than silent: a body of prose whose ROW shares
   * a baseline — the two-column bodies and a card's body — is top-aligned on
   * purpose. Centring those would let a three-line column and a six-line one
   * start at different heights, which is the fault this rule exists to stop,
   * one level up. They are listed by id, so a new id is covered by default.
   *
   * MUTATION LOG
   *   - vCenter dropped from a card heading   → KILLED
   *   - dropped from a stat card's label      → KILLED
   *   - dropped from a stat card's source     → KILLED
   *   - a body id added to the exception list → KILLED (the list is asserted
   *     to be exactly the four that share a baseline)
   */
  const before30 = failures;
  console.log(`\n30. A label inside a shape is centred in it`);
  {
    // Bodies whose ROW shares a start line. Anything else covered by a shape
    // is a label and must centre.
    // "qi" is a SWOT quadrant's bulleted list: four quadrants read across as
    // a grid, so their first bullets must start on one line whatever each
    // quadrant holds — the same reason as the two-column bodies.
    const BASELINE_BODIES = ["left", "right", "cb", "noteTxt", "qi"];
    if (BASELINE_BODIES.length !== 5) fail("the baseline-body exception list changed size — say why in the comment above");
    let checked = 0;
    const all: SlideInput[] = ([] as SlideInput[]).concat(DECK as any, STRESS as any);
    all.forEach((slide, si) => {
      const reqs = buildSlideRequests(slide, si, `p30_${si}`) as any[];
      const shapes = new Map<string, any>(), filled = new Set<string>(), mid = new Set<string>();
      const sizes = new Map<string, number>(), texts = new Map<string, string>(), spacing = new Map<string, number>();
      for (const r of reqs) {
        if (r.createShape) shapes.set(r.createShape.objectId, r.createShape.elementProperties);
        if (r.updateShapeProperties) {
          const sp = r.updateShapeProperties.shapeProperties;
          if (sp?.contentAlignment === "MIDDLE") mid.add(r.updateShapeProperties.objectId);
          if (sp?.shapeBackgroundFill) filled.add(r.updateShapeProperties.objectId);
        }
        if (r.insertText) texts.set(r.insertText.objectId, String(r.insertText.text));
        if (r.updateTextStyle?.style?.fontSize) sizes.set(r.updateTextStyle.objectId, r.updateTextStyle.style.fontSize.magnitude);
        if (r.updateParagraphStyle?.style?.lineSpacing) spacing.set(r.updateParagraphStyle.objectId, r.updateParagraphStyle.style.lineSpacing / 100);
      }
      const boxOf = (oid: string) => {
        const e = shapes.get(oid); if (!e) return null;
        return { x: e.transform.translateX, y: e.transform.translateY, w: e.size.width.magnitude, h: e.size.height.magnitude };
      };
      texts.forEach((txt, oid) => {
        if (filled.has(oid)) return;
        const suffix = String(oid).split("_").pop() || "";
        const kind = suffix.replace(/\d+(_\d+)?$/, "");
        // By PREFIX: a SWOT quadrant's list is "qis"/"qiw"/"qio"/"qit" — the
        // key is a letter, so stripping trailing digits leaves it attached.
        let isBody = false;
        for (let bi = 0; bi < BASELINE_BODIES.length; bi++) if (kind.indexOf(BASELINE_BODIES[bi]) === 0) isBody = true;
        if (isBody) return;
        const b = boxOf(oid); if (!b) return;
        const size = sizes.get(oid) || 10;
        const need = drawnTextHeight(Math.max(1, estimateLines(txt, b.w, size)), size, 0, 1, spacing.get(oid));
        if (b.h - need <= 4) return;                     // hugs its words
        let covered = false;
        filled.forEach((fid) => {
          if (covered || fid === oid) return;
          const f = boxOf(fid); if (!f) return;
          if (f.x - 0.6 <= b.x && f.y - 0.6 <= b.y && f.x + f.w + 0.6 >= b.x + b.w && f.y + f.h + 0.6 >= b.y + b.h) covered = true;
        });
        if (!covered) return;
        checked++;
        if (!mid.has(oid)) {
          fail(`${slide.layout}: "${txt.slice(0, 26)}" (${kind}) sits in a shape with ${(b.h - need).toFixed(1)}pt of slack and is not centred in it`);
        }
      });
    });
    // The sweep must actually find labels, or it asserts nothing at all.
    if (checked < 12) fail(`only ${checked} covered labels were measured across ${all.length} fixtures — the sweep is not reaching the layouts it is meant to police`);
  }
  if (failures === before30) pass("every label a shape encloses is centred in it; only the bodies that share a row baseline stay top-aligned");

  // ── 31 ─────────────────────────────────────────────────────────────────
  // A quadrant caption is a claim about the axes, and it used to be a claim
  // the CALLER had to translate into a corner. One got it inverted: a deck
  // printed "Later" over the high-impact/low-effort corner, where its own
  // subtitle said the single half-day move lived, and the "Do now" it HAD
  // supplied was never drawn at all because the renderer read indices 0 and 1
  // only. Both halves are asserted here — the placement follows the axes, and
  // nothing supplied is silently dropped.
  const before31 = failures;
  console.log(`\n31. A quadrant caption lands where its own axes put it`);
  {
    const m = {
      xAxis: ["Low effort", "High effort"] as [string, string],
      yAxis: ["Low impact", "High impact"] as [string, string],
      quadrants: [
        { label: "Do now", x: "low", y: "high" },
        { label: "Plan it", x: "high", y: "high" },
        { label: "Fill-ins", x: "low", y: "low" },
        { label: "Drop", x: "high", y: "low" },
      ],
      // Schema: the cheap move the subtitle names. It must plot INSIDE the
      // quadrant the caption calls the one to do first.
      items: [{ label: "Schema", x: 0.12, y: 0.88, highlight: true }, { label: "Rebuild", x: 0.85, y: 0.2 }],
    };
    const rq: any[] = buildSlideRequests({ layout: "matrix", title: "Priorities", subtitle: "Schema is the single half-day move.", matrix: m } as any, 0, "n");
    const box = (sfx: string) => {
      const r = rq.find((q) => (q.createShape?.objectId || "").endsWith(sfx));
      const e = r?.createShape?.elementProperties;
      return e ? { x: e.transform.translateX, y: e.transform.translateY, w: e.size.width.magnitude, h: e.size.height.magnitude } : null;
    };
    const textOf = (sfx: string) => {
      const r = rq.find((q) => (q.insertText?.objectId || "").endsWith(sfx));
      return r?.insertText?.text ?? null;
    };
    // Every caption supplied is drawn. Two of four used to reach the slide.
    const caps = ["_mql0", "_mql1", "_mql2", "_mql3"].map((k) => ({ k, b: box(k), t: textOf(k) }));
    const drawn = caps.filter((c) => c.b);
    if (drawn.length !== 4) fail(`matrix drew ${drawn.length} of 4 quadrant captions — the rest were dropped without a word`);
    // Placement follows the axes, not the order they were written in.
    const want: Record<string, string> = { _mql0: "Do now", _mql1: "Plan it", _mql2: "Fill-ins", _mql3: "Drop" };
    caps.forEach((c) => { if (c.b && c.t !== want[c.k]) fail(`matrix put "${c.t}" where "${want[c.k]}" belongs by its axes`); });
    const dot = box("_md0"), doNow = box("_mql0"), plan = box("_mql1"), fill = box("_mql2");
    if (!dot || !doNow || !plan || !fill) fail("matrix did not draw both the highlighted item and its quadrant captions");
    else {
      // The caption for low-effort/high-impact sits in the same half-plane as
      // an item plotted at low x and high y. This is the assertion the shipped
      // deck violated.
      const midX = (doNow.x + plan.x + plan.w) / 2, midY = (doNow.y + fill.y) / 2;
      if (!(dot.x < midX)) fail("a low-effort item did not plot in the same half as the low-effort captions");
      if (!(dot.y < midY)) fail("a high-impact item did not plot in the same half as the high-impact caption");
      if (!(doNow.x < midX && doNow.y < midY)) fail("the low-effort/high-impact caption is not in the low-effort/high-impact quadrant");
    }
    // The legacy four-tuple keeps its documented reading, so decks already
    // built still re-render the way they were composed.
    const legacy: any[] = buildSlideRequests({ layout: "matrix", title: "T",
      matrix: { xAxis: ["l", "h"], yAxis: ["l", "h"], quadrants: ["TL", "TR", "BL", "BR"], items: [{ label: "A", x: 0.5, y: 0.5 }] } } as any, 0, "n");
    const legacyText = (sfx: string) => legacy.find((q) => (q.insertText?.objectId || "").endsWith(sfx))?.insertText?.text ?? null;
    [["_mql0", "TL"], ["_mql1", "TR"], ["_mql2", "BL"], ["_mql3", "BR"]].forEach(([k, t]) => {
      if (legacyText(k) !== t) fail(`the legacy tuple no longer reads as TL,TR,BL,BR: ${k} held "${legacyText(k)}"`);
    });
  }
  if (failures === before31) pass("every quadrant caption is drawn, and each sits in the quadrant its own axes name");

  // ── 32 ─────────────────────────────────────────────────────────────────
  // The estimator's width constants, pinned to how they were obtained.
  //
  // Measured with canvas measureText against Google's own webfonts, over four
  // real lines of this deck's body copy: Roboto Light 0.4183em, Playfair
  // Display 0.4652, Poppins 0.5256, Roboto bold caps 0.6163. The table carries
  // those plus 6%. Re-measure before changing one — a number invented here
  // silently splits slides that fit, or overruns ones that do not, and neither
  // shows up as an error anywhere.
  const before32 = failures;
  console.log(`\n32. The estimator measures the face it is drawing, and only what is drawn`);
  {
    const near = (a: number, b: number, tol: number, what: string) => {
      if (Math.abs(a - b) > tol) fail(`${what}: ${a.toFixed(4)} is not within ${tol} of ${b.toFixed(4)}`);
    };
    near(faceAdvance("Roboto"), 0.4183 * 1.06, 0.005, "Roboto's advance has drifted from the measured 0.4183em + 6%");
    near(faceAdvance("Playfair Display"), 0.4652 * 1.06, 0.005, "Playfair Display's advance has drifted from the measured 0.4652em + 6%");
    near(faceAdvance("Roboto", true), 0.6163 * 1.06, 0.005, "Roboto's caps advance has drifted from the measured 0.6163em + 6%");
    // The body face must be measured NARROWER than the unnamed default: that
    // gap is the whole fix. If a refactor stops passing the font through, this
    // equalises and the unnecessary splits come back.
    if (!(faceAdvance("Roboto") < faceAdvance() * 0.9)) {
      fail("Roboto is no longer measured narrower than the unnamed default — the face is not reaching the estimator");
    }
    // An unnamed caller measures exactly as it did before the table existed.
    // Widening the caps ratio globally instead broke the stacked-bar labels.
    near(faceAdvance(), 0.55, 1e-9, "the unnamed default advance moved");
    near(faceAdvance(undefined, true), 0.55 * CAPS_WIDEN, 1e-9, "the unnamed caps advance moved");

    // Only what Slides will actually hold is counted. The house style opens
    // almost every bullet with a bold lead-in, and the markers are stripped
    // before drawing; counting them made a six-line body measure as ten.
    const bold = "**Finding:** the crawl found no organisation schema at all";
    const plain = "Finding: the crawl found no organisation schema at all";
    if (estimateLines(bold, 432, 13, true, false, "Roboto") !== estimateLines(plain, 432, 13, true, false, "Roboto")) {
      fail("bold markers are counted as text — a bulleted body measures wider than it draws");
    }
    // An IMAGE reduces to its caption. AuthorityOn's rebuilt audit documents
    // carry every chart as `![caption](chart:id)`, and the whole string was
    // being drawn on the slide verbatim — brackets, bang and the chart id.
    // The caption carries the instrument and the date, so it is the half
    // worth keeping.
    const chart = "![Presence by product. The audit run, 2 September 2026.](chart:presence-by-product)";
    if (stripImageMarkdown(chart) !== "Presence by product. The audit run, 2 September 2026.") {
      fail(`image markdown is not reduced to its caption: got "${stripImageMarkdown(chart)}"`);
    }
    if (drawnText(chart).indexOf("chart:") >= 0 || drawnText(chart).indexOf("![") >= 0) {
      fail("a chart id or image syntax survives into the text a slide draws");
    }
    // A real link still renders, and a bare exclamation mark is not eaten.
    if (drawnText("See [the report](https://example.com/x) now") !== "See the report now") {
      fail("stripping images broke ordinary link handling");
    }
    if (drawnText("Wow! [a link](https://e.com) here") !== "Wow! a link here") {
      fail("an exclamation mark before a link was swallowed as image syntax");
    }
    const linked = "See [the ITM 2026 report](https://example.com/reports/itm-2026-full-edition) for the detail";
    const bare = "See the ITM 2026 report for the detail";
    if (estimateLines(linked, 432, 13, true, false, "Roboto") !== estimateLines(bare, 432, 13, true, false, "Roboto")) {
      fail("a link's URL is counted as text — the whole address is measured and none of it is drawn");
    }
    // A body written in the house style splits at the same point as the same
    // words written plainly. That equality IS the fix: the markers cost the
    // slide nothing, where before they cost it a whole extra slide. Asserted
    // as a sweep rather than at one length, because the interesting failure is
    // a threshold that moves, not a single body that happens to fit.
    const bullets = (n: number) => Array.from({ length: n }, (_, i) =>
      `**Finding ${i + 1}:** the crawl found no organisation schema on any page`).join("\n");
    for (let n = 3; n <= 10; n++) {
      const b = bullets(n), plainer = b.replace(/\*\*/g, "");
      const withMarks = splitOverflowingSlides([{ layout: "content", title: "Where the gaps are", body: b }]).length;
      const without = splitOverflowingSlides([{ layout: "content", title: "Where the gaps are", body: plainer }]).length;
      if (withMarks !== without) fail(`${n} bullets: bold lead-ins cost the slide ${withMarks - without} extra slide(s)`);
    }
    // Seven of them fit one slide, which the old measure denied.
    const built = splitOverflowingSlides([{ layout: "content", title: "Where the gaps are", body: bullets(7) }]);
    if (built.length !== 1) fail(`seven bold bullets were split across ${built.length} slides`);
  }
  if (failures === before32) pass("each face is measured as itself, unnamed callers are unchanged, and markup that is stripped is not counted");

  // ── 33 ─────────────────────────────────────────────────────────────────
  // A chart callout carries the FINDING on these slides, and when it cannot
  // fit beside its bar it falls back to a line under the source. That line was
  // not in the plot's budget, so seven bars painted it straight through the
  // footer — 354pt of overlap, on the slide whose whole point it was. The
  // battery passed throughout, because no fixture put a callout on a full
  // plot; that gap is what this closes. Swept across bar counts because the
  // collision only appears once the plot is tall enough to push the source
  // block down, and across title lengths because a two-line title moves the
  // band top and was how every earlier collision hid.
  const before33 = failures;
  console.log(`\n33. A chart callout stays on the slide, whatever the plot does`);
  {
    const mk = (n: number, longTitle: boolean): SlideInput => ({
      layout: "bar-chart",
      title: longTitle ? "One model retrieves it and the other six do not reach it at all" : "One model retrieves it",
      subtitle: "Presence: answers that named the report, of each model's audit answers.",
      chart: {
        source: "Audit run, 2 September 2026. 243 of 2,131 answers named the report.",
        callout: { point: 0, text: "Unprompted, by the exhibit rule: Perplexity 67 of 275. The other six models: 0 of 1,646." },
        series: [{ name: "Presence", points: Array.from({ length: n }, (_, i) => ({ label: `Model ${i + 1}`, value: 32 - i * 3 })) }],
      },
    } as SlideInput);
    let sawFallback = 0;
    for (const longTitle of [false, true]) {
      for (const n of [2, 3, 5, 7, 8, 10, 12]) {
        const rq: any[] = buildSlideRequests(mk(n, longTitle), 0, "n");
        const boxes = rq.filter((r) => r.createShape).map((r) => {
          const e = r.createShape.elementProperties;
          return { id: r.createShape.objectId as string, x: e.transform.translateX, y: e.transform.translateY, w: e.size.width.magnitude, h: e.size.height.magnitude };
        });
        const textOf = (oid: string) => rq.find((q) => q.insertText?.objectId === oid)?.insertText?.text ?? "";
        const callout = boxes.find((b) => b.id.endsWith("_cnote"));
        if (!callout) fail(`${n} bars, ${longTitle ? "two-line" : "one-line"} title: the callout was not drawn at all`);
        else {
          if (callout.y + callout.h > FOOTER_Y - 1) {
            fail(`${n} bars: the callout runs to ${(callout.y + callout.h).toFixed(0)}pt, into the footer at ${FOOTER_Y}`);
          }
          if (callout.y > GRID.bodyY) sawFallback += 1;
        }
        for (let i = 0; i < boxes.length; i++) {
          for (let j = i + 1; j < boxes.length; j++) {
            const a = boxes[i], b = boxes[j];
            if (!textOf(a.id) || !textOf(b.id)) continue;
            const ox = Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x);
            const oy = Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y);
            if (ox > 0.6 && oy > 0.6) {
              fail(`${n} bars, ${longTitle ? "two-line" : "one-line"} title: ${a.id.split("_").pop()} and ${b.id.split("_").pop()} overlap by ${ox.toFixed(0)}x${oy.toFixed(1)}pt`);
            }
          }
        }
      }
    }
    // The sweep has to actually REACH the fallback path, or it proves nothing
    // about the case that broke: a callout that always fits beside its bar
    // never exercises the reserved line.
    if (sawFallback < 4) fail(`only ${sawFallback} of 14 fixtures put the callout on its fallback line — the sweep is not reaching the path that failed`);
  }
  if (failures === before33) pass("a chart callout keeps clear of the source, the footer and every other box, at every plot height");

  // ── 34 ─────────────────────────────────────────────────────────────────
  // A PHRASE IN A STAT ROW MUST NOT SHRINK THE FIGURES BESIDE IT.
  //
  // The row used one size for every value, solved from the longest string of
  // any kind. A team-briefing deck put "Monitoring-only" beside "66" and "5",
  // and both numbers — the two figures the slide existed for — drew at 22pt
  // where the same row of numbers draws at 54pt.
  const before34 = failures;
  console.log(`\n34. A phrase in a stat row does not shrink the figures beside it`);
  {
    const sizes = (values: string[]) => {
      const rq: any[] = buildSlideRequests({ layout: "stat", title: "By the numbers",
        stats: values.map((v, i) => ({ value: v, label: `Label ${i + 1}` })) } as SlideInput, 0, "n");
      return values.map((_, i) => {
        const st = rq.find((q) => (q.updateTextStyle?.objectId || "").endsWith(`_sv${i}`) && q.updateTextStyle.style?.fontSize);
        return st ? st.updateTextStyle.style.fontSize.magnitude as number : NaN;
      });
    };
    const numbers = sizes(["66", "5", "40"]);
    const mixed = sizes(["66", "5", "Monitoring-only"]);
    if (numbers.some((n) => !Number.isFinite(n)) || mixed.some((n) => !Number.isFinite(n))) {
      fail("could not read the stat value sizes — the check is not measuring anything");
    } else {
      if (mixed[0] !== numbers[0] || mixed[1] !== numbers[1]) {
        fail(`a phrase shrank the figures: "66" and "5" drew at ${mixed[0]}/${mixed[1]}pt beside it, ${numbers[0]}/${numbers[1]}pt beside a number`);
      }
      if (mixed[2] > mixed[0]) fail(`the phrase (${mixed[2]}pt) out-sizes the figures beside it (${mixed[0]}pt)`);
      // One size across FIGURES still holds — that rule was right.
      const figs = sizes(["92.5 GW", "66", "5"]);
      if (!(figs[0] === figs[1] && figs[1] === figs[2])) fail(`figures in one row no longer share a size: ${figs.join("/")}`);
      // A row of phrases only has no figure to defer to, and must still draw.
      const words = sizes(["Weekly", "Monthly", "Quarterly"]);
      if (words.some((n) => !(n > 0))) fail("a row with no figures in it no longer sizes its values");
    }
  }
  if (failures === before34) pass("a phrase takes its own size, figures keep theirs, and figures still share one size");

  // ── 35 ─────────────────────────────────────────────────────────────────
  // THE TAKEAWAY NOTE KEEPS CLEAR OF THE PICTURE RAIL.
  //
  // The note bar was always drawn at full content width, and the rail sits in
  // the right-hand column, so on any prose slide with a photograph the bar ran
  // underneath it — 206pt of a team-briefing deck's key sentence, under a
  // picture. Check 11 never saw it: it compares TEXT with text, and a rail is
  // an image.
  //
  // The second half is the trap in the obvious fix. Narrow the bar without
  // narrowing the height it is measured at, and the sentence wraps to more
  // lines than the bar was sized for and overflows its own panel.
  const before35 = failures;
  console.log(`\n35. A takeaway note keeps clear of the picture rail, and still fits its bar`);
  {
    const note = "Monitoring rate and audit rate come from different prompt sets — never quote one as the other, and say which one a figure came from.";
    const body = "**AI Score:** website, content and social pillars.\n**Recommendations:** by department.\n**Verbatim answers:** what the models actually say.";
    const geo = (slide: any) => {
      const rq: any[] = buildSlideRequests(slide, 0, "n");
      const box = (sfx: string) => {
        const r = rq.find((q) => ((q.createShape || q.createImage)?.objectId || "").endsWith(sfx));
        const e = r && (r.createShape || r.createImage).elementProperties;
        return e ? { x: e.transform.translateX, y: e.transform.translateY, w: e.size.width.magnitude, h: e.size.height.magnitude } : null;
      };
      const sizeRq = rq.find((q) => (q.updateTextStyle?.objectId || "").endsWith("_noteTxt") && q.updateTextStyle.style?.fontSize);
      return { bar: box("_noteBar"), txt: box("_noteTxt"), rail: box("_rail"), size: sizeRq ? sizeRq.updateTextStyle.style.fontSize.magnitude : NaN };
    };
    const railed = geo({ layout: "content", title: "What it measures", body, note, resolvedImage: { url: "https://example.com/x.jpg", scrim: 0 } });
    const plain = geo({ layout: "content", title: "What it measures", body, note });
    const caseStudy = geo({ layout: "case-study", title: "What it measures", body, note, resolvedImage: { url: "https://example.com/x.jpg", scrim: 0 } });

    if (!railed.bar || !railed.rail || !railed.txt) {
      fail("the railed fixture did not draw a note bar, its text and a rail — the check is not measuring anything");
    } else {
      if (railed.bar.x + railed.bar.w > railed.rail.x + 0.5) {
        fail(`the note bar runs ${(railed.bar.x + railed.bar.w - railed.rail.x).toFixed(0)}pt under the picture rail`);
      }
      // The text must fit the bar at the width it is actually drawn at.
      const lines = estimateLines(note, railed.txt.w, railed.size, false, false, "Roboto");
      const need = drawnTextHeight(lines, railed.size, 0, 1, 1.15);
      if (need > railed.txt.h + 1) {
        fail(`the narrowed note needs ${need.toFixed(0)}pt for its text but its box is ${railed.txt.h.toFixed(0)}pt — the height was measured at the wrong width`);
      }
      if (railed.txt.y + railed.txt.h > railed.bar.y + railed.bar.h + 1) {
        fail("the note's text box extends past the bottom of its own bar");
      }
    }
    if (caseStudy.bar && caseStudy.rail && caseStudy.bar.x + caseStudy.bar.w > caseStudy.rail.x + 0.5) {
      fail("a case-study note still runs under its picture rail");
    }
    // REGRESSION GUARD, in both directions. A slide with no picture keeps the
    // full-width bar, and it must be wider than the bar beside a rail — equal
    // widths mean either nothing narrowed or everything did, and the message
    // says which rather than guessing.
    if (plain.bar && railed.bar && !(plain.bar.w > railed.bar.w)) {
      fail(plain.bar.w === railed.bar.w
        ? `the note is ${plain.bar.w.toFixed(0)}pt wide with a picture and without one — the rail is not narrowing it`
        : `a note with no picture (${plain.bar.w.toFixed(0)}pt) is narrower than one beside a rail (${railed.bar.w.toFixed(0)}pt)`);
    }
  }
  if (failures === before35) pass("a note clears the rail on content and case-study, fits its narrowed bar, and stays full width without a picture");

  /* 36. A hub wires every node to its hub, and nothing it draws collides.
   *
   * The layout exists because a platform's connections drawn as a layer stack
   * read as a table. What makes it a picture of WIRING is geometric, so that is
   * what is asserted: each wire starts on its own node's edge and ends inside
   * the hub; no node touches the rings or another node; every label stays on
   * one line; an overloaded hub keeps above its takeaway bar and says what it
   * left out. The icon half: a Lucide name is an instruction, and a long one
   * was being reported as text the slide dropped.
   *
   * THE WRAP, 2026-09-15. "HR Absence Calendar" wrapped inside its node on a
   * production slide while this check said "labels hold one line". The
   * assertion could not fail: it handed box.w - TEXT_INSET_X to estimateLines,
   * which subtracts the inset AGAIN, and counted characters at Roboto Light's
   * mean for a semibold label. Every fixture was Title Case with few capitals.
   * Labels are now measured with labelWidthPt (per-glyph, from Chrome against
   * Google's webfonts) against the room the box has, inset paid once; the
   * group names, the text in the circle, a third group, missing icons and the
   * widths themselves are asserted too, and the fixtures that went red are the
   * ones real models send: a capital-heavy label, a long group name, a long
   * name over a long caption, three groups, brand-name icons.
   *
   * MUTATION LOG (detached worktree, 2026-09-15), eight mutations:
   *   killed  `icon` removed from NON_CONTENT_KEYS
   *   killed  wire ends 30pt outside the hub
   *   SUPERSEDED  a split group named on both sides (killed then; the rule
   *           it pinned — named once, over the LEFT side — is replaced by
   *           "named once, centred over the hub", see M12 below)
   *   killed  overflow not admitted
   *   killed  label box 30pt wide (caught by check 2 as well)
   *   killed  hub measured against the full band, ignoring the takeaway bar
   *   killed  hub dropped from the visual audit
   *   SURVIVED the arc's clamp removed (curve + 60). Not a blind spot in the
   *           geometry: the outermost node lands on the margin by construction,
   *           and with short labels there was room to spare, so the wires only
   *           got shorter. It only goes wrong when nodes are at their widest,
   *           which no fixture reached — hence "long labels" below.
   *
   * MUTATION LOG, hub rendering (detached worktree, 2026-09-15), 21 mutations,
   * all killed on the final run, check 11 run alongside:
   *   M1  the pre-change hubRequests, whole — 16 failures: the capital-heavy
   *       label (116.4pt in 108.9), both long group names, the split group
   *       named over the left only, the centre title in a box two lines tall
   *   M2  node width from the longest label at 0.55em, and nothing else —
   *       "HubSpot CRM + MS Teams" alone. The old predicate passed it.
   *   M3  a group label never widens; M4 widening ignores rings and wires
   *   M5  the chord test removed; M6 a caption that fits nowhere drawn anyway
   *   M7  a third group not counted; M8 its note removed
   *   M9  no stand-in for a missing icon; M10 its note removed; M11
   *       `iconsMissing` read as slide text; M15 recorded by appending, not
   *       fresh; M17 resolution reading the hub without normalising
   *   M12 a split group named per side again
   *   M13 labelWidthPt without its margin (only the MEASURED ratios catch it:
   *       everything else measures with the same function)
   *   M14 the name-too-long note removed; M18 the name measured at Playfair's
   *       body mean; M20 the name sized to one line, as before
   *   M19 group labels fitted in the case they are written in, not caps
   *   M16 a process stage name drawn narrower than measured, and M21 check 11
   *       keeping the sizing margin — both check 11's, see there
   * SURVIVORS on the first run, each a finding about the check, each closed:
   *   M5  the chord test removed survived: no fixture's lines reached the
   *       edge. "Name over a full caption" puts one there (1.02 of the chord
   *       under the mutation, 0.87 without).
   *   M6  a five-line caption survived: it FITS the disc (0.99 of the chord
   *       at its worst). Now asserted at the layout's 92% clearance, and a
   *       caption is at most three lines.
   *   M13 the margin removed survived: layout and check moved together. The
   *       MEASURED block pins the widths to Chrome's own numbers.
   *   M19 caps ignored survived: the only long group name sat on a wide node.
   *       "Your own work tools and data" is 142pt in caps, 113 as written, on
   *       a 120pt node.
   *   M16 as first written narrowed the measure itself, and the layout re-
   *       measured the height at the narrower width: no overrun existed. The
   *       mutation was wrong, not the check; replaced by the box drawn
   *       narrower than it was measured.
   *
   * THIRD MUTATION LOG (detached worktree, 2026-09-15), after verifiers found a
   * 254pt node, an empty centre, silent cuts and CJK labels measured a third
   * short — every one invisible to the fixtures above:
   *   killed  H12 the pitch code as it was at HEAD (no one-row guard, no 26pt
   *           cap): "one group of one: node l0 is 222pt tall", and three more
   *   SURVIVED H1 the `maxN > 1` guard removed alone, and H2 the 26pt cap
   *           removed alone: each half stops the slab without the other (with
   *           one row the cap holds 26pt; with the guard the cap is never
   *           reached). Belt and braces, recorded rather than claimed twice.
   *   killed  C1 the no-centre-name note removed; C2 the centre drawn only when
   *           there is a name (caption left off, circle empty); C3 the caption-
   *           dropped note removed; C4 droppedContent no longer leaving a
   *           note's quoted text to the note — by the fixture built from the
   *           incident's own headline, or by the long caption
   *   killed  O1 the note naming what a full side cut ("A8 Phone", under the
   *           audit's eleven-character floor)
   *   killed  W5 no step-down below 12pt for one word wider than the circle:
   *           "Datenschutzbeauftragter" (143pt) runs to an edge of 113pt
   *   killed  L1 full-width glyphs back to the mean capital (CJK at 0.680 of
   *           Chrome's width); L2 walking UTF-16 units, not code points (an
   *           astral emoji counted twice: 1.166)
   *   killed  L3 a variation selector counted as a glyph — a SURVIVOR on the
   *           first run, because no fixture carried U+FE0F. Chrome measures it
   *           at zero; "Support ✅️" now pins it (1.196).
   *   killed  N7 `notes` out of NON_CONTENT_KEYS: a speaker note reported as
   *           text the slide never draws
   *   killed  N2 buildSlideRequests not normalising first (also 37): the
   *           no-centre-name fixture, its groups beside the title, draws no
   *           hub at all */
  const before36 = failures;
  console.log(`\n36. A hub slide wires every node to its hub and keeps clear of everything else`);
  {
    const itemsOf = (names: string[]) => names.map((title) => ({ title, icon: "layout-dashboard", resolvedIcon: "https://example.com/icon.png" }));
    const HUB_SLIDE = {
      layout: "hub", title: "Everything TCE runs on, in {one place}", subtitle: "It reads only what you can already see.",
      hub: { title: "EngineAI", caption: "Picks the model, fetches the data, builds the answer", groups: [
        { name: "Engine company data", tone: "blue", items: itemsOf(["Engine app", "Clients & contracts", "Tasks", "Resourcing", "Finance", "HR leave"]) },
        { name: "Your own work tools", tone: "teal", items: itemsOf(["Email", "Calendar", "Slack", "Microsoft 365", "Google Drive", "MeetingBrain"]) },
      ] },
    } as SlideInput;
    type Geo = { x: number; y: number; w: number; h: number; t: any };
    const geoOf = (slide: SlideInput) => {
      const shapes: Record<string, Geo> = {};
      const sizes: Record<string, number> = {};
      const texts: Record<string, string> = {};
      const short = (objectId: string) => objectId.replace(/^h_s0_/, "");
      for (const r of buildSlideRequests(slide, 0, "h") as any[]) {
        const b = r.createShape || r.createImage;
        if (b) {
          const t = b.elementProperties.transform;
          shapes[short(b.objectId)] = { x: t.translateX, y: t.translateY, w: b.elementProperties.size.width.magnitude, h: b.elementProperties.size.height.magnitude, t };
        }
        if (r.insertText) texts[short(r.insertText.objectId)] = r.insertText.text;
        const fs = r.updateTextStyle?.style?.fontSize;
        if (fs && sizes[short(r.updateTextStyle.objectId)] === undefined) sizes[short(r.updateTextStyle.objectId)] = fs.magnitude;
      }
      return { shapes, sizes, texts };
    };
    const keysWith = (s: Record<string, Geo>, prefix: string) => Object.keys(s).filter((k) => k.indexOf(prefix) === 0);
    // The check's OWN word wrap, so a defect in the layout's cannot vouch for
    // itself; only the width primitive is shared, as with every other check.
    const wrapBy = (text: string, width: number, measure: (s: string) => number) => {
      const words = String(text || "").split(/\s+/).filter(Boolean);
      const lines: string[] = [];
      let line = "";
      for (let i = 0; i < words.length; i++) {
        const next = line ? `${line} ${words[i]}` : words[i];
        if (line && measure(next) > width) { lines.push(line); line = words[i]; } else line = next;
      }
      if (line) lines.push(line);
      return lines;
    };
    // Every line in the circle lies inside the disc at its own depth, each box
    // is as tall as the lines it draws, and the caption starts below the title.
    const centreHolds = (label: string, g: { shapes: Record<string, Geo>; sizes: Record<string, number>; texts: Record<string, string> }) => {
      const hub = g.shapes["hbc"];
      if (!hub) return;
      const R = hub.w / 2, hx = hub.x + R, hy = hub.y + R;
      const boxes: [string, "Playfair Display" | "Roboto", number][] = [["hbt", "Playfair Display", 1.0], ["hbs", "Roboto", 1.1]];
      for (let b = 0; b < boxes.length; b++) {
        const [key, face, spacing] = boxes[b];
        const box = g.shapes[key], text = g.texts[key], size = g.sizes[key];
        if (!box || !text || !size) continue;
        const measure = (s: string) => labelWidthPt(s, size, { face });
        const lines = wrapBy(text, box.w - TEXT_INSET_X, measure);
        const pitch = size * 1.26 * spacing;
        if (box.h + 0.01 < TEXT_INSET_Y + lines.length * pitch) {
          fail(`${label}: ${key} is ${box.h.toFixed(1)}pt tall for ${lines.length} lines at ${size}pt — its text runs out of the box`);
        }
        // Three lines of 7.5pt Light is a caption; five is a paragraph set
        // round the rim of a circle, and it FITS the disc — so the count is
        // asserted, not left to the geometry.
        if (key === "hbs" && lines.length > 3) fail(`${label}: the caption is drawn in ${lines.length} lines — more than three is not a caption`);
        for (let i = 0; i < lines.length; i++) {
          const top = box.y + TEXT_INSET_Y / 2 + i * pitch;
          const dy = Math.max(Math.abs(top - hy), Math.abs(top + pitch - hy));
          // 92% of the chord, the clearance the layout promises: at 100% a
          // line's ink would touch the navy's edge, where white type vanishes.
          const chord = dy < R ? 2 * Math.sqrt(R * R - dy * dy) * 0.92 : 0;
          if (measure(lines[i]) > chord + 0.01) {
            fail(`${label}: "${lines[i]}" (${key}, ${measure(lines[i]).toFixed(0)}pt) runs to the circle's edge, which leaves ${chord.toFixed(0)}pt there`);
          }
        }
      }
      const t = g.shapes["hbt"], c = g.shapes["hbs"];
      if (t && c && c.y < t.y + t.h - TEXT_INSET_Y / 2 - 0.01) fail(`${label}: the caption starts inside the title's lines`);
    };
    const inspect = (label: string, slide: SlideInput, expectNodes: number) => {
      const g = geoOf(slide);
      const { shapes, sizes, texts } = g;
      const hub = shapes["hbc"], halo = shapes["hbo"];
      const nodes = keysWith(shapes, "hn");
      if (!hub || !halo || nodes.length !== expectNodes) {
        fail(`${label}: expected a hub, its rings and ${expectNodes} nodes; got hub=${!!hub} rings=${!!halo} nodes=${nodes.length} — the check is not measuring anything`);
        return g;
      }
      const hx = hub.x + hub.w / 2, hy = hub.y + hub.h / 2, R = hub.w / 2, haloR = halo.w / 2;
      for (let i = 0; i < nodes.length; i++) {
        const k = nodes[i];
        const n = shapes[k];
        const key = k.slice(2);
        const wire = shapes[`hw${key}`];
        if (!wire) { fail(`${label}: node ${key} has no wire`); continue; }
        // The segment's local mid-left and mid-right, through its affine.
        const T = wire.h, t = wire.t;
        const at = (u: number) => ({
          x: t.scaleX * u + (t.shearX || 0) * (T / 2) + t.translateX,
          y: (t.shearY || 0) * u + t.scaleY * (T / 2) + t.translateY,
        });
        const a = at(0), b = at(wire.w);
        const onEdge = (Math.abs(a.x - n.x) < 0.6 || Math.abs(a.x - (n.x + n.w)) < 0.6) && a.y >= n.y - 0.5 && a.y <= n.y + n.h + 0.5;
        if (!onEdge) fail(`${label}: wire ${key} does not start on its node's edge`);
        const reach = Math.hypot(b.x - hx, b.y - hy);
        if (reach > R) fail(`${label}: wire ${key} stops ${(reach - R).toFixed(1)}pt short of the hub`);
        const nx = Math.max(n.x, Math.min(hx, n.x + n.w)), ny = Math.max(n.y, Math.min(hy, n.y + n.h));
        if (Math.hypot(nx - hx, ny - hy) < haloR + 4) fail(`${label}: node ${key} runs into the hub's rings`);
        if (n.x < GRID.margin - 0.5 || n.x + n.w > GRID.margin + GRID.contentWidth + 0.5) fail(`${label}: node ${key} leaves the content width`);
        const title = texts[`ht${key}`], box = shapes[`ht${key}`], size = sizes[`ht${key}`];
        if (!title || !box || !size) { fail(`${label}: node ${key} has no label`); continue; }
        // Measured glyph by glyph against the room the box really has, the
        // inset paid ONCE. The old predicate passed box.w - TEXT_INSET_X into
        // estimateLines, which subtracts the inset again, and counted
        // characters at Light's mean: it could not fail for a label of 1 to 43
        // characters, which is how a wrapping label shipped green.
        const need = labelWidthPt(title, size);
        if (need > box.w - TEXT_INSET_X + 0.01) {
          fail(`${label}: "${title}" needs ${need.toFixed(1)}pt at ${size}pt and its ${n.w.toFixed(0)}pt node gives it ${(box.w - TEXT_INSET_X).toFixed(1)} — it wraps`);
        }
        for (let j = i + 1; j < nodes.length; j++) {
          const m = shapes[nodes[j]];
          if (n.x < m.x + m.w - 0.5 && m.x < n.x + n.w - 0.5 && n.y < m.y + m.h - 0.5 && m.y < n.y + n.h - 0.5) {
            fail(`${label}: nodes ${key} and ${nodes[j].slice(2)} overlap`);
          }
        }
      }
      // Group names: measured in the capitals they are drawn in, and clear of
      // the rings and of every node. Never inspected before; one ran 197pt of
      // caps into 120pt and down into its first node.
      const nameKeys = ["hgl", "hgr", "hgc"];
      for (let i = 0; i < nameKeys.length; i++) {
        const k = nameKeys[i], box = shapes[k], text = texts[k], size = sizes[k];
        if (!box) continue;
        const need = labelWidthPt(text, size, { caps: true });
        if (need > box.w - TEXT_INSET_X + 0.01) {
          fail(`${label}: group name "${text}" needs ${need.toFixed(0)}pt at ${size}pt and has ${(box.w - TEXT_INSET_X).toFixed(0)} — it wraps into the node below`);
        }
        const ix0 = box.x + TEXT_INSET_X / 2, ix1 = box.x + box.w - TEXT_INSET_X / 2;
        const qx = Math.max(ix0, Math.min(hx, ix1)), qy = Math.max(box.y, Math.min(hy, box.y + box.h));
        if (Math.hypot(qx - hx, qy - hy) < haloR) fail(`${label}: group name "${text}" runs into the hub's rings`);
        for (let j = 0; j < nodes.length; j++) {
          const m = shapes[nodes[j]];
          if (ix0 < m.x + m.w - 0.5 && m.x < ix1 - 0.5 && box.y < m.y + m.h - 0.5 && m.y < box.y + box.h - 0.5) {
            fail(`${label}: group name "${text}" overlaps node ${nodes[j].slice(2)}`);
          }
        }
      }
      // An icon slot is all or nothing: once one node has a mark, every node
      // does, and every label sits the same distance into its node. (The
      // nodes ride an arc, so it is the offset that must agree, not the x.)
      const marks = keysWith(shapes, "hi");
      if (marks.length && marks.length !== nodes.length) {
        fail(`${label}: ${marks.length} of ${nodes.length} nodes carry an icon mark — the others leave an empty slot`);
      }
      const insets = nodes.filter((k) => shapes[`ht${k.slice(2)}`]).map((k) => shapes[`ht${k.slice(2)}`].x - shapes[k].x);
      if (insets.length > 1 && Math.max.apply(null, insets) - Math.min.apply(null, insets) > 0.5) {
        fail(`${label}: labels sit at different depths into their nodes — ${insets.map((x) => x.toFixed(1)).join(", ")}pt`);
      }
      centreHolds(label, g);
      const stand = shapes["sub"];
      if (stand && halo.y < stand.y + stand.h - TEXT_INSET_Y / 2) fail(`${label}: the hub's rings rise into the standfirst`);
      return g;
    };

    inspect("two groups", HUB_SLIDE, 12);
    const fitsDrop = droppedContent(HUB_SLIDE, 0);
    if (fitsDrop.length) fail(`a hub that fits reports dropped text: ${fitsDrop.join(" | ").slice(0, 200)}`);

    const many = (count: number, stem: string) => itemsOf(Array.from({ length: count }, (_, i) => `${stem} source ${i + 1}`));
    const loaded = {
      ...HUB_SLIDE,
      note: "Why this matters: every answer starts from the company's own records, not the open web.",
      hub: { title: "A platform with a long name", caption: "A caption long enough to need more than one line inside the hub", groups: [
        { name: "Company data", tone: "blue", items: many(9, "Internal") },
        { name: "Work tools", tone: "teal", items: many(8, "External") } ] },
    } as SlideInput;
    const L = inspect("overloaded", loaded, 14);
    if (L.texts["hdrop"] !== "Showing 14 of 17 connections") {
      fail(`an overloaded hub does not say what it left out (${L.texts["hdrop"] || "nothing drawn"})`);
    }
    const bar = L.shapes["noteBar"];
    if (!bar) {
      fail("the overloaded hub drew no takeaway bar — the band assertion measures nothing");
    } else {
      const drawn = keysWith(L.shapes, "hn").concat(["hbo"]);
      for (let i = 0; i < drawn.length; i++) {
        const s = L.shapes[drawn[i]];
        if (s && s.y + s.h > bar.y + 0.5) fail(`overloaded: ${drawn[i]} runs ${(s.y + s.h - bar.y).toFixed(0)}pt into the takeaway bar`);
      }
    }

    // Nodes at their widest, where the arc has the least room to spend.
    const longLabels = { ...HUB_SLIDE, hub: { title: "EngineAI", groups: [
      { name: "Engine company data", items: itemsOf(["Client contracts and renewals", "Resourcing and utilisation plan", "Finance and invoicing records"]) },
      { name: "Your own work tools", items: itemsOf(["Microsoft 365 documents library", "Google Drive shared folders", "MeetingBrain transcripts"]) } ] } } as SlideInput;
    inspect("long labels", longLabels, 6);

    // A group split across both sides is named ONCE, centred over the hub —
    // over the left column alone, the identical right column read as a
    // second, unnamed kind.
    const namedOnce = (label: string, G: { shapes: Record<string, Geo> }) => {
      const c = G.shapes["hgc"], rings = G.shapes["hbo"];
      if (!c || G.shapes["hgl"] || G.shapes["hgr"]) {
        fail(`${label}: a group split across both sides should be named once, centred over the hub (centre=${!!c} left=${!!G.shapes["hgl"]} right=${!!G.shapes["hgr"]})`);
        return;
      }
      if (Math.abs(c.x + c.w / 2 - (GRID.margin + GRID.contentWidth / 2)) > 1) fail(`${label}: the group name is not centred over the hub`);
      if (rings && c.y + c.h > rings.y + 0.5) fail(`${label}: the group name runs down into the hub's rings`);
    };
    const single = { ...HUB_SLIDE, hub: { title: "EngineAI", groups: [{ name: "Connected", items: itemsOf(["One", "Two", "Three", "Four", "Five"]) }] } } as SlideInput;
    const S = inspect("one group", single, 5);
    namedOnce("one group", S);
    if (keysWith(S.shapes, "hnl").length !== 3 || keysWith(S.shapes, "hnr").length !== 2) fail("a single group of five should split three and two");

    // The production slide the wrap was reported on: one group of eight.
    const PROD = { layout: "hub", title: "EngineAI", hub: { title: "EngineAI",
      caption: "One workspace, wired into every system we already run the business on", groups: [
        { name: "CONNECTED SYSTEMS", tone: "blue", items: itemsOf(["Email & Calendar", "Slack", "Microsoft 365", "Google Drive",
          "Xero Finance", "HR Absence Calendar", "Engine Content DB", "AuthorityOn AI Data"]) } ] } } as SlideInput;
    namedOnce("production slide 4", inspect("production slide 4", PROD, 8));
    if (droppedContent(PROD, 0).length) fail(`production slide 4 reports dropped text: ${droppedContent(PROD, 0).join(" | ")}`);

    // THE BOUNDARY: 22 characters, eight of them capitals. Sized at 0.55em a
    // character it was given 108.9pt and needs 116.4; every earlier fixture
    // was Title Case with few capitals, which is why nothing here went red.
    // (Not "SAP S/4HANA ERP": its node sits on the 120pt floor, so it fitted
    // under the old sizing too and would prove nothing.) Its group name is
    // wider in the capitals it is drawn in than in the case it is written in.
    const boundary = { ...HUB_SLIDE, hub: { title: "EngineAI", groups: [
      { name: "Sales and marketing systems", tone: "blue", items: itemsOf(["HubSpot CRM + MS Teams", "Pipeline", "Quotes"]) },
      { name: "Delivery", tone: "teal", items: itemsOf(["Tasks", "Finance", "Reports"]) } ] } } as SlideInput;
    inspect("capital-heavy label", boundary, 6);

    // A long group name widens into the clear row beside it; one that fits
    // nowhere is said, not wrapped into the node under it.
    const longName = { ...HUB_SLIDE, hub: { title: "EngineAI", groups: [
      { name: "Engine company data sources and systems", tone: "blue", items: itemsOf(["Engine app", "Finance", "HR leave"]) },
      // 142pt in the capitals it is drawn in, 113pt as written, on a node at
      // the 120pt floor: fitted in the wrong case it would be drawn at 8pt in
      // a box it wraps in.
      { name: "Your own work tools and data", tone: "teal", items: itemsOf(["Email", "Slack", "Drive"]) } ] } } as SlideInput;
    const LN = inspect("long group name", longName, 6);
    if (!LN.shapes["hgl"]) fail("long group name: no group label drawn — the check measures nothing");
    if (/too long for its label/.test(deckWarnings([longName]))) fail("a group name that fits once widened is reported as too long");
    const hopeless = { ...longName, hub: { ...longName.hub, groups: [
      { name: "Every one of the systems that the company already runs its business on today", items: itemsOf(["Engine app", "Finance", "HR leave"]) },
      { name: "Your tools", items: itemsOf(["Email", "Slack", "Drive"]) } ] } } as SlideInput;
    if (!/too long for its label/.test(deckWarnings([hopeless]))) fail("a group name that fits nowhere is drawn without a word to the model");

    // The centre: a three-word name over a 120-character caption, and a name
    // whose second line only fits when measured in Playfair's own glyphs.
    const LONG_CAPTION = "A caption that the model wrote far too long, running on past the sixty characters the tool asks for, and well beyond them";
    const longCentre = { ...HUB_SLIDE, hub: { title: "Enterprise Knowledge Platform", caption: LONG_CAPTION, groups: [
      { name: "Left", items: itemsOf(["One", "Two"]) }, { name: "Right", items: itemsOf(["Three", "Four"]) } ] } } as SlideInput;
    const LC = inspect("centre overflow", longCentre, 4);
    const lcWarn = deckWarnings([longCentre]);
    if (!/too long for the circle/.test(lcWarn)) fail("centre overflow: a hub name too long for its circle is not reported");
    if (!LC.shapes["hbs"] && lcWarn.indexOf(LONG_CAPTION.slice(0, 30)) < 0) fail("centre overflow: the caption was left off and nobody was told");
    const opsHub = { ...HUB_SLIDE, hub: { title: "Content Operations Hub", caption: "Briefs in, approved and measured assets out, on one calendar", groups: [
      { name: "Inputs", items: itemsOf(["Briefs", "Research", "Brand guide", "Assets"]) },
      { name: "Outputs", items: itemsOf(["Articles", "Social posts", "Video", "Reports"]) } ] } } as SlideInput;
    const OH = inspect("three-word name", opsHub, 8);
    if (!OH.shapes["hbs"]) fail("three-word name: a 60-character caption that fits under a two-line name was dropped");
    // A two-line name over a three-line caption: the block is tall enough that
    // the name's first line, drawn at 18pt, would reach the circle's edge. The
    // name has to give up a size for the caption.
    inspect("name over a full caption", { ...HUB_SLIDE, hub: { title: "Knowledge Platform",
      caption: "Every system the company already runs, read in one place", groups: [
      { name: "Left", items: itemsOf(["One", "Two"]) }, { name: "Right", items: itemsOf(["Three", "Four"]) } ] } } as SlideInput, 4);

    // THE WIDTHS THEMSELVES, against Chrome's whole-string measurement of
    // Google's own webfonts (2026-09-15; kerning included, margin not). Every
    // assertion above measures with labelWidthPt, so a table or margin that
    // drifted would move the layout and the check together and stay green.
    // The ratio must carry the 6% margin, less the kerning a glyph sum
    // cannot see.
    const MEASURED: [string, number, "Roboto" | "Playfair Display", boolean][] = [
      ["HR Absence Calendar", 9.774, "Roboto", false], ["MS Teams", 4.7702, "Roboto", false],
      ["HubSpot CRM + MS Teams", 12.1418, "Roboto", false], ["CONNECTED SYSTEMS", 10.555, "Roboto", true],
      ["Operations Hub", 7.149, "Playfair Display", false], ["Enterprise Knowledge Platform", 14.116, "Playfair Display", false],
      // Glyphs the faces do not carry, drawn by the fallback at a full em. As
      // the mean capital, "東京オフィス" was 0.68 of its real width and wrapped
      // inside its node; an astral emoji, walked as two UTF-16 units, was
      // counted twice.
      ["東京オフィス", 6.008, "Roboto", false], ["Support ✅", 4.843, "Roboto", false],
      ["Support ✅", 4.879, "Playfair Display", false], ["🚀 Launch Pad", 6.513, "Roboto", false],
      // U+FE0F, the emoji-presentation selector, draws nothing (Chrome: the
      // same 4.843em as without it) and was counted as a mean capital.
      ["Support ✅️", 4.843, "Roboto", false],
    ];
    for (let i = 0; i < MEASURED.length; i++) {
      const [text, ems, face, caps] = MEASURED[i];
      const ratio = labelWidthPt(text, 10, { face, caps }) / (ems * 10);
      if (ratio < 1.04 || ratio > 1.1) fail(`labelWidthPt("${text}", ${face}) is ${ratio.toFixed(3)} x Chrome's measured width — the table or its margin has drifted`);
    }

    // A third group: counted in the admission and named to the model. The
    // audit alone never would — "Partners" is under its eleven-character floor.
    const three = { ...HUB_SLIDE, hub: { title: "EngineAI", groups: [
      { name: "Data", items: itemsOf(["Engine app", "Finance"]) }, { name: "Tools", items: itemsOf(["Email", "Slack"]) },
      { name: "Partners", items: itemsOf(["AuthorityOn", "MeetingBrain"]) } ] } } as SlideInput;
    const T3 = inspect("three groups", three, 4);
    if (T3.texts["hdrop"] !== "Showing 4 of 6 connections") fail(`three groups: the admission reads ${JSON.stringify(T3.texts["hdrop"] || "nothing")}, not "Showing 4 of 6 connections"`);
    if (deckWarnings([three]).indexOf(`"Partners"`) < 0) fail("three groups: the group left off is not named to the model");

    // Icons that did not resolve: a stand-in in the slot (inspect asserts one
    // mark per node and aligned labels), and the names relayed with the fix.
    const RESOLVED = "https://example.com/icon.png";
    const holes = { ...HUB_SLIDE, iconsMissing: ["microsoft", "google-drive"], hub: { title: "EngineAI", groups: [
      { name: "Microsoft", items: [{ title: "Outlook", icon: "mail", resolvedIcon: RESOLVED }, { title: "Teams", icon: "microsoft" }, { title: "SharePoint", icon: "folder", resolvedIcon: RESOLVED }] },
      { name: "Google", items: [{ title: "Gmail", icon: "mail", resolvedIcon: RESOLVED }, { title: "Drive", icon: "google-drive" }, { title: "Calendar", icon: "calendar", resolvedIcon: RESOLVED }] } ] } } as SlideInput;
    inspect("missing icons", holes, 6);
    const standIns = (buildSlideRequests(holes, 0, "h") as any[]).filter((r) => r.createShape && r.createShape.shapeType === "ELLIPSE" && /_hi[lr]\d+$/.test(r.createShape.objectId)).length;
    if (standIns !== 2) fail(`missing icons: ${standIns} stand-in marks for 2 unresolved icons`);
    const holesWarn = deckWarnings([holes]);
    if (holesWarn.indexOf(`"microsoft"`) < 0 || !/plain noun/.test(holesWarn)) fail("missing icons: the unresolved names are not relayed with the fix");
    if (droppedContent(holes, 0).some((d) => /google|microsoft/i.test(d))) fail(`missing icons: a failed icon NAME is reported as dropped text: ${droppedContent(holes, 0).join(" | ")}`);
    // Recorded by resolution itself, fresh on every run, from the hub that is
    // DRAWN. With no blob token resolveIcon answers null without a request,
    // which makes every icon a miss — offline, and deterministic.
    const savedToken = process.env.BLOB_READ_WRITE_TOKEN;
    delete process.env.BLOB_READ_WRITE_TOKEN;
    try {
      const live: any = { layout: "hub", title: "Integrations", groups: [{ name: "Microsoft", items: [
        { title: "Teams", icon: "microsoft" }, { title: "Outlook", icon: "mail" }, { title: "Outlook again", icon: "mail" } ] }] };
      await resolveDeckImages([live]);
      await resolveDeckImages([live]);
      if (JSON.stringify(live.iconsMissing) !== JSON.stringify(["microsoft", "mail"])) {
        fail(`resolution recorded ${JSON.stringify(live.iconsMissing)} for a misplaced hub resolved twice, not ["microsoft","mail"] once each`);
      }
      if (live.hub && live.hub.groups) live.hub.groups[0].items = [{ title: "Teams", icon: "microsoft" }];
      await resolveDeckImages([live]);
      if (JSON.stringify(live.iconsMissing) !== JSON.stringify(["microsoft"])) fail(`a replaced icon is still reported missing after resolving again: ${JSON.stringify(live.iconsMissing)}`);
    } catch (e: any) {
      fail(`resolving a hub's icons threw: ${String((e && e.message) || e).slice(0, 120)}`);
    } finally {
      if (savedToken !== undefined) process.env.BLOB_READ_WRITE_TOKEN = savedToken;
    }

    if (!isVisualSlide(HUB_SLIDE)) fail("the visual audit counts a hub as a text slide");

    // ONE NODE A SIDE. With a single node there is no gap to give way, so the
    // pitch code's "gap under 4pt" was always true and handed the node the
    // whole diagram's height: a 254pt slab from under the title to the footer.
    // Every fixture above had at least two nodes a side, so nothing measured it.
    const lonely: [string, any[], number][] = [
      ["one group of one", [{ name: "Partner", items: itemsOf(["The Content Engine"]) }], 1],
      ["one group of two", [{ name: "Partners", items: itemsOf(["The Content Engine", "AuthorityOn"]) }], 2],
      ["two groups of one", [{ name: "Reads", items: itemsOf(["Engine Content DB"]) }, { name: "Writes", items: itemsOf(["Google Docs"]) }], 2],
    ];
    for (let i = 0; i < lonely.length; i++) {
      const [name, groups, count] = lonely[i];
      const G = inspect(name, { ...HUB_SLIDE, hub: { title: "EngineAI", groups } } as SlideInput, count);
      const nodeKeys = keysWith(G.shapes, "hn");
      for (let j = 0; j < nodeKeys.length; j++) {
        if (G.shapes[nodeKeys[j]].h > 26.01) fail(`${name}: node ${nodeKeys[j].slice(2)} is ${G.shapes[nodeKeys[j]].h.toFixed(0)}pt tall — a node is 26pt at most, whatever room it is given`);
      }
    }

    // NO CENTRE NAME. The incident's own call with a real headline: hub.title
    // is not copied from a headline, so the circle had nothing in it, the
    // caption — already lifted into hub.caption — was not drawn either, and
    // the only note told the model to move that caption to "a field this
    // layout uses". The caption is drawn alone, and the missing NAME is said.
    const HEADLINE: any = { layout: "hub", title: "Everything TCE runs on, in {one place}", caption: "One workspace that reads the systems the team already uses",
      groups: [{ name: "CONNECTED SYSTEMS", tone: "blue", items: itemsOf(["Slack", "Gmail & Calendar", "Google Drive", "Xero Finance"]) }] };
    const HL = inspect("no centre name", HEADLINE as SlideInput, 4);
    if (!HL.shapes["hbs"]) fail("no centre name: a caption that fits the circle was not drawn, so the circle is empty");
    const hlWarn = deckWarnings([HEADLINE]);
    if (!/no centre name/.test(hlWarn) || hlWarn.indexOf("hub.title") < 0) fail(`no centre name: the model is not told the circle lacks hub.title (${hlWarn.slice(-200)})`);
    if (/field this layout uses/.test(hlWarn)) fail("no centre name: the model is told to move text that is already where the layout reads it");

    // A CAPTION TOO LONG FOR ITS CIRCLE is named with its own fix, and not with
    // droppedContent's "put it in a field this layout uses" — it is in that
    // field already, and only needs to be shorter.
    const longCap = { ...HUB_SLIDE, hub: { title: "EngineAI", caption: LONG_CAPTION, groups: [
      { name: "Left", items: itemsOf(["One", "Two"]) }, { name: "Right", items: itemsOf(["Three", "Four"]) } ] } } as SlideInput;
    const LCp = inspect("caption too long", longCap, 4);
    const lcpWarn = deckWarnings([longCap]);
    if (LCp.shapes["hbs"]) fail("caption too long: a 120-character caption was drawn in a circle that cannot hold it — the fixture no longer measures the drop");
    else {
      if (!/caption .* was not drawn/.test(lcpWarn) || !/under about 60 characters/.test(lcpWarn)) fail(`caption too long: the model is not told the caption was left off and how to fix it (${lcpWarn.slice(-240)})`);
      if (/field this layout uses/.test(lcpWarn)) fail("caption too long: the model is told to move a caption that is already in hub.caption");
    }

    // ONE WORD WIDER THAN THE CIRCLE is not "too many words". At 12pt this
    // name ran 23pt past the navy onto the lavender ring, where white type is
    // nearly invisible, under a note calling it "1 line at 12pt". centreHolds
    // (inside inspect) asserts every line inside the disc.
    const german = { ...HUB_SLIDE, hub: { title: "Datenschutzbeauftragter", caption: "Answers to the board", groups: [
      { name: "Left", items: itemsOf(["One", "Two"]) }, { name: "Right", items: itemsOf(["Three", "Four"]) } ] } } as SlideInput;
    const GW = inspect("one word wider than the circle", german, 4);
    if (!GW.shapes["hbt"]) fail("one word wider than the circle: no name drawn — the check measures nothing");
    if (/1 line at 12pt/.test(deckWarnings([german]))) fail("one word wider than the circle: reported as a line count, which reads as if the name were short");

    // A FULL SIDE names what it cut. Labels of ten characters or fewer are
    // invisible to droppedContent, so "Showing 14 of 16" went out with an
    // empty warning.
    const fullSide = (p: string) => itemsOf(["Mail", "Chat", "Docs", "Files", "Sheets", "Tasks", "Wiki", `${p}8 Phone`]);
    const full = { ...HUB_SLIDE, hub: { title: "EngineAI", groups: [
      { name: "Left", items: fullSide("A") }, { name: "Right", items: fullSide("B") } ] } } as SlideInput;
    const FS = inspect("two full sides", full, 14);
    if (FS.texts["hdrop"] !== "Showing 14 of 16 connections") fail(`two full sides: the admission reads ${JSON.stringify(FS.texts["hdrop"] || "nothing")}`);
    const fsWarn = deckWarnings([full]);
    if (fsWarn.indexOf(`"A8 Phone"`) < 0 || fsWarn.indexOf(`"B8 Phone"`) < 0) fail(`two full sides: the connections cut from a full side are not named to the model (${fsWarn.slice(-200)})`);

    const iconDrop = droppedContent({ layout: "cards", title: "Icons", cards: [
      { title: "A card", body: "Body text here.", icon: "calendar-clock" },
      { title: "Another card", body: "More body text.", icon: "layout-dashboard" } ] } as SlideInput, 0);
    if (iconDrop.some((d) => /calendar|dashboard/i.test(d))) fail(`an icon NAME is reported as dropped text: ${iconDrop.join(" | ")}`);
    // The builder's own footer is not the author's text: a cover leaves it off
    // on purpose, and reporting that sent the same false note in two replies.
    const coverDrop = droppedContent({ layout: "cover", title: "AI tools at TCE", subtitle: "Team briefing", footer: "The Content Engine · AI tools at TCE" } as SlideInput, 0);
    if (coverDrop.some((d) => /Content Engine/i.test(d))) fail(`the stamped footer is reported as dropped text on a cover: ${coverDrop.join(" | ")}`);
    // Speaker notes go to the deck's notes page, not the slide. Reported as
    // "never draws — do NOT describe it as being in the deck", every slide
    // with a note was misreported, and the single-slide route now carries them.
    const notesDrop = droppedContent({ layout: "content", title: "Pricing", body: "Two tiers", notes: "Say the second tier is where most clients land" } as SlideInput, 1);
    if (notesDrop.some((d) => /second tier/.test(d))) fail(`speaker notes are reported as text the slide drops: ${notesDrop.join(" | ")}`);
  }
  if (failures === before36) pass("wires start on their nodes and end in the hub, nodes clear the rings and each other, labels and group names hold one line by measured width, the centre fits its circle, a third group and missing icons are declared, a split group is named once over the hub, icon names are not text");

  /* 37. A hub is drawn from wherever its fields landed, on every route.
   *
   * THE INCIDENT, 2026-09-15. The first generate_slides call of a new chat sent
   * a hub slide with its `caption` and `groups` BESIDE the slide's title rather
   * than inside `hub` (the tool schema had never declared `hub`; 20d now pins
   * that). The guard refused it as blank, the refusal reached the user, and the
   * model re-streamed the whole deck to fix one slide. Check 13 of
   * verify-slide-edit.ts pins normaliseSlide itself; this one drives the ROUTES
   * a slide reaches the builder by: the full `slides` call, editSlide's insert,
   * patch and batch, the top-level fold, a stored draft replayed under an
   * unrelated edit, and buildSlideRequests with NO guard in front of it — which
   * is what the preview, PDF and publish routes call on client-held slides.
   *
   * Nodes are counted from the drawn requests. The no-leftover-key assertions
   * are structural, because a lifted caption draws identically whether or not
   * its old copy was deleted: droppedContent cannot tell a clean stored spec
   * from one that will replay the mistake next turn.
   *
   * MUTATION LOG (detached worktree, 2026-09-15), with 20d's schema half and
   * check 13 of verify-slide-edit.ts run alongside:
   *   killed  the guard not normalising (leftover keys; stored hub unrepaired)
   *   killed  buildSlideRequests not read-tolerant (0 of 8 nodes unguarded)
   *   killed  the fold dropping payload fields (top-level insertAfter + hub)
   *   killed  a single insert not normalised; a patch that does not lift
   *   killed  the guard back to presence-only; untitled items counted
   *   killed  `nodes` lifted as a guess; bare strings not mapped; a hub array
   *           not lifted; the refusal not saying INSIDE hub
   *   killed  the visual audit back to raw `items.length`
   *   killed  `delete out.groups` removed; the lifted caption's delete removed
   *   20d killed  editSlide.hub back to a bare object; insertSlides.items back
   *           to a bare object; `hub` renamed out of the slide item schema
   *           (the original misplacement); the hub description losing INSIDE
   *   SURVIVED here, killed by check 13 (verify-slide-edit.ts): the identical-
   *           caption delete removed, `delete work.items` / `delete out.items`
   *           removed, a patch replacing rather than merging the stored hub, a
   *           headline copied into the circle, the non-hub early return
   *           removed, batch entries not normalised in applyEditSlide. Each
   *           is either invisible in the drawing or repaired downstream by the
   *           guard, which is why the pure check exists beside this one.
   *   Before the change, 20d's old regex PASSED against the misplaced schema:
   *   the whole suite was green at c5759aa with no `hub` on slides[].
   *
   * SECOND MUTATION LOG (detached worktree, 2026-09-15), for (h) and (i), after
   * a verifier drove a layout-less hub through every route and found only the
   * insert paths drew it:
   *   killed  N1 normaliseSlide not setting layout "hub": through slides[]
   *           stored as undefined and drawing 0 of 8, and the same on the
   *           preview, the visual audit and publish resolution (12 FAILs)
   *   killed  N2 buildSlideRequests not normalising on its FIRST line (the
   *           read-tolerance used to sit in the hub branch, which a layout-
   *           less hub never reaches): 0 of 8 nodes unguarded
   *   killed  N3 resolveDeckImages normalising after it settles the layout:
   *           "settled as content, drawing 0 of 8" (and 36's icon record)
   *   killed  N4 the visual audit counting a hub stored on a content slide
   *   killed  N6 slideStyle reading the raw layout: a layout-less hub as slide
   *           1 styled as the dark cover. Otherwise unobservable — the hub and
   *           content styles are identical — which is why the case is slide 1.
   *   killed  P1 an explicit `hub` patch replacing the stored hub: (i) threw
   *           "would be drawn blank" through the real route */
  const before37 = failures;
  console.log(`\n37. A hub is drawn from wherever its fields landed, and one that draws nothing is refused`);
  {
    const CAP = "One workspace that reads the systems the team already uses";
    const ITEMS = [
      { title: "Slack", icon: "message-square" }, { title: "Gmail & Calendar", icon: "mail" },
      { title: "Google Drive", icon: "folder" }, { title: "Xero Finance", icon: "credit-card" },
      { title: "HubSpot CRM", icon: "users" }, { title: "MeetingBrain", icon: "mic" },
      { title: "HR Absence Calendar", icon: "calendar" }, { title: "AuthorityOn AI Data", icon: "database" },
    ];
    const GROUP = () => ({ name: "CONNECTED SYSTEMS", tone: "blue", items: ITEMS.map((it) => ({ ...it })) });
    const flatHub = (): any => ({ layout: "hub", title: "EngineAI", caption: CAP, groups: [GROUP()] });
    const own = (o: any, k: string) => !!o && Object.prototype.hasOwnProperty.call(o, k);
    const drawnOf = (slide: any, index: number) => buildSlideRequests(slide, index, "h37") as any[];
    const nodesDrawn = (slide: any, index: number) =>
      drawnOf(slide, index).filter((r) => r.createShape && /_hn[lr]\d+$/.test(r.createShape.objectId)).length;
    const circleDrawn = (slide: any, index: number) =>
      drawnOf(slide, index).some((r) => r.createShape && /_hbc$/.test(r.createShape.objectId));
    const refusal = async (fn: () => Promise<any>) => {
      try { await fn(); return ""; } catch (e: any) { return String((e && e.message) || e || "threw"); }
    };
    const cover = { layout: "cover", title: "Deck" };
    const convId = (tag: string) => `verify37-${tag}-${process.pid}-${Date.now()}`;
    // Wrapped, as 20e is: the defect THROWS, and an escaped exception kills the
    // script before it prints anything.
    try {
      // a) The incident's call, through the full `slides` route.
      const built = await prepareSlidesForBuild({ title: "T", slides: [cover, flatHub()] }, null);
      const s = built.slides[1];
      if (own(s, "groups") || own(s, "caption")) fail(`the stored hub keeps its misplaced keys (${Object.keys(s).join(", ")}) — the next turn replays the mistake`);
      if (!circleDrawn(s, 1) || nodesDrawn(s, 1) !== 8) fail(`the incident's hub draws circle=${circleDrawn(s, 1)} and ${nodesDrawn(s, 1)} of 8 nodes`);
      const lost = droppedContent(s, 1);
      if (lost.length) fail(`the repaired incident slide reports dropped text: ${lost.join(" | ").slice(0, 160)}`);

      // b) The other misplaced shapes: each draws every node it carries.
      const shapes: [string, any, number][] = [
        ["hub.items with no groups", { layout: "hub", title: "Our integrations today", hub: { title: "EngineAI", caption: CAP, items: ITEMS } }, 8],
        ["hub sent as an array of groups", { layout: "hub", title: "EngineAI", hub: [GROUP()] }, 8],
        ["items as bare strings", { layout: "hub", title: "EngineAI", hub: { title: "EngineAI", groups: [{ name: "X", items: ["Slack", "Xero Finance", "Email", "HubSpot CRM"] }] } }, 4],
        ["items at the top level", { layout: "hub", title: "EngineAI", items: ITEMS }, 8],
      ];
      for (let i = 0; i < shapes.length; i++) {
        const [name, shape, want] = shapes[i];
        const why = await refusal(() => prepareSlidesForBuild({ title: "T", slides: [cover, shape] }, null));
        if (why) { fail(`${name}: refused — ${why.slice(0, 100)}`); continue; }
        const b = await prepareSlidesForBuild({ title: "T", slides: [cover, shape] }, null);
        if (nodesDrawn(b.slides[1], 1) !== want) fail(`${name}: draws ${nodesDrawn(b.slides[1], 1)} of ${want} nodes`);
      }

      // c) What is not repaired is refused, and the refusal names the shape.
      const guesses: [string, any][] = [
        ["`nodes` in place of groups", { layout: "hub", title: "EngineAI", hub: { title: "EngineAI", nodes: ITEMS } }],
        ["`connections` in place of groups", { layout: "hub", title: "EngineAI", hub: { title: "EngineAI", connections: [GROUP()] } }],
        ["a hub with only a title", { layout: "hub", title: "EngineAI", hub: { title: "EngineAI" } }],
      ];
      for (let i = 0; i < guesses.length; i++) {
        const [name, shape] = guesses[i];
        const why = await refusal(() => prepareSlidesForBuild({ title: "T", slides: [cover, shape] }, null));
        if (!why) fail(`${name}: accepted, and drawn as a hub with nothing wired to it`);
        else if (!/groups/.test(why) || !/INSIDE hub/.test(why)) fail(`${name}: refused without naming the shape: ${why.slice(0, 140)}`);
      }

      // d) The edit routes, against a deck held for this conversation.
      const conv = convId("edit");
      await prepareSlidesForBuild({ title: "T", slides: [cover, { layout: "content", title: "Two", body: "x" }] }, conv);
      const inserted = await prepareSlidesForBuild({ slides: [], editSlide: { insertAfter: 2, layout: "hub", title: "EngineAI", caption: CAP, groups: [GROUP()] } }, conv);
      if (nodesDrawn(inserted.slides[2], 2) !== 8) fail(`editSlide insert with groups beside the title draws ${nodesDrawn(inserted.slides[2], 2)} of 8 nodes`);
      const patched = await prepareSlidesForBuild({ slides: [], editSlide: { slideNumber: 2, layout: "hub", groups: [GROUP()] } }, conv);
      if (patched.slides[1].layout !== "hub" || nodesDrawn(patched.slides[1], 1) !== 8) fail(`editSlide patch with groups beside the slide number draws ${nodesDrawn(patched.slides[1], 1)} of 8 nodes`);
      const folded = await prepareSlidesForBuild({ slides: [], insertAfter: 3, layout: "hub", slideTitle: "EngineAI", hub: { title: "EngineAI", groups: [GROUP()] } } as any, conv);
      if (nodesDrawn(folded.slides[3], 3) !== 8) fail(`a top-level insertAfter with its hub beside it draws ${nodesDrawn(folded.slides[3], 3)} of 8 nodes — the fold left the payload behind`);
      const foldedFlat = await prepareSlidesForBuild({ slides: [], insertAfter: 4, layout: "hub", slideTitle: "EngineAI", caption: CAP, groups: [GROUP()] } as any, conv);
      if (nodesDrawn(foldedFlat.slides[4], 4) !== 8 || foldedFlat.slides[4].hub.caption !== CAP) fail("a top-level insertAfter with groups and caption at the top level was not carried into the hub");
      const batch = await prepareSlidesForBuild({ slides: [], editSlide: { insertAfter: 5, insertSlides: [flatHub()] } }, conv);
      const bs = batch.slides[5];
      if (own(bs, "groups") || own(bs, "caption") || nodesDrawn(bs, 5) !== 8) fail(`an insertSlides entry in the incident's shape: keys ${Object.keys(bs).join(",")}, ${nodesDrawn(bs, 5)} of 8 nodes`);

      // e) A stored draft with the misplaced shape does not lock out an
      //    unrelated edit. The turn cache holds the very array a build returns,
      //    so writing the old shape into it stands in for a draft stored before
      //    the guard normalised, which is what loadDeckForEdit reads back.
      const stored = convId("stored");
      const seeded = await prepareSlidesForBuild({ title: "T", slides: [cover, { layout: "content", title: "Two", body: "x" }] }, stored);
      seeded.slides[1] = flatHub();
      const why = await refusal(() => prepareSlidesForBuild({ slides: [], editSlide: { slideNumber: 1, title: "Renamed" } }, stored));
      if (why) fail(`an unrelated edit over a stored misplaced hub is refused: ${why.slice(0, 120)}`);
      else {
        const renamed = await prepareSlidesForBuild({ slides: [], editSlide: { slideNumber: 1, title: "Renamed again" } }, stored);
        const r = renamed.slides[1];
        if (renamed.slides[0].title !== "Renamed again") fail("the unrelated edit was not applied");
        if (own(r, "groups") || own(r, "caption") || nodesDrawn(r, 1) !== 8) fail(`the stored hub was not repaired on the way through (keys ${Object.keys(r).join(",")}, ${nodesDrawn(r, 1)} of 8 nodes — if 0, the stored shape was never seeded)`);
      }

      // f) No guard at all: the preview, PDF and publish routes.
      const raw = flatHub();
      const rawBefore = JSON.stringify(raw);
      if (!circleDrawn(raw, 1) || nodesDrawn(raw, 1) !== 8) fail(`buildSlideRequests on an unguarded misplaced hub draws circle=${circleDrawn(raw, 1)} and ${nodesDrawn(raw, 1)} of 8 nodes — the preview would disagree with the chat`);
      if (!drawnOf(raw, 1).some((r) => r.insertText && /_hbt$/.test(r.insertText.objectId) && r.insertText.text === "EngineAI")) fail("the unguarded hub draws no centre name");
      if (JSON.stringify(raw) !== rawBefore) fail("buildSlideRequests mutated the client-held slide while reading it");
      if (droppedContent(raw, 1).length) fail(`an unguarded misplaced hub reports its own caption or labels as dropped: ${droppedContent(raw, 1).join(" | ").slice(0, 120)}`);
      const pv: any = draftPreview([cover as SlideInput, raw]);
      const pvTexts = ((pv.preview.slides[1] && pv.preview.slides[1].elements) || []).map((e: any) => e.text || "");
      if (pvTexts.indexOf("HR Absence Calendar") < 0) fail("the preview route draws no node label for an unguarded misplaced hub");

      // g) The visual audit asks the same question the guard does.
      if (isVisualSlide({ layout: "hub", title: "EngineAI", hub: { groups: [{ items: [{ name: "Slack" } as any] }] } } as SlideInput)) {
        fail("the visual audit counts a hub whose items have no titles, which draws no node");
      }
      if (!isVisualSlide(raw)) fail("the visual audit does not count a misplaced-field hub the builder does draw");

      // h) NO LAYOUT AT ALL. The insert paths defaulted a layout-less slide
      //    with connections to a hub, while the full `slides` route, the
      //    guard's scan, the builder and publish resolution all called it
      //    "content": the same slide drew eight nodes appended through
      //    insertSlides and a title with no diagram sent in `slides` or rebuilt
      //    by the preview, PDF or publish route — while the visual audit
      //    counted it as visual. Every route is driven, because each decided
      //    the layout in its own place.
      const bareShapes: [string, any][] = [
        ["groups at the top and no layout", { title: "EngineAI", caption: CAP, groups: [GROUP()] }],
        ["a nested hub and no layout", { title: "Everything we connect", hub: { title: "EngineAI", caption: CAP, groups: [GROUP()] } }],
      ];
      const copy = (x: any) => JSON.parse(JSON.stringify(x));
      for (let i = 0; i < bareShapes.length; i++) {
        const [name, shape] = bareShapes[i];
        const viaSlides = await prepareSlidesForBuild({ title: "T", slides: [copy(cover), copy(shape)] }, null);
        if (viaSlides.slides[1].layout !== "hub" || nodesDrawn(viaSlides.slides[1], 1) !== 8) fail(`${name}, through slides[]: stored as "${viaSlides.slides[1].layout}", drawing ${nodesDrawn(viaSlides.slides[1], 1)} of 8 nodes`);
        const unguarded = copy(shape);
        if (nodesDrawn(unguarded, 1) !== 8) fail(`${name}, with no guard (preview, PDF, publish): ${nodesDrawn(unguarded, 1)} of 8 nodes`);
        const pvBare: any = draftPreview([copy(cover) as SlideInput, unguarded]);
        const bareTexts = ((pvBare.preview.slides[1] && pvBare.preview.slides[1].elements) || []).map((e: any) => e.text || "");
        if (bareTexts.indexOf("HR Absence Calendar") < 0) fail(`${name}: the preview route draws no node label`);
        if (!isVisualSlide(unguarded)) fail(`${name}: the visual audit does not count a hub the builder draws`);
        // As the FIRST slide, where the default is the dark cover: the ground
        // is read through slideStyle, which must see the same hub.
        if (slideStyle(copy(shape), 0).onDark) fail(`${name}, as slide 1: styled as a dark cover while it is drawn as a hub on the light ground`);
        // Publish resolution writes the layout onto the slide for good, so it
        // must reach "hub" before it settles anything.
        const savedBlob = process.env.BLOB_READ_WRITE_TOKEN;
        delete process.env.BLOB_READ_WRITE_TOKEN;
        try {
          const pub: any[] = [copy(cover), copy(shape)];
          await resolveDeckImages(pub);
          if (pub[1].layout !== "hub" || nodesDrawn(pub[1], 1) !== 8) fail(`${name}, publish resolution: settled as "${pub[1].layout}", drawing ${nodesDrawn(pub[1], 1)} of 8 nodes`);
        } finally {
          if (savedBlob !== undefined) process.env.BLOB_READ_WRITE_TOKEN = savedBlob;
        }
      }
      // The other direction: a hub stored on a slide that says "content" is
      // not drawn, and is not a diagram to the audit; and a layout-less hub
      // that draws nothing is not turned into a lone circle.
      if (isVisualSlide({ layout: "content", title: "Prose", body: "A line", hub: { title: "EngineAI", groups: [GROUP()] } } as SlideInput)) fail("the visual audit counts a hub stored on a content slide, which draws no diagram");
      const hollowBare = { title: "Prose", body: "A line", hub: { title: "EngineAI" } };
      if (circleDrawn(hollowBare, 1)) fail("a layout-less slide whose hub draws nothing was drawn as a lone circle");

      // i) A patch in the shape the schema asks for, through the real route:
      //    `hub: { caption }` keeps the stored name and connections.
      const nameBefore = patched.slides[1].hub && patched.slides[1].hub.title;
      const recap = await prepareSlidesForBuild({ slides: [], editSlide: { slideNumber: 2, hub: { caption: "Reads what the team already uses" } } }, conv);
      if (recap.slides[1].hub.caption !== "Reads what the team already uses" || nodesDrawn(recap.slides[1], 1) !== 8 || !nameBefore || recap.slides[1].hub.title !== nameBefore) {
        fail(`a hub: { caption } patch lost the stored hub (${JSON.stringify(recap.slides[1].hub).slice(0, 100)}, ${nodesDrawn(recap.slides[1], 1)} nodes)`);
      }
    } catch (e: any) {
      fail(`a hub route threw: ${String((e && e.message) || e).slice(0, 160)}`);
    }
  }
  if (failures === before37) pass("the incident's hub builds with 8 nodes and no leftover keys on every route, guesses are refused naming the shape, a stored misplaced hub no longer blocks other edits, and the unguarded preview draws the same hub");

  /* 38. A refusal is for the model, and a turn that ends refused says so.
   *
   * THE INCIDENT, 2026-09-15. The first call of a new deck was refused for its
   * shape. All four chains forwarded the thrown message to the browser as
   * `slides_error`, and ChatPanel toasted it, so the user read "Fix and send
   * again — do NOT tell the user the slide is done" while the model retried and
   * the deck built. The toast was built for Google connection failures; the
   * model-directed refusals arrived later and fell into it by accident.
   *
   * What is asserted, behaviour first and then wiring, because a regex that a
   * line EXISTS has reported a live hole here as closed:
   *   a) the guard's refusals are SlideCallRefusals carrying the slide for a
   *      person — with a shape normaliseSlide deliberately refuses, because the
   *      incident's own flat hub now BUILDS;
   *   b) slidesFailure sends a refusal to the model only, and any other fault
   *      to the user as a fixed sentence — including a SyntaxError and an Error
   *      carrying the incident's exact model text, which is what a refusal
   *      thrown as the wrong class would look like;
   *   c) a cut-off OpenAI-style call is a refusal, not a raw parse error;
   *   d) unresolvedSlidesNotice speaks only when the LAST outcome was a
   *      refusal, names the slide, and says "not added" for an append;
   *   e) the release key: the loop guard releases nothing under another
   *      chain's key shape, which is why each chain releases with its own;
   *   f) providers.ts USES all of it in all four chains;
   *   g) ChatPanel handles the event the helper actually emits, and takes a
   *      failure toast down when a deck arrives;
   *   h) and all of it BEHAVES: the real createStreamingResponse, per chain,
   *      against a fake provider on localhost, asserting the events sent and
   *      the reply saved for seven turns — refused then text, refused then
   *      built, built then a refused append, a cut-off call, built then a
   *      refused rebuild, refused then a failed publish, and a fault retried.
   *      (f) and (g) read comment-stripped source; (h) is what a source read
   *      cannot fake.
   *
   * MUTATION LOG (detached worktree, 2026-09-15), 38 mutations, check 14 of
   * verify-slide-edit.ts run alongside for those in lib/slides/edit.ts:
   *   killed  the guard's blank-slide refusal as a plain Error (the incident's
   *          own throw); the empty-deck and no-deck refusals likewise
   *   killed  the guard's refusal carrying no faults; the edit-path guard
   *          always scoped "edit" (killed only by the stored-deck lockout case,
   *          added because nothing else reaches that scope)
   *   killed  one chain's catch back to `slides_error: err.message` (xAI); the
   *          Anthropic tool result back to the raw message
   *   killed  xAI releasing with another chain's key; Gemini releasing a
   *          refusal (ungated); Anthropic never releasing a fault
   *   killed  the OpenAI chain not marking a draft ok; Anthropic marking ok
   *          BEFORE the call could be refused (caught by the count of two)
   *   killed  Gemini parsing arguments with JSON.parse again
   *   killed  the Gemini end-of-turn notice not called; the Anthropic notice
   *          appended to the reply but never streamed
   *   killed  the notice speaking on any last outcome; the append wording
   *          lost; the notice naming no slide
   *   killed  a refusal sent to the toast again (also by g: the refusal branch
   *          then has no event of its own); a fault showing its raw message;
   *          a refusal, or a fault, not recorded on the turn; `null` arguments
   *          accepted; the refusal text losing "do not narrate"
   *   killed  ChatPanel: slides_ready or slides_draft not dismissing the toast;
   *          no slides_refused branch; that branch toasting, or leaving the
   *          progress indicator up; the toast id not kept
   *   killed  from edit.ts: the batch refusal as a plain Error, its scope lost,
   *          its fault numbered in the batch, blankSlideFaults empty, and the
   *          scan's person reason written with a backticked field name
   *          (SURVIVED check 14, which only counts those faults)
   *   SURVIVED the remove-all refusal as a plain Error — no removal is driven
   *          here; check 14 kills it
   *   SURVIVED Object.setPrototypeOf removed (both checks): native classes
   *          under tsx keep instanceof without it
   *   A FINDING, not a kill: isSlideCallRefusal answering true for everything
   *          first "killed" this block only through its try/catch, because
   *          slidesFailure threw reading `err.faults.slice()` — a throw inside a
   *          chain's catch block, which escapes the turn. slidesFailure now
   *          reads faults defensively; re-run, it is killed by assertion (every
   *          real fault goes silent).
   *
   * SECOND MUTATION LOG (detached worktree, 2026-09-15). A verifier showed six
   * plausible mutations SURVIVING this check, all of which the log above could
   * not have seen because it read source: MA an ok mark commented out, MB and
   * MJ ChatPanel calls commented out, MC the events loop sent only on faults,
   * MD a publish failure never recorded, MK the turn state reset after it was
   * written. Two of them broke what the user sees. Now:
   *   killed  MA by (f) once comments are stripped, and by (h): Gemini, refused
   *           then built, still says it was not built
   *   killed  MB, MJ by (g) once comments are stripped
   *   killed  MC by (f) — the loop must be a statement of its own — and by (h):
   *           Gemini sends no slides_refused on any refused turn
   *   killed  MD by (h) only: the xAI chain appends a notice about a refusal
   *           after the publish failure the user was already shown
   *   killed  MK by (f), which counts `.slidesTurn =`, and by (h): the OpenAI
   *           chain's refused turns end with no notice
   *   killed  W1 the xAI release under the raw arguments string, by (f) and by
   *           (h) — but only once the retried call is PRETTY-PRINTED: the xAI
   *           key strips whitespace, and with compact JSON it equalled the raw
   *           string, so the wrong key released and (h) passed
   *   killed  W4 an ok mark followed by a "failed" one (OpenAI draft), by (h)
   *           only — the source read counts marks and places, and both held
   *   killed  W2 builtEarlier not carried forward; W3 the notice ignoring it —
   *           by (d) and by (h) on three chains
   *   killed  T1 the guard's text step removed; T4 bullet lists not joined; T5
   *           a batch entry not repaired; T3 a batch entry's bad field not
   *           named by the batch (a survivor until (a) asserted the words, the
   *           guard's scan refusing the same slide by deck number)
   * A FINDING. T1 also turned the ANTHROPIC chain's "fault, then the identical
   *   call" red: the retry was refused as a repeat. The loop guard keys a call
   *   by serialising its input when asked, the Anthropic chain releases with
   *   `tool.input`, and the build writes onto the slides it is handed (the
   *   footer, the settled layout) — so without the text step's copy the release
   *   key had moved. It had been working by accident. prepareSlidesForBuild
   *   now deep-copies its argument: D2 (copy and text step both removed) is
   *   killed the same way; D1 (the copy alone removed) SURVIVES offline,
   *   because nothing nested is written without the network — it is there for
   *   icons resolved online, onto items shared with the call. */
  const before38 = failures;
  console.log(`\n38. A refusal reaches only the model, and a turn that ends refused says so`);
  {
    const MARKERS = /do NOT|generate_slides|editSlide|insertSlides|Fix and send|`/;
    const INCIDENT_TEXT = 'This deck contains 1 slide that would be drawn blank. slide 4 ("EngineAI") is a "hub" slide with no connections to draw. Fix and send again — do NOT tell the user the slide is done.';
    const NODES_HUB = (): any => ({ layout: "hub", title: "EngineAI", hub: { title: "EngineAI", nodes: [{ title: "Slack" }, { title: "Xero" }] } });
    const cover = { layout: "cover", title: "Deck" };
    const caught = async (fn: () => Promise<any>): Promise<any> => {
      try { await fn(); return null; } catch (e: any) { return e; }
    };
    const isRefusal = (e: any) => e instanceof SlideCallRefusal;
    try {
      // a) The guard.
      const hubErr = await caught(() => prepareSlidesForBuild({ title: "T", slides: [cover, NODES_HUB()] }, null));
      if (!isRefusal(hubErr)) fail(`a hub of \`nodes\` is refused as a plain ${hubErr ? hubErr.name : "nothing (it built)"} — its model text would reach the toast`);
      else {
        if (hubErr.scope !== "build") fail(`the full-deck refusal's scope is ${hubErr.scope}`);
        const f = hubErr.faults || [];
        if (f.length !== 1 || f[0].slide !== 2 || f[0].title !== "EngineAI" || f[0].layout !== "hub") fail(`the guard's refusal does not name slide 2 ("EngineAI", hub) for a person: ${JSON.stringify(f)}`);
        if (!/blank/.test(hubErr.message)) fail("the guard's model message lost the word the model acts on");
      }
      const cardsErr = await caught(() => prepareSlidesForBuild({ title: "T", slides: [cover, { layout: "cards", title: "What strategy-lite actually covers" }] }, null));
      if (!isRefusal(cardsErr) || !cardsErr.faults.length || cardsErr.faults[0].layout !== "cards") fail(`a cards slide with no cards is not a structured refusal (${cardsErr && cardsErr.name}: ${JSON.stringify(cardsErr && cardsErr.faults)})`);
      // What the Anthropic chain makes of a call it could not parse.
      const emptyErr = await caught(() => prepareSlidesForBuild({}, null));
      if (!isRefusal(emptyErr) || !/cut off/.test(String(emptyErr.userReason))) fail(`an unparseable Anthropic call (input {}) is not a refusal that says it was probably cut off (${emptyErr && emptyErr.name}: ${emptyErr && emptyErr.userReason})`);
      const noDeckErr = await caught(() => prepareSlidesForBuild({ slides: [], editSlide: { insertAfter: 0, title: "Orphan", body: "b" } }, null));
      if (!isRefusal(noDeckErr) || String(noDeckErr.message).indexOf("no deck") < 0) fail(`an edit with no deck is not a refusal (${noDeckErr && noDeckErr.name})`);
      const conv = `verify38-${process.pid}-${Date.now()}`;
      await prepareSlidesForBuild({ title: "T", slides: [cover, { layout: "content", title: "Two", body: "x" }] }, conv);
      const appendErr = await caught(() => prepareSlidesForBuild({ slides: [], editSlide: { insertAfter: 2, insertSlides: [{ layout: "content", title: "Three", body: "y" }, NODES_HUB()] } }, conv));
      if (!isRefusal(appendErr) || appendErr.scope !== "insert") fail(`a refused append is not a refusal scoped as an insert (${appendErr && appendErr.name}, ${appendErr && appendErr.scope})`);
      const patchErr = await caught(() => prepareSlidesForBuild({ slides: [], editSlide: { slideNumber: 2, layout: "hub", title: "Two" } }, conv));
      if (!isRefusal(patchErr) || patchErr.scope !== "edit") fail(`a patch refused by the guard is not scoped as an edit (${patchErr && patchErr.name}, ${patchErr && patchErr.scope})`);
      // An append the GUARD refuses, because a slide already stored draws
      // nothing. applyEditSlide scopes its own refusals; this one is scoped by
      // prepareSlidesForBuild, and it is the stored-deck lockout case: the new
      // slides are fine and it is they that are not added.
      const lockConv = `verify38-lock-${process.pid}-${Date.now()}`;
      const seeded = await prepareSlidesForBuild({ title: "T", slides: [cover, { layout: "content", title: "Two", body: "x" }] }, lockConv);
      seeded.slides[1] = NODES_HUB();
      const lockErr = await caught(() => prepareSlidesForBuild({ slides: [], editSlide: { insertAfter: 2, insertSlides: [{ layout: "content", title: "Three", body: "y" }] } }, lockConv));
      if (!isRefusal(lockErr) || lockErr.scope !== "insert" || !lockErr.faults.length || lockErr.faults[0].slide !== 2) fail(`an append refused by the guard over a stored blank hub is not scoped as an insert naming slide 2 (${lockErr && lockErr.name}, ${lockErr && lockErr.scope}, ${JSON.stringify(lockErr && lockErr.faults)})`);
      else if (!/not added/.test(unresolvedSlidesNotice((() => { const t: SlidesTurnState = {}; slidesFailure(lockErr, t); return t; })()))) fail("the stored-deck lockout is not reported as slides not added");

      // TEXT WHERE TEXT BELONGS. A `null` slide, a title sent as an object and
      // `imageQuery: 5` each threw a TypeError deeper in, which is a FAULT: the
      // user was toasted "an internal error" for a call the model could resend,
      // and the released signature let the identical retry toast again. They
      // are refusals naming the slide; a list of bullets and a number are
      // simply repaired, because their intent is plain.
      const nullSlideErr = await caught(() => prepareSlidesForBuild({ title: "T", slides: [cover, null] }, null));
      if (!isRefusal(nullSlideErr) || !nullSlideErr.faults.length || nullSlideErr.faults[0].slide !== 2) fail(`a null slide is not a refusal naming slide 2 (${nullSlideErr && nullSlideErr.name}: ${String(nullSlideErr && nullSlideErr.message).slice(0, 80)})`);
      const objTitleErr = await caught(() => prepareSlidesForBuild({ title: "T", slides: [cover, { layout: "content", title: { text: "Q3" }, body: "y" }] }, null));
      if (!isRefusal(objTitleErr) || String(objTitleErr.message).indexOf("`title`") < 0) fail(`a title sent as an object is not a refusal naming \`title\` (${objTitleErr && objTitleErr.name}: ${String(objTitleErr && objTitleErr.message).slice(0, 80)})`);
      const repairedErr = await caught(() => prepareSlidesForBuild({ title: "T", slides: [cover, { layout: "content", title: 42, body: ["First point", "Second point"] }] }, null));
      if (repairedErr) fail(`a numeric title and a list of bullets were refused rather than repaired: ${String(repairedErr.message).slice(0, 80)}`);
      else {
        const repaired = await prepareSlidesForBuild({ title: "T", slides: [cover, { layout: "content", title: 42, body: ["First point", "Second point"] }] }, null);
        if (repaired.slides[1].title !== "42" || repaired.slides[1].body !== "First point\nSecond point") fail(`a numeric title and a list of bullets were not repaired to text (${JSON.stringify(repaired.slides[1]).slice(0, 100)})`);
      }
      const queryErr = await caught(() => prepareSlidesForBuild({ slides: [], editSlide: { slideNumber: 2, imageQuery: 5 } }, conv));
      if (!isRefusal(queryErr) || queryErr.scope !== "edit") fail(`an imageQuery sent as a number is not a refusal scoped as an edit (${queryErr && queryErr.name}: ${String(queryErr && queryErr.message).slice(0, 80)})`);
      const batchTextErr = await caught(() => prepareSlidesForBuild({ slides: [], editSlide: { insertAfter: 2, insertSlides: [{ layout: "content", title: ["not", { a: 1 }], body: "b" }] } }, conv));
      if (!isRefusal(batchTextErr) || batchTextErr.scope !== "insert" || !batchTextErr.faults.length || batchTextErr.faults[0].slide !== 3) fail(`an appended slide whose title is not text is not a refusal naming slide 3 (${batchTextErr && batchTextErr.name}: ${JSON.stringify(batchTextErr && batchTextErr.faults)})`);
      // ...and told to the model by its place in the BATCH it sent, which is
      // the list the model can find it in. (The guard's scan behind this would
      // refuse the same slide by its deck number, so only the words differ.)
      else if (String(batchTextErr.message).indexOf("slide 1 of the batch") < 0) fail(`the batch refusal does not name the entry the model sent: ${String(batchTextErr.message).slice(0, 120)}`);
      // A batch entry is REPAIRED like a slide in `slides`, before it is
      // judged: a numeric title and a list of bullets were otherwise read as
      // "no title or body" and refused.
      const batchRepairErr = await caught(() => prepareSlidesForBuild({ slides: [], editSlide: { insertAfter: 2, insertSlides: [{ layout: "content", title: 2027, body: ["First", "Second"] }] } }, conv));
      if (batchRepairErr) fail(`an appended slide with a numeric title and a list of bullets was refused rather than repaired: ${String(batchRepairErr.message).slice(0, 100)}`);

      // b) slidesFailure, for a refusal.
      if (isRefusal(hubErr)) {
        const turn: SlidesTurnState = {};
        const r = slidesFailure(hubErr, turn);
        const toUser = r.events.filter((ev) => ev.slides_error !== undefined || ev.token !== undefined || ev.error !== undefined);
        if (!r.refused || toUser.length) fail(`a refusal sends the user ${JSON.stringify(toUser)}`);
        if (r.events.length !== 1 || Object.keys(r.events[0]).length !== 1) fail(`a refusal should send exactly one non-text event to clear the indicator, sent ${JSON.stringify(r.events)}`);
        if (!/^REFUSED — nothing was built or changed, and the user has not been shown this\./.test(r.toolText) || r.toolText.indexOf(hubErr.message) < 0) fail(`the model is not told the call was refused with the reason: ${r.toolText.slice(0, 120)}`);
        if (!/do not narrate the fix to the user/.test(r.toolText)) fail("the model is not told to keep the fix to itself");
        if (!turn.lastOutcome || turn.lastOutcome.kind !== "refused") fail(`a refusal is not recorded on the turn (${JSON.stringify(turn.lastOutcome)})`);
      }
      // ...and for everything else.
      const faults: any[] = [
        new Error("boom"),
        new TypeError("Cannot read properties of undefined (reading 'slides')"),
        new SyntaxError("Unexpected end of JSON input"),
        new Error(INCIDENT_TEXT),
        new Error("Pass `hub` with editSlide: { insertSlides } and call generate_slides again"),
        "a thrown string",
      ];
      for (let i = 0; i < faults.length; i++) {
        const turn: SlidesTurnState = { lastOutcome: { kind: "refused", faults: [] } };
        const r = slidesFailure(faults[i], turn);
        const shown = r.events.map((ev) => String(ev.slides_error == null ? "" : ev.slides_error));
        const label = String((faults[i] && faults[i].name) || typeof faults[i]);
        if (r.refused || shown.length !== 1 || !shown[0]) { fail(`${label}: a real fault does not show the user one failure message (${JSON.stringify(r.events)})`); continue; }
        if (MARKERS.test(shown[0])) fail(`${label}: the user is shown model-directed text: ${shown[0]}`);
        const raw = String((faults[i] && faults[i].message) || faults[i]);
        if (shown[0].indexOf(raw) >= 0) fail(`${label}: the user is shown the raw message`);
        if (r.toolText.indexOf(raw) < 0 || !/do NOT tell them the deck is done/i.test(r.toolText)) fail(`${label}: the model is not given the raw fault and told not to claim success`);
        if (!turn.lastOutcome || turn.lastOutcome.kind !== "failed") fail(`${label}: a fault after a refusal leaves the turn at ${JSON.stringify(turn.lastOutcome)}`);
      }
      if (MARKERS.test(SLIDES_FAILED_FOR_USER)) fail("the fixed failure sentence itself is written for the model");

      // c) A cut-off OpenAI-style call.
      const cut = '{"title":"Q3 review","slides":[{"layout":"cover","title":"Q3';
      let parseErr: any = null;
      try { parseSlidesArguments(cut); } catch (e: any) { parseErr = e; }
      if (!isRefusal(parseErr)) fail(`truncated arguments throw a plain ${parseErr ? parseErr.name : "nothing"} — a raw SyntaxError reaches the toast`);
      else {
        if (!/smaller batch/.test(parseErr.message)) fail("the parse refusal does not tell the model to resend in a smaller batch");
        if (slidesFailure(parseErr, {}).events.some((ev) => ev.slides_error !== undefined)) fail("a cut-off call still produces a user toast");
      }
      let nullErr: any = null;
      try { parseSlidesArguments("null"); } catch (e: any) { nullErr = e; }
      if (!isRefusal(nullErr)) fail("arguments of `null` are accepted, and the chain would then read `.publish` off null");
      const good = parseSlidesArguments('{"slides":[{"layout":"cover","title":"A"}]}');
      if (!good || !Array.isArray(good.slides) || good.slides.length !== 1) fail("valid arguments do not parse");

      // d) The end-of-turn notice.
      if (isRefusal(hubErr)) {
        const refused: SlidesTurnState = {};
        slidesFailure(hubErr, refused);
        const n = unresolvedSlidesNotice(refused);
        if (!n) fail("a turn that ends refused says nothing");
        else {
          if (n.indexOf("slide 2") < 0 || n.indexOf("EngineAI") < 0) fail(`the notice does not name the refused slide: ${n}`);
          if (MARKERS.test(n)) fail(`the notice carries model-directed text: ${n}`);
          if (!/not built/.test(n)) fail(`a refused full build is not reported as not built: ${n}`);
        }
        // THE INCIDENT'S SEQUENCE: refused, then built. Nothing to say.
        refused.lastOutcome = { kind: "ok" };
        if (unresolvedSlidesNotice(refused) !== "") fail("a refusal followed by a successful build still appends a notice");
        const thenFailed: SlidesTurnState = {};
        slidesFailure(hubErr, thenFailed);
        slidesFailure(new Error("HTTP 500"), thenFailed);
        if (unresolvedSlidesNotice(thenFailed) !== "") fail("a refusal followed by a shown failure appends a second, contradicting notice");
        // BUILT, THEN A REFUSED REBUILD. A draft from earlier in the turn is on
        // screen and saved, so "the deck was not built" contradicts what the
        // user is looking at. It is the deck that was not CHANGED.
        const rebuilt: SlidesTurnState = { lastOutcome: { kind: "ok" } };
        slidesFailure(hubErr, rebuilt);
        const rn = unresolvedSlidesNotice(rebuilt);
        if (!/was not changed/.test(rn) || /not built/.test(rn)) fail(`a refused rebuild after a deck was drawn in the same turn is not reported as the deck not changed: ${rn}`);
      }
      if (unresolvedSlidesNotice({}) !== "" || unresolvedSlidesNotice(undefined) !== "" || unresolvedSlidesNotice({ lastOutcome: { kind: "ok" } }) !== "") fail("the notice speaks on a turn with no refusal");
      if (isRefusal(appendErr)) {
        const t: SlidesTurnState = {};
        slidesFailure(appendErr, t);
        const n = unresolvedSlidesNotice(t);
        if (!/not added/.test(n) || /deck was not changed|not built/.test(n)) fail(`a refused append is not reported as slides not added: ${n}`);
        if (n.indexOf("slide 4") < 0) fail(`the refused append does not name slide 4, where the hub would have landed: ${n}`);
      }
      if (isRefusal(parseErr)) {
        const t: SlidesTurnState = {};
        slidesFailure(parseErr, t);
        const n = unresolvedSlidesNotice(t);
        if (!/cut off/.test(n) || MARKERS.test(n)) fail(`a turn that ends on a cut-off call does not say so in plain words: ${n}`);
      }

      // e) The release key. The chains key the loop guard differently, so a
      //    release written once for all of them would release nothing on some.
      const lg = createToolLoopGuard();
      const argString = '{"slides": [{"layout": "cover"}]}';
      lg.blockFor("generate_slides", argString);
      lg.release("generate_slides", JSON.parse(argString));
      if (!lg.blockFor("generate_slides", argString)) fail("the loop guard released a string-keyed call under an object key — the premise of per-chain release is wrong, re-read this check");
      lg.release("generate_slides", argString);
      if (lg.blockFor("generate_slides", argString)) fail("the loop guard did not release a call under its own key");

      // f) providers.ts uses all of it, in all four chains.
      //
      // COMMENTS OUT FIRST. A wiring line commented out still matches a
      // substring search: `// slidesTurn(config).lastOutcome = { kind: "ok" };`
      // counted as the ok mark it had stopped being, and ChatPanel's
      // `// setIsGeneratingDocument(false);` as the call it no longer made. Six
      // plausible mutations survived this block (MA–MK in the log); (h) below
      // drives the chains for real, and this reads code, not prose.
      const uncommented = (src: string) => src.replace(/^[ \t]*\/\*[\s\S]*?\*\//gm, "").replace(/(^|[ \t])\/\/[^\n]*/gm, "$1");
      const prov = uncommented(readFileSync(join(__dirname, "..", "lib/ai/providers.ts"), "utf8"));
      const count = (s: string, needle: string) => s.split(needle).length - 1;
      // The turn's state is created in ONE place. A reset anywhere else — even
      // on the line after slidesFailure recorded a refusal — forgets it, and a
      // turn that ends refused then says nothing.
      const turnWrites = (prov.match(/\.slidesTurn\s*=(?!=)/g) || []).length;
      if (turnWrites !== 1) fail(`config.slidesTurn is assigned ${turnWrites} times in providers.ts; only slidesTurn() may create it, and a reset loses the turn's outcome`);
      const esc = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      if (count(prov, "slides_error: err.message") !== 0) fail(`${count(prov, "slides_error: err.message")} chain(s) still send the raw thrown message to the toast`);
      if (count(prov, "slidesFailure(") !== 4) fail(`slidesFailure is called ${count(prov, "slidesFailure(")} times, expected once in each of 4 chains`);
      const branchRe = /(tool\.name|tc\.function\.name) === "generate_slides"\) \{/g;
      const branches: { at: number; name: string }[] = [];
      let bm: RegExpExecArray | null;
      while ((bm = branchRe.exec(prov))) branches.push({ at: bm.index, name: bm[1] });
      if (branches.length !== 4) fail(`found ${branches.length} generate_slides branches, expected 4 — this wiring check is reading the wrong file or pattern`);
      const OK = 'slidesTurn(config).lastOutcome = { kind: "ok" }';
      for (let b = 0; b < branches.length; b++) {
        const { at, name } = branches[b];
        const end = prov.indexOf(`} else if (${name} === "generate_document")`, at);
        const region = prov.slice(at, end < 0 ? at + 20000 : end);
        const tag = `branch ${b + 1} (${name === "tool.name" ? "Anthropic" : "OpenAI-compatible"})`;
        const bf = prov.lastIndexOf("toolLoopGuard.blockFor(", at);
        const key = /^toolLoopGuard\.blockFor\(([^,]+), ([^)]+)\)/.exec(prov.slice(bf));
        if (!key) { fail(`${tag}: no loop-guard key before it`); continue; }
        if (count(region, "slidesFailure(") !== 1) fail(`${tag}: ${count(region, "slidesFailure(")} slidesFailure calls`);
        const v = /const (\w+) = slidesFailure\(err, slidesTurn\(config\)\)/.exec(region);
        if (!v) { fail(`${tag}: the catch does not hand the error and the turn to slidesFailure`); continue; }
        // A STATEMENT of its own, not the tail of a condition: `if
        // (!failed.refused) for (const ev of failed.events)` matches the loop
        // and sends a refusal nothing, so the client's indicator never clears.
        if (!new RegExp(`(?:^|[;{}])\\s*for \\(const (\\w+) of ${v[1]}\\.events\\) \\{\\s*controller\\.enqueue\\(encoder\\.encode\\(\`data: \\$\\{JSON\\.stringify\\(\\1\\)\\}`).test(region)) fail(`${tag}: the helper's events are not what is sent, on every outcome`);
        if (!new RegExp(`content: ${v[1]}\\.toolText`).test(region)) fail(`${tag}: the tool result is not the helper's text`);
        if (!new RegExp(`if \\(!${v[1]}\\.refused\\) toolLoopGuard\\.release\\(${esc(key[1])}, ${esc(key[2])}\\)`).test(region)) {
          fail(`${tag}: a fault is not released with this chain's own key (blockFor(${key[1]}, ${key[2]}))`);
        }
        const draftAt = region.indexOf("slides_draft: draft");
        const readyAt = region.indexOf("slides_ready: {");
        const catchAt = region.lastIndexOf("} catch (err: any) {");
        const ok1 = region.indexOf(OK, draftAt);
        const ok2 = region.indexOf(OK, readyAt);
        if (count(region, OK) !== 2 || !(draftAt >= 0 && ok1 > draftAt && ok1 < readyAt) || !(ok2 > readyAt && ok2 < catchAt)) {
          fail(`${tag}: the turn is not marked ok exactly after the draft is sent and after the deck is published`);
        }
        if (name !== "tool.name") {
          if (region.indexOf("parseSlidesArguments(tc.function.arguments)") < 0 || region.indexOf("JSON.parse(") >= 0) fail(`${tag}: arguments are not parsed as a refusal`);
        }
      }
      const unstarted: number[] = [];
      const noticeRe = /unstartedConversionNotice\(sourceSlideCount\(messages\)/g;
      let nm: RegExpExecArray | null;
      while ((nm = noticeRe.exec(prov))) unstarted.push(nm.index);
      if (unstarted.length !== 4) fail(`found ${unstarted.length} end-of-turn notice sites, expected 4`);
      const calls = count(prov, "unresolvedSlidesNotice(") - count(prov, "function unresolvedSlidesNotice(");
      if (calls !== 4) fail(`unresolvedSlidesNotice is called ${calls} times, expected 4`);
      for (let i = 0; i < unstarted.length; i++) {
        const ret = prov.indexOf("return {", unstarted[i]);
        const site = prov.slice(unstarted[i], ret);
        if (!/const (\w+) = unresolvedSlidesNotice\(config\.slidesTurn\);\s*if \(\1\) \{\s*fullText \+= \1;[\s\S]{0,40}?controller\.enqueue\(encoder\.encode\(`data: \$\{JSON\.stringify\(\{ token: \1 \}\)\}/.test(site)) {
          fail(`end-of-turn site ${i + 1}: the unresolved-slides notice is not appended to the reply and streamed beside the unstarted one`);
        }
      }

      // g) ChatPanel.
      const panel = uncommented(readFileSync(join(__dirname, "..", "components/ai-writer/ChatPanel.tsx"), "utf8"));
      const branchOf = (k: string) => {
        const s = panel.indexOf(`} else if (parsed.${k}) {`);
        if (s < 0) return "";
        const e = panel.indexOf("} else if (parsed.", s + 10);
        return panel.slice(s, e < 0 ? s + 1500 : e);
      };
      const refusedKey = isRefusal(hubErr) ? Object.keys(slidesFailure(hubErr, {}).events[0] || {})[0] : "slides_refused";
      const refusedBranch = branchOf(refusedKey);
      if (!refusedBranch) fail(`ChatPanel has no branch for "${refusedKey}", the event a refusal sends — "Writing the deck… slide 14" would stay up for a call that ended`);
      else {
        if (refusedBranch.indexOf("setSlidesProgress(null)") < 0 || refusedBranch.indexOf("setIsGeneratingDocument(false)") < 0) fail("ChatPanel's refusal branch does not clear the progress indicator");
        if (/toast\./.test(refusedBranch)) fail("ChatPanel's refusal branch shows a toast");
      }
      const dismiss = "toast.dismiss(slidesErrorToastRef.current)";
      if (branchOf("slides_draft").indexOf(dismiss) < 0) fail("a draft arriving does not take down an earlier failure toast");
      if (branchOf("slides_ready").indexOf(dismiss) < 0) fail("a published deck arriving does not take down an earlier failure toast");
      if (!/slidesErrorToastRef\.current = toast\.error\(parsed\.slides_error\)/.test(branchOf("slides_error"))) fail("the failure toast's id is not kept, so nothing can take it down");
      if (/Usually a fixable connection state/.test(panel)) fail("ChatPanel still says slides_error is usually a connection state");

      // h) BEHAVIOUR, ALL FOUR CHAINS. (f) reads source, and source-reading
      //    let a commented-out ok mark, a refusal event sent only on faults, a
      //    publish failure never recorded and a turn state reset after being
      //    written all stay green — two of them breaking what the user sees.
      //    So the real createStreamingResponse runs each chain against a fake
      //    provider on localhost: fetch is redirected there (the SDKs use it),
      //    every other host is refused, and each turn's SSE events and the
      //    text it PERSISTS are what is asserted. Offline, a few milliseconds a
      //    turn. The Google publish runs with no signed-in user, which is the
      //    deterministic {ok:false} branch.
      type Step = { text: string } | { tool: string; args: string };
      let script: Step[] = [];
      let reqNo = 0;
      const seenResults: string[] = [];
      const server = createServer((req, res) => {
        let body = "";
        req.on("data", (c) => { body += c; });
        req.on("end", () => {
          let p: any = {};
          try { p = JSON.parse(body); } catch { /* not JSON: answered anyway */ }
          const msgs: any[] = p.messages || [];
          const last = msgs[msgs.length - 1];
          if (last && last.role === "tool") seenResults.push(String(last.content));
          if (last && last.role === "user" && Array.isArray(last.content)) {
            for (let i = 0; i < last.content.length; i++) {
              const b = last.content[i];
              if (b && b.type === "tool_result") seenResults.push(typeof b.content === "string" ? b.content : JSON.stringify(b.content));
            }
          }
          const forced = p.tool_choice === "none" || (p.tool_choice && p.tool_choice.type === "none");
          const step: Step = forced ? { text: "Forced final." } : (script[reqNo++] || { text: "Nothing more." });
          res.writeHead(200, { "content-type": "text/event-stream" });
          const w = (s: string) => res.write(s);
          if ((req.url || "").indexOf("/messages") >= 0) {
            const ev = (type: string, o: any) => w(`event: ${type}\ndata: ${JSON.stringify({ type, ...o })}\n\n`);
            ev("message_start", { message: { id: `msg_${reqNo}`, type: "message", role: "assistant", model: "m", content: [], stop_reason: null, stop_sequence: null, usage: { input_tokens: 1, output_tokens: 1 } } });
            if ("text" in step) {
              ev("content_block_start", { index: 0, content_block: { type: "text", text: "" } });
              ev("content_block_delta", { index: 0, delta: { type: "text_delta", text: step.text } });
              ev("content_block_stop", { index: 0 });
              ev("message_delta", { delta: { stop_reason: "end_turn", stop_sequence: null }, usage: { output_tokens: 1 } });
            } else {
              ev("content_block_start", { index: 0, content_block: { type: "tool_use", id: `toolu_${reqNo}`, name: step.tool, input: {} } });
              ev("content_block_delta", { index: 0, delta: { type: "input_json_delta", partial_json: step.args } });
              ev("content_block_stop", { index: 0 });
              ev("message_delta", { delta: { stop_reason: "tool_use", stop_sequence: null }, usage: { output_tokens: 1 } });
            }
            ev("message_stop", {});
          } else {
            const base = { id: "c1", object: "chat.completion.chunk", created: 1, model: "m" };
            const ev = (o: any) => w(`data: ${JSON.stringify({ ...base, ...o })}\n\n`);
            if ("text" in step) {
              ev({ choices: [{ index: 0, delta: { role: "assistant", content: step.text } }] });
              ev({ choices: [{ index: 0, delta: {}, finish_reason: "stop" }] });
            } else {
              ev({ choices: [{ index: 0, delta: { role: "assistant", tool_calls: [{ index: 0, id: `call_${reqNo}`, type: "function", function: { name: step.tool, arguments: "" } }] } }] });
              ev({ choices: [{ index: 0, delta: { tool_calls: [{ index: 0, function: { arguments: step.args } }] } }] });
              ev({ choices: [{ index: 0, delta: {}, finish_reason: "tool_calls" }] });
            }
            ev({ choices: [], usage: { prompt_tokens: 1, completion_tokens: 1 } });
            w("data: [DONE]\n\n");
          }
          res.end();
        });
      });
      await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", () => resolve()));
      const port = (server.address() as any).port;
      const realFetch = globalThis.fetch;
      const ENV_KEYS = ["ANTHROPIC_API_KEY", "OPENAI_API_KEY", "XAI_API_KEY", "GEMINI_API_KEY", "BLOB_READ_WRITE_TOKEN"];
      const savedEnv: { [k: string]: string | undefined } = {};
      const saidBefore = { log: console.log, warn: console.warn, error: console.error, info: console.info };
      const slidesCall = (input: any): Step => ({ tool: "generate_slides", args: JSON.stringify(input) });
      const GOOD = () => [{ layout: "content", title: "One", body: "A line" }, { layout: "content", title: "Two", body: "Another line" }];
      type Turn = { events: any[]; persisted: string; streamed: string; results: string[] };
      const runs: { chain: string; name: string; turn?: Turn; threw?: string }[] = [];
      const CHAINS = [["Anthropic", "claude-sonnet-5"], ["xAI", "grok-4-1-fast"], ["Gemini", "gemini-3-flash"], ["OpenAI", "gpt-5-6-terra"]];
      const SCENARIOS: [string, Step[], boolean][] = [
        ["refused, then text", [slidesCall({ title: "T", slides: [cover, NODES_HUB()] }), { text: "Here is your deck, all done." }], false],
        ["refused, then built", [slidesCall({ title: "T", slides: [cover, NODES_HUB()] }), slidesCall({ title: "T", slides: GOOD() }), { text: "Built." }], false],
        ["built, then a refused append", [slidesCall({ title: "T", slides: GOOD() }), slidesCall({ editSlide: { insertAfter: 2, insertSlides: [{ layout: "content", title: "Three", body: "x" }, NODES_HUB()] } }), { text: "Added them." }], true],
        ["cut off", [{ tool: "generate_slides", args: '{"title":"T","slides":[{"layout":"content","title":"Q' }, { text: "Done!" }], false],
        ["built, then a refused rebuild", [slidesCall({ title: "T", slides: GOOD() }), slidesCall({ title: "T", slides: [cover, NODES_HUB()] }), { text: "Rebuilt with the diagram." }], false],
        ["refused, then the publish fails", [slidesCall({ title: "T", slides: [cover, NODES_HUB()] }), slidesCall({ title: "T", slides: GOOD(), publish: true }), { text: "Published." }], false],
        // A FAULT the model did not cause by its shape as the guard sees it: a
        // stats payload as a string throws inside the builder. The identical
        // call again must RUN again (the signature released with this chain's
        // own key), not be refused as a repeat. Sent PRETTY-PRINTED: the xAI
        // chain keys the guard on the arguments with whitespace stripped, and
        // with compact JSON that equals the raw string — so a release under
        // the wrong key would release and nothing here could see it.
        ["a fault, then the identical call", [
          { tool: "generate_slides", args: JSON.stringify({ title: "T", slides: [cover, { layout: "stat", title: "Numbers", stats: "12%" }] }, null, 2) },
          { tool: "generate_slides", args: JSON.stringify({ title: "T", slides: [cover, { layout: "stat", title: "Numbers", stats: "12%" }] }, null, 2) },
          { text: "Tried twice." }], false],
      ];
      try {
        (globalThis as any).fetch = (input: any, init?: any) => {
          let url = typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
          const u = new URL(url);
          if (u.host === "api.x.ai" || u.host === "api.anthropic.com" || u.host === "api.openai.com") url = `http://127.0.0.1:${port}${u.pathname}${u.search}`;
          else if (u.host === "generativelanguage.googleapis.com") url = `http://127.0.0.1:${port}/v1/chat/completions`;
          else if (u.host !== `127.0.0.1:${port}`) return Promise.reject(new Error(`check 38h allows no network: ${u.host}`));
          if (typeof input !== "string" && !(input instanceof URL)) return realFetch(new Request(url, input), init);
          return realFetch(url, init);
        };
        for (let k = 0; k < ENV_KEYS.length; k++) {
          savedEnv[ENV_KEYS[k]] = process.env[ENV_KEYS[k]];
          // Never a real key, even to localhost; and no blob token, so nothing
          // is uploaded and no icon is fetched.
          if (ENV_KEYS[k] === "BLOB_READ_WRITE_TOKEN") delete process.env[ENV_KEYS[k]];
          else process.env[ENV_KEYS[k]] = "verify-offline";
        }
        console.log = console.warn = console.error = console.info = () => {};
        for (let c = 0; c < CHAINS.length; c++) {
          for (let s = 0; s < SCENARIOS.length; s++) {
            const [name, steps, needsConv] = SCENARIOS[s];
            script = steps; reqNo = 0; seenResults.length = 0;
            try {
              let completed: any = null;
              const config: any = { model: CHAINS[c][1], imageGeneration: true, systemPrompt: "sys", source: "enginegpt", userEmail: "",
                conversationId: needsConv ? `verify38h-${CHAINS[c][0]}-${s}-${process.pid}-${Date.now()}` : null };
              const stream = createStreamingResponse([{ role: "user", content: "make me a deck" } as any], config, async (r: any) => { completed = r; });
              const reader = stream.getReader();
              const dec = new TextDecoder();
              let raw = "";
              for (;;) { const chunk = await reader.read(); if (chunk.done) break; raw += dec.decode(chunk.value); }
              const events: any[] = [];
              const lines = raw.split("\n");
              for (let i = 0; i < lines.length; i++) {
                if (lines[i].indexOf("data: ") === 0) { try { events.push(JSON.parse(lines[i].slice(6))); } catch { /* [DONE] */ } }
              }
              const streamed = events.filter((e) => typeof e.token === "string").map((e) => e.token).join("");
              runs.push({ chain: CHAINS[c][0], name, turn: { events, streamed, persisted: String((completed && completed.fullText) || ""), results: seenResults.slice() } });
            } catch (e: any) {
              runs.push({ chain: CHAINS[c][0], name, threw: String((e && e.message) || e).slice(0, 120) });
            }
          }
        }
      } finally {
        console.log = saidBefore.log; console.warn = saidBefore.warn; console.error = saidBefore.error; console.info = saidBefore.info;
        (globalThis as any).fetch = realFetch;
        for (let k = 0; k < ENV_KEYS.length; k++) {
          if (savedEnv[ENV_KEYS[k]] === undefined) delete process.env[ENV_KEYS[k]];
          else process.env[ENV_KEYS[k]] = savedEnv[ENV_KEYS[k]];
        }
        server.close();
      }
      if (runs.length !== CHAINS.length * SCENARIOS.length) fail(`38h ran ${runs.length} turns, expected ${CHAINS.length * SCENARIOS.length} — the harness measured nothing`);
      for (let r = 0; r < runs.length; r++) {
        const { chain, name, turn, threw } = runs[r];
        const tag = `${chain} chain, ${name}`;
        if (!turn) { fail(`${tag}: the turn threw: ${threw}`); continue; }
        const has = (k: string) => turn.events.filter((e) => e[k] !== undefined).length;
        // PRECONDITION: the chain under test is the one that ran. A fallback
        // means it threw and Grok answered, and every assertion below would be
        // about the wrong chain.
        if (has("fallback") || has("error")) { fail(`${tag}: the chain did not run (${JSON.stringify(turn.events.filter((e) => e.fallback || e.error)).slice(0, 120)}) — the harness is not testing it`); continue; }
        const NOTICE = "⚠ **";
        const noticeIn = (s: string) => s.indexOf(NOTICE) >= 0;
        const persistedAndStreamed = (re: RegExp) => re.test(turn.persisted) && re.test(turn.streamed);
        if (name === "refused, then text") {
          if (!has("slides_refused") || has("slides_error")) fail(`${tag}: events ${JSON.stringify(turn.events.map((e) => Object.keys(e)[0]))} — a refusal should clear the indicator and toast nothing`);
          if (!persistedAndStreamed(/The deck was not built\./) || turn.persisted.indexOf("slide 2") < 0) fail(`${tag}: the reply does not carry the notice naming slide 2, both saved and streamed (${turn.persisted.slice(0, 160)})`);
          if (!turn.results.length || turn.results[0].indexOf("REFUSED —") !== 0) fail(`${tag}: the model was not told the call was refused (${String(turn.results[0]).slice(0, 80)})`);
        } else if (name === "refused, then built") {
          if (!has("slides_refused") || !has("slides_draft")) fail(`${tag}: expected a refusal and then a draft`);
          if (noticeIn(turn.persisted)) fail(`${tag}: the deck built, and the reply still says it was not (${turn.persisted.slice(0, 160)})`);
        } else if (name === "built, then a refused append") {
          if (!has("slides_draft") || !has("slides_refused")) fail(`${tag}: expected a draft and then a refusal`);
          if (!persistedAndStreamed(/The new slides were not added\./) || turn.persisted.indexOf("slide 4") < 0) fail(`${tag}: the reply does not say the new slides were not added, naming slide 4 (${turn.persisted.slice(0, 200)})`);
        } else if (name === "cut off") {
          if (!has("slides_refused") || has("slides_error")) fail(`${tag}: a cut-off call is not a silent refusal (${JSON.stringify(turn.events.map((e) => Object.keys(e)[0]))})`);
          if (!persistedAndStreamed(/cut off/)) fail(`${tag}: the reply does not say the request was cut off (${turn.persisted.slice(0, 200)})`);
        } else if (name === "built, then a refused rebuild") {
          if (!persistedAndStreamed(/The deck was not changed\./) || /not built/.test(turn.persisted)) fail(`${tag}: a refused rebuild beside a drawn deck is not reported as the deck not changed (${turn.persisted.slice(0, 200)})`);
        } else if (name === "refused, then the publish fails") {
          if (!has("slides_refused") || has("slides_error") + has("slides_reauth") !== 1) fail(`${tag}: expected a refusal and then one shown publish failure (${JSON.stringify(turn.events.map((e) => Object.keys(e)[0]))})`);
          if (noticeIn(turn.persisted)) fail(`${tag}: the publish failure was shown, and the reply adds a notice about the refusal before it (${turn.persisted.slice(0, 160)})`);
        } else if (name === "a fault, then the identical call") {
          const faults = turn.results.filter((t) => t.indexOf("Google Slides creation failed") === 0).length;
          if (has("slides_refused")) fail(`${tag}: PRECONDITION — a stats payload sent as a string is now a refusal, so this scenario no longer drives a fault; give it another`);
          else if (faults !== 2 || has("slides_error") !== 2) fail(`${tag}: the identical call after a fault did not run again (${faults} faults run, ${has("slides_error")} shown; results ${JSON.stringify(turn.results.map((t) => t.slice(0, 40)))}) — its signature was not released with this chain's key`);
          const shown = turn.events.filter((e) => e.slides_error !== undefined).map((e) => String(e.slides_error));
          if (shown.some((t) => t !== SLIDES_FAILED_FOR_USER)) fail(`${tag}: a fault showed the user something other than the fixed sentence: ${shown[0]}`);
        }
      }
    } catch (e: any) {
      fail(`check 38 threw: ${String((e && e.message) || e).slice(0, 160)}`);
    }
  }
  if (failures === before38) pass("refusals are silent to the user and structured for the notice, faults show a fixed sentence, the notice speaks only when the turn ends refused, and all four chains and ChatPanel are wired to it");

  /* 39. The chat preview draws in the deck's faces.
   *
   * SlideDraftPreview's stack named 'Roboto' first and nothing in the app
   * loaded it, so on a Mac the preview drew Helvetica Neue — about 7% wider at
   * semibold — and "HR Absence Calendar" wrapped in a hub node that holds it on
   * one line in the deck. Every geometric check above measures the DECK; none
   * of them can see the face the preview is painted in.
   *
   * A grep that the stack contains a variable, or that some file imports
   * next/font, would pass with the class applied nowhere, applied to the grid
   * but not the lightbox, or naming a variable no loader declares. So this
   * RENDERS the real component, with next/font/google stubbed to record the
   * arguments each face is loaded with and hand back a class that names it,
   * and asserts on the markup:
   *   - every text box's font-family var() is declared by a loaded face, on an
   *     ancestor that frames exactly ONE slide — so wherever a slide is drawn
   *     (the grid, the full-size lightbox) the variable comes with it;
   *   - each var() carries its family as a fallback, because a var() whose
   *     variable is missing invalidates the whole declaration and the text
   *     inherits the chat's Geist instead of the fallbacks named after it;
   *   - the loader arguments pass NEXT'S OWN validator — the function
   *     `next build` calls — so a weight Next refuses (Roboto 600) is caught
   *     here rather than by a failed deploy;
   *   - every weight and italic the preview model actually draws in a face
   *     resolves, by CSS font matching, to a loaded face within 100;
   *   - adjustFontFallback is off, or next/font's metric-adjusted Arial sits in
   *     front of the stack's own fallbacks.
   * The render's text-box count must equal the model's, and each of the three
   * faces and an italic run must actually be drawn, or the assertions above
   * could pass having tested nothing.
   *
   * What this cannot see is whether next/font's compile step honours the same
   * arguments. That was confirmed once by a real `next build` in a detached
   * worktree (2026-09-15), serving a throwaway page that renders this component:
   * the built CSS declares `.__variable_6c56d9{--font-slide-roboto:
   * "__Roboto_6c56d9"}` (the webfont alone, no adjusted Arial), headless Chrome
   * resolved a hub label to `__Roboto_6c56d9, "Helvetica Neue", Arial,
   * sans-serif` at 600 from the slide frame's class and not from <body>, fetched
   * only the faces drawn (Roboto 300 and 700, Playfair 400 and italic) from
   * /_next/static/media with nothing from Google, and measured "HR Absence
   * Calendar" at 9.774em — Roboto 700's own width, against 10.481 in Helvetica
   * Neue — on one line. The build manifest puts that chunk and CSS on
   * /engineai, /ai-writer and /content/[id], and on no other page.
   *
   * MUTATION LOG (detached worktree, 2026-09-15), 18 mutations. Each killed
   * with 39's own FAIL lines and no failure in checks 1-38:
   *   M1  the class removed from the slide frame (the import is then elided,
   *       so no face loads at all — as in a real build)
   *   M2  the class moved to the thumbnail grid — "an element framing 46
   *       slides"; the lightbox draws its slide outside the grid
   *   M3  the Roboto stack back to a bare 'Roboto' (also: 83 boxes of 675)
   *   M4  var() without its fallback
   *   M5  the loader declaring a variable the stack does not read
   *   M6  Roboto weight 600 added — Next's validator: "Unknown weight `600`"
   *   M7  Roboto 700 not loaded — 600 and 700 would draw from 500
   *   M8  next/font's adjusted fallback left on
   *   M9  the Playfair class left out of SLIDE_FONT_CLASS — 75 boxes undeclared
   *   M10 a hand-written class in place of the loader's
   *   M11 Playfair italic not loaded (first run crashed the transform — a perl
   *       `$1[...]` read as an array — so it was re-run with `${1}` and killed
   *       by name)
   *   M12 the Playfair and Poppins variables swapped between loaders
   *   M13 the Roboto stack losing 'Helvetica Neue' and Arial
   *   M14 the class on the whole preview — the grid and lightbox both inside,
   *       still "framing 46 slides", so still refused
   *   M15 Playfair loaded at 700 only
   *   M16 Roboto preloaded with no subsets — Next's validator refuses it
   *   M18 the Poppins stack removed, so Poppins boxes draw in Roboto's
   * SURVIVED, deliberately:
   *   M17 display "block" changed to "swap". A swap paints the fallback's line
   *       breaks for a moment and then reflows; nothing here can tell a moment
   *       from a state, and the rule is a taste call written down in
   *       slide-fonts.ts, not an invariant.
   * Re-run after moving italic detection ahead of the loader lookup: M1 and
   * M10 had also reported "no italic run", a symptom of the missing loader
   * rather than a second finding. Both still killed, now without it.
   */
  const before39 = failures;
  console.log(`\n39. The chat preview loads and applies the deck's faces`);
  {
    try {
      const fontData: Record<string, { weights: string[]; styles: string[]; axes?: { tag: string; min: number; max: number }[] }> =
        require("next/dist/compiled/@next/font/dist/google/font-data.json");
      const { validateGoogleFontFunctionCall } = require("next/dist/compiled/@next/font/dist/google/validate-google-font-function-call");
      // next/font/google has no runtime: its exports are replaced at compile
      // time. The stub stands in for that step, one function per family the
      // real module would export.
      const calls: { name: string; opts: any }[] = [];
      const stub: Record<string, any> = { __esModule: true };
      const families = Object.keys(fontData);
      for (let i = 0; i < families.length; i++) {
        const name = families[i].replace(/ /g, "_");
        stub[name] = (opts: any) => {
          calls.push({ name, opts });
          return { className: `__className_${name}`, variable: `__variable_${name}`, style: { fontFamily: families[i] } };
        };
      }
      const NodeModule: any = require("module");
      const realLoad = NodeModule._load;
      let previewModule: any;
      NodeModule._load = function (this: any, request: string) {
        if (request === "next/font/google") return stub;
        return realLoad.apply(this, arguments as any);
      };
      try {
        previewModule = require(join(__dirname, "..", "components/ai-writer/SlideDraftPreview.tsx"));
      } finally {
        NodeModule._load = realLoad;
      }
      const React = require("react");
      const { renderToStaticMarkup } = require("react-dom/server");

      // a) The loaders, through Next's validator.
      const loaders: Record<string, { name: string; family: string; weights: string[]; styles: string[]; opts: any }> = {};
      if (calls.length === 0) fail("rendering the preview loads no face through next/font/google — the stack names faces nothing loads");
      for (let i = 0; i < calls.length; i++) {
        const c = calls[i];
        try {
          const v = validateGoogleFontFunctionCall(c.name, c.opts);
          if (!c.opts || typeof c.opts.variable !== "string") fail(`${v.fontFamily} is loaded without a CSS variable, so the preview's stack cannot name it`);
          else loaders[c.opts.variable] = { name: c.name, family: v.fontFamily, weights: v.weights, styles: v.styles, opts: c.opts };
        } catch (e: any) {
          fail(`next build would refuse the ${c.name} loader: ${String((e && e.message) || e).split("\n")[0]}`);
        }
      }

      // b) The stacks.
      const FACES = ["Roboto", "Playfair Display", "Poppins"];
      const TAILS: Record<string, string> = {
        "Roboto": ", 'Helvetica Neue', Arial, sans-serif",
        "Playfair Display": ", Georgia, 'Times New Roman', serif",
        "Poppins": ", 'Helvetica Neue', Arial, sans-serif",
      };
      const varOf: Record<string, string> = {};
      if (typeof previewModule.fontStack !== "function") fail("SlideDraftPreview does not export fontStack");
      else {
        if (previewModule.fontStack(undefined) !== previewModule.fontStack("Roboto")) fail("a box that names no face does not draw in Roboto's stack");
        for (let i = 0; i < FACES.length; i++) {
          const face = FACES[i];
          const stack: string = previewModule.fontStack(face);
          const m = /^var\((--[\w-]+), '([^']+)'\)/.exec(stack);
          if (/var\(--[\w-]+\)/.test(stack)) { fail(`the ${face} stack has a var() with no fallback — a missing variable would draw the chat's own font`); continue; }
          if (!m || m[2] !== face) { fail(`the ${face} stack does not start with the loaded face's variable, falling back to '${face}': ${stack}`); continue; }
          if (stack.slice(m[0].length) !== TAILS[face]) fail(`the ${face} stack lost its fallbacks: ${stack}`);
          const loader = loaders[m[1]];
          if (!loader) { fail(`the ${face} stack reads ${m[1]}, which no loaded face declares`); continue; }
          if (loader.family !== face) fail(`the ${face} stack reads ${m[1]}, which declares ${loader.family}`);
          if (loader.opts.adjustFontFallback !== false) fail(`${face} is loaded with next/font's adjusted fallback, which sits in front of the stack's own`);
          varOf[face] = m[1];
        }
      }

      // c) The render. The deck above, plus a slide that draws an accent
      //    phrase and a bold lead-in, so italic and bold runs are exercised.
      const faceSlides: SlideInput[] = ALL.concat([
        { layout: "content", title: "A headline with {one accent phrase}", body: "**Bold lead-in.** A body line under it." },
      ]);
      const faceDeck = toPreviewModel(faceSlides);
      const markup: string = renderToStaticMarkup(React.createElement(previewModule.default, {
        draft: { title: "Faces", slides: faceSlides, preview: faceDeck }, onPublish: () => {}, publishing: false,
      }));
      type HNode = { attrs: string; parent: HNode | null; frames: number };
      const VOID: Record<string, 1> = { area: 1, base: 1, br: 1, col: 1, embed: 1, hr: 1, img: 1, input: 1, link: 1, meta: 1, source: 1, track: 1, wbr: 1 };
      const nodes: HNode[] = [];
      const stack: HNode[] = [];
      const tagRe = /<(\/?)([a-zA-Z][\w-]*)((?:[^>"]|"[^"]*")*)>/g;
      let t: RegExpExecArray | null;
      while ((t = tagRe.exec(markup))) {
        if (t[1]) { stack.pop(); continue; }
        const node: HNode = { attrs: t[3], parent: stack.length ? stack[stack.length - 1] : null, frames: 0 };
        nodes.push(node);
        if (!VOID[t[2].toLowerCase()] && !/\/\s*$/.test(t[3])) stack.push(node);
      }
      for (let i = 0; i < nodes.length; i++) {
        if (!/\baria-label="Slide \d+"/.test(nodes[i].attrs)) continue;
        for (let p: HNode | null = nodes[i]; p; p = p.parent) p.frames++;
      }
      const wantBoxes = faceDeck.slides.reduce((n, s) => n + s.elements.filter((e) => e.kind !== "image" && e.kind !== "rect" && e.kind !== "ellipse").length, 0);
      let boxes = 0, undeclared = 0, wideScope = 0, firstUndeclared = "", firstWide = "";
      const facesDrawn: Record<string, number> = {};
      for (let i = 0; i < nodes.length; i++) {
        const fm = /\bstyle="[^"]*font-family:var\((--[\w-]+)/.exec(nodes[i].attrs);
        if (!fm) continue;
        boxes++;
        let face = "";
        for (let f = 0; f < FACES.length; f++) if (varOf[FACES[f]] === fm[1]) face = FACES[f];
        if (!face) continue;   // reported by (b)
        facesDrawn[face] = (facesDrawn[face] || 0) + 1;
        const cls = `__variable_${loaders[fm[1]].name}`;
        let holder: HNode | null = null;
        for (let p = nodes[i].parent; p && !holder; p = p.parent) {
          const cm = /\bclass="([^"]*)"/.exec(p.attrs);
          if (cm && cm[1].split(/\s+/).indexOf(cls) >= 0) holder = p;
        }
        if (!holder) { undeclared++; if (!firstUndeclared) firstUndeclared = face; }
        else if (holder.frames !== 1) { wideScope++; if (!firstWide) firstWide = `${face} on an element framing ${holder.frames} slides`; }
      }
      if (boxes !== wantBoxes) fail(`the render drew ${boxes} text boxes in a deck of ${wantBoxes}, so the faces were checked on part of it`);
      if (undeclared) fail(`${undeclared} text box(es) read a font variable no ancestor declares (first: ${firstUndeclared}) — they draw in the fallback face`);
      if (wideScope) fail(`${wideScope} text box(es) take the font variable from an element wider than their slide (${firstWide}) — a slide drawn outside it, as the lightbox does, loses the face`);
      for (let f = 0; f < FACES.length; f++) if (!facesDrawn[FACES[f]] && varOf[FACES[f]]) fail(`the fixture draws no ${FACES[f]} text, so that face was never checked`);

      // d) What the model draws, against what is loaded.
      const cssMatch = (w: number, avail: number[]): number => {
        if (avail.indexOf(w) >= 0) return w;
        const up = avail.filter((a) => a > w).sort((a, b) => a - b);
        const down = avail.filter((a) => a < w).sort((a, b) => b - a);
        if (w >= 400 && w <= 500) {
          const mid = up.filter((a) => a <= 500);
          return mid.length ? mid[0] : down.length ? down[0] : up[0];
        }
        if (w < 400) return down.length ? down[0] : up[0];
        return up.length ? up[0] : down[0];
      };
      const drawn: Record<string, Record<string, 1>> = {};
      let italicSeen = false;
      for (let s = 0; s < faceDeck.slides.length; s++) {
        const els = faceDeck.slides[s].elements;
        for (let e = 0; e < els.length; e++) {
          const el = els[e];
          if (el.kind !== "text") continue;
          const face = el.font === "Playfair Display" || el.font === "Poppins" ? el.font : "Roboto";
          const weights = [el.weight || 400];
          const accents = el.accents || [];
          let italic = false;
          for (let a = 0; a < accents.length; a++) {
            if (accents[a].bold) weights.push(700);
            if (accents[a].italic) italic = true;
          }
          // Seen before the loader lookup, so a missing loader is reported as
          // itself and not also as a fixture with no italic in it.
          if (italic) italicSeen = true;
          const loader = loaders[varOf[face] || ""];
          if (!loader) continue;
          if (italic && loader.styles.indexOf("italic") < 0) fail(`${face} draws an italic run but only ${loader.styles.join("/")} is loaded`);
          for (let k = 0; k < weights.length; k++) {
            const w = weights[k];
            let got = w;
            if (loader.weights[0] === "variable") {
              const axis = (fontData[face].axes || []).filter((x) => x.tag === "wght")[0];
              if (axis) got = Math.min(axis.max, Math.max(axis.min, w));
            } else got = cssMatch(w, loader.weights.map(Number));
            (drawn[face] ||= {})[`${w}→${got}`] = 1;
            if (Math.abs(got - w) > 100) fail(`${face} ${w} is drawn but the nearest loaded weight is ${got}`);
          }
        }
      }
      if (!italicSeen) fail("the fixture draws no italic run, so the italic faces were never checked");
      if (failures === before39) {
        const summary = FACES.map((f) => `${f} ${Object.keys(drawn[f] || {}).sort().join(" ")}`).join("; ");
        pass(`${boxes} text boxes, each under a slide frame that declares its face; drawn → loaded: ${summary}`);
      }
    } catch (e: any) {
      fail(`check 39 threw: ${String((e && e.message) || e).slice(0, 200)}`);
    }
  }

  console.log(failures ? `\n${failures} FAILURE(S)\n` : `\nAll checks passed.\n`);
  process.exit(failures ? 1 : 0);
})();
