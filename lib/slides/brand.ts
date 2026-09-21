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
 *  in the source deck but in none of the themes.
 *
 *  AND DO NOT ADD #052539 (decided 2026-09-17). It is the body ink on every
 *  content run of the September handover deck, which makes it tempting, and it
 *  is 14.87:1 on off-white against COLOR.navy's 12.56:1 — a difference nobody
 *  can see, on a palette whose recorded failure mode is exactly a near-duplicate
 *  hex nobody could tell from the one above it. Body ink at BOTH densities
 *  stays COLOR.navy. The reason is written here rather than in a commit message
 *  so that the next person reading the handover deck's XML does not have to
 *  work it out again. */
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
  /** The figure's box, as a multiple of the face's natural line height. 1.0
   *  is the tightest that still COVERS the line Slides draws: at 1.3 the box
   *  was 31pt for a 24pt figure whose line box is 37, so every number
   *  overran onto its own label — caught the moment the grid was put through
   *  the shared fixture sweep. */
  valueLead: 1.0,
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

/* ─────────────── Density ─────────────── */

/**
 * ONE geometry, two densities.
 *
 * `read` is this file as it has always been, measured from proposal decks that
 * are READ — a document at arm's length, 10pt body, a 20pt title. `present` is
 * the same brand at the handover deck's scale: a 30pt title in brand blue, 12pt
 * body, a 14pt standfirst. Same margins, same measure, same colours, same
 * layouts. Half the words and one and a half times the type.
 *
 * A SECOND SET OF LAYOUTS WOULD FORK THIS FILE, and a fork is two files that
 * agree until the day somebody fixes one of them. A preset cannot drift from
 * itself: every layout below reads GRID and TYPE, and the preset is what those
 * two answer with.
 *
 * THE PRESET HAS THREE LIVE VERTICAL NUMBERS, not seven. `GRID.titleY`,
 * `GRID.bodyHeight` and `GRID.columnHeight` have no readers anywhere in lib/,
 * app/ or scripts/ — they are read's rhythm written down twice — so they are
 * left as the fixed constants they are rather than carried in here, where four
 * more values could drift from the three that decide anything.
 *
 * WHY 30pt NEEDS A NEW RHYTHM AND NOT A NEW NUMBER. fitHeading never overflows
 * a title; it shrinks until one line fits. So raising the title token on read's
 * rhythm does not overrun anything — it SILENTLY DEMOTES. Driven over the 472
 * corpus titles that use the shared title block, a 30pt base in read's 46.08pt
 * of room draws not one of them at 30: the median lands at 26 and forty-one hit
 * the floor, two points UNDER this preset's own standfirst. The reason is
 * vertical: 267 of those 472 need two lines at 30pt in the column their layout
 * draws them in, and two lines at 30pt need 94.20pt.
 *
 * So `present.bodyY` is solved, not chosen, and it is exact on both binding
 * constraints at once — see the two assertions in check 47, which state them
 * rather than restating the number:
 *
 *   158.40 is the LARGEST bodyY that still holds twelve lines of 12pt body
 *          (the band is then drawnTextHeight(12, 12) to the last bit), and
 *   158.40 is the SMALLEST that clears two lines of a 30pt title above a
 *          title floor set by the frame's top hairline.
 *
 * It costs the band 54.72pt — a fifth — which takes a slide carrying a title, a
 * standfirst and a takeaway bar from thirteen lines of 10pt body to seven of
 * 12pt. That is the "half the words" of the brief, arrived at by measurement.
 */
export type Density = "read" | "present";

/** The foot of the content band, which does NOT move between presets: it is
 *  pinned by NOTE.bottom and the footer, and every point bodyY gains comes out
 *  of the band one for one. Written as the sum rather than as 5.2 * IN because
 *  those are different floats and the difference reaches the request stream. */
export const BAND_BOTTOM = 1.44 * IN + 3.76 * IN;   // 374.4

export interface DensityPreset {
  /** Top of the content band. */
  bodyY: number;
  /** Its height. Derived for `present`; written as read's own expression for
   *  `read`, because the float has to be the one the deck already ships. */
  bandHeight: number;
  /** fitHeading's `minHeight` for the shared title block. It never BINDS at
   *  `present` — height is min(max(need, minHeight), room) and a 30pt line
   *  needs more than this — so it is a clarity value, not a correctness one.
   *  Said out loud anyway, or the next reader finds read's 45.36 in a 30pt
   *  deck and concludes the box is short. */
  titleHeight: number;
  /** The highest the title block may rise. */
  titleMinTop: number;
  /** The floor of the title ladder. At `present` this is read's full
   *  slideTitle, so present's worst title is read's best — and, more to the
   *  point, never the 14pt that IS present's standfirst. */
  titleMinSize: number;
  /** The sizes the title ladder may stop at, largest first, the last being the
   *  floor. Absent, fitHeading steps down a point at a time, which is what
   *  `read` has always done and must keep doing.
   *
   *  `present` gets rungs because an eleven-step ladder from 30 to 20 produces
   *  a deck of titles at 30/29/28/27/26 — differences nobody can see that stop
   *  the deck reading as one system. Measured over the same 472 titles at
   *  room 94.40, [30, 26, 22, 20] and the 1pt step both overrun nothing and
   *  both draw 430 titles at 30; the rungs spend the other 42 on four visible
   *  sizes instead of eleven invisible ones. This file already ladders this
   *  way — STAT_GRID.rungs, VENN_NAME_SIZES, the table body's 10/9/8. */
  titleRungs?: readonly number[];
  /** The type sizes the preset moves. Everything else in TYPE is shared. */
  type: {
    slideTitle: number; slideTitleDark: number;
    body: number; bodyDark: number;
    standfirst: number; standfirstDark: number;
    caption: number;
  };
  /** The slide title's ink on a light ground. The handover deck sets every one
   *  of its titles in brand blue; brand.ts's navy was measured from three other
   *  TCE decks, so this is per-deck rather than per-brand and belongs to the
   *  preset that came from that deck. #3950FF is 5.25:1 on off-white. */
  titleColor: string;
  /** Where the frame's top hairline lands, or null for a preset that has no
   *  room for one. See FRAME. */
  topRuleY: number | null;
}

