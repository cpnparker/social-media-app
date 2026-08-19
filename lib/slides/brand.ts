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
  forest: "114535",
  greyLight: "EBEBEB",   // light surface; body text ON blue/navy
  ink: "272727",
  white: "FFFFFF",
  offWhite: "F8F8F8",    // the actual background of most content slides
} as const;

export type BrandColor = keyof typeof COLOR;

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

export const GRID = {
  margin: 0.34 * IN,          // 24.48 — left and right
  contentWidth: 9.32 * IN,    // 671.04
  titleY: 1.22 * IN,          // 87.84
  titleHeight: 0.63 * IN,     // 45.36
  bodyY: 1.85 * IN,           // 133.2
  bodyHeight: 2.81 * IN,      // 202.32
  /** Foot of the title to the bottom margin. Self-contained blocks — stats, a
   *  bar plot — are centred in this, so five bars sit balanced and eight fill
   *  it. Prose is NOT: bullets centred in the band float away from the title
   *  they belong to, which rendering made obvious and reasoning had not. A
   *  three-bullet slide with dead space wants a picture, not a lower margin. */
  bandHeight: 3.35 * IN,

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

  /** Columns start below the title band (1.22 + 0.63 = 1.85in). The source
   *  layout's own 1.26in assumes a title higher up the page than ours. */
  columnWidth: 4.37 * IN,     // 314.64
  columnY: 1.85 * IN,
  columnHeight: 2.81 * IN,
  columnLeftX: 0.34 * IN,
  columnRightX: 5.28 * IN,
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
  coverTitle:    { font: "Playfair Display", size: 33, color: COLOR.white },
  coverKicker:   { font: "Roboto", size: 11, bold: true, color: COLOR.lime, caps: true },
  sectionTitle:  { font: "Playfair Display", size: 26, color: COLOR.white },
  slideTitle:    { font: "Playfair Display", size: 20, color: COLOR.navy },
  slideTitleDark:{ font: "Playfair Display", size: 20, color: COLOR.white },
  cardHeading:   { font: "Playfair Display", size: 11, color: COLOR.blue },
  eyebrow:       { font: "Roboto", size: 11, bold: true, color: COLOR.navy, caps: true },
  eyebrowDark:   { font: "Roboto", size: 11, bold: true, color: COLOR.white, caps: true },
  label:         { font: "Roboto", size: 10, bold: true, color: COLOR.blue, caps: true },
  body:          { font: "Roboto", size: 10, weight: 300, color: COLOR.navy },
  bodyDark:      { font: "Roboto", size: 10, color: COLOR.white },
  caption:       { font: "Roboto", size: 8, weight: 300, color: COLOR.ink },
  statistic:     { font: "Poppins", size: 30, color: COLOR.white },
  source:        { font: "Roboto", size: 7, color: COLOR.ink },
  milestoneDate: { font: "Roboto", size: 9, bold: true, color: COLOR.blue, caps: true },
  milestoneName: { font: "Playfair Display", size: 12, color: COLOR.navy },
  milestoneText: { font: "Roboto", size: 8, weight: 300, color: COLOR.navy },
  trackName:     { font: "Roboto", size: 8, bold: true, color: COLOR.navy, caps: true },
  phaseLabel:    { font: "Roboto", size: 8, bold: true, color: COLOR.navy },
  phaseInBar:    { font: "Roboto", size: 8, color: COLOR.white },
  axisTick:      { font: "Roboto", size: 7, weight: 300, color: COLOR.ink },
  todayLabel:    { font: "Roboto", size: 7, bold: true, color: COLOR.coral, caps: true },
  featureTitle:  { font: "Playfair Display", size: 26, color: COLOR.white },
  featureBody:   { font: "Roboto", size: 11, color: COLOR.greyLight },
  gridCaption:   { font: "Roboto", size: 8, weight: 300, color: COLOR.navy },
  credit:        { font: "Roboto", size: 6, weight: 300, color: COLOR.greyLight },
  statValue:     { font: "Poppins", size: 54, color: COLOR.white },
  statLabel:     { font: "Roboto", size: 10, bold: true, color: COLOR.lime, caps: true },
  statDetail:    { font: "Roboto", size: 9, weight: 300, color: COLOR.greyLight },
  chartCategory: { font: "Roboto", size: 9, weight: 300, color: COLOR.navy },
  chartValue:    { font: "Roboto", size: 9, bold: true, color: COLOR.navy },
  chartAxis:     { font: "Roboto", size: 7, weight: 300, color: COLOR.ink },
  chartSeries:   { font: "Roboto", size: 8, bold: true, color: COLOR.navy },
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
  | "closing";

export const LAYOUTS: SlideLayout[] = [
  "cover", "section", "content", "two-column", "case-study", "dark-index", "timeline", "timeline-parallel", "image-split", "image-grid", "feature", "stat", "bar-chart", "stacked-bar", "closing",
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
  statValueHeight: 0.95 * IN,
  statLabelHeight: 0.3 * IN,
  statDetailHeight: 0.7 * IN,
  statGap: 0.3 * IN,
} as const;

/** One colour per track. White text sits on every one of these at full
 *  contrast, which is why the lighter brand accents are not in the list. */
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
  stat:          { background: COLOR.navy,     logo: "white", logoPlacement: "content", onDark: true },
  "bar-chart":   { background: COLOR.offWhite, logo: "navy",  logoPlacement: "content", onDark: false },
  "stacked-bar": { background: COLOR.offWhite, logo: "navy",  logoPlacement: "content", onDark: false },
  closing:      { background: null,           logo: "white", logoPlacement: "closing", onDark: true },
};
