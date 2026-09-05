/**
 * The Content Engine slide brand — the single source of truth for both the
 * Google Slides generator (lib/slides/generate.ts) and the .pptx renderer
 * (the `tce` theme in lib/ai/providers.ts).
 *
 * Extracted 2026-08-18 from the Galderma June 2026 deck and cross-checked
 * against the Dec 2025 EUR proposal and CHF membership decks. Full derivation,
 * including the values deliberately NOT copied, is in docs/tce-slide-brand.md.
 *
 * Why tokens in code rather than a template deck in Drive: the `drive.file`
 * scope only reaches files this app created, so `files.copy` against a shared
 * template returns 404. Copying a master deck is therefore off the table unless
 * we take the restricted `drive` scope. See the doc's decision section.
 *
 * Geometry is in POINTS. The canvas is Google Slides' default 10 × 5.625in, so
 * a generated presentation needs no page resize: 720 × 405pt.
 */

/* ─────────────── Palette ─────────────── */

/** Canonical brand colours. Present identically in all three decks checked.
 *  Do NOT add #3B39FF or #203659 here — both are copy-paste drift that appears
 *  in the source deck but in none of the themes. */
export const COLOR = {
  navy: "023250",        // primary dark; text on light, dark backgrounds, logo colour
  blue: "3950FF",        // primary brand; divider backgrounds, headings, emphasis
  teal: "01EAC8",        // accent (light theme)
  tealSoft: "3FEFD7",    // accent (same role, dark theme)
  periwinkle: "8488FD",
  lime: "C0FF7E",        // the standout callout colour on blue
  coral: "FF6255",
  /** Coral dark enough to carry small text and thin rules. The brand coral is
   *  2.8:1 on off-white, which is below the threshold for both. */
  coralDeep: "C63528",
  forest: "114535",
  greyLight: "EBEBEB",   // light surface; body text ON blue/navy
  lav: "E1E5FF",         // the soft panel fill from the master template
  ink: "272727",
  white: "FFFFFF",
  offWhite: "F8F8F8",    // the actual background of most content slides
  // Pale tints for panelled analysis formats (SWOT quadrants, table rows).
  // Readable with a dark header of the same family — from the validated
  // categorical ramps, not the brand accents, which fail as fills.
  tintTeal:  "E1F5EE", inkTeal:  "0F6E56",
  tintCoral: "FAECE7", inkCoral: "993C1D",
  tintBlue:  "E6F1FB", inkBlue:  "185FA5",
  tintAmber: "FAEEDA", inkAmber: "854F0B",
  tintGrey:  "F1EFE8",
} as const;

export type BrandColor = keyof typeof COLOR;

/** Relative luminance per WCAG, from a brand hex. */
function luminanceOf(hex: string): number {
  const h = hex.replace("#", "");
  const f = (c: number) => (c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4));
  const v = [0, 2, 4].map((i) => f(parseInt(h.substr(i, 2), 16) / 255));
  return 0.2126 * v[0] + 0.7152 * v[1] + 0.0722 * v[2];
}

/** White or navy, whichever actually reads on this ground.
 *
 *  Assuming white was wrong on exactly one of the track colours, and the
 *  assumption was written down as a comment claiming the opposite. */