export const DENSITY: Record<Density, DensityPreset> = {
  read: {
    bodyY: 1.44 * IN,
    bandHeight: 3.76 * IN,
    titleHeight: 0.63 * IN,
    /** The expression the shared title call has always used, moved here
     *  unchanged: six points under the eyebrow's box. Not the literal 45.6,
     *  so that it still tracks the eyebrow if the eyebrow ever moves. */
    get titleMinTop() { return GRID.eyebrowY + GRID.eyebrowHeight + 6; },
    titleMinSize: 14,
    type: {
      slideTitle: 20, slideTitleDark: 20,
      body: 10, bodyDark: 10,
      standfirst: 11.5, standfirstDark: 11.5,
      caption: 8,
    },
    titleColor: COLOR.navy,
    /** NO TOP HAIRLINE ON A READ DECK, and this is arithmetic rather than
     *  taste. A read title box bottoms out at 91.68 and may be as tall as its
     *  room, so its top edge reaches 45.60 — above the logo's own bottom edge
     *  at 46.80, which is the lowest a full-bleed rule could sit and the
     *  highest it could go without striking the lockup. There is no band for
     *  it. The room the top rule needs is bought by `present`'s rhythm, and
     *  read's rhythm may not move: the 618 stored slides are the bar.
     *  Putting it above the logo at y≈12 instead would read as a trim mark
     *  rather than as the rule that closes the chrome band, which is the one
     *  job it has. */
    topRuleY: null,
  },
  present: {
    bodyY: 158.40,
    bandHeight: BAND_BOTTOM - 158.40,
    titleHeight: 50.7,          // drawnTextHeight(1, 30)
    /** Set by the frame's top hairline, not by the eyebrow: the rule lands on
     *  the logo's bottom edge and the title starts a clear 5.2pt beneath it.
     *  IT IS FREE. The same room at read's 45.60 floor needs bodyY 151.80 and
     *  a band of 222.60 — still twelve lines, because twelve lines needs
     *  216.00 whatever is above them. The hairline spends 6.6pt of slack and
     *  not one line of body. */
    get titleMinTop() { return (FRAME.topRuleY as number) + FRAME.topRuleClear; },
    titleMinSize: 20,
    titleRungs: [30, 26, 22, 20],
    type: {
      slideTitle: 30, slideTitleDark: 30,
      body: 12, bodyDark: 12,
      standfirst: 14, standfirstDark: 14,
      /** TYPE.caption has no reader today — the caption-shaped tokens in use
       *  are gridCaption, stageCaption and source. It is carried here so the
       *  preset is the whole scale rather than the part of it that happens to
       *  be wired, and it changes nothing until something draws with it. */
      caption: 9.5,
    },
    titleColor: COLOR.blue,
    get topRuleY() { return FRAME.topRuleY; },
  },
};

/** The preset in force for the build running right now.
 *
 *  Module state, set for the duration of ONE synchronous build and restored in
 *  a finally — the same shape as this file's sibling PROBING flag in
 *  generate.ts, and safe for the same reason: buildSlideRequests awaits
 *  nothing, so no second build can interleave with it. A preset threaded as a
 *  parameter instead would have to reach all 81 readers of GRID.bodyY, which is
 *  a change to every layout in the file to deliver a change to none of them. */
let ACTIVE: Density = "read";

/** READ IS THE DEFAULT AND STAYS THE DEFAULT in this change. Every deck built
 *  before today was built at these numbers, and every deck built after it is
 *  too unless its spec says otherwise. */
export const DEFAULT_DENSITY: Density = "read";

export function density(): DensityPreset { return DENSITY[ACTIVE]; }
export function densityName(): Density { return ACTIVE; }

/** Run `fn` at a density, and put the previous one back whatever happens. */
export function withDensity<T>(name: Density, fn: () => T): T {
  const previous = ACTIVE;
  ACTIVE = DENSITY[name] ? name : DEFAULT_DENSITY;
  try { return fn(); } finally { ACTIVE = previous; }
}

/** A y inside the content band, measured against READ's band and moved onto the
 *  band of the density in force.
 *
 *  Four layouts fix their geometry in absolute points rather than reading
 *  GRID.bodyY: the two timelines, the image grid and the logo wall. Those
 *  numbers were measured off read's rhythm, so at `present` — where bodyY moves
 *  down 54.72pt and the band gives up a fifth — a timeline's date row stays
 *  where it was and a 14pt standfirst is drawn 24pt through it, while the image
 *  grid's first row of cells sits 13pt ABOVE the foot of the title box and
 *  NOTHING REPORTS IT, because those cells are createImage and the overlap
 *  sweep compares text with text.
 *
 *  Shifting the blocks bodily by the delta does not work — the timeline then
 *  ends 2.16pt past the band floor and the image grid 13.32pt off the canvas.
 *  Scaling them ONTO the band does, and it is also the more honest description
 *  of what they are: proportions of the space between the title and the
 *  takeaway bar, which is exactly what they were measured as.
 *
 *  AT READ THIS IS THE IDENTITY, and returns the same float rather than an
 *  equal one, because these numbers reach the emitted request and the whole
 *  regression proof for this stage is that 618 stored slides rebuild to the
 *  same stream.
 *
 *  AND THE SHORT-CIRCUIT IS PROVABLY UNNECESSARY FOR EVERY VALUE THAT USES IT,
 *  which is a finding rather than a reason to delete it. Deleting it was a
 *  mutation and it SURVIVED: searched over 400,000 probes across the band,
 *  there is no y for which bodyY + (y − bodyY) differs from y. It cannot be
 *  otherwise — y and bodyY are within a factor of two, so the subtraction is
 *  exact (Sterbenz) and the addition recovers it. The branch stays because it
 *  states the guarantee the regression proof rests on at the point the
 *  guarantee is made, and costs one comparison; it is not there because a
 *  float was ever observed to move. */
