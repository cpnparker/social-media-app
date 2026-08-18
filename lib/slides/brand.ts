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

  /** Stops short of the top-right logo (which starts at 8.69in) so a long
   *  eyebrow cannot run underneath it. */
  eyebrowWidth: 8.15 * IN,
  eyebrowY: 0.3 * IN,
  eyebrowHeight: 0.25 * IN,

  /** Cover geometry comes from the deck's actual cover slide, NOT from its
   *  layout placeholder. The placeholder puts the title at 0.81in, but every
   *  real cover overrides it to sit below the centred logo — using the
   *  placeholder value puts the title straight through the logo. */
  coverTitleX: 1.75 * IN,
  coverTitleWidth: 6.43 * IN,
  coverTitleY: 2.12 * IN,
  coverTitleHeight: 2.26 * IN,
  coverKickerX: 1.52 * IN,
  coverKickerWidth: 7.17 * IN,
  coverKickerY: 5.07 * IN,
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
  coverTitle:    { font: "Playfair Display", size: 30, color: COLOR.greyLight },
  coverKicker:   { font: "Roboto", size: 12, color: COLOR.greyLight, caps: true },
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
  | "closing";

export const LAYOUTS: SlideLayout[] = [
  "cover", "section", "content", "two-column", "case-study", "dark-index", "closing",
];

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
  closing:      { background: null,           logo: "white", logoPlacement: "closing", onDark: true },
};