export function textOn(background: string): string {
  const bg = luminanceOf(background);
  const contrast = (a: number, b: number) => (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
  return contrast(1, bg) >= contrast(luminanceOf(COLOR.navy), bg) ? COLOR.white : COLOR.navy;
}

/** Slides API wants rgbColor floats, not hex. */
export function rgb(hex: string): { red: number; green: number; blue: number } {
  const h = hex.replace("#", "");
  return {
    red: parseInt(h.slice(0, 2), 16) / 255,
    green: parseInt(h.slice(2, 4), 16) / 255,
    blue: parseInt(h.slice(4, 6), 16) / 255,
  };
}

/* ─────────────── Canvas & grid ─────────────── */

const IN = 72; // points per inch

export const CANVAS = { width: 10 * IN, height: 5.625 * IN } as const; // 720 × 405

/**
 * The takeaway bar: a full-width tinted strip along the foot of the slide.
 *
 * The device the source deck uses on nearly every page — "The correction that
 * matters:", "Why this matters:", "Rule of thumb:" — a bold lead-in followed by
 * the sentence that tells the reader what to DO with the slide above it. Our
 * engine had nowhere to put it, so it went into `subtitle` (competing with the
 * standfirst) or into `body` (where it read as one more bullet), and the single
 * most quotable line on the page lost its emphasis.
 *
 * It sits BELOW the content band and above the footer, and it shortens the band
 * rather than overlapping it — see bandHeightFor.
 */
/** Headline figures per slide. Past this a figure stops being a headline
 *  number and the slide wants a table. */
export const STAT_MAX = 8;

/** Four or more figures are a GRID of cards on the light ground; up to three
 *  are the navy hero row. The count decides, not the model — slideStyle() in
 *  generate.ts is where the ground follows it. */
export const STAT_GRID_MIN = 4;

/** The stat card grid, measured from the reference deck's page 3 (1281px =
 *  720pt): 84pt cards in rows of four with 12pt gaps, a short last row
 *  stretched to the full measure, a 24pt figure over an 8pt bold label with
 *  the source pinned at the foot of the card.
 *
 *  `rungs` is the fit ladder: compression before anything is dropped. The
 *  last rung gives up the source lines — declared on the slide — before any
 *  figure goes. */
export const STAT_GRID = {
  perRow: 4,
  gap: 12,
  padX: 8,
  /** A figure never shrinks below this; at 16pt bold Poppins it is still
   *  large text for contrast purposes. */
  valueMin: 16,
  valueLead: 1.3,
  labelLead: 1.1,
  sourceLead: 1.05,
  sourceGap: 2,
  /** The card's edge: navy at 12%, three-quarters of a point. On off-white
   *  the grey tint alone is faint; the border is what makes it a card. */
  borderAlpha: 0.12,
  borderWeight: 0.75,
  rungs: [
    { value: 24, label: 8,   pad: 4, rowGap: 12, sources: true },
    { value: 22, label: 8,   pad: 4, rowGap: 12, sources: true },
    { value: 20, label: 8,   pad: 4, rowGap: 10, sources: true },
    { value: 18, label: 7.5, pad: 3, rowGap: 8,  sources: true },
    { value: 18, label: 7.5, pad: 3, rowGap: 8,  sources: false },
  ],
} as const;

export const NOTE = {
  /** Clear of the footer, which occupies the last 11pt. */
  bottom: 374,
  pad: 9,
  gap: 10,
  minHeight: 26,
  /** Five lines of 8pt plus padding. Was 58 - three lines - and a real deck's
   *  four-sentence takeaways lost their trailing sentences to a silent clip,
   *  which on those slides was usually the punchline. The content band already
   *  gives way by exactly this height, so the only cost is band, not overlap. */
  maxHeight: 82,
  fontSize: 8,
  lineHeight: 11,
} as const;

export const GRID = {
  margin: 0.34 * IN,          // 24.48 — left and right
  contentWidth: 9.32 * IN,    // 671.04
  /* ── THE TITLE BLOCK, MEASURED AGAINST THE SOURCE ────────────────────────
   *
   * These were 1.22in / 1.85in, and a conversion of a real 38-page client
   * deck came back reading emptier than the original at the same word count.
   * Measured rather than argued: our title block consumed 185pt to the source
   * deck's 96, so content began 52% down the slide where the source begins it
   * at 30%. Nothing was wrong with any single layout — every one of them
   * started too low, and the slides that were marginal overflowed into a
   * second slide they did not need.
   *
   * Tightened to start content at ~26% down, which is the source's own
   * proportion. bandHeight grows by the same amount so the band still ends
   * where it did, clear of the footer and the takeaway bar. */
  titleY: 0.8 * IN,           // 57.6
  titleHeight: 0.63 * IN,     // 45.36
  bodyY: 1.44 * IN,           // 103.68
  bodyHeight: 3.22 * IN,      // 231.84 — grown by what bodyY gave back
  /** Foot of the title to the bottom margin. Self-contained blocks — stats, a
   *  bar plot — are centred in this, so five bars sit balanced and eight fill
   *  it. Prose is NOT: bullets centred in the band float away from the title
   *  they belong to, which rendering made obvious and reasoning had not. A
   *  three-bullet slide with dead space wants a picture, not a lower margin. */
  bandHeight: 3.76 * IN,      // 270.7 — band bottom unchanged at ~374

  /** Stops short of the top-right logo (which starts at 8.69in) so a long
   *  eyebrow cannot run underneath it. */
  eyebrowWidth: 8.15 * IN,
  eyebrowY: 0.3 * IN,
  eyebrowHeight: 0.25 * IN,

  /** Cover text sits BOTTOM-LEFT, in the foot of the baked gradient.
   *
   *  The source deck centres it mid-canvas, which works over the flat washes
   *  their designer chose by hand. Over a photograph it does not: the middle is
   *  the brightest, most detailed part of most images, so centring forces a
   *  scrim heavy enough to destroy the picture. Anchoring the text where the
   *  gradient is darkest lets the photograph stay vivid and the words stay
   *  readable, which is the trade the whole layout exists to make. */
  coverTitleX: 0.62 * IN,
  coverTitleWidth: 7.4 * IN,
  coverTitleY: 3.34 * IN,
  coverTitleHeight: 1.35 * IN,
  coverKickerX: 0.64 * IN,
  coverKickerWidth: 7.4 * IN,
  coverKickerY: 4.78 * IN,
  coverKickerHeight: 0.3 * IN,

  /** Closing slide sits higher than the cover, to clear the logo at 4.47in. */
  closingTitleY: 1.85 * IN,
  closingTitleHeight: 1.2 * IN,
  closingSubtitleY: 3.2 * IN,
  closingSubtitleHeight: 0.4 * IN,

  /** A MEASURE for prose. Body copy ran the full 671pt content width — 116
   *  characters of 10pt Roboto on a line, where anything past about 75 stops
   *  being comfortable to read and starts looking like a document. 540pt is
   *  ~94, and 432 is ~75 for the case where a picture takes the rest. */
  proseWidth: 7.5 * IN,       // 540
  proseNarrow: 6.0 * IN,      // 432, when a rail image sits beside it

  /** Columns start below the title band (1.22 + 0.63 = 1.85in). The source
   *  layout's own 1.26in assumes a title higher up the page than ours. */
  columnWidth: 4.37 * IN,     // 314.64
  columnY: 1.44 * IN,         // tracks bodyY
  columnHeight: 3.22 * IN,
  columnLeftX: 0.34 * IN,
  columnRightX: 5.28 * IN,
} as const;

/** The rule under a title on a prose slide.
 *
 *  The measured problem it answers: a content slide carried 12.5% ink and NOT
 *  ONE drawn object — no rule, no panel, no block of colour anywhere on the
 *  canvas. The source deck used 278 rectangles across eighteen slides. A short
 *  accent segment and a hairline is the cheapest honest structure: it says
 *  where the title ends and the argument begins.
 */
export const RULE = {
  accentWidth: 1.0 * IN,
  thickness: 3,
  hairlineThickness: 1,
  hairlineAlpha: 0.22,
  /** Above the body, below the fitted title block. */
  gapAbove: 8,
} as const;

/** The section divider's lockup: kicker, title, subtitle as ONE measured stack,
 *  centred on the canvas as a group.
 *
 *  Measured from the reference deck's dividers (pages 4 and 22, on the 720x405
 *  canvas): kicker at y=143, a two-line title at 164-232, subtitle at 244-254 -
 *  one 111pt block centred at y=199 with 16pt and 13pt of air between its rows.
 *  Ours drew the kicker in the page-header slot at y=36, the title at a fixed
 *  y=152 in a fixed 100pt box and the subtitle at a fixed y=257, so three lines
 *  sat 125pt and 76pt apart and never read as belonging to each other. */
export const SECTION = {
  /** The stack never rises back into the page-header slot it was moved out of. */
  minTop: 48,
  /** Title line spacing as a multiple of Slides' 100%. The 115% default put
   *  46pt between two 32pt lines where the reference's block sits at 38pt.
   *  110% is the TIGHTEST setting at which the drawn box (1.26 x 1.10 = 1.386
   *  of the size per line) still covers the 1.38-per-line ink box the layout
   *  check measures collisions with (check 11), so a three-line title can
   *  never be reported as running onto its subtitle. Tighten this and the gaps
   *  below have to grow to absorb the difference. */
  titleLead: 1.1,
  /** Floor of the fit ladder - the cover's. Below it a divider title is body
   *  copy on a blue field. */
  titleMinSize: 22,
  /** Box-to-box gaps. ZERO on purpose: every text box carries Slides' fixed
   *  3.6pt inset top and bottom, and the title's line box carries ~7pt of
   *  slack above its caps and below its descenders, so butted boxes already
   *  show ~17pt of air between kicker and title and ~15pt between title and
   *  subtitle - the reference's 16 and 13. A gap on top of the insets is what
   *  the old fixed positions were, by 76pt. */
  kickerGap: 0,
  subtitleGap: 0,
  /** The index numeral keeps its slot: GRID.eyebrowY, 100pt tall - exactly
   *  drawnTextHeight(1, 64) at the 115% default. The lockup starts no higher
   *  than its foot. */
  numeralWidth: 252,
  numeralHeight: 100,
} as const;

/* ─────────────── Type ─────────────── */

/** Playfair Display for every heading, Roboto for everything else, Poppins for
 *  big statistics. All three are Google Fonts, so Slides resolves them natively
 *  with no font upload — the main reason this target beats a rendered format.
 *
 *  `weight` is a CSS numeric weight for the Slides API's weightedFontFamily;
 *  Roboto Light is 300, which is the deck's actual body face. */
export interface TypeStyle {
  font: string;
  size: number;
  weight?: number;
  bold?: boolean;
  color: string;
  caps?: boolean;
}

export const TYPE: Record<string, TypeStyle> = {
  /** The documented scale is 30pt for a cover title and 12pt regular for its
   *  kicker (docs/tce-slide-brand.md). Both had drifted — 33pt, and a kicker
   *  that had plainly been copied from the eyebrow token, bold and 11pt and
   *  lime, where lime is scoped to callouts on blue and to the divider
   *  numerals. The one departure we keep is white rather than the source's
   *  #EBEBEB: the baked gradient is solved for white, and anything dimmer lands
   *  under the 4.5:1 the layout check asserts. */
  coverTitle:    { font: "Playfair Display", size: 30, color: COLOR.white },
  coverKicker:   { font: "Roboto", size: 12, color: COLOR.white, caps: true },
  /** The closing sign-off line. White, not the source deck's lime: the closing
   *  ground is a photograph whose baked gradient is solved for WHITE, and lime
   *  (#C0FF7E) is only contrast-guaranteed on solid navy/blue, not on the pale
   *  foot of a gradient. Its own token so this is a decision, not inheritance. */
  closingKicker: { font: "Roboto", size: 12, color: COLOR.white, caps: true },
  /** The action lines on a closing slide — an email, a next step, a URL. */
  closingAction: { font: "Roboto", size: 11, weight: 300, color: COLOR.greyLight },
  /** The divider title. At 26pt on one line it read a third the height of the
   *  reference's two-line 31pt block from the back of the room. Stepped to 32,
   *  one above the 30pt cover, and fitted DOWN to SECTION.titleMinSize by
   *  fitHeading when a long one would push the subtitle onto the takeaway bar.
   *  Weight stays Regular: the brand's display face is Playfair Regular on every
   *  dark ground, and size is what carries to the corridor. */
  sectionTitle:  { font: "Playfair Display", size: 32, color: COLOR.white },
  /** The divider's kicker ("SESSION 1 · 2 HOURS · VIRTUAL"). It now sits INSIDE
   *  the lockup, 16pt above a 32pt title, so it has to read as that title's
   *  label and not as a heading of its own; at the 11pt eyebrow size it
   *  out-weighed the 11.5pt light subtitle under it. The reference sets it at
   *  8.6pt letter-spaced; the Slides API TextStyle has no tracking field, so
   *  9.5pt bold caps is where the same visual weight lands without it. */
  sectionKicker: { font: "Roboto", size: 9.5, bold: true, color: COLOR.white, caps: true },
  /** The big index numeral on a section divider — the source deck's signature
   *  device. Lime on blue clears contrast (11.3:1); on a photo it sits on the
   *  baked gradient's foot, so it is only drawn from a numeric eyebrow where the
   *  divider is the deck's own structural marker. */
  sectionNumeral:{ font: "Playfair Display", size: 64, color: COLOR.lime },
  slideTitle:    { font: "Playfair Display", size: 20, color: COLOR.navy },
  slideTitleDark:{ font: "Playfair Display", size: 20, color: COLOR.white },
  cardHeading:   { font: "Playfair Display", size: 11, color: COLOR.blue },
  eyebrow:       { font: "Roboto", size: 11, bold: true, color: COLOR.navy, caps: true },
  eyebrowDark:   { font: "Roboto", size: 11, bold: true, color: COLOR.white, caps: true },
  label:         { font: "Roboto", size: 10, bold: true, color: COLOR.blue, caps: true },
  body:          { font: "Roboto", size: 10, weight: 300, color: COLOR.navy },
  bodyDark:      { font: "Roboto", size: 10, color: COLOR.white },
  caption:       { font: "Roboto", size: 8, weight: 300, color: COLOR.ink },
  /** The line under the title that says what the slide argues, before the
   *  bullets say how. Two type sizes 2x apart is not a hierarchy — it is a
   *  heading and a footnote. This is the middle step. */
  standfirst:    { font: "Roboto", size: 11.5, weight: 300, color: COLOR.navy },
  /** A two-column comparison header — "Before"/"After", over an accent rule. */
  columnHeader:  { font: "Playfair Display", size: 14, color: COLOR.navy },
  quadHeader:    { font: "Roboto", size: 11, bold: true, color: COLOR.navy, caps: true },
  /** A Venn set's name: bold caps at the reference's 8.6pt. Was Playfair 14,
   *  which only ever fitted OUTSIDE the circles. The layout steps it to 8 when
   *  that is what it takes to keep every label inside (VENN_NAME_SIZES). */
  vennName:      { font: "Roboto", size: 8.5, bold: true, color: COLOR.navy, caps: true },
  /** Its gloss, on the 7.5pt floor at REGULAR weight — Light at this size
   *  thins to nothing on a tint. */
  vennDesc:      { font: "Roboto", size: 7.5, color: COLOR.ink },
  /** The heading of a takeaway drawn as a sidebar callout beside a diagram —
   *  the reference's 10pt bold over 8pt body. */
  noteHead:      { font: "Roboto", size: 10, bold: true, color: COLOR.navy },
  noteHeadDark:  { font: "Roboto", size: 10, bold: true, color: COLOR.white },
  quadItem:      { font: "Roboto", size: 9, weight: 300, color: COLOR.navy },
  axisEnd:       { font: "Roboto", size: 8, bold: true, color: COLOR.ink, caps: true },
  quadLabel:     { font: "Roboto", size: 8, weight: 300, color: COLOR.ink },
  dotLabel:      { font: "Roboto", size: 8, weight: 400, color: COLOR.navy },
  cellText:      { font: "Roboto", size: 9, weight: 300, color: COLOR.navy },
  /** The footer furniture from the master: 8px on the 960 canvas is 6pt here.
   *  The page number is the blue bold detail, lime on dark grounds. */
  footerLeft:    { font: "Roboto", size: 6.5, weight: 300, color: COLOR.ink },
  footerNumber:  { font: "Roboto", size: 6, bold: true, color: COLOR.blue },
  /** One big Playfair sentence: the statement layout. Master sets it a step
   *  above the slide headline; ~34px on the 960 canvas is 25.5pt here. */
  statementTitle:{ font: "Playfair Display", size: 25, color: COLOR.navy },
  statementLead: { font: "Roboto", size: 10, weight: 300, color: COLOR.ink },
  cellHead:      { font: "Roboto", size: 9, bold: true, color: COLOR.white },
  standfirstDark:{ font: "Roboto", size: 11.5, weight: 300, color: COLOR.greyLight },
  statistic:     { font: "Poppins", size: 30, color: COLOR.white },
  source:        { font: "Roboto", size: 7, color: COLOR.ink },
  milestoneDate: { font: "Roboto", size: 9, bold: true, color: COLOR.blue, caps: true },
  milestoneName: { font: "Playfair Display", size: 12, color: COLOR.navy },
  milestoneText: { font: "Roboto", size: 8, weight: 300, color: COLOR.navy },
  trackName:     { font: "Roboto", size: 8, bold: true, color: COLOR.navy, caps: true },
  phaseLabel:    { font: "Roboto", size: 8, bold: true, color: COLOR.navy },
  phaseInBar:    { font: "Roboto", size: 8, color: COLOR.white },
  axisTick:      { font: "Roboto", size: 7, weight: 300, color: COLOR.ink },
  todayLabel:    { font: "Roboto", size: 7, bold: true, color: COLOR.coralDeep, caps: true },
  featureTitle:  { font: "Playfair Display", size: 26, color: COLOR.white },
  featureBody:   { font: "Roboto", size: 11, color: COLOR.greyLight },
  gridCaption:   { font: "Roboto", size: 8, weight: 300, color: COLOR.navy },
  credit:        { font: "Roboto", size: 6, weight: 300, color: COLOR.greyLight },
  /** The same line on a LIGHT ground. The token above is #EBEBEB, which is
   *  invisible on off-white — so an image-split slide could not print the
   *  photographer's name anywhere a reader would find it. */
  creditOnLight: { font: "Roboto", size: 6, weight: 300, color: COLOR.ink },
  statValue:     { font: "Poppins", size: 54, color: COLOR.white },
  statLabel:     { font: "Roboto", size: 10, bold: true, color: COLOR.lime, caps: true },
  statDetail:    { font: "Roboto", size: 9, weight: 300, color: COLOR.greyLight },
  /** The stat CARD (four or more figures, light ground): the reference's
   *  24pt figure / 8pt bold label / 7pt source, with the source held at the
   *  deck's 7.5pt floor. Colours here are the grey card's; a toned card
   *  overrides them from its tone. */
  statCardValue: { font: "Poppins", size: 24, color: COLOR.blue },
  statCardLabel: { font: "Roboto", size: 8, bold: true, color: COLOR.navy },
  statCardSource:{ font: "Roboto", size: 7.5, weight: 300, color: COLOR.ink },
  chartCategory: { font: "Roboto", size: 9, weight: 300, color: COLOR.navy },
  chartValue:    { font: "Roboto", size: 9, bold: true, color: COLOR.navy },
  chartAxis:     { font: "Roboto", size: 7, weight: 300, color: COLOR.ink },
  /** The caps label above a benchmark rule — deep coral, so it reads as the
   *  reference line it marks, not as data. */
  benchmarkLabel:{ font: "Roboto", size: 7, bold: true, color: COLOR.coralDeep, caps: true },
  /** A one-line annotation beside a highlighted bar — the reason for it. */
  calloutText:   { font: "Roboto", size: 8, weight: 300, color: COLOR.coralDeep },
  chartSeries:   { font: "Roboto", size: 8, bold: true, color: COLOR.navy },
  cardMarker:    { font: "Roboto", size: 9, bold: true, color: COLOR.white, caps: true },
  cardTitle:     { font: "Playfair Display", size: 13, color: COLOR.navy },
  cardBody:      { font: "Roboto", size: 9, weight: 300, color: COLOR.navy },
  // Periwinkle, not brand blue: blue on navy is 2.4:1, under even the 3:1 floor
  // for a graphic. The mark has to be seen and must not compete with the words,
  // and periwinkle is accent3 in both themes — the blue family the original
  // choice was reaching for, at 4.4:1. Lightening the navy ground instead was
  // not an option: the change of ground is why this layout exists.
  quoteMark:     { font: "Playfair Display", size: 54, color: COLOR.periwinkle },
  quoteText:     { font: "Playfair Display", size: 22, color: COLOR.white },
  quoteName:     { font: "Roboto", size: 10, bold: true, color: COLOR.lime, caps: true },
  quoteRole:     { font: "Roboto", size: 9, weight: 300, color: COLOR.greyLight },
  /** A step's name on its card: bold, MIXED CASE, navy, 10.5pt - the
   *  reference's own size. Was 9pt white caps centred in a 58pt blue pill,
   *  where the pill was the loudest thing on the slide and the name the
   *  smallest, and the presenter could not say "step three" and point at a 3. */
  stageName:     { font: "Roboto", size: 10.5, bold: true, color: COLOR.navy },
  stageCaption:  { font: "Roboto", size: 8, weight: 300, color: COLOR.navy },
  /** The digit in the step's coloured circle. Its colour is decided per step
   *  by textOn(accent), never read from here. */
  stageNumeral:  { font: "Roboto", size: 8.5, bold: true, color: COLOR.white },
  /** "Owner: TCE + your team", anchored to the card's foot. The reference
   *  sets it at 6.5pt grey; 7.5 is this deck's floor, and ink rather than
   *  navy is the closest the palette has to their secondary grey. */
  stageOwner:    { font: "Roboto", size: 7.5, weight: 300, color: COLOR.ink },
  /** A client's name, set when their mark is not available. Playfair rather
   *  than a picture of a wordmark: it is plainly OUR typography naming them,
   *  not a reproduction of a logo we do not have. */
  logoWallName:  { font: "Playfair Display", size: 13, color: COLOR.navy },
};

/* ─────────────── Logo ─────────────── */

/** The lockup is the dotted-ring "C" mark plus the wordmark, 2.29:1.
 *
 *  NOT public/assets/logo_engine_text_*.png — those are 8.3:1, the wordmark on
 *  its own with no mark. The lockups were extracted from the source deck. */
export const LOGO = {
  aspect: 1076 / 470,
  whitePath: "/assets/logo_engine_lockup_white.png",
  navyPath: "/assets/logo_engine_lockup_navy.png",
} as const;

/** Placement is consistent across the source decks: top-right on content
 *  slides, centred and larger on the cover, centred low on the closing slide.
 *  Section dividers carry no logo at all. */
export const LOGO_PLACEMENT = {
  content: { x: 8.69 * IN, y: 0.19 * IN, width: 1.06 * IN, height: 0.46 * IN },
  cover:   { x: 4.06 * IN, y: 0.77 * IN, width: 1.79 * IN, height: 0.78 * IN },
  closing: { x: 4.32 * IN, y: 4.47 * IN, width: 1.47 * IN, height: 0.57 * IN },
} as const;

const PUBLIC_ORIGIN = "https://ai.thecontentengine.com";

/** createImage needs a publicly fetchable raster URL — Google fetches it from
 *  its own servers, so a relative path or an SVG will not do.
 *
 *  NEXTAUTH_URL is localhost in development, and Slides rejects the whole
 *  batchUpdate with "Localhost image URLs are invalid" — which fails the entire
 *  deck over the logo. Any non-public origin therefore falls back to production,
 *  where these assets are served from `public/assets`. */
export function logoUrl(variant: "white" | "navy"): string {
  const configured = (process.env.NEXTAUTH_URL || "").replace(/\/$/, "");
  const isPublic = /^https:\/\//.test(configured) && !/localhost|127\.0\.0\.1|0\.0\.0\.0/.test(configured);
  const base = isPublic ? configured : PUBLIC_ORIGIN;
  return `${base}${variant === "white" ? LOGO.whitePath : LOGO.navyPath}`;
}

/* ─────────────── Layout archetypes ─────────────── */

export type SlideLayout =
  | "cover"
  | "section"
  | "content"
  | "two-column"
  | "case-study"
  | "dark-index"
  | "timeline"
  | "timeline-parallel"
  | "image-split"
  | "image-grid"
  | "feature"
  | "stat"
  | "bar-chart"
  | "stacked-bar"
  | "line-chart"
  | "swot"
  | "matrix"
  | "comparison"
  | "table"
  | "statement"
  | "layers"
  | "scatter"
  | "venn"
  | "cards"
  | "quote"
  | "process"
  | "logo-wall"
  | "closing";

export const LAYOUTS: SlideLayout[] = [
  "cover", "section", "content", "two-column", "case-study", "dark-index", "timeline", "timeline-parallel", "image-split", "image-grid", "feature", "stat", "bar-chart", "stacked-bar", "line-chart", "swot", "matrix", "comparison", "table", "statement", "scatter", "venn", "cards", "quote", "process", "logo-wall", "layers", "closing",
];

/** Horizontal timeline: an axis rule with evenly spaced milestone markers.
 *
 *  Exists because a timeline drawn as a bullet list is not a timeline. The
 *  text-only layouts could not express one, so the model described a visual it
 *  had no way to produce. */
export const TIMELINE = {
  axisY: 2.85 * IN,
  axisThickness: 2,
  markerSize: 13,
  markerSizeHighlight: 19,
  dateY: 2.25 * IN,      // above the axis
  dateHeight: 0.28 * IN,
  titleY: 3.15 * IN,     // below the axis
  titleHeight: 0.34 * IN,
  detailY: 3.52 * IN,
  detailHeight: 0.95 * IN,
  /** Gutter between adjacent milestone columns, so labels cannot collide. */
  slotGutter: 10,
  /** At six the column is 111.8pt and the label box 101.8pt — about fourteen
   *  characters of 12pt Playfair per line, which is the last count where a
   *  milestone's name and a sentence of detail both stay readable at brand type
   *  size. Past it the name wraps to three lines and runs into the detail
   *  beneath it. The tool schema already asks for three to five. */
  maxMilestones: 6,
  /** The gap between the name and the detail beneath it. */
  bandGap: 2,
} as const;

/** Parallel tracks against ONE shared, date-proportional axis.
 *
 *  The single-track `timeline` spaces milestones evenly by slot, which is right
 *  when a deck is showing sequence. This layout exists for the case that cannot
 *  express: two workstreams running at once, where the point IS that a phase on
 *  one track overlaps a phase on the other. Even spacing would hide exactly the
 *  thing the slide is meant to show, so here position is proportional to real
 *  dates and a bar's width is its actual duration. */
export const TIMELINE_PARALLEL = {
  /** Left column holding the track names. */
  labelGutter: 1.28 * IN,
  /** Below the standfirst, with room for the "Today" label above the band.
   *  At 2.15in the band's label collided with both the title and the subtitle
   *  boxes — invisible with a one-line title, a collision with two. */
  bandY: 2.46 * IN,
  /** One sub-row: a bar plus the breathing room under it. Tracks grow downward
   *  as overlapping phases are packed onto extra rows. */
  rowHeight: 30,
  barHeight: 20,
  trackGap: 20,
  /** Breathing room inside each track's background band. */
  bandPadding: 8,
  axisGap: 0.16 * IN,
  axisThickness: 1,
  tickLabelHeight: 0.24 * IN,
  /** Zero-duration milestones render as a dot rather than a hairline bar. */
  pointSize: 11,
  minBarWidth: 6,
  /** Padding either side of the data range, as a fraction of its span, so the
   *  first and last bars do not touch the plot edges. */
  rangePad: 0.04,
} as const;

/** Photography layouts.
 *
 *  Measured from the source deck: eleven of its eighteen slides are over 30%
 *  image and four are essentially all image. These are the shapes that produce
 *  that, rather than a text slide with a picture added to it. */
export const IMAGE = {
  /** Half-and-half, the split the deck uses most. */
  /** The rail: a picture down the right of a prose slide, bleeding to the
   *  right and bottom edges. Its own token because the crop is baked to this
   *  box's aspect, and a letterboxed rail is worse than none. */
  railGap: 24,
  splitWidth: 4.72 * IN,
  splitTextX: 5.28 * IN,
  splitTextWidth: 4.38 * IN,
  /** Text on a photo starts below the logo band and ends above the credit. */
  overlayTitleY: 3.42 * IN,
  overlayTitleHeight: 1.2 * IN,
  overlayBodyY: 4.66 * IN,
  overlayBodyHeight: 0.5 * IN,
  creditY: 5.3 * IN,
  creditHeight: 0.18 * IN,
  /** Grid of examples — the format galleries. */
  gridY: 1.85 * IN,
  gridHeight: 3.2 * IN,
  gridGap: 0.12 * IN,
  gridCaptionHeight: 0.22 * IN,
} as const;

/** A pull quote. Large, set in the display face, with the speaker beneath. */
export const QUOTE = {
  // The mark sits ABOVE the quote, on the same left edge, rather than beside
  // it. Beside it, a 72pt glyph's box ran into the text box — caught by the
  // layout check on the first run, which is what that check is for.
  markX: 1.35 * IN,
  markY: 1.28 * IN,
  markWidth: 1.0 * IN,
  markHeight: 0.6 * IN,
  textX: 1.35 * IN,
  textWidth: 7.6 * IN,
  textY: 1.98 * IN,
  textHeight: 1.85 * IN,
  attributionY: 4.0 * IN,
  attributionHeight: 0.26 * IN,
  roleY: 4.28 * IN,
  roleHeight: 0.26 * IN,
  /** A portrait, when there is one, sits right of the quote. */
  portrait: { x: 7.9 * IN, y: 1.75 * IN, size: 1.6 * IN },
} as const;

/** Numbered step cards joined left to right.
 *
 *  Card internals are in points, measured off the reference page (p23): a
 *  17pt circle 12pt in from the card's top-left, the name beside it, the
 *  description 6pt under the head, the owner line 10pt off the foot. There
 *  is no `y`, no box height and no caption y any more: the row starts on the
 *  band's top edge and is as tall as its words, and reports where it ends. */
export const PROCESS = {
  /** The rule and chevron that carry the eye from one stage to the next,
   *  drawn on the numerals' centre line so the row reads "1 -> 2 -> 3". */
  connectorWidth: 0.34 * IN,
  connectorThickness: 2,
  chevron: 9,
  /** Card inset: top and sides. */
  pad: 12,
  /** Foot inset, under the owner line. */
  padBottom: 10,
  /** The coloured rule along the card's top edge. */
  accent: 3,
  /** The numeral circle's diameter (reference 17; 18 keeps the digit's line
   *  box inside its inset at the same ratio the cards' marker chip proves). */
  numeral: 18,
  /** Circle to name when the numeral sits ABOVE the name (five cards). */
  numeralGap: 4,
  /** Head block to description. */
  headGap: 6,
  /** Description to the owner slot. */
  ownerGap: 8,
  minHeight: 40,
} as const;

/** Client marks on a clean ground. Never cropped — a cropped logo is a
 *  misused trademark, not a design choice. */
export const LOGO_WALL = {
  y: 1.9 * IN,
  height: 3.0 * IN,
  gap: 0.3 * IN,
  /** Each mark is fitted inside its cell with room around it. */
  inset: 0.12 * IN,
} as const;

/** Repeated blocks across the content band — the deck's most-used device.
 *
 *  One geometry serves what looked like three layouts, because their parts are
 *  optional rather than different: slide 4 is a label chip over body text with
 *  no card behind it, slide 6 is a white card holding a thumbnail and a
 *  caption, slide 12 is a number beside a short description. A card is a
 *  marker, a heading, a body and maybe a picture; which of those are present
 *  decides what it looks like. */
export const CARDS = {
  y: 1.95 * IN,
  height: 2.9 * IN,
  gap: 0.22 * IN,
  padding: 0.18 * IN,
  /** The chip carrying a label or an 01/02/03 marker. */
  markerHeight: 0.26 * IN,
  /** Thumbnail sits at the top of a card, square, full card width. */
  thumbRatio: 1,
  titleGap: 0.1 * IN,
  /** Small enough to sit above a heading rather than compete with it. */
  iconSize: 0.4 * IN,
} as const;

/** Series colours for charts, VALIDATED rather than chosen.
 *
 *  The brand accents fail as a categorical chart palette and are not used here:
 *  #C0FF7E is 1.15:1 against a light slide and #114535 reads grey. They are
 *  display accents for large shapes on blue, not 2px lines on off-white.
 *
 *  These two sets pass all six checks of the dataviz validator — lightness
 *  band, chroma floor, colour-blind separation, normal-vision floor and
 *  contrast — against their respective surfaces, keeping brand blue as series
 *  one. Their ORDER is load-bearing: red beside orange fails CVD separation at
 *  deltaE 1.8, and the same five reordered pass at 13.8. Re-run
 *  scripts/validate_palette.js before touching either. */
export const SERIES_LIGHT = ["3950FF", "B36B00", "00998A", "8E44AD", "D6342A"] as const;
export const SERIES_DARK  = ["6B7BFF", "B87C1C", "1CA48F", "9A70C6", "E8604F"] as const;

/** The Venn diagram, measured against the reference deck's page.
 *
 *  Its 174pt circles sit with centres ~100pt apart, so each set keeps a large
 *  exclusive region and the overlaps are lenses. Ours sat 0.92R apart: the
 *  three-way overlap covered most of each circle and the picture said "these
 *  three are the same thing", the opposite of "three arenas". */
export const VENN = {
  /** Centre-to-centre distance in units of the radius. */
  sep: 1.15,
  /** The largest radius drawn: the reference's R=87 fills the same band. */
  maxR: 92,
  /** PASTEL bases drawn at `alpha`, blue then teal then amber, from the same
   *  families as tintBlue / tintTeal / tintAmber. Fitted from the reference
   *  page, whose seven regions these three reproduce to the unit at 0.6.
   *
   *  Not saturated hues at low alpha. 3950FF/01EAC8/FF6255 at 0.4 stacked to
   *  a centre of #A4A0AC (luminance 0.36, 5.2:1 on navy) that projected as
   *  mud, and the coral read as a warning rather than an arena. The LAST
   *  circle drawn owns 60% of every region it covers, so amber last makes the
   *  centre a warm khaki. */
  fills: ["9DC0E9", "99D7CA", "F2CD9B"],
  alpha: 0.6,
  /** The takeaway as a callout beside the diagram: the reference's 180pt
   *  box, 24pt clear of the circles, 10pt of padding. */
  side: { width: 180, gap: 24, pad: 10 },
  /** Room kept either side of a three-set cluster for labels that radiate
   *  outward when they cannot fit inside. */
  outsideLabel: 150,
} as const;

/** Charts sit in the same body band as prose, so a deck reads consistently. */
export const CHART = {
  plotY: 1.95 * IN,
  plotHeight: 2.75 * IN,
  /** Room for category names down the left of a bar chart. */
  labelGutter: 2.05 * IN,
  barHeight: 22,
  barGap: 10,
  /** Axis and gridlines stay recessive — ink belongs to the data. */
  axisThickness: 1,
  valueGap: 8,
  /** Big numbers, up to three across. */
  statY: 1.9 * IN,
  /** A 54pt figure has a ~75pt line box, so 0.95in put its descender space on
   *  top of the label beneath it. */
  statValueHeight: 1.12 * IN,
  statLabelHeight: 0.3 * IN,
  statDetailHeight: 0.7 * IN,
  statGap: 0.3 * IN,
} as const;

/** One colour per track.
 *
 *  White does NOT sit on all of them: it is 2.95:1 on the coral, which this
 *  file used to claim was full contrast. The label colour is chosen per track
 *  by measurement now — see textOn() — rather than assumed. */
export const TRACK_COLORS = [COLOR.blue, COLOR.navy, COLOR.forest, COLOR.coral] as const;

/** Background and logo treatment per archetype. `background: null` means the
 *  slide expects a full-bleed photograph; we fall back to navy when no image is
 *  supplied, which is the least-bad neutral rather than a white slide. */
export const LAYOUT_STYLE: Record<SlideLayout, {
  background: string | null;
  logo: "white" | "navy" | null;
  logoPlacement: keyof typeof LOGO_PLACEMENT;
  onDark: boolean;
}> = {
  cover:        { background: null,           logo: "white", logoPlacement: "cover",   onDark: true },
  section:      { background: COLOR.blue,     logo: null,    logoPlacement: "content", onDark: true },
  content:      { background: COLOR.offWhite, logo: "navy",  logoPlacement: "content", onDark: false },
  "two-column": { background: COLOR.offWhite, logo: "navy",  logoPlacement: "content", onDark: false },
  "case-study": { background: COLOR.offWhite, logo: "navy",  logoPlacement: "content", onDark: false },
  "dark-index": { background: COLOR.navy,     logo: "white", logoPlacement: "content", onDark: true },
  timeline:     { background: COLOR.offWhite, logo: "navy",  logoPlacement: "content", onDark: false },
  "timeline-parallel": { background: COLOR.offWhite, logo: "navy", logoPlacement: "content", onDark: false },
  "image-split": { background: COLOR.offWhite, logo: "navy",  logoPlacement: "content", onDark: false },
  "image-grid":  { background: COLOR.offWhite, logo: "navy",  logoPlacement: "content", onDark: false },
  // Full-bleed photograph with a scrim — text is always light on it.
  feature:       { background: null,           logo: "white", logoPlacement: "content", onDark: true },
  // The HERO row's ground (one to three figures). Four or more are a card
  // grid on off-white — decided per instance by slideStyle() in generate.ts,
  // which is the only place a stat slide's ground may be read from.
  stat:          { background: COLOR.navy,     logo: "white", logoPlacement: "content", onDark: true },
  "bar-chart":   { background: COLOR.offWhite, logo: "navy",  logoPlacement: "content", onDark: false },
  "stacked-bar": { background: COLOR.offWhite, logo: "navy",  logoPlacement: "content", onDark: false },
  "line-chart":  { background: COLOR.offWhite, logo: "navy",  logoPlacement: "content", onDark: false },
  "swot":        { background: COLOR.offWhite, logo: "navy",  logoPlacement: "content", onDark: false },
  "matrix":      { background: COLOR.offWhite, logo: "navy",  logoPlacement: "content", onDark: false },
  "comparison":  { background: COLOR.offWhite, logo: "navy",  logoPlacement: "content", onDark: false },
  "table":       { background: COLOR.offWhite, logo: "navy",  logoPlacement: "content", onDark: false },
  "statement":   { background: COLOR.offWhite, logo: "navy",  logoPlacement: "content", onDark: false },
  "layers":      { background: COLOR.offWhite, logo: "navy",  logoPlacement: "content", onDark: false },
  "scatter":     { background: COLOR.offWhite, logo: "navy",  logoPlacement: "content", onDark: false },
  "venn":        { background: COLOR.offWhite, logo: "navy",  logoPlacement: "content", onDark: false },
  cards:         { background: COLOR.offWhite, logo: "navy",  logoPlacement: "content", onDark: false },
  // A quote sits on navy: it is a moment of emphasis, and the change of ground
  // is what makes it land as one rather than as another content slide.
  quote:         { background: COLOR.navy,     logo: "white", logoPlacement: "content", onDark: true },
  process:       { background: COLOR.offWhite, logo: "navy",  logoPlacement: "content", onDark: false },
  "logo-wall":   { background: COLOR.white,    logo: "navy",  logoPlacement: "content", onDark: false },
  closing:      { background: null,           logo: "white", logoPlacement: "closing", onDark: true },
};

/** One layout's ground, lockup and ink. Named so a resolver can return it
 *  for a slide whose ground is decided per instance. */
export type LayoutStyle = (typeof LAYOUT_STYLE)[SlideLayout];