export function onBand(y: number): number {
  const d = density();
  if (d.bodyY === DENSITY.read.bodyY && d.bandHeight === DENSITY.read.bandHeight) return y;
  return d.bodyY + (y - DENSITY.read.bodyY) * (d.bandHeight / DENSITY.read.bandHeight);
}

/** The same for a height that is a CONTAINER — a grid of pictures, a band of
 *  detail — rather than a line box. A box holding one line of 9pt type may not
 *  be scaled: the band shrinks and the type does not. */
export function bandScaled(h: number): number {
  const d = density();
  if (d.bandHeight === DENSITY.read.bandHeight) return h;
  return h * (d.bandHeight / DENSITY.read.bandHeight);
}

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
  /** NO READERS, anywhere in lib/, app/ or scripts/ — checked, not assumed.
   *  Left as read's own constants rather than carried into the density preset:
   *  a value nothing reads cannot be wrong, but a preset copy of it can
   *  disagree with the three values that decide the rhythm. */
  titleY: 0.8 * IN,           // 57.6
  bodyHeight: 3.22 * IN,      // 231.84 — grown by what bodyY gave back

  /* ── THE THREE NUMBERS THE DENSITY PRESET MOVES ──────────────────────────
   *
   * Accessors, not constants, so that all 81 readers of GRID.bodyY below and
   * throughout generate.ts go on reading `GRID.bodyY` and get the rhythm of
   * the deck being built. At the default preset they answer exactly what they
   * answered before — read's `bandHeight` is still literally `3.76 * IN`,
   * because the sum 1.44 * IN + 3.76 * IN and 5.2 * IN are different floats
   * and the difference reaches the emitted request. */
  get titleHeight() { return density().titleHeight; },     // read 45.36
  get bodyY() { return density().bodyY; },                 // read 103.68
  /** Foot of the title to the bottom margin. Self-contained blocks — stats, a
   *  bar plot — are centred in this, so five bars sit balanced and eight fill
   *  it. Prose is NOT: bullets centred in the band float away from the title
   *  they belong to, which rendering made obvious and reasoning had not. A
   *  three-bullet slide with dead space wants a picture, not a lower margin. */
  get bandHeight() { return density().bandHeight; },       // read 270.72

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
  get columnY() { return density().bodyY; },   // tracks bodyY, and now says so
  columnHeight: 3.22 * IN,
  columnLeftX: 0.34 * IN,
  columnRightX: 5.28 * IN,
} as const;

/* ─────────────── The prose column band, for n columns ─────────────── */

/** The gutter between two prose columns, read off the pair rather than
 *  written down a fourth time: 41.04, and the only place it exists. */
const COLUMN_GUTTER = GRID.columnRightX - (GRID.columnLeftX + GRID.columnWidth);

/** The band those two columns span, likewise read off them: 670.32, which is
 *  NOT `GRID.contentWidth`. The pair was written in inches and 4.37 + 0.57 +
 *  4.37 is 9.31, a hundredth of an inch inside the 9.32in measure, so the
 *  right column stops 0.72pt short of the right margin. */
const COLUMN_BAND_WIDTH = GRID.columnRightX + GRID.columnWidth - GRID.columnLeftX;

/** n prose columns across a band, as an EQUAL partition.
 *
 *  The column geometry was three constants and exactly two slots. The
 *  three-column band needs three, the photo-rail needs two inside a band the
 *  picture has already taken a third of, and the composition engine needs n —
 *  so it is solved here instead of written down, and every caller asks for the
 *  count it wants.
 *
 *  AT n = 2 IT IS THE INHERITED PAIR, to the float, and that is the point
 *  rather than a coincidence: 618 stored slides are drawn on those three
 *  numbers and the bar for this stage is that none of them moves. The band and
 *  the gutter are derived from the constants above, so the arithmetic at n = 2
 *  is the identity — an equal partition of `GRID.contentWidth` instead would
 *  have widened both columns by 0.36pt and moved the right one, on every
 *  two-column slide in the corpus, for a tidier-looking formula.
 *
 *  THE SOURCE'S OWN THREE-COLUMN GUTTERS ARE 30.24 AND 53.28 — hand-set, and
 *  unequal by 23pt between columns about 180pt wide. That is a slip rather
 *  than a grid: reproducing the deck exactly would reproduce it, so the
 *  gutters are solved equal and the source's arithmetic is not copied.
 */
