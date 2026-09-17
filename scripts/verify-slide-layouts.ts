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
  undrawnTableBodies,
  CAPS_WIDEN, faceAdvance, stripImageMarkdown, drawnText, TEXT_INSET_X, TEXT_INSET_Y, pillWidth, droppedContent, fitHeading, FOOTER_Y, captionParagraphs, splitStageOwner, slideStyle,
  labelWidthPt, quoteClip, drawsRawScreenshot, isScreenshot, fitAspect, namesAPicture, hugHeight,
  densityOf, footerLineWidth, hairlineSpan, hairline, crossingHairlines, hungDot, ctaPill, HUNG_DOT, PILL,
  type SlideInput,
} from "../lib/slides/generate";
import { toPreviewModel, readPath } from "../lib/slides/preview-model";
import { applyEditSlide, unrenderableSlides, undrawnTableSlides, undrawnTableFaults, PAYLOAD_FIELDS, insertableLayout, normaliseSlide, SlideCallRefusal } from "../lib/slides/edit";
import { slidesFailure, parseSlidesArguments, SLIDES_FAILED_FOR_USER, type SlidesTurnState } from "../lib/slides/failure";
import {
  asksForDeckChange, deckChangeClaim, claimingRules, CLAIM_RULES, ASK_RULES, shouldRetryDeckClaim, unmadeDeckChangeNotice,
  DECK_CLAIM_NUDGE, DECK_NOT_CHANGED_NOTICE, NO_DECK_BUILT_NOTICE, lastAssistantReply, endsInDeckChangeQuestion,
  type DeckClaimRetryInput, type ClaimOpts,
} from "../lib/slides/claim";
import { createToolLoopGuard } from "../lib/ai/tool-loop-guard";
import { deckToHtml, safeSrc } from "../lib/slides/pdf-html";
import { SLIDES_TEXT_INSET, NATURAL_LINE } from "../lib/slides/preview-style";
import {
  validateDeck, offCanvasFaults, overlapFaults, overrunFaults, geometryNotes, geometryRefusal,
  faultCounts, relayableFaults, logDeckGeometry, inkBottom, GEOMETRY_SEVERITY, type DeckGeometry,
} from "../lib/slides/validate";
import { previewSlideFrom } from "../lib/slides/preview-model";
import { prepareSlidesForBuild, sourceSlideCount, fidelityAudit, SLIDES_GEN_OPENAI_TOOL, unresolvedSlidesNotice, createStreamingResponse } from "../lib/ai/providers";
import { draftPreview } from "../lib/slides/preview-model";
import { readFileSync } from "fs";
import { createServer } from "http";
import { join } from "path";
import { gradientProfileFor, CONTRAST } from "../lib/slides/images";
import { CANVAS, LAYOUT_STYLE, COLOR, GRID, LAYOUTS, NOTE, SECTION, TYPE, PROCESS, SHOT, IMAGE, FEATURE_SHOT_STYLE, LOGO_PLACEMENT,
  DENSITY, DEFAULT_DENSITY, FRAME, BAND_BOTTOM, TIMELINE, TIMELINE_PARALLEL, LOGO_WALL, withDensity, assetUrl, textOn,
  type Density, type SlideLayout } from "../lib/slides/brand";

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
  // A TABLE AS THEY ACTUALLY ARRIVE. Rows whose cells wrap onto a second line,
  // a standfirst, a takeaway bar, and the analyst paragraph beneath the rows
  // that `table` never drew until check 44 — which also puts that new box in
  // front of the off-canvas and overlap checks rather than only in front of
  // its own. Every slide Stage 0 recovered has this shape, and none of them
  // could be put in front of the geometry battery until check 2 stopped
  // comparing row edges as exact floats: the rows are laid out by accumulating
  // fractional heights and touch to within 2.8e-14pt, which read as eight
  // collisions on one slide.
  { layout: "table", eyebrow: "The programme", title: "Five rows, two-line cells, and the paragraph beneath them",
    subtitle: "A standfirst above the table, long enough to wrap onto a second line.",
    table: { columns: ["Workstream", "What it produces", "Owner", "When"],
      rows: Array.from({ length: 5 }, (_, i) => [
        `Workstream ${i + 1} on the brand transition programme`,
        "A deliverable described at the length a real scorecard cell runs to",
        "Communications", "Q3"]) },
    body: "Amrize still ranks for holcim us, lafarge canada and dozens more legacy terms.\n"
      + "The missing fact: no page on amrize.com states the June 2025 carve-out from Holcim as a machine-readable fact.",
    note: "Why this matters: the former parent is still the closest competitor." },
  // AND THE SAME ROWS WITH THE BAND TO THEMSELVES, which is the OTHER path
  // through the row planner and the one that trips the float: with no prose
  // beneath them the rows are dealt the band's slack back in fractions, and
  // the row below starts 2.8e-14pt above where the row above ended. Compared
  // exactly, that read as eight collisions on this one slide.
  { layout: "table", title: "Six rows with the band to themselves",
    table: { columns: ["Workstream", "What it produces", "Owner", "When"],
      rows: Array.from({ length: 6 }, (_, i) => [
        `Workstream ${i + 1} on the brand transition programme`,
        "A deliverable described at the length a real scorecard cell runs to",
        "Communications", "Q3"]) } },
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
  // THE STAT STANDFIRST, on the two branches where it is tightest, so the
  // canvas, overlap and ink sweeps see a re-split band rather than only
  // check 45's own assertions. Held here for the same reason the screenshots
  // are: a fixture in the shared deck is measured by every sweep in the file.
  //
  // The figures are TOP-ALIGNED under the line because bullets follow them, so
  // this is the fixture on which drawing the standfirst without re-splitting
  // the band prints it straight through the numbers — the centred branches
  // hide that collision behind their own slack.
  { layout: "stat", eyebrow: "The picture today", title: LONG,
    subtitle: "A standfirst long enough to wrap onto a second line under the title, because the finding is written out rather than abbreviated.",
    stats: [
      { value: "64 GW", label: "Global capacity", detail: "Installed by end of 2023." },
      { value: "70%", label: "Cost fall since 2010", detail: "Competitive with fossil." },
      { value: "380 GW", label: "IEA projection", detail: "Under current policies." } ],
    body: "Foundations are in place.\nAlmost everything that earns visibility is absent.\nThe gap is content surface, not authority." },
  // And on the GRID, whose rung ladder has to step down into the room the
  // standfirst actually leaves rather than the room it would have had — with a
  // takeaway bar underneath, so the band is short at both ends at once.
  { layout: "stat", eyebrow: "Context", title: LONG,
    subtitle: "A standfirst long enough to wrap onto a second line under the title, because the model writes the finding out in full rather than in a phrase.",
    note: "Why this matters: the second row is the point, and this sentence runs long enough to take three lines of the takeaway bar beneath the cards.",
    stats: Array.from({ length: 7 }, (_, i) => ({
      value: `${10 + i}%`, label: `A label for figure number ${i + 1} that runs to some length`, detail: `Source ${i + 1}, 2026` })) },
];

/** SCREENSHOTS AND THEIR CALLOUTS.
 *
 *  Held with the stress deck rather than beside check 41, so the canvas,
 *  overlap, preview round-trip, ink-overflow and lockup sweeps all see them —
 *  which is most of the value. `aspect` and `sourceWidth` are what resolution
 *  measures off the prepared file; a photograph leaves both unset. */
const SHOT_PANEL = { url: "shot.png", scrim: 0, aspect: 330 / 406, sourceWidth: 330 };
const SHOT_WIDE = { url: "shot.png", scrim: 0, aspect: 890 / 346, sourceWidth: 890 };
const SHOT_APP = { url: "shot.png", scrim: 0, aspect: 1440 / 760, sourceWidth: 1440 };

const SHOTS: SlideInput[] = [
  // A. A tight panel crop, four pins, no body.
  { layout: "image-split", eyebrow: "The platform", title: "Where the visibility score comes from",
    image: { attachment: 1, callouts: [
      { x: 50, y: 22, text: "One number, every model" },
      { x: 50, y: 30, text: "Movement since the last run" },
      { x: 62, y: 46, text: "Retrieval and recall, split" },
      { x: 50, y: 78, text: "Straight into a deck" } ] },
    resolvedImage: SHOT_PANEL },
  // B. A wide crop with a BODY above the list — the case where the list has to
  //    hug the body and the body's ceiling has to give up the list's room.
  { layout: "image-split", eyebrow: "The platform", title: "Every prompt, every model, one table",
    body: "The audit runs the same prompt set across four models\nEach row records what that model actually said",
    image: { attachment: 1, callouts: [
      { x: 6, y: 12, text: "Filter by model or window" },
      { x: 42, y: 55, text: "Share of voice per prompt" },
      { x: 86, y: 80, text: "Cited, partial or absent" } ] },
    resolvedImage: SHOT_WIDE },
  // C. SEVEN callouts against a cap of five, one of them two lines long.
  { layout: "image-split", eyebrow: "Stress", title: "Seven callouts, five pins",
    image: { attachment: 1, callouts: [
      { x: 8, y: 14, text: "Navigation, which is where every audit starts and where the saved views live" },
      { x: 40, y: 30, text: "Prompt table" },
      { x: 62, y: 55, text: "Share of voice" },
      { x: 88, y: 20, text: "Score panel" },
      { x: 88, y: 49, text: "Export to a deck" },
      { x: 30, y: 80, text: "A sixth callout that will not be drawn" },
      { x: 50, y: 90, text: "A seventh callout that will not be drawn either" } ] },
    resolvedImage: SHOT_APP },
  // D. Two pins three per cent apart, one that points off the picture, and —
  //    the pair that only CHEBYSHEV separation catches — two whose centres are
  //    23.5pt apart DIAGONALLY. Euclidean says they are clear; their square
  //    numeral boxes are 16.6pt apart in both axes and overlap in both.
  { layout: "image-split", eyebrow: "Stress", title: "Two pins on top of each other, and one off the edge",
    image: { attachment: 1, callouts: [
      { x: 50, y: 22, text: "The score" },
      { x: 52, y: 24, text: "The delta, three per cent away" },
      { x: 118, y: 50, text: "A callout that points off the picture" },
      { x: 50, y: 50, text: "Retrieval" },
      { x: 56.078, y: 54.94, text: "Recall, one pin away on the diagonal" } ] },
    resolvedImage: SHOT_PANEL },
  // E. The feature stage, four pins, one legend row.
  { layout: "feature", eyebrow: "Case study", title: "The audit, on one screen",
    body: "Four models, 248 prompts, one score the communications team can act on.",
    image: { attachment: 1, callouts: [
      { x: 8, y: 14, text: "Navigation" },
      { x: 46, y: 45, text: "Prompt table" },
      { x: 88, y: 22, text: "Score panel" },
      { x: 88, y: 49, text: "Export to a deck" } ] },
    resolvedImage: SHOT_APP },
  // F. Five real phrases: the legend has to wrap to two rows and balance them.
  { layout: "feature", eyebrow: "The platform", title: "The audit, on one screen",
    image: { attachment: 1, callouts: [
      { x: 8, y: 14, text: "Saved views and navigation" },
      { x: 46, y: 45, text: "Every prompt, every model" },
      { x: 62, y: 62, text: "Share of voice per prompt" },
      { x: 88, y: 22, text: "The visibility score" },
      { x: 88, y: 49, text: "Straight into a client deck" } ] },
    resolvedImage: SHOT_APP },
  // G. A screenshot with NO callouts: the frame alone, the body untouched.
  { layout: "image-split", eyebrow: "The platform", title: "The prompt table",
    body: "Every prompt, every model\nShare of voice per row\nCited, partial or absent",
    image: { attachment: 1, screenshot: true }, resolvedImage: SHOT_WIDE },
  // H. A cover carrying callouts it cannot draw.
  { layout: "cover", title: "A cover that tried to point at something", subtitle: "Prepared for a client",
    image: { attachment: 1, callouts: [
      { x: 20, y: 20, text: "A phrase the cover cannot draw" },
      { x: 50, y: 50, text: "Another phrase the cover cannot draw" },
      { x: 80, y: 80, text: "A third phrase the cover cannot draw" } ] },
    resolvedImage: { ...SHOT_APP, logo: "white" as const } },
  // I. A LIGHT capture on the navy stage — the mat is a light halo round a
  //    light picture, so the keyline is what has to separate them.
  { layout: "feature", eyebrow: "The platform", title: "One panel, four numbers",
    image: { attachment: 1, callouts: [
      { x: 50, y: 22, text: "The score" },
      { x: 62, y: 46, text: "Retrieval and recall" },
      { x: 50, y: 78, text: "Straight into a deck" } ] },
    resolvedImage: SHOT_PANEL },
  // J. THE ORDINARY SLIDE THAT OVERPRINTED ITSELF. One-line title, one
  //    sentence of body, five phrases of nine or ten words — nothing stressed
  //    about it, and the numbered rows were clamped up over the body because
  //    the body's ceiling has a 40pt floor that says two lines always "fit".
  //    The splitter cannot save it: it can only divide paragraphs, and this
  //    body is one. Checks 1, 2 and 11 are what catch it.
  { layout: "image-split", eyebrow: "The platform", title: "Where the score comes from",
    body: "Four models, 248 prompts and one number the communications team is asked to move",
    image: { attachment: 1, callouts: [
      { x: 8, y: 14, text: "Saved views and the navigation rail down the left-hand side" },
      { x: 46, y: 30, text: "Every prompt against every model, gathered into a single table" },
      { x: 62, y: 55, text: "Share of voice for each prompt and each model in turn" },
      { x: 88, y: 22, text: "The visibility score, and the four things it is made of" },
      { x: 88, y: 49, text: "Straight into a client deck, without leaving the page" } ] },
    resolvedImage: SHOT_APP },
  // K. A FEATURE WHOSE BODY WALKED THE LEGEND OFF THE PAGE. Forty-eight words
  //    across four lines: the stage used to be measured downwards from the
  //    title, so the legend and the "showing N of M" line were simply drawn
  //    past the bottom edge of the canvas. Check 1.
  { layout: "feature", eyebrow: "Case study", title: "The audit, on one screen",
    body: "The audit runs the same prompt set across four models every week\n" +
      "Each row records what that model actually said about the brand\n" +
      "Movement is what the communications team is asked to act on\n" +
      "A single snapshot tells them nothing they can do anything about",
    image: { attachment: 1, callouts: [
      { x: 8, y: 14, text: "Navigation" },
      { x: 46, y: 45, text: "Prompt table" },
      { x: 88, y: 22, text: "Score panel" },
      { x: 60, y: 70, text: "Export" },
      { x: 30, y: 60, text: "Filters" } ] },
    resolvedImage: SHOT_APP },
  // L. THE TAKEAWAY BAR OVER THE ROWS. Seven callouts and a three-line
  //    takeaway: the bar is drawn last and over everything, and this branch
  //    measured to the bottom margin as though it were not there — so the one
  //    line on the slide saying a callout had been dropped was hidden by it.
  { layout: "image-split", eyebrow: "Stress", title: "Seven callouts under a takeaway",
    body: "Every prompt, every model\nShare of voice per row",
    // A takeaway at the bar's full height, because the hole is proportional to
    // it: a one-line bar leaves the rows enough room to look fine either way.
    note: "Why this matters: the audit is the only place a communications team can see what four different models say about them in one view, which is the difference between a snapshot nobody can act on and a programme somebody can be asked to own, quarter after quarter, against a number that moves.",
    image: { attachment: 1, callouts: [
      { x: 8, y: 14, text: "Navigation" },
      { x: 40, y: 30, text: "Prompt table" },
      { x: 62, y: 55, text: "Share of voice" },
      { x: 88, y: 20, text: "Score panel" },
      { x: 88, y: 49, text: "Export to a deck" },
      { x: 30, y: 80, text: "A sixth callout that will not be drawn" },
      { x: 50, y: 90, text: "A seventh callout that will not be drawn either" } ] },
    resolvedImage: SHOT_APP },
  // M. A LEGEND PHRASE WIDER THAN THE WHOLE MEASURE. greedy() put it on a row
  //    of its own and returned it, and the caller centred that row — to a
  //    NEGATIVE x, so the chip was drawn off the left edge of the slide and the
  //    phrase was clipped at both ends. Check 1 is what catches the chip.
  { layout: "feature", eyebrow: "Stress", title: "One phrase, too wide for the slide",
    image: { attachment: 1, callouts: [
      { x: 30, y: 30, text: "A phrase so extravagantly long that it cannot possibly fit inside the content width of the slide even when it is given a whole row entirely to itself" },
      { x: 60, y: 60, text: "A second phrase of exactly the same extravagant length, so that neither of them can be laid out on a row of its own either" } ] },
    resolvedImage: SHOT_APP },
  // N. THE LEGEND'S OWN OVERFLOW PATH. Five twelve-word phrases: two fit the
  //    two rows a legend holds and three do not, so `kept` is 2 and the pins
  //    have to stop at 2 as well. Nothing drove this path before.
  { layout: "feature", eyebrow: "Stress", title: "Five phrases, two rows",
    image: { attachment: 1, callouts: [
      { x: 10, y: 12, text: "A first phrase of twelve words that has to wrap onto two lines" },
      { x: 40, y: 30, text: "A second phrase of twelve words that has to wrap onto two lines" },
      { x: 70, y: 48, text: "A third phrase of twelve words that has to wrap onto two lines" },
      { x: 25, y: 66, text: "A fourth phrase of twelve words that also has to wrap over two" },
      { x: 60, y: 86, text: "A fifth phrase of twelve words which likewise wraps onto two lines" } ] },
    resolvedImage: SHOT_APP },
  // O. A BLANK PHRASE BETWEEN TWO REAL ONES. A pin numbered for a line that
  //    says nothing points at nothing, so the blank is dropped before anything
  //    is numbered and the two survivors are 1 and 2.
  { layout: "image-split", eyebrow: "The platform", title: "A callout with nothing to say",
    image: { attachment: 1, callouts: [
      { x: 30, y: 25, text: "The visibility score" },
      { x: 50, y: 50, text: "   " },
      { x: 70, y: 75, text: "Retrieval and recall" } ] },
    resolvedImage: SHOT_PANEL },
  // P. NO MEASURED ASPECT — a draft saved before callouts shipped, or a `url`
  //    declared a capture. SHOT.unknownAspect decides both the bake and the
  //    drawn box, and nothing drove it.
  { layout: "feature", eyebrow: "The platform", title: "A capture nothing measured",
    image: { attachment: 1, callouts: [
      { x: 30, y: 30, text: "The score" },
      { x: 70, y: 70, text: "The export" } ] },
    resolvedImage: { url: "shot.png", scrim: 0 } },
  // R. NOTHING LEFT FOR A LEGEND. A fourteen-word title, a takeaway at the
  //    bar's full height and five twelve-word phrases: the title and the bar
  //    have taken the slide between them. Pins the reader cannot match to a
  //    phrase are worse than no pins, so both go and the slide says so — the
  //    fallback that stops the stage being squeezed to a postage stamp.
  { layout: "feature", eyebrow: "Stress",
    title: "Fourteen words of title here to see whether the heading and the picture can both fit",
    body: "Four models, 248 prompts, one score the communications team can act on.",
    // The bar at NOTE.maxHeight, which is what a real four-sentence takeaway
    // reaches: below it the fallback has room it does not need, and the
    // fixture proves nothing.
    note: "Why this matters: the audit is the only place a communications team can see what four different models say about them in one view, which is the difference between a snapshot nobody can act on and a programme somebody can be asked to own. The number moves quarter by quarter, and the movement is the thing to report upwards rather than the score itself. A single run tells you where you stand today; four runs tell you whether the work is landing, and that is the only question the board ever asks about any of this.",
    image: { attachment: 1, callouts: [
      { x: 10, y: 12, text: "A first phrase of twelve words that has to wrap onto two lines" },
      { x: 40, y: 30, text: "A second phrase of twelve words that has to wrap onto two lines" },
      { x: 70, y: 48, text: "A third phrase of twelve words that has to wrap onto two lines" },
      { x: 25, y: 66, text: "A fourth phrase of twelve words that also has to wrap over two" },
      { x: 60, y: 86, text: "A fifth phrase of twelve words which likewise wraps onto two lines" } ] },
    resolvedImage: SHOT_APP },
  // Q. The feature stage under a takeaway bar — the same hole as L, on the
  //    branch whose legend and admission sit lowest on the slide.
  { layout: "feature", eyebrow: "Case study", title: "The audit, under a takeaway",
    body: "Four models, 248 prompts, one score the communications team can act on.",
    note: "Why this matters: a single snapshot tells a communications team nothing they can do anything about, and movement is the only thing they can be asked to own.",
    image: { attachment: 1, callouts: [
      { x: 8, y: 14, text: "Navigation" },
      { x: 46, y: 45, text: "Prompt table" },
      { x: 88, y: 22, text: "Score panel" },
      { x: 60, y: 70, text: "Export" } ] },
    resolvedImage: SHOT_APP },
];
/** Where the screenshot fixtures start in ALL, so check 41 can address one. */
const SHOT_AT = DECK.length + STRESS.length;
const SHOT_IX = (letter: string) => SHOT_AT + "ABCDEFGHIJKLMNOPRQ".indexOf(letter);

/* 1. Nothing may fall off the canvas.
 *
 *  THE ASSERTION ITSELF NOW LIVES IN lib/slides/validate.ts, with checks 2 and
 *  11, and runs on every deck a user is about to see as well as on these
 *  fixtures. It was moved rather than copied: the recorded failure mode in this
 *  repo is two copies of a rule kept in step by a comment, and a runtime guard
 *  that had drifted from this script would be worse than none, because this
 *  script's green would be read as covering both. Check 46 is the migration
 *  test — same corpus, same population, same verdict — and the reasons for
 *  every exclusion moved with the code. */
console.log(`\n1. Every element stays on the 720x405 canvas`);
// Indexed loop, not .entries(): tsconfig sets no target, so iterating an
// iterator needs downlevelIteration and fails the production build.
const ALL = DECK.concat(STRESS).concat(SHOTS);
/** One build per slide, read back for all three geometry checks. Built with
 *  the same run id the old check 1 used, so an id in a failure message reads
 *  the way it always did. */
const GEOM_ALL = validateDeck(ALL, "v");
for (let i = 0; i < GEOM_ALL.faults.length; i++) {
  if (GEOM_ALL.faults[i].kind === "off-canvas") fail(GEOM_ALL.faults[i].note);
}
if (!failures) {
  pass(`all ${ALL.length} layouts fit, including ${STRESS.length} overloaded ones and ${SHOTS.length} screenshots` +
    ` (${GEOM_ALL.elementsChecked} elements)`);
}

/* 2. Text boxes must not sit on top of each other.
 *
 *  Inset-aware and not float-exact, both of which moved into validate.ts with
 *  their reasons: a table cell overhangs its row by exactly SLIDES_TEXT_INSET.y
 *  on purpose so that ten rows do not spend 72pt on padding, and a six-row
 *  table accumulates fractional heights so the row below starts 2.8e-14pt above
 *  where the row above ended. Check 46 drives both near misses directly. */
const before2 = failures;
console.log(`\n2. No two text boxes overlap`);
for (let i = 0; i < GEOM_ALL.faults.length; i++) {
  if (GEOM_ALL.faults[i].kind === "overlap") fail(GEOM_ALL.faults[i].note);
}
if (failures === before2) {
  pass(`no collisions across ${GEOM_ALL.textBoxesChecked} text boxes, including with two-line titles`);
}

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
/** The fixtures as the preview renders them, for the checks below that read
 *  boxes rather than requests. */
const deck = toPreviewModel(ALL);
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
   *  name, 73.9pt in 76.2, as overrunning while it draws on one line.
   *
   *  The measurement is `inkBottom` in lib/slides/validate.ts now, with those
   *  reasons, and this check drives it over a WIDER fixture set than checks 1
   *  and 2: ten more slides whose titles are long enough to run over. */
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
  const GEOM_INK = validateDeck(INK, "v");
  for (let i = 0; i < GEOM_INK.faults.length; i++) {
    if (GEOM_INK.faults[i].kind === "overrun") fail(GEOM_INK.faults[i].note);
  }
  if (failures === before11) {
    pass(`no text on ${INK.length} slides is drawn over other text (${GEOM_INK.inkBoxesChecked} boxes measured)`);
  }

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
      // Nothing is excluded any more: `image` used to be, on the grounds that
      // `imageQuery` stood in for it — which was true only while a picture was
      // just a photograph to find. It cannot carry an attachment, a region or a
      // callout, so a patch adding one had to resend the whole slide.
      const SINGLE_ROUTE_EXCLUDED: string[] = [];
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
    // AND A PAGE NUMBER, which used to be asserted ABSENT here.
    //
    // The objection was right about what it saw: the number was static text a
    // caller wrote, so it lied the moment two slides were merged by hand. The
    // deck frame answers it rather than repeating it — the number is `index +
    // 1` computed by the builder, and every route that draws a deck rebuilds
    // every slide through buildSlideRequests, so an insert renumbers. Check 47
    // (e) drives the insert; this pins that the builder's own index is what
    // reaches the page, which is the half that made the old version wrong.
    assertBrand(c5texts.indexOf("5") >= 0, "and the page number is the builder's own index, not a caller's");
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
      // THE FRAME'S RULES ARE FURNITURE, and join the footer, the folio and the
      // lockup in this list for the same reason: they are builder-owned, they
      // belong to the page rather than to the slide, and they are drawn in the
      // margins the takeaway bar's band does not own. That they land in bands
      // nothing writes in is not taken on trust here — check 47 (d) measures
      // the INK of every box on all 29 layouts at both presets against them,
      // which is a stronger question than this one and the only one that can
      // be asked of a rect.
      if (!oid || /_(noteBar|noteTxt|ftl|ftn|frTop|frBot|logo)$/.test(oid)) continue;
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
        if (!oid || /_(noteBar|noteHead|noteTxt|ftl|ftn|frTop|frBot|logo)$/.test(oid)) continue;   // see the note on the same list above
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
   *      cannot fake. (h) also drives the deck-claim guard's fifteen turns —
   *      check 40 holds their units, corpus, wiring and mutation log — and
   *      asserts for EVERY turn that the model-directed nudge ("SYSTEM NOTE")
   *      reaches neither the saved nor the streamed text, and that no nudge
   *      follows an empty assistant turn. One of them switches on a fake blob
   *      store so generate_document really builds a .pptx; no other turn
   *      uploads anything.
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
   *   icons resolved online, onto items shared with the call.
   *
   * THIRD MUTATION LOG (detached worktree, 2026-09-16). (h) is now the harness
   * for the persist-time narration filter as well, because it is the only place
   * the four chains run end to end: every turn captures BOTH copies —
   * `spoken` (what the chain returned and the screen showed) and `persisted`
   * (keptText, what the route writes to document_message) — and three
   * invariants are asserted on EVERY turn the file runs, not only on the
   * scenarios written for it. Then new turns for the shapes thumbs-down #7 and
   * its neighbours actually had — in both directions, because the filter has
   * two ways to be wrong and the second one cost an answer.
   *   killed  N1 narrationSpans.push deleted from ONE chain — that chain's
   *           narration lands in the transcript, and only that chain's
   *   killed  N3 the push moved AFTER the executors: the .pptx download link is
   *           eaten with the paragraph above it. THE TRAP THE SPAN DESIGN
   *           EXISTS FOR, and invariant (i) is what sees it
   *   killed  N4 span end = roundTextStart (nothing is ever cut)
   *   killed  N5 the backstop deleted — but see the FOURTH log: it is now the
   *           unit at verify-tool-loop-guard 9 that kills it, not this file
   *   killed  N8 scrub applied to the streamed copy only — invariant (ii), the
   *           saved text stops being a subsequence of what was said
   *   killed  N9 the filter made the identity function
   *   killed  N14 the cut-short notice reading blockedRepeat; N16 the notice
   *           appended but never streamed; N17 it hooked into three chains;
   *           N18 it placed before the unmade-deck notice, where the deck
   *           family's one-a-turn rule silences it
   *   CORRECTED  N15 was recorded here as "the data-source gate removed from
   *           dataSubject → killed". Re-run alone, the mutation it names — the
   *           `known.service === "document" || …` line, and nothing else —
   *           SURVIVES both this file and verify-tool-loop-guard, because no
   *           generator in the map carries a `subject` and the line above it
   *           has already returned null. The kill was recorded against an
   *           earlier subject-less implementation and carried forward without
   *           re-running. What IS killed is removing the `!known.subject`
   *           guard, which is the mutation the quoted evidence describes. See
   *           the fourth log.
   *   SURVIVOR  N2, the push moved BEFORE the round separator. The design
   *           predicted invariant (iii) would kill it — the saved text opening
   *           on a newline — and it does not, because the scrub in
   *           createStreamingResponse collapses runs of blank lines and trims,
   *           so the separator being inside or outside the span produces the
   *           same saved bytes in every shape this file reaches. Recorded
   *           rather than tidied away: the push stays after the separator
   *           because that is the position that reads correctly, not because
   *           anything here can tell the difference.
   *   A FINDING, from N5's first run. Only the Anthropic and xAI chains break
   *           on a no-progress round (`if (!executedAnyTool) break;`); Gemini
   *           and OpenAI run on to the next round. A backstop scenario built
   *           around that break tested the backstop on two chains and an
   *           ordinary clean ending on the other two — it now ends on the ROUND
   *           CAP, which every chain reaches the same way. Pre-existing
   *           divergence, not touched here.
   *
   * FOURTH MUTATION LOG (detached worktree, 2026-09-16), after verifiers drove
   * the filter through this file's own transport and found it deleting ANSWERS
   * rather than plans. The rule is now bounded — a span is cut only when it is
   * smaller than what survives it — and six scenarios pin the bound, along with
   * an image turn and a coverage assertion for invariant (i).
   *   killed  P1 the bound removed (the unconditional rule, as shipped). Five
   *           scenarios red per chain, and they reproduce the verifiers'
   *           measurements exactly: a 184-character answer saved as "Done.",
   *           a text block emitted after the tool_use block gone with it, and
   *           a numbered list saved starting at item 3
   *   killed  P2 the `spokenText.length` boundary dropped from ONE chain: the
   *           end-of-turn notices count as surviving answer text, and "an
   *           answer, then a refused deck" loses its answer — on that chain
   *           alone, plus the wiring assertion naming it
   *   killed  P8 `seenImageUrls` hoisted out of `scrub`, so the two copies
   *           share one duplicate set. THE MUTATION A VERIFIER FOUND SURVIVING
   *           the whole suite: the saved row loses an image the screen kept.
   *           Red on all four chains, by invariant (i) and by the scenario
   *           P9 the image scenario deleted → the coverage assertion fires:
   *           "no turn produced the artefact marker "![", so the assertion
   *           guarding it tested nothing". Four of invariant (i)'s five
   *           original markers occurred in ZERO of 132 turns; the list is now
   *           two markers that turns really make, and this is what keeps it so
   *   killed  N3 RE-RUN under the bound, because a bound could have let a span
   *           that swallowed an artefact through on size: it does not. The
   *           pptx download link and the image both go red
   *   SURVIVOR  N5, the backstop, no longer has a scenario of its own HERE. The
   *           bound subsumes it — when every word is inside a span the survivor
   *           is empty, so nothing clears the bar and nothing is cut. Deleting
   *           `return out.trim() ? out : text` now goes red only at
   *           verify-tool-loop-guard 9, on the whitespace-only survivor. The
   *           scenario stays because the behaviour it asserts is still right;
   *           it just no longer isolates that line. */
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
      // A step may carry text AND a call, as a real round can: narration, then
      // the call, in one message. `textAfter` is the other order Anthropic
      // routinely emits — a text block AFTER the tool_use block, in the SAME
      // assistant message. It is inside the round's span like everything else,
      // which is only safe because the span is bounded.
      type Step = { text?: string; tool?: string; args?: string; textAfter?: string };
      let script: Step[] = [];
      let reqNo = 0;
      // What the tools-off final pass says, and whether it can run at all.
      let forcedText = "Forced final.";
      let failForced = false;
      const seenResults: string[] = [];
      // What each request carried, for the deck-claim scenarios: a retry must
      // be a tools-on round offering generate_slides, with the assistant's own
      // text of THAT round replayed immediately before the nudge.
      type Req = { lastUserText: string; prevRole: string; prevText: string; forced: boolean; offered: string[] };
      const reqs: Req[] = [];
      const server = createServer((req, res) => {
        let body = "";
        req.on("data", (c) => { body += c; });
        req.on("end", () => {
          let p: any = {};
          try { p = JSON.parse(body); } catch { /* not JSON: answered anyway */ }
          // A fake blob store, for the scenarios that build a real .pptx with
          // generate_document or a real image with generate_image: the file is
          // "uploaded" here, offline. The pathname is echoed back from the
          // request so an image's markdown carries an image's path rather than
          // a deck's — the persisted URL is what the scrub's dedupe keys on.
          if ((req.url || "").indexOf("/api/blob") === 0) {
            const asked = decodeURIComponent((req.url || "").replace(/^\/api\/blob\/?/, "").split("?")[0]) || "presentations/x.pptx";
            const isImage = /\.png$/i.test(asked);
            res.writeHead(200, { "content-type": "application/json" });
            res.end(JSON.stringify({ url: `https://store.private.blob.vercel-storage.com/${asked}`, downloadUrl: `https://store.private.blob.vercel-storage.com/${asked}?download=1`, pathname: asked, contentType: isImage ? "image/png" : "application/vnd.openxmlformats-officedocument.presentationml.presentation", contentDisposition: isImage ? "inline" : "attachment" }));
            return;
          }
          // A fake gpt-image-1. All four chains reach image generation through
          // an OpenAI-compatible /images/generations (xAI's client included),
          // so one branch serves them all. A 1x1 PNG is an image as far as
          // everything downstream is concerned.
          if ((req.url || "").indexOf("/images/generations") >= 0) {
            res.writeHead(200, { "content-type": "application/json" });
            res.end(JSON.stringify({ created: 1, data: [{ b64_json: "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==" }] }));
            return;
          }
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
          const textOf = (m: any): string => !m ? "" : typeof m.content === "string" ? m.content
            : Array.isArray(m.content) ? m.content.filter((b: any) => b && b.type === "text").map((b: any) => b.text).join("\n") : "";
          const prev = msgs[msgs.length - 2];
          reqs.push({ lastUserText: last && last.role === "user" ? textOf(last) : "", prevRole: (prev && prev.role) || "", prevText: textOf(prev), forced: !!forced,
            offered: (p.tools || []).map((t: any) => t.name || (t.function && t.function.name)).filter(Boolean) });
          // A FORCED FINAL THAT CANNOT RUN. The one turn whose whole text sits
          // inside a narration span and has nothing after it — the backstop in
          // withoutRoundNarration is all that stands between the user and a
          // blank row.
          if (forced && failForced) {
            res.writeHead(500, { "content-type": "application/json" });
            res.end(JSON.stringify({ error: { type: "api_error", message: "forced final unavailable" } }));
            return;
          }
          const step: Step = forced ? { text: forcedText } : (script[reqNo++] || { text: "Nothing more." });
          res.writeHead(200, { "content-type": "text/event-stream" });
          const w = (s: string) => res.write(s);
          if ((req.url || "").indexOf("/messages") >= 0) {
            const ev = (type: string, o: any) => w(`event: ${type}\ndata: ${JSON.stringify({ type, ...o })}\n\n`);
            ev("message_start", { message: { id: `msg_${reqNo}`, type: "message", role: "assistant", model: "m", content: [], stop_reason: null, stop_sequence: null, usage: { input_tokens: 1, output_tokens: 1 } } });
            let idx = 0;
            if (step.text) {
              ev("content_block_start", { index: idx, content_block: { type: "text", text: "" } });
              ev("content_block_delta", { index: idx, delta: { type: "text_delta", text: step.text } });
              ev("content_block_stop", { index: idx });
              idx++;
            }
            if (step.tool) {
              ev("content_block_start", { index: idx, content_block: { type: "tool_use", id: `toolu_${reqNo}`, name: step.tool, input: {} } });
              ev("content_block_delta", { index: idx, delta: { type: "input_json_delta", partial_json: step.args || "{}" } });
              ev("content_block_stop", { index: idx });
              idx++;
            }
            if (step.textAfter) {
              ev("content_block_start", { index: idx, content_block: { type: "text", text: "" } });
              ev("content_block_delta", { index: idx, delta: { type: "text_delta", text: step.textAfter } });
              ev("content_block_stop", { index: idx });
            }
            ev("message_delta", { delta: { stop_reason: step.tool ? "tool_use" : "end_turn", stop_sequence: null }, usage: { output_tokens: 1 } });
            ev("message_stop", {});
          } else {
            const base = { id: "c1", object: "chat.completion.chunk", created: 1, model: "m" };
            const ev = (o: any) => w(`data: ${JSON.stringify({ ...base, ...o })}\n\n`);
            if (step.text) ev({ choices: [{ index: 0, delta: { role: "assistant", content: step.text } }] });
            if (step.tool) {
              ev({ choices: [{ index: 0, delta: { role: "assistant", tool_calls: [{ index: 0, id: `call_${reqNo}`, type: "function", function: { name: step.tool, arguments: "" } }] } }] });
              ev({ choices: [{ index: 0, delta: { tool_calls: [{ index: 0, function: { arguments: step.args || "{}" } }] } }] });
            }
            if (step.textAfter) ev({ choices: [{ index: 0, delta: { content: step.textAfter } }] });
            ev({ choices: [{ index: 0, delta: {}, finish_reason: step.tool ? "tool_calls" : "stop" }] });
            ev({ choices: [], usage: { prompt_tokens: 1, completion_tokens: 1 } });
            w("data: [DONE]\n\n");
          }
          res.end();
        });
      });
      await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", () => resolve()));
      const port = (server.address() as any).port;
      const realFetch = globalThis.fetch;
      const ENV_KEYS = ["ANTHROPIC_API_KEY", "OPENAI_API_KEY", "XAI_API_KEY", "GEMINI_API_KEY", "BLOB_READ_WRITE_TOKEN", "VERCEL_BLOB_API_URL"];
      const savedEnv: { [k: string]: string | undefined } = {};
      const saidBefore = { log: console.log, warn: console.warn, error: console.error, info: console.info };
      const slidesCall = (input: any): Step => ({ tool: "generate_slides", args: JSON.stringify(input) });
      const GOOD = () => [{ layout: "content", title: "One", body: "A line" }, { layout: "content", title: "Two", body: "Another line" }];
      // THREE COPIES, because they are three different claims. `streamed` is the
      // SSE the client rendered; `spoken` is what the chain returned as its
      // fullText; `persisted` is what the route writes to document_message, and
      // since 2026-09-16 that is keptText — the same text with the narration of
      // any round that ended in tool calls cut out.
      type Turn = { events: any[]; persisted: string; spoken: string; streamed: string; results: string[]; reqs: Req[] };
      const runs: { chain: string; name: string; asked: boolean; turn?: Turn; threw?: string }[] = [];
      const CHAINS = [["Anthropic", "claude-sonnet-5"], ["xAI", "grok-4-1-fast"], ["Gemini", "gemini-3-flash"], ["OpenAI", "gpt-5-6-terra"]];
      // The deck-claim guard (check 40): a reply that says the deck changed when
      // no call reached the builder. FALSE_REPLY is the incident's shape, cut
      // short; EDIT is a change asked for in the user's own message.
      const FALSE_REPLY = "Replacing slide 9 with the two corrected MeetingBrain slides, everything else untouched.\n\nSlide 9 is gone, replaced by two more accurate slides.\n\nThe deck is now 12 slides total.";
      const FALSE_FIRST = "Replacing slide 9 with the two corrected MeetingBrain slides";
      const REAL_INSERT = "Inserting the Writer and Optimiser slides after slide 6, leaving the rest of the deck untouched.\n\nTwo slides are now in after the live-demo slide.";
      const EDIT = "Remove slide 9 and put these two slides in its place";
      // The flagged turn's own shape, in its own register: a first-person plan
      // paragraph per tool round, then the answer.
      const PLAN_ONE = "I'll pull the contract and the meeting records first.";
      const PLAN_TWO = "Now let me get the September plan row.";
      const PAST_TENSE = "Pulled the contract and both meeting records.";
      const ANSWER = "Contract 255 runs 17 September to 30 December: 12 CU commissioned, none drawn down yet, and the kick-off sits on the 22nd with Thomas and Gary.";
      const LATE_ANSWER = "Here is the full picture, now that all of it is finally in.";
      // ── The other half of the filter: what it must NOT cut ──
      //
      // A round that did the work and THEN reached for one more tool. Every
      // word of this is inside a span, and the first version of this filter
      // deleted all of it and saved the next round's "Done." in its place.
      const BRIEFING =
        "Contract 255 runs 17 September to 30 December. 12 CU are commissioned and none have been drawn down yet, " +
        "so the whole balance is still available. The kick-off is on the 22nd, and the September plan row is open.";
      const SIGNOFF = "Done.";
      const AFTER_CALL =
        "That is the whole contract position, and nothing in it has been invoiced against yet — the balance you see is the balance you have.";
      const LIST_HEAD = "1. Contract 255 runs 17 September to 30 December.\n2. Twelve content units are commissioned under it.";
      const LIST_TAIL = "3. Nothing has been drawn down.\n\nSo the runway is the whole balance.";
      /** Eight rounds that each narrate and each call a DIFFERENT tool, so none
       *  is refused and the loop runs out of rounds rather than out of budget. */
      const CAPPED_ROUNDS = (): Step[] => {
        const out: Step[] = [];
        for (let i = 0; i < 8; i++) out.push({ text: `Round ${i}: still pulling.`, tool: `not_a_tool_${i}`, args: "{}" });
        return out;
      };
      /** n distinct calls to one tool, which runs it past its per-tool budget. */
      const OVER_BUDGET = (tool: string, n: number): Step[] => {
        const out: Step[] = [];
        for (let i = 0; i < n; i++) out.push({ tool, args: JSON.stringify({ query: `q${i}` }) });
        return out;
      };
      // The user's message (default "make me a deck"), whether a deck is in the
      // conversation (default: needsConv), extra config, an attached source, and
      // whether the fake blob store is switched on for this turn.
      type ScenarioOpts = { user?: string; deck?: boolean; cfg?: any; attach?: string; blob?: boolean; forcedText?: string; failForced?: boolean };
      const COMMENT_QUESTION = "On slide 4 (\"Pricing\") of \"Q3 review\": is this 12% figure right?\n\nChange only that slide. Leave every other slide exactly as it is, and resend the complete deck.";
      const SCENARIOS: [string, Step[], boolean, ScenarioOpts?][] = [
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
        // The deck-claim guard. A claim with no call gets ONE more round with
        // tools on; a turn that still ends with no call says the deck was not
        // changed; a turn that did call, or was not asked, or could not have
        // called, is never nudged.
        ["claim, retry calls", [{ text: FALSE_REPLY }, slidesCall({ title: "T", slides: GOOD() }), { text: "Done." }], false, { user: EDIT, deck: true }],
        ["claim, retry asks", [{ text: FALSE_REPLY }, { text: "Should the cards be blue or teal?" }, { text: "UNREACHED" }], false, { user: EDIT, deck: true }],
        ["claim, retry claims again", [{ text: FALSE_REPLY }, { text: "Slide 9 is gone now." }, { text: "UNREACHED" }], false, { user: EDIT, deck: true }],
        // Text from an EARLIER round must not be replayed as the claiming
        // round's assistant turn: it is already in the history once.
        ["text and a lookup, then claim", [{ text: "Checking the deck first.", tool: "not_a_tool", args: "{}" }, { text: FALSE_REPLY }, slidesCall({ title: "T", slides: GOOD() }), { text: "Done." }], false, { user: EDIT, deck: true }],
        ["real call, then narration", [slidesCall({ title: "T", slides: GOOD() }), { text: REAL_INSERT }, { text: "UNREACHED" }], false, { user: EDIT, deck: true }],
        ["question, no ask", [{ text: "Slide 9 is now the two-column MeetingBrain slide." }, { text: "UNREACHED" }], false, { user: "What's on slide 9 now?", deck: true }],
        ["claim, slides not offered", [{ text: FALSE_REPLY }, { text: "UNREACHED" }], false, { user: EDIT, deck: true, cfg: { imageGeneration: false } }],
        ["claim, tainted", [{ text: FALSE_REPLY }, { text: "UNREACHED" }], false, { user: EDIT, deck: true, cfg: { sawUntrustedContent: true } }],
        ["refused, then claim", [slidesCall({ title: "T", slides: [cover, NODES_HUB()] }), { text: "Slide 9 has been replaced." }, { text: "UNREACHED" }], false, { user: EDIT, deck: true }],
        ["no deck, described", [{ text: "Here's your deck:\n\n**Slide 1 - Q3 in review**" }, slidesCall({ title: "T", slides: GOOD() }), { text: "Built." }], false, { user: "Make me a deck on our Q3 results", deck: false }],
        ["conversion unstarted, claim", [{ text: "Here's your deck: slide 1 is now the cover." }, { text: "Which title should the cover use?" }, { text: "UNREACHED" }], false,
          { user: "Convert the attached document into a deck", deck: false, attach: "--- Slide 1 ---\nA\n--- Slide 2 ---\nB" }],
        // Verifiers' confirmed cases (2026-09-15, second pass). The first two
        // regenerated the deck on a turn that asked for nothing; the third told
        // a user holding a real .pptx that no deck was built; the fourth
        // replayed an EMPTY assistant turn, which the Anthropic API rejects.
        ["approval after an edit", [{ text: "Glad it works. Slide 9 is now the two-column MeetingBrain slide." }, { text: "UNREACHED" }], false, { user: "Perfect, thanks!", deck: true }],
        ["comment-box question", [{ text: "The figure is right: slide 4 now shows 12%, which matches the Q3 report." }, { text: "UNREACHED" }], false, { user: COMMENT_QUESTION, deck: true }],
        ["pptx made with generate_document, then described", [{ tool: "generate_document", args: JSON.stringify({ title: "Q3 results", slides: [{ layout: "title", title: "Q3 results" }, { layout: "content", title: "Revenue", bullets: ["Up 12%"] }] }) }, { text: "Here's your deck as a PowerPoint file, ready to email." }, { text: "UNREACHED" }], false,
          { user: "Make me a pptx deck of our Q3 results I can email", deck: false, blob: true }],
        ["claim and a lookup, then an empty round", [{ text: "Replacing slide 9 with the two corrected MeetingBrain slides.", tool: "not_a_tool", args: "{}" }, {}, { text: "UNREACHED" }], false, { user: EDIT, deck: true }],
        // ── The reply does not open with its own plan (thumbs-down #7) ──
        //
        // Text written in a round that ENDED IN TOOL CALLS is pre-tool by
        // construction, so it is streamed and not saved. These drive the shapes
        // the flagged turn and its neighbours actually had.
        ["plan, tool, plan, tool, answer", [
          { text: PLAN_ONE, tool: "not_a_tool", args: '{"q":1}' },
          { text: PLAN_TWO, tool: "not_a_tool", args: '{"q":2}' },
          { text: ANSWER }], false],
        ["narration with no tool call is kept", [{ text: `${PAST_TENSE}\n\n${ANSWER}` }], false],
        ["a tool round with no text at all", [{ tool: "not_a_tool", args: '{"q":1}' }, { text: ANSWER }], false],
        ["every round narrates, the loop hits the cap", CAPPED_ROUNDS(), false, { forcedText: LATE_ANSWER }],
        // EVERY WORD OF THIS TURN IS INSIDE A SPAN, and the pass that would
        // have written more cannot run. The round cap is what ends it, because
        // only two of the four chains break on a no-progress round — a turn
        // shaped around that break would test half of them and something else
        // on the other half. It used to isolate the backstop; the bound now
        // reaches this case first (nothing clears a bar of zero), so the
        // backstop's own kill lives at verify-tool-loop-guard 9.
        ["every round narrates, and the forced final fails", CAPPED_ROUNDS(), false, { failForced: true }],
        // An ARTEFACT appended by an executor sits outside the span by
        // construction — this is the mutation the span design exists for.
        ["plan, then a pptx", [
          { text: PLAN_ONE, tool: "generate_document", args: JSON.stringify({ title: "Q3 results", slides: [{ layout: "title", title: "Q3 results" }, { layout: "content", title: "Revenue", bullets: ["Up 12%"] }] }) },
          { text: ANSWER }], false, { user: "Make me a pptx deck of our Q3 results I can email", deck: false, blob: true }],
        // BOTH COPIES ARE SCRUBBED, or the row keeps a fabricated link the
        // screen showed removed.
        ["a fabricated link in the answer", [
          { text: PLAN_ONE, tool: "not_a_tool", args: '{"q":1}' },
          { text: `${ANSWER} See [the signed contract](https://example.invalid/contract-255) for detail.` }], false],
        ["plan, then a refused deck", [
          { text: PLAN_ONE, tool: "generate_slides", args: JSON.stringify({ title: "T", slides: [cover, NODES_HUB()] }) },
          { text: ANSWER }], false],
        // ── A refused lookup says so, and only when it cost the user something ──
        ["seven distinct notebook searches", OVER_BUDGET("search_notebook", 7), false],
        ["four distinct calls to a tool nobody mapped", OVER_BUDGET("not_a_tool", 4), false],
        // Two different facts, and a turn can owe the user both.
        // The claim is BOTH the forced final's text and a scripted last round:
        // the Anthropic and xAI chains break on the refused round and reach it
        // through the forced pass, while Gemini and OpenAI carry on and reach
        // it as an ordinary round. Same turn, same two facts owed, either way.
        ["a cut-short lookup and an unmade deck change", OVER_BUDGET("search_memory", 4).concat([{ text: FALSE_REPLY }]), false, { user: EDIT, deck: true, forcedText: FALSE_REPLY }],
        // ── …and what the filter must NOT cut (the bound) ──
        //
        // "Pre-tool" says nothing about SIZE. Driven against these shapes, the
        // unbounded rule deleted real answers: a briefing that ended in a
        // lookup became the next round's "Done.", a text block emitted after
        // the tool_use block in the same message went with it, and a numbered
        // list was saved starting at item 3. A span is now cut only when it is
        // smaller than what survives it.
        ["an answer, then a lookup, then a sign-off", [
          { text: BRIEFING, tool: "not_a_tool", args: '{"q":1}' },
          { text: SIGNOFF }], false],
        // THE CONTROL, and the property it pins is monotonicity: the identical
        // turn ending silently keeps everything through the backstop, so
        // adding "Done." must not be what deletes the answer.
        ["an answer, then a lookup, and nothing after", [
          { text: BRIEFING, tool: "not_a_tool", args: '{"q":1}' },
          {}], false],
        // Anthropic emits this routinely: a text block AFTER the tool_use
        // block, in the SAME assistant message. It is inside the span too.
        ["text either side of the tool call", [
          { text: "Here is what the record shows.", tool: "not_a_tool", args: '{"q":1}', textAfter: AFTER_CALL },
          { text: SIGNOFF }], false],
        ["a numbered list split across a round", [
          { text: LIST_HEAD, tool: "not_a_tool", args: '{"q":1}' },
          { text: LIST_TAIL }], false],
        // The answer is longer than the sign-off but SHORTER than the notice
        // that follows it, so this turn only keeps its answer if the notices
        // are excluded from the measure of what survived.
        ["an answer, then a refused deck", [
          { text: BRIEFING, tool: "generate_slides", args: JSON.stringify({ title: "T", slides: [cover, NODES_HUB()] }) },
          { text: "Sorry — that did not work." }], false],
        // The shape item 3 exists for, with an answer above it.
        ["an answer, then a cut-short lookup", (() => { const s = OVER_BUDGET("search_notebook", 7); s[0] = { ...s[0], text: BRIEFING }; return s; })(), false],
        // AN IMAGE IS AN ARTEFACT TOO, and the only one whose handling this
        // change restructured: the duplicate-URL set inside `scrub` has to be
        // per COPY, or the saved row loses an image the screen kept.
        ["plan, then an image", [
          { text: PLAN_ONE, tool: "generate_image", args: JSON.stringify({ prompt: "a cover image" }) },
          { text: ANSWER }], false, { user: "Make me a cover image", deck: false, blob: true }],
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
          if (ENV_KEYS[k] === "BLOB_READ_WRITE_TOKEN" || ENV_KEYS[k] === "VERCEL_BLOB_API_URL") delete process.env[ENV_KEYS[k]];
          else process.env[ENV_KEYS[k]] = "verify-offline";
        }
        console.log = console.warn = console.error = console.info = () => {};
        for (let c = 0; c < CHAINS.length; c++) {
          for (let s = 0; s < SCENARIOS.length; s++) {
            const [name, steps, needsConv, opts] = SCENARIOS[s];
            const o: ScenarioOpts = opts || {};
            const user = o.user || "make me a deck";
            const deck = o.deck !== undefined ? o.deck : needsConv;
            // As the route computes it, so the chain sees what production would.
            const asked = asksForDeckChange(user, { deckInConversation: deck });
            script = steps; reqNo = 0; seenResults.length = 0; reqs.length = 0;
            forcedText = o.forcedText || "Forced final."; failForced = o.failForced === true;
            if (o.blob) {
              process.env.BLOB_READ_WRITE_TOKEN = "vercel_blob_rw_storefake_secretfake";
              process.env.VERCEL_BLOB_API_URL = `http://127.0.0.1:${port}/api/blob`;
            }
            try {
              let completed: any = null;
              const config: any = { model: CHAINS[c][1], imageGeneration: true, systemPrompt: "sys", source: "enginegpt", userEmail: "",
                conversationId: needsConv ? `verify38h-${CHAINS[c][0]}-${s}-${process.pid}-${Date.now()}` : null,
                deckEditAsked: asked, deckInConversation: deck, ...(o.cfg || {}) };
              const msg: any = { role: "user", content: user };
              if (o.attach) msg.attachments = [{ name: "source.pptx", type: "application/vnd.openxmlformats-officedocument.presentationml.presentation", extractedText: o.attach }];
              const stream = createStreamingResponse([msg], config, async (r: any) => { completed = r; });
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
              runs.push({ chain: CHAINS[c][0], name, asked, turn: { events, streamed, spoken: String((completed && completed.fullText) || ""), persisted: String((completed && completed.keptText) || ""), results: seenResults.slice(), reqs: reqs.slice() } });
            } catch (e: any) {
              runs.push({ chain: CHAINS[c][0], name, asked, threw: String((e && e.message) || e).slice(0, 120) });
            }
            // The blob store is for that one turn only: nothing else uploads.
            delete process.env.BLOB_READ_WRITE_TOKEN;
            delete process.env.VERCEL_BLOB_API_URL;
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
      // WHAT INVARIANT (i) ACTUALLY SEES. The first version of it named five
      // artefact markers and only ONE of them ever occurred in the corpus, so
      // four of its five branches were unreachable and a mutation that dropped
      // a legitimate image from the saved row survived the whole suite. A
      // marker earns its place here by being produced by a turn; these two are,
      // and the coverage assertion below is what keeps that true. A chart, a
      // video and the scheduled-proposal marker are deliberately NOT in the
      // list: nothing here builds one, and naming them would be four more
      // assertions that test nothing.
      const ARTEFACTS = ["📄", "!["];
      const artefactSeen: number[] = [];
      for (let a = 0; a < ARTEFACTS.length; a++) artefactSeen.push(0);
      for (let r = 0; r < runs.length; r++) {
        const { chain, name, asked, turn, threw } = runs[r];
        const tag = `${chain} chain, ${name}`;
        if (!turn) { fail(`${tag}: the turn threw: ${threw}`); continue; }
        const has = (k: string) => turn.events.filter((e) => e[k] !== undefined).length;
        // PRECONDITION: the chain under test is the one that ran. A fallback
        // means it threw and Grok answered, and every assertion below would be
        // about the wrong chain.
        if (has("fallback") || has("error")) { fail(`${tag}: the chain did not run (${JSON.stringify(turn.events.filter((e) => e.fallback || e.error)).slice(0, 120)}) — the harness is not testing it`); continue; }
        // EVERY turn: the deck-claim nudge is for the model and must never
        // reach the user, saved or streamed; and no turn runs a round past the
        // end of its script.
        if (/SYSTEM NOTE|never acknowledge or mention it/.test(turn.persisted + turn.streamed)) fail(`${tag}: the deck-claim nudge reached the user's text`);
        if (turn.persisted.indexOf("UNREACHED") >= 0 || turn.streamed.indexOf("UNREACHED") >= 0) fail(`${tag}: a model round ran past the end of the script`);
        // And no nudge ever follows an EMPTY assistant turn: the Anthropic API
        // rejects one, and the fake provider here would not.
        for (let q = 0; q < turn.reqs.length; q++) {
          if (turn.reqs[q].lastUserText.indexOf(DECK_CLAIM_NUDGE) >= 0 && !turn.reqs[q].prevText.trim()) fail(`${tag}: the deck-claim nudge follows an empty assistant turn (request ${q + 1})`);
        }
        const NOTICE = "⚠ **";
        const noticeIn = (s: string) => s.indexOf(NOTICE) >= 0;
        const persistedAndStreamed = (re: RegExp) => re.test(turn.persisted) && re.test(turn.streamed);
        // EVERY TURN, whatever it was testing. The persist-time filter runs on
        // all of them, so the three things it must never do are asserted on all
        // of them — every scenario in the file, not only the ones written for it.
        //
        // (i) AN ARTEFACT IS NEVER CUT. Image markdown and a download link are
        // appended by the EXECUTORS, after the round's text ends and before the
        // next round starts. A span that closed a line later would eat them, and the
        // reply would describe a file the user has no link to.
        for (let a = 0; a < ARTEFACTS.length; a++) {
          const said = turn.spoken.split(ARTEFACTS[a]).length - 1;
          if (said > 0) artefactSeen[a]++;
          if (said > 0 && turn.persisted.split(ARTEFACTS[a]).length - 1 < said) {
            fail(`${tag}: the artefact marker "${ARTEFACTS[a]}" appears ${said} time(s) in what was streamed and fewer on the saved row — the filter ate something an executor made`);
          }
        }
        // (ii) FILTERING ONLY EVER REMOVES. Anything the saved copy contains
        // must appear, in order, in what was said — nothing may be invented at
        // persist time.
        const isSubsequence = (needle: string, hay: string) => {
          let j = 0;
          for (let i = 0; i < needle.length && j < hay.length; i++) {
            while (j < hay.length && hay[j] !== needle[i]) j++;
            if (j < hay.length) j++; else return false;
          }
          return true;
        };
        if (!isSubsequence(turn.persisted, turn.spoken)) fail(`${tag}: the saved text is not a subsequence of what was said — the filter invented something`);
        // (iii) A TURN NEVER SAVES A BLANK ROW, and never opens on debris. The
        // notices are separated from the text above them by a `---`, so a reply
        // whose only survivor is a notice would otherwise open on an orphan
        // horizontal rule.
        if (turn.spoken.trim() && !turn.persisted.trim()) fail(`${tag}: ${turn.spoken.trim().length} chars were streamed and the row saved nothing`);
        if (turn.persisted !== turn.persisted.trim()) fail(`${tag}: the saved text opens or ends on whitespace`);
        if (/^---/.test(turn.persisted)) fail(`${tag}: the saved text opens on an orphan horizontal rule`);
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
        } else if (name === "plan, tool, plan, tool, answer") {
          // THE FLAGGED TURN'S SHAPE. Both plans were watched; neither is saved.
          if (turn.streamed.indexOf(PLAN_ONE) < 0 || turn.streamed.indexOf(PLAN_TWO) < 0) fail(`${tag}: the narration never reached the screen — pulling text back is not what this does`);
          if (turn.persisted.indexOf(PLAN_ONE) >= 0 || turn.persisted.indexOf(PLAN_TWO) >= 0) fail(`${tag}: a plan paragraph written before a tool call is in the transcript (${turn.persisted.slice(0, 120)})`);
          if (turn.persisted.trim() !== ANSWER) fail(`${tag}: the saved reply is not the answer alone (${JSON.stringify(turn.persisted.slice(0, 160))})`);
          if (turn.spoken.length <= turn.persisted.length) fail(`${tag}: PRECONDITION — nothing was cut, so this scenario proves nothing (spoken ${turn.spoken.length}, saved ${turn.persisted.length})`);
        } else if (name === "narration with no tool call is kept") {
          // THE OTHER DIRECTION, and the reason the rule is structural rather
          // than a shape test: this paragraph reads exactly like a plan and is
          // not one, because the round called nothing.
          if (turn.persisted.indexOf(PAST_TENSE) < 0) fail(`${tag}: text from a round that called no tool was dropped`);
          if (turn.persisted !== turn.spoken) fail(`${tag}: a turn with no tool round saved something other than what it said`);
        } else if (name === "a tool round with no text at all") {
          if (turn.persisted.trim() !== ANSWER) fail(`${tag}: a silent tool round left something behind (${JSON.stringify(turn.persisted.slice(0, 120))})`);
        } else if (name === "every round narrates, the loop hits the cap") {
          if (turn.reqs.length !== 9) fail(`${tag}: PRECONDITION — expected 8 rounds and a forced final, got ${turn.reqs.length} requests`);
          if (turn.streamed.indexOf("Round 0: still pulling.") < 0) fail(`${tag}: the rounds never reached the screen`);
          if (/Round \d: still pulling\./.test(turn.persisted)) fail(`${tag}: a capped turn saved its narration (${turn.persisted.slice(0, 120)})`);
          if (turn.persisted.trim() !== LATE_ANSWER) fail(`${tag}: the saved reply is not the forced final's answer (${JSON.stringify(turn.persisted.slice(0, 160))})`);
        } else if (name === "every round narrates, and the forced final fails") {
          // THE BACKSTOP. Every word is inside a span and nothing came after
          // it, so the whole text is kept rather than the row going blank.
          if (turn.reqs.filter((q) => q.forced).length < 1) fail(`${tag}: PRECONDITION — no forced final was attempted, so the backstop was never reached`);
          if (turn.persisted !== turn.spoken) fail(`${tag}: a turn whose whole text was pre-tool did not keep it (saved ${turn.persisted.length} of ${turn.spoken.length} chars)`);
          if (turn.persisted.indexOf("Round 0: still pulling.") < 0) fail(`${tag}: the only text this turn had is not on the row`);
        } else if (name === "plan, then a pptx") {
          if (has("document_ready") !== 1) fail(`${tag}: PRECONDITION — no .pptx was built (${JSON.stringify(turn.events.map((e) => Object.keys(e)[0]))}), so the artefact is not there to lose`);
          if (turn.persisted.indexOf("📄") < 0 || turn.persisted.indexOf("Download") < 0) fail(`${tag}: the download link was cut with the paragraph above it (${JSON.stringify(turn.persisted.slice(0, 160))})`);
          if (turn.persisted.indexOf(PLAN_ONE) >= 0) fail(`${tag}: the plan paragraph is on the row`);
          if (turn.streamed.indexOf(PLAN_ONE) < 0) fail(`${tag}: the plan never reached the screen`);
        } else if (name === "a fabricated link in the answer") {
          if (turn.persisted.indexOf("https://example.invalid") >= 0) fail(`${tag}: the saved copy kept a fabricated link the screen was shown without`);
          if (turn.spoken.indexOf("https://example.invalid") >= 0) fail(`${tag}: PRECONDITION — the streamed copy kept it too, so the link strip is not running at all`);
          if (turn.persisted.indexOf("the signed contract") < 0) fail(`${tag}: the link's own words were dropped with it`);
        } else if (name === "plan, then a refused deck") {
          // A TURN THAT ENDS REFUSED still says so: the end-of-turn notices are
          // appended after the loop, so they sit outside every span.
          if (!persistedAndStreamed(/The deck was not built\./)) fail(`${tag}: the refusal notice did not survive the filter (${turn.persisted.slice(0, 160)})`);
          if (turn.persisted.indexOf(PLAN_ONE) >= 0) fail(`${tag}: the plan written before the refused call is on the row`);
          if (turn.streamed.indexOf(PLAN_ONE) < 0) fail(`${tag}: the plan never reached the screen`);
        } else if (name === "seven distinct notebook searches") {
          const u = turn.events.filter((e) => e.token !== undefined).length;
          if (!persistedAndStreamed(/A lookup was cut short\./)) fail(`${tag}: a lookup that ran out of ITS OWN allowance said nothing, saved or streamed (${u} tokens, ${turn.persisted.slice(0, 200)})`);
          if (turn.persisted.indexOf("your notebook") < 0) fail(`${tag}: the notice does not name what was not reached (${turn.persisted.slice(-260)})`);
          if (turn.persisted.indexOf("search_notebook") >= 0) fail(`${tag}: the notice shows the user a machine name`);
        } else if (name === "four distinct calls to a tool nobody mapped") {
          if (/A lookup was cut short\./.test(turn.persisted + turn.streamed)) fail(`${tag}: a tool nobody mapped produced a sentence about what the turn failed to read`);
        } else if (name === "a cut-short lookup and an unmade deck change") {
          if (!asked) fail(`${tag}: PRECONDITION — the ask gate does not read this as a deck request, so only one notice could ever fire`);
          const deckAt = turn.persisted.indexOf("The deck was not changed.");
          const cutAt = turn.persisted.indexOf("A lookup was cut short.");
          if (deckAt < 0 || cutAt < 0) fail(`${tag}: a turn owing the user two different facts carried ${turn.persisted.split(NOTICE).length - 1} notice(s) (${turn.persisted.slice(-300)})`);
          else if (deckAt > cutAt) fail(`${tag}: the cut-short notice runs before the deck notice, so the deck family's one-a-turn rule can see it and fall silent`);
          if (turn.persisted.indexOf("your saved memories") < 0) fail(`${tag}: the cut-short notice does not name the source`);
        } else if (name === "an answer, then a lookup, then a sign-off" || name === "an answer, then a lookup, and nothing after") {
          // THE BOUND. Every word of the briefing is inside a span, and it is
          // larger than everything after it, so it stays. Measured: the
          // unbounded filter saved "Done." here and threw 210 characters away.
          if (turn.streamed.indexOf(BRIEFING) < 0) fail(`${tag}: PRECONDITION — the briefing never reached the screen, so nothing was there to lose`);
          if (turn.persisted.indexOf(BRIEFING) < 0) fail(`${tag}: a round that answered and then reached for one more tool lost its answer (saved ${JSON.stringify(turn.persisted.slice(0, 120))})`);
        } else if (name === "text either side of the tool call") {
          if (turn.streamed.indexOf(AFTER_CALL) < 0) fail(`${tag}: PRECONDITION — this chain never emitted the text after the tool call, so the span's reach is untested here`);
          else if (turn.persisted.indexOf(AFTER_CALL) < 0) fail(`${tag}: a text block emitted after the tool_use block in the same message was cut from the transcript`);
        } else if (name === "a numbered list split across a round") {
          if (turn.persisted.indexOf("1. Contract 255") < 0) fail(`${tag}: the saved reply is a numbered list starting at item 3 (${JSON.stringify(turn.persisted.slice(0, 80))})`);
          if (turn.persisted.indexOf(LIST_TAIL) < 0) fail(`${tag}: the rest of the list is missing`);
        } else if (name === "an answer, then a refused deck") {
          // This answer is longer than the sign-off after it and SHORTER than
          // the notice after that, so it survives only if the deterministic
          // notices are excluded from the measure of what survived.
          if (!persistedAndStreamed(/The deck was not built\./)) fail(`${tag}: the refusal notice did not survive (${turn.persisted.slice(0, 160)})`);
          const noticeAt = turn.spoken.indexOf("\n\n---\n\n⚠");
          if (noticeAt < 0 || turn.spoken.length - noticeAt <= BRIEFING.length) fail(`${tag}: PRECONDITION — the notice is not longer than the answer under it, so this turn cannot tell the two measures apart`);
          if (turn.persisted.indexOf(BRIEFING) < 0) fail(`${tag}: the end-of-turn notice counted as surviving answer text, so the answer above it was cut (saved ${JSON.stringify(turn.persisted.slice(0, 120))})`);
        } else if (name === "an answer, then a cut-short lookup") {
          if (!persistedAndStreamed(/A lookup was cut short\./)) fail(`${tag}: the cut-short notice did not survive (${turn.persisted.slice(-200)})`);
          if (turn.persisted.indexOf(BRIEFING) < 0) fail(`${tag}: the turn the notice exists for lost the very answer the notice is about (saved ${JSON.stringify(turn.persisted.slice(0, 120))})`);
        } else if (name === "plan, then an image") {
          if (has("image_ready") !== 1) fail(`${tag}: PRECONDITION — no image was generated (${JSON.stringify(turn.events.map((e) => Object.keys(e)[0]))}), so the artefact is not there to lose`);
          else {
            // ONE image, saved and streamed once. The dedupe set inside the
            // scrub has to be per COPY: shared between the two passes, the
            // saved row loses an image the screen was shown.
            if (turn.spoken.split("![").length - 1 !== 1) fail(`${tag}: PRECONDITION — the streamed copy carries ${turn.spoken.split("![").length - 1} images, so a lost one would not be visible as a loss`);
            if (turn.persisted.split("![").length - 1 !== 1) fail(`${tag}: the saved row carries ${turn.persisted.split("![").length - 1} images where the screen carried one — an image the executor appended did not survive to the row (the likeliest cause is a duplicate-URL set shared between the two scrub passes)`);
            if (turn.persisted.indexOf("/api/media/") < 0) fail(`${tag}: the image's URL was stripped from the saved row`);
          }
          if (turn.persisted.indexOf(PLAN_ONE) >= 0) fail(`${tag}: the plan paragraph above the image is on the row`);
        } else {
          // The deck-claim guard. Check 40 holds its units, corpus and wiring.
          const notices = turn.persisted.split(NOTICE).length - 1;
          const nudged = turn.reqs.filter((q) => q.lastUserText.indexOf(DECK_CLAIM_NUDGE) >= 0).length;
          const summary = `requests=${turn.reqs.length} nudged=${nudged} drafts=${has("slides_draft")} notices=${notices}`;
          const onceIn = (s: string, needle: string) => s.split(needle).length - 1 === 1;
          const retryShape = (i: number, first: string) => {
            const q = turn.reqs[i];
            if (!q) { fail(`${tag}: there is no request ${i + 1} (${summary})`); return; }
            if (q.forced || q.offered.indexOf("generate_slides") < 0 || q.prevRole !== "assistant") fail(`${tag}: the retry is not a tools-on round offering generate_slides after the assistant's own text (forced=${q.forced}, previous message ${q.prevRole || "none"})`);
            if (q.prevText.indexOf(first) !== 0) fail(`${tag}: the assistant text replayed before the nudge is not the claiming round's own (${JSON.stringify(q.prevText.slice(0, 50))})`);
          };
          if (name === "claim, retry calls" || name === "no deck, described") {
            if (!asked) fail(`${tag}: PRECONDITION — the ask gate does not read the user's message as a request, so this scenario tests nothing`);
            if (turn.reqs.length !== 3 || nudged !== 1 || has("slides_draft") !== 1 || notices !== 0) fail(`${tag}: expected 3 requests, 1 nudge, 1 draft and no notice (${summary})`);
            const first = name === "claim, retry calls" ? FALSE_FIRST : "Here's your deck";
            retryShape(1, first);
            if (!onceIn(turn.persisted, first) || !onceIn(turn.streamed, first)) fail(`${tag}: the claim is not on screen exactly once, saved and streamed`);
          } else if (name === "text and a lookup, then claim") {
            if (turn.reqs.length !== 4 || nudged !== 1 || has("slides_draft") !== 1 || notices !== 0) fail(`${tag}: expected 4 requests, 1 nudge, 1 draft and no notice (${summary})`);
            retryShape(2, FALSE_FIRST);
            // Round 0 narrated and then called a tool, so it was watched and is
            // not saved. The claim in round 1 called nothing and stays.
            if (turn.streamed.indexOf("Checking the deck first.") < 0) fail(`${tag}: the round's narration never reached the screen`);
            if (turn.persisted.indexOf("Checking the deck first.") >= 0) fail(`${tag}: a round that ended in a tool call wrote its narration to the transcript`);
          } else if (name === "claim, retry asks") {
            if (turn.reqs.length !== 2 || nudged !== 1) fail(`${tag}: expected 2 requests and 1 nudge (${summary})`);
            if (notices !== 1 || !onceIn(turn.persisted, "The deck was not changed.") || !onceIn(turn.streamed, "The deck was not changed.")) fail(`${tag}: "The deck was not changed." is not saved and streamed exactly once (${summary})`);
            const joined = "12 slides total.\n\nShould the cards be blue or teal?";
            if (turn.persisted.indexOf(joined) < 0 || turn.streamed.indexOf(joined) < 0) fail(`${tag}: the retry's text is not set apart from the claim by a blank line, saved and streamed`);
          } else if (name === "claim, retry claims again") {
            if (turn.reqs.length !== 2 || nudged !== 1 || notices !== 1) fail(`${tag}: the retry is not bounded to one, with one notice after it (${summary})`);
          } else if (name === "real call, then narration") {
            if (turn.reqs.length !== 2 || nudged || notices) fail(`${tag}: a turn whose deck was drawn is nudged or given a notice (${summary})`);
          } else if (name === "question, no ask") {
            if (asked) fail(`${tag}: PRECONDITION — the ask gate reads a question about the deck as a request`);
            if (turn.reqs.length !== 1 || nudged || notices) fail(`${tag}: an honest answer to a question is nudged or given a notice (${summary})`);
          } else if (name === "claim, slides not offered" || name === "claim, tainted") {
            if (turn.reqs.length !== 1 || nudged || notices !== 1 || !/The deck was not changed\./.test(turn.streamed)) fail(`${tag}: expected no retry and one streamed notice (${summary})`);
          } else if (name === "refused, then claim") {
            if (nudged || notices !== 1 || !/could not be drawn/.test(turn.persisted)) fail(`${tag}: expected the refusal notice alone (${summary})`);
          } else if (name === "conversion unstarted, claim") {
            if (!asked) fail(`${tag}: PRECONDITION — the ask gate does not read a conversion request as a request`);
            if (notices !== 1 || turn.persisted.indexOf("No deck was built in this turn.") < 0 || turn.persisted.indexOf("No deck was built or changed.") >= 0) fail(`${tag}: expected the conversion notice alone (${summary})`);
          } else if (name === "approval after an edit" || name === "comment-box question") {
            if (asked) fail(`${tag}: PRECONDITION — the ask gate reads this message as a request, so this scenario tests the retry and not the gate`);
            if (turn.reqs.length !== 1 || nudged || notices) fail(`${tag}: a message that asked for no change is nudged or given a notice (${summary})`);
          } else if (name === "pptx made with generate_document, then described") {
            if (!asked) fail(`${tag}: PRECONDITION — the ask gate does not read a pptx request as a request, so the tool gate is untested`);
            if (has("document_ready") !== 1) fail(`${tag}: PRECONDITION — no .pptx was built (${JSON.stringify(turn.events.map((e) => Object.keys(e)[0]))}), so this is not the turn it names`);
            if (turn.reqs.length !== 2 || nudged || notices) fail(`${tag}: a turn that built a .pptx is nudged toward generate_slides or told no deck was built (${summary})`);
          } else if (name === "claim and a lookup, then an empty round") {
            if (nudged) fail(`${tag}: a round with no text was retried (${summary})`);
            if (notices !== 1 || !onceIn(turn.persisted, "The deck was not changed.") || !onceIn(turn.streamed, "The deck was not changed.")) fail(`${tag}: "The deck was not changed." is not saved and streamed exactly once (${summary})`);
          } else {
            fail(`${tag}: no assertions for this scenario — a turn run and never judged proves nothing`);
          }
        }
      }
      // INVARIANT (i) MUST HAVE SOMETHING TO SEE. It reads as the strongest
      // assertion in this block and it is worthless for any marker no turn
      // produces — four of its original five markers occurred in zero of 132
      // turns, and a mutation that dropped a legitimate image from the saved
      // row walked through the whole suite. A marker stays on the list only
      // while a turn still makes one.
      for (let a = 0; a < ARTEFACTS.length; a++) {
        if (artefactSeen[a] < 1) fail(`38h: no turn produced the artefact marker "${ARTEFACTS[a]}", so the assertion guarding it tested nothing — give it a scenario or take it off the list`);
        else pass(`38h: "${ARTEFACTS[a]}" survives the filter on ${artefactSeen[a]} turn(s) that made one`);
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

  /* 40. A deck change the user asked for is made, or the reply says it was not.
   *
   * THE INCIDENT, 2026-09-15 (thread 04c5d402). A deck edit ran on
   * claude-sonnet-5, ended round 0 with stop_reason=end_turn and no tool call,
   * and replied "Slide 9 ... is gone, replaced by two more accurate slides" and
   * "The deck is now 12 slides total". Nothing had changed, and nothing in any
   * chain could notice: a round with no call and a normal stop is a finished
   * answer. lib/slides/claim.ts now gives such a turn ONE more round with tools
   * on and, if it still ends with no call, appends "The deck was not changed."
   * — but only when the user's own message asked for a change, because the
   * reply rules alone fired on 11 of 13 honest replies about REAL earlier edits,
   * and a notice saying a change did not happen is false on every one of them.
   *
   * What is asserted:
   *   a) the corpus — 115 [user, reply] pairs scored as the guard fires (ask AND
   *      claim), the verbatim incident the last of them: zero false positives
   *      and zero false negatives, over at least 40 positives and 25 negatives
   *      (72 and 43 today). 45 of them are the verifiers' confirmed cases from
   *      the second pass: approvals, the deck as the source of a Word document,
   *      a post or a summary, a question in the comment box, options, and the
   *      false claims and asks the first rules missed;
   *   b) ABLATION: every claim rule, TEMPORAL, NEGATORS, LEADS, HYPOTHETICAL and
   *      the question skip carries at least one case alone; reverting each
   *      widening (the follow-up split, clause-scoped negation, the
   *      user-message strip) loses a positive; every ask switch changes a case;
   *      and with no ask gate at least 28 honest no-ask replies fire. A detector
   *      that carries nothing exits 2 — it is untested, which is not the same as
   *      passing;
   *   c) the retry gate and the notice, unit by unit, including the tool gate
   *      (a Word document, .pptx, chart, image or video made this turn), the
   *      empty-round gate, lastAssistantReply and endsInDeckChangeQuestion;
   *   f) USE, read from comment-stripped source as 38 (f) is: in all four
   *      chains the retry is the else of the cut-off test, with the gate's
   *      arguments (the loop's own `round`, whether this round has text to
   *      replay, the tools used this turn), this round's text replayed, and
   *      `continue`; at all four end sites the notice reads spokenText and the
   *      tools used, comes after the unresolved notice, and is appended and
   *      streamed; and the route computes the ask from the user's message, read
   *      against lastAssistantReply(messages), and passes it.
   * Check 38 (h) drives it: fifteen turns in all four chains through the real
   * createStreamingResponse, with no "SYSTEM NOTE" in any turn's saved or
   * streamed text and no nudge after an empty assistant turn.
   *
   * KNOWN LIMITATIONS, the owner's decisions (2026-09-15). The corpus is
   * written, not calibrated: the calibration over stored ai_messages reads
   * other users' chats and has not been run. English only. The gate is per
   * turn. No slide-count line after a successful retry, so the kept narration
   * can disagree with the deck. A provider fallback leg inherits the failed
   * leg's slidesTurn. Slide edits are NOT exempt from the web-search override,
   * so plain deck edits still reach Claude, and this guard is what covers them.
   * Also accepted after the second pass: the retry round's own text streams as
   * it arrives, so a model that answers the nudge ("You're right, nothing
   * changed") shows that answer, and the nudge's "never acknowledge" is the
   * only guard; a request that uses the deck's numbers for a chart or an image
   * reads as an ask, and only the tool gate holds it; and an honest
   * confirmation of an earlier edit, on a turn that asks for a new one, gets
   * the notice, which stays true (the "accepted" pair in the corpus).
   *
   * MUTATION LOG (detached worktree on the real edit, 2026-09-15), 16 planned
   * mutations and three extras, each run through this whole script. "harness"
   * is check 38 (h); the letters are this check's parts. The baseline passed.
   *   killed  R0 providers.ts back at HEAD 856d73c, claim.ts present: 44
   *           harness failures (every claim scenario, all four chains) and 13
   *           in (f). Without the fix this goes red
   *   killed  K1 xAI retry `break` instead of `continue`, and K13 the same on
   *           Anthropic: by the harness and (f)
   *   killed  K2 Anthropic's offered reading tools, not roundTools: by the
   *           harness (a tainted turn retried) and (f)
   *   killed  K3 Gemini replaying the whole turn's text: by the harness (text
   *           and a lookup, then claim) and (f)
   *   killed  K4 OpenAI notice appended but not streamed; K5 Gemini notice with
   *           alreadySaid:false (two notices on the conversion turn); K6 OpenAI
   *           retry never recorded; K7 xAI retry ignoring the ask; K12 OpenAI
   *           nudge pushed with no assistant text before it: each by the
   *           harness and (f)
   *   killed  K8 the notice ignoring the ask; K9 the retry ignoring a call that
   *           reached the builder; K16 the retry ignoring offered: by (c) and by
   *           the harness
   *   killed  K10 a retry allowed on the last round; K11 the time budget
   *           ignored: by (c) ONLY. No scenario runs eight rounds or 165 seconds
   *   killed  K14 the claim predicate never firing: by (a) on every positive,
   *           by (b) (exit 2), by (c) and by the harness
   *   SURVIVED the harness, killed by (f) only: K15, the xAI notice reading
   *           fullText instead of spokenText. It behaves the same, because
   *           alreadySaid already holds the notice back once fullText has grown,
   *           so only a source read can see the change. Recorded as a finding about
   *           the harness, not tidied away
   *   killed  X1 aiConfigRef no longer passing deckEditAsked: by (f) ONLY. The
   *           harness builds its own config, so no behavioural check here can
   *           see the route drop the ask
   *   killed  X2 the ask gate reading quoted copy as the ask: by (a), the
   *           quoted "Please update the deck" email firing, and by (b)
   *   killed  X3 the xAI retry leaking the nudge into the reply: by the
   *           harness's every-turn assertion, "the deck-claim nudge reached the
   *           user's text". So that assertion is not vacuous
   * A FINDING about this check itself, not a kill. (b) first asserted that EVERY
   *   no-ask decoy fires without the ask gate, and went red on its first run:
   *   "Update the document's MeetingBrain section" neither asks for a deck
   *   change nor claims one. (b) now holds the count that fires.
   *
   * SECOND MUTATION LOG (detached worktree on the real edit, after the
   * verifiers' second pass, 2026-09-15), 51 mutations, each run through this
   * whole script. The baseline passed. All 51 were killed; none survived.
   *   killed  R0 providers.ts back at HEAD: 52 harness failures and 13 in (f)
   *   killed  K1-K16 and X1-X3, re-anchored on the current text, by the same
   *           parts as above. K15 still passes the harness and is killed by
   *           (f) alone; K10 and K11 are killed by (c) alone
   *   killed  N1 and N2, the retry gate told it is always round 0 (xAI,
   *           Anthropic), and N4, the route never reading the previous reply:
   *           by (f) ONLY. All three SURVIVED the first log, because (f)
   *           pinned neither `round` nor the reply
   *   killed  N6, the OpenAI retry's blank line removed: by the harness ONLY,
   *           since "claim, retry asks" now asserts it. It SURVIVED the first log
   *   killed  C1 an approval read as an ask whenever a deck is in the
   *           conversation; C4 the comment template not recognised; C25 every
   *           comment an ask: by (a), (b) and the harness
   *   killed  C2 the retry ignoring replayable: by (c) and the harness ("claim
   *           and a lookup, then an empty round"); C15 and C16 replayable
   *           always true on Anthropic and xAI: by the harness and (f)
   *   killed  C3 the source blocker, C5 the options skip, C12 the offer check,
   *           C26 the cover-page and deck-link guard removed: by (a) and (b)
   *   killed  C6 the follow-up split, C7 the user-message strip, C8 negation
   *           back to the sentence prefix, C9 the slide-field exemption, C10
   *           polite requests skipped, C11 the short-answer path, C19 LEADS,
   *           C20 HYPOTHETICAL, C21 the bare-participle rule, C22 the how-about
   *           rule, C27 the new count and passive alternatives: by (a)
   *   killed  C13 and C14 the retry and the notice ignoring another
   *           deliverable: by (c) and the harness (".pptx made with
   *           generate_document"); C17 Gemini's notice and C18 OpenAI's retry
   *           passed no tools: by the harness and (f)
   *   killed  C23 lastAssistantReply finding nothing and C24 the no-deck notice
   *           back to "there is no deck yet": by (c) ONLY
   * A FINDING about this check itself. Once negation was scoped to the clause,
   *   LEADS and HYPOTHETICAL held every asked decoy NEGATORS used to carry, so
   *   (b) went red on "without NEGATORS no asked decoy fires". "None of the
   *   slides have been replaced" is the decoy it carries alone.
   */
  const before40 = failures;
  // Detectors that carry no case (b). Counted apart from failures so the
  // script exits 2 for them: the check did not fail, it stopped measuring.
  let deadDetectors = 0;
  const dead = (m: string) => { deadDetectors++; fail(m); };
  console.log(`\n40. A deck change the user asked for is made, or the reply says it was not`);
  {
    try {
      const INCIDENT_USER = "Update the MeetingBrain part of this deck. Remove slide 9 (\"MeetingBrain writes up your meetings\") and put these two slides in its place, as new slides 9 and 10. Keep every other slide exactly as it is. The old slide 9 overstated two things (no bot joins calls, and prep briefs are on request, not automatic), so it goes rather than being kept. Use hyphens, never em or en dashes.\n\nNew slide 9. two-column - title \"MeetingBrain: meetings in, {actions} out\", subtitle \"Your calendar is checked every 15 minutes. No bot joins your calls.\", columns left \"What goes in\" and right \"What comes out\", tones [\"blue\", \"teal\"]. body, four lines: \"Gemini or Google Docs notes on the invite, read automatically\" / \"A recording made in Chrome or Edge\" / \"An uploaded audio or video file, up to 500 MB\" / \"A pasted transcript\". bodyRight, four lines: \"A summary, key topics and next steps\" / \"A client-ready summary you edit and copy\" / \"Action items pulled from meetings, email and Slack\" / \"The transcript, shared with colleagues who were there\".\n\nNew slide 10. cards - title \"MeetingBrain and EngineAI, {together}\", subtitle \"Your meetings feed straight into EngineAI\". cards: \"Prepare me\" body \"One click before a meeting: where things stand, who is coming, open actions.\" icon sparkles tone blue; \"Ask about your meetings\" body \"In a private chat, EngineAI reads your meetings, transcripts and open tasks.\" icon message-square tone teal; \"The secure bridge\" body \"Your Google, Microsoft and Slack connections live in MeetingBrain. EngineAI borrows them.\" icon lock tone amber. note \"Invite-only: an admin adds you at meetingbrain.ai/admin. Your own meetings and tasks only show in private chats.\"";
      const INCIDENT_REPLY = "Replacing slide 9 with the two corrected MeetingBrain slides, everything else untouched.\n\nSlide 9 (the old \"MeetingBrain writes up your meetings\") is gone, replaced by two more accurate slides:\n\n**New slide 9 — MeetingBrain: meetings in, actions out.** Two-column layout making clear no bot joins calls and capture works via calendar check every 15 minutes: notes docs, screen recordings, uploaded files or pasted transcripts go in; summaries, action items and shareable transcripts come out.\n\n**New slide 10 — MeetingBrain and EngineAI, together.** Three cards: \"Prepare me\" (on-demand, not automatic), \"Ask about your meetings,\" and \"The secure bridge\" (where the connections actually live), with the note on invite-only access and privacy scope.\n\nThe deck is now 12 slides total, with AuthorityOn and the closing slide shifted to 11 and 12. Nothing's published — still a preview for you to review or send to Drive when ready.";
      // The incident's request cut after new slide 9's subtitle: the first
      // fixture the guard was designed on, kept so the numbers below are stable.
      const INCIDENT_USER_CUT = "Update the MeetingBrain part of this deck. Remove slide 9 (\"MeetingBrain writes up your meetings\") and put these two slides in its place, as new slides 9 and 10. Keep every other slide exactly as it is. The old slide 9 overstated two things (no bot joins calls, and prep briefs are on request, not automatic), so it goes rather than being kept. Use hyphens, never em or en dashes.\n\nNew slide 9. two-column - title \"MeetingBrain: meetings in, {actions} out\", subtitle \"Your calendar is checked every 15 minutes. No bot joins your calls.\"";
      const EDIT = "Replace slide 9 with these two slides";
      // The reply a bare "yes go ahead" answers.
      const OFFER = "Want me to replace slide 9 with those two slides?";
      // A question typed into ChatPanel's slide comment box, wrapped as the
      // client wraps every comment.
      const COMMENT_Q = "On slide 4 (\"Pricing\") of \"Q3 review\": is this 12% figure right?\n\nChange only that slide. Leave every other slide exactly as it is, and resend the complete deck.";
      // [user, reply, deck in the conversation, the guard should fire, why,
      //  the reply the user's message answers (default OFFER)]
      type Pair = [string, string, boolean, boolean, string, string?];
      const PAIRS: Pair[] = [
        // --- must fire: change asked, change claimed, no call
        [INCIDENT_USER_CUT, INCIDENT_REPLY, true, true, "the incident, its request cut after new slide 9's subtitle"],
        [EDIT, "Inserting the Writer and Optimiser slides after slide 6, leaving the rest of the deck untouched.\n\nTwo slides are now in after the live-demo slide. The rest of the deck is unchanged.", true, true, "the real insert narration copied with no call"],
        [EDIT, "Done — slide 9 is now two slides: a two-column on what goes in and out, and cards on how MeetingBrain feeds EngineAI.", true, true, "slide N is now"],
        [EDIT, "I've removed slide 9 and added the two new MeetingBrain slides in its place.", true, true, "first person"],
        [EDIT, "The deck has been updated: slide 9 is replaced by the two corrected slides, and everything else is untouched.", true, true, "passive"],
        [EDIT, "Here's the updated deck with the MeetingBrain slides swapped in.", true, true, "updated artefact"],
        [EDIT, "Swapped the old slide 9 for two new ones. The deck now has 13 slides.", true, true, "past opener + count"],
        ["Change slide 3's title to Q3 in review", "Updated. The title on slide 3 now reads \"Q3 in review\".", true, true, "patch claim"],
        [EDIT, "Replacing slide 9 with the two corrected MeetingBrain slides, everything else untouched.", true, true, "gerund narration alone"],
        ["Swap the picture on slide 1 for the Zurich skyline", "The picture on slide 1 has been swapped for a photo of the Zurich skyline.", true, true, "picture"],
        ["Rebuild the deck with hyphens instead of dashes", "I rebuilt the deck with hyphens instead of dashes throughout.", true, true, "rebuild"],
        ["Make slide 4 a hub diagram", "Slide 4 is now a hub diagram with 8 connections.", true, true, "layout change"],
        [EDIT, "Slide 9 is out; the new MeetingBrain slides sit at 9 and 10.", true, true, "colloquial removal"],
        [EDIT, "Made the swap: two MeetingBrain slides where slide 9 used to be.", true, true, "colloquial replacement"],
        [EDIT, "All set. Two new slides are in place of the old slide 9, and the other slides are unchanged.", true, true, "rest unchanged"],
        ["Add a pricing slide at the end", "That brings the deck to 13 slides.", true, true, "count only"],
        ["Move AuthorityOn to the front of the presentation", "The presentation has been reordered so AuthorityOn comes first.", true, true, "passive only"],
        [EDIT, "The old MeetingBrain slide is swapped out for two more accurate slides.", true, true, "replaced-by only"],
        [EDIT, "Removed the old MeetingBrain slide and moved AuthorityOn up one.", true, true, "past opener only"],
        // judge's adversarial false claims
        [EDIT, "✅ Old slide 9 removed\n✅ New slides 9 and 10 added\n✅ Everything else unchanged", true, true, "checklist"],
        [EDIT, "Done! The MeetingBrain section now has two slides in place of the old one.", true, true, "in place of"],
        [EDIT, "Your deck is ready with the two new MeetingBrain slides.", true, true, "deck is ready"],
        [EDIT, "The two new slides are in, and the old one is out.", true, true, "no numbers"],
        [EDIT, "All sorted - slides 9 and 10 are the new MeetingBrain slides, and the old slide 9 has gone.", true, true, "has gone"],
        [EDIT, "The update is done: two new MeetingBrain slides now sit at 9 and 10.", true, true, "slides now sit"],
        [EDIT, "Changes applied. The deck now runs 13 slides.", true, true, "now runs N"],
        [EDIT, "I went ahead and replaced slide 9 with the two new slides.", true, true, "went ahead and"],
        [EDIT, "Slide 9 → gone. Slides 9-10 → the new MeetingBrain pair.", true, true, "arrows"],
        ["Make the cover title shorter", "Shortened the cover title to \"Q3 review\".", true, true, "cover + shortened"],
        ["Swap the cover photo for the Zurich skyline", "The cover now shows the Zurich skyline.", true, true, "cover now shows"],
        [EDIT, "Here you go - the two new MeetingBrain slides replace the old slide 9.", true, true, "present replace"],
        [EDIT, "Sure! Replaced slide 9 with the two new MeetingBrain slides and kept everything else as is.", true, true, "Sure! opener"],
        ["yes go ahead", "Done - slide 9 has been replaced with the two new slides.", true, true, "affirmative after an offer"],
        ["Make me a 6-slide deck on our Q3 results", "Here's your deck:\n\n**Slide 1 - Q3 in review**\n**Slide 2 - Revenue up 12%**", false, true, "a new deck described, never built"],
        // sole-rule positives for the three rules that carried nothing alone
        [EDIT, "Old slide 9 removed; the MeetingBrain pair follows.", true, true, "ref-participle only"],
        [EDIT, "Replacing slide 9 with the two corrected MeetingBrain slides.", true, true, "gerund-opener only (the incident's first sentence without its tail)"],
        [EDIT, "Only the MeetingBrain part was touched, and every other slide is exactly as it was.", true, true, "rest-unchanged only"],
        // sole ask-rule positives
        ["The fee on slide 12 should read CHF 12,500", "Slide 12 now reads CHF 12,500.", true, true, "ask: ref-should only"],
        ["New slide 7. cards - title \"Writer\", three cards on briefs, drafts and edits", "Slide 7 is now the Writer cards slide.", true, true, "ask: new-slide-spec only"],
        ["Turn this report into a deck", "Here's your deck:\n\n**Slide 1 - The findings**", false, true, "ask: into-deck only (the artefact blocker sees report)"],
        ["On slide 4 (\"EngineAI\") of \"Deck\": make the title shorter\n\nChange only that slide. Leave every other slide exactly as it is, and resend the complete deck.", "Slide 4's title now reads EngineAI.", true, true, "ChatPanel sendSlideComment template"],
        ["Add ONE new slide to \"Deck\", after slide 6. It should show: pricing tiers\n\nUse generate_slides with editSlide and insertAfter: 6. Do not resend the other slides.", "Slide 7 is now a pricing slide with three tiers.", true, true, "ChatPanel sendSlideInsert template"],
        // Verifiers' false claims the first rules missed (2026-09-15, second
        // pass). Each was silent end to end: no retry and no notice.
        [EDIT, "Deck updated.", true, true, "bare participle"],
        [EDIT, "The deck's been updated with the two MeetingBrain slides.", true, true, "'s been updated"],
        [EDIT, "The two MeetingBrain slides have replaced slide 9.", true, true, "slides have replaced"],
        [EDIT, "The MeetingBrain slide is now two slides.", true, true, "is now two slides"],
        [EDIT, "I've replaced slide 9 with the two new slides - want me to publish it to Drive?", true, true, "a claim joined to a follow-up question"],
        [EDIT, "Slide 9 is now the two MeetingBrain slides, anything else?", true, true, "a claim joined to anything else?"],
        [EDIT, "I've replaced slide 9 with the two slides you sent earlier.", true, true, "earlier names the user's message, not the edit"],
        [EDIT, "Slide 9 has been replaced with the version in your last message.", true, true, "last message names the user's message"],
        [EDIT, "Replacing slide 9 with the two corrected MeetingBrain slides, not touching anything else.", true, true, "a negation in another clause"],
        [EDIT, "Nothing else was touched: slide 9 has been replaced by the two new slides.", true, true, "a negator in the clause before"],
        [EDIT, "Slide 9 no longer overstates things: I've replaced it with two accurate slides.", true, true, "no longer in the clause before"],
        [EDIT, "The updated slides are below.", true, true, "updated slides are below"],
        [EDIT, "Changes are in - have a look at the preview.", true, true, "changes are in"],
        [EDIT, "Here's how the deck looks now:\n\n1. Cover\n2. Agenda\n9. MeetingBrain: meetings in, actions out", true, true, "here's how the deck looks now"],
        [EDIT, "The new slides 9 and 10 are live in the preview.", true, true, "slides 9 and 10 are live"],
        [EDIT, "Your presentation has the new MeetingBrain slides in place.", true, true, "presentation has the new slides"],
        [EDIT, "Voila - MeetingBrain gets two slides now, and AuthorityOn moves to 11.", true, true, "gets two slides now"],
        // Verifiers' asks the first gate missed.
        ["Fix the copy on slide 5, it's too long", "Tightened the copy on slide 5 to two lines.", true, true, "ask: an artefact word that is a slide's field (copy on slide 5)"],
        ["Delete the agenda slide", "I've removed the agenda slide. The deck now has 11 slides.", true, true, "ask: the agenda slide"],
        ["Update the executive summary slide with the new revenue figure", "Updated the executive summary slide with CHF 1.2M.", true, true, "ask: the summary slide"],
        ["Add a note to slide 10 saying access is invite-only", "I've added the invite-only note to slide 10.", true, true, "ask: a note to slide 10"],
        ["Add speaker notes to slides 3 to 5", "I've added speaker notes to slides 3, 4 and 5.", true, true, "ask: speaker notes to slides"],
        ["Is it possible to replace slide 9 with the two slides below?", "Slide 9 has been replaced by the two new slides.", true, true, "ask: a polite request written as a question"],
        ["Are you able to merge slides 3 and 4?", "I've merged slides 3 and 4 into one slide.", true, true, "ask: are you able to"],
        ["Yes please, go ahead and make those changes", "Done - slide 9 has been replaced with the two new slides.", true, true, "ask: a yes longer than 40 characters, after an offer"],
        ["Yes, both slides please", "Done - slide 9 has been replaced with the two new slides.", true, true, "ask: a choice, after a choice question", "Should I add just the first slide, or both?"],
        ["Replace it", "Done - slide 9 has been replaced with the two new slides.", true, true, "ask: a short answer to a choice", "Before I change anything: slide 9 now has the old copy. Replace slide 9, or insert after it?"],
        ["How about moving AuthorityOn to the front?", "Moved AuthorityOn to the front of the deck.", true, true, "ask: how about, with a deck in the conversation"],
        // ACCEPTED, not a defect: a turn that asks for a NEW change and also
        // asks whether an earlier one went through. The honest confirmation
        // reads as a claim, and the notice ("no slides were added, removed or
        // edited in this reply") is still true, because the pricing slide was
        // not added.
        ["Add a pricing slide after slide 6. Did the MeetingBrain change go through?", "Yes, the MeetingBrain change went through: slide 9 is now the two-column slide. What tiers should the pricing slide show?", true, true, "accepted: an earlier edit confirmed on a turn that asks for a new one"],
        // --- must NOT fire: no change asked this turn (honest talk about real earlier edits)
        ["What's on slide 9 now?", "Slide 9 is now the two-column MeetingBrain slide: \"MeetingBrain: meetings in, actions out\".", true, false, "question about the live deck"],
        ["Did the change go through?", "Yes - slide 9 was replaced by the two new MeetingBrain slides, and the deck is now 13 slides.", true, false, "confirming an earlier edit"],
        ["Summarise what we changed in the deck today", "We replaced slide 9 with two MeetingBrain slides and added the Writer and Optimiser slides after slide 6.", true, false, "recap"],
        ["Can you check slide 4 reads ok?", "Slide 4 now reads well - the title is short and the cards are balanced.", true, false, "judgement"],
        ["I moved the AuthorityOn slide up myself in the preview, what do you think?", "The deck now has 13 slides and flows better with AuthorityOn first.", true, false, "user's own edit"],
        ["Who added slide 7?", "Slide 7 was added by Carol on Tuesday.", true, false, "someone else's edit"],
        ["What changed between the two versions?", "Slide 9 was replaced with two slides, and slides 10 to 12 shifted to 11 to 13.", true, false, "diff"],
        ["Why does slide 9 look different?", "Slide 9 has been rebuilt as a two-column slide because the old one overstated two things.", true, false, "explaining a rebuild"],
        ["Give me speaker notes for the deck", "Slide 1: open on the tension. Slide 9 is now two slides, so split the MeetingBrain story across them.", true, false, "speaker notes"],
        ["Write a LinkedIn post announcing the new deck", "We've updated our deck: MeetingBrain now has two slides of its own, and the rest is unchanged.", true, false, "copy in first person"],
        ["Draft a release note for the MeetingBrain update", "Release note: MeetingBrain now writes up your meetings. The old deck slide has been replaced with two new slides explaining it.", true, false, "release note"],
        ["Write an email to the team saying the deck is updated", "Hi team - the deck has been updated: slide 9 is now two MeetingBrain slides.", true, false, "email about the deck"],
        ["Did you replace slide 9?", "Yes - slide 9 has been replaced with the two new slides.", true, false, "ask: needs the question skip (a question naming an edit)"],
        ["Draft an email that says \"Please update the deck before Friday\"", "Here's the email: The deck has been updated, please review it before Friday.", true, false, "ask: needs the quote strip (quoted copy naming an edit)"],
        ["What should I say when presenting slide 9?", "Slide 9 is now the two-column one, so walk left to right: what goes in, then what comes out.", true, false, "presenting advice"],
        // Verifiers' confirmed cases (2026-09-15, second pass). Each retried and
        // regenerated the deck, or appended "The deck was not changed", through
        // the real createStreamingResponse on all four chains.
        ["Perfect, thanks!", "Glad it works. Slide 9 is now the two-column MeetingBrain slide, and everything else is as it was.", true, false, "an approval after a real edit"],
        ["Ok, thanks!", "You're welcome. Slide 9 now shows the MeetingBrain pair.", true, false, "ok thanks after an offer (needs the approval exit: the answer path reads ok as yes)"],
        ["Looks good", "Great! The deck is ready whenever you want to send it to Drive.", true, false, "an approval"],
        ["yes go ahead", "Done - slide 9 has been replaced with the two new slides.", true, false, "a yes after a reply that offered no change (needs the offer check)", "The deck is in Drive whenever you need it."],
        ["yes", "Done - the deck is in Drive, and slide 9 now shows the MeetingBrain pair.", true, false, "a yes to publishing, not to a change", "Want me to publish the deck to Drive?"],
        ["Turn the deck into a Word document", "I've turned the deck into a Word document with one section per slide.", true, false, "the deck as the source of a Word document"],
        ["Convert this presentation into a Google Doc for the board", "Converted the presentation into a Google Doc: one heading per slide, speaker notes as body text.", true, false, "the deck as the source of a Google Doc"],
        ["Use the deck to write a LinkedIn post about the MeetingBrain update", "We've updated our deck: MeetingBrain now has two slides of its own.", true, false, "the deck used to write a post"],
        ["Use the numbers from slide 6 to write a summary for the board", "Here's the board summary. I've put the three headline numbers from slide 6 first.", true, false, "a slide's numbers used to write a summary"],
        ["Add a cover page to the Word report", "I've added a cover page with the client logo and today's date to the report.", false, false, "a cover page belongs to a document"],
        ["Draft an email to Sarah and add the deck link", "Hi Sarah,\n\nI've updated the deck with the Q3 numbers - the link is below.\n\nBest, Chris", true, false, "a deck link in an email, and the email's own first person"],
        ["Give me three options for the cover title", "I've put together three options for the cover title:\n1. Q3 in review\n2. The quarter that turned\n\nWhich one should I use?", true, false, "options to choose from"],
        [COMMENT_Q, "The figure is right: slide 4 now shows 12%, which matches the Q3 report.", true, false, "a question typed into the slide comment box"],
        // --- must NOT fire: change asked, but reply is honest
        [EDIT, "I can replace slide 9 with those two slides if you want — shall I go ahead?", true, false, "offer"],
        [EDIT, "I couldn't replace slide 9: the deck isn't in this conversation any more, so there is nothing to edit. Nothing was changed.", true, false, "refusal"],
        [EDIT, "I haven't changed the deck — the two slides you sent use a layout name I don't recognise. Can you confirm you meant two-column?", true, false, "clarification"],
        [EDIT, "Those two slides are already in the deck as slides 9 and 10, so there is nothing to change.", true, false, "already done earlier"],
        [EDIT, "Here's what the two new slides would look like:\n\n**New slide 9 — MeetingBrain: meetings in, actions out.** What goes in / What comes out.", true, false, "hypothetical"],
        [EDIT, "Slide 9 overstates two things: it implies a bot joins calls, and that prep briefs are automatic. Which of the two columns should lead?", true, false, "critique + question"],
        [EDIT, "Adding a slide on pricing would make the deck 13 slides.", true, false, "gerund subject + modal"],
        [EDIT, "Slide 9 is now out of date, since MeetingBrain no longer sends a bot to calls.", true, false, "evaluative"],
        [EDIT, "Earlier I added the Writer and Optimiser slides after slide 6, so they are now slides 7 and 8. Where should the MeetingBrain pair go?", true, false, "earlier turn"],
        [EDIT, "I'll replace slide 9 now.", true, false, "promise (the promise guard's job)"],
        [EDIT, "Slide 9 replaced by the two-column slide only, or by both new slides?", true, false, "a clarifying question phrased as a fragment (needs the question skip)"],
        ["Update the document's MeetingBrain section", "I've updated the document: the MeetingBrain section now says no bot joins calls.", true, false, "document edit"],
        [EDIT, "Before I change anything: slide 9 now has the old copy, and adding slide 10 would push AuthorityOn to 11. Replace slide 9, or insert after it?", true, false, "a clarifying reply led by before I change anything (needs LEADS)"],
        // Once negation is scoped to the clause, LEADS and HYPOTHETICAL hold
        // every other asked decoy too, so this is the one NEGATORS carries alone.
        [EDIT, "None of the slides have been replaced: the second new slide has no body. Should it be a cards slide?", true, false, "a negated claim in its own clause (needs NEGATORS)"],
        [EDIT, "Good catch - I've put together what the two new slides would say:\n\n**Slide 9 - MeetingBrain: meetings in, actions out**\n\nWant me to apply it?", true, false, "a draft of what the slides would say (needs HYPOTHETICAL)"],
        // The incident, verbatim: the user's whole message, and the 928
        // characters sent back with no tool call.
        [INCIDENT_USER, INCIDENT_REPLY, true, true, "the incident, verbatim (thread 04c5d402)"],
      ];
      const askOf = (p: Pair, off?: { [k: string]: boolean }) => asksForDeckChange(p[0], { deckInConversation: p[2], lastAssistantText: p[5] !== undefined ? p[5] : OFFER }, off);
      const fires = (p: Pair, off?: { [k: string]: boolean }) => askOf(p, off) && deckChangeClaim(p[1]) !== null;

      // a) The corpus.
      let tp = 0, fp = 0, tn = 0, fn = 0;
      for (let i = 0; i < PAIRS.length; i++) {
        const p = PAIRS[i];
        const f = fires(p);
        const c = deckChangeClaim(p[1]);
        if (f && p[3]) tp++;
        else if (f) { fp++; fail(`40a: #${i + 1} (${p[4]}) fires on an honest reply [${c && c.rule}] "${c && c.sentence}"`); }
        else if (!p[3]) tn++;
        else { fn++; fail(`40a: #${i + 1} (${p[4]}) does not fire: asked=${askOf(p)} claim=${c ? c.rule : "none"}`); }
      }
      // PRECONDITION: a corpus emptied, or left with one side only, scores
      // FP=0 FN=0 and measures nothing.
      if (tp + fn < 40 || tn + fp < 25) fail(`40a: PRECONDITION — ${tp + fn} positives and ${tn + fp} negatives; the corpus no longer measures both directions`);
      const incidentClaim = deckChangeClaim(INCIDENT_REPLY);
      if (!asksForDeckChange(INCIDENT_USER, { deckInConversation: true }) || !incidentClaim) fail("40a: the verbatim incident is not read as a change asked for and a change claimed");

      // b) ABLATION.
      const positives: number[] = [];
      const negatives: number[] = [];
      for (let i = 0; i < PAIRS.length; i++) (PAIRS[i][3] ? positives : negatives).push(i);
      for (let r = 0; r < CLAIM_RULES.length; r++) {
        const without = CLAIM_RULES.filter((_, k) => k !== r);
        let lost = 0;
        for (let j = 0; j < positives.length; j++) if (claimingRules(PAIRS[positives[j]][1], without).length === 0) lost++;
        if (!lost) dead(`40b: claim rule "${CLAIM_RULES[r].id}" carries no positive alone — it is untested`);
      }
      const suppressors: [string, ClaimOpts][] = [["TEMPORAL", { noTemporal: true }], ["NEGATORS", { noNegators: true }], ["the question skip", { noQuestion: true }], ["LEADS", { noLeads: true }], ["HYPOTHETICAL", { noHypothetical: true }]];
      for (let k = 0; k < suppressors.length; k++) {
        let fired = 0;
        for (let j = 0; j < negatives.length; j++) {
          const p = PAIRS[negatives[j]];
          if (askOf(p) && claimingRules(p[1], CLAIM_RULES, suppressors[k][1]).length) fired++;
        }
        if (!fired) dead(`40b: without ${suppressors[k][0]} no asked decoy fires — it is untested`);
      }
      // And the three that WIDEN the claim: with each reverted to its first
      // form, a positive must go silent, or the widening is untested.
      const wideners: [string, ClaimOpts][] = [["the follow-up split", { noFollowUp: true }], ["clause-scoped negation", { sentenceScope: true }], ["the user-message strip", { noUserRef: true }]];
      for (let k = 0; k < wideners.length; k++) {
        let lost = 0;
        for (let j = 0; j < positives.length; j++) {
          const p = PAIRS[positives[j]];
          if (askOf(p) && claimingRules(p[1], CLAIM_RULES, wideners[k][1]).length === 0) lost++;
        }
        if (!lost) dead(`40b: reverting ${wideners[k][0]} loses no positive — it is untested`);
      }
      const ASK_SWITCHES = ["verb-target", "ref-should", "new-slide-spec", "into-deck", "how-about", "noAnswer", "noOfferCheck", "noApproval", "noTemplate", "noSourceBlock", "noOptionsSkip", "noPolite", "noTargetGuard", "noArtefactBlock", "noArtefactExemption", "noQuestionSkip", "noStrip"];
      for (let r = 0; r < ASK_RULES.length; r++) if (ASK_SWITCHES.indexOf(ASK_RULES[r].id) < 0) dead(`40b: ask rule "${ASK_RULES[r].id}" has no ablation switch here`);
      for (let k = 0; k < ASK_SWITCHES.length; k++) {
        const off: { [key: string]: boolean } = {};
        off[ASK_SWITCHES[k]] = true;
        let changed = 0;
        for (let i = 0; i < PAIRS.length; i++) if (fires(PAIRS[i], off) !== PAIRS[i][3]) changed++;
        if (!changed) dead(`40b: ask switch "${ASK_SWITCHES[k]}" changes no case — it is untested`);
      }
      // With no ask gate at all, the honest replies about real earlier edits
      // fire: the gate is the only thing keeping them quiet. Not EVERY no-ask
      // decoy — "Update the document's MeetingBrain section" neither asks for a
      // deck change nor claims one, and is there for the artefact blocker — so
      // the count that fires is what is held.
      let noAsk = 0;
      for (let j = 0; j < negatives.length; j++) {
        const p = PAIRS[negatives[j]];
        if (!askOf(p) && deckChangeClaim(p[1])) noAsk++;
      }
      if (noAsk < 28) dead(`40b: only ${noAsk} honest no-ask replies fire without the ask gate, expected 28 — the gate is barely tested`);

      // c) The retry gate and the notice.
      const base: DeckClaimRetryInput = { text: INCIDENT_REPLY, asked: true, turn: {}, offered: true, alreadyRetried: false, round: 0, maxRounds: 8, elapsedMs: 0, budgetMs: 165000, replayable: true, toolsUsed: [{ name: "query_meetingbrain", calls: 1 }] };
      if (!shouldRetryDeckClaim(base) || !shouldRetryDeckClaim({ ...base, turn: undefined, toolsUsed: undefined })) fail("40c: the incident's own combination is not retried");
      const noRetry: [string, Partial<DeckClaimRetryInput>][] = [
        ["the user asked for nothing", { asked: false }],
        ["generate_slides was not offered", { offered: false }],
        ["the turn already retried", { alreadyRetried: true }],
        ["a call was drawn", { turn: { lastOutcome: { kind: "ok" } } }],
        ["a call was refused", { turn: { lastOutcome: { kind: "refused", faults: [] } } }],
        ["a call failed", { turn: { lastOutcome: { kind: "failed" } } }],
        ["it is the last round", { round: 7 }],
        ["the time budget is spent", { elapsedMs: 165000 }],
        ["the reply claims nothing", { text: "Which of the two columns should lead?" }],
        // The claim was written in an earlier round and this round is empty:
        // replaying an empty assistant turn is a request the Anthropic API
        // rejects, which would throw the turn into the provider fallback.
        ["the claiming round wrote nothing to replay", { replayable: false }],
        ["a Word document was made this turn", { toolsUsed: [{ name: "generate_word_document", calls: 1 }] }],
        ["a .pptx was made with generate_document", { toolsUsed: [{ name: "query_meetingbrain", calls: 1 }, { name: "generate_document", calls: 1 }] }],
        ["a chart was made this turn", { toolsUsed: [{ name: "generate_chart", calls: 1 }] }],
        ["an image was made this turn", { toolsUsed: [{ name: "generate_image", calls: 1 }] }],
        ["a video was made this turn", { toolsUsed: [{ name: "generate_video", calls: 1 }] }],
      ];
      for (let k = 0; k < noRetry.length; k++) if (shouldRetryDeckClaim({ ...base, ...noRetry[k][1] })) fail(`40c: a retry is allowed when ${noRetry[k][0]}`);
      // The chart request the ask gate cannot tell from a deck edit ("Make a
      // bar chart of the numbers on slide 5"): only the tool gate holds it.
      const CHART_USER = "Make a bar chart of the numbers on slide 5";
      const CHART_REPLY = "I've created a bar chart from the numbers on slide 5.";
      if (!asksForDeckChange(CHART_USER, { deckInConversation: true }) || !deckChangeClaim(CHART_REPLY)) fail("40c: PRECONDITION — the chart request no longer reads as an ask and a claim, so the tool gate below is untested here");
      if (unmadeDeckChangeNotice(CHART_REPLY, {}, { asked: true, deckInConversation: true, alreadySaid: false, toolsUsed: [{ name: "generate_chart", calls: 1 }] })) fail("40c: the notice speaks after a chart was made from the deck");
      const said = (turn: SlidesTurnState | undefined, o: { asked: boolean; deckInConversation: boolean; alreadySaid: boolean }, text?: string) => unmadeDeckChangeNotice(text === undefined ? INCIDENT_REPLY : text, turn, { ...o, toolsUsed: [{ name: "query_meetingbrain", calls: 1 }] });
      // The reply a short answer is read against.
      if (lastAssistantReply([{ role: "user", content: "a" }, { role: "assistant", content: "Want me to replace slide 9?" }, { role: "system", content: "s" }, { role: "user", content: "yes" }]) !== "Want me to replace slide 9?") fail("40c: lastAssistantReply does not return the latest assistant message");
      if (lastAssistantReply([{ role: "user", content: "yes" }]) !== "" || lastAssistantReply(undefined) !== "" || lastAssistantReply([{ role: "assistant", content: [{ type: "text" }] }]) !== "") fail("40c: lastAssistantReply invents a reply where there is none");
      const offers: [string, boolean][] = [
        [OFFER, true],
        ["Before I change anything: slide 9 now has the old copy. Replace slide 9, or insert after it?", true],
        ["Here are three options for the title. Should I apply the first one?", false],
        ["Here's the deck. Should I apply the first one?", true],
        ["Want me to publish the deck to Drive?", false],
        ["The deck is ready. Should I update the Word document as well?", false],
        ["Slide 9 is now the two-column slide. Anything else?", false],
      ];
      for (let k = 0; k < offers.length; k++) if (endsInDeckChangeQuestion(offers[k][0]) !== offers[k][1]) fail(`40c: endsInDeckChangeQuestion(${JSON.stringify(offers[k][0])}) is ${!offers[k][1]}`);
      // With no deck in the conversation the ask may be an edit to a deck that
      // lives elsewhere, so that notice must not say there is no deck.
      if (NO_DECK_BUILT_NOTICE.indexOf("no deck yet") >= 0 || NO_DECK_BUILT_NOTICE.indexOf("No deck was built or changed.") < 0) fail(`40c: the no-deck notice claims more than this reply shows: ${NO_DECK_BUILT_NOTICE}`);
      const withDeck = said({}, { asked: true, deckInConversation: true, alreadySaid: false });
      const noDeck = said(undefined, { asked: true, deckInConversation: false, alreadySaid: false });
      if (withDeck !== DECK_NOT_CHANGED_NOTICE || withDeck.indexOf("The deck was not changed.") < 0) fail(`40c: with a deck in the conversation the notice is not "The deck was not changed." (${JSON.stringify(withDeck)})`);
      if (noDeck !== NO_DECK_BUILT_NOTICE) fail(`40c: with no deck the notice is not NO_DECK_BUILT_NOTICE (${JSON.stringify(noDeck)})`);
      if (said({}, { asked: false, deckInConversation: true, alreadySaid: false })) fail("40c: the notice speaks when the user asked for nothing");
      if (said({}, { asked: true, deckInConversation: true, alreadySaid: true })) fail("40c: the notice speaks after another notice has");
      if (said({}, { asked: true, deckInConversation: true, alreadySaid: false }, "Which of the two columns should lead?")) fail("40c: the notice speaks on a reply that claims nothing");
      const outcomes: SlidesTurnState[] = [{ lastOutcome: { kind: "ok" } }, { lastOutcome: { kind: "refused", faults: [] } }, { lastOutcome: { kind: "failed" } }];
      for (let k = 0; k < outcomes.length; k++) if (said(outcomes[k], { asked: true, deckInConversation: true, alreadySaid: false })) fail(`40c: the notice speaks after a call ended ${(outcomes[k].lastOutcome as any).kind}`);
      // The same test check 38 applies to every user-facing notice.
      const MARKERS = /do NOT|generate_slides|editSlide|insertSlides|Fix and send|`/;
      const shown = [DECK_NOT_CHANGED_NOTICE, NO_DECK_BUILT_NOTICE];
      for (let k = 0; k < shown.length; k++) {
        if (MARKERS.test(shown[k]) || /SYSTEM NOTE/.test(shown[k])) fail(`40c: a user-facing notice carries model-directed text: ${shown[k]}`);
        if (shown[k].indexOf("\n\n---\n\n⚠ **") !== 0) fail(`40c: a notice does not open with the rule and the warning mark the other notices use: ${JSON.stringify(shown[k].slice(0, 20))}`);
        if (/[—–]| - /.test(shown[k].slice(7))) fail(`40c: a notice uses a dash: ${shown[k]}`);
      }
      // PRECONDITION for check 38 (h), which looks for these words to prove the
      // nudge never reaches the user: the nudge must still carry them.
      if (DECK_CLAIM_NUDGE.indexOf("SYSTEM NOTE") !== 0 || DECK_CLAIM_NUDGE.indexOf("never acknowledge or mention it") < 0) fail("40c: PRECONDITION — the nudge no longer opens with SYSTEM NOTE, so check 38 (h) cannot see it leak");

      // f) USE.
      const stripComments = (src: string) => src.replace(/^[ \t]*\/\*[\s\S]*?\*\//gm, "").replace(/(^|[ \t])\/\/[^\n]*/gm, "$1");
      const prov = stripComments(readFileSync(join(__dirname, "..", "lib/ai/providers.ts"), "utf8"));
      const countIn = (s: string, needle: string) => s.split(needle).length - 1;
      const stopRe = /\} else if \(shouldRetryDeckClaim\(\{([^\n]*)\}\)\) \{([\s\S]*?)\n      \} else \{\n        loopEndedCleanly = true;/g;
      const stops: { args: string; body: string; at: number }[] = [];
      let sm: RegExpExecArray | null;
      while ((sm = stopRe.exec(prov))) stops.push({ args: sm[1], body: sm[2], at: sm.index });
      if (stops.length !== 4) fail(`40f: ${stops.length} retry branches between the cut-off test and loopEndedCleanly = true, expected one in each of 4 chains`);
      if (countIn(prov, "shouldRetryDeckClaim(") !== 4) fail(`40f: shouldRetryDeckClaim is called ${countIn(prov, "shouldRetryDeckClaim(")} times, expected 4`);
      for (let i = 0; i < stops.length; i++) {
        const { args, body, at } = stops[i];
        const tag = `40f: retry ${i + 1} (${i === 0 ? "Anthropic" : "OpenAI-compatible"})`;
        if (!/stoppedAbnormally\(/.test(prov.slice(Math.max(0, at - 400), at))) fail(`${tag} is not the else of the cut-off test`);
        // `round` as the loop's own counter: a constant here turns the last-round
        // gate off in that chain, and no behavioural scenario runs eight rounds.
        const need = ["asked: config.deckEditAsked === true", "turn: config.slidesTurn", "alreadyRetried: deckClaimRetried, round, maxRounds: MAX_TOOL_ROUNDS", "elapsedMs: Date.now() - turnStartedAt", "budgetMs: TURN_BUDGET_WARN_MS", "toolsUsed: toolLoopGuard.usage()"];
        for (let k = 0; k < need.length; k++) if (args.indexOf(need[k]) < 0) fail(`${tag} does not pass ${need[k]}: ${args}`);
        const replayable = i === 0 ? "replayable: finalMessage.content.some((b: any) => b && b.type === \"text\" && typeof b.text === \"string\" && b.text.trim() !== \"\")" : "replayable: fullText.slice(roundTextStart).trim() !== \"\"";
        if (args.indexOf(replayable) < 0) fail(`${tag} does not gate on this round having text to replay: ${args}`);
        // Anthropic narrows its tools on taint; the others refuse in their
        // executors, so for them a tainted turn is simply not offered the retry.
        if (i === 0 ? args.indexOf("offered: !suppressTools && roundTools.some(") < 0 : args.indexOf("offered: config.sawUntrustedContent !== true && tools.some(") < 0) fail(`${tag} reads the wrong tool list for offered: ${args}`);
        if (!/deckClaimRetried = true;/.test(body)) fail(`${tag} does not record that the turn retried`);
        if (!/push\(\{ role: "user", content: (?:\[\{ type: "text", text: DECK_CLAIM_NUDGE \}\]|DECK_CLAIM_NUDGE) \}/.test(body)) fail(`${tag} does not push the nudge`);
        if (!/\n\s*continue;\s*$/.test(body)) fail(`${tag} does not continue to another round`);
        if (i === 0 ? !/push\(\{ role: "assistant", content: finalMessage\.content \}\)/.test(body) : !/push\(\{ role: "assistant", content: fullText\.slice\(roundTextStart\) \}/.test(body)) fail(`${tag} does not replay this round's own text as the assistant turn`);
      }
      if (countIn(prov, "const roundTextStart = fullText.length;") !== 4 || countIn(prov, "let deckClaimRetried = false;") !== 4) fail("40f: each chain does not declare its own round start and retry flag");
      const ends: number[] = [];
      const endRe = /unstartedConversionNotice\(sourceSlideCount\(messages\)/g;
      let em: RegExpExecArray | null;
      while ((em = endRe.exec(prov))) ends.push(em.index);
      if (ends.length !== 4) fail(`40f: found ${ends.length} end-of-turn sites, expected 4`);
      for (let i = 0; i < ends.length; i++) {
        const site = prov.slice(ends[i], prov.indexOf("return {", ends[i]));
        const ur = site.indexOf("unresolvedSlidesNotice(config.slidesTurn)");
        const um = site.indexOf("unmadeDeckChangeNotice(spokenText, config.slidesTurn");
        if (um < 0 || um < ur) fail(`40f: end site ${i + 1}: the deck-claim notice does not read spokenText after the unresolved notice`);
        if (!/const (\w+) = unmadeDeckChangeNotice\(spokenText, config\.slidesTurn, \{ asked: config\.deckEditAsked === true, deckInConversation: config\.deckInConversation === true, alreadySaid: fullText !== spokenText, toolsUsed: toolLoopGuard\.usage\(\) \}\);\s*if \(\1\) \{\s*fullText \+= \1;[\s\S]{0,40}?controller\.enqueue\(encoder\.encode\(`data: \$\{JSON\.stringify\(\{ token: \1 \}\)\}/.test(site)) fail(`40f: end site ${i + 1}: the deck-claim notice is not gated as designed, appended and streamed`);
      }
      if (countIn(prov, "const spokenText = fullText;") !== 4) fail(`40f: spokenText is captured ${countIn(prov, "const spokenText = fullText;")} times, expected 4`);
      const stall = prov.indexOf("stallOutcome(stalledOut, fullText");
      if (stall < 0 || prov.lastIndexOf("const spokenText = fullText;", stall) < prov.lastIndexOf("async function streamAnthropic(", stall)) fail("40f: Anthropic's spokenText is not taken before the stall notice is appended");
      const route = stripComments(readFileSync(join(__dirname, "..", "app/api/ai/conversations/[id]/messages/route.ts"), "utf8"));
      if (!/const deckEditAsked = asksForDeckChange\(userContent \|\| "", \{ deckInConversation: !!deckContext, lastAssistantText: lastAssistantReply\(messages\) \}\);/.test(route)) fail("40f: route.ts does not compute deckEditAsked from the user's message this turn, read against the reply it answers");
      const cfgAt = route.indexOf("const aiConfigRef: any = {");
      const cfgLit = cfgAt < 0 ? "" : route.slice(cfgAt, route.indexOf("};", cfgAt));
      if (!cfgLit) fail("40f: aiConfigRef is not in route.ts — this check is reading the wrong file");
      else {
        if (!/[{,]\s*deckEditAsked\s*[,}]/.test(cfgLit)) fail("40f: aiConfigRef does not pass deckEditAsked, so no chain ever sees an ask");
        if (cfgLit.indexOf("deckInConversation: !!deckContext") < 0) fail("40f: aiConfigRef does not pass deckInConversation from deckContext");
      }

      if (failures === before40) {
        pass(`${PAIRS.length} pairs, TP=${tp} TN=${tn} FP=0 FN=0, the verbatim incident firing on ${incidentClaim ? incidentClaim.rule : "?"}; all ${CLAIM_RULES.length} claim rules, TEMPORAL, NEGATORS, the question skip and ${ASK_SWITCHES.length} ask switches each carry a case, and ${noAsk} honest no-ask replies fire without the gate; the retry and the notice are gated unit by unit; all four chains and the route are wired`);
      }
    } catch (e: any) {
      fail(`check 40 threw: ${String((e && e.message) || e).slice(0, 200)}`);
    }
  }

  /* 41. A SCREENSHOT IS FRAMED, AND A CALLOUT POINTS AT SOMETHING
   *
   * Two live bugs closed, plus the device that did not exist.
   *
   *   - A `feature` slide carrying an attached picture drew it full bleed with
   *     gradient:false and set the eyebrow, title and body in WHITE — measured
   *     255,255,255 at 26pt. A light UI capture therefore made the whole slide
   *     invisible, and every geometric check passed over it because nothing
   *     asked what was behind the type. A screenshot feature is now a navy
   *     STAGE, decided in slideStyle like the stat grid's ground.
   *   - An attachment on image-split was baked to aspect 0.839 with fit:contain
   *     onto WHITE, so a 1.895 screenshot became a 179pt strip in a 405pt white
   *     slab. A screenshot is no longer baked at all: it is drawn at its own
   *     shape on a mat.
   *
   * And the pointing. Nothing could mark a place on a picture and explain it,
   * so the model described the interface in prose beside a picture of it and
   * the reader matched the two by eye.
   *
   * THE FRAME IS DRAWN, NOT DECLARED. preview-model reads no solid outline at
   * all — only `outline.dashStyle === "DASH"` — so `updateImageProperties`
   * outline and filledShape's own outline are both invisible in the preview.
   * The keyline is an inflated filled rectangle with the picture on top of it,
   * which is exact and keeps the whole feature inside the request kinds check 3
   * already round-trips.
   *
   * MUTATION LOG (detached worktree, 2026-09-16)
   *
   * Two of these first came back GREEN, and both were findings about the
   * check rather than about the code:
   *   - M4 (Chebyshev → Euclidean) survived because no fixture had a DIAGONAL
   *     pair. Two pins 23.5pt apart at 45 degrees are clear by Euclid and
   *     16.6pt apart in both axes, which is exactly the case the metric was
   *     chosen for. Fixture D now carries that pair, and M4 dies on it.
   *   - M11 was first written as quoteClip → JSON.stringify, which is the
   *     SAME STRING for short text, so the mutation was a no-op. Dropping the
   *     quotes is the real difference, and it is what breaks droppedContent's
   *     filter.
   *
   * And one bug was found by RENDERING rather than by any assertion: fixture H
   * printed a cover with a raw UI capture under its white title, because
   * "do not bake a screenshot" had been written as a property of the PICTURE
   * when it is a property of the LAYOUT. 41j-pre and M28 came from the PNG.
   *
   *   killed  M1  navy outer ring dropped                       → 41a
   *   killed  M2  white middle ring dropped                     → 41a
   *   killed  M3  numeral 9pt → 6pt                             → 41a
   *   killed  M4  Chebyshev separation → Euclidean              → 41c (and check 2)
   *   killed  M5  separation 23 → 12                            → 41c (and check 2)
   *   killed  M6  pins placed with no clamp to the image box    → 41c
   *   killed  M7  every pin nudged unconditionally              → 41b
   *   killed  M8  nudge applied, note not emitted               → 41b, 41g
   *   killed  M9  cap raised from 5 to 12                       → 41g
   *   killed  M10 cap enforced, `Showing N of M` not drawn      → 41g
   *   killed  M11 over-cap note stops using quoteClip           → 41g (droppedContent doubles up)
   *   killed  M12 keyline rectangle removed                     → 41d
   *   killed  M13 keyline drawn as filledShape's `outline`      → 41d (invisible in the preview)
   *   killed  M14 mat alpha dropped on the dark branch          → 41d
   *   killed  M15 image drawn BEFORE the mat                    → 41d
   *   killed  M16 box sized to a fixed 16/10, not the aspect    → 41e
   *   killed  M17 feature keeps background: null for a shot     → 41f (and check 4)
   *   killed  M18 feature still calls backdropRequests          → 41f
   *   killed  M20 body box stops subtracting listBlock          → 41i
   *   killed  M21 body box left at the full ceiling when drawn  → 41m (the hug)
   *   killed  M22 legibility threshold 2.4 → 99                 → 41h
   *   killed  M23 legibility note fires unconditionally         → 41h
   *   killed  M24 callouts honoured on `cover` too              → 41g
   *   killed  M25 `callouts` removed from SLIDE_ITEM_PROPS      → 41j
   *   killed  M27 `col` ids renamed so pathOf misses them       → 41k
   *   killed  M28 a screenshot drawn raw on EVERY layout          → 41j-pre
   *
   * SECOND PASS (2026-09-16). Six defects that every check above passed over,
   * five of them found by RENDERING the slides and one by asking what a
   * continuation inherits. Each is a fixture in the shared sweep as well as an
   * assertion here, because most of the value of these fixtures is checks 1, 2
   * and 11 seeing them at all.
   *
   *   killed  M29 image-split list clamped UP over the body      → 41m, check 2
   *   killed  M30 rows drawn past the column's floor             → 41m, check 1
   *   killed  M31 rows that did not fit are not declared         → 41m
   *   killed  M32 pins placed for rows that are not drawn        → 41m
   *   killed  M33 image-split floor ignores the takeaway bar     → 41n, check 2
   *   killed  M34 feature stage floor ignores the takeaway bar   → 41n, check 2
   *   killed  M35 feature body takes its hug with no ceiling     → 41o, 41p
   *   killed  M35b the pre-fix geometry exactly (hug + max(48))  → 41o (off canvas)
   *   killed  M36 feature body box hugs while PROBING            → 41p
   *   killed  M37 legendLayout stops refusing an over-wide row   → check 1
   *   killed  M39 continuation clears `image` again              → 41q
   *   killed  M40 namesAPicture true for a source-less brief     → 41q
   *   killed  M41 the feature stage draws no credit              → 41r
   *   killed  M42 image-split draws no credit (the X11 hole)     → 41r
   *   killed  M43 fitAspect stops centring                       → 41s
   *   killed  M44 calloutsFor stops dropping a blank phrase      → 41s, 41m
   *   killed  M45 fitAspect's fallback stops reading unknownAspect → 41s, 41e
   *   killed  M46 legendLayout over-claims `kept`                → 41m (pins vs rows)
   *   killed  M47 SHOT.minStage → 0                              → 41o
   *   killed  M48 the callout-drop fallback stops firing         → 41c (fixture R)
   *   killed  M48b the fallback fires and says nothing           → 41m
   *   killed  M50 image-split body box left at the ceiling       → 41m (the hug)
   *   killed  M52 the admission's band is not reserved           → check 2
   *   killed  M53 the clipped-body admission removed             → 41o
   *   killed  M54 the clipped-body admission fires always        → 41o
   *   killed  M55 the body-dropped admission removed             → 41o, 41m
   *   killed  M56 a dropped body drawn at two points instead     → check 2, check 11
   *   killed  M57 feature body box left at the ceiling           → 41m (the hug)
   *   SURVIVED M38 the legend's `lx` clamp to GRID.margin removed: belt and
   *            braces only, now that legendLayout refuses a row wider than the
   *            measure. It is kept because it is the last thing between a
   *            future width bug and a chip drawn at a negative x, and a guard
   *            that cannot fire today is cheaper than the render that found it.
   *   SURVIVED M49 image-split's `!PROBING` on the body box: redundant given
   *            the `Math.min(splitBodyCeiling, …)` beside it — when the hug is
   *            under the ceiling the body genuinely fits, and when it is over
   *            the clamp answers the same number either way. Kept as the
   *            statement of intent; the feature branch's own PROBING guard is
   *            NOT redundant and M36 proves it.
   *
   * M19 was recorded here as killed and was not: the stage-top clamp off the
   * lockup can never bind. LOGO_PLACEMENT.content ends at 54.8, while the
   * smallest possible stage top is FEATURE_SHOT_TITLE_Y (46) + the title's
   * 45.36 minimum + SHOT.legendGap (14) = 105.36 — fifty points clear, with an
   * EMPTY title. Deleting the clamp left every fixture byte-identical and the
   * suite green, so 41c's "the mat clears the lockup" was passing on the title
   * geometry and never on the clamp. The clamp is gone and 41c is the guard.
   *   SURVIVED S1 SHOT.pad 10 → 8: nothing asserts the mat's exact width, only
   *            that it exists, contains the picture and clears the lockup. The
   *            mat is a taste value; pinning it would pin taste. (It first
   *            came back KILLED, by 41h quoting the drawn width to the point —
   *            a coupling that would have gone red on any harmless geometry
   *            change, so 41h now reads the width out of the note instead.)
   *   SURVIVED S2 legend rows greedy (4+1) instead of balanced (3+2): 41f
   *            asserts the rows fit and stay on the canvas, not that they are
   *            even. Recorded rather than writing a check nobody would believe.
   *   SURVIVED S3 chip diameter 16 → 15: 41a's sweep is size-independent and
   *            41c measures only the pins on the picture.
   *   SURVIVED M26 attachment branch back to unconditional `gradient: false`.
   *            The attachment path cannot run here at all: attachmentImageSource
   *            needs a Vercel Blob token for a PRIVATE store, and the local one
   *            is an older token against a public store, so it returns null and
   *            the branch is never entered (which is why check 23 tests the crop
   *            arithmetic rather than the path). The fix is in the tree and
   *            rendered; nothing local can go red on it.
   */
  const before41 = failures;
  console.log(`\n41. A screenshot is framed, and a callout points at something`);
  {
    const A41 = (ok: boolean, m: string) => { if (!ok) fail(`41: ${m}`); };
    const reqsOf = (i: number, notes?: string[]) => buildSlideRequests(ALL[i], i, `sh${i}`, notes) as any[];
    const notesOf = (i: number) => { const n: string[] = []; reqsOf(i, n); return n; };
    const boxOfReq = (r: any) => {
      const o = r.createShape || r.createImage;
      const t = o.elementProperties.transform;
      return { id: o.objectId as string, x: t.translateX, y: t.translateY,
        w: o.elementProperties.size.width.magnitude, h: o.elementProperties.size.height.magnitude };
    };
    const shapeById = (rs: any[], suffix: string) => {
      for (const r of rs) {
        const o = r.createShape || r.createImage;
        if (o && String(o.objectId).endsWith(`_${suffix}`)) return boxOfReq(r);
      }
      return null;
    };
    const fillOf = (rs: any[], suffix: string) => {
      for (const r of rs) {
        const u = r.updateShapeProperties;
        if (u && String(u.objectId).endsWith(`_${suffix}`)) {
          const sf = u.shapeProperties?.shapeBackgroundFill?.solidFill;
          const c = sf?.color?.rgbColor;
          return c ? { hex: [c.red, c.green, c.blue].map((v: number) => Math.round((v ?? 0) * 255).toString(16).padStart(2, "0")).join("").toUpperCase(), alpha: sf.alpha } : null;
        }
      }
      return null;
    };
    const inkOfBox = (rs: any[], suffix: string) => {
      for (const r of rs) {
        const u = r.updateTextStyle;
        if (u && String(u.objectId).endsWith(`_${suffix}`) && u.textRange?.type === "ALL") {
          const c = u.style?.foregroundColor?.opaqueColor?.rgbColor;
          return { hex: c ? [c.red, c.green, c.blue].map((v: number) => Math.round((v ?? 0) * 255).toString(16).padStart(2, "0")).join("").toUpperCase() : null,
            size: u.style?.fontSize?.magnitude as number | undefined };
        }
      }
      return null;
    };
    const pinsOf = (rs: any[]) => {
      const out: { n: number; cx: number; cy: number; d: number }[] = [];
      for (const r of rs) {
        const o = r.createShape;
        if (!o || o.shapeType !== "ELLIPSE") continue;
        const m = /_shp(\d+)a$/.exec(String(o.objectId));
        if (!m) continue;
        const b = boxOfReq(r);
        out.push({ n: Number(m[1]) + 1, cx: b.x + b.w / 2, cy: b.y + b.h / 2, d: b.w });
      }
      return out;
    };
    const lum = (hex: string) => {
      const f = (c: number) => (c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4));
      const v = [0, 2, 4].map((i) => f(parseInt(hex.substr(i, 2), 16) / 255));
      return 0.2126 * v[0] + 0.7152 * v[1] + 0.0722 * v[2];
    };
    const ratio = (a: number, b: number) => (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
    const overlaps = (p: { x: number; y: number; w: number; h: number }, q: { x: number; y: number; w: number; h: number }) =>
      !(p.x + p.w <= q.x + 0.01 || q.x + q.w <= p.x + 0.01 || p.y + p.h <= q.y + 0.01 || q.y + q.h <= p.y + 0.01);

    let mark = failures;
    const okIf = (m: string) => { if (failures === mark) pass(m); mark = failures; };
    // Every screenshot fixture that actually draws one. H is the cover, which
    // mats nothing.
    const DRAWN_SHOTS = ["A", "B", "C", "D", "E", "F", "G", "I", "J", "K", "L", "M", "N", "O", "P", "Q", "R"];

    /* 41a. THE PIN IS LEGIBLE ON EVERY POSSIBLE GROUND.
     *
     * Not a sample: a screenshot can be any colour anywhere, so the guarantee
     * has to hold for every ground luminance there is. Colours are read off the
     * DRAWN requests, never off SHOT — a check that reads the constants proves
     * the constants, not the pin. */
    {
      const rs = reqsOf(SHOT_IX("A"));
      const outer = fillOf(rs, "shp0a"), mid = fillOf(rs, "shp0b"), disc = fillOf(rs, "shp0c");
      const numeral = inkOfBox(rs, "shp0n");
      A41(!!outer && !!mid && !!disc && !!numeral, `a pin draws three discs and a numeral (${[outer, mid, disc, numeral].map((v) => !!v).join(",")})`);
      if (outer && mid && disc && numeral && numeral.hex) {
        A41(outer.hex !== mid.hex, `the pin's two rings are the same colour (${outer.hex}) — one ring cannot cover both a light and a dark ground`);
        const nOn = ratio(lum(numeral.hex), lum(disc.hex));
        A41(nOn >= 4.5, `the numeral is ${nOn.toFixed(2)}:1 on the disc, under the 4.5:1 small-text floor`);
        A41((numeral.size ?? 0) >= 8, `the numeral is set at ${numeral.size}pt — too small to read from a room`);
        let worst = 99, at = 0;
        for (let i = 0; i <= 1000; i++) {
          const Lg = i / 1000;
          const best = Math.max(ratio(lum(outer.hex), Lg), ratio(lum(mid.hex), Lg));
          if (best < worst) { worst = best; at = Lg; }
        }
        A41(worst >= 3, `a ground at L=${at.toFixed(3)} leaves the pin's rings at ${worst.toFixed(2)}:1 — the pin would vanish into the screenshot`);
        // And the DISC alone is not enough, which is why there are rings at
        // all: brand blue on brand blue is a pin on our own product's button.
        let discWorst = 99;
        for (let i = 0; i <= 1000; i++) discWorst = Math.min(discWorst, ratio(lum(disc.hex), i / 1000));
        A41(discWorst < 3, `the disc alone clears 3:1 everywhere (${discWorst.toFixed(2)}:1) — this fixture no longer proves the rings do any work`);
        okIf(`41a numeral ${nOn.toFixed(2)}:1 on the disc; the ring pair's worst ground is ${worst.toFixed(2)}:1 at L=${at.toFixed(3)} (a bare disc: ${discWorst.toFixed(2)}:1)`);
      }
    }

    /* 41b. PINS LAND WHERE THE PERCENTAGES SAY, unless a note says one moved. */
    {
      for (const key of ["A", "E"]) {
        const i = SHOT_IX(key);
        const rs = reqsOf(i), notes = notesOf(i);
        const img = shapeById(rs, "shimg");
        const calls = (ALL[i].image?.callouts || []);
        A41(!!img, `${key}: no picture is drawn, so nothing can be pinned to it`);
        if (!img) continue;
        const pins = pinsOf(rs);
        A41(pins.length === calls.length, `${key}: ${pins.length} pins for ${calls.length} callouts`);
        for (const p of pins) {
          const c = calls[p.n - 1];
          const want = { x: img.x + (c.x / 100) * img.w, y: img.y + (c.y / 100) * img.h };
          const off = Math.max(Math.abs(p.cx - want.x), Math.abs(p.cy - want.y));
          const moved = notes.some((n) => n.indexOf(`pin ${p.n} was moved`) >= 0);
          if (moved) continue;   // declared, and only the author can re-aim it
          A41(off <= 0.5, `${key}: pin ${p.n} asked for (${c.x}%, ${c.y}%) and landed ${off.toFixed(1)}pt away, with no note saying it moved`);
        }
      }
      okIf("41b every pin lands on the percentage it was given, or a note says it was moved and by how far");
    }

    /* 41c. SEPARATION, CONTAINMENT, AND CLEARING THE LOCKUP. */
    {
      for (const key of DRAWN_SHOTS) {
        const i = SHOT_IX(key);
        const rs = reqsOf(i);
        const img = shapeById(rs, "shimg"), mat = shapeById(rs, "shmat");
        A41(!!img && !!mat, `${key}: the frame is missing (image=${!!img} mat=${!!mat})`);
        if (!img || !mat) continue;
        const pins = pinsOf(rs);
        for (let a = 0; a < pins.length; a++) {
          for (let b = a + 1; b < pins.length; b++) {
            const cheb = Math.max(Math.abs(pins[a].cx - pins[b].cx), Math.abs(pins[a].cy - pins[b].cy));
            A41(cheb >= SHOT.separation - 0.01,
              `${key}: pins ${pins[a].n} and ${pins[b].n} are ${cheb.toFixed(1)}pt apart in the wider axis, under ${SHOT.separation} — their numeral boxes overlap`);
          }
          const p = pins[a];
          A41(p.cx - p.d / 2 >= img.x - 0.01 && p.cx + p.d / 2 <= img.x + img.w + 0.01 &&
              p.cy - p.d / 2 >= img.y - 0.01 && p.cy + p.d / 2 <= img.y + img.h + 0.01,
            `${key}: pin ${p.n} hangs off the picture (centre ${p.cx.toFixed(1)},${p.cy.toFixed(1)} in ${img.x.toFixed(1)},${img.y.toFixed(1)} ${img.w.toFixed(1)}x${img.h.toFixed(1)})`);
        }
        A41(mat.x >= -0.01 && mat.y >= -0.01 && mat.x + mat.w <= CANVAS.width + 0.01 && mat.y + mat.h <= CANVAS.height + 0.01,
          `${key}: the mat leaves the canvas (${mat.x.toFixed(1)},${mat.y.toFixed(1)} ${mat.w.toFixed(1)}x${mat.h.toFixed(1)})`);
        // A PICTURE, NOT A POSTAGE STAMP. Everything else on these slides —
        // the title, the body, the legend, the takeaway — takes its room from
        // the top or the foot, and the picture is what is left in the middle;
        // with no floor under it, a long title and a full-height takeaway
        // between them squeezed a 1440px capture into thirteen points and
        // every geometric check here still passed.
        A41(img.h >= 48,
          `${key}: the picture is ${img.h.toFixed(1)}pt tall — the words above and below it have squeezed the one thing the slide is about`);
        const place = LOGO_PLACEMENT[slideStyle(ALL[i], i).logoPlacement];
        A41(!overlaps(mat, { x: place.x, y: place.y, w: place.width, h: place.height }),
          `${key}: the mat runs under the lockup — a white mark over a light screenshot is exactly what check 4 cannot see`);
      }
      okIf(`41c pins on ${DRAWN_SHOTS.length} screenshots are a pin's width apart, inside the picture, and every mat clears the lockup`);
    }

    /* 41d. THE FRAME IS DRAWN AND READ BACK — through the PREVIEW, not the
     *      request list, because the alpha is the field preview-model has
     *      dropped before. */
    {
      for (const key of ["A", "E"]) {
        const i = SHOT_IX(key);
        const page = toPreviewModel([ALL[i]]).slides[0];
        const onDark = slideStyle(ALL[i], i).onDark;
        const imgAt = page.elements.findIndex((e) => e.kind === "image" && e.src === "shot.png");
        A41(imgAt >= 0, `${key}: the screenshot never reaches the preview`);
        if (imgAt < 0) continue;
        const img = page.elements[imgAt];
        const near = (a: number, b: number) => Math.abs(a - b) < 0.01;
        const findRect = (pad: number) => {
          for (let k = 0; k < page.elements.length; k++) {
            const e = page.elements[k];
            if (e.kind !== "rect") continue;
            if (near(e.x, img.x - pad) && near(e.y, img.y - pad) && near(e.w, img.w + 2 * pad) && near(e.h, img.h + 2 * pad)) return { e, k };
          }
          return null;
        };
        const key1 = findRect(SHOT.keyline), mat = findRect(SHOT.pad);
        A41(!!key1, `${key}: no hairline exactly ${SHOT.keyline}pt round the picture reaches the preview — an outline would not, which is why it is drawn as an inflated rectangle`);
        A41(!!mat, `${key}: no mat ${SHOT.pad}pt round the picture reaches the preview`);
        if (key1 && mat) {
          A41(key1.k < imgAt && mat.k < imgAt, `${key}: the picture is drawn before its own frame — element order is z-order, so the frame would cover the interface`);
          A41(mat.k < key1.k, `${key}: the hairline is drawn before the mat, so the mat covers it`);
          const want = onDark
            ? { mat: `#${COLOR.white.toLowerCase()}`, matA: SHOT.matDarkAlpha, key: `#${COLOR.white.toLowerCase()}`, keyA: SHOT.keylineDarkAlpha }
            : { mat: `#${SHOT.matLight.toLowerCase()}`, matA: undefined, key: `#${COLOR.navy.toLowerCase()}`, keyA: SHOT.keylineLightAlpha };
          A41(String(mat.e.fill).toLowerCase() === want.mat, `${key}: the mat previews as ${mat.e.fill}, not ${want.mat}`);
          A41(String(key1.e.fill).toLowerCase() === want.key, `${key}: the hairline previews as ${key1.e.fill}, not ${want.key}`);
          A41(mat.e.opacity === want.matA, `${key}: the mat's opacity previews as ${mat.e.opacity}, not ${want.matA} — a dropped alpha renders a 10% wash as a solid slab`);
          A41(key1.e.opacity === want.keyA, `${key}: the hairline's opacity previews as ${key1.e.opacity}, not ${want.keyA}`);
        }
      }
      okIf("41d the mat and the hairline round-trip with their fills and their alphas, and the picture is drawn on top of both");
    }

    /* 41e. THE SHOT IS ITS OWN SHAPE, so nothing letterboxes and pdf-html's
     *      object-fit:cover cannot disagree with the preview's contain. */
    {
      for (const key of DRAWN_SHOTS) {
        const i = SHOT_IX(key);
        const img = shapeById(reqsOf(i), "shimg");
        const measured = ALL[i].resolvedImage?.aspect;
        // A draft saved before callouts shipped — and a `url` or `query`
        // declared a capture — has no measured aspect, and SHOT.unknownAspect
        // is then BOTH the shape the file was fitted onto and the shape of the
        // box it is drawn in. If the two ever stop being the same constant,
        // pdf-html's object-fit:cover crops the difference in silence.
        const want = typeof measured === "number" ? measured : SHOT.unknownAspect;
        A41(!!img, `${key}: no picture is drawn`);
        if (!img) continue;
        A41(Math.abs(img.w / img.h - want) < 0.01,
          `${key}: the picture is drawn at ${(img.w / img.h).toFixed(3)} but the shape it was fitted to is ${want.toFixed(3)} — it is being stretched or letterboxed`);
      }
      okIf(`41e every screenshot is drawn at the shape of the file it came from`);
    }

    /* 41f. A FEATURE SCREENSHOT IS A NAVY STAGE, NOT A BLEED. */
    {
      for (const key of ["E", "F", "I"]) {
        const i = SHOT_IX(key);
        const style = slideStyle(ALL[i], i);
        A41(style.background === FEATURE_SHOT_STYLE.background && style.onDark,
          `${key}: a feature screenshot is on ${style.background} — the layout's white type is solved for a baked gradient a screenshot never gets`);
        A41(style.logo === "white", `${key}: the navy stage does not carry the white lockup`);
        const rs = reqsOf(i);
        A41(!rs.some((r) => String(r.createImage?.objectId || "").endsWith("_bg")),
          `${key}: backdropRequests still draws a full-bleed picture behind the stage`);
        const img = shapeById(rs, "shimg")!;
        for (const r of rs) {
          if (!r.createImage) continue;
          const b = boxOfReq(r);
          if (String(b.id).indexOf("logo") >= 0) continue;
          A41(b.w * b.h <= CANVAS.width * CANVAS.height * 0.8,
            `${key}: an image covers ${Math.round((100 * b.w * b.h) / (CANVAS.width * CANVAS.height))}% of the slide — that is a bleed, not a stage`);
        }
        // Nothing is WRITTEN on a screenshot. The pin numerals are the pins
        // themselves, not writing, so they are excluded by name.
        for (const r of rs) {
          const o = r.createShape;
          if (!o || o.shapeType !== "TEXT_BOX") continue;
          if (/_shp\d+n$/.test(String(o.objectId))) continue;
          const b = boxOfReq(r);
          A41(!overlaps(b, img), `${key}: "${b.id}" is drawn over the interface — a screenshot carries no text on it`);
        }
      }
      okIf("41f a feature screenshot is a matted navy stage with its white lockup, nothing bleeds and nothing is written on the picture");
    }

    /* 41g. WHAT IS DROPPED IS SAID, THREE WAYS — asserted on the STRINGS,
     *      because a note-free build passes every geometric check there is. */
    {
      // C: seven callouts against a cap of five.
      {
        const i = SHOT_IX("C");
        const notes = notesOf(i), rs = reqsOf(i);
        const joined = notes.join(" | ");
        const lost = (ALL[i].image!.callouts || []).slice(5);
        A41(/at most 5 callouts/.test(joined), `C: nothing says the cap was hit (${joined.slice(0, 90)})`);
        for (const c of lost) {
          A41(joined.indexOf(quoteClip(c.text)) >= 0, `C: the note does not quote "${c.text.slice(0, 30)}" in quoteClip's form`);
        }
        const admitted = rs.filter((r) => r.insertText).map((r) => String(r.insertText.text));
        A41(admitted.some((t) => t === "Showing 5 of 7 callouts"), `C: the slide itself never says how many callouts it is showing (${JSON.stringify(admitted.slice(-2))})`);
        // And the model is not told the same thing twice in two voices.
        const dropped = droppedContent(ALL[i], i, notes);
        for (const c of lost) {
          A41(dropped.indexOf(c.text) < 0, `C: droppedContent repeats "${c.text.slice(0, 30)}" that the note already quoted`);
        }
      }
      // D: a nudge with a distance, and an off-picture callout with its number.
      {
        const notes = notesOf(SHOT_IX("D")).join(" | ");
        A41(/pin 2 was moved \d+pt/.test(notes), `D: the nudge is not declared with a distance (${notes.slice(0, 120)})`);
        A41(/callout 3 points outside the picture \(118%, 50%\)/.test(notes), `D: the off-picture callout is not declared with its percentage (${notes.slice(0, 160)})`);
      }
      // H: a layout that cannot point, declared and reported.
      {
        const i = SHOT_IX("H");
        const notes = notesOf(i);
        A41(notes.some((n) => n.indexOf("image-split and feature only") >= 0 && n.indexOf("cover") >= 0),
          `H: a cover carrying callouts says nothing about them (${notes.join(" | ").slice(0, 120)})`);
        const dropped = droppedContent(ALL[i], i, notes);
        for (const c of ALL[i].image!.callouts!) {
          A41(dropped.indexOf(c.text) >= 0, `H: droppedContent does not name "${c.text.slice(0, 30)}", which the cover never draws`);
        }
      }
      // And a well-formed screenshot says NOTHING about drops, or the report
      // is noise and gets ignored, which is the same as not having it.
      for (const key of ["A", "G"]) {
        const notes = notesOf(SHOT_IX(key)).join(" | ");
        A41(notes.indexOf("left off") < 0 && notes.indexOf("was moved") < 0 && notes.indexOf("outside the picture") < 0,
          `${key}: a well-formed screenshot reports a drop it did not make (${notes.slice(0, 120)})`);
        A41(droppedContent(ALL[SHOT_IX(key)], SHOT_IX(key), notesOf(SHOT_IX(key))).length === 0,
          `${key}: a well-formed screenshot reports dropped content`);
      }
      okIf("41g the cap, the nudge, the off-picture pin and the wrong layout are each named in words, on the slide, and to the model exactly once");
    }

    /* 41h. NOTHING IS MISSING, BUT IT CANNOT BE READ. */
    {
      const big = notesOf(SHOT_IX("C")).join(" | ");
      // The SENTENCE, not the exact width: a mat one point wider would move
      // the drawn width and a check pinned to it would go red on a taste
      // change. What has to be true is that the note fires, says how wide the
      // picture is drawn, says how many pixels went into it, and says the size
      // the interface text lands at — which is the number a reader acts on.
      const m41h = /drawn (\d+)pt wide from 1440 source pixels/.exec(big);
      A41(!!m41h, `a whole app window at half-slide width is not called out (${big.slice(0, 160)})`);
      A41(/lands at about \d+\.\dpt/.test(big), `the note does not say what size the interface text lands at`);
      if (m41h) A41(1440 / Number(m41h[1]) > SHOT.maxPxPerPt, `41h's fixture is drawn ${m41h[1]}pt wide, which is inside the threshold — it proves nothing`);
      // The negative half: the same source cropped to a panel is fine, and a
      // note that fires on everything is a note nobody reads.
      const cropped: SlideInput = {
        layout: "image-split", title: "A panel crop", eyebrow: "x",
        image: { attachment: 1, callouts: [{ x: 50, y: 50, text: "The score" }] },
        resolvedImage: { url: "shot.png", scrim: 0, aspect: 330 / 406, sourceWidth: 330 },
      };
      const quiet: string[] = [];
      buildSlideRequests(cropped, 0, "sh41h", quiet);
      A41(!quiet.some((n) => n.indexOf("source pixels") >= 0),
        `a 330px panel drawn at 273pt is reported as unreadable (${quiet.join(" | ").slice(0, 120)})`);
      okIf("41h a 1440px window drawn at 295pt is called unreadable with the size it lands at; a 330px panel at 273pt is not");
    }

    /* 41i. THE SPLITTER SEES THE LIST.
     *
     * The body box is the room the field HAS, and it has to give up exactly
     * what the numbered rows take — or a body that no longer fits beside five
     * callouts is drawn straight through them instead of splitting. */
    {
      const body = Array.from({ length: 6 }, (_, k) => `A bullet long enough to wrap once in the half-width column, number ${k + 1}`).join("\n");
      const bare: SlideInput = { layout: "image-split", eyebrow: "x", title: "A body and a list", body,
        image: { attachment: 1, screenshot: true },
        resolvedImage: { url: "shot.png", scrim: 0, aspect: 1440 / 760, sourceWidth: 1440 } };
      const withList: SlideInput = { ...bare, image: { attachment: 1, callouts: [
        { x: 10, y: 10, text: "One" }, { x: 40, y: 20, text: "Two" }, { x: 70, y: 30, text: "Three" },
        { x: 20, y: 60, text: "Four" }, { x: 80, y: 70, text: "Five" } ] } };
      const alone = splitOverflowingSlides([JSON.parse(JSON.stringify(bare))]).length;
      const beside = splitOverflowingSlides([JSON.parse(JSON.stringify(withList))]).length;
      A41(alone === 1, `a body that fits the column on its own was split into ${alone} — this fixture proves nothing about the list`);
      A41(beside > 1, `the same body beside five callouts was NOT split (${beside}) — the body box is not giving up the rows' room, so the bullets are drawn through them`);
      okIf(`41i a body that fits alone (${alone} slide) splits once five callouts take the room beneath it (${beside} slides)`);
    }

    /* 41j-pre. A SCREENSHOT IS ONLY DRAWN RAW WHERE THE LAYOUT MATS IT.
     *
     * Skipping the bake is what keeps 12px interface type off JPEG ringing,
     * and it also skips the baked GRADIENT. On image-split and the feature
     * stage nothing is written over the picture, so there is nothing to
     * darken for. On a cover there is: the title is drawn white ACROSS the
     * picture, and a raw UI capture under it is the same invisible slide the
     * stage exists to fix, one layout along. Found by rendering fixture H and
     * reading the PNG, not by any assertion here.
     *
     * This asserts the DECISION, because the path that acts on it cannot run
     * on a laptop: attachmentImageSource needs a Vercel Blob token for a
     * PRIVATE store and the local one is an older public-store token, so it
     * returns null and the branch is never entered. */
    {
      const shotImg = { attachment: 1, callouts: [{ x: 50, y: 50, text: "The score" }] };
      const raw: [string, boolean][] = [
        ["image-split", true], ["feature", true],
        ["cover", false], ["section", false], ["closing", false],
        ["content", false], ["case-study", false], ["cards", false], ["image-grid", false],
      ];
      for (const [layout, want] of raw) {
        const got = drawsRawScreenshot({ layout: layout as any, image: shotImg }, 3);
        A41(got === want, `a screenshot on ${layout} is ${got ? "drawn raw" : "baked"}; it should be ${want ? "drawn raw" : "baked"}`);
      }
      A41(!drawsRawScreenshot({ layout: "image-split", image: { query: "a factory at dusk" } }, 3),
        "a PHOTOGRAPH on image-split is treated as a screenshot — it would lose its crop and its gradient");
      A41(drawsRawScreenshot({ layout: "image-split", image: { attachment: 1, screenshot: true } }, 3),
        "`screenshot: true` with no callouts is not enough to mat a picture");
      okIf("41j-pre a screenshot is drawn raw only on the two layouts that mat it; everywhere else it is prepared as a photograph and keeps its gradient");
    }

    /* 41j. THE SCHEMA OFFERS IT — read off the tool OBJECT the model receives,
     *      never off the file text. */
    {
      const params: any = (SLIDES_GEN_OPENAI_TOOL as any).function.parameters;
      const routes: [string, any][] = [
        ["slides.items", params?.properties?.slides?.items?.properties?.image],
        ["editSlide.insertSlides.items", params?.properties?.editSlide?.properties?.insertSlides?.items?.properties?.image],
        ["editSlide", params?.properties?.editSlide?.properties?.image],
      ];
      for (const [route, img] of routes) {
        A41(!!img?.properties?.screenshot, `${route}: image declares no \`screenshot\``);
        const co = img?.properties?.callouts;
        A41(!!co, `${route}: image declares no \`callouts\`, so the model cannot point at anything`);
        if (!co) continue;
        A41(co.maxItems === 5, `${route}: callouts declares maxItems ${co.maxItems}, not the 5 the builder draws`);
        const it = co.items?.properties;
        A41(!!it?.x && !!it?.y && !!it?.text, `${route}: a callout declares no x/y/text (${Object.keys(it || {}).join(",")})`);
      }
      const desc = String(routes[0][1]?.properties?.callouts?.description || "");
      A41(/PERCENTAGES OF THE PICTURE/.test(desc), "the callouts guidance does not say x and y are percentages of the picture");
      A41(/PHRASE, not a sentence/.test(desc), "the callouts guidance does not say the text is a phrase");
      A41(/ONE TOOL OR ONE SCREEN PER SLIDE/.test(desc), "the callouts guidance does not say one screen per slide");
      A41(/ASK for the screenshot/.test(String(routes[0][1]?.properties?.attachment?.description || "")),
        "nothing tells the model to ask for a screenshot when one would help");
      const size = JSON.stringify(SLIDES_GEN_OPENAI_TOOL).length;
      A41(size <= 55000, `generate_slides is ${size} characters, over its 55,000 ceiling`);
      okIf(`41j callouts and screenshot are declared on all three routes, and the tool is ${size} characters of its 55,000`);
    }

    /* 41k. A WRONG PHRASE IS FIXABLE IN THE PREVIEW. */
    {
      for (const key of ["A", "F"]) {
        const i = SHOT_IX(key);
        const page = toPreviewModel([ALL[i]]).slides[0];
        const calls = ALL[i].image!.callouts!;
        for (let k = 0; k < Math.min(calls.length, 5); k++) {
          const el = page.elements.find((e) => e.kind === "text" && e.text === calls[k].text);
          A41(!!el, `${key}: callout ${k + 1} is not drawn at all`);
          if (!el) continue;
          A41(JSON.stringify(el.path) === JSON.stringify(["image", "callouts", k, "text"]),
            `${key}: callout ${k + 1} previews with path ${JSON.stringify(el.path)} — an edit there would not reach the spec`);
          A41(readPath(ALL[i] as any, el.path!) === calls[k].text,
            `${key}: the path does not read back the phrase it was drawn from`);
        }
      }
      okIf("41k every callout phrase carries the spec path that edits it");
    }

    /* 41l. THE PIN SURVIVES THE PRINT PATH.
     *
     * 41a proves the contrast analytically, for every ground there is, which
     * is strictly stronger than sampling one render. What a render adds is
     * whether the three discs actually ARRIVE concentric and circular in the
     * printed page — so that is what this asserts, on the HTML the PDF route
     * prints, the way check 20h does. The nine fixtures are also rendered
     * through headless Chrome by hand and the PNGs read; that is a thing to
     * do, not a thing to run in a check. */
    {
      const i = SHOT_IX("A");
      const html = deckToHtml(toPreviewModel([ALL[i]]), "Screenshot callouts");
      const S = 4 / 3;
      const rs = reqsOf(i);
      const outer = shapeById(rs, "shp0a")!, mid = shapeById(rs, "shp0b")!, disc = shapeById(rs, "shp0c")!;
      for (const [name, b] of [["outer", outer], ["middle", mid], ["disc", disc]] as [string, typeof outer][]) {
        const left = `left:${b.x * S}px`, top = `top:${b.y * S}px`;
        A41(html.indexOf(left) >= 0 && html.indexOf(top) >= 0,
          `the pin's ${name} disc is not printed at ${left};${top} — the print path and the preview disagree about where the pin is`);
        A41(Math.abs(b.w - b.h) < 0.01, `the pin's ${name} disc is ${b.w.toFixed(2)}x${b.h.toFixed(2)} — not a circle`);
        A41(Math.abs((b.x + b.w / 2) - (outer.x + outer.w / 2)) < 0.01 && Math.abs((b.y + b.h / 2) - (outer.y + outer.h / 2)) < 0.01,
          `the pin's ${name} disc is not concentric with the outer ring`);
      }
      A41(/border-radius:50%/.test(html), "the discs do not print as circles");
      A41(html.indexOf(`#${COLOR.blue.toLowerCase()}`) >= 0, "the pin's brand-blue disc never reaches the print");
      okIf("41l the pin prints as three concentric circles at the geometry the preview drew");
    }

    /* 41m. THE NUMBERED LIST NEVER RUNS OVER THE BODY, and every row it
     *       cannot reach the floor with is declared.
     *
     * The rows used to be clamped UP to `columnFloor - listBlock` to make room
     * for themselves, straight through the body above them — and the splitter
     * could not save the slide, because it can only divide paragraphs and the
     * body's ceiling has a hard 40pt floor that says a two-line body always
     * "fits". Fixture J is an ordinary slide: a one-line title, one sentence,
     * five phrases. It printed one over the other and said nothing.
     *
     * The pin-count half covers the FEATURE legend as well, and is what pins
     * its overflow path: a `kept` that over-claims puts a numbered pin on the
     * picture with no phrase under it anywhere, and nothing else looks. */
    {
      for (const key of DRAWN_SHOTS) {
        const i = SHOT_IX(key);
        const rs = reqsOf(i), notes = notesOf(i);
        const els = toPreviewModel([ALL[i]]).slides[0].elements;
        // Found by the SPEC PATH each box carries, not by an object id the
        // preview never had: the path is also what says the row on the slide is
        // the phrase from the spec rather than a coincidence of wording.
        const body = els.find((e) => e.kind === "text" && e.path?.length === 1 && e.path[0] === "body");
        const rows = els.filter((e) => e.kind === "text" && e.path?.[0] === "image" && e.path?.[1] === "callouts");
        // A body the slide had no room for is a whole field gone. It is the
        // loss least likely to be noticed, because the slide still looks
        // composed without it.
        if (!body && String(ALL[i].body || "").trim()) {
          A41(notes.some((n) => n.indexOf("had nowhere to go above the picture") >= 0 && n.indexOf(quoteClip(String(ALL[i].body))) >= 0),
            `${key}: the body is not drawn at all and nothing quotes it — the slide simply lost a field`);
        }
        if (body) {
          // THE BOX HUGS ITS WORDS WHEN SOMETHING FOLLOWS IT, and the slack
          // falls outside. A body box left at its ceiling passes every
          // collision check there is — the rows are simply pushed to the
          // bottom of the column and the slide opens a hole where the sentence
          // ended. (With nothing under it the ceiling is right, and is what
          // every other image-split slide draws.)
          if (rows.length) {
            const hug = ALL[i].layout === "feature"
              ? hugHeight(ALL[i].body, GRID.contentWidth * 0.72, TYPE.featureBody.size, false)
              : hugHeight(ALL[i].body, IMAGE.splitTextWidth, TYPE.body.size, true);
            A41(body.h <= hug + 0.5,
              `${key}: the body box is ${body.h.toFixed(1)}pt for ${hug.toFixed(1)}pt of words, with ${rows.length} numbered rows under it — the slack is inside the box, not under it`);
          }
          for (const r of rows) {
            A41(r.y >= body.y + body.h - 0.01,
              `${key}: numbered row "${String(r.text).slice(0, 24)}" starts at ${r.y.toFixed(1)}, above the foot of the body at ${(body.y + body.h).toFixed(1)} — the two are printed over each other`);
          }
        }
        // A pin with no line under it explaining it is worse than no pin. The
        // two counts are what tie the picture to the column.
        const pins = pinsOf(rs);
        A41(pins.length === rows.length,
          `${key}: ${pins.length} pins on the picture and ${rows.length} numbered lines beside it — a number the reader cannot match to a phrase`);
        // Everything asked for, minus everything drawn, is named in words.
        const asked = (ALL[i].image?.callouts || []).filter((c) => c && String(c.text || "").trim());
        const lost = asked.slice(rows.length);
        for (const c of lost) {
          A41(notes.some((n) => n.indexOf(quoteClip(c.text)) >= 0),
            `${key}: "${c.text.slice(0, 30)}" is not drawn and no note quotes it in quoteClip's form — droppedContent will report it a second time, in a second voice`);
        }
        const shown = els.find((e) => e.kind === "text" && /^Showing \d+ of \d+ callouts$/.test(String(e.text || "")));
        if (lost.length) {
          A41(!!shown && String(shown.text) === `Showing ${rows.length} of ${asked.length} callouts`,
            `${key}: the slide itself never says it is showing ${rows.length} of ${asked.length} callouts (${shown ? JSON.stringify(shown.text) : "no line at all"})`);
        } else {
          A41(!shown, `${key}: a slide drawing every callout it was given still says ${shown ? JSON.stringify(shown.text) : ""}`);
        }
        // AND IT STAYS OUT OF THE BOTTOM MARGIN. The line hugs whatever is
        // above it, and on a slide with no legend rows there is nothing between
        // the picture and the foot — so hugging alone drew it level with the
        // footer, in the band no layout is allowed to draw in.
        if (shown) A41(shown.y + shown.h <= FOOTER_Y + 0.01,
          `${key}: "${shown.text}" is drawn at ${shown.y.toFixed(1)}..${(shown.y + shown.h).toFixed(1)}, into the footer's own band below ${FOOTER_Y}`);
      }
      okIf(`41m on ${DRAWN_SHOTS.length} screenshots the numbered rows start under the body, every pin has a line, and every row that did not fit is quoted and counted`);
    }

    /* 41n. THE TAKEAWAY BAR IS PART OF THE FLOOR.
     *
     * The bar is pushed LAST and drawn over whatever is there; every other
     * layout shortens its band by the bar's height first. Both screenshot
     * branches measured to the bottom margin instead, so on a slide with a
     * takeaway the numbered rows, the legend and — worst — the one line on the
     * slide admitting a callout had been dropped were painted over by it.
     * Asserted against the bar's OWN drawn rectangle, not a recomputed one. */
    {
      for (const key of ["L", "Q"]) {
        const i = SHOT_IX(key);
        const rs = reqsOf(i);
        const bar = shapeById(rs, "noteBar");
        A41(!!bar, `${key}: this fixture is supposed to carry a takeaway bar and draws none`);
        if (!bar) continue;
        let seen = 0;
        for (const r of rs) {
          const o = r.createShape || r.createImage;
          if (!o) continue;
          const idStr = String(o.objectId);
          if (!/_(shmat|shkey|shimg|shp\d+[abcn]|shc\d+[abcn]|col\d+|shdrop|body)$/.test(idStr)) continue;
          seen++;
          A41(!overlaps(boxOfReq(r), bar),
            `${key}: ${idStr} is drawn under the takeaway bar (${boxOfReq(r).y.toFixed(1)}..${(boxOfReq(r).y + boxOfReq(r).h).toFixed(1)} against a bar at ${bar.y.toFixed(1)}..${(bar.y + bar.h).toFixed(1)})`);
        }
        A41(seen > 6, `${key}: only ${seen} screenshot elements were measured against the bar — this fixture is not exercising the branch`);
      }
      okIf("41n nothing either screenshot branch draws is painted over by the takeaway bar");
    }

    /* 41o. THE FEATURE STAGE IS MEASURED FROM THE FOOT UPWARDS.
     *
     * Measured downwards from the title, a body of 48 words walked the legend
     * rows and the admission clean off the bottom of the canvas — reachable
     * after the real splitter, because a single paragraph is never divided.
     * The sweep is over body LENGTH because that is the axis the bug lived on;
     * one fixture at one length would have sat either side of it by luck. */
    {
      const W = "audit prompts models retrieval recall attribution sentiment coverage benchmark publisher citation visibility".split(" ");
      const FIVE = [
        { x: 10, y: 12, text: "A first phrase of twelve words that has to wrap onto two lines" },
        { x: 40, y: 30, text: "A second phrase of twelve words that has to wrap onto two lines" },
        { x: 70, y: 48, text: "A third phrase of twelve words that has to wrap onto two lines" },
        { x: 25, y: 66, text: "A fourth phrase of twelve words that also has to wrap over two" },
        { x: 60, y: 86, text: "A fifth phrase of twelve words which likewise wraps onto two lines" },
      ];
      for (let n = 8; n <= 80; n += 8) {
        const words: string[] = [];
        for (let k = 0; k < n; k++) words.push(W[k % W.length]);
        const slide: SlideInput = {
          layout: "feature", eyebrow: "Stress",
          title: "Fourteen words of title here to see whether the heading and the picture can both fit",
          body: words.join(" "), image: { attachment: 1, callouts: FIVE },
          resolvedImage: { url: "shot.png", scrim: 0, aspect: 1440 / 760, sourceWidth: 1440 },
        };
        const after = splitOverflowingSlides([JSON.parse(JSON.stringify(slide))]);
        const rs = buildSlideRequests(after[0], 0, "o") as any[];
        for (const r of rs) {
          const o = r.createShape || r.createImage;
          if (!o || /_ftl$/.test(String(o.objectId))) continue;
          const b = boxOfReq(r);
          A41(b.y + b.h <= CANVAS.height + 0.6 && b.x >= -0.6 && b.x + b.w <= CANVAS.width + 0.6,
            `${n} words: ${o.objectId} is drawn at ${b.x.toFixed(1)},${b.y.toFixed(1)} ${b.w.toFixed(1)}x${b.h.toFixed(1)} — off the canvas`);
        }
        const img = shapeById(rs, "shimg");
        A41(!!img && img.h >= 48, `${n} words: the picture is ${img ? img.h.toFixed(1) : "0"}pt tall — the stage has been squeezed out of existence`);
        // A SINGLE PARAGRAPH IS THE ONE THE SPLITTER CANNOT HELP WITH, so past
        // the ceiling it is clipped — and a clip is the kind of loss nothing
        // else on the slide would ever mention. Both directions: eight words
        // fit and must not be reported, eighty do not and must be.
        const clip: string[] = [];
        buildSlideRequests(after[0], 0, "o", clip);
        const said = clip.some((t) => t.indexOf("does not fit above the picture and is clipped") >= 0);
        const box = shapeById(rs, "body");
        const fits = !box || drawnTextHeight(estimateLines(String(after[0].body || ""), GRID.contentWidth * 0.72, TYPE.featureBody.size), TYPE.featureBody.size) <= box.h + 0.5;
        A41(said !== fits,
          fits ? `${n} words: a body that fits its box is reported as clipped`
               : `${n} words: the body is clipped to ${box ? box.h.toFixed(1) : "0"}pt and the deck says nothing about it`);
      }
      // AND THE END OF THE SCALE: a takeaway at the bar's full height under a
      // title at its own, which leaves nothing above the picture at all. The
      // body is then dropped rather than drawn at two points, and a dropped
      // field is the loss least likely to be noticed — the slide still looks
      // composed without it. Built here rather than in the sweep because the
      // takeaway has to be a thousand characters to reach NOTE.maxHeight, and
      // a fixture nobody can read is a fixture nobody maintains.
      {
        const sentences: string[] = ["Why this matters: the movement is the thing to report upwards, not the score."];
        for (let k = 0; k < 7; k++) sentences.push("A single run says where the brand stands today, and four runs say whether the work is landing at all.");
        const squeezed: SlideInput = {
          layout: "feature", eyebrow: "Stress",
          title: "Fourteen words of title here to see whether the heading and the picture can both fit",
          body: "Four models, 248 prompts, one score the communications team can act on.",
          note: sentences.join(" "),
          image: { attachment: 1, callouts: [{ x: 30, y: 30, text: "The score" }] },
          resolvedImage: { url: "shot.png", scrim: 0, aspect: 1440 / 760, sourceWidth: 1440 },
        };
        const notes: string[] = [];
        const rs = buildSlideRequests(squeezed, 0, "sq", notes) as any[];
        const bar = shapeById(rs, "noteBar");
        A41(!!bar && bar.h >= NOTE.maxHeight - 0.01,
          `the squeezed fixture's takeaway is only ${bar ? bar.h.toFixed(1) : "0"}pt of ${NOTE.maxHeight} — it does not squeeze anything`);
        A41(!shapeById(rs, "body"), `the squeezed fixture still draws a body, so it is not driving the drop at all`);
        A41(notes.some((n) => n.indexOf("had nowhere to go above the picture") >= 0 && n.indexOf(quoteClip(String(squeezed.body))) >= 0),
          `a body with no room left on the slide was dropped and nothing quotes it: ${JSON.stringify(notes)}`);
        const img = shapeById(rs, "shimg");
        A41(!!img && img.h >= 48, `even with everything given up, the picture is ${img ? img.h.toFixed(1) : "0"}pt tall`);
      }
      okIf("41o a feature stage keeps the legend and the admission on the canvas at every body length, keeps the picture, and says which field it gave up");
    }

    /* 41p. THE SPLITTER IS TOLD THE CEILING, NOT THE HUG.
     *
     * A box drawn to fit its own words answers "it fits" to every question the
     * splitter asks, so the feature branch reported a ~39pt box for every body
     * and every body of three lines or more was split in two for no reason.
     * Both directions, because a check that only proves it splits is satisfied
     * by a rule that splits everything. */
    {
      const shot = { url: "shot.png", scrim: 0, aspect: 1440 / 760, sourceWidth: 1440 };
      const three = "The audit runs the same prompt set across four models every week\n" +
        "Each row records what that model actually said about the brand\n" +
        "Movement, not a snapshot, is what a team can be asked to own";
      const fits: SlideInput = { layout: "feature", eyebrow: "Case study", title: "The audit, on one screen",
        body: three, image: { attachment: 1, callouts: [{ x: 20, y: 20, text: "Navigation" }] }, resolvedImage: shot };
      const one = splitOverflowingSlides([JSON.parse(JSON.stringify(fits))]);
      A41(one.length === 1, `a three-line body that fits its feature stage was split into ${one.length} — the splitter is being told the box hugs its words`);
      const longer: string[] = [];
      for (let k = 0; k < 14; k++) longer.push(`Line ${k + 1}: something the audit does that takes a whole line of the column to say`);
      const over: SlideInput = { ...fits, body: longer.join("\n") };
      const many = splitOverflowingSlides([JSON.parse(JSON.stringify(over))]);
      A41(many.length > 1, `a fourteen-line body on the same stage was NOT split (${many.length}) — the ceiling is not being reported at all`);
      okIf("41p a feature screenshot reports its stage's ceiling to the splitter: a body that fits stays whole and one that does not is cut");
    }

    /* 41q. A CONTINUATION IS STILL A SCREENSHOT.
     *
     * splitOnce cleared `image` outright and inheritContinuationImages handed
     * the tail the parent's RAW, un-baked, un-gradiented capture — so the
     * continuation read as a photograph: `feature` bled it full-bleed under
     * white type and image-split cropped it to the half-slide and ran it off
     * the edge. The invisible slide this whole treatment exists to prevent,
     * one slide along, with nothing declared. */
    {
      const shot = { url: "shot.png", scrim: 0, aspect: 1440 / 760, sourceWidth: 1440 };
      const photo = { url: "photo.jpg", scrim: 0.4 };
      const longBody: string[] = [];
      for (let k = 0; k < 14; k++) longBody.push(`Line ${k + 1}: something the audit does that takes a whole line of the column to say`);
      for (const layout of ["image-split", "feature"] as const) {
        const parent: SlideInput = { layout, eyebrow: "The platform", title: "Every prompt, every model",
          body: longBody.join("\n"),
          image: { attachment: 1, callouts: [
            { x: 8, y: 14, text: "Navigation" }, { x: 40, y: 30, text: "Prompt table" },
            { x: 62, y: 55, text: "Share of voice" }, { x: 88, y: 20, text: "Score panel" },
            { x: 88, y: 49, text: "Export" } ] } };
        const after = splitOverflowingSlides([JSON.parse(JSON.stringify(parent))]);
        A41(after.length > 1, `${layout}: the continuation fixture did not split, so it proves nothing`);
        if (after.length < 2) continue;
        after[0].resolvedImage = { ...shot };
        inheritContinuationImages(after);
        const tail = after[1];
        A41(isScreenshot(tail), `${layout}: the continuation is no longer a screenshot, so it takes the photograph path — a bleed under white type`);
        A41(drawsRawScreenshot(tail, 1), `${layout}: the continuation's inherited capture is not drawn raw, so it is cropped to a box it was never baked for`);
        const rs = buildSlideRequests(tail, 1, "q") as any[];
        const mat = shapeById(rs, "shmat"), keyline = shapeById(rs, "shkey"), img = shapeById(rs, "shimg");
        A41(!!mat && !!keyline && !!img, `${layout}: the continuation draws no frame (mat=${!!mat} keyline=${!!keyline} picture=${!!img})`);
        A41(!shapeById(rs, "half") && !shapeById(rs, "bg"),
          `${layout}: the continuation still bleeds the capture (half=${!!shapeById(rs, "half")} bg=${!!shapeById(rs, "bg")})`);
        if (img) A41(Math.abs(img.w / img.h - shot.aspect) < 0.01,
          `${layout}: the continuation draws a ${shot.aspect.toFixed(3)} capture at ${(img.w / img.h).toFixed(3)} — cover-cropped, so the toolbar and the status column are cut away`);
        // No pins and no numbered lines: the phrases belong to the half of the
        // body that explains them.
        A41(pinsOf(rs).length === 0, `${layout}: the continuation carries pins whose numbered lines are on the slide before it`);
        // And the tail's brief must not send the resolver looking for a picture
        // it was never given — that comes back as a failure the user caused.
        A41(!namesAPicture(tail.image), `${layout}: the continuation's brief names a picture to go and find, which resolution reports as one the user asked for and did not get`);
      }
      // The control: a PHOTOGRAPH's continuation still bleeds, so the rule
      // above is about screenshots and not about continuations in general.
      const photoParent: SlideInput = { layout: "image-split", title: "A photograph", body: longBody.join("\n"), image: { query: "a factory" } };
      const pa = splitOverflowingSlides([JSON.parse(JSON.stringify(photoParent))]);
      if (pa.length > 1) {
        pa[0].resolvedImage = { ...photo };
        inheritContinuationImages(pa);
        A41(!isScreenshot(pa[1]) && !!shapeById(buildSlideRequests(pa[1], 1, "q") as any[], "half"),
          `a photograph's continuation stopped bleeding — the screenshot rule has been applied to every picture`);
      }
      okIf("41q a split screenshot keeps its frame on the continuation, a photograph keeps its bleed, and neither sends the resolver looking");
    }

    /* 41r. THE PHOTOGRAPHER IS STILL CREDITED.
     *
     * `feature` drew its credit inside backdropRequests, and the screenshot
     * stage does not call it — so a stock picture declared a screenshot went
     * out uncredited, which is the exact hole creditRequests was pulled out of
     * backdropRequests to close. Local fixtures, not sweep ones: the credit
     * line and the footer share the bottom band on EVERY layout, which is a
     * separate and older collision than anything here. */
    {
      const credit = "Photo: Ada Lovelace / Unsplash";
      for (const layout of ["feature", "image-split"] as const) {
        const s: SlideInput = { layout, title: "A capture from the stock library", body: "One line under it.",
          image: { query: "an analytics dashboard", screenshot: true },
          resolvedImage: { url: "shot.png", scrim: 0, aspect: SHOT.unknownAspect, credit } };
        const drawn = (buildSlideRequests(s, 0, "cr") as any[]).some((r) => r.insertText?.text === credit);
        A41(drawn, `${layout}: a stock picture declared a screenshot is published with no attribution at all`);
      }
      okIf("41r a stock picture declared a screenshot is credited on both layouts that mat it");
    }

    /* 41s. THE SMALL PARTS NOTHING ELSE DRIVES.
     *
     * fitAspect's centring, the blank-phrase filter and SHOT.unknownAspect were
     * each mutable with the whole suite green. They are one line of arithmetic
     * apiece, which is exactly the kind of line that gets "simplified". */
    {
      const inner = { x: 100, y: 50, w: 400, h: 200 };
      const wide = fitAspect(inner, 4);          // width-bound: slack above and below
      A41(Math.abs(wide.w - inner.w) < 0.01, `fitAspect gave a 4:1 picture ${wide.w.toFixed(1)}pt of a ${inner.w}pt box`);
      A41(Math.abs((wide.y - inner.y) - ((inner.y + inner.h) - (wide.y + wide.h))) < 0.01,
        `fitAspect did not centre a wide picture: ${(wide.y - inner.y).toFixed(1)}pt above, ${((inner.y + inner.h) - (wide.y + wide.h)).toFixed(1)}pt below`);
      const tall = fitAspect(inner, 0.5);        // height-bound: slack left and right
      A41(Math.abs(tall.h - inner.h) < 0.01, `fitAspect gave a 1:2 picture ${tall.h.toFixed(1)}pt of a ${inner.h}pt box`);
      A41(Math.abs((tall.x - inner.x) - ((inner.x + inner.w) - (tall.x + tall.w))) < 0.01,
        `fitAspect did not centre a tall picture: ${(tall.x - inner.x).toFixed(1)}pt left, ${((inner.x + inner.w) - (tall.x + tall.w)).toFixed(1)}pt right`);
      const unknown = fitAspect(inner, undefined);
      A41(Math.abs(unknown.w / unknown.h - SHOT.unknownAspect) < 0.01,
        `an unmeasured capture is fitted at ${(unknown.w / unknown.h).toFixed(3)}, not SHOT.unknownAspect (${SHOT.unknownAspect})`);
      // AND THE SLIDE SAYS IT IS A GUESS. Fixture P's pins are placed against
      // a shape nothing measured, and the print path's object-fit:cover crops
      // away whatever the capture does not match — so a pin at 20% of the box
      // is not at 20% of the interface, and only the render can see it.
      A41(notesOf(SHOT_IX("P")).some((n) => n.indexOf("nothing measured this screenshot's proportions") >= 0),
        `a capture with no measured shape carries pins and says nothing about the guess: ${JSON.stringify(notesOf(SHOT_IX("P")))}`);
      A41(!notesOf(SHOT_IX("A")).some((n) => n.indexOf("nothing measured this screenshot's proportions") >= 0),
        `a capture whose shape WAS measured is reported as a guess`);

      // The blank phrase: a numbered pin pointing at an empty line is a number
      // the reader cannot resolve, so it never gets one — and the two real
      // phrases stay 1 and 2.
      const o = SHOT_IX("O");
      const pins = pinsOf(reqsOf(o));
      const rows = toPreviewModel([ALL[o]]).slides[0].elements
        .filter((e) => e.kind === "text" && e.path?.[0] === "image" && e.path?.[1] === "callouts");
      A41(pins.length === 2 && rows.length === 2,
        `a callout with an empty phrase was numbered anyway (${pins.length} pins, ${rows.length} lines for two real phrases)`);
      const numbers = pins.map((p) => p.n).sort().join(",");
      A41(numbers === "1,2", `the numbering ran ${numbers} round a blank phrase instead of 1,2`);
      A41(rows.every((r) => String(r.text).trim().length > 0), `an empty phrase was drawn as a numbered line`);
      okIf("41s fitAspect centres what it fits, an unmeasured capture takes SHOT.unknownAspect, and a blank phrase is never numbered");
    }
  }
  if (failures === before41) pass("screenshots are framed, pins point where they are told or say they moved, and the deck never claims a callout it did not draw");

  /* 42. THE TOOL OFFERS EXACTLY THE LAYOUTS THE BUILDER CAN DRAW.
   *
   * Nothing asserted this, and it cost real work. For nearly the whole of
   * 2026-08-18..2026-09-16 the `generate_slides` layout enum offered 25 of the
   * 29 layouts in `LAYOUTS`: `table` (renderable from de2c75f, 2026-08-31),
   * `statement` (2a008a2, 2026-09-01) and `layers` (1453cee, 2026-09-03) were
   * geometry-checked, drawn correctly, and INVISIBLE TO THE MODEL for 15, 14
   * and 12 days, until 38c9d10 on 2026-09-15.
   *
   * On 2026-08-31 a user asked twice, by name, for the table layout. The model
   * read its enum, correctly replied that there was no layout literally called
   * "table" in the slide tool, and shipped `content` with a table payload —
   * which draws no table at all (check 44f). The model was accurate about its
   * tool and wrong about the product.
   *
   * The nearest thing to a guard was a hand-written list of five names in
   * check 20d, which is the hand-kept-list-that-drifts pattern CLAUDE.md
   * already warns about. This compares the SETS, in BOTH directions, on every
   * route that takes a layout — a layout offered but not drawable is the same
   * fault seen from the other side, and sends the model to a name that falls
   * through to prose.
   *
   * AGAINST LAYOUT_STYLE, NOT AGAINST `LAYOUTS`, and the difference is the
   * whole defect. `LAYOUTS` is a plain `SlideLayout[]`, so the compiler only
   * requires it to be a SUBSET of the union: a layout can be missing from it
   * with tsc clean. Nothing at runtime reads it to decide what can be drawn —
   * `buildSlideRequests` accepts a layout iff LAYOUT_STYLE has the key, and
   * LAYOUT_STYLE is a `Record<SlideLayout, …>`, which the compiler DOES force
   * to hold every member of the union. So the drawable set is LAYOUT_STYLE's
   * keys, and `LAYOUTS` is a register of it that can itself drift — deleting
   * "layers" from `LAYOUTS` and from both enums left this check green, and
   * printing "both layout enums offer exactly the 28 layouts the builder
   * draws" about a builder that still drew 29. (c) pins the register to the
   * type so that stays impossible.
   *
   * MUTATION LOG (detached worktree, 2026-09-17, restored after):
   *   KILLED  delete "table", "statement" and "layers" from the slides.items
   *           enum — the tool's exact state for a fortnight → direction (a)
   *           red, naming all three
   *   KILLED  delete "hub" from the editSlide enum only → red on that route
   *           alone, which is what proves each route is really read
   *   KILLED  give insertSlides.items a hand-written schema offering 2 of the
   *           29 layouts → that route's precondition AND direction (a) red,
   *           and nothing else. It shares SLIDE_ITEM_PROPS today and so cannot
   *           drift, which is exactly the assumption worth asserting: three
   *           hand-kept copies of this schema drifted once already, which is
   *           why leanSchema exists (providers.ts:1547)
   *   KILLED  add "dashboard" to the slides.items enum → direction (b) red
   *   KILLED  delete "layers" from LAYOUTS and from all three enums — tsc
   *           clean, because LAYOUTS is a plain array — → FOUR red: each route
   *           reports the layout hidden, and (c) reports the register short.
   *           Against `LAYOUTS` this was the survivor that mattered: the check
   *           compared the enums with the drifted register, agreed with
   *           itself, and printed "exactly the 28 layouts the builder draws"
   *           while buildSlideRequests still drew 29.
   *   SURVIVOR  reordering any enum survives, deliberately: order is not
   *             meaning here, and pinning it would fail on every honest edit.
   */
  const before42 = failures;
  console.log(`\n42. The tool offers exactly the layouts the builder can draw`);
  let routes42 = 0;
  {
    const A42 = (ok: boolean, msg: string) => { if (!ok) fail(msg); };
    const params: any = (SLIDES_GEN_OPENAI_TOOL as any).function.parameters;
    const at = (o: any, path: string[]) => {
      let cur = o;
      for (let i = 0; i < path.length && cur; i++) cur = cur[path[i]];
      return cur;
    };
    // ALL THREE ROUTES THAT TAKE A LAYOUT. The third is the one the tool's own
    // description calls "THIS IS HOW A LONG DECK IS BUILT": it shares
    // SLIDE_ITEM_PROPS with the first today and therefore cannot drift, which
    // is a property of the code as written and not a thing anyone asserted.
    const ROUTES: [string, any][] = [
      ["slides[].layout", at(params, ["properties", "slides", "items", "properties", "layout"])],
      ["editSlide.layout", at(params, ["properties", "editSlide", "properties", "layout"])],
      ["editSlide.insertSlides[].layout", at(params, ["properties", "editSlide", "properties", "insertSlides", "items", "properties", "layout"])],
    ];
    routes42 = ROUTES.length;
    // WHAT THE BUILDER CAN DRAW, read off the one table the compiler forces to
    // be complete. See the note above: `LAYOUTS` is a register of this and can
    // drift from it, so it is compared against rather than trusted.
    const drawable: string[] = Object.keys(LAYOUT_STYLE);
    // PRECONDITIONS, because a comparison of two empty sets passes for ever.
    A42(drawable.length > 20, `precondition: LAYOUT_STYLE holds ${drawable.length} layouts — the comparison below would be vacuous`);
    for (let r = 0; r < ROUTES.length; r++) {
      const route = ROUTES[r][0];
      const schema = ROUTES[r][1];
      const offered: string[] = (schema && Array.isArray(schema.enum) ? schema.enum : []).map((x: any) => String(x));
      A42(offered.length > 20, `precondition: ${route} declares ${offered.length} layouts — there is no enum there to compare`);
      if (!offered.length) continue;
      // (a) EVERY LAYOUT THE BUILDER DRAWS IS OFFERED. The direction the
      // fortnight of drift was in.
      const hidden: string[] = [];
      for (let i = 0; i < drawable.length; i++) if (offered.indexOf(drawable[i]) < 0) hidden.push(drawable[i]);
      // (b) AND NOTHING ELSE IS.
      const phantom: string[] = [];
      for (let i = 0; i < offered.length; i++) if (drawable.indexOf(offered[i]) < 0) phantom.push(offered[i]);
      // Each message names BOTH sets. This is the check most likely to go red
      // on a colleague mid-change — anyone adding a layout trips it — so it
      // says what to do rather than only what is wrong.
      A42(hidden.length === 0,
        `${route} hides ${hidden.length} layout(s) the builder can draw: ${hidden.join(", ")}.`
        + ` The enum offers [${offered.join(", ")}]; LAYOUT_STYLE in lib/slides/brand.ts draws [${drawable.join(", ")}].`
        + ` ADD the missing name(s) to that enum in lib/ai/providers.ts — a layout the enum does not name cannot be chosen,`
        + ` however well it renders: table, statement and layers were invisible to the model for a fortnight exactly this way.`);
      A42(phantom.length === 0,
        `${route} offers ${phantom.length} layout(s) the builder cannot draw: ${phantom.join(", ")}.`
        + ` The enum offers [${offered.join(", ")}]; LAYOUT_STYLE in lib/slides/brand.ts draws [${drawable.join(", ")}].`
        + ` Either give the layout a LAYOUT_STYLE entry and a branch in buildSlideRequests, or REMOVE the name from that enum —`
        + ` a name the builder does not know falls through to prose, and the user gets a bulleted slide they did not ask for.`);
    }
    // (c) AND THE REGISTER AGREES WITH THE TYPE. `LAYOUTS` is what everything
    // human-facing iterates — the tool's own catalogue was generated from it —
    // so a layout missing from it is invisible in a different way, and a name
    // in it that the builder cannot draw sends a reader to a layout that does
    // not exist. Same two directions, same house style: name both sets.
    const unregistered: string[] = [];
    for (let i = 0; i < drawable.length; i++) if ((LAYOUTS as string[]).indexOf(drawable[i]) < 0) unregistered.push(drawable[i]);
    const undrawable: string[] = [];
    for (let i = 0; i < LAYOUTS.length; i++) if (drawable.indexOf(LAYOUTS[i]) < 0) undrawable.push(LAYOUTS[i]);
    A42(unregistered.length === 0,
      `LAYOUTS in lib/slides/brand.ts is missing ${unregistered.length} layout(s) the builder can draw: ${unregistered.join(", ")}.`
      + ` LAYOUTS holds [${LAYOUTS.join(", ")}]; LAYOUT_STYLE draws [${drawable.join(", ")}].`
      + ` ADD the name to LAYOUTS: it is a plain array, so the compiler never notices the omission, and every catalogue built from it —`
      + ` including the tool's — quietly stops mentioning a layout that renders perfectly well.`);
    A42(undrawable.length === 0,
      `LAYOUTS in lib/slides/brand.ts names ${undrawable.length} layout(s) the builder cannot draw: ${undrawable.join(", ")}.`
      + ` LAYOUTS holds [${LAYOUTS.join(", ")}]; LAYOUT_STYLE draws [${drawable.join(", ")}].`
      + ` REMOVE the name, or give it a LAYOUT_STYLE entry and a branch in buildSlideRequests.`);
  }
  if (failures === before42) pass(`all ${routes42} layout enums offer exactly the ${Object.keys(LAYOUT_STYLE).length} layouts the builder draws`);

  /* 43. THE PREVIEW KNOWS EVERY SHAPE THE DECK DRAWS.
   *
   * Check 3 asserts that every REQUEST KIND the builder emits is handled by
   * toPreviewModel. It says nothing about the `shapeType` values INSIDE
   * createShape, and those fail differently: an unrecognised shape is not
   * dropped, it is drawn as a plain rectangle. So a composer reaching for a
   * DIAMOND, a CHEVRON or a PENTAGON gets the right shape in Drive and a grey
   * rectangle in the chat preview AND in the PDF, which is built from the same
   * model — the deck is right and the two things the user looks at before
   * publishing are wrong. That is the dropped-scrim-alpha failure again, which
   * is the one failure a preview may not have.
   *
   * RECTANGLE is the default arm, and is therefore recognised by accident: it
   * is the ONE shape for which "anything I do not know is a rectangle" gives
   * the right answer. It is named below for that reason and no other.
   *
   * Three halves — the word is wrong and the reason is worth the sentence.
   * The EMITTED one sees what the battery actually draws, across all 29
   * layouts plus the overloaded and screenshot fixtures. The SOURCE one sees a
   * shape emitted on a branch no fixture takes, which the emitted one cannot.
   * The RENDERER one sees the other end: recognising a shape in the preview
   * MODEL is only half the journey, because the two things the user looks at
   * before publishing — the chat preview and the PDF — each read that model
   * separately. A flag the model sets and a renderer ignores is the same
   * failure from the far side, and it is not hypothetical: deleting
   * `el.rounded` from SlideDraftPreview previews every note bar, card, layer
   * band and hub node with square corners, and survived this whole suite.
   *
   * MUTATION LOG (detached worktree, 2026-09-17, restored after):
   *   KILLED  the table's header band emitted as a DIAMOND → the EMITTED half
   *           red naming DIAMOND, AND the source scan's precondition red. The
   *           second one is worth reading: that shape goes through filledShape,
   *           whose call sites do not carry the word `shapeType`, so the source
   *           half could not see it and said so rather than reporting agreement.
   *   KILLED  DIAMOND added to filledShape's type union and used nowhere →
   *           the SOURCE half red alone, which is the half that exists for it
   *   KILLED  "ELLIPSE" removed from preview-model's createShape branch → both
   *           halves red, naming ELLIPSE
   *   KILLED  point the source scan at a file with no shapeType in it → the
   *           precondition fires rather than reporting agreement
   *   KILLED  SlideDraftPreview's borderRadius stops reading `el.rounded` →
   *           the RENDERER half red on that file alone. This is the mutation
   *           that used to be recorded here as a survivor, and the entry was
   *           wrong about which mutation it was: renaming the `rounded` FIELD
   *           in preview-model is killed by `tsc --noEmit`, item one of the
   *           suite, because both renderers read it by name. It is a renderer
   *           that silently IGNORES the flag that nothing caught.
   *   SURVIVOR  a renderer that reads the flag and draws the wrong thing with
   *             it — `borderRadius: el.rounded ? 1 : 0` — survives, and always
   *             will here: this check is about whether the distinction
   *             SURVIVES the journey, not about what is drawn at the end of it.
   *             Pinning the radius would need a rendered-pixel comparison,
   *             which is a different check than this one.
   */
  const before43 = failures;
  console.log(`\n43. The preview knows every shape the deck draws`);
  {
    const A43 = (ok: boolean, msg: string) => { if (!ok) fail(msg); };
    const bare = (src: string) => src.replace(/^[ \t]*\/\*[\s\S]*?\*\//gm, "").replace(/(^|[ \t])\/\/[^\n]*/gm, "$1");
    // WHAT THE PREVIEW RECOGNISES, read out of its createShape branch rather
    // than written down here — a list in this file would be the same
    // hand-kept list that made check 20d's five names useless.
    const previewSrc = bare(readFileSync(join(__dirname, "..", "lib/slides/preview-model.ts"), "utf8"));
    const start = previewSrc.indexOf(`kind === "createShape"`);
    const end = previewSrc.indexOf(`kind === "createImage"`, start);
    A43(start >= 0 && end > start, `precondition: preview-model.ts has no createShape branch to read (${start}, ${end})`);
    const branch = start >= 0 && end > start ? previewSrc.slice(start, end) : "";
    const recognised: string[] = ["RECTANGLE"];   // the default arm; see above
    const lit = /shapeType === "([A-Z][A-Z_]{2,})"/g;
    for (let m = lit.exec(branch); m; m = lit.exec(branch)) {
      if (recognised.indexOf(m[1]) < 0) recognised.push(m[1]);
    }
    A43(recognised.length >= 4, `precondition: only ${recognised.length} shape(s) read out of the createShape branch — the scan found nothing to compare against`);

    // (a) EMITTED: every shape the battery actually draws.
    const emitted43: string[] = [];
    for (let i = 0; i < ALL.length; i++) {
      const reqs = buildSlideRequests(ALL[i], i, "sh") as any[];
      for (let r = 0; r < reqs.length; r++) {
        const st = reqs[r].createShape && reqs[r].createShape.shapeType;
        if (st && emitted43.indexOf(String(st)) < 0) emitted43.push(String(st));
      }
    }
    A43(emitted43.indexOf("TEXT_BOX") >= 0 && emitted43.indexOf("RECTANGLE") >= 0,
      `precondition: the battery emitted ${emitted43.length} shape type(s) (${emitted43.join(", ")}) — it is not drawing anything`);
    const strangers: string[] = [];
    for (let i = 0; i < emitted43.length; i++) if (recognised.indexOf(emitted43[i]) < 0) strangers.push(emitted43[i]);
    A43(strangers.length === 0,
      `the deck draws ${strangers.join(", ")} and toPreviewModel does not recognise ${strangers.length === 1 ? "it" : "them"}:`
      + ` correct in Drive, a plain grey rectangle in the chat preview and in the PDF.`
      + ` The preview knows [${recognised.join(", ")}]; the builder emits [${emitted43.join(", ")}].`
      + ` ADD an arm for ${strangers.join(", ")} to the createShape branch of lib/slides/preview-model.ts and to the renderer that reads it,`
      + ` or draw the shape with one of the kinds the preview already knows.`);

    // (b) SOURCE: a shape emitted on a branch no fixture takes is invisible to
    // (a), and the fixtures are the thing most likely to fall behind a new
    // layout. Every UPPER_CASE literal on a line that mentions shapeType,
    // which is both the direct createShape calls and filledShape's own
    // vocabulary — its type union is where a new shape is declared first.
    const genSrc = bare(readFileSync(join(__dirname, "..", "lib/slides/generate.ts"), "utf8"));
    const written: string[] = [];
    const genLines = genSrc.split("\n");
    for (let i = 0; i < genLines.length; i++) {
      if (genLines[i].indexOf("shapeType") < 0) continue;
      const names = /"([A-Z][A-Z_]{2,})"/g;
      for (let m = names.exec(genLines[i]); m; m = names.exec(genLines[i])) {
        if (written.indexOf(m[1]) < 0) written.push(m[1]);
      }
    }
    A43(written.length >= emitted43.length,
      `precondition: the source scan found ${written.length} shape name(s) (${written.join(", ")}) against ${emitted43.length} actually emitted — it is not reading the builder`);
    const unknownWritten: string[] = [];
    for (let i = 0; i < written.length; i++) if (recognised.indexOf(written[i]) < 0) unknownWritten.push(written[i]);
    A43(unknownWritten.length === 0,
      `lib/slides/generate.ts names the shape type(s) ${unknownWritten.join(", ")} and toPreviewModel recognises none of them,`
      + ` so any slide reaching that branch previews and prints as a grey rectangle while Drive is correct.`
      + ` The preview knows [${recognised.join(", ")}]. Give the createShape branch of lib/slides/preview-model.ts an arm for each.`);

    // (c) RENDERERS: every distinction the model draws OUT of a shapeType has
    // to survive into both things the user looks at. The model turns a
    // shapeType into a flag (`rounded`, `arrow`, `arrowDown`, `arrowUp`) or
    // into a `kind` ("ellipse"); a renderer that never reads one draws the
    // shape as a plain rectangle, which is the exact failure this check exists
    // to prevent, arriving one file later. Read out of the branch's own source
    // for the same reason `recognised` is: a list written here is the
    // hand-kept list again.
    const flags43: string[] = [];
    const flagRe = /([a-z][A-Za-z]*): body\.shapeType === "[A-Z][A-Z_]{2,}",/g;
    for (let m = flagRe.exec(branch); m; m = flagRe.exec(branch)) {
      if (flags43.indexOf(m[1]) < 0) flags43.push(m[1]);
    }
    const kinds43: string[] = [];
    const kindRe = /kind: body\.shapeType === "[A-Z][A-Z_]{2,}" \? "([a-z]+)"/g;
    for (let m = kindRe.exec(branch); m; m = kindRe.exec(branch)) {
      if (kinds43.indexOf(m[1]) < 0) kinds43.push(m[1]);
    }
    A43(flags43.length >= 4 && kinds43.length >= 1,
      `precondition: the createShape branch yielded ${flags43.length} flag(s) (${flags43.join(", ")}) and ${kinds43.length} kind(s) (${kinds43.join(", ")})`
      + ` — the scan is not reading the branch, so the assertions below would hold over nothing`);
    const RENDERERS43: [string, string][] = [
      ["lib/slides/pdf-html.ts", bare(readFileSync(join(__dirname, "..", "lib/slides/pdf-html.ts"), "utf8"))],
      ["components/ai-writer/SlideDraftPreview.tsx", bare(readFileSync(join(__dirname, "..", "components/ai-writer/SlideDraftPreview.tsx"), "utf8"))],
    ];
    for (let r = 0; r < RENDERERS43.length; r++) {
      const file = RENDERERS43[r][0];
      const text = RENDERERS43[r][1];
      A43(text.indexOf("PreviewElement") >= 0 || text.indexOf("el.kind") >= 0,
        `precondition: ${file} does not look like a renderer of the preview model — the assertions below would hold over the wrong file`);
      for (let f = 0; f < flags43.length; f++) {
        // Word-bounded, or `.arrow` would be satisfied by `.arrowDown`.
        A43(new RegExp("\\." + flags43[f] + "\\b").test(text),
          `toPreviewModel sets \`${flags43[f]}\` from a shapeType and ${file} never reads it,`
          + ` so that shape renders there as a plain rectangle while Drive and the other renderer are right.`
          + ` The branch sets [${flags43.join(", ")}]. Read the flag in ${file}, or stop setting it in lib/slides/preview-model.ts.`);
      }
      for (let k = 0; k < kinds43.length; k++) {
        A43(text.indexOf(`"${kinds43[k]}"`) >= 0,
          `toPreviewModel gives a shape the kind "${kinds43[k]}" and ${file} never mentions it,`
          + ` so it is drawn there as whatever the default arm draws. Handle "${kinds43[k]}" in ${file},`
          + ` or stop distinguishing it in lib/slides/preview-model.ts.`);
      }
    }
  }
  if (failures === before43) pass(`every shape the builder draws is one the preview recognises, and both renderers read every distinction it makes`);

  /* 44. A TABLE SLIDE DRAWS ITS COMMENTARY, AND A TABLE NO LAYOUT DRAWS IS REFUSED.
   *
   * Two live defects, both measured over the 39 decks built between 2026-08-18
   * and 2026-09-16 with the product's own `droppedContent`:
   *
   *   - `table` NEVER drew `body`, at any row count: the gate passed only
   *     `bodyRight` into tableRequests. 17 shipped client slides carried 963
   *     words of analyst copy the deck did not contain — the "so what" beside
   *     the figures, which is usually the point of the slide.
   *   - `content` silently ignored a `table` payload, every row and every
   *     heading. That is how 11 rows and 4 column headings reached a client
   *     deck as nothing at all, on the day the enum did not offer `table`
   *     (check 42).
   *
   * The rows take the band first: a table cut to fit a paragraph is a worse
   * slide than the paragraph moved, and the single-line floor is the one place
   * tableRequests loses words with no "Showing N of M" line to declare them.
   * So the assertions run in BOTH directions — a body that fits is drawn, a
   * body that cannot fit is named and refused rather than clipped — because a
   * rule that only ever draws is satisfied by drawing through the footer, and
   * a rule that only ever refuses is satisfied by refusing everything.
   *
   * MUTATION LOG (detached worktree, 2026-09-17, restored after):
   *   KILLED  reintroduce the gate — `bodyRight` into tableRequests and no body
   *           box at all, which is exactly how it shipped → THIRTEEN
   *           assertions red across 44a, 44b, 44c, 44d, 44e, 44f, 44h, 44i and
   *           44g, with droppedContent naming the paragraph and
   *           prepareSlidesForBuild refusing the deck it used to build in
   *           silence
   *   KILLED  draw the body regardless of what fits (no ladder, no refusal) →
   *           nine red: the paragraph is drawn on a slide with no room
   *   KILLED  drop the `hugRows` arm, so the rows keep padding themselves →
   *           44c red
   *   KILLED  undrawnTableSlides returning [] → 44f red: a content+table deck
   *           passes in silence
   *   KILLED  the guard in prepareSlidesForBuild stops asking undrawnTableSlides
   *           → 44g red; and again for undrawnTableBodies → 44g red. The
   *           predicates on their own prove nothing about what is refused.
   *   KILLED  let the "does not fit" note QUOTE the paragraph, in quoteClip's
   *           own form → 44e red, once. Worth reading for what it does NOT
   *           prove: droppedContent leaves text a layout note already quotes
   *           to that note, so quoting here makes "nothing was dropped" true
   *           by suppression rather than by drawing — in the AUDIT the user
   *           reads, which is deckWarnings, which passes the notes in. The
   *           build-time refusal stayed green and should have: it asks the
   *           builder whether the box was emitted and never looks at a note.
   *           (The mutation only reproduces in quoteClip's form. Appending the
   *           raw paragraph survives, because its newlines are not the clip's.)
   *   KILLED  the guard asks droppedContent again, as it first did → 44e red
   *           twice, on the echoed standfirst and the nine-character body.
   *           Its five-word prefix and ten-character floor are right for an
   *           audit and wrong for a refusal.
   *   KILLED  collapse tableWidthFor to GRID.contentWidth → 44h red: 227pt of
   *           paragraph printed across the commentary rail. Before 44h existed
   *           this survived the entire suite.
   *   KILLED  silence either type step-down — the table's or the paragraph's,
   *           `if (false && …)` → 44i red, separately for each. Before 44i
   *           both could be deleted with the suite green, on the path that
   *           fires on most of the slides Stage 0 recovered.
   *   SURVIVOR  TABLE_BODY_GAP 10 → 8 survives: these assertions are about
   *             words reaching the slide, not about the air above them.
   *   SURVIVOR  two earlier forms of 44c, both recorded rather than deleted.
   *             `rowsBottom(with body) <= rowsBottom(without)` survives the
   *             hugRows mutation because the slack deal-back is capped at 3pt
   *             a row and both cases reach the cap — the numbers come out
   *             identical, and `<=` cannot tell identical from hugged. So does
   *             comparing a one-line body against a three-paragraph one, for
   *             the same reason. Only the STRICT form kills it.
   */
  const before44 = failures;
  console.log(`\n44. A table slide draws its commentary, and a table no layout draws is refused`);
  {
    const A44 = (ok: boolean, msg: string) => { if (!ok) fail(msg); };
    const TSPEC = {
      columns: ["Domain competing for Amrize queries", "Shared KW", "Their traffic", "DR"],
      rows: [
        ["holcim.com - legacy parent", "108", "8,853", "76"],
        ["holcimgroup.com - legacy parent", "30", "493", "47"],
        ["holcim.co.uk - a UK site on US queries", "25", "2,981", "65"],
        ["holcimalpenaconnect.com - orphaned plant site", "19", "49", "0.9"],
      ],
    };
    const ANALYSIS =
      "Amrize still ranks for holcim us, lafarge canada and dozens more legacy terms.\n"
      + "The missing fact: no page on amrize.com states the June 2025 carve-out from Holcim as a machine-readable fact.\n"
      + "Source: Ahrefs Site Explorer and Keywords Explorer, 20 August 2026.";
    const drawnTextOf = (s: SlideInput, i: number, run: string) =>
      (buildSlideRequests(s, i, run) as any[]).filter((r) => r.insertText).map((r) => r.insertText.text).join(" | ");
    const rowsBottom = (s: SlideInput, i: number, run: string) => {
      let bottom = 0;
      const reqs = buildSlideRequests(s, i, run) as any[];
      for (let r = 0; r < reqs.length; r++) {
        const o = reqs[r].createShape;
        if (!o || !/_(tz\d|trb\d|trr\d|tc\d)/.test(String(o.objectId))) continue;
        bottom = Math.max(bottom, o.elementProperties.transform.translateY + o.elementProperties.size.height.magnitude);
      }
      return bottom;
    };
    const shapeOf = (reqs: any[], suffix: string) => {
      for (let r = 0; r < reqs.length; r++) {
        const o = reqs[r].createShape;
        if (o && String(o.objectId).slice(-suffix.length) === suffix) {
          return {
            x: o.elementProperties.transform.translateX, y: o.elementProperties.transform.translateY,
            w: o.elementProperties.size.width.magnitude, h: o.elementProperties.size.height.magnitude,
          };
        }
      }
      return null;
    };

    // 44a THE BODY IS DRAWN — this is the exact shape of a slide that shipped.
    {
      const s: SlideInput = { layout: "table", eyebrow: "THE PICTURE TODAY",
        title: "The brand transition is visibly incomplete in search",
        subtitle: "The single closest organic competitor to Amrize is its own former parent.",
        table: TSPEC, body: ANALYSIS };
      const drawn = drawnTextOf(s, 0, "t44a");
      A44(drawn.indexOf("The missing fact") >= 0,
        `a table slide's body is not drawn at all — this is the gate that lost 963 words across 17 shipped slides (${drawn.slice(0, 140)})`);
      A44(drawn.indexOf("holcimgroup.com") >= 0, `drawing the body cost the table its rows (${drawn.slice(0, 140)})`);
      // 44b …AND THE AUDIT AGREES. Drawn and still reported would mean the
      // slide and the warning disagree, which is worse than either alone.
      const lost = droppedContent(s, 0);
      A44(lost.length === 0, `the deck is told it carries text this table slide never draws: ${JSON.stringify(lost)}`);
    }

    // 44c THE ROWS HUG THEIR WORDS WHEN A BODY FOLLOWS, so the slack falls
    // BELOW the prose rather than inside the table — check 27's rule, and the
    // stat grid's, where the figures top-align the moment anything follows
    // them. Four short rows are dealt the band's slack back when they are
    // alone; with a paragraph beneath them they must not be.
    //
    // STRICTLY LOWER, and the strictness is the whole assertion. Written as
    // `hugged <= padded` it survived the mutation that removed the hug
    // outright, because the deal-back is capped at 3pt a row and a table with
    // a body reaches the same cap inside its shortened band: the two numbers
    // came out identical and a `<=` cannot tell identical from hugged.
    {
      const padded = rowsBottom({ layout: "table", title: "Rows alone", table: TSPEC }, 0, "t44c1");
      const hugged = rowsBottom({ layout: "table", title: "Rows and prose", table: TSPEC, body: ANALYSIS }, 1, "t44c2");
      A44(padded > 0 && hugged > 0, `precondition: no table rows were found to measure (${padded}, ${hugged})`);
      A44(padded - hugged > 3,
        `four short rows end at ${hugged.toFixed(1)}pt with a paragraph beneath them and ${padded.toFixed(1)}pt with the band to themselves —`
        + ` the rows are being padded either way, so the slack sits inside the table rather than under the prose`);
      // And hugging pays for itself out of padding, never out of content.
      A44(drawnTextOf({ layout: "table", title: "Rows and prose", table: TSPEC, body: ANALYSIS }, 1, "t44c3").indexOf("holcimalpenaconnect") >= 0,
        `the last row went missing once a body was added — the rows are paying for the prose`);
    }

    // 44d NOTHING OVERRUNS: the paragraph stays inside the bottom margin, and
    // above the takeaway bar, which is drawn last and over everything.
    {
      const s: SlideInput = { layout: "table", title: "Rows, prose and a takeaway", table: TSPEC, body: ANALYSIS,
        note: "Why this matters: the former parent is the closest competitor." };
      const reqs = buildSlideRequests(s, 0, "t44d") as any[];
      const box = shapeOf(reqs, "_body");
      const bar = shapeOf(reqs, "_noteBar");
      A44(!!box, `a table slide with a takeaway drew no body at all`);
      if (box) {
        A44(box.y + box.h <= CANVAS.height - GRID.margin + 0.6,
          `the body runs to ${(box.y + box.h).toFixed(1)}pt, past the bottom margin at ${(CANVAS.height - GRID.margin).toFixed(1)}`);
        if (bar) {
          A44(box.y + box.h <= bar.y + 0.6,
            `the body ends at ${(box.y + box.h).toFixed(1)}pt and the takeaway bar starts at ${bar.y.toFixed(1)} — the bar is drawn over the prose`);
        }
      }
    }

    // 44e A BODY THAT CANNOT FIT IS NOT CLIPPED, AND IS REPORTED. Nine rows of
    // long cells and a takeaway leave no room for a paragraph; the honest
    // outcome is that the words are named rather than half-drawn.
    {
      const big = { columns: ["Workstream", "What it produces", "Owner", "When"],
        rows: Array.from({ length: 9 }, (_, i) => [
          `Workstream ${i + 1} with a name long enough to wrap onto a second line`,
          "A deliverable described at the length a real scorecard cell runs to",
          "Communications", "Q3"]) };
      const s: SlideInput = { layout: "table", title: "Everything at once", table: big as any, body: ANALYSIS,
        note: "Why this matters: the programme is bigger than one quarter." };
      const notes: string[] = [];
      const drawn = (buildSlideRequests(s, 0, "t44e", notes) as any[]).filter((r) => r.insertText).map((r) => r.insertText.text).join(" | ");
      A44(drawn.indexOf("The missing fact") < 0,
        `a paragraph with no room beneath nine rows was drawn anyway — it can only be running through something`);
      A44(notes.some((n) => n.indexOf("`bodyRight`") >= 0),
        `nothing named the field the paragraph should move to: ${JSON.stringify(notes)}`);
      // The words stay REPORTED. droppedContent leaves text a layout note
      // already quotes to that note, so a note that quoted the paragraph would
      // silence the audit — and "nothing was dropped" would be true by
      // suppression rather than by drawing.
      A44(droppedContent(s, 0, notes).length > 0, `the paragraph was neither drawn nor reported — it is simply gone`);
      // AND THE CALL IS REFUSED, so no deck is ever built with it missing.
      const refused = undrawnTableBodies([s]);
      A44(refused.length === 1 && refused[0].slide === 1,
        `the guard cannot see a table slide whose body will not be drawn (${JSON.stringify(refused)})`);
      // The control, or the guard refuses every table slide with prose on it.
      A44(undrawnTableBodies([{ layout: "table", title: "Fits", table: TSPEC, body: ANALYSIS }]).length === 0,
        `the guard refuses a table slide whose body fits perfectly well`);

      // AND IT ASKS THE BUILDER, NOT THE AUDIT. The first version of this
      // guard asked droppedContent, which compares a five-word normalised
      // PREFIX and ignores anything under eleven characters — both right for
      // an audit meant to survive upper-casing and fitCell's ellipsis, both
      // wrong for a refusal. Two bodies slipped through it while the builder
      // itself was recording that they were NOT drawn: one opening with the
      // words of its own standfirst, which is how an analyst writes a slide,
      // and one of nine normalised characters, which was never compared at
      // all. Each was undrawn, unreported and unrefused — the silent loss
      // this whole check exists to close, reached by a different door.
      const ECHOES: [string, SlideInput][] = [
        ["a body that opens with its own standfirst", { layout: "table", title: "Everything at once",
          subtitle: "The single closest organic competitor to Amrize is its own former parent.",
          table: big as any, note: "Why this matters: the programme is bigger than one quarter.",
          body: "The single closest organic competitor to Amrize is its own former parent, and no page on the site says the carve-out happened." }],
        ["a body shorter than the audit's floor", { layout: "table", title: "Everything at once",
          table: big as any, note: "Why this matters: the programme is bigger than one quarter.",
          body: "Up 12% YoY" }],
      ];
      for (let e = 0; e < ECHOES.length; e++) {
        const what = ECHOES[e][0];
        const slide = ECHOES[e][1];
        // The precondition IS the finding: if the builder starts drawing these
        // the assertion below is about nothing, and should be rewritten rather
        // than left to pass.
        A44(!shapeOf(buildSlideRequests(slide, 0, `t44e${e}`) as any[], "_body"),
          `precondition: ${what} is now drawn beneath nine rows, so this assertion no longer tests the guard`);
        A44(undrawnTableBodies([slide]).length === 1,
          `${what} is not drawn and the guard cannot see it — the deck builds and ships without the paragraph,`
          + ` which is the silent loss this check exists to close`);
      }
      // The control for both: the same short body with the room to be drawn.
      A44(undrawnTableBodies([{ layout: "table", title: "Everything at once", table: big as any, body: "Up 12% YoY" }]).length === 0,
        `the guard refuses a short body that the slide has room for`);
    }

    // 44f A TABLE ON A LAYOUT THAT NEVER DRAWS ONE IS REFUSED, naming the
    // field and the fix. This is conv 5cc58f2c's slide 1, as it shipped.
    {
      const s: any = { layout: "content", title: "The brand transition is visibly incomplete in search",
        subtitle: "The closest organic competitor is its own former parent.", body: ANALYSIS, table: TSPEC };
      A44(drawnTextOf(s, 0, "t44f").indexOf("holcimgroup.com") < 0,
        `precondition: content now draws a table, so this section is about a defect that no longer exists — rewrite it`);
      const said = undrawnTableSlides([s]);
      A44(said.length === 1, `a content slide carrying a four-row table is accepted in silence (${JSON.stringify(said)})`);
      if (said.length) {
        A44(said[0].indexOf("`table`") >= 0 && said[0].indexOf(`"table"`) >= 0,
          `the refusal names neither the field carried nor the layout to move to: ${said[0]}`);
      }
      const faults = undrawnTableFaults([s]);
      A44(faults.length === 1 && faults[0].slide === 1 && faults[0].reason.indexOf("`") < 0,
        `the person's version of the fault is missing, or written in field names: ${JSON.stringify(faults)}`);
      // BOTH DIRECTIONS, or the guard refuses every table slide in the product.
      A44(undrawnTableSlides([{ layout: "table", title: "T", table: TSPEC }]).length === 0,
        `the guard refuses a table payload on the table layout itself`);
      // An empty payload is not a loss: the table layout would draw nothing
      // from it either, so refusing over one would be noise.
      A44(undrawnTableSlides([{ layout: "content", title: "T", body: "x", table: { columns: [], rows: [] } }]).length === 0,
        `an empty table payload on a content slide is refused, which is noise`);
    }

    // 44h THE PROSE AND THE RAIL DO NOT SHARE A COLUMN. A table slide may
    // carry both — `bodyRight` beside the rows and `body` beneath them — and
    // this is the shape of the shipped slides Stage 0 recovered. The table
    // gives up a third of the measure to the rail, so the paragraph beneath it
    // must take the SAME measure and not the full content width; the rail is
    // drawn to the foot of the slide, so a full-width paragraph prints
    // straight across it. Both boxes come out of one width helper for exactly
    // this reason, and collapsing that helper to `GRID.contentWidth` survived
    // every other assertion in this file: 227pt of paragraph across the rail's
    // column, silently, on the layout this check exists to fix.
    {
      const s: SlideInput = { layout: "table", title: "Legacy domains", table: TSPEC, body: ANALYSIS,
        bodyRight: "The former parent still outranks Amrize on its own name, two quarters after the carve-out." };
      const reqs = buildSlideRequests(s, 0, "t44h") as any[];
      const box = shapeOf(reqs, "_body");
      const rail = shapeOf(reqs, "_trail");
      A44(!!box, `a table slide carrying both a rail and a paragraph drew no paragraph at all`);
      A44(!!rail, `a table slide carrying both a rail and a paragraph drew no rail at all`);
      if (box && rail) {
        A44(box.x + box.w <= rail.x + 0.6,
          `the paragraph runs from ${box.x.toFixed(1)} to ${(box.x + box.w).toFixed(1)}pt and the commentary rail starts at ${rail.x.toFixed(1)}pt —`
          + ` the body is printed across the rail, which is drawn to the foot of the slide`);
      }
      // BOTH WAYS ROUND, or "narrower than the slide" is satisfied by a
      // paragraph that is always narrow and never on the rows' measure.
      const alone = shapeOf(buildSlideRequests({ layout: "table", title: "Legacy domains", table: TSPEC, body: ANALYSIS }, 0, "t44h2") as any[], "_body");
      A44(!!alone && !!box && alone.w > box.w + 100,
        `the paragraph is set on the same measure with a rail beside the table (${box ? box.w.toFixed(1) : "none"}pt)`
        + ` as without one (${alone ? alone.w.toFixed(1) : "none"}pt) — one of the two is on the wrong measure`);
      A44(!!alone && alone.w >= GRID.contentWidth - 0.6,
        `with no rail the paragraph is ${alone ? alone.w.toFixed(1) : "none"}pt wide against a content width of ${GRID.contentWidth.toFixed(1)}pt —`
        + ` it should take the same measure as the rows, which take all of it`);
      // And the words are all there, which is what the width is in aid of.
      A44(droppedContent(s, 0).length === 0, `a table slide with a rail AND a paragraph loses text: ${JSON.stringify(droppedContent(s, 0))}`);
    }

    // 44i AND A TYPE STEP DOWN IS DECLARED — BOTH OF THEM. Stage 0's rule was
    // "do not shrink the table to make room without saying so", and the same
    // argument covers the prose: 8pt is `caption` size, two steps under body,
    // so a paragraph placed there reads as a footnote rather than as the
    // slide's argument. Neither declaration was asserted anywhere, and both
    // could be deleted with this whole suite green — on the path that fires on
    // most of the slides Stage 0 recovered.
    {
      const long = { columns: ["Workstream", "What it produces", "Owner", "When"],
        rows: Array.from({ length: 8 }, (_, i) => [
          `Workstream ${i + 1} on the transition programme`,
          "A deliverable described at the length a real scorecard cell runs to",
          "Communications", "Q3"]) };
      const s: SlideInput = { layout: "table", title: "Everything at once", table: long as any,
        body: "The missing fact: no page on amrize.com states the June 2025 carve-out from Holcim as a machine-readable fact.",
        note: "Why this matters: the programme is bigger than one quarter." };
      const notes: string[] = [];
      const reqs = buildSlideRequests(s, 0, "t44i", notes) as any[];
      A44(!!shapeOf(reqs, "_body"),
        `precondition: the slide this section is about no longer draws its body, so it is measuring the wrong branch`);
      // Anchored at the start, because "the paragraph beneath the table is set
      // at…" CONTAINS "the table is set at…" and a substring match counted the
      // paragraph's declaration as the table's.
      const says = (what: string, where: string) => {
        const hit = notes.filter((n) => n.indexOf(where) === 0 && n.indexOf("rather than") >= 0 && n.indexOf("pt") >= 0);
        A44(hit.length === 1,
          `${what} was set smaller to make room and nothing says so — the author asked for neither.`
          + ` The slide's notes were ${JSON.stringify(notes)}`);
      };
      says("the table", "the table is set at");
      says("the paragraph", "the paragraph beneath the table is set at");
      // THE CONTROL. A slide that shrank nothing says nothing, or the note is
      // noise on every table slide in the deck and stops being read.
      const quiet: string[] = [];
      buildSlideRequests({ layout: "table", title: "Legacy domains", table: TSPEC, body: ANALYSIS }, 0, "t44i2", quiet);
      A44(quiet.filter((n) => n.indexOf("rather than") >= 0).length === 0,
        `a table slide that gave up no type step still announces one: ${JSON.stringify(quiet)}`);
    }

    // 44g THE GUARD USES THEM, which is the assertion that matters. Two of the
    // three faults this repo has closed on the strength of a line merely
    // EXISTING were found this way: a function that reports a fault and a
    // call path that never asks it are indistinguishable from silence. So
    // these run through prepareSlidesForBuild itself — the seam both routes
    // pass through — rather than through the predicates alone.
    {
      const conv = `verify44-${process.pid}-${failures}`;
      const cover = { layout: "cover", title: "Amrize" };
      const said = async (input: any, id: string | null) => {
        try { await prepareSlidesForBuild(input, id); return ""; }
        catch (e: any) { return `${e instanceof SlideCallRefusal ? "" : "NOT-A-REFUSAL: "}${String(e && e.message || e)}`; }
      };
      const tabled = await said({ title: "Amrize", slides: [cover,
        { layout: "content", title: "Legacy domains", body: ANALYSIS, table: TSPEC }] }, conv);
      A44(tabled.indexOf("cannot draw") >= 0 && tabled.indexOf("NOT-A-REFUSAL") < 0,
        `a deck with a content slide carrying a table is BUILT — the guard never asks: ${JSON.stringify(tabled.slice(0, 160))}`);
      const bigTable = { columns: ["Workstream", "What it produces", "Owner", "When"],
        rows: Array.from({ length: 9 }, (_, i) => [
          `Workstream ${i + 1} with a name long enough to wrap onto a second line`,
          "A deliverable described at the length a real scorecard cell runs to",
          "Communications", "Q3"]) };
      const overrun = await said({ title: "Amrize", slides: [cover,
        { layout: "table", title: "Everything at once", table: bigTable, body: ANALYSIS,
          note: "Why this matters: the programme is bigger than one quarter." }] }, conv);
      A44(overrun.indexOf("`bodyRight`") >= 0 && overrun.indexOf("NOT-A-REFUSAL") < 0,
        `a deck whose table body cannot be drawn is BUILT, and the user is told it says something it does not: ${JSON.stringify(overrun.slice(0, 160))}`);
      // THE CONTROL. A table slide whose body fits is built, or these two
      // refusals have simply turned the layout off.
      const fine = await said({ title: "Amrize", slides: [cover,
        { layout: "table", title: "Legacy domains", table: TSPEC, body: ANALYSIS }] }, conv);
      A44(fine === "", `a table slide whose body fits beneath its rows is refused: ${JSON.stringify(fine.slice(0, 160))}`);
    }
  }
  if (failures === before44) pass("a table slide's commentary is drawn beneath its rows or named and refused, and a table no layout draws never passes in silence");

  /* 45. THE FIGURES GET THEIR LINE OF CONTEXT, OR THE DECK SAYS THEY COULD NOT.
   *
   * Measured over the 39 decks built between 2026-08-18 and 2026-09-16 with
   * the product's own `droppedContent`: thirteen stat slides carried a
   * `subtitle` that the layout drew nowhere, because the standfirst was gated
   * on `layout !== "stat"`. The model kept writing the field, which is what
   * made it a decision rather than a bug — and Chris took it on 2026-09-17:
   * DRAW it on `stat`, LEAVE `image-split` dropping it.
   *
   * WHY THIS IS NOT ONE ASSERTION THAT THE SUBTITLE IS DRAWN. Because the
   * version of this change that draws it is the wrong one. `stat` does not use
   * `chartBandTop`: it hands the WHOLE band to statRequests, so deleting the
   * exclusion prints the line of type at the top of a band the figures still
   * believe they own — straight through the numbers on every top-aligned
   * slide, and through the hero's 131pt figure on every single-stat one. The
   * centred branches hide it, which is exactly why 45b runs the hero, the
   * top-aligned row and the grid rather than the comfortable case.
   *
   * And the figures must not PAY for it. The block's ladder will always make
   * room if it is asked to: five rungs, then the source lines, then the
   * figures themselves — each declared on the slide in 7pt, so a standfirst
   * bought that way is a slide that traded a number for a sentence and
   * admitted it in the smallest type on the page. 45d and 45e are the two
   * halves of that, and each runs BOTH ways round: a refusal that refuses
   * everything is as useless as a rule that always draws.
   *
   * AND THE QUIET HALF, WHICH IS WHERE THIS CHECK WAS FIRST FOUND WANTING.
   * Everything above is a collision, a dropped figure or a word that never
   * reached the slide, and the file was already full of sweeps that catch
   * those. The re-split can also go wrong without producing any of them: a
   * block that is ALONE in its band is centred rather than top-aligned, so
   * centring it in the whole band after the top of it has been given away
   * simply slides the figures 16pt down the slide — no overlap, nothing off
   * the canvas, every figure present, every word drawn. Eight of the twelve
   * slides this change recovers are exactly that shape, and the entire suite
   * stayed green under it. 45i is that rule; 45j is its sibling on the hero,
   * whose REPORTED height is what places the bullets; 45k is the one case
   * where centring legitimately pushes a block through the floor of the band.
   *
   * MUTATION LOG (detached worktree at e111314 carrying the two changed files,
   * 2026-09-17, restored after; the shared tree was never mutated — it
   * deploys, and a deliberate break has reached production from it once
   * already). Counts are FAIL lines across the whole file, not check 45 alone.
   *
   *   THE DECISION ITSELF
   *   KILLED  reintroduce the exclusion — `lib/slides/generate.ts` restored to
   *           e111314 wholesale, which is exactly how it shipped → 17 red
   *           across 45a, 45b, 45c, 45d, 45e, 45f, 45i and 45j, with
   *           droppedContent naming the standfirst on the slide that used to
   *           carry it
   *   KILLED  "just delete the exclusion": drop `&& layout !== "stat"` from
   *           the chart-band condition at e111314 and leave statRequests the
   *           whole band → 22 red. Check 2 on the shared fixtures is the
   *           standfirst printed through "64 GW", "70%", "380 GW" and four of
   *           the grid's cards; 45i is the other end of the same mistake, the
   *           self-contained row and grid each moving 0.0pt for 33.4pt of
   *           extra type. It PASSES 45a, which is why 45a is not the
   *           assertion.
   *   KILLED  widen the decision to `image-split` — the standfirst drawn into
   *           the text column beside the photograph → 45g red three times. The
   *           asymmetry is deliberate and nothing else in this file holds it.
   *
   *   THE BAND TOP, THREADED (each half of this was mutated ON ITS OWN, after
   *   a verifier showed that the composite entry this replaces — "the row
   *   placed from GRID.bodyY and centred in the full band" — was crediting a
   *   collision with covering a silent 16pt slide. The two halves are now
   *   separate lines because they fail in completely different ways.)
   *   KILLED  the two-or-three row PLACED from `GRID.bodyY` (`top = GRID.bodyY
   *           + …`, room kept) → 10 red, three of them check 2's overlaps:
   *           "A standfirst long " over "64 GW", "70%", "380 GW"
   *   KILLED  the two-or-three row CENTRED in the full band (`(band - groupH)
   *           / 2`, bandTop kept) → 1 red, and 45i is the only thing in the
   *           file that says it: the row moves 33.3pt for 33.4pt of type
   *           where it should move half. Before 45i existed this scored ZERO.
   *   KILLED  the grid CENTRED in the full band (`(band - plan.height) / 2`)
   *           → 2 red. Before 45i existed this scored 1, and that one was
   *           45d's both-ways-round control firing incidentally.
   *   KILLED  statGridRequests measuring its rungs against the full band
   *           (`room = band`) → 3 red: the ladder holds rung 24 and the block
   *           then fails its own affordability probe, so the grid silently
   *           stops offering the line at all
   *   KILLED  heroStat solved from `band` rather than the room under `bandTop`
   *           → 3 red, the hero staying at 131pt
   *   KILLED  the hero's REPORTED height, `height: room, bottom: bandTop +
   *           room` → `height: band, bottom: bandTop + band` → 1 red. Before
   *           45j existed this scored zero: no fixture anywhere in this file
   *           carried a stat slide with one figure AND a body, which is the
   *           only shape that reads it.
   *   KILLED  the bullets placed from `GRID.bodyY + stat.height` instead of
   *           `bandTop + …` → 7 red: check 2 drawing the prose through the
   *           labels and the source lines, and 45j moving the scorecard under
   *           the hero 31.9pt up the slide
   *
   *   WHAT THE LINE IS ALLOWED TO COST
   *   KILLED  afford the standfirst unconditionally (drop the whole probe
   *           comparison) → 4 red, the bullets dropping to 8pt to buy a
   *           sentence and the refusal note vanishing with them
   *   KILLED  afford it whenever the FIGURES are unchanged, ignoring the prose
   *           → 4 red, same shape
   *   KILLED  drop the PROSE SIZE arm (`was.style.size === now.style.size`)
   *           → 1 red on 45e's one-rung fixture: two bullets that fit at 10pt
   *           without the line and at 9pt with it, drawn without a word said.
   *           Before that fixture existed this arm did no work on any fixture
   *           in the file and survived being deleted.
   *   KILLED  drop the INK arm (`after.ink <= the band floor`) → 2 red on 45k.
   *           Recorded as a survivor when this check was written, because no
   *           fixture then filled a centred band; the fixture that reaches it
   *           is three figures whose labels wrap and whose source lines wrap
   *           twice, leaving 11pt of slack — enough for the block, not enough
   *           for half a standfirst.
   *   KILLED  drop the DRAWN-TEXT arm (`after.drawn === asIs.drawn`) → 7 red:
   *           a figure dropped and declared in 7pt, the block moved under a
   *           refusal, and droppedContent falling silent
   *   KILLED  drop the MOVED-BOTTOM arm (`after.bottom <= asIs.bottom`), so
   *           prose that already overruns buys the line however far down the
   *           slide it is pushed → 1 red on 45f's both-ways-round control
   *   KILLED  `return now.fits …` — the absolute-fit rule this shipped with,
   *           restored → 1 red on 45j's precondition. It refuses a standfirst
   *           that is provably free on prose that was ALREADY overrunning,
   *           which is conversation df7700f1's slide 15: every box on that
   *           slide is byte-identical with the line and without it.
   *   KILLED  the body ladder `[base.size, 9, 8]` → `[base.size, 9]`, so a
   *           body that does not fit at 9pt is drawn at 9pt straight through
   *           the takeaway bar → 1 red on 45e's floor pair
   *   KILLED  STAT_BODY_GAP 10 → 24, and 10 → 4 → 1 red each on 45h. The
   *           constant was newly named by this change and nothing measured it;
   *           45h states it against the body's own type size rather than
   *           against the number, so it is a rule and not a second copy.
   *
   *   THE REFUSAL
   *   KILLED  let the refusal QUOTE the subtitle, in quoteClip's own form →
   *           3 red. Worth reading for what the second one proves:
   *           droppedContent leaves text a layout note already quotes to that
   *           note, so quoting here makes "nothing was dropped" true by
   *           suppression rather than by drawing, in the audit the user reads.
   *   KILLED  the remedy unconditional again — "move it to `note`" on a slide
   *           whose `note` is a four-line takeaway → 1 red. The advice was
   *           wrong on most of the slides that get it: a takeaway is usually
   *           WHY the band ran out, since bandHeightFor takes the bar out of
   *           it, so the model was being told to overwrite the one field it
   *           could see was full.
   *   KILLED  drop the note entirely → 3 red, including 45f's both-ways-round
   *           control on a slide whose takeaway bar IS free
   *
   *   SURVIVORS — findings about the fixture set, not omissions to tidy away
   *   SURVIVOR  STANDFIRST_GAP 8 → 6 survives everything here. These
   *             assertions are about words reaching the slide and boxes not
   *             sitting on each other, not about the air between them; 45b
   *             reads the gap out of the builder rather than asserting a
   *             number, deliberately, because pinning 8 here would be a second
   *             copy of a constant rather than a check. (Its sibling
   *             STAT_BODY_GAP is NOT in the same position: it is pinned by
   *             45h, because moving that one moves the bullets on real slides
   *             — seven of the 39-deck corpus — while moving this one moves
   *             nothing there at all.)
   *   SURVIVOR  drop the FIT-OUTCOME arm (`was.fits === now.fits`) and nothing
   *             goes red, on this file or on the corpus. It is unreachable
   *             rather than untested: the two fits are read out of a room
   *             derived from the block's own reported bottom, so they can only
   *             differ when that bottom MOVES — and when it moves and the
   *             prose stops fitting, the arm beside it (`after.bottom <=
   *             asIs.bottom`) has already refused. Kept because it is the
   *             plain statement of the rule the comment above it makes, and
   *             because it is the arm that would start doing work the day the
   *             hero's reported height is made honest.
   */
  const before45 = failures;
  console.log(`\n45. The figures get their line of context, or the deck says they could not`);
  {
    const A45 = (ok: boolean, msg: string) => { if (!ok) fail(msg); };
    // The shape of ten of the thirteen: three figures and a sentence of
    // provenance under the title.
    const SUB = "Audit run, 2 September 2026. PromptStage over 61 prompts. Not weekly monitoring.";
    const WRAPPING = "A standfirst long enough to wrap onto a second line under the title, because the model writes"
      + " the finding out in full rather than in a phrase, and the band has to pay for every line of it somehow.";
    const THREE = [
      { value: "64 GW", label: "Global capacity", detail: "Installed by end of 2023." },
      { value: "70%", label: "Cost fall since 2010", detail: "Competitive with fossil." },
      { value: "380 GW", label: "IEA projection", detail: "Under current policies." }];
    const GRID7 = Array.from({ length: 7 }, (_, i) => ({
      value: `${10 + i}%`, label: `A label for figure number ${i + 1} that runs to some length`, detail: `Source ${i + 1}, 2026` }));
    const GRID8 = Array.from({ length: 8 }, (_, i) => ({
      value: `${10 + i}%`,
      label: `A label for figure number ${i + 1} that runs long enough to wrap onto three lines inside its own card`,
      detail: `Source ${i + 1}, a citation long enough to wrap, 2026` }));
    const NOTE3 = "Why this matters: the second row is the point, and this sentence runs long enough to take"
      + " three lines of the takeaway bar beneath the cards.";
    const NOTE4 = "Why this matters: the second row is the point, and this sentence runs long enough to take four"
      + " full lines of the takeaway bar beneath the cards, which is the most the bar will ever carry before it clips.";
    const BODY = "Foundations are in place.\nAlmost everything that earns visibility is absent.\nThe gap is content surface, not authority.";
    const LONG_BODY = "Foundations are in place and the crawl is clean.\nAlmost everything that earns visibility in an"
      + " AI answer is absent from the site today.\nThe gap is content surface rather than authority, which is the"
      + " cheaper of the two to close.\nThe next quarter should spend on pages, not on links.";
    // A THREE-LINE standfirst, for the pair comparisons: a block that centres
    // in the room gives up HALF of what the line takes, so the assertion is
    // only sharp when the two subtitles differ by a visible amount of type.
    const WRAPPING3 = "A standfirst long enough to wrap onto a third line under the title, because the model writes the"
      + " finding out in full rather than in a phrase, and every line of it has to be paid for out of the band the"
      + " figures were given.";
    const GRID6 = Array.from({ length: 6 }, (_, i) => ({
      value: `${10 + i}%`, label: `Figure ${i + 1}`, detail: `Source ${i + 1}, 2026` }));
    // The shape of conversation df7700f1's slide 15: ONE figure, drawn as the
    // hero, with the scorecard beneath it.
    const HERO1 = [{ value: "62", label: "Composite score", detail: "Out of 100." }];
    const SCORECARD = "1. Technical foundations: 13/20 — Sound core, but no Canadian English tree and no llms.txt"
      + "\n2. On-page SEO: 8/20 — Generic title tags, very thin product pages, no specifications"
      + "\n3. AEO, answer engines: 5/20 — No FAQ anywhere, no schema anywhere, headings written as slogans"
      + "\n4. GEO, generative engines: 6/20 — 26 AI citations, no AI Overview citations, no Wikipedia, no Wikidata"
      + "\n5. EEAT and trust: 9/20 — Strong governance pages; no authors, no dates, no certifications surfaced";
    const PARA = (n: number) => `Point number ${n}: a bullet written out at the length the model actually writes them,`
      + ` which is a clause and then a consequence.`;
    const BULLETS = (n: number) => Array.from({ length: n }, (_, i) => PARA(i + 1)).join("\n");

    /** Everything about one built stat slide that these assertions read. */
    const drawOf = (s: SlideInput, run: string) => {
      const notes: string[] = [];
      const reqs = buildSlideRequests(s, 0, run, notes) as any[];
      let sub: { y: number; h: number } | null = null;
      let figuresTop = Infinity, figuresInk = 0, valueSize = 0, bodySize = 0, bodyTop = 0;
      const text: string[] = [];
      for (let r = 0; r < reqs.length; r++) {
        const o = reqs[r].createShape;
        if (o) {
          const oid = String(o.objectId);
          const y = o.elementProperties.transform.translateY;
          const h = o.elementProperties.size.height.magnitude;
          // Every box the stat block draws: the cards, the figures, the
          // labels, the per-card sources and its own declaration line.
          if (/_(sc\d+|sv\d+|sl\d+|sd\d+|sdrop)$/.test(oid)) {
            figuresTop = Math.min(figuresTop, y);
            figuresInk = Math.max(figuresInk, y + h);
          }
          if (/_sub$/.test(oid)) sub = { y, h };
          if (/_body$/.test(oid)) bodyTop = y;
        }
        const u = reqs[r].updateTextStyle;
        if (u && u.style?.fontSize) {
          if (/_sv0$/.test(String(u.objectId))) valueSize = u.style.fontSize.magnitude;
          if (/_body$/.test(String(u.objectId))) bodySize = u.style.fontSize.magnitude;
        }
        if (reqs[r].insertText) text.push(String(reqs[r].insertText.text));
      }
      return { sub, figuresTop, figuresInk, valueSize, bodySize, bodyTop, notes,
        text: text.join(" | "), floor: GRID.bodyY + bandHeightFor(s) };
    };
    const without = (s: SlideInput): SlideInput => { const c: any = { ...s }; delete c.subtitle; return c; };

    // 45a THE LINE IS DRAWN, AND THE AUDIT AGREES. Drawn and still reported
    // would mean the slide and the warning disagree, which is worse than
    // either alone.
    {
      const s: SlideInput = { layout: "stat", eyebrow: "THE PICTURE TODAY", title: "Two rates, two populations",
        subtitle: SUB, stats: THREE };
      const d = drawOf(s, "t45a");
      A45(!!d.sub, `a stat slide's standfirst is drawn nowhere — this is the exclusion that lost it on 13 shipped slides`);
      A45(d.text.indexOf("PromptStage over 61 prompts") >= 0, `the standfirst box is drawn empty (${d.text.slice(0, 120)})`);
      A45(droppedContent(s, 0).length === 0,
        `the deck is told it carries text this stat slide never draws: ${JSON.stringify(droppedContent(s, 0))}`);
    }

    // 45b AND THE FIGURES START BENEATH IT. The whole of the change: the band
    // is RE-SPLIT rather than the line simply placed at the top of it. Run on
    // the hero (which fills the band with one number), on a top-aligned row
    // and on a top-aligned grid, because the centred branches have enough
    // slack of their own to hide the collision.
    {
      const CASES: [string, SlideInput][] = [
        ["the hero figure", { layout: "stat", title: "Composite 62 of 100", subtitle: SUB, stats: [THREE[0]] }],
        ["a row with bullets beneath it", { layout: "stat", title: "The five pillars", subtitle: SUB, stats: THREE, body: BODY }],
        ["a grid with a takeaway beneath it", { layout: "stat", title: "The landscape", subtitle: WRAPPING, stats: GRID7, note: NOTE3 }],
        ["a centred row", { layout: "stat", title: "Two rates", subtitle: WRAPPING, stats: THREE }],
      ];
      for (let c = 0; c < CASES.length; c++) {
        const what = CASES[c][0];
        const d = drawOf(CASES[c][1], `t45b${c}`);
        // The precondition IS the finding: an assertion about where the
        // figures sit under a standfirst that was refused tests nothing.
        A45(!!d.sub, `precondition: ${what} refused its standfirst, so the collision assertion below is about nothing`);
        if (!d.sub) continue;
        const bottom = d.sub.y + d.sub.h;
        A45(bottom <= d.figuresTop + 0.01,
          `on ${what} the standfirst runs to ${bottom.toFixed(1)}pt and the figures start at ${d.figuresTop.toFixed(1)}pt —`
          + ` the line is printed through the numbers, which is what deleting the exclusion without re-splitting the band does`);
        A45(d.figuresInk <= d.floor + 0.6,
          `on ${what} the figures reach ${d.figuresInk.toFixed(1)}pt against a band floor of ${d.floor.toFixed(1)}pt —`
          + ` the standfirst took the top of the band and the block kept measuring against all of it`);
      }
    }

    // 45c AND THE BAND BELOW IT IS SHORTER, not merely started lower. The
    // block solves its own size from the room it is given — the hero's figure
    // and the grid's rung both — so a standfirst that moves the top without
    // shortening the measure is a block that overruns rather than compresses.
    // Asserted as a COMPARISON against the same slide with no subtitle, so
    // nothing here is a second copy of a rung table.
    {
      const hero: SlideInput = { layout: "stat", title: "Composite 62 of 100", subtitle: SUB, stats: [THREE[0]] };
      const big = drawOf(without(hero), "t45c1"), small = drawOf(hero, "t45c2");
      A45(small.valueSize > 0 && big.valueSize > 0, `precondition: no hero figure was sized to compare (${big.valueSize}, ${small.valueSize})`);
      A45(small.valueSize < big.valueSize,
        `the hero figure is ${small.valueSize}pt with a standfirst above it and ${big.valueSize}pt without —`
        + ` the number is being solved from a band it no longer has all of`);
      const grid: SlideInput = { layout: "stat", title: "The landscape", subtitle: WRAPPING, stats: GRID7, note: NOTE3 };
      const wide = drawOf(without(grid), "t45c3"), tight = drawOf(grid, "t45c4");
      A45(tight.valueSize < wide.valueSize,
        `the grid's figures stay at ${tight.valueSize}pt under a two-line standfirst, the same rung they take without one —`
        + ` the ladder is stepping against the band the slide would have had rather than the one it has`);
    }

    // 45d THE FIGURES NEVER PAY FOR IT. The ladder runs out on eight long-
    // labelled figures under a four-line takeaway; the honest outcome is no
    // standfirst, not seven figures and a 7pt line saying so.
    //
    // Asserted as "the slide is drawn EXACTLY as it would be with no subtitle
    // at all", which is stronger than looking for the declaration string: a
    // refusal that costs the slide anything at all is not a refusal.
    {
      const s: SlideInput = { layout: "stat", title: "Everything at once", subtitle: SUB, stats: GRID8, note: NOTE4 };
      const d = drawOf(s, "t45d1"), bare = drawOf(without(s), "t45d2");
      A45(!d.sub, `eight figures under a four-line takeaway found room for a standfirst — it can only have taken it from them`);
      A45(d.text.indexOf("Showing") < 0 || bare.text.indexOf("Showing") >= 0,
        `a figure was dropped to make room for the standfirst, and declared in 7pt: ${d.text.slice(-120)}`);
      A45(d.figuresTop === bare.figuresTop && d.figuresInk === bare.figuresInk && d.valueSize === bare.valueSize,
        `refusing the standfirst still moved the figures: top ${d.figuresTop.toFixed(1)} vs ${bare.figuresTop.toFixed(1)},`
        + ` ink ${d.figuresInk.toFixed(1)} vs ${bare.figuresInk.toFixed(1)}, ${d.valueSize}pt vs ${bare.valueSize}pt`);
      // BOTH WAYS ROUND, or "refuse when the grid is full" is satisfied by
      // refusing every grid there is. The same eight figures with the band's
      // other end back can afford it.
      const roomier = drawOf({ layout: "stat", title: "Everything at once", subtitle: SUB, stats: GRID8 }, "t45d3");
      A45(!!roomier.sub,
        `eight figures with no takeaway bar beneath them still refuse a standfirst — the layout has simply stopped drawing it`);
    }

    // 45e AND NOR DOES THE PROSE. A body pushed from 10pt to the 8pt floor to
    // make room for a line above it is the slide's argument demoted to a
    // footnote, silently. Same shape: refused, and refused for free.
    {
      const s: SlideInput = { layout: "stat", title: "The five pillars", subtitle: SUB, stats: THREE,
        body: LONG_BODY, note: NOTE4 };
      const d = drawOf(s, "t45e1"), bare = drawOf(without(s), "t45e2");
      A45(bare.bodySize > 0, `precondition: the fixture drew no bullets, so there is no prose to protect`);
      A45(!d.sub, `the bullets under the figures were made to pay for the standfirst above them`);
      A45(d.bodySize === bare.bodySize,
        `the bullets are set at ${d.bodySize}pt with a standfirst attempted and ${bare.bodySize}pt without it —`
        + ` the slide's argument was stepped down to caption size to buy a sentence, and nothing says so`);
      // BOTH WAYS ROUND: a shorter body on the same figures affords it, and
      // affords it without touching the prose either.
      const fits: SlideInput = { layout: "stat", title: "The five pillars", subtitle: SUB, stats: THREE, body: BODY };
      const shorter = drawOf(fits, "t45e3"), shorterBare = drawOf(without(fits), "t45e4");
      A45(!!shorter.sub, `a three-line body refuses the standfirst too — the prose test is refusing everything`);
      A45(shorter.bodySize === shorterBare.bodySize,
        `the standfirst was drawn AND the bullets stepped down from ${shorterBare.bodySize}pt to ${shorter.bodySize}pt —`
        + ` affording it cost the prose after all`);

      // AND THE STEP THAT IS ONE RUNG, NOT TWO. Everything above turns on the
      // body OVERRUNNING; nothing above turns on its SIZE, because on every
      // other fixture here the prose either fits at its own size or does not
      // fit at all. This is the case in between, and it is the one the failure
      // message two assertions up is written about: two bullets under a
      // takeaway bar fit at 10pt with no standfirst and at 9pt with one. The
      // slide is still readable, which is exactly what makes the demotion
      // silent — so it is refused, and refused for free.
      const ONE_RUNG: SlideInput = { layout: "stat", title: "The five pillars", subtitle: SUB, stats: THREE,
        body: BULLETS(2), note: NOTE3 };
      const rung = drawOf(ONE_RUNG, "t45e5"), rungBare = drawOf(without(ONE_RUNG), "t45e6");
      A45(rungBare.bodySize > 0 && rung.bodySize > 0, `precondition: the one-rung fixture drew no bullets`);
      A45(rung.bodySize === rungBare.bodySize,
        `the bullets are set at ${rung.bodySize}pt with a standfirst attempted and ${rungBare.bodySize}pt without it —`
        + ` one rung is still a demotion, and it is the quietest one there is`);

      // AND THE LADDER GOES ALL THE WAY DOWN. The step-down under the figures
      // is 10, then 9, then the 8pt floor, and the floor is the rung that
      // matters: Slides does not shrink text to fit, it draws it straight
      // through the takeaway bar beneath. A ladder that stops at 9 passes
      // every assertion above, because they all compare two sizes that moved
      // together. Asserted as a comparison — the same prose in a band with the
      // bar taken out of it must end up SMALLER, not pinned at a rung.
      const floorBody = BULLETS(6);
      const roomy = drawOf({ layout: "stat", title: "The five pillars", stats: THREE, body: floorBody }, "t45e7");
      const tight = drawOf({ layout: "stat", title: "The five pillars", stats: THREE, body: floorBody, note: NOTE3 }, "t45e8");
      A45(roomy.bodySize > 0 && tight.bodySize > 0, `precondition: the floor fixture drew no bullets`);
      A45(tight.bodySize < roomy.bodySize,
        `the same prose is ${roomy.bodySize}pt with no takeaway bar and ${tight.bodySize}pt with one — the ladder has`
        + ` stopped stepping, so a body that does not fit is drawn through the bar rather than at the floor`);
    }

    // 45f A REFUSAL NAMES THE FIELD, DOES NOT QUOTE IT, AND STAYS REPORTED.
    // The note names `subtitle` so the model can move the line; it must not
    // QUOTE it, because droppedContent leaves text a layout note has already
    // quoted to that note — so a quoting note would make "nothing was dropped"
    // true by suppression, in the audit the user actually reads.
    {
      const s: SlideInput = { layout: "stat", title: "Everything at once", subtitle: SUB, stats: GRID8, note: NOTE4 };
      const notes: string[] = [];
      buildSlideRequests(s, 0, "t45f", notes);
      A45(notes.some((n) => n.indexOf("`subtitle`") >= 0),
        `nothing named the field whose line could not be placed: ${JSON.stringify(notes)}`);
      A45(!notes.some((n) => n.indexOf(quoteClip(SUB)) >= 0),
        `the note QUOTES the standfirst, which silences droppedContent about it: ${JSON.stringify(notes)}`);
      A45(droppedContent(s, 0, notes).some((m) => m.trim() === SUB),
        `the standfirst was neither drawn nor reported — it is simply gone`);
      A45(deckWarnings([s]).indexOf(quoteClip(SUB).slice(0, 40)) >= 0,
        `deckWarnings does not name the standfirst this slide could not draw: ${deckWarnings([s]).slice(-200)}`);

      // AND THE REMEDY IS FREE ON THE SLIDE IT IS PRINTED ON. "Move it to
      // `note`" is good advice on a slide with no takeaway and actively wrong
      // on one that has a full one — and a takeaway is usually the REASON the
      // band ran out, because bandHeightFor takes the bar's height out of it.
      // The fixture above carries a four-line bar, so the unconditional
      // wording was telling the model to overwrite content it can see.
      A45(!notes.some((n) => n.indexOf("move it to `note`") >= 0),
        `the slide already carries a four-line takeaway and the refusal still says to move the standfirst into`
        + ` \`note\` — the one field on the slide that is full: ${JSON.stringify(notes)}`);
      A45(notes.some((n) => n.indexOf("shorten") >= 0), `the refusal offers no remedy at all: ${JSON.stringify(notes)}`);
      // BOTH WAYS ROUND: with the bar gone, `note` is the right place for it
      // and the wording has to say so rather than always hedging.
      const free: string[] = [];
      buildSlideRequests({ layout: "stat", title: "Everything at once", subtitle: SUB,
        stats: GRID8, body: LONG_BODY } as SlideInput, 0, "t45f2", free);
      A45(free.some((n) => n.indexOf("`subtitle`") >= 0) && free.some((n) => n.indexOf("move it to `note`") >= 0),
        `a refused standfirst on a slide with an EMPTY takeaway bar is not pointed at it: ${JSON.stringify(free)}`);
    }

    // 45g AND `image-split` STILL DROPS IT, AND STILL SAYS SO.
    //
    // The decision is asymmetric on purpose — on image-split the line competes
    // with the photograph for the same column — and nothing else in this file
    // holds that half of it, so widening the condition one layout too far
    // would be a silent change to eight shipped slides. Both halves asserted:
    // it is not drawn, and the loss is declared in the channel that already
    // exists. And NOT declared twice: a second note for a loss deckWarnings
    // already names is noise, and noise is how a warning stops being read.
    {
      const sub = "They sit above every traditional channel, reading and synthesising across all of them at once";
      const s: SlideInput = { layout: "image-split", eyebrow: "The shift", title: "AI assistants are a layer, not a channel",
        subtitle: sub, body: "Every channel below is read, compared and synthesised before the answer is written.",
        resolvedImage: { url: "p.jpg", scrim: 0 } as any };
      const notes: string[] = [];
      const reqs = buildSlideRequests(s, 0, "t45g", notes) as any[];
      const drew = (reqs.filter((r) => r.insertText).map((r) => String(r.insertText.text))).some((t) => t.trim() === sub);
      A45(!drew, `image-split now draws its subtitle — the decision of 2026-09-17 was to leave it dropped, where it`
        + ` competes with the photograph for the same column; reopen it with Chris, not here`);
      A45(droppedContent(s, 0, notes).some((m) => m.trim() === sub),
        `image-split drops its subtitle and droppedContent no longer reports it — the loss has gone silent`);
      A45(deckWarnings([s]).indexOf(quoteClip(sub).slice(0, 40)) >= 0,
        `the user is told nothing about the line this image-split slide swallowed: ${deckWarnings([s]).slice(-200)}`);
      A45(!notes.some((n) => n.indexOf("`subtitle`") >= 0),
        `image-split declares the same loss twice — once through droppedContent and once through a layout note: ${JSON.stringify(notes)}`);
    }

    // 45h AND A STAT SLIDE WITH NO SUBTITLE IS EXACTLY WHERE IT WAS. The
    // re-split threads a band TOP through three branches, a five-rung ladder
    // and two centring rules; every stat slide in the corpus that carries no
    // subtitle — which is most of them — has to come out unmoved.
    {
      const topped = drawOf({ layout: "stat", title: "The landscape", stats: GRID7, note: NOTE3 }, "t45h1");
      A45(Math.abs(topped.figuresTop - GRID.bodyY) < 0.01,
        `a top-aligned grid with no standfirst starts at ${topped.figuresTop.toFixed(2)}pt rather than at the band's own`
        + ` top of ${GRID.bodyY.toFixed(2)}pt — the re-split has moved slides that asked for nothing`);
      const centred = drawOf({ layout: "stat", title: "Two rates", stats: THREE }, "t45h2");
      const slackAbove = centred.figuresTop - GRID.bodyY;
      const slackBelow = centred.floor - centred.figuresInk;
      A45(Math.abs(slackAbove - slackBelow) < 1,
        `a self-contained row with no standfirst sits ${slackAbove.toFixed(1)}pt below the band's top and`
        + ` ${slackBelow.toFixed(1)}pt above its floor — it is no longer centred in its own band`);

      // AND THE BULLETS STILL SIT JUST UNDER THE FIGURES. The air between the
      // two was a bare 10 in the middle of the branch and is now a named
      // constant, which makes it the kind of thing a later change moves in
      // passing — and nothing anywhere measured it. Stated against the body's
      // own type rather than against the number: the gap has to be more than
      // half a line, or the bullets crowd the source lines above them, and
      // less than a line and a half, or the figures and the argument beneath
      // them stop reading as one block and the last bullet is pushed into the
      // takeaway bar.
      const withBody = drawOf({ layout: "stat", title: "The five pillars", stats: THREE, body: BODY }, "t45h3");
      A45(withBody.bodySize > 0 && withBody.figuresInk > 0, `precondition: the gap fixture drew no bullets under its figures`);
      const air = withBody.bodyTop - withBody.figuresInk;
      A45(air >= withBody.bodySize / 2 && air <= withBody.bodySize * 1.5,
        `the bullets start ${air.toFixed(1)}pt under the figures they belong to, against ${withBody.bodySize}pt body type —`
        + ` that is not the air between a block and its own caption`);
    }

    // 45i AND A SELF-CONTAINED BLOCK CENTRES IN WHAT IS LEFT, NOT IN THE BAND.
    //
    // The one rule of the re-split that leaves no wreckage to trip over. A
    // block that is followed by something is TOP-aligned, so a mis-measured
    // band shows up immediately as a collision and check 2 catches it. A block
    // that is alone is CENTRED, and centring in the full band after the top of
    // it has been given away just slides the figures down the slide: no
    // overlap, nothing off the canvas, nothing dropped — a row sitting 16pt
    // low, on the commonest shape there is (eight of the twelve slides this
    // change recovers are three figures, one line of standfirst, nothing
    // else). It survived every assertion in this file until this one.
    //
    // Asserted WITHOUT any constant, as a pair: the same slide twice, once
    // under a one-line standfirst and once under a three-line one. A block
    // centred in the room it was left moves down by HALF of the extra type; a
    // block centred in the whole band moves down by ALL of it. No gap, no band
    // height and no rung table appears here, so there is nothing to keep in
    // step with the builder.
    {
      const PAIRS: [string, { value: string; label: string; detail: string }[]][] = [
        ["a self-contained row", THREE],
        ["a self-contained grid", GRID6],
      ];
      for (let p = 0; p < PAIRS.length; p++) {
        const what = PAIRS[p][0], stats = PAIRS[p][1];
        const one = drawOf({ layout: "stat", title: "Two rates", subtitle: SUB, stats }, `t45i${p}a`);
        const three = drawOf({ layout: "stat", title: "Two rates", subtitle: WRAPPING3, stats }, `t45i${p}b`);
        A45(!!one.sub && !!three.sub,
          `precondition: ${what} refused one of the two standfirsts, so there is no pair to compare`);
        if (!one.sub || !three.sub) continue;
        // Same block, or the comparison is measuring the ladder rather than
        // the centring.
        A45(one.valueSize === three.valueSize,
          `precondition: ${what} stepped from ${one.valueSize}pt to ${three.valueSize}pt between the two standfirsts,`
          + ` so the two blocks are not the same size and cannot be compared for where they sit`);
        if (one.valueSize !== three.valueSize) continue;
        const extra = (three.sub!.y + three.sub!.h) - (one.sub!.y + one.sub!.h);
        const moved = three.figuresTop - one.figuresTop;
        A45(extra > 20, `precondition: the two standfirsts differ by only ${extra.toFixed(1)}pt of type — too little to tell`
          + ` centring in the room from centring in the band`);
        A45(Math.abs(moved - extra / 2) < 0.6,
          `${what} moved ${moved.toFixed(1)}pt down when the standfirst above it grew by ${extra.toFixed(1)}pt —`
          + ` a block centred in the room it was left moves by half of that, and one centred in the whole band moves`
          + ` by all of it, which is a row sitting low on the slide that nothing else here would notice`);
      }
    }

    // 45j AND THE BULLETS UNDER A HERO FIGURE DO NOT MOVE.
    //
    // The single-stat branch is the one that reports a height rather than
    // measuring one: the hero fills whatever it is given, so it tells the
    // caller it took the whole room, and the caller places the bullets at the
    // foot of that. Which means the re-split has to reach the REPORTED height
    // too, not just the drawing — and if it does not, the standfirst pushes
    // the scorecard under a single big number further down the slide by its
    // own height. This is conversation df7700f1's slide 15, and no other
    // fixture in this file carries a hero with a body.
    //
    // NOT an assertion that the bullets are inside the band: they are not, and
    // they were not before this change either. A single stat reports the WHOLE
    // band as its height, so the scorecard is already placed at the band floor
    // and overruns it — a real fault on a shipped slide, older than this work
    // and left alone by it deliberately, since making that height honest moves
    // the prose on every hero-with-body slide there is. What is asserted is
    // the thing this change is responsible for: that it did not make it worse.
    {
      const HB: SlideInput = { layout: "stat", title: "Composite 62 of 100", subtitle: SUB,
        stats: HERO1, body: SCORECARD };
      const d = drawOf(HB, "t45j1"), bare = drawOf(without(HB), "t45j2");
      A45(!!d.sub, `precondition: the hero-with-body slide refused its standfirst, so nothing below is being measured`);
      A45(d.bodyTop > 0 && bare.bodyTop > 0, `precondition: the hero-with-body fixture drew no bullets`);
      A45(Math.abs(d.bodyTop - bare.bodyTop) < 0.01,
        `the scorecard under the hero figure is at ${d.bodyTop.toFixed(1)}pt with a standfirst above it and`
        + ` ${bare.bodyTop.toFixed(1)}pt without — the hero is reporting a band it no longer has all of, so the line`
        + ` of context above the number pushed the prose beneath it further off the slide`);
      A45(d.valueSize <= bare.valueSize,
        `the hero figure GREW from ${bare.valueSize}pt to ${d.valueSize}pt under a standfirst`);
    }

    // 45k AND A CENTRED BLOCK IS NOT PUSHED THROUGH THE FLOOR OF THE BAND.
    //
    // The branches that are FOLLOWED by something top-align, so whatever the
    // standfirst takes comes off the bottom of the block and lands as a
    // collision that check 2 sees. The branches that are ALONE centre, and a
    // centred block moves DOWN by half of what the line takes — so a block
    // that already fills its band is carried through the floor without
    // overlapping a thing, without dropping a figure, without a rung moving
    // and without one word of the drawn text changing. Every other assertion
    // here would call that free. Three figures with labels that wrap and
    // source lines that wrap twice leave eleven points of slack: enough for
    // the block to fit, not enough for half a standfirst.
    {
      const FAT = [1, 2, 3].map((i) => ({ value: `${i}0%`,
        label: "A label for this figure that runs on and on on and on on and on on and on to some length",
        detail: `Source ${i}, ` + "a citation long enough to wrap and wrap again ".repeat(5) + "2026" }));
      const s: SlideInput = { layout: "stat", title: "Two rates", subtitle: SUB, stats: FAT };
      const d = drawOf(s, "t45k1"), bare = drawOf(without(s), "t45k2");
      A45(bare.figuresInk <= bare.floor + 0.6,
        `precondition: this fixture runs ${(bare.figuresInk - bare.floor).toFixed(1)}pt past its band floor with no`
        + ` standfirst at all, so refusing one proves nothing about the standfirst`);
      A45(bare.floor - bare.figuresInk < 30,
        `precondition: the fixture leaves ${(bare.floor - bare.figuresInk).toFixed(1)}pt of slack, which is room enough`
        + ` for the line — it is no longer the band-filling case this is about`);
      A45(!d.sub,
        `a centred block that fills its band drew a standfirst anyway: its ink reaches ${d.figuresInk.toFixed(1)}pt`
        + ` against a band floor of ${d.floor.toFixed(1)}pt, and centring carries it half of whatever the line takes`
        + ` above it — nothing overlaps, nothing was dropped and every word is still there, which is exactly why`
        + ` only the floor itself can catch this one`);
      A45(d.figuresTop === bare.figuresTop && d.figuresInk === bare.figuresInk,
        `refusing it still moved the block: top ${d.figuresTop.toFixed(1)} vs ${bare.figuresTop.toFixed(1)},`
        + ` ink ${d.figuresInk.toFixed(1)} vs ${bare.figuresInk.toFixed(1)}`);
    }
  }
  if (failures === before45) pass("the standfirst is drawn above the figures out of a band they gave up, or it is named, refused and still reported");

  /* 46. The migration test, and the seam that is not yet a refusal.
   *
   *  Checks 1, 2 and 11 used to be three copies of three predicates living only
   *  in this file. They are now lib/slides/validate.ts and they run on every
   *  deck a user is about to see. That move is only safe if the moved code
   *  measures the SAME THING over the SAME POPULATION, which is what (a) and
   *  (b) assert — not by keeping a second copy to compare against, which would
   *  reintroduce exactly the drift the move exists to remove, but by driving
   *  the module down one route and the fixtures down the other and comparing
   *  the results.
   *
   *  Then the near misses. Every one of the three carries an exclusion that
   *  looks like slack: the corner sampling, the vertical inset, the
   *  side-by-side and single-glyph skips. An exclusion moved without its reason
   *  is a silent behaviour change, so each is driven here in both directions —
   *  the thing it must catch and the thing it must not.
   *
   *  MUTATION LOG (detached worktree, 2026-09-17). The assertions' own log is
   *  in lib/slides/validate.ts; these are the mutations this CHECK is the only
   *  thing standing between and production.
   *   - KILLED (46c): the affine reduced to translate + size x scale. The
   *     sheared fixture's corner is 30pt off the page and its axis-aligned box
   *     is not, so the reduction reports nothing and only 46c notices.
   *   - KILLED (46a, 46f, 46g): off-canvas skipping TEXT_BOX elements — a
   *     validator that sweeps 893 of 1,888 elements and says nothing. Four
   *     assertions go red, and the first of them is the count.
   *   - KILLED (46a): a geometry value made to depend on the run id, so the
   *     guard's build and the preview's build differ. 67 of 67 fixtures.
   *   - KILLED (46e): inkBottom measuring from the top of the page rather than
   *     the top of the box. The precondition catches it first, which is the
   *     point of asserting the fixture's own ink before asserting the verdict.
   *   - KILLED (46g): geometryRefusal ignoring its severity argument. The seam
   *     is driven end to end rather than asserted to exist, because a line
   *     proving a rule was WRITTEN has reported a live hole here as closed.
   *   - KILLED (46h): the notes dropped on the floor inside deckWarnings. A
   *     fault measured and not relayed is the same as no fault at all.
   *   - KILLED (46h): logDeckGeometry emptied out, and separately its call site
   *     removed. The rate is the one input the escalation decision needs, and
   *     it was the one line in this whole change nothing asserted.
   *   - KILLED (46h): the try/catch around the build path's call removed, so a
   *     validator that threw would be the thing that stopped the deck.
   *   - KILLED (46i): the face dropped from the ink measurement, which is how
   *     the module first shipped. Nothing else in 9,000 lines of check notices,
   *     because every title in this battery is long enough to wrap either way.
   *   - KILLED (46j): INK_LEAD loosened to 1.2, and (46a) the ink sweep made to
   *     skip type above 12pt — a validator quietly measuring 786 boxes where
   *     the fixtures draw 897.
   *   - KILLED (46k): the ink gate forced on, and forced off. On, a credit
   *     375pt clear of the footer is reported as drawn through it; off, a real
   *     collision is excused in silence.
   *   - KILLED (46l): the note cap turned down to one, and the counted tail
   *     deleted. What the user is actually TOLD was the only part of the module
   *     nothing drove.
   *   - KILLED (46m): the guards removed, both of them. Each ends with the
   *     validator throwing on the build path, which would make the guard the
   *     thing that stopped the deck.
   *   - KILLED (46n): the bold glyph branch deleted. It used to be killed by
   *     fourteen fixtures and, once the mean became the right mean, by none —
   *     the reason 46n exists is that four real overruns still depend on it.
   *  Two mutations SURVIVED this check and are recorded in validate.ts with
   *  what the corpus said about them: the edge tolerance is unpinned by
   *  anything anyone has built, and the ink tolerance is pinned by the stored
   *  decks and not by these fixtures. */
  const before46 = failures;
  console.log(`\n46. The geometry checks measure a real deck, and say so rather than blocking it`);
  const A46 = (ok: boolean, what: string) => { if (!ok) fail(`46: ${what}`); };

  {
    // (a) PARITY OF THE POPULATION, element by element. The old checks read
    // toPreviewModel(fixtures); the module reads previewSlideFrom over requests
    // it built itself. If those two routes ever disagree the runtime guard is
    // measuring a deck the preview is not showing, which is the one failure a
    // preview may not have.
    // Built under a DIFFERENT run id, so this also pins that the run id reaches
    // object ids and nothing else: two builds of one spec are the same deck.
    const viaPreviewModel = toPreviewModel(ALL);
    let mismatched = 0, comparedBoxes = 0;
    for (let i = 0; i < ALL.length; i++) {
      const direct = previewSlideFrom(ALL[i], buildSlideRequests(ALL[i], i, "v"));
      comparedBoxes += direct.elements.length;
      if (JSON.stringify(direct) !== JSON.stringify(viaPreviewModel.slides[i])) mismatched++;
    }
    A46(comparedBoxes > 1500, `46a precondition: only ${comparedBoxes} elements compared across ${ALL.length} fixtures`);
    A46(mismatched === 0, `46a ${mismatched} of ${ALL.length} fixtures render differently through previewSlideFrom than`
      + ` through toPreviewModel — the runtime guard and the preview disagree`);

    // The counts the module says it swept, against the fixtures' own. A
    // predicate that silently examines nothing passes vacuously, and this repo
    // has already shipped a check that tested exactly nothing.
    let elements = 0;
    for (let i = 0; i < ALL.length; i++) {
      const reqs = buildSlideRequests(ALL[i], i, "v") as any[];
      for (let r = 0; r < reqs.length; r++) {
        const vals = Object.values(reqs[r]);
        const b: any = vals.length ? vals[0] : undefined;
        if (b && b.elementProperties) elements++;
      }
    }
    let textBoxes = 0;
    for (let i = 0; i < viaPreviewModel.slides.length; i++) {
      const els = viaPreviewModel.slides[i].elements;
      for (let e = 0; e < els.length; e++) if (els[e].kind === "text") textBoxes++;
    }
    A46(GEOM_ALL.slidesChecked === ALL.length && GEOM_ALL.unbuildable === 0,
      `46a the validator built ${GEOM_ALL.slidesChecked} of ${ALL.length} fixtures (${GEOM_ALL.unbuildable} unbuildable)`);
    A46(GEOM_ALL.elementsChecked === elements,
      `46a off-canvas swept ${GEOM_ALL.elementsChecked} elements, the fixtures emit ${elements}`);
    A46(GEOM_ALL.textBoxesChecked === textBoxes,
      `46a overlap swept ${GEOM_ALL.textBoxesChecked} text boxes, the preview has ${textBoxes}`);
    // The ink sweep counted EXACTLY, not as a ratio. A ratio passes while half
    // the deck goes unmeasured, and a sweep that quietly stops covering boxes
    // is the way this check goes to sleep without anybody noticing.
    let inkBoxes = 0;
    const viaInk = toPreviewModel(INK);
    for (let i = 0; i < viaInk.slides.length; i++) {
      const els = viaInk.slides[i].elements;
      for (let e = 0; e < els.length; e++) {
        if (els[e].kind === "text" && els[e].text && String(els[e].text).trim().length > 1) inkBoxes++;
      }
    }
    A46(GEOM_INK.inkBoxesChecked === inkBoxes && GEOM_INK.slidesChecked === INK.length,
      `46a overrun swept ${GEOM_INK.inkBoxesChecked} boxes on ${GEOM_INK.slidesChecked} of ${INK.length} slides,`
      + ` the fixtures draw ${inkBoxes} worth measuring`);

    // (b) PARITY OF THE VERDICT. Green on every fixture before the move, green
    // on every fixture after it. Checks 1, 2 and 11 above already print this
    // one fault at a time; asserted here as a whole so that the migration has
    // a single line that says it held.
    const c = faultCounts(GEOM_ALL), ci = faultCounts(GEOM_INK);
    A46(c["off-canvas"] === 0 && c.overlap === 0 && ci.overrun === 0,
      `46b the fixture battery was green on all three before the move and is not after it:`
      + ` ${c["off-canvas"]} off-canvas, ${c.overlap} overlapping, ${ci.overrun} overrunning`);
  }

  {
    // (c) THE CORNER SAMPLING. A line-chart segment is a sheared rectangle, so
    // size x scale at the translate is not its bounding box. This element's
    // axis-aligned box is comfortably on the page and its top-right corner is
    // 30pt off it.
    const sheared = (shearX: number) => [{
      createShape: {
        objectId: "v_s0_seg", shapeType: "RECTANGLE",
        elementProperties: {
          size: { width: { magnitude: 200, unit: "PT" }, height: { magnitude: 100, unit: "PT" } },
          transform: { scaleX: 1, scaleY: 1, shearX, shearY: 0, translateX: 500, translateY: 100, unit: "PT" },
        },
      },
    }];
    const bent = offCanvasFaults(sheared(0.5), { layout: "line-chart" } as SlideInput, 0);
    const flat = offCanvasFaults(sheared(0), { layout: "line-chart" } as SlideInput, 0);
    A46(bent.faults.length === 1 && Math.round(bent.faults[0].overBy) === 30,
      `46c a sheared element whose corner is 30pt off the page was reported ${bent.faults.length} times`
      + `${bent.faults.length ? ` at ${bent.faults[0].overBy.toFixed(1)}pt` : ""} — size x scale is not a bounding box`);
    A46(flat.faults.length === 0, `46c the same element unsheared, wholly on the page, was reported off it`);
    A46(bent.elements === 1 && flat.elements === 1, `46c precondition: the synthetic element was not swept at all`);
  }

  {
    // (d) THE VERTICAL INSET, in both directions. Slides draws no glyph in the
    // 3.6pt above or below the text, and a table cell overhangs its row by
    // exactly that so that ten rows do not spend 72pt on padding. Two cells
    // whose insets touch are two boxes that touch and two texts that do not.
    const box = (y: number, h: number, text: string) =>
      ({ kind: "text" as const, x: 40, y, w: 300, h, text, size: 10 });
    const rows = { background: "#FFFFFF", elements: [box(100, 24, "Domain"), box(120.4, 24, "Sessions")] };
    const iy = SLIDES_TEXT_INSET.y;
    A46(120.4 < 100 + 24 && 120.4 + iy >= 100 + 24 - iy,
      `46d precondition: the fixture rows do not overhang each other by exactly one inset`);
    A46(overlapFaults(rows as any, { layout: "table" } as SlideInput, 0).faults.length === 0,
      `46d two table rows overhanging by one inset were reported as a collision`);
    const real = { background: "#FFFFFF", elements: [box(100, 24, "A title"), box(112, 24, "A body")] };
    A46(overlapFaults(real as any, { layout: "content" } as SlideInput, 0).faults.length === 1,
      `46d two boxes genuinely 12pt into each other were not reported`);
    // The millionth of a point. Six rows laid out by accumulating fractional
    // heights start 2.8e-14pt above where the row above ended.
    const hair = { background: "#FFFFFF", elements: [box(100, 24, "Row one"), box(124 - 2.8e-14, 24, "Row two")] };
    A46(overlapFaults(hair as any, { layout: "table" } as SlideInput, 0).faults.length === 0,
      `46d rows separated by 2.8e-14pt were reported as a collision`);
  }

  {
    // (e) INK, NOT BOXES — and the two skips. A 30pt box holding four lines of
    // 10pt text draws about 55pt of ink; whether that matters depends entirely
    // on what is beneath it.
    const runner = { kind: "text" as const, x: 40, y: 100, w: 200, h: 30, size: 10,
      text: "One line\nTwo lines\nThree lines\nFour lines and the ink runs well past the box" };
    const below = { kind: "text" as const, x: 40, y: 140, w: 200, h: 30, size: 10, text: "The box beneath it" };
    const beside = { kind: "text" as const, x: 260, y: 140, w: 200, h: 30, size: 10, text: "The box beside it" };
    A46(inkBottom(runner) > runner.y + runner.h,
      `46e precondition: the fixture's ink (${inkBottom(runner).toFixed(1)}pt) does not leave its box`);
    A46(overrunFaults({ background: "#FFFFFF", elements: [runner, below] } as any,
      { layout: "content" } as SlideInput, 0).faults.length === 1,
      `46e ink running ${(inkBottom(runner) - below.y).toFixed(1)}pt onto the box below was not reported`);
    A46(overrunFaults({ background: "#FFFFFF", elements: [runner, beside] } as any,
      { layout: "two-column" } as SlideInput, 0).faults.length === 0,
      `46e ink running past its box onto NOTHING — the column beside it — was reported`);
    // The quote mark: one glyph, whose line box is mostly the space a descender
    // would use. Measuring it as ink says it collides with everything below.
    const mark = { kind: "text" as const, x: 40, y: 100, w: 40, h: 8, size: 40, text: "“" };
    A46(overrunFaults({ background: "#FFFFFF", elements: [mark, below] } as any,
      { layout: "quote" } as SlideInput, 0).faults.length === 0,
      `46e a single-glyph ornament was measured as ink`);
  }

  {
    // (f) THE LIVE DEFECT, through the real builder, kept here deliberately.
    // A single hero stat reports the whole band as its height, so a `body`
    // beneath it is placed at about 414pt on a 405pt canvas. It is unfixed at
    // HEAD and out of scope for this stage on purpose: it is the proof that
    // this check measures decks rather than fixtures. If it ever stops being
    // reported, either somebody fixed the stat layout — in which case delete
    // this and say so in the commit — or the assertion has gone to sleep.
    const hero: SlideInput[] = [{
      layout: "stat", title: "One number that earns the slide",
      stats: [{ value: "64 GW", label: "Installed capacity" }],
      body: "A paragraph beneath the figure, which this layout places below the bottom of the page.",
    }];
    const g = validateDeck(hero, "t46f");
    const off = g.faults.filter((f) => f.kind === "off-canvas");
    A46(g.slidesChecked === 1 && g.elementsChecked > 3,
      `46f precondition: the hero-stat fixture swept ${g.elementsChecked} elements`);
    A46(off.length === 1 && off[0].where.indexOf("_body") >= 0 && off[0].overBy > 5,
      `46f a hero stat's body is drawn below the canvas and the off-canvas check reported`
      + ` ${off.length} faults${off.length ? ` (${off[0].where}, ${off[0].overBy.toFixed(1)}pt)` : ""}`);
    A46(geometryNotes(g).length > 0 && geometryNotes(g)[0].indexOf("past the edge") >= 0,
      `46f the fault does not reach the model as a sentence: ${JSON.stringify(geometryNotes(g)[0] || "")}`);
    // BOTH KINDS, ON THE ONE SLIDE THAT HAS BOTH. This slide draws its body off
    // the canvas AND through the footer, which are two different things to fix
    // in two different places. Grouping the notes by slide alone rather than by
    // slide and kind drops whichever sorts second — a collision, every time,
    // because only the off-canvas and overrun faults carry a distance to sort
    // on — and the deck would then report a box off the page while saying
    // nothing about the text drawn through the footer beneath it.
    const heroNotes = geometryNotes(g);
    let saysOff = false, saysOverlap = false;
    for (let i = 0; i < heroNotes.length; i++) {
      if (heroNotes[i].indexOf("past the edge") >= 0) saysOff = true;
      if (heroNotes[i].indexOf("overlap") >= 0) saysOverlap = true;
    }
    // THREE, not two, since the deck frame landed. The third is the same
    // off-canvas body box: it runs down to y=414 on a 405pt page, so it also
    // crosses the folio's box on the footer line, where their ink does not
    // meet. That is the only place in the 618 stored slides where the frame
    // meets a pre-existing fault, and it is a box overlap on a slide that is
    // already reported broken rather than a new fault on a sound one — which
    // is why the count moved by exactly one and relayableFaults did not.
    A46(g.faults.length === 3 && saysOff && saysOverlap,
      `46f the slide carries ${g.faults.length} faults of two kinds and relays ${heroNotes.length}:`
      + ` ${JSON.stringify(heroNotes)}`);

    // (g) WARNING-ONLY, and the seam driven end to end. The severity is a
    // parameter with the constant as its default, so this asserts the seam
    // WORKS rather than that it exists — a line proving a rule was written has
    // reported a live hole in this repo as closed.
    A46(GEOMETRY_SEVERITY === "advisory", `46g the escalation seam ships set to "${GEOMETRY_SEVERITY}"`);
    A46(geometryRefusal(g) === null,
      `46g a deck with ${g.faults.length} faults is refused today; nothing this validator finds may block a build yet`);
    const wouldSay = geometryRefusal(g, "refuse");
    A46(!!wouldSay && wouldSay.indexOf("past the edge") >= 0,
      `46g flipping the seam does not produce a refusal naming the fault`);
    A46(buildSlideRequests(hero[0], 0, "t46g").length > 0,
      `46g the faulty slide no longer builds — the validator has become a gate`);

    // (h) AND THE NOTES ACTUALLY REACH THE MODEL. deckWarnings is the channel,
    // already threaded into the tool result on all four chains; a fault
    // measured and then dropped on the floor is the same as no fault at all.
    const relayed = deckWarnings(hero, geometryNotes(g));
    A46(relayed.indexOf("past the edge") >= 0, `46h deckWarnings does not relay the geometry notes it is given`);
    A46(deckWarnings(hero).indexOf("past the edge") < 0,
      `46h deckWarnings measures geometry on its own — it must be given the notes, or generate.ts and validate.ts`
      + ` import each other`);
    // Four chains, four calls. A fifth chain added without this line would
    // build decks nothing measures, and nothing else in this file would notice.
    const provSrc = readFileSync(join(__dirname, "..", "lib/ai/providers.ts"), "utf8")
      .replace(/^[ \t]*\/\*[\s\S]*?\*\//gm, "").replace(/(^|[ \t])\/\/[^\n]*/gm, "$1");
    const wired = provSrc.split("deckWarnings(draft.slides, geometryNotes(built.geometry))").length - 1;
    const built = provSrc.split("buildSlidesDraft(").length - 1;
    A46(wired === 4 && built === 5,
      `46h ${wired} of the chains pass the geometry notes to deckWarnings across ${built - 1} draft builds`);
    A46(provSrc.indexOf("geometryRefusal(geometry)") >= 0 && provSrc.indexOf("validateDeck(slides, \"draft\")") >= 0,
      `46h the build path does not run the validator before the preview is built`);
    // AND THE RATE. The escalation decision documented in validate.ts needs a
    // week of this line and nothing else; without it the seam would be flipped
    // on somebody's impression of how often decks are wrong. Asserted twice —
    // that the call is there, and that the line it writes carries the numbers —
    // because a call left in place and emptied out reports exactly as much as
    // no call at all.
    A46(provSrc.indexOf("logDeckGeometry(geometry, \"draft\")") >= 0,
      `46h the build path does not log the geometry rate, so nothing measures how often this fires`);
    // AND THE CALL SITE IS GUARDED. This one is a source assertion and says so:
    // buildSlidesDraft is module-private and reaches the image resolver, so it
    // cannot be driven from here the way validateDeck is in 46m. What it pins
    // is that the three calls sit inside a try — because a validator that
    // throws on the build path is the validator blocking the build, which is
    // the single thing this stage promises cannot happen.
    const at = provSrc.indexOf("geometry = validateDeck(slides, \"draft\")");
    const window = at < 0 ? "" : provSrc.slice(Math.max(0, at - 120), at + 420);
    A46(at >= 0 && window.indexOf("try {") >= 0 && window.indexOf("} catch") >= 0,
      `46h the validator runs unguarded on the build path — a throw inside it would take the deck with it`);
    const logged: string[] = [];
    const realLog = console.log;
    console.log = ((...a: any[]) => { logged.push(a.join(" ")); }) as any;
    try { logDeckGeometry(g, "draft"); } finally { console.log = realLog; }
    A46(logged.length === 1 && logged[0].indexOf("[SlideGeometry] draft:") >= 0
      && logged[0].indexOf("3 faults") >= 0 && logged[0].indexOf("off-canvas 1") >= 0
      && logged[0].indexOf("worth reporting") >= 0 && logged[0].indexOf(GEOMETRY_SEVERITY) >= 0,
      `46h the rate line does not carry the counts and the severity: ${JSON.stringify(logged)}`);
  }

  {
    // (i) MEASURED IN THE FACE THE BOX IS DRAWN IN. faceAdvance falls back to
    // an unnamed 0.55em worst case whose own comment records what it costs:
    // Roboto over-measured by nearly a third, a bullet that draws on one line
    // counted as two. Every box on a real deck names a face — Roboto 82%,
    // Playfair 16%, Poppins 2% of 6,694 stored preview boxes — so the fallback
    // fitted none of them, and 21 of the 29 overruns this reported on the
    // stored decks were measured with a ruler nothing is drawn with.
    //
    // Both directions, on one box: 19 characters at 8pt in a 95pt column draw
    // on ONE line in Roboto and are counted as TWO without the face.
    const TIGHT = "Org + Report schema";
    A46(estimateLines(TIGHT, 95, 8) === 2 && estimateLines(TIGHT, 95, 8, false, false, "Roboto") === 1,
      `46i precondition: the two rulers agree on this fixture (${estimateLines(TIGHT, 95, 8)} lines unnamed,`
      + ` ${estimateLines(TIGHT, 95, 8, false, false, "Roboto")} in Roboto), so it pins nothing`);
    const caption = { kind: "text" as const, x: 40, y: 100, w: 95, h: 18, size: 8, text: TIGHT };
    const under = { kind: "text" as const, x: 40, y: 120, w: 95, h: 18, size: 8, text: "The caption below it" };
    const page = (el: any) => ({ background: "#FFFFFF", elements: [el, under] });
    A46(overrunFaults(page({ ...caption, font: "Roboto" }) as any, { layout: "matrix" } as SlideInput, 0).faults.length === 0,
      `46i a Roboto caption that draws on one line was reported as running onto the caption below it`);
    A46(overrunFaults(page(caption) as any, { layout: "matrix" } as SlideInput, 0).faults.length === 1,
      `46i the same caption measured with no face was NOT reported — the fixture no longer pins the face`);
  }

  {
    // (j) THE LINE BOX ITSELF. INK_LEAD is the larger of the two levers in this
    // measurement and the fixtures pinned neither: loosening it from 1.38 to
    // 1.2 left every layout green while halving what the validator reports on
    // real decks. This fixture straddles the two — four 10pt lines land 3.8pt
    // into the box below at 1.38 and 3.4pt clear of it at 1.2 — so the lead is
    // pinned from both sides rather than by a constant nobody drives.
    const four = { kind: "text" as const, x: 40, y: 100, w: 200, h: 30, size: 10,
      text: "One line\nTwo lines\nThree lines\nFour lines" };
    const beneath = { kind: "text" as const, x: 40, y: 155, w: 200, h: 30, size: 10, text: "The box beneath it" };
    const lands = inkBottom(four) - beneath.y;
    A46(overrunFaults({ background: "#FFFFFF", elements: [four, beneath] } as any,
      { layout: "content" } as SlideInput, 0).faults.length === 1,
      `46j four lines of ink landing on the box below were not reported — the line box has been loosened`);
    A46(lands > 0 && lands < 4 * 10 * 0.18,
      `46j the fixture no longer straddles the line box (${lands.toFixed(1)}pt into the box below), so it pins`
      + ` neither a looser lead nor a tighter one`);
  }

  {
    // (k) THE BOXES OVERLAP AND THE GLYPHS DO NOT, which on real decks is most
    // of what this reports: 110 of 130 stored pairs, and on fourteen decks it
    // is every pair they have. The photo credit is a 432pt box drawn END-
    // aligned and the footer a 671pt box drawn START-aligned on the same line,
    // so they intersect across 375pt in which neither draws a glyph.
    //
    // The ASSERTION is unchanged and still reports the pair — that is the
    // migration, and a latent collision that only holds while both strings stay
    // short is worth a check failing on. What changes is whether it is worth a
    // SENTENCE to somebody who cannot see it.
    const asDeck = (faults: any[]): DeckGeometry => ({
      faults, slidesChecked: 1, elementsChecked: 0, textBoxesChecked: 2, inkBoxesChecked: 2, unbuildable: 0, ms: 0,
    });
    const credit = (align: "start" | "end") => ({
      kind: "text" as const, x: 24.5, y: 382, w: 432, h: 12, size: 7, font: "Roboto",
      align, text: "Photo: Vitaly Gariev / Unsplash",
    });
    const footer = { kind: "text" as const, x: 24.5, y: 381, w: 671, h: 12, size: 8, font: "Roboto",
      align: "start" as const, text: "The Content Engine" };
    const apartPage = { background: "#FFFFFF", elements: [credit("end"), footer] };
    const apart = overlapFaults(apartPage as any, { layout: "content" } as SlideInput, 0).faults;
    A46(apart.length === 1, `46k precondition: the credit and the footer do not overlap as BOXES, so this pins nothing`);
    A46(apart.length === 1 && apart[0].inkMeets === false,
      `46k a credit 375pt clear of the footer is reported as text drawn on top of it`);
    A46(relayableFaults(asDeck(apart)).length === 0 && geometryNotes(asDeck(apart)).length === 0,
      `46k that pair reaches the model as a sentence about a slide with no overlapping text on it`);
    A46(apart.length === 1 && apart[0].note.indexOf("does not meet") >= 0,
      `46k the fault does not say what was actually measured: ${JSON.stringify(apart.length ? apart[0].note : "")}`);
    // The other direction: the same two boxes, both drawn from the left, whose
    // glyphs really are on top of each other.
    const meetPage = { background: "#FFFFFF", elements: [credit("start"), footer] };
    const meet = overlapFaults(meetPage as any, { layout: "content" } as SlideInput, 0).faults;
    A46(meet.length === 1 && meet[0].inkMeets === true,
      `46k two boxes whose text really is drawn over the same space were excused by the ink gate`);
    A46(relayableFaults(asDeck(meet)).length === 1 && geometryNotes(asDeck(meet)).length === 1
      && geometryNotes(asDeck(meet))[0].indexOf("both draw text where they meet") >= 0,
      `46k a real collision does not reach the model: ${JSON.stringify(geometryNotes(asDeck(meet)))}`);
  }

  {
    // (l) WHAT THE USER IS ACTUALLY TOLD. A deck whose layout has gone wrong
    // produces the same fault on every slide, and forty sentences of it is how
    // a warning stops being read — so the notes are capped and the tail is
    // counted rather than dropped. Both halves are driven here: the cap can be
    // turned down to one and the tail deleted without a single layout noticing.
    const many: any[] = [];
    for (let i = 0; i < 8; i++) {
      many.push({ kind: "off-canvas", slide: i + 1, layout: "content", where: `w${i}`, overBy: 20 - i,
        note: `slide ${i + 1}: something is ${20 - i}pt past the edge of the slide` });
    }
    const big: DeckGeometry = { faults: many, slidesChecked: 8, elementsChecked: 80, textBoxesChecked: 40,
      inkBoxesChecked: 40, unbuildable: 0, ms: 1 };
    const notes = geometryNotes(big);
    A46(notes.length === 6, `46l eight faults on eight slides produced ${notes.length} notes, not five and a tail`);
    A46(notes.length > 1 && notes[0].indexOf("slide 1:") === 0,
      `46l the notes are not worst-first: ${JSON.stringify(notes[0] || "")}`);
    A46(notes.length > 0 && notes[notes.length - 1].indexOf("and 3 more") === 0,
      `46l the tail does not count what it is not saying: ${JSON.stringify(notes[notes.length - 1] || "")}`);
  }

  {
    // (m) A SLIDE THAT CANNOT BE MEASURED IS COUNTED, and costs only itself.
    // The count exists because a validator that silently measures nothing is
    // the failure this repo has already paid for; a count nothing drives is the
    // same failure one level up. `stats` as a string is a payload the builder
    // rejects outright.
    const mixed: SlideInput[] = [
      { layout: "stat", title: "One number that earns the slide",
        stats: [{ value: "64 GW", label: "Installed capacity" }],
        body: "A paragraph beneath the figure, which this layout places below the bottom of the page." },
      { layout: "stat", title: "A payload the builder rejects", stats: "12%" } as any,
      { layout: "content", title: "A slide after it", body: "Measured all the same." },
    ];
    // Caught rather than allowed to propagate, because the failure being
    // driven here is precisely a throw: without the guard inside validateDeck
    // this line ends the whole script with a stack trace instead of a FAIL.
    let g: DeckGeometry = { faults: [], slidesChecked: -1, elementsChecked: 0, textBoxesChecked: 0,
      inkBoxesChecked: 0, unbuildable: -1, ms: 0 };
    let blewUp = "";
    try { g = validateDeck(mixed, "t46m"); } catch (e) { blewUp = e instanceof Error ? e.message : String(e); }
    A46(blewUp === "",
      `46m one unbuildable slide threw out of the validator and would have taken the deck with it: ${blewUp}`);
    A46(g.unbuildable === 1 && g.slidesChecked === 2,
      `46m a deck with one unbuildable slide measured ${g.slidesChecked} of 2 and counted ${g.unbuildable} unbuildable`);
    A46(g.faults.length > 0, `46m the slides either side of it were not measured`);
    // And an element the sweep cannot measure is skipped rather than thrown on.
    // Nothing the builder emits today looks like this; the layouts in stages 2
    // to 5 are where it stops being true.
    let threw = "";
    try {
      offCanvasFaults([{ createShape: { objectId: "v_s0_x", elementProperties: { transform: { translateX: 0, translateY: 0 } } } }],
        { layout: "content" } as SlideInput, 0);
    } catch (e) { threw = e instanceof Error ? e.message : String(e); }
    A46(threw === "", `46m an element with no size threw out of the sweep and would have taken the build with it: ${threw}`);
  }

  {
    // (n) THE GLYPH TABLE FOR BOLD ROBOTO, which the mean under-measures now
    // that the mean is the RIGHT mean. This branch used to be pinned by the
    // fixtures — deleting it turned fourteen of them red — but that was against
    // the unnamed 0.55em default, which over-measured everything; against
    // Roboto's own 0.443 the battery no longer noticed, while four real
    // overruns in the stored decks are still found only here. A branch nothing
    // drives is a branch the next person deletes, so this fixture drives it:
    // twenty characters of bold Roboto in a 110pt box measure ONE line at the
    // mean and TWO glyph by glyph, and the second one lands on the box below.
    const label = { kind: "text" as const, x: 40, y: 100, w: 110, h: 18, size: 10,
      font: "Roboto", weight: 700, text: "MS Teams Integration" };
    const under = { kind: "text" as const, x: 40, y: 125, w: 110, h: 18, size: 10,
      font: "Roboto", weight: 400, text: "The node beneath it" };
    const regular = { ...label, weight: 400 };
    A46(estimateLines(label.text, label.w, label.size, false, false, "Roboto") === 1,
      `46n precondition: the mean already counts this label as more than one line, so it pins nothing`);
    A46(overrunFaults({ background: "#FFFFFF", elements: [label, under] } as any,
      { layout: "hub" } as SlideInput, 0).faults.length === 1,
      `46n a bold label that wraps in the face it is drawn in was measured at the mixed-case mean and missed`);
    A46(overrunFaults({ background: "#FFFFFF", elements: [regular, under] } as any,
      { layout: "hub" } as SlideInput, 0).faults.length === 0,
      `46n the same words at regular weight, which really do fit one line, were reported as running over`);
  }

  if (failures === before46) {
    pass(`the three assertions moved whole, measure ${GEOM_ALL.elementsChecked} elements and ${GEOM_ALL.textBoxesChecked}`
      + ` boxes identically through both routes, catch a live off-canvas defect, and warn rather than block`);
  }

  /* 47. THE DECK FRAME, THE DENSITY PRESET AND THE THREE PRIMITIVES.
   *
   * Stage 2 of docs/PLAN-slides-creative-2026-09.md. What makes this section
   * worth its length is that most of what it asserts is invisible to every
   * other check in this file AND to lib/slides/validate.ts:
   *
   *  - A FRAME RULE IS A RECT, so the overlap sweep never compares it with
   *    anything: it compares text with text. A hairline drawn straight through
   *    a title would be reported by nothing at all. (d) measures the ink.
   *  - A PRESET IS A LOOKUP, so a wrong number in it is not a wrong line of
   *    code. (a) states the two constraints the rhythm was solved on, as
   *    arithmetic over the repo's own drawnTextHeight, rather than restating
   *    158.40 in a second place where it can agree with itself and be wrong.
   *  - THE SECOND PRESET HAS NO PRODUCTION CALLER YET, which is exactly the
   *    condition under which a thing rots. (i) builds all 29 layouts at it.
   *  - A BAND THAT LOSES A FIFTH OF ITS HEIGHT breaks the blocks that were
   *    measured in absolute points against the old one, and it breaks them at
   *    the CAP rather than in the middle. (j) drives the two that were found
   *    that way, at the cap, at both presets.
   *
   * THE FIXTURE IS PART OF THE ASSERTION, and that is the lesson this section
   * cost. Its first version wrote seven of the twenty-nine layouts in payload
   * shapes SlideInput does not declare, so those slides drew nothing but the
   * shared chrome and every sweep over them measured a blank page — while the
   * bottom rule was, on live decks, drawn along the baseline of the chart
   * source credit the fixture had no way to produce. Every sweep below now
   * asserts that the slide it is about to measure drew its own LAYOUT first.
   *
   * And the regression bar for the whole stage is in (b): read is the default,
   * every deck ever built is a read deck, and the 618 stored slides are how it
   * is proved. What the corpus cannot be asked in a script with no network is
   * asserted here on the same numbers the corpus run measured.
   *
   * MUTATION LOG (detached worktree, 2026-09-17). Two rounds. The first is
   * Stage 2's own, twenty-one mutations with twenty killed; the second is this
   * one, after review found that three of those assertions were passing over a
   * live defect. Every entry from the first round was re-run against the
   * rewritten checks and all seven that touch them still die; they are kept
   * below because the reasons are still the reasons.
   *
   * ROUND TWO — the review, and the three entries that matter most are the
   * ones where a GREEN CHECK WAS THE BUG.
   *  - KILLED (47d): frameRequests stops measuring the page before it draws a
   *    rule (bandIsClear made unconditionally true). Eleven boxes struck across
   *    the two presets, including both charts' source lines and `feature`'s
   *    body. THIS IS THE DEFECT THAT SHIPPED: at the default density the bottom
   *    rule was drawn along the baseline of the chart source credit on ten of
   *    the 618 stored slides in nine of thirty-seven decks, all real client
   *    work, and the check written to prevent exactly that passed — because it
   *    asserted the rule's BAND was empty and drove the claim with a fixture
   *    that drew no chart.
   *  - KILLED (47d, the same defect from the other end): textBox stops writing
   *    to the ink ledger, so the frame has nothing to measure.
   *  - KILLED (47d): the fixture reverted to the payload shapes the builder
   *    does not read — `chart.categories`/`series[].values`, `venn.sets[].name`.
   *    Four layouts immediately report drawing nothing but the shared chrome.
   *    The previous fixture wrote seven layouts that way and nothing noticed,
   *    which is the "check that silently tests NOTHING" this repo already has
   *    a memory note about.
   *  - KILLED (47d): hairlineInk ignores the ground, so every rule on a dark
   *    slide is #707070 on navy at 2.69:1. The TOKEN assertion below always
   *    caught a wrong token; nothing caught the token being right and the
   *    drawing not using it until the ink was read off the emitted requests.
   *  - KILLED (47d): the folio loses its dark-ground ink — brand blue on navy
   *    at 2.39:1, and on a section divider blue on blue at 1.00:1, on 95 of the
   *    618 stored slides. Same asymmetry, same fix.
   *  - KILLED (47d): the section divider given its hairlines back. Its ground
   *    is brand blue, where the dark-ground rule reads 2.06:1 — and no alpha
   *    fixes it, because fully opaque the same grey is 4.68:1 on blue. Found by
   *    the ink read-back on its first run, not by reasoning.
   *  - KILLED (47d): only the TOP rule stops measuring. Reached by a
   *    90-character eyebrow, which wraps onto `present`'s top rule.
   *  - KILLED (47j): the layers ladder loses its terminal band drop. Five bands
   *    of cells then run 22pt off the bottom of the page at `present`, taking
   *    the "omitted to fit" line with them — the admission that content was
   *    lost is itself the content that cannot be read.
   *  - KILLED (47j): the layers admission stops naming the bands it dropped.
   *    Asserted on the string, because a note-free build passes every geometric
   *    check there is.
   *  - KILLED (47j, ON THE SECOND ATTEMPT): the cards strip stops being bounded
   *    by the band. The first fixture used a two-line standfirst and the
   *    mutation SURVIVED: the strip only leaves the page once cardsH's 80pt
   *    floor wins, and the floor only wins once the card row starts low enough,
   *    which at `present` takes three lines of 14pt standfirst. A capacity
   *    cliff needs a fixture that reaches the cliff.
   *  - KILLED (check 46, not 47): INK_LEAD loosened from 1.38 to 1.2, re-run
   *    because the ink measurement MOVED into generate.ts so that the builder
   *    and the validator cannot own two rulers. Check 46's own coverage of it
   *    is intact.
   *  - SURVIVED (47d): the ink ledger's `caps` flag falsified. Provably
   *    unreachable rather than untested: every caps style in TYPE that can
   *    appear on a framed page is BOLD, and the bold branch measures the
   *    already-upper-cased string glyph by glyph, so the flag decides nothing.
   *    The only two non-bold caps styles are the cover and closing kickers, and
   *    neither of those pages carries a frame. The flag stays as the correct
   *    input for the day that changes.
   *
   * ROUND ONE — Stage 2's own, all re-verified against the rewritten checks.
   *  - KILLED (47d): read given a top hairline at the lockup's edge. Read's
   *    title box reaches y=45.60, above the rule. Now caught by the assertion
   *    that read has no top rule at all rather than by the ink sweep — with the
   *    rules yielding, a rule that would strike a title is simply not drawn,
   *    which is the fix working rather than the check weakening.
   *  - KILLED (checks 1 and 2, not 47): footerLineWidth made the identity, so
   *    the folio is laid over the running head and the photo credit. 137
   *    failures; 46 new box overlaps on the 618 stored slides.
   *  - KILLED (47b): read given the rung set [20, 18, 16, 14], which reads like
   *    "today's behaviour written down" and is not — 48 of 499 stored titles
   *    land on 19, 17 or 15.
   *  - KILLED (47a): present's bodyY set to 151.80 and to 160.80, the two
   *    values either side of the solve. One loses the twelve-line band, the
   *    other loses the two-line title, and the assertions name which.
   *  - KILLED (47c, ON THE SECOND ATTEMPT): fitHeading's rung branch deleted.
   *    The first version asserted on ONE title, and chose one so long it hit
   *    the FLOOR — where the rung ladder and the one-point step agree — so the
   *    mutation survived. A sweep across title lengths lands on 29, 28 and 27.
   *    A ladder assertion has to sample the ladder, not one rung of it.
   *  - KILLED (47f): the preview reading any page-properties request as its
   *    ground. hex() of an absent rgbColor is #000000, so every light slide in
   *    the chat preview and the PDF goes black while the deck itself is fine.
   *  - KILLED (47f): the paper sheet laid under every ground, including navy.
   *  - KILLED (47h and 47i): onBand stopped scaling. The image grid's first row
   *    is then drawn 13.2pt over the foot of the title box at present and
   *    STAGE 1'S VALIDATOR REPORTS NOTHING, because those cells are createImage.
   *  - KILLED (47e, and check 20g): the folio stamped as a constant rather than
   *    counted from the builder's index — which is the exact defect that had
   *    the page number removed in the first place.
   *  - KILLED (47g): the hung dot's offset zeroed, so it is drawn on the glyph
   *    it marks instead of hanging into the gutter.
   *  - KILLED (47g, ON THE SECOND ATTEMPT): the pill's label changed to the
   *    source deck's #FFD966. The first version computed textOn(PILL.fill)
   *    here and compared THAT — asserting the rule was written, not that the
   *    pill uses it — and stayed green. It now reads the ink off the emitted
   *    box. This is the repo's own recorded failure mode and it reappeared in
   *    new code within the hour.
   *  - KILLED (47c2, ON THE SECOND ATTEMPT): the shared title call reverted to
   *    its own ceiling and TITLE_MIN_SIZE. fitHeading anchors the BOTTOM of the
   *    block, so a title that fits does not move when the ceiling changes — the
   *    short fixture saw nothing. It takes a title long enough to fill the
   *    block, and then the floor shows up as an 18pt title over a 14pt
   *    standfirst.
   *  - KILLED (47c2): withDensity's finally removed, and separately the whole
   *    withDensity wrapper removed from buildSlideRequests. The first leaks the
   *    preset into every deck built after a throw; the second means the preset
   *    is never applied at all.
   *  - KILLED (47a, 47c2, 47i and check 46): present's body size, its title
   *    colour and the frame itself removed.
   *  - SURVIVED (47b): onBand's read identity short-circuit deleted. It is
   *    PROVABLY undetectable: searched over 400,000 probes across the band
   *    there is no y for which bodyY + (y − bodyY) differs from y, and there
   *    cannot be — y and bodyY are within a factor of two, so the subtraction
   *    is exact and the addition recovers it. The branch is kept as the
   *    statement of the guarantee the regression proof rests on, not as a fix
   *    for a float that was ever observed to move; its header says so.
   */
  const before47 = failures;
  console.log(`\n47. The deck frame, the density preset, and the three primitives`);
  const A47 = (ok: boolean, m: string) => { if (!ok) fail(m); };
  {
    const lum = (hex: string) => {
      const h = hex.replace("#", "");
      const f = (c: number) => (c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4));
      const v = [0, 2, 4].map((i) => f(parseInt(h.substr(i, 2), 16) / 255));
      return 0.2126 * v[0] + 0.7152 * v[1] + 0.0722 * v[2];
    };
    const ratio = (a: string, b: string) => {
      const x = lum(a), y = lum(b);
      return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05);
    };
    const R = DENSITY.read, P = DENSITY.present;

    // (a) THE RHYTHM IS A SOLVE, AND THIS IS THE SOLVE RATHER THAN THE ANSWER.
    //
    // 158.40 is not a taste. It is the only bodyY that satisfies both of the
    // constraints below at once, and they pull in opposite directions: the
    // title wants it LOW and the body wants it HIGH. Asserting the number
    // would pin a copy of it; asserting the constraints fails the day either
    // end of the scale moves and the number stops being the answer.
    //
    // Measured with the builder's own drawnTextHeight, not a second estimator.
    A47(Math.abs(P.bandHeight - drawnTextHeight(12, P.type.body)) < 1e-9,
      `47a the present band is ${P.bandHeight.toFixed(2)}pt, which is not twelve lines of ${P.type.body}pt body` +
      ` (${drawnTextHeight(12, P.type.body).toFixed(2)}pt) — bodyY has been moved without re-solving it`);
    const presentRoom = P.bodyY - 12 - P.titleMinTop;      // TITLE_GAP is 12
    const twoLines = drawnTextHeight(2, P.type.slideTitle);
    A47(presentRoom >= twoLines,
      `47a a two-line ${P.type.slideTitle}pt title needs ${twoLines.toFixed(2)}pt and the present title block has` +
      ` ${presentRoom.toFixed(2)}pt — 56% of real titles wrap at this size, so the ladder would demote the majority case`);
    // And the cushion is deliberate: at exactly equal the comparison is a
    // floating-point equality, and the corpus run that discovered this watched
    // two-line titles at 30pt fall from 430 to 205 on the same 472 titles.
    A47(presentRoom > twoLines,
      `47a the present title block is EXACTLY two lines with no cushion, which is a float equality the ladder loses`);
    A47(Math.abs(P.titleHeight - drawnTextHeight(1, P.type.slideTitle)) < 1e-9,
      `47a present.titleHeight ${P.titleHeight} is not drawnTextHeight(1, ${P.type.slideTitle}) =` +
      ` ${drawnTextHeight(1, P.type.slideTitle).toFixed(2)}`);
    // The band's FLOOR is pinned by the takeaway bar and the footer, so every
    // point bodyY gains comes out of the band one for one. A preset that moved
    // the floor would be a preset that draws over the footer.
    A47(R.bodyY + R.bandHeight === P.bodyY + P.bandHeight && R.bodyY + R.bandHeight === BAND_BOTTOM,
      `47a the two presets do not share a band floor: read ends at ${(R.bodyY + R.bandHeight).toFixed(2)},` +
      ` present at ${(P.bodyY + P.bandHeight).toFixed(2)}, BAND_BOTTOM is ${BAND_BOTTOM.toFixed(2)}`);
    A47(P.bodyY > R.bodyY && P.bandHeight < R.bandHeight,
      `47a the present preset does not actually cost the band anything, which means it is not the denser one`);

    // (b) READ IS THE DEFAULT, AND UNCHANGED.
    //
    // The floats, not values that round to them: these numbers reach the
    // emitted request, and the whole regression proof for this stage is that
    // 618 stored slides rebuild to the same stream.
    A47(DEFAULT_DENSITY === "read", `47b the default density is ${DEFAULT_DENSITY}, and every stored deck is a read deck`);
    A47(densityOf(undefined) === "read" && densityOf({} as SlideInput) === "read"
      && densityOf({ density: "nonsense" } as any) === "read",
      `47b a slide with no density, or one this build does not know, is not built at read`);
    withDensity("read", () => {
      A47(GRID.bodyY === 1.44 * 72 && GRID.bandHeight === 3.76 * 72 && GRID.titleHeight === 0.63 * 72,
        `47b read's rhythm moved: bodyY ${GRID.bodyY}, band ${GRID.bandHeight}, titleHeight ${GRID.titleHeight}`);
      A47(TYPE.body.size === 10 && TYPE.standfirst.size === 11.5 && TYPE.slideTitle.size === 20
        && TYPE.slideTitle.color === COLOR.navy,
        `47b read's type moved: body ${TYPE.body.size}, standfirst ${TYPE.standfirst.size},` +
        ` title ${TYPE.slideTitle.size}/${TYPE.slideTitle.color}`);
      // The four blocks that fix their geometry in absolute points are the
      // IDENTITY at read, not merely close to it — see onBand's header.
      A47(TIMELINE.dateY === 2.25 * 72 && TIMELINE.detailY === 3.52 * 72 && TIMELINE.detailHeight === 0.95 * 72
        && TIMELINE_PARALLEL.bandY === 2.46 * 72 && IMAGE.gridY === 1.85 * 72 && LOGO_WALL.y === 1.9 * 72,
        `47b a block that scales onto the band no longer returns read's own float at read`);
    });
    // READ'S LADDER STEPS BY ONE POINT, and must keep doing so. Rungs of
    // [20, 18, 16, 14] would read as "today's behaviour written down" and are
    // not: driven over the 499 stored titles that reach the shared title
    // block, 48 of them land on 19, 17 or 15. This drives the seam directly.
    A47(R.titleRungs === undefined,
      `47b read has been given a rung set, which moves 48 of 499 stored titles onto a different size`);
    withDensity("read", () => {
      const odd = fitHeading("A title that is long enough to need exactly one step down here", TYPE.slideTitle,
        GRID.proseWidth, { bottom: GRID.bodyY - 12, minTop: R.titleMinTop, minHeight: GRID.titleHeight });
      A47(odd.style.size % 2 === 1 || odd.style.size === 20,
        `47b precondition: this title lands on ${odd.style.size}pt, an even size, so it pins nothing about the step`);
    });

    // (c) THE LADDER AT PRESENT: four visible sizes, and a floor above the
    // standfirst.
    //
    // The floor is the assertion that matters. TITLE_MIN_SIZE is 14, which at
    // this preset IS the standfirst — so a title that stepped to the default
    // floor would be drawn SMALLER than the line beneath it, and nothing
    // anywhere would say so. Forty-one of 472 titles did exactly that in the
    // measurement that produced this preset.
    const rungs = P.titleRungs || [];
    A47(rungs.length >= 2, `47c the present preset has no rung set`);
    A47(rungs[0] === P.type.slideTitle,
      `47c the ladder starts at ${rungs[0]}pt but the title token is ${P.type.slideTitle}pt`);
    A47(rungs[rungs.length - 1] === P.titleMinSize,
      `47c the last rung is ${rungs[rungs.length - 1]} but the floor is ${P.titleMinSize}`);
    let descending = true;
    for (let i = 1; i < rungs.length; i++) if (rungs[i] >= rungs[i - 1]) descending = false;
    A47(descending, `47c the rungs are not strictly descending: ${rungs.join(", ")}`);
    A47(P.titleMinSize > P.type.standfirst,
      `47c a present title may shrink to ${P.titleMinSize}pt, which is not above its own ${P.type.standfirst}pt standfirst`);
    A47(P.titleMinSize >= DENSITY.read.type.slideTitle,
      `47c present's worst title (${P.titleMinSize}pt) is smaller than read's best (${DENSITY.read.type.slideTitle}pt)`);
    // Every rung has to FIT, or it is a rung the ladder steps onto and still
    // overruns from.
    withDensity("present", () => {
      const room = Math.max(GRID.titleHeight, GRID.bodyY - 12 - P.titleMinTop);
      for (let i = 0; i < rungs.length; i++) {
        A47(drawnTextHeight(1, rungs[i]) <= room,
          `47c rung ${rungs[i]}pt needs ${drawnTextHeight(1, rungs[i]).toFixed(2)}pt on one line and the block has ${room.toFixed(2)}`);
      }
      // AND THE LADDER ACTUALLY STOPS ON THEM. Swept across title lengths
      // rather than asserted on one, because one title is not enough: the
      // first version of this used a title so long it hit the FLOOR, where the
      // rung ladder and the one-point step agree, and deleting the rungs
      // branch in fitHeading left it green. A sweep lands on every rung and on
      // the sizes between them, and 29, 28 and 27 are not rungs.
      const seen: Record<number, number> = {};
      for (let n = 24; n <= 170; n += 2) {
        const t = "Where the programme goes next and what it costs to run it now ".repeat(4).slice(0, n);
        const h = fitHeading(t, TYPE.slideTitle, GRID.proseNarrow,
          { bottom: GRID.bodyY - 12, minTop: P.titleMinTop, minHeight: GRID.titleHeight,
            minSize: P.titleMinSize, rungs: P.titleRungs });
        seen[h.style.size] = (seen[h.style.size] || 0) + 1;
      }
      const landed = Object.keys(seen).map(Number).sort((a, b) => b - a);
      A47(landed.length >= 3,
        `47c precondition: the sweep only ever reached ${landed.join("/")}pt, so it pins nothing about the rungs`);
      for (let i = 0; i < landed.length; i++) {
        A47(rungs.indexOf(landed[i]) >= 0,
          `47c a title landed on ${landed[i]}pt, which is not one of the rungs (${rungs.join(", ")})` +
          ` — the ladder is stepping a point at a time, which is eleven sizes nobody can tell apart`);
      }
    });

    // (c2) AND THE PRESET'S TYPE REACHES THE PAGE.
    //
    // Read back off the emitted boxes, not off the token: a preset is a lookup
    // table, and a lookup table nothing looks up is a table that can hold any
    // value at all and never be wrong. Six of the seven tokens are driven here.
    // The seventh, `caption`, has no reader anywhere in the builder — the
    // caption-shaped tokens in use are gridCaption, stageCaption and source —
    // so it is carried in the preset for completeness and asserted absent
    // rather than pretended to be wired.
    {
      const drawnType = (name: Density, layout: SlideLayout) => {
        const s: SlideInput = { layout, title: "A title", subtitle: "A standfirst.", body: "One\nTwo", density: name };
        const els = previewSlideFrom(s, buildSlideRequests(s, 2, `c47${name}`) as any[]).elements;
        const pick = (t: string) => els.filter((e) => e.kind === "text" && String(e.text || "").indexOf(t) === 0)[0];
        return { title: pick("A title"), stand: pick("A standfirst"), body: pick("One") };
      };
      const presets2: Density[] = ["read", "present"];
      for (let i = 0; i < presets2.length; i++) {
        const name = presets2[i], d = DENSITY[name];
        const light = drawnType(name, "content"), dark = drawnType(name, "dark-index");
        A47(!!light.title && !!light.stand && !!light.body && !!dark.title && !!dark.body,
          `47c2 ${name}: precondition — a box this asserts on was not drawn at all`);
        A47(light.title.size === d.type.slideTitle && light.stand.size === d.type.standfirst
          && light.body.size === d.type.body,
          `47c2 ${name} on a light ground draws ${light.title.size}/${light.stand.size}/${light.body.size}pt` +
          ` where the preset says ${d.type.slideTitle}/${d.type.standfirst}/${d.type.body}`);
        A47(dark.title.size === d.type.slideTitleDark && dark.body.size === d.type.bodyDark,
          `47c2 ${name} on a dark ground draws ${dark.title.size}/${dark.body.size}pt` +
          ` where the preset says ${d.type.slideTitleDark}/${d.type.bodyDark}`);
        // THE TITLE'S INK. Every title in the handover deck is brand blue, and
        // brand.ts's navy came from three other TCE decks — so the colour is
        // this deck's rather than the brand's, which makes it a preset value.
        // Read off the drawn box so that a preset holding a colour nothing
        // uses cannot pass.
        A47(String(light.title.color || "").replace("#", "").toUpperCase() === d.titleColor.toUpperCase(),
          `47c2 ${name} draws its title in ${light.title.color} where the preset says #${d.titleColor}`);
        A47(ratio(d.titleColor, COLOR.offWhite) >= 4.5,
          `47c2 ${name}'s title ink is ${ratio(d.titleColor, COLOR.offWhite).toFixed(2)}:1 on off-white`);
        // A dark ground's title is white at BOTH presets: that is a contrast
        // decision, not a density one.
        A47(String(dark.title.color || "").replace("#", "").toUpperCase() === COLOR.white,
          `47c2 ${name} draws its dark-ground title in ${dark.title.color} rather than white`);
      }
      A47(DENSITY.present.titleColor !== DENSITY.read.titleColor,
        `47c2 the two presets set their titles in the same ink, so the blue title is not actually shipping`);

      // AND THE TITLE BLOCK'S OWN CEILING AND FLOOR, driven through the
      // builder rather than through fitHeading, because the preset has to
      // reach the CALL SITE and not merely exist.
      //
      // fitHeading anchors the BOTTOM of the block, so a title that fits does
      // not move when the ceiling changes: only a title long enough to fill
      // the block can see the difference. That is what this one is for, and it
      // is why the short title above cannot stand in for it — the first
      // version of this section asserted only on a short title and stayed
      // green with the call site reading its own ceiling and TITLE_MIN_SIZE.
      const huge = "Where the programme goes next, what it costs to run, who owns each part of it," +
        " and what the board is being asked to decide before the end of the quarter";
      const tall: SlideInput = { layout: "content", title: huge, body: "One\nTwo",
        image: { query: "a picture that narrows the measure" }, density: "present" };
      const tallEl = previewSlideFrom(tall, buildSlideRequests(tall, 2, "c47t") as any[])
        .elements.filter((e) => e.kind === "text" && String(e.text || "").indexOf("Where the programme") === 0)[0];
      A47(!!tallEl, `47c2 precondition: the long title was not drawn, so its ceiling and floor are untested`);
      A47(!!tallEl && tallEl.y >= (FRAME.topRuleY as number) + FRAME.thickness - 1e-9,
        `47c2 a full-height present title starts at ${tallEl ? tallEl.y.toFixed(2) : "?"},` +
        ` on top of the frame's own top rule at ${FRAME.topRuleY}`);
      A47(!!tallEl && (tallEl.size || 0) >= DENSITY.present.titleMinSize,
        `47c2 a long present title was drawn at ${tallEl ? tallEl.size : "?"}pt, below the preset's` +
        ` ${DENSITY.present.titleMinSize}pt floor — and its own standfirst is ${DENSITY.present.type.standfirst}pt`);

      // THE PRESET IS SCOPED TO ONE BUILD. Module state set around a
      // synchronous build is only safe if it is put back, and a leak shows up
      // as the NEXT deck being drawn at the wrong density — which nothing else
      // here would notice, because every other assertion sets its own.
      const afterPresent = drawnType("read", "content");
      A47(afterPresent.body.size === DENSITY.read.type.body
        && afterPresent.title.size === DENSITY.read.type.slideTitle,
        `47c2 a read slide built after a present one came out at ${afterPresent.title.size}/${afterPresent.body.size}pt` +
        ` — the density leaked out of the build that set it`);
      let threw = false;
      try { withDensity("present", () => { throw new Error("x"); }); } catch { threw = true; }
      A47(threw && TYPE.body.size === DENSITY.read.type.body,
        `47c2 a build that threw left the density set to present for everything after it`);
    }

    // (d) THE FRAME'S RULES LAND IN BANDS NOTHING WRITES IN — measured as INK,
    //     which is the only way to ask the question.
    //
    // A rule is a rect, so lib/slides/validate.ts will never compare it with a
    // text box: the overlap sweep compares text with text and would stay green
    // with a hairline drawn through every title in the deck. This is the one
    // assertion standing between the frame and that.
    //
    // The exclusion is narrow and self-describing: ink that has ALREADY left
    // its own box is ink the overrun check is reporting, and those are the two
    // pre-existing faults this stage is explicitly not fixing (the hero stat
    // that 9aa9c10 named, and `feature`'s body). Excluding by "the validator
    // already complains about this slide" rather than by layout name is what
    // keeps a NEW layout that writes into the band from inheriting the excuse.
    // THE FIXTURE EVERY SWEEP BELOW DRIVES, and it is deliberately RICH.
    //
    // Its first version was written from memory of the field names rather than
    // from SlideInput, and seven of the twenty-nine layouts — including all
    // three charts — quietly drew nothing but the shared chrome, because the
    // payload shapes were ones the builder does not read: `chart.categories`
    // with `series[].values` where SlideInput declares `series[].points[]`,
    // `layers[].name/detail` where layersRequests filters on `title`/`cells`,
    // `venn.sets[].name` for `.label`, `hub.centre/nodes` for `.title/.groups`.
    // A sweep that builds a page and measures nothing on it is the failure this
    // repo already has a memory note about, and it is what let the bottom rule
    // ship drawn through the chart source line on ten real slides.
    //
    // So: every field in the shape the builder actually reads, every layout at
    // or near what it will really be handed, and a `chart.source` long enough
    // to reach the foot of the page, because that one string is the box the
    // bottom rule strikes on live traffic. The precondition under `ownIds`
    // below is what stops it silently rotting again.
    const CHART_POINTS = (scale: number) => {
      const months = ["January", "February", "March", "April", "May", "June", "July", "August"];
      const out: { label: string; value: number }[] = [];
      for (let i = 0; i < months.length; i++) out.push({ label: months[i], value: 10 + i * 7 * scale });
      return out;
    };
    const FRAME_FIX = (layout: SlideLayout): SlideInput => ({
      // A divider draws its index numeral only from a NUMERIC eyebrow, which
      // is the one field on this fixture that has to differ by layout.
      layout, eyebrow: layout === "section" ? "3" : "Eyebrow", title: LONG,
      subtitle: "A standfirst that also runs long enough to wrap onto a second line here.",
      body: "One point that runs on\nTwo points that run on\nThree points that run on",
      bodyRight: "Alpha runs on too\nBeta runs on too\nGamma runs on too",
      note: "Why this matters: the figures only move once the audience is the unit of planning.",
      columns: { left: "Today", right: "After" },
      tones: ["coral", "teal"],
      stats: [{ value: "64%", label: "Installed capacity", detail: "of the estate" },
        { value: "3.1x", label: "Answer share", detail: "against the field" },
        { value: "18", label: "Prompts tracked", tone: "teal" },
        { value: "7", label: "Publishers cited", tone: "grey" }],
      cards: [{ marker: "01", tone: "blue", title: "Move one", body: "What happens here, and what it changes." },
        { marker: "02", tone: "teal", title: "Move two", body: "What happens here, and what it changes." },
        { marker: "03", tone: "coral", title: "Move three", body: "What happens here, and what it changes." }],
      strip: { title: "In detail", items: [{ title: "First", text: "A short gloss." },
        { title: "Second", text: "A short gloss." }, { title: "Third", text: "A short gloss." }] },
      milestones: [{ date: "Q1 26", title: "Setup", detail: "Baseline collection begins." },
        { date: "Q2 26", title: "Run", detail: "Ongoing through the quarter." },
        { date: "Q3 26", title: "Review", detail: "The board sees the first read." }],
      table: { columns: ["Workstream", "Owner", "Status"], rows: [["Measurement", "TCE", "Running"],
        ["Publishing", "Client", "Running"], ["Distribution", "TCE", "Planned"],
        ["Review", "Client", "Planned"], ["Handover", "TCE", "Not started"], ["Close", "Client", "Not started"]] },
      chart: {
        series: [{ name: "Answer share", points: CHART_POINTS(1) },
          { name: "Field average", points: CHART_POINTS(0.6) }],
        source: "Ahrefs Site Explorer AI responses count, 20 August 2026, against the tracked prompt set",
      },
      logos: [{ name: "Siemens" }, { name: "Amrize" }, { name: "Holcim" }],
      images: [{ query: "one", caption: "The first" }, { query: "two", caption: "The second" },
        { query: "three", caption: "The third" }],
      resolvedImages: [{ url: "a.jpg", caption: "The first" }, { url: "b.jpg", caption: "The second" },
        { url: "c.jpg", caption: "The third" }],
      image: { query: "a photograph that narrows the measure" },
      resolvedImage: PHOTO_PALE,
      quote: { text: "A sentence worth repeating twice, and long enough to wrap.", name: "A Person", role: "A Role" },
      stages: [{ name: "Stage one", caption: "What happens here." },
        { name: "Stage two", caption: "And here." }, { name: "Stage three", caption: "And then here." }],
      layers: [{ title: "Channels", caption: "Where the audience already is.",
          cells: [{ title: "Search", text: "Organic and paid." }, { title: "Social", text: "Owned and earned." }] },
        { title: "Content", caption: "What is published into them.",
          cells: [{ title: "Research", text: "The programme." }, { title: "Editorial", text: "The cadence." }] },
        { title: "Assistants", caption: "What reads it back to the buyer.", arrow: "up" },
        { title: "Measurement", caption: "What says whether any of it worked." }],
      swot: { strengths: ["A strength that runs on"], weaknesses: ["A weakness that runs on"],
        opportunities: ["An opening that runs on"], threats: ["A threat that runs on"] },
      matrix: { xAxis: ["Low", "High"], yAxis: ["Low", "High"], quadrants: ["Later", "Do now", "Never", "Maybe"],
        items: [{ label: "One", x: 0.3, y: 0.7 }, { label: "Two", x: 0.7, y: 0.3, highlight: true },
          { label: "Three", x: 0.6, y: 0.8 }] },
      comparison: { columns: ["Today", "After"], rows: [{ label: "Cost", cells: ["yes", "no"] },
        { label: "Speed", cells: ["no", "yes"] }, { label: "Reach", cells: ["Limited", "Whole estate"] }] },
      scatter: { xAxis: "Reach", yAxis: "Depth", points: [{ x: 1, y: 2, label: "One", group: "Us" },
        { x: 3, y: 4, label: "Two", group: "Them" }, { x: 5, y: 1, label: "Three", group: "Us" },
        { x: 2, y: 5, label: "Four", group: "Them" }] },
      venn: { sets: [{ label: "Search" }, { label: "Answers" }, { label: "Brand" }], overlap: "Authority" },
      hub: { title: "The hub", caption: "What it is wired to.", groups: [
        { name: "Sources", tone: "blue", items: [{ title: "CRM" }, { title: "Analytics" }, { title: "Search" }] },
        { name: "Surfaces", tone: "teal", items: [{ title: "Site" }, { title: "Assistants" }, { title: "Sales" }] }] },
      tracks: [{ name: "Measurement", phases: [{ start: "2026-01-01", end: "2026-03-01", label: "Baseline" },
          { start: "2026-03-01", end: "2026-06-01", label: "Monitor" }] },
        { name: "Publishing", phases: [{ start: "2026-02-01", end: "2026-05-01", label: "Programme" }] }],
      panel: { title: "The Content Engine is a combination of", items: [{ title: "Research", text: "Original data." },
        { title: "Editorial", text: "A house voice." }, { title: "Distribution", text: "Where it lands." }] },
    } as any);

    /** Content sized for the TIGHTER preset — a short title, one line of
     *  standfirst, two or three of everything, no takeaway bar. The rich
     *  fixture above is `read` copy, and pushing `read` copy through a rhythm
     *  that is 20% shorter and 50% larger is meant to overflow; it says nothing
     *  about whether the two presets are one geometry. This one does. */
    const FITS_BOTH = (layout: SlideLayout): SlideInput => ({
      layout, eyebrow: layout === "section" ? "3" : "Now", title: "The shape of it",
      subtitle: "One line.", body: "One\nTwo\nThree", bodyRight: "Alpha\nBeta",
      columns: { left: "Today", right: "After" },
      stats: [{ value: "64%", label: "Capacity" }, { value: "3x", label: "Share" }],
      cards: [{ marker: "01", title: "One", body: "Short." }, { marker: "02", title: "Two", body: "Short." }],
      milestones: [{ date: "Q1", title: "Setup" }, { date: "Q2", title: "Run" }],
      table: { columns: ["Task", "Owner"], rows: [["One", "TCE"], ["Two", "Client"]] },
      chart: { series: [{ name: "Share", points: [{ label: "Jan", value: 10 },
        { label: "Feb", value: 20 }, { label: "Mar", value: 14 }] }] },
      logos: [{ name: "Siemens" }, { name: "Amrize" }],
      images: [{ query: "one" }, { query: "two" }],
      resolvedImages: [{ url: "a.jpg" }, { url: "b.jpg" }],
      image: { query: "a picture" }, resolvedImage: PHOTO_PALE,
      quote: { text: "Worth repeating.", name: "A Person" },
      stages: [{ name: "One" }, { name: "Two" }],
      layers: [{ title: "Channels" }, { title: "Content" }, { title: "Assistants" }],
      swot: { strengths: ["A"], weaknesses: ["B"], opportunities: ["C"], threats: ["D"] },
      matrix: { xAxis: ["Low", "High"], yAxis: ["Low", "High"], items: [{ label: "One", x: 0.3, y: 0.7 }] },
      comparison: { columns: ["Today", "After"], rows: [{ label: "Cost", cells: ["yes", "no"] }] },
      scatter: { xAxis: "Reach", yAxis: "Depth", points: [{ x: 1, y: 2, label: "One" }, { x: 3, y: 4, label: "Two" }] },
      venn: { sets: [{ label: "A" }, { label: "B" }] },
      hub: { title: "Hub", groups: [{ items: [{ title: "One" }, { title: "Two" }] }] },
      tracks: [{ name: "Track", phases: [{ start: "2026-01-01", end: "2026-03-01", label: "Phase" }] }],
      panel: { title: "Panel", items: [{ title: "One", text: "Short." }] },
    } as any);

    /** The object ids the shared header, footer and frame draw on every page.
     *  Everything else on a slide belongs to its layout. */
    const CHROME = ["eyebrow", "title", "sub", "noteBar", "noteTxt", "logo", "ftl", "frTop", "frBot", "ftn"];
    const ownIds = (reqs: any[]): string[] => {
      const out: string[] = [];
      for (let i = 0; i < reqs.length; i++) {
        const c = reqs[i].createShape || reqs[i].createImage || reqs[i].createTable;
        if (!c) continue;
        const raw = String(c.objectId);
        const suffix = raw.slice(raw.lastIndexOf("_") + 1);
        if (CHROME.indexOf(suffix) < 0 && CHROME.indexOf(suffix.replace(/[0-9]+$/, "")) < 0) out.push(suffix);
      }
      return out;
    };
    const hexOf = (c: any): string => {
      const two = (v: number | undefined) => {
        const h = Math.round(Math.max(0, Math.min(1, v || 0)) * 255).toString(16).toUpperCase();
        return h.length < 2 ? `0${h}` : h;
      };
      return `${two(c && c.red)}${two(c && c.green)}${two(c && c.blue)}`;
    };
    /** `fg` at `alpha` over `bg`, so a rule's contrast is measured at the
     *  strength it is actually drawn at rather than at full opacity. */
    const blend = (fg: string, bg: string, alpha: number): string => {
      const f = fg.replace("#", ""), b = bg.replace("#", "");
      let out = "";
      for (let i = 0; i < 3; i++) {
        const v = Math.round(alpha * parseInt(f.substr(i * 2, 2), 16) + (1 - alpha) * parseInt(b.substr(i * 2, 2), 16));
        const h = v.toString(16).toUpperCase();
        out += h.length < 2 ? `0${h}` : h;
      }
      return out;
    };
    /** The frame's own ink, read back off the emitted requests. */
    const frameInk = (reqs: any[]) => {
      const rules: { id: string; y: number; fill: string; alpha: number }[] = [];
      const at: { [id: string]: number } = {};
      let folio: { color: string; size: number } | null = null;
      for (let i = 0; i < reqs.length; i++) {
        const c = reqs[i].createShape;
        if (c && /_(frTop|frBot)$/.test(String(c.objectId))) at[String(c.objectId)] = c.elementProperties.transform.translateY;
        const u = reqs[i].updateShapeProperties;
        if (u && /_(frTop|frBot)$/.test(String(u.objectId))) {
          const f = u.shapeProperties?.shapeBackgroundFill?.solidFill;
          rules.push({
            id: String(u.objectId).slice(String(u.objectId).lastIndexOf("_") + 1),
            y: at[String(u.objectId)], fill: hexOf(f?.color?.rgbColor),
            alpha: typeof f?.alpha === "number" ? f.alpha : 1,
          });
        }
        const t = reqs[i].updateTextStyle;
        if (t && /_ftn$/.test(String(t.objectId))) {
          folio = { color: hexOf(t.style?.foregroundColor?.opaqueColor?.rgbColor), size: t.style?.fontSize?.magnitude };
        }
      }
      return { rules, folio };
    };

    // (d) THE FRAME'S RULES NEVER STRIKE A LINE OF TYPE, measured as INK on the
    //     rules the builder ACTUALLY DREW.
    //
    // A rule is a rect, so lib/slides/validate.ts will never compare it with a
    // text box: the overlap sweep compares text with text and would stay green
    // with a hairline drawn through every title in the deck. This is the one
    // assertion standing between the frame and that.
    //
    // THE FIRST VERSION OF THIS PASSED WHILE THE DEFECT WAS LIVE, and why is
    // worth more than the assertion. It asserted that the rules' BANDS were
    // empty — which the bottom one is not: a chart's source line is placed from
    // where its own plot ends, so it reaches 378.3 and the rule at 376 is drawn
    // along its baseline. The sweep did not see it because the fixture's chart
    // was written in a shape the builder does not read and had no `source` at
    // all. Ten of the 618 stored slides shipped that way, in nine of the
    // thirty-seven decks, at the DEFAULT density.
    //
    // So the builder measures the page before it draws a rule, and this
    // measures what it drew. The band is no longer assumed anywhere.
    const PRESETS: Density[] = ["read", "present"];
    for (let pi = 0; pi < PRESETS.length; pi++) {
      const name = PRESETS[pi];
      let crossings = 0, drew = 0, yielded = 0;
      for (let li = 0; li < LAYOUTS.length; li++) {
        const layout = LAYOUTS[li];
        const slide = FRAME_FIX(layout);
        slide.density = name;
        const reqs = buildSlideRequests(slide, 3, "f47") as any[];
        const page = previewSlideFrom(slide, reqs);
        // THE PRECONDITION THAT WOULD HAVE CAUGHT THE INERT FIXTURE: this slide
        // has to have drawn its LAYOUT, not just a page with chrome on it.
        A47(ownIds(reqs).length > 0,
          `47d ${name}/${layout}: the fixture drew nothing but the shared chrome, so every sweep` +
          ` over it measures a blank page — check the payload shape against SlideInput`);
        const ink = frameInk(reqs);
        const bars: number[] = [];
        for (let r = 0; r < ink.rules.length; r++) bars.push(ink.rules[r].y);
        if (ink.rules.some((r) => r.id === "frBot")) drew++; else yielded++;
        for (let e = 0; e < page.elements.length; e++) {
          const el = page.elements[e];
          if (el.kind !== "text" || !el.text) continue;
          const bottom = inkBottom(el);
          for (let b = 0; b < bars.length; b++) {
            if (el.y >= bars[b] + FRAME.thickness || bottom <= bars[b]) continue;
            crossings++;
            fail(`47d ${name}/${layout}: the frame's rule at y=${bars[b]} is drawn through ink at`
              + ` ${el.y.toFixed(1)}..${bottom.toFixed(1)} — "${String(el.text).slice(0, 26)}"`);
          }
        }
        // AND THE FRAME'S OWN INK READS, on the ground it is drawn on and at
        // the strength it is drawn at. The token assertions below catch a
        // wrong token; these catch the token being right and the drawing not
        // using it, which is this repo's own recorded failure mode and which
        // every one of them survived until it was asked this way.
        const style = slideStyle(slide, 3);
        const ground = style.background || (style.onDark ? COLOR.navy : COLOR.offWhite);
        if (style.background !== null) {
          for (let r = 0; r < ink.rules.length; r++) {
            const shown = blend(ink.rules[r].fill, ground, ink.rules[r].alpha);
            A47(ratio(shown, ground) >= 3,
              `47d ${name}/${layout}: the ${ink.rules[r].id} rule draws #${ink.rules[r].fill} at alpha` +
              ` ${ink.rules[r].alpha} on #${ground}, which reads ${ratio(shown, ground).toFixed(2)}:1`);
          }
          if (ink.folio) {
            A47(ratio(ink.folio.color, ground) >= 4.5,
              `47d ${name}/${layout}: the page number draws #${ink.folio.color} on #${ground}, which is` +
              ` ${ratio(ink.folio.color, ground).toFixed(2)}:1 at ${ink.folio.size}pt`);
          }
        }
      }
      A47(crossings === 0, `47d ${name}: ${crossings} boxes are struck by a frame rule`);
      // BOTH HALVES OF THE YIELD ARE EXERCISED. A sweep that came back clean
      // because no rule was ever drawn would prove nothing at all, and a sweep
      // in which none ever yielded would not be reaching the case the whole
      // mechanism exists for.
      A47(drew > 0, `47d ${name}: precondition — not one layout drew a bottom rule, so nothing was measured`);
      A47(yielded > 0,
        `47d ${name}: precondition — no layout yielded its bottom rule, so the yield is untested;` +
        ` the chart fixture's source line is what is meant to reach it`);
    }
    // AND THE YIELD IS DRIVEN DIRECTLY, on the one box that caused it: the same
    // chart with and without its source credit.
    {
      const withSource: SlideInput = { layout: "bar-chart", title: "Where the answers come from",
        chart: { series: [{ name: "Answer share", points: CHART_POINTS(1) }],
          source: "Ahrefs Site Explorer AI responses count, 20 August 2026, against the tracked prompt set" } };
      const bare: SlideInput = { layout: "bar-chart", title: "Where the answers come from",
        chart: { series: [{ name: "Answer share", points: CHART_POINTS(1) }] } };
      const ruleOn = (s: SlideInput) => frameInk(buildSlideRequests(s, 2, "y47") as any[])
        .rules.some((r) => r.id === "frBot");
      const srcInk = (s: SlideInput) => {
        const els = previewSlideFrom(s, buildSlideRequests(s, 2, "y47") as any[]).elements
          .filter((e) => e.kind === "text" && String(e.text || "").indexOf("Ahrefs") === 0);
        return els.length ? inkBottom(els[0]) : 0;
      };
      A47(srcInk(withSource) > FRAME.bottomRuleY,
        `47d precondition: the chart's source line reaches ${srcInk(withSource).toFixed(1)}, which does not` +
        ` reach the rule at ${FRAME.bottomRuleY} — this fixture no longer tests the yield`);
      A47(!ruleOn(withSource),
        `47d a chart whose source line runs to ${srcInk(withSource).toFixed(1)} was given a rule at ${FRAME.bottomRuleY} anyway`);
      A47(ruleOn(bare),
        `47d the same chart without a source line was denied its rule, so the frame is yielding to nothing`);

      // AND THE TOP RULE YIELDS TOO, which nothing else here reaches: at
      // `present` it is the only rule above the content, and the only box that
      // can grow into it is the eyebrow. A 90-character one wraps to two lines
      // and its second line lands on the rule — measured in the weight and
      // face it is DRAWN in, which for a bold Roboto caps label means glyph by
      // glyph rather than at any average.
      //
      // (This is also why the ledger's own `caps` flag is unreachable and
      // survives being falsified: every caps style that can appear on a framed
      // page is bold, and the bold branch measures the already-upper-cased
      // string's real advances. The two non-bold caps styles in TYPE are the
      // cover and closing kickers, and neither of those pages carries a
      // frame. The flag stays for the day that stops being true.)
      const shouty: SlideInput = { layout: "content", density: "present",
        eyebrow: "Programme measurement, reporting and governance across the whole estate for the year ahead",
        title: "A title", body: "One\nTwo" };
      const shoutyReqs = buildSlideRequests(shouty, 2, "k47") as any[];
      const shoutyInk = previewSlideFrom(shouty, shoutyReqs).elements
        .filter((e) => e.kind === "text" && String(e.text || "").indexOf("PROGRAMME") === 0)
        .map((e) => inkBottom(e))[0] || 0;
      A47(shoutyInk > (DENSITY.present.topRuleY as number),
        `47d precondition: the two-line eyebrow reaches ${shoutyInk.toFixed(1)}, which does not reach the top` +
        ` rule at ${DENSITY.present.topRuleY} — this fixture no longer tests the caps measure`);
      A47(!frameInk(shoutyReqs).rules.some((r) => r.id === "frTop"),
        `47d an eyebrow wrapping to ${shoutyInk.toFixed(1)} was given a top rule at` +
        ` ${DENSITY.present.topRuleY} — the top rule is not yielding to anything`);
    }
    // And the rules are in the canvas and in the gaps they were measured into.
    A47(FRAME.bottomRuleY > NOTE.bottom && FRAME.bottomRuleY + FRAME.thickness < FOOTER_Y,
      `47d the bottom rule at ${FRAME.bottomRuleY} is not between the takeaway bar's floor (${NOTE.bottom})` +
      ` and the footer's box (${FOOTER_Y})`);
    A47(FRAME.topRuleY >= LOGO_PLACEMENT.content.y + LOGO_PLACEMENT.content.height,
      `47d the top rule at ${FRAME.topRuleY} is drawn through the lockup, which ends at` +
      ` ${LOGO_PLACEMENT.content.y + LOGO_PLACEMENT.content.height}`);
    A47(DENSITY.present.titleMinTop >= FRAME.topRuleY + FRAME.thickness,
      `47d the present title block starts at ${DENSITY.present.titleMinTop}, on top of its own top rule`);
    A47(DENSITY.read.topRuleY === null,
      `47d read draws a top rule, and a read title box reaches ${DENSITY.read.titleMinTop} — above the rule`);
    A47(ratio(FRAME.rule, COLOR.offWhite) >= 3,
      `47d the hairline is ${ratio(FRAME.rule, COLOR.offWhite).toFixed(2)}:1 on off-white`);
    A47(ratio(blend(FRAME.ruleOnDark, COLOR.navy, FRAME.ruleOnDarkAlpha), COLOR.navy) >= 3,
      `47d the dark-ground hairline reads` +
      ` ${ratio(blend(FRAME.ruleOnDark, COLOR.navy, FRAME.ruleOnDarkAlpha), COLOR.navy).toFixed(2)}:1 on navy` +
      ` at alpha ${FRAME.ruleOnDarkAlpha}`);

    // (e) THE FOLIO HAS ITS OWN SLOT, CUT OUT OF THE LINE RATHER THAN LAID
    //     OVER IT.
    //
    // Three things are drawn on the footer line and two of them are END-aligned
    // or full-width. Without footerLineWidth the number is drawn on top of the
    // photo credit on every photo slide: 46 new box overlaps on the 618 stored
    // slides, 45 of them with the ink really meeting.
    {
      const folioLeft = GRID.margin + GRID.contentWidth - FRAME.numberWidth;
      A47(footerLineWidth(GRID.margin, GRID.contentWidth) + GRID.margin <= folioLeft - FRAME.numberGap + 1e-9,
        `47e the running head's measure runs into the folio's slot`);
      A47(footerLineWidth(GRID.margin, GRID.proseNarrow) === GRID.proseNarrow,
        `47e a credit under a picture rail, which ends well left of the folio, was narrowed anyway`);
      A47(folioLeft + FRAME.numberWidth === GRID.margin + GRID.contentWidth,
        `47e the folio does not end on the right margin`);
      const deck: SlideInput[] = [
        { layout: "content", title: "One", body: "A" },
        { layout: "content", title: "Two", body: "B" },
        { layout: "content", title: "Three", body: "C" },
      ];
      const folios = (d: SlideInput[]) => {
        const out: string[] = [];
        for (let i = 0; i < d.length; i++) {
          const reqs = buildSlideRequests(d[i], i, "e47") as any[];
          for (let r = 0; r < reqs.length; r++) {
            const t = reqs[r].insertText;
            if (t && /_ftn$/.test(String(t.objectId))) out.push(String(t.text));
          }
        }
        return out.join(",");
      };
      A47(folios(deck) === "1,2,3", `47e the folios read ${folios(deck)} rather than 1,2,3`);
      // AN INSERT RENUMBERS. This is the whole answer to the objection that
      // removed the page number in the first place — a static number that lies
      // after an edit — and it holds because the builder owns the number and
      // every route rebuilds every slide.
      const inserted = deck.slice(0, 1).concat([{ layout: "content", title: "New", body: "N" }], deck.slice(1));
      A47(folios(inserted) === "1,2,3,4", `47e after an insert the folios read ${folios(inserted)}`);
      // The cover and the closing carry no folio, for the same reason they
      // carry no footer: they are not pages of the argument.
      A47(folios([{ layout: "cover", title: "A deck" }, { layout: "closing", title: "Thank you" }]) === "",
        `47e the cover or the closing was given a page number`);

      // AND NOTHING ELSE RUNS INTO THE SLOT — asserted over every layout at
      // both presets rather than over footerLineWidth's two current callers.
      //
      // The first version of this asserted the RULE (the running head yields,
      // a credit under a picture rail does not) and called that the contract.
      // It is not: the contract is about the slot, and two other boxes could
      // reach it — the layers diagram's "omitted to fit" admission, when its
      // stack overran the band, and the cards strip's last cell, when the band
      // could no longer hold the strip. Both are fixed where they belong, in
      // the geometry that let them leave the band at all, and this is what
      // says so for every layout at once.
      //
      // A box whose INK has already left it is excused: that is an overrun the
      // validator is separately reporting, and the folio is not the reason a
      // slide is broken. The hero stat 9aa9c10 named is the one live instance.
      let intruders = 0, excused = 0;
      for (let pi = 0; pi < PRESETS.length; pi++) {
        for (let li = 0; li < LAYOUTS.length; li++) {
          const slide = FRAME_FIX(LAYOUTS[li]);
          slide.density = PRESETS[pi];
          const reqs = buildSlideRequests(slide, 3, "e47") as any[];
          const page = previewSlideFrom(slide, reqs);
          const ids: string[] = [];
          for (let r = 0; r < reqs.length; r++) {
            const c = reqs[r].createShape || reqs[r].createImage;
            if (c) ids.push(String(c.objectId));
          }
          for (let e = 0; e < page.elements.length; e++) {
            const el = page.elements[e];
            if (el.kind !== "text" || !el.text || /_ftn$/.test(ids[e] || "")) continue;
            if (el.x + el.w <= folioLeft || el.x >= folioLeft + FRAME.numberWidth) continue;
            if (el.y >= FOOTER_Y + 12 || el.y + el.h <= FOOTER_Y) continue;
            if (inkBottom(el) > el.y + el.h + 1) { excused++; continue; }
            intruders++;
            fail(`47e ${PRESETS[pi]}/${LAYOUTS[li]}: "${String(el.text).slice(0, 24)}" is drawn in the folio's` +
              ` slot (${el.x.toFixed(1)}..${(el.x + el.w).toFixed(1)} x ${el.y.toFixed(1)}..${(el.y + el.h).toFixed(1)})`);
          }
        }
      }
      A47(intruders === 0, `47e ${intruders} boxes share the folio's slot`);
    }

    // (f) THE PAPER IS A PAGE BACKGROUND, AND THE PREVIEW KEEPS ITS GROUND.
    //
    // hex() of an absent rgbColor is #000000, so a preview that read the frame's
    // second updatePageProperties would turn every light slide black while the
    // deck itself was fine. Driven rather than reasoned about.
    {
      const paperOf = (s: SlideInput) => {
        const reqs = buildSlideRequests(s, 1, "p47") as any[];
        let paper = 0, solid = 0;
        for (let i = 0; i < reqs.length; i++) {
          const u = reqs[i].updatePageProperties;
          if (!u) continue;
          if (u.pageProperties?.pageBackgroundFill?.stretchedPictureFill) paper++;
          if (u.pageProperties?.pageBackgroundFill?.solidFill) solid++;
        }
        return { paper, solid, reqs };
      };
      const light: SlideInput = { layout: "content", title: "A light page", body: "One\nTwo" };
      const dark: SlideInput = { layout: "dark-index", title: "A dark page", body: "One\nTwo" };
      const photo: SlideInput = { layout: "cover", title: "A photograph", resolvedImage: PHOTO_DARK };
      const L = paperOf(light), D = paperOf(dark), P2 = paperOf(photo);
      A47(L.paper === 1 && L.solid === 1, `47f a light page carries ${L.paper} paper fills and ${L.solid} solid ones`);
      A47(D.paper === 0, `47f the paper sheet — a near-white texture — was laid under a dark ground`);
      A47(P2.paper === 0, `47f the paper sheet was laid under a photograph that covers the page`);
      A47(String(L.reqs.map((r: any) => r.updatePageProperties?.pageProperties?.pageBackgroundFill
        ?.stretchedPictureFill?.contentUrl).filter(Boolean)[0]) === assetUrl(FRAME.paperPath),
        `47f the paper is not fetched from the public asset origin, so Slides cannot reach it`);
      const preview = previewSlideFrom(light, L.reqs);
      A47(preview.background.toUpperCase() === `#${COLOR.offWhite}`,
        `47f the preview's ground is ${preview.background} rather than the off-white the deck draws` +
        ` — the frame's picture fill has been read as a colour`);
      // And it adds NO ELEMENT: that is the whole argument for a background
      // over a full-bleed image, and it is what keeps validate.ts's sweeps,
      // pathOf and droppedContent counting what they counted before. Measured
      // as "no element covers the page" rather than "no images at all", because
      // the lockup is a createImage and always was.
      let bleeds = 0;
      for (let i = 0; i < L.reqs.length; i++) {
        const c = L.reqs[i].createImage;
        if (c && c.elementProperties?.size?.width?.magnitude >= CANVAS.width - 1) bleeds++;
      }
      A47(bleeds === 0, `47f the paper was drawn as a full-bleed element, not as a page background`);
      A47(previewSlideFrom(light, L.reqs).elements.length
        === previewSlideFrom(light, L.reqs.filter((r: any) => !r.updatePageProperties)).elements.length,
        `47f the page background adds an element to the preview`);
    }

    // (g) THE THREE PRIMITIVES.
    //
    // None of them has a production caller beyond the frame's own rule yet —
    // Stage 3's stepper and Stage 4's layouts are what use them — so this is
    // the only thing driving them, and it drives them rather than asserting
    // they were written.
    {
      const bleed = hairlineSpan("bleed"), content = hairlineSpan("content");
      A47(bleed.x === 0 && bleed.length === CANVAS.width, `47g the full-bleed reach does not bleed`);
      A47(content.x === GRID.margin && content.length === GRID.contentWidth,
        `47g the content reach is not the content measure`);
      const fig = hairlineSpan({ from: 300 });
      A47(fig.x === 300 && Math.abs(fig.x + fig.length - (GRID.margin + GRID.contentWidth)) < 1e-9,
        `47g a rule from a figure's edge does not end on the right margin`);
      A47(hairlineSpan({ from: -50 }).x === 0 && hairlineSpan({ from: 5000 }).length === 0,
        `47g a rule from an x off the slide is not clamped onto it`);
      // And a clamped-to-nothing rule draws NOTHING rather than a zero-width
      // shape: Slides rejects those, and it rejects the whole batchUpdate with
      // them, so a figure that happens to fill the measure would take the deck
      // down over a hairline.
      A47(hairline("gz", "pg", { from: 5000 }, 200, false).length === 0,
        `47g a rule with no measure to run across still emits a zero-width shape`);
      // Every primitive stays on the canvas and emits only kinds the preview
      // knows — check 43's set, which is what keeps a new shape from drawing
      // correctly in Drive and as a grey rectangle in the chat and the PDF.
      const bits: any[] = ([] as any[]).concat(
        hairline("g1", "pg", "bleed", FRAME.bottomRuleY, false),
        crossingHairlines("g2", "pg", { x: 360, y: 200 }, 40, false),
        hungDot("g3", "pg", { x: GRID.margin, y: 200 }, 12),
        ctaPill("g4", "pg", "Book a session", { x: GRID.margin, y: 300 }, false),
      );
      const pv = previewSlideFrom({ layout: "content" } as SlideInput, bits as any[]);
      for (let i = 0; i < bits.length; i++) {
        A47(HANDLED.has(Object.keys(bits[i])[0]),
          `47g a primitive emits ${Object.keys(bits[i])[0]}, which the preview does not handle`);
      }
      for (let i = 0; i < pv.elements.length; i++) {
        const e = pv.elements[i];
        A47(e.x >= -1e-9 && e.y >= -1e-9 && e.x + e.w <= CANVAS.width + 1e-9 && e.y + e.h <= CANVAS.height + 1e-9,
          `47g a primitive draws off the canvas: ${e.x.toFixed(1)},${e.y.toFixed(1)} ${e.w.toFixed(1)}x${e.h.toFixed(1)}`);
      }
      // THE HUNG DOT HANGS. If it does not sit left of the first glyph it is
      // not a hung bullet, it is a disc in the middle of a sentence — and the
      // gutter floor a composition needs is derived from exactly this offset.
      const dot = previewSlideFrom({ layout: "content" } as SlideInput,
        hungDot("gd", "pg", { x: 200, y: 150 }, 12) as any[]).elements[0];
      A47(dot.x + dot.w <= 200 + SLIDES_TEXT_INSET.x,
        `47g the hung dot ends at ${(dot.x + dot.w).toFixed(2)}, inside the first glyph at` +
        ` ${(200 + SLIDES_TEXT_INSET.x).toFixed(2)}`);
      A47(dot.y >= 150 + SLIDES_TEXT_INSET.y - 1e-9
        && dot.y + dot.h <= 150 + SLIDES_TEXT_INSET.y + 12 * 1.45 + 1e-9,
        `47g the hung dot is not level with the first line of its paragraph`);
      A47(HUNG_DOT.offsetX > HUNG_DOT.diameter,
        `47g the dot's offset is inside its own diameter, so it overlaps the glyph it marks`);
      // THE PILL'S LABEL READS, AND IS NOT THE SOURCE DECK'S HYPERLINK YELLOW.
      const pillEls = previewSlideFrom({ layout: "content" } as SlideInput,
        ctaPill("gp", "pg", "Book a session", { x: 40, y: 300 }, false) as any[]).elements;
      const body = pillEls[0], label = pillEls[1];
      A47(pillEls.length === 2 && body.kind === "rect" && !!body.rounded && label.kind === "text",
        `47g a pill is not a rounded rect with a label in it`);
      // MEASURED ON THE INK THE PILL ACTUALLY EMITS, read back out of the
      // preview, rather than on textOn(PILL.fill) recomputed here. Recomputing
      // it asserts that the RULE was written; the first version of this did
      // exactly that and stayed green while the label was changed to the source
      // deck's #FFD966 — which is the defect this assertion exists to refuse.
      const labelInk = String(label.color || "").replace("#", "");
      const pillFill = String(body.fill || "").replace("#", "");
      A47(!!labelInk && !!pillFill && ratio(labelInk, pillFill) >= 4.5,
        `47g the pill draws #${labelInk} on #${pillFill}, which is ${ratio(labelInk || "000000", pillFill || "FFFFFF").toFixed(2)}:1`);
      A47(ratio("FFD966", PILL.fill) < 4.5,
        `47g precondition: the source deck's hyperlink yellow would have passed, so this asserts nothing`);
      A47(labelInk.toUpperCase() !== "FFD966",
        `47g the pill's label is the source deck's theme hyperlink colour, which is a defect in the source`);
      A47(labelWidthPt("BOOK A SESSION", PILL.fontSize) <= body.w,
        `47g the pill's label (${labelWidthPt("BOOK A SESSION", PILL.fontSize).toFixed(1)}pt) is wider than the pill (${body.w.toFixed(1)}pt)`);
      A47(ctaPill("ge", "pg", "   ", { x: 40, y: 300 }, false).length === 0,
        `47g an empty pill draws an empty capsule rather than nothing`);
    }

    // (h) THE FOUR ABSOLUTE BLOCKS FOLLOW THE RHYTHM.
    //
    // They are the layouts the preset would otherwise break silently: the
    // image grid's cells are createImage, so the overlap sweep — which
    // compares text with text — reports NOTHING while the title is drawn
    // 13.2pt over the first row.
    withDensity("present", () => {
      const floor = GRID.bodyY + GRID.bandHeight;
      const titleBottom = GRID.bodyY - 12;
      const blocks: [string, number, number][] = [
        ["timeline", TIMELINE.dateY, TIMELINE.detailY + TIMELINE.detailHeight],
        ["timeline-parallel", TIMELINE_PARALLEL.bandY, TIMELINE_PARALLEL.bandY],
        ["image-grid", IMAGE.gridY, IMAGE.gridY + IMAGE.gridHeight],
        ["logo-wall", LOGO_WALL.y, LOGO_WALL.y + LOGO_WALL.height],
      ];
      for (let i = 0; i < blocks.length; i++) {
        const [nm, top, bottom] = blocks[i];
        A47(top >= titleBottom,
          `47h at present the ${nm} block starts at ${top.toFixed(2)}, above the foot of the title box (${titleBottom.toFixed(2)})`);
        A47(bottom <= floor + 1e-9,
          `47h at present the ${nm} block ends at ${bottom.toFixed(2)}, past the band floor (${floor.toFixed(2)})`);
      }
    });

    // (i) AND ALL 29 LAYOUTS ARE BUILT AT BOTH PRESETS AND MEASURED.
    //
    // The preset has no production caller yet, which is the condition under
    // which a second code path rots quietly. Nothing off the canvas is the
    // assertion: a slide that OVERFLOWS at present is content the validator is
    // meant to report, and a slide drawn past the edge of the page is geometry
    // that is simply wrong — and it is the failure the caller never sees,
    // because the admission that content was dropped goes over the edge with
    // the content.
    for (let pi = 0; pi < PRESETS.length; pi++) {
      const deck: SlideInput[] = [];
      for (let li = 0; li < LAYOUTS.length; li++) {
        const s2 = FRAME_FIX(LAYOUTS[li]);
        s2.density = PRESETS[pi];
        deck.push(s2);
      }
      const g = validateDeck(deck, `d47${pi}`);
      A47(g.slidesChecked === LAYOUTS.length && g.unbuildable === 0,
        `47i ${PRESETS[pi]}: ${g.unbuildable} of ${LAYOUTS.length} layouts could not be built at all`);
      const counts = faultCounts(g);
      A47(counts["off-canvas"] === 0,
        `47i ${PRESETS[pi]}: ${counts["off-canvas"]} elements are drawn off the canvas` +
        ` — ${g.faults.filter((f) => f.kind === "off-canvas").map((f) => f.note).join("; ").slice(0, 300)}`);
    }
    // THE TWO PRESETS ARE ONE GEOMETRY, and this is how that becomes a
    // measurement rather than a claim: the same 29 layouts, content sized for
    // the tighter of the two, the same verdict.
    //
    // MEASURED ON `FITS_BOTH` AND NOT ON THE RICH FIXTURE, deliberately. The
    // rich one is `read` copy — a two-line title, a wrapping standfirst, six
    // table rows, four stats — and pushing that through a rhythm that is a
    // fifth shorter and half again larger is MEANT to overflow. Asserting the
    // same verdict there would only be satisfiable by a fixture small enough
    // to say nothing, which is the trap the whole of (d) is about. The honest
    // pair is: off the canvas, never, on content that is far too big; the same
    // fault by fault, on content that fits.
    const verdict = (name: Density) => {
      const deck: SlideInput[] = [];
      for (let li = 0; li < LAYOUTS.length; li++) { const s2 = FITS_BOTH(LAYOUTS[li]); s2.density = name; deck.push(s2); }
      return JSON.stringify(faultCounts(validateDeck(deck, `v47${name}`)));
    };
    A47(verdict("read") === verdict("present"),
      `47i the same 29 layouts measure differently at the two presets: read ${verdict("read")}, present ${verdict("present")}`);

    // (j) THE TWO BLOCKS THAT RAN OFF THE PAGE WHEN THE BAND GOT SHORTER.
    //
    // `layers` and the cards `strip` both size themselves in absolute points
    // against a band that `present` shortens by 54.72pt, and neither had a
    // terminal admission. The layer ladder ended unconditionally at its fifth
    // rung and drew whatever that measured — five bands of cells ran 22pt past
    // the bottom of the page, carrying the "omitted to fit" line with them, so
    // the one sentence saying content had been lost was the content that could
    // not be read. The strip was drawn wherever the cards ended, and the cards
    // have an 80pt floor that wins on a short band.
    //
    // DRIVEN AT THE CAP, at both presets, because both were clean at `read` and
    // both broke at `present`: a capacity cliff is invisible to a fixture that
    // does not reach the cap.
    {
      const stack = (bands: number, cells: number, big: boolean): SlideInput => {
        const ls: any[] = [];
        for (let i = 0; i < bands; i++) {
          const cs: any[] = [];
          for (let c = 0; c < cells; c++) cs.push({ title: `Cell ${c + 1}`, text: "What sits here, at some length." });
          ls.push({ title: `Layer number ${i + 1}`, caption: "A sentence inside the band that runs on.",
            cells: cs.length ? cs : undefined });
        }
        return { layout: "layers", title: big ? LONG : "Layers",
          subtitle: big ? "A standfirst that runs on and explains the stack beneath it." : undefined,
          note: "Why this matters: the stack is the argument.", layers: ls } as any;
      };
      // THE STANDFIRST IS THE INGREDIENT, and it took a sweep to find out. The
      // strip only leaves the page once `cardsH`'s 80pt floor wins, and the
      // floor only wins once the card row starts low enough — which at present
      // means a standfirst of three lines at 14pt. A two-line one leaves the
      // reservation intact and the fixture proves nothing: driven without the
      // bound in place, the first version of this passed.
      const row = (n: number, strip: number): SlideInput => {
        const cards: any[] = [], items: any[] = [];
        for (let i = 0; i < n; i++) cards.push({ marker: `0${i + 1}`, tone: "blue", title: `Move ${i + 1}`,
          body: "What happens here, and what it changes for the team that owns it, and why the board" +
            " should care about it before the quarter closes." });
        for (let i = 0; i < strip; i++) items.push({ title: `Item ${i + 1}`, text: "A short gloss." });
        return { layout: "cards", title: LONG,
          subtitle: "A standfirst that runs on and on and explains the row of cards beneath it in enough" +
            " detail to take three whole lines of the measure.",
          note: "Why this matters: the figures only move once the audience is the unit of planning.",
          cards, strip: { title: "In detail", items } } as any;
      };
      const worst: [string, SlideInput][] = [
        ["layers 5x8 at the cap", stack(5, 8, true)],
        ["layers 5x2", stack(5, 2, false)],
        ["cards 6 + a 6-item strip", row(6, 6)],
        ["cards 5 + a 1-item strip", row(5, 1)],
        ["cards 5 + a 3-item strip", row(5, 3)],
      ];
      for (let pi = 0; pi < PRESETS.length; pi++) {
        for (let w = 0; w < worst.length; w++) {
          const s2 = { ...worst[w][1], density: PRESETS[pi] } as SlideInput;
          const g = validateDeck([s2], `j47${pi}${w}`);
          A47(faultCounts(g)["off-canvas"] === 0,
            `47j ${PRESETS[pi]}: ${worst[w][0]} draws ${faultCounts(g)["off-canvas"]} elements off the canvas` +
            ` — ${g.faults.filter((f) => f.kind === "off-canvas").map((f) => f.note).join("; ").slice(0, 180)}`);
        }
      }
      // AND THE LAYER DIAGRAM SAYS WHAT IT DROPPED. A note-free build passes
      // every geometric check there is, which is exactly why this is asserted
      // on the string.
      const tight = { ...stack(5, 8, true), density: "present" } as SlideInput;
      const said = (buildSlideRequests(tight, 1, "j47") as any[])
        .map((r: any) => String(r.insertText?.text || "")).filter((t: string) => t.indexOf("Showing") === 0);
      const shownBands = (buildSlideRequests(tight, 1, "j47") as any[])
        .filter((r: any) => /_ly[0-9]+$/.test(String(r.createShape?.objectId || ""))).length;
      A47(shownBands < 5,
        `47j precondition: all five bands fitted at present, so the terminal drop is untested`);
      A47(said.length === 1 && /Showing [0-9]+ of 5 layers/.test(said[0]),
        `47j a layer diagram dropped bands to fit and said "${said.join(" / ") || "nothing"}"`);
      // AND THE DROP IS A SAFETY NET, NOT A SECOND OPINION ABOUT THE LAYOUT.
      // A five-band stack that read draws legibly today — past the band floor,
      // into the 7pt gap a chart's source line already borrows, but clear of
      // the footer — keeps all five bands and the admission it always had.
      // Measured against `room` instead, this fixture loses a layer of its
      // argument at the default preset to save seven points, which is the
      // wrong trade and the reason the terminal step reads FOOTER_Y.
      const easy = { ...stack(5, 2, false), density: "read" } as SlideInput;
      const easyReqs = buildSlideRequests(easy, 1, "j47r") as any[];
      A47(easyReqs.filter((r: any) => /_ly[0-9]+$/.test(String(r.createShape?.objectId || ""))).length === 5,
        `47j a five-band stack that read draws today lost a band to the terminal drop`);
      A47(easyReqs.map((r: any) => String(r.insertText?.text || ""))
        .some((t: string) => t.indexOf("Showing names only - ") === 0),
        `47j the read admission is no longer the sentence read decks already carry`);
    }
  }
  if (failures === before47) {
    pass(`the frame lands in empty bands at both presets, the folio renumbers, read is untouched,` +
      ` and the present rhythm is the solve rather than a number`);
  }

  console.log(failures ? `\n${failures} FAILURE(S)\n` : `\nAll checks passed.\n`);
  // 2, not 1, when a self-test detector carried nothing (check 40 b): the
  // check did not fail, it stopped measuring.
  process.exit(deadDetectors ? 2 : failures ? 1 : 0);
})();