export function columnBand(
  n: number,
  band: { x: number; width: number } = { x: GRID.columnLeftX, width: COLUMN_BAND_WIDTH },
  gutter: number = COLUMN_GUTTER
): { x: number[]; width: number; gutter: number } {
  const cols = Math.max(1, Math.round(n));
  const width = (band.width - gutter * (cols - 1)) / cols;
  const x: number[] = [];
  for (let i = 0; i < cols; i++) x.push(band.x + i * (width + gutter));
  return { x, width, gutter };
}

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
  /* ── THE SEVEN TOKENS THE DENSITY PRESET MOVES ───────────────────────────
   *
   * Accessors for the same reason GRID's three are: every layout goes on
   * reading TYPE.body, and gets the body of the deck being built. At the
   * default preset each one answers exactly the object it always did.
   *
   * The title's COLOUR moves with its size on the light ground only. Every
   * title in the handover deck is brand blue and brand.ts's navy was measured
   * from three other TCE decks, so the blue is this deck's rather than the
   * brand's — which makes it a preset value and not a token change. On a dark
   * ground the title stays white in both presets: that is a contrast decision,
   * not a density one. */
  get slideTitle()     { return { font: "Playfair Display", size: density().type.slideTitle, color: density().titleColor }; },
  get slideTitleDark() { return { font: "Playfair Display", size: density().type.slideTitleDark, color: COLOR.white }; },
  cardHeading:   { font: "Playfair Display", size: 11, color: COLOR.blue },
  eyebrow:       { font: "Roboto", size: 11, bold: true, color: COLOR.navy, caps: true },
  eyebrowDark:   { font: "Roboto", size: 11, bold: true, color: COLOR.white, caps: true },
  label:         { font: "Roboto", size: 10, bold: true, color: COLOR.blue, caps: true },
  get body()     { return { font: "Roboto", size: density().type.body, weight: 300, color: COLOR.navy }; },
  get bodyDark() { return { font: "Roboto", size: density().type.bodyDark, color: COLOR.white }; },
  get caption()  { return { font: "Roboto", size: density().type.caption, weight: 300, color: COLOR.ink }; },
  /** The line under the title that says what the slide argues, before the
   *  bullets say how. Two type sizes 2x apart is not a hierarchy — it is a
   *  heading and a footnote. This is the middle step. */
  get standfirst() { return { font: "Roboto", size: density().type.standfirst, weight: 300, color: COLOR.navy }; },
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
  /** THE SAME HEADING, ON THE PAGE'S OWN GROUND. `cellHead` is white because
   *  the table draws a navy band behind its column names. `comparison` draws no
   *  band, and for one release it used the same token: three column headings
   *  set in white on #F8F8F8 at 1.05:1, invisible at both presets, so the slide
   *  lost the names of the three things it was comparing and the ticks and
   *  crosses were left arguing about unlabelled columns. An ink is only ever
   *  right for a GROUND, which is why the two are separate tokens rather than
   *  one token and a memory. Caps, because with no band behind them the
   *  headings need some other way to read as headings. */
  cellHeadLight: { font: "Roboto", size: 9, bold: true, color: COLOR.navy, caps: true },
  get standfirstDark() { return { font: "Roboto", size: density().type.standfirstDark, weight: 300, color: COLOR.greyLight }; },
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
  /** THE CAPTION UNDER A FIGURE, and NOT in the lime.
   *
   *  Lime on this layout means one thing: the figure that matters. It is what
   *  `primary` puts on one of three numbers so the eye lands on it. Setting all
   *  three CAPTIONS in the same lime spent that meaning three times on the same
   *  slide — the colour said "this is the number" and "this is a label" at
   *  once, and the accent stopped accenting anything. The light grey is the
   *  deck's own second voice on navy, at 10:1, and the caps and the weight are
   *  what separate a label from the source line under it. */
  statLabel:     { font: "Roboto", size: 10, bold: true, color: COLOR.greyLight, caps: true },
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
  /** THE BENCHMARK IS A REFERENCE, NOT AN ALARM. It was set in the deep coral,
   *  which is in the palette but is the deck's only WARNING colour — so a
   *  chart's two most important annotations, the rule and the callout, read as
   *  errors on a slide where nothing was wrong. A reference line's job is to
   *  give every bar something to be measured against and then recede; the navy
   *  is the deck's own quiet voice and it is what the axis and the source line
   *  already speak in. */
  benchmarkLabel:{ font: "Roboto", size: 7, bold: true, color: COLOR.navy, caps: true },
  /** A one-line annotation beside a highlighted bar — the reason for it. */
  /** The one line that says what the highlighted bar MEANS. It takes the
   *  accent the highlighted bar is drawn in — see calloutInkFor — so the eye
   *  joins the sentence to the bar rather than reading it as a warning about
   *  it. Navy is the fallback on a chart with no highlight. */
  calloutText:   { font: "Roboto", size: 8, weight: 300, color: COLOR.navy },
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
  /** The name UNDER a mark, as against the name INSTEAD of one. Set as a
   *  caption, in the same grey as every other caption in the deck, so it
   *  identifies the mark without competing with it. */
  logoWallCaption: { font: "Roboto", size: 8, weight: 300, color: COLOR.ink },
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

/* ─────────────── The deck frame ─────────────── */

/**
 * The furniture that belongs to every page rather than to one layout.
 *
 * `slideMaster1.xml` in the handover deck puts four things on every slide and
 * no slide turns them off: a paper-texture picture bled to the page, two
 * full-bleed hairlines, a running head and a page number. We drew a flat
 * off-white and one footer line. This is the difference, and it is most of why
 * seven slides of one layout in that deck do not read as seven of the same
 * slide.
 *
 * THE HAIRLINE IS A RECT, NOT AN ASSET (decided 2026-09-17). The deck's own
 * hairline is a 1920x101 PNG with exactly one opaque row of flat #707070 — a
 * rectangle drawn the long way round, because PowerPoint made that easy.
 * A filled rect is identical on screen, costs no fetch, and keeps preview
 * parity free: preview-model.ts already knows rects, while every image is one
 * more thing to get right. (The ARC of stage 4 stays an image: Slides has an
 * ARC shape, the preview knows four kinds, and an arc is not one of them.)
 *
 * THE RUNNING HEAD IS ALREADY DRAWN. stampFooter writes "The Content Engine ·
 * <deck title>" onto every slide and the footer prints it at FOOTER_Y. Moving
 * it to the source deck's position at the TOP of the page would push the
 * eyebrow down with it and take the title floor to ~66, which costs another
 * ~14pt of band and a bullet on every prose slide in the deck. It stays at the
 * foot; the frame adds the number at the other end of the same line.
 */
export const FRAME = {
  /** The hairline's ink on a light ground — the deck's own #707070, 4.66:1 on
   *  off-white, which is fine for a rule and would also be fine for text. */
  rule: "707070",
  /** And on a dark one, where #707070 on navy is a rule you cannot see. */
  ruleOnDark: COLOR.greyLight,
  /** Alpha for the dark-ground rule: at full strength #EBEBEB on navy is a
   *  stripe rather than a hairline. */
  ruleOnDarkAlpha: 0.45,
  thickness: 1,

  /** THE TOP RULE SITS ON THE LOGO'S OWN BOTTOM EDGE, which is the highest a
   *  full-bleed rule can go without striking the lockup. Derived rather than
   *  written down as 46.8, so it follows the lockup if the lockup moves.
   *
   *  The source deck puts its top rule at y=28.9. That is unreachable here:
   *  the lockup occupies 13.68 to 46.80 and the eyebrow's ink reaches 44.75,
   *  and both of those are ours rather than theirs. */
  get topRuleY() { return LOGO_PLACEMENT.content.y + LOGO_PLACEMENT.content.height; },
  /** Air between the rule and the top of the title block. This is what sets
   *  DENSITY.present.titleMinTop, and it is the whole reason present's rhythm
   *  is solved at 158.40 rather than at 151.80. */
  topRuleClear: 5.2,

  /** The bottom rule, at the source deck's own glyph position: 1.6pt below the
   *  takeaway bar's floor (NOTE.bottom, 374), 5pt above the footer's box
   *  (FOOTER_Y, 381), in a gap that already existed at BOTH presets. It costs
   *  the rhythm nothing, which is why both presets carry it and only `present`
   *  carries the top one. */
  bottomRuleY: 376,
  /** THE AIR A DRAWN BLOCK LEAVES ABOVE THE FOOTER'S RULE.
   *
   *  The frame is furniture: it does not move for content, so content stops
   *  above it. Floored on the page margin instead, three layouts ran into the
   *  hairline at once — a venn's bottom circle was tangent to it at `read` and
   *  cut flat by it at `present`, the two lower swot panels had no bottom edge
   *  of their own, and a matrix drew its axis labels straight through it. A
   *  rule touching a shape reads as a clipped shape. */
  contentGap: 8,

  /** The paper ground, as a stretched picture fill on the page rather than as
   *  an element: a background cannot be selected, nudged or reordered in
   *  Drive, and it adds nothing for validate.ts, pathOf or droppedContent to
   *  walk. Light grounds only — the sheet is near-white, and a near-white
   *  texture under navy is not a texture, it is a missing background.
   *
   *  1024px at q68 and 47KB (decided 2026-09-17). Measured pixel by pixel on
   *  the shipped file: luminance 205-255, mean 247.3 — grain on near-white —
   *  so the 1.8MB source PNG is 1.8MB of nothing anyone can see, and this is a
   *  background on EVERY slide, which makes weight the thing that matters. */
  paperPath: "/assets/deck_paper_ground.jpg",

  /** THE PAGE NUMBER, and the slot the footer line gives up for it.
   *
   *  generate.ts deliberately drew no number, on the grounds that a static
   *  number lies the moment somebody merges two slides by hand. That objection
   *  is answered the same way the plan answers it for the stepper, and the
   *  footer already lives under the same contract: the number is the BUILDER's
   *  (`index + 1`), never the model's, and every route — draft, preview, PDF,
   *  publish, and every edit through applyEditSlide — rebuilds the whole deck
   *  through buildSlideRequests with fresh indices, so it renumbers. It can
   *  only be wrong if somebody edits in Drive, which is exactly what is true
   *  of the deck title beside it.
   *
   *  The slot is TAKEN OUT OF THE FOOTER'S BOX rather than laid over it. The
   *  footer box spans the whole content width, so a number box on the same
   *  line would overlap it on every slide in the deck — 618 box overlaps that
   *  the geometry check would be right to report and that nobody should have
   *  to learn to ignore. Two ends of one line, each with its own box. */
  numberWidth: 24,
  numberGap: 8,
} as const;

/**
 * THE STEPPER: where this slide sits in the deck's own spine, as a rail of
 * numerals along the top of the page.
 *
 * "Seven things" is a promise made on a cover. On slide 6 of a run of visually
 * similar pages the title answers *what is this* and nothing answers *where am
 * I, how much is left*. The greyed numerals answer both in one line — a
 * progress bar and a contents page at once — and they give the presenter a
 * handle, so they can say "number four" and the room can point at a 4. It is
 * the reason a deck can afford to draw one layout seven times.
 *
 * IT TAKES THE RIGHT END OF THE EYEBROW'S LINE, which is the same contract the
 * footer already has: one discreet line with two ends, the running head at the
 * left and the folio at the right. The source deck sets its stepper as one
 * right-aligned paragraph clustered top-right and can afford the whole band,
 * because it has no lockup up there and no eyebrow. We have both. So the rail
 * ends where the eyebrow's box already ends — 14.4pt clear of the lockup, a
 * distance that was chosen for exactly this reason once already — and the
 * eyebrow gives up precisely the room the rail measures, and not a point more.
 *
 * AND IT IS SET AT CHROME SIZE, not at the source's 21pt. There the numerals
 * ARE the top band. Here they share a line with an 11pt eyebrow, and a 21pt
 * numeral beside an 11pt label is not a hierarchy, it is a collision with room
 * left over. One point above the eyebrow is what says "this is the more
 * structural of the two" without taking the page over.
 */
export const STEPPER = {
  /** Roboto, one point up from the eyebrow's 11. */
  size: 12,
  /** Between numerals. Three spaces is the source's own tracking; the Slides
   *  API TextStyle has no letter-spacing field, so spaces are the only tracking
   *  there is. */
  separator: "   ",
  /** The steps the rail may hold.
   *
   *  THE FLOOR IS A FLOOR ON RESOLUTION, not on arithmetic, and that is worth
   *  saying because the measurement argues the other way at first glance:
   *  eleven of the largest decks in the stored corpus — 29 to 41 slides — have
   *  exactly TWO section dividers, and a floor of two would give every one of
   *  them a rail. It would be a rail that answers "how much is left" with
   *  "somewhere in this half", which is the question it exists to answer and
   *  not an answer to it. A step has to be a step the reader can be located
   *  in. Below three there is nothing to locate.
   *
   *  ABOVE NINE it stops being a SHAPE the eye takes in at a glance and becomes
   *  a number to read — and at ten the rail is 154pt of a 587pt line, which is
   *  a third of the eyebrow's measure spent on chrome.
   *
   *  Measured over the 618 stored slides: nine of thirty-seven decks draw a
   *  rail, three of them from three or four section dividers (23, 28 and 32
   *  slides — the substantial client work) and six from a body run of three to
   *  nine things. Whether two chapters should earn a coarse rail is the first
   *  thing to revisit here, and it wants a render rather than an argument. */
  minSteps: 3,
  maxSteps: 9,
  /** The step you are not on.
   *
   *  #8F8F8F, not the source deck's #B7B7B7. That grey is 1.89:1 on off-white
   *  and fails even the 3:1 floor this file holds large text to; it is a defect
   *  in the source, not a design choice, and the same reasoning already threw
   *  out its #FFD966 pill label. #8F8F8F is the lightest grey that clears 3:1
   *  (3.05 on off-white, 3.23 on white) and it happens to clear it on navy too,
   *  at 4.12 — so one grey serves both grounds the frame is designed for. */
  inactive: "8F8F8F",
  /** The step you are on: brand blue, bold, on a light ground. On a dark one it
   *  is lime, which is the same choice the folio makes and for the same reason
   *  — blue on navy is 2.39:1. */
  get active() { return COLOR.blue; },
  get activeOnDark() { return COLOR.lime; },
  /** Air between the eyebrow's box and the rail's. */
  gutter: 18,
} as const;

const PUBLIC_ORIGIN = "https://ai.thecontentengine.com";

/** createImage needs a publicly fetchable raster URL — Google fetches it from
 *  its own servers, so a relative path or an SVG will not do.
 *
 *  NEXTAUTH_URL is localhost in development, and Slides rejects the whole
 *  batchUpdate with "Localhost image URLs are invalid" — which fails the entire
 *  deck over the logo. Any non-public origin therefore falls back to production,
 *  where these assets are served from `public/assets`. */
export function assetUrl(path: string): string {
  const configured = (process.env.NEXTAUTH_URL || "").replace(/\/$/, "");
  const isPublic = /^https:\/\//.test(configured) && !/localhost|127\.0\.0\.1|0\.0\.0\.0/.test(configured);
  const base = isPublic ? configured : PUBLIC_ORIGIN;
  return `${base}${path}`;
}

export function logoUrl(variant: "white" | "navy"): string {
  return assetUrl(variant === "white" ? LOGO.whitePath : LOGO.navyPath);
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
  | "hub"
  | "scatter"
  | "venn"
  | "cards"
  | "quote"
  | "process"
  | "logo-wall"
  | "photo-rail"
  | "three-column"
  | "serpentine"
  | "closing";

export const LAYOUTS: SlideLayout[] = [
  "cover", "section", "content", "two-column", "case-study", "dark-index", "timeline", "timeline-parallel", "image-split", "image-grid", "feature", "stat", "bar-chart", "stacked-bar", "line-chart", "swot", "matrix", "comparison", "table", "statement", "scatter", "venn", "cards", "quote", "process", "logo-wall", "layers", "hub", "photo-rail", "three-column", "serpentine", "closing",
];

/** Horizontal timeline: an axis rule with evenly spaced milestone markers.
 *
 *  Exists because a timeline drawn as a bullet list is not a timeline. The
 *  text-only layouts could not express one, so the model described a visual it
 *  had no way to produce. */
export const TIMELINE = {
  /* THE WHOLE STACK IS A PROPORTION OF THE BAND, not a set of absolute points.
   * It always was — these numbers were measured off a slide whose band ran
   * 103.68 to 374.40 — and writing them down as inches hid it until a second
   * density asked the question. Only the row POSITIONS and the detail
   * CONTAINER scale; the three label heights hold one line each of type the
   * preset does not move, so scaling them would shrink the box under its own
   * ink. */
  get axisY() { return onBand(2.85 * IN); },
  axisThickness: 2,
  markerSize: 13,
  markerSizeHighlight: 19,
  get dateY() { return onBand(2.25 * IN); },      // above the axis
  dateHeight: 0.28 * IN,
  get titleY() { return onBand(3.15 * IN); },     // below the axis
  titleHeight: 0.34 * IN,
  get detailY() { return onBand(3.52 * IN); },
  get detailHeight() { return bandScaled(0.95 * IN); },
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
  get bandY() { return onBand(2.46 * IN); },
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
  get gridY() { return onBand(1.85 * IN); },
  get gridHeight() { return bandScaled(3.2 * IN); },
  gridGap: 0.12 * IN,
  gridCaptionHeight: 0.22 * IN,
} as const;

/** THE PHOTO RAIL: a portrait picture INSET down the left of a prose page.
 *
 *  The handover deck's workhorse — four of its ten slides — and the one shape
 *  `image-split` cannot express. image-split bleeds its picture off the LEFT
 *  trim and gives the words ONE half-width column; this insets the picture
 *  inside the margin and gives them TWO, which is a different page and not a
 *  bigger version of the same one.
 *
 *  INSET RATHER THAN BLED, AND THAT IS WHAT BUYS THE CHROME BACK. A bleeding
 *  picture takes the page's furniture with it: image-split moves the rules and
 *  the running head into the type column and takes no stepper at all, because
 *  a 6pt grey line over an unknown photograph is legible on a pale tower and
 *  invisible on a dark one. A picture held inside the margins leaves both
 *  hairlines, the running head, the folio AND the stepper rail exactly where
 *  they are on every other paper page — so the deck's most-used layout is also
 *  the one that says where you are.
 *
 *  THE PICTURE IS PAGE FURNITURE, NOT BAND CONTENT. It hangs between the
 *  frame's two hairlines and clears each by the frame's own token, so it is
 *  the same box at both presets. A picture that shrank at `present` would
 *  re-crop and re-upload on a preset change and hand the text a different
 *  measure on the same deck — the density moves the TYPE's rhythm, and a
 *  photograph is not type.
 */
export const PHOTO_RAIL = {
  /** The crop, measured off the source: 226.8 x 308.16pt, a portrait cut hard
   *  out of landscape originals. Ours keeps the RATIO and takes its height
   *  from the page, which lands within 6pt of the source's own width. */
  aspect: 0.736,
  /** Under the top hairline by the clearance the title block already uses. */
  get top() { return FRAME.topRuleY + FRAME.topRuleClear; },
  /** And above the bottom one by the air the frame demands of any drawn block:
   *  a rule touching a photograph reads as a photograph somebody cropped. */
  get bottom() { return FRAME.bottomRuleY - FRAME.contentGap; },
  get height() { return PHOTO_RAIL.bottom - PHOTO_RAIL.top; },
  get width() { return PHOTO_RAIL.height * PHOTO_RAIL.aspect; },
  /** Picture to type. The source sets 18pt between the trim and its title and
   *  38.88 between the trim and its first body column — the two do not agree,
   *  which is the same hand-set-not-solved slip its three-column gutters have.
   *  One gutter, and it is the rail's own, so a photograph inset here and one
   *  bled on `content` hold the words off by the same distance. */
  get gutter() { return IMAGE.railGap; },
  /** The band left for the words once the picture and its gutter are paid. */
  get textX() { return GRID.margin + PHOTO_RAIL.width + PHOTO_RAIL.gutter; },
  get textWidth() { return GRID.margin + GRID.contentWidth - PHOTO_RAIL.textX; },
} as const;

/** THE SERPENTINE: numbered steps on one rule, captions alternating above and
 *  below it.
 *
 *  `process` caps at five because a sixth card is 100pt wide with a two-word
 *  caption in it, and the handover deck's own process slide has SEVEN steps.
 *  The alternation is not decoration — it is the whole mechanism. Two captions
 *  on the same side of the rule are TWO pitches apart, so a caption may be
 *  twice as wide as the step it belongs to, and seven steps get the measure
 *  five cards get.
 *
 *  THE PITCH IS SOLVED, NOT COPIED. The source's seven centres run 109.44 to
 *  609.84 at a pitch of 83.4, even to within 1.4pt — which says it was meant
 *  to be even and set by hand. Both constraints bind at once: a caption is
 *  `2 * pitch - gutter` wide, and the last caption's outer edge lands on the
 *  right margin, so `pitch = (contentWidth + gutter) / (n + 1)`. At n = 7 that
 *  is 85.13 against the source's 83.4, and centres of 104.61 to 615.39 against
 *  its 109.44 to 609.84.
 */
export const SERPENTINE = {
  /** Seven is the source's, eight is where a caption is back to the width a
   *  process card gets and the layout stops earning its keep. */
  maxSteps: 8,
  /** Under three there is no alternation to see and `process` draws a better
   *  slide: three cards with owners beat three discs on a rule. */
  minSteps: 3,
  /** The numbered disc (0.44in in the source), and the numeral inside it. */
  disc: 31.68,
  numeralSize: 17,
  /** Air between the disc's edge and the caption above or below it. */
  capGap: 8,
  /** Gutter between two captions on the SAME side of the rule — the sibling of
   *  TIMELINE.slotGutter, which does the same job on a layout where every
   *  label is on one side and the slot is therefore the pitch. */
  gutter: 10,
  /** A caption may be two pitches wide, but not wider than a measure anyone
   *  wants to read: 187.2 is about 41 characters of 9pt Roboto. Past this the
   *  pitch is re-solved so the run still ends on the right margin. */
  captionMax: 2.6 * IN,
  captionSize: 9,
  /** How the run is split about the rule when the captions do not decide it.
   *  The source gives its above band 86pt and its below band 119 — the slide
   *  reads downward, so the deeper half is the lower one. */
  aboveShare: 0.42,
} as const;

/** A SCREENSHOT, which is not a photograph.
 *
 *  A UI capture dropped into a branded deck reads as pasted rather than
 *  designed, and the two devices that fix it are the same one: a mat and a
 *  hairline round the picture so it sits ON the page instead of covering it,
 *  and a numbered pin so a slide can POINT at a control and explain it. There
 *  was no way to say "this thing here, on the screen" at all — the model
 *  described the interface in prose beside a picture of it, and the reader had
 *  to match the two by eye.
 *
 *  Never a scrim: a gradient over an interface destroys the very thing the
 *  slide is pointing at, which is why a screenshot on `feature` gets its own
 *  ground (FEATURE_SHOT_STYLE) rather than the full bleed the layout assumes. */
export const SHOT = {
  /** The pin ON the picture. 22pt is ~3% of the canvas width: findable from
   *  the back of a room, small enough to cover a control and not a panel. */
  pin: 22,
  /** The same object beside its words, in the list and the legend. */
  chip: 16,
  /** Ring widths as FRACTIONS of the diameter, so both sizes read as one
   *  object. Navy outside, white inside, brand blue in the middle.
   *
   *  THREE discs rather than one, and measured rather than assumed. Sweeping
   *  every possible ground luminance, white alone drops under 3:1 above
   *  Lg=0.30 and navy alone drops under 3:1 below Lg=0.19 — and those two
   *  conditions cannot both hold, so the ring PAIR never falls below 3.66:1
   *  whatever is underneath. A bare blue disc bottoms out at 1.00:1 at
   *  Lg=0.138, which is the luminance of brand blue itself: the pin would
   *  vanish on a screenshot of our own product's primary button. */
  ringOuter: 0.07,
  ringInner: 0.09,
  numeral: 9,          // on the pin
  chipNumeral: 7.5,    // in the list and the legend
  /** The mat behind the picture, and the hairline on its very edge. */
  pad: 10,
  keyline: 1,
  /** CHEBYSHEV separation between pin centres. Euclidean is the wrong metric:
   *  two square numeral boxes 22.6pt apart at 45 degrees still overlap in both
   *  axes, and the overlap check fails on any overlap at all. */
  separation: 23,      // pin + 1
  max: 5,
  rowGap: 9,           // between numbered rows in the list
  chipGap: 7,          // chip to its words
  legendGap: 14,
  /** The smallest a feature stage is allowed to be before the slide stops
   *  being a slide about a screenshot.
   *
   *  The picture is the CONTENT here, so it is the one thing that does not
   *  give way: the body's box is measured as what is left once the stage has
   *  taken this, and a slide with no room even for that drops its callouts and
   *  says so. 96pt is a quarter of the canvas height — a 16:10 capture 154pt
   *  wide, which is small but still a picture rather than a smudge. */
  minStage: 96,
  /** The phrase beside a chip in the feature legend. */
  legendSize: 8.5,
  /** Source pixels per drawn point past which interface text stops being
   *  readable. 13px UI body copy is the reference; 2.4 puts it at 5.4pt, just
   *  above the deck's own smallest type (the 6pt credit line). */
  maxPxPerPt: 2.4,
  /** The pixel size of the interface body copy the legibility note assumes. */
  uiBodyPx: 13,
  /** The mat's fill, and the letterbox colour when the aspect is unknown. */
  matLight: COLOR.lav,        // solid, on off-white
  matDarkAlpha: 0.10,         // COLOR.white at this alpha, on navy
  keylineLightAlpha: 0.30,    // COLOR.navy
  keylineDarkAlpha: 0.38,     // COLOR.white
  /** The aspect a screenshot falls back to when nothing measured the file —
   *  a draft saved before callouts shipped, or a `url` marked as a capture. */
  unknownAspect: 1.6,
} as const;

/** A feature slide whose picture is a screenshot is a NAVY STAGE, not a full
 *  bleed: the layout's white type is solved for a baked gradient, and a
 *  screenshot never gets one. Its own style so this is a decision rather than
 *  an inheritance — and it closes a live bug, because `feature` drew the
 *  eyebrow, title and body in white over an undarkened capture, which on a
 *  light UI made the whole slide invisible. */
export const FEATURE_SHOT_STYLE = {
  background: COLOR.navy, logo: "white", logoPlacement: "content", onDark: true,
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
  get y() { return onBand(1.9 * IN); },
  get height() { return bandScaled(3.0 * IN); },
  gap: 0.3 * IN,
  /** Each mark is fitted inside its cell with room around it. */
  inset: 0.12 * IN,
  /** The line under a mark carrying the client's name. */
  nameHeight: 14,
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
  "hub":         { background: COLOR.offWhite, logo: "navy",  logoPlacement: "content", onDark: false },
  "scatter":     { background: COLOR.offWhite, logo: "navy",  logoPlacement: "content", onDark: false },
  "venn":        { background: COLOR.offWhite, logo: "navy",  logoPlacement: "content", onDark: false },
  cards:         { background: COLOR.offWhite, logo: "navy",  logoPlacement: "content", onDark: false },
  // A quote sits on navy: it is a moment of emphasis, and the change of ground
  // is what makes it land as one rather than as another content slide.
  quote:         { background: COLOR.navy,     logo: "white", logoPlacement: "content", onDark: true },
  process:       { background: COLOR.offWhite, logo: "navy",  logoPlacement: "content", onDark: false },
  "logo-wall":   { background: COLOR.white,    logo: "navy",  logoPlacement: "content", onDark: false },
  // The handover deck's three. All three are PAPER pages — they keep the whole
  // frame, the stepper included, which is the argument for insetting the
  // photo-rail's picture rather than bleeding it the way image-split does.
  //
  // `onDark: false` here and nothing in `slideStyle` overrides it, so no slide
  // spec can put these three on a dark ground today. Their onDark branches are
  // therefore unreachable, and they are kept CONSISTENT rather than deleted:
  // Stage 5's compositions will copy whichever treatment is written here, and
  // an unreachable branch that is wrong is worse than one that is merely
  // unused. One of them WAS wrong — the photo rail handed its picture credit a
  // written-down `false` where every other decision on the same slide read
  // `onDark`, so forcing the layout to navy drew the credit in light-ground
  // ink on navy and it disappeared.
  "photo-rail":  { background: COLOR.offWhite, logo: "navy",  logoPlacement: "content", onDark: false },
  "three-column": { background: COLOR.offWhite, logo: "navy", logoPlacement: "content", onDark: false },
  "serpentine":  { background: COLOR.offWhite, logo: "navy",  logoPlacement: "content", onDark: false },
  closing:      { background: null,           logo: "white", logoPlacement: "closing", onDark: true },
};

/** One layout's ground, lockup and ink. Named so a resolver can return it
 *  for a slide whose ground is decided per instance. */
export type LayoutStyle = (typeof LAYOUT_STYLE)[SlideLayout];
