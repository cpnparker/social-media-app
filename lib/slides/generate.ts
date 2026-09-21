/**
 * Build a branded Google Slides deck in the user's own Drive.
 *
 * Shape of the operation: presentations.create makes an empty deck owned by the
 * user, then ONE batchUpdate lays down every slide. Batching matters — a deck
 * built over N round-trips can fail halfway and leave a visibly broken file in
 * somebody's Drive, whereas batchUpdate is applied atomically by Google.
 *
 * Every slide is a BLANK layout with explicit shapes rather than a predefined
 * layout with placeholders. Placeholders would inherit from Slides' own default
 * master, which is not branded, and re-styling the master through the API is
 * considerably more work than positioning the boxes ourselves — especially with
 * exact geometry already extracted (lib/slides/brand.ts). The trade-off is that
 * the generated deck has no reusable layouts; see docs/tce-slide-brand.md.
 */

import {
  COLOR, GRID, CANVAS, TYPE, NOTE, STAT_MAX, STAT_GRID_MIN, STAT_GRID, TIMELINE, TIMELINE_PARALLEL, TRACK_COLORS, IMAGE, CHART,
  SERIES_LIGHT, SERIES_DARK, CARDS, QUOTE, PROCESS, LOGO_WALL, RULE, LAYOUT_STYLE, LOGO_PLACEMENT, SECTION, VENN,
  SHOT, FEATURE_SHOT_STYLE, FRAME, STEPPER, DENSITY, DEFAULT_DENSITY, density, withDensity,
  PHOTO_RAIL, SERPENTINE, columnBand,
  rgb, logoUrl, textOn, assetUrl, type SlideLayout, type TypeStyle, type LayoutStyle, type Density,
} from "@/lib/slides/brand";
import { getUserGoogleToken, authFailureMessage, type SlidesAuthFailure } from "@/lib/slides/token";
import { captureThumbnails } from "@/lib/slides/preview";
import {
  resolveImage, selectImageSource, bakeImageSource, attachmentImageSource,
  type ImageGenerator, type ImageSource, type ImageRequest, type TextBand,
} from "@/lib/slides/images";
import { resolveIcon } from "@/lib/slides/icons";
import {
  normaliseSlide, hubHasConnections, stampSteps, CONTINUATION_CLEARS, STEP_BOUNDS, type SlideStep,
} from "@/lib/slides/edit";
import { SLIDES_TEXT_INSET, BULLET_INDENT } from "@/lib/slides/preview-style";
import { refreshSignedMediaUrl } from "@/lib/media/signed";

const SLIDES_API = "https://slides.googleapis.com/v1/presentations";
const DRIVE_API = "https://www.googleapis.com/drive/v3/files";

export interface Milestone {
  /** Shown above the axis, e.g. "3 July" or "18–24 August". */
  date: string;
  /** Shown below the marker. */
  title: string;
  /** Optional supporting line under the title. */
  detail?: string;
  /** Draws a larger marker — for the phase that is current or next. */
  highlight?: boolean;
}

export interface TrackPhase {
  /** ISO date, YYYY-MM-DD. Required — proportional positioning is the whole
   *  point of this layout, and it cannot be derived from "late August". */
  start: string;
  /** ISO date. Omit for a single-day milestone, which renders as a dot. */
  end?: string;
  label: string;
}

export interface Track {
  name: string;
  phases: TrackPhase[];
}

export interface SlideInput {
  layout?: SlideLayout;
  /** WHICH DENSITY THIS DECK IS SET AT, stamped onto every slide by
   *  stampDensity the way the footer is stamped by stampFooter. It is a
   *  DECK-level decision — a deck with two densities in it is two decks — and
   *  it is per-slide only because buildSlideRequests is handed one slide at a
   *  time. Absent means `read`, which is what every deck built so far is. */
  density?: Density;
  /** WHERE THIS SLIDE SITS IN THE DECK'S SPINE, for the stepper rail. Stamped
   *  by stampSteps from the deck's own structure and re-stamped on every edit,
   *  exactly as `density` and `footer` are. NEVER written by the model: a
   *  number the model supplies desynchronises on the first insert and says
   *  nothing about it. See deckSteps in edit.ts. */
  step?: SlideStep;
  title?: string;
  subtitle?: string;
  eyebrow?: string;
  body?: string;
  bodyRight?: string;
  /** The THIRD prose column, on `three-column`. `body` and `bodyRight` were
   *  the whole of the column vocabulary because the grid held exactly two
   *  slots; this is the third, and it is a plain field rather than an array
   *  because that is what the two it joins are — a fields array would have
   *  been a second way to say the same thing on every layout that reads
   *  `body`. */
  bodyThird?: string;
  /** Headers for the two-column comparison — "Before"/"After", "Us"/"Them". */
  columns?: { left?: string; right?: string };
  /** SWOT: four quadrants of bullet lines. */
  swot?: { strengths?: string[]; weaknesses?: string[]; opportunities?: string[]; threats?: string[] };
  /** A 2x2 quadrant matrix — impact/effort, risk/reward. Items are placed by
   *  x and y in 0..1 (0 = left/bottom, 1 = right/top). */
  matrix?: {
    xAxis?: [string, string]; yAxis?: [string, string];
    /** Quadrant labels. Give each one the axis position it belongs at —
     *  { label, x: "low"|"high", y: "low"|"high" } — so the label follows
     *  from the axes rather than from a corner the caller has to work out.
     *  A deck shipped with "Later" written over the high-impact/low-effort
     *  corner and no "do now" anywhere, because the caller ordered the old
     *  four-tuple by its own reading of the grid and the renderer drew only
     *  the first two. The tuple is still accepted, as TL, TR, BL, BR. */
    quadrants?: [string, string, string, string]
      | { label: string; x: "low" | "high"; y: "low" | "high" }[];
    items?: { label: string; x: number; y: number; highlight?: boolean }[];
  };
  /** A comparison table: a header row of options, then criterion rows. A cell
   *  of "yes"/"no" draws a tick or cross; anything else prints as text. */
  comparison?: { columns?: string[]; rows?: { label: string; cells: string[]; highlight?: boolean }[] };
  /** A scatter plot — two continuous axes, points optionally grouped by a
   *  named series (each series its own colour). */
  scatter?: {
    xAxis?: string; yAxis?: string;
    points?: { x: number; y: number; label?: string; group?: string }[];
  };
  /** A data table: a header row and rows of cells. The comparison layout is a
   *  table too, but a judgement one — four options at most, a third of the
   *  width given to the criterion, cells centred and yes/no drawn as ticks.
   *  A keyword table with six columns of numbers needs none of that and wants
   *  the one thing comparison will not do: figures right-aligned under their
   *  heading, so the eye can run down a column. */
  table?: {
    columns?: string[];
    rows?: string[][];
    /** Per column. Inferred from the cells when absent, which is right often
     *  enough that asking is the exception. */
    align?: ("left" | "right")[];
    /** Row indices drawn on a tint — the rows that carry the argument. */
    highlight?: number[];
  };
  /** A stacked layer diagram — the "AI is a new LAYER" picture: horizontal
   *  bands top to bottom with connector arrows between them, each band either
   *  one full-width box or a row of small cells. The only way to say
   *  "everything below feeds the thing above". Up to 5 layers. */
  layers?: {
    title?: string;
    /** One sentence inside the band, under the title. */
    caption?: string;
    /** A row of cells instead of a caption: [{title, text?}], up to 8. */
    cells?: { title?: string; text?: string }[];
    /** "blue" (solid brand blue, white ink), "dashed" (outlined emphasis),
     *  or a tint: "teal" | "lav" | "grey" | "coral" | "amber". */
    style?: string;
    /** The connector under this band: "down" (default), "up" when the band
     *  BENEATH feeds this one — brands push into the channels, the AI layer
     *  reads across them — or "none". `false` is the old spelling of "none"
     *  and still works. */
    arrow?: boolean | "up" | "down" | "none";
  }[];
  /** A hub and what it is wired to: `title` in a navy circle at the centre,
   *  one or two `groups` either side, a connector from every item to the hub.
   *  One group is split across both sides and named once, over the hub. A
   *  third group is not drawn; it is counted and reported. See hubRequests. */
  hub?: {
    title?: string;
    caption?: string;
    groups?: {
      /** A caps label over this group's side. */
      name?: string;
      /** "blue" | "teal" | "coral" | "amber" | "grey" | "lav"; defaults to blue, then teal. */
      tone?: string;
      items?: { title?: string; icon?: string; resolvedIcon?: string }[];
    }[];
  };
  /** A full-width band under a cards row — the source deck's "SXO in detail"
   *  device: a spanning tinted panel holding a title and a row of small
   *  labelled cells that elaborate ONE of the cards above. */
  strip?: { title?: string; items?: { title?: string; text?: string }[] };
  /** Tinted panels behind the two columns, with the column header inked to
   *  match: `["coral","teal"]` is the source deck's negative/positive pair
   *  ("What AIO does not do" in rose, "What AIO is good for" in mint). Also
   *  "blue", "amber" and "grey". Omit for the plain hairline treatment. */
  tones?: string[];
  /** The takeaway bar along the foot of the slide: the "Why this matters:"
   *  sentence the source deck puts on nearly every page. A leading "Lead-in:"
   *  is drawn bold. Works on every layout, and shortens the content band so it
   *  can never overlap what is above it. */
  note?: string;
  /** The master template's panel: a rounded card beside the prose, blue with
   *  white ink or the soft lavender variant, carrying a short titled list. The
   *  device the JERA master uses for "The Content Engine is a combination of:".
   *  Drawn on the content family; a slide with a panel gives up its photo rail,
   *  because the master's split has either a panel or an image, never both. */
  panel?: {
    title?: string;
    items?: { title?: string; text?: string }[];
    /** "blue" (default) or "soft" — lavender with navy ink, for when a blue
     *  panel would make three blue elements fight on one slide. */
    style?: string;
  };
  /** A Venn diagram — two or three overlapping sets. */
  venn?: { sets?: { label: string }[]; overlap?: string };
  milestones?: Milestone[];
  tracks?: Track[];
  /** What this slide should be a picture OF, or an exact image to use, or one
   *  the USER attached (optionally cropped to a region of it). Resolved before
   *  the deck is built, so the preview shows the real photograph. */
  image?: {
    url?: string;
    query?: string;
    /** 1-based index into the images the user attached to the conversation. */
    attachment?: number;
    /** A region of that attachment, in percentages of its width and height. */
    region?: { x: number; y: number; width: number; height: number };
    /** This picture is a UI CAPTURE, not a photograph: it is matted and framed
     *  rather than bled, and nothing is ever written over it. Implied by
     *  `callouts`, so it only has to be set for a screenshot with no pins. */
    screenshot?: boolean;
    /** Up to 5 numbered pins ON the picture, in array order (1-based). x and y
     *  are percentages of the DRAWN IMAGE BOX, after any `region` crop. Drawn
     *  on image-split and feature; declared, not drawn, anywhere else. */
    callouts?: { x: number; y: number; text: string }[];
  };
  /** Filled in by resolution — not supplied by the model. */
  resolvedImage?: {
    url: string; scrim: number; credit?: string; logo?: "white" | "navy";
    /** width/height of the PREPARED file. A screenshot is drawn at its own
     *  shape rather than baked to a box, so the layout has to be told what
     *  that shape is; a photograph is baked and leaves these unset. */
    aspect?: number;
    /** Its pixel width, for the legibility note — how much interface is being
     *  asked to survive being drawn at 295 points. */
    sourceWidth?: number;
  };
  /** Set when resolution ran and found nothing, so publishing does not quietly
   *  search again and build a deck different from the one that was approved. */
  imageUnavailable?: boolean;
  /** Why the picture could not be used, when it was found but could not be
   *  prepared. Reported to the model so it can tell the user. */
  imageError?: string;
  /** How many grid thumbnails were asked for and not found. */
  imagesDropped?: number;
  /** Icon names on a hub that resolved to nothing, recorded fresh at every
   *  resolution so the model is told to use a plain noun instead. */
  iconsMissing?: string[];
  /** The layout name the model asked for, when it was not one we have. */
  layoutAsked?: string;
  /** This slide is the tail of one the splitter cut in two. It takes the
   *  picture from the slide it came from rather than asking for its own. */
  continuation?: boolean;
  /** Thumbnails for the image-grid layout. */
  images?: { url?: string; query?: string; caption?: string }[];
  resolvedImages?: { url: string; caption?: string }[];
  /** Repeated blocks. Every part is optional: a marker alone gives numbered
   *  items, a thumbnail gives a product grid, neither gives labelled columns. */
  cards?: {
    /** "01", or a short label like "STRATEGY". Drawn as a brand chip. */
    marker?: string;
    /** Tints this card and draws a coloured accent bar across its top —
     *  "blue", "teal", "coral", "amber" or "grey". The source deck's
     *  discipline cards (AEO / GEO / SXO) each carry their own colour; a card
     *  without a tone keeps the plain treatment. */
    tone?: string;
    title?: string;
    body?: string;
    /** A Lucide icon name — "target", "line-chart", "users". Drawn small above
     *  the heading, in brand navy. Cheaper and far more consistent than a
     *  photograph when the card is about an idea rather than a thing. */
    icon?: string;
    image?: { url?: string; query?: string };
    resolvedImage?: { url: string };
    resolvedIcon?: string;
  }[];
  /** A pull quote and who said it. */
  quote?: { text: string; name?: string; role?: string; image?: { url?: string; query?: string }; resolvedImage?: { url: string } };
  /** Stages, left to right. Three to five reads best. */
  /** `name`/`caption` is the original shape; `title`/`body` is accepted too,
   *  because every SIBLING layout (cards, layers, panel) uses title/body and a
   *  process slide written that way drew four empty blue boxes and said
   *  nothing — the deck shipped with them. */
  /** `owner` is drawn as its own "Owner: ..." line — at the foot of a process
   *  card, and on the serpentine's own baseline per side. It has been in the
   *  tool schema and read by both layouts since `process` was written, and it
   *  was simply missing from this type, so every fixture and caller that set
   *  one had to go through `any` and TypeScript could not have caught a
   *  misspelling of it. */
  stages?: { name?: string; caption?: string; title?: string; body?: string; owner?: string }[];
  /** The footer's text — the deck's own name, stamped by the builder. A slide
   *  never chooses this; it is the one line that must read the same on every
   *  page, and a model writing it per slide would not. */
  footer?: string;
  /** Client marks for logo-wall. Fitted whole, never cropped. */
  logos?: { url?: string; query?: string; name?: string; resolvedUrl?: string }[];
  /** Big numbers for the stat layout — three at most, or none of them lands. */
  /** Headline figures for the stat layout, one to eight. One is a hero, two
   *  or three are the navy row, four or more are a grid of cards on the
   *  light ground — rows of up to four, the reference deck's 4-then-3.
   *  `tone` ("grey" | "blue" | "teal" | "coral" | "amber") colours a card so
   *  the grid GROUPS its figures: the reference sets its landscape figures
   *  on grey and its opportunity figures on mint, which is what lets the
   *  takeaway say "the green numbers are the upside". */
  stats?: { value: string; label: string; detail?: string; primary?: boolean; tone?: string }[];
  /** Data for bar-chart and line-chart. */
  chart?: {
    series: { name: string; points: { label: string; value: number }[] }[];
    /** Printed under the plot. A chart without one invites the question. */
    source?: string;
    /** The points are a TIME SERIES — draw them in the given order, do not sort
     *  by value. A monthly trend sorted by value is a scrambled line. */
    sequence?: boolean;
    /** Index of the one bar that IS the point — drawn in the accent, the rest
     *  muted, so the chart argues instead of merely presenting. */
    highlight?: number;
    /** A target or reference line drawn across the plot — "industry average",
     *  "our goal" — so a bar reads as above or below it, not just as a length. */
    benchmark?: { value: number; label?: string };
    /** A short annotation tied to one bar — the reason behind the number. */
    callout?: { point: number; text: string };
    /** What the y axis measures — "Net profit (CHF)", "Users". Drawn above the
     *  axis values on a line chart. There was no field for this at all, so a
     *  request to label the axis had nowhere to go and the model answered it by
     *  claiming a label it could not set. */
    yAxisLabel?: string;
  };
  /** A deck-wide art-direction note threaded into every PHOTOGRAPH query, so a
   *  deck's images read as one commission rather than a stock grab-bag. Never
   *  applied to logos, icons or a named person's portrait. */
  imageStyle?: string;
  /** ISO date for the "today" rule. Defaults to the real today; drawn only if
   *  it falls inside the plotted range. */
  today?: string;
  notes?: string;
}

export interface SlidesResult {
  ok: boolean;
  url?: string;
  presentationId?: string;
  title?: string;
  slideCount?: number;
  error?: string;
  /** Set only when the failure is a connection state the user can fix. The
   *  chat layer uses it to offer a reconnect button instead of an error. */
  reason?: SlidesAuthFailure;
  /** True when an existing deck was edited rather than a new one created. */
  updated?: boolean;
  /** The deck to update could not be opened — caller may create instead. */
  notFound?: boolean;
  /** Slide thumbnails, in order, for the in-chat preview. */
  thumbnails?: string[];
}

/* ─────────────── Request builders ─────────────── */

type Req = Record<string, any>;

function pt(magnitude: number) {
  return { magnitude, unit: "PT" };
}

function textStyleRequest(objectId: string, style: TypeStyle): Req {
  // weightedFontFamily rather than fontFamily + bold: when both are set the
  // weighted one wins anyway, so setting only it avoids a contradictory pair.
  const weight = style.weight ?? (style.bold ? 700 : 400);
  return {
    updateTextStyle: {
      objectId,
      textRange: { type: "ALL" },
      style: {
        weightedFontFamily: { fontFamily: style.font, weight },
        fontSize: pt(style.size),
        foregroundColor: { opaqueColor: { rgbColor: rgb(style.color) } },
      },
      fields: "weightedFontFamily,fontSize,foregroundColor",
    },
  };
}

interface BoxOptions {
  align?: "START" | "CENTER" | "END";
  /** NO `bullets` OPTION, AND THAT IS THE POINT. Slides' own disc preset drew
   *  its glyph inside the measure and indented the wrapped lines under the
   *  words; `bulletBlock` hangs a brand disc outside it. For one commit the
   *  deck did both — a disc on a content slide and Slides' glyph on the
   *  image-split one after it, in 15 of the 37 stored decks — and a reader
   *  asked to see two markers will look for the difference between them. The
   *  preset is gone from the builder rather than merely unused, so a layout
   *  cannot quietly opt back into it. */
  lineSpacing?: number;
  /** Points after each paragraph. Raised on a short list so four bullets use
   *  the band they are given instead of pooling under the title with half the
   *  slide empty beneath them. */
  spaceBelow?: number;
  /** Centre the text vertically inside its box.
   *
   *  This is how a short slide stops leaving its bottom third empty without
   *  anyone having to measure text. The box is given the whole band it may
   *  occupy and Slides centres whatever lands in it, so three bullets sit in
   *  the middle of the space and eight fill it — no estimating line heights,
   *  and no drift between what we predicted and what Google laid out. */
  vCenter?: boolean;
  /** Sit the text at the BOTTOM of its box.
   *
   *  For a heading in a band sized to the tallest heading in its row: a
   *  one-line title in a three-line box left a visible hole between itself and
   *  the body underneath, and the body could not move up without breaking the
   *  row's shared baseline. Bottom-aligning puts the slack ABOVE the heading,
   *  under the chip, where it reads as spacing rather than as a gap. */
  vBottom?: boolean;
  /** A LEAD-IN: the first `chars` characters set in the accent, inside a box
   *  whose remaining words stay body copy.
   *
   *  A RANGE rather than a box of its own, because a lead-in is the first
   *  SENTENCE of its column and reads on into the rest of the paragraph — the
   *  source's own arrangement, where "Work in progress." is blue and the
   *  sentence after it is not. Styled a paragraph at a time instead, a column
   *  written as ONE paragraph (which the tool explicitly permits) came out
   *  entirely bold brand blue, and every continuation of a split slide
   *  promoted an ordinary mid-list bullet into a lead-in.
   *
   *  BOLD AND THE FACE, both. `bold` is what the preview and the PDF read;
   *  the weighted family is what makes Slides draw Roboto Bold rather than
   *  synthesising a heavier Light. Sending one without the other is how the
   *  first version of this drew every lead-in at the body's own weight. */
  leadRange?: { chars: number; color: string };
}

/** A positioned text box: create, fill, style. Returns [] for empty text so a
 *  missing optional field doesn't produce an empty box (or an insertText error,
 *  which is what an empty string actually causes). */
/** Markdown links in a plain string: `[label](https://…)`.
 *
 *  A syntax rather than a structured field because body copy is one string that
 *  the model already writes markdown into everywhere else in this product, and
 *  because links belong to phrases inside a sentence — a parallel array of
 *  urls could not say WHICH words are the link.
 *
 *  Returns the text with the markup removed, plus where each link now falls.
 *  Offsets are computed against the stripped string because that is what
 *  Slides will hold. */
/** An IMAGE in markdown — `![caption](target)` — reduced to its caption.
 *
 *  Run before links, because an image is a link with a bang in front and the
 *  link matcher would otherwise leave the bang and the brackets behind.
 *
 *  AuthorityOn's rebuilt audit documents carry their charts this way, as
 *  `![Presence by product. The audit run, 2 September 2026.](chart:presence-by-product)`,
 *  where the target is a `chart:` id rather than a URL. Nothing here can draw
 *  that chart — the vectors are not on the API — but the caption carries the
 *  instrument and the date, which is the part a slide needs. Untouched, the
 *  whole string was drawn on the slide verbatim, brackets and id and all.
 *  Any image markdown reduces the same way, whatever the target scheme. */
export function stripImageMarkdown(raw: string): string {
  return raw.replace(/!\[([^\]]*)\]\([^)\s]*\)/g, "$1");
}

function extractLinks(raw: string): { text: string; links: { start: number; end: number; url: string }[] } {
  const links: { start: number; end: number; url: string }[] = [];
  let text = "";
  let rest = raw;
  const re = /\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)/;
  for (let guard = 0; guard < 200; guard++) {
    const m = re.exec(rest);
    if (!m) break;
    text += rest.slice(0, m.index);
    const start = text.length;
    text += m[1];
    links.push({ start, end: text.length, url: m[2] });
    rest = rest.slice(m.index + m[0].length);
  }
  return { text: text + rest, links };
}

/**
 * The tinted-panel palette for a two-column slide.
 *
 * The source deck almost never sets two columns as bare lists: it puts each in
 * a soft tinted card with the heading inked to match, and uses rose against
 * mint to carry "what does not work / what does". The tints and their inks are
 * the validated pairs already used by SWOT and table rows, so contrast is
 * settled rather than guessed.
 */
const TONES: { [k: string]: { tint: string; ink: string } } = {
  coral: { tint: COLOR.tintCoral, ink: COLOR.inkCoral },
  teal:  { tint: COLOR.tintTeal,  ink: COLOR.inkTeal },
  blue:  { tint: COLOR.tintBlue,  ink: COLOR.inkBlue },
  amber: { tint: COLOR.tintAmber, ink: COLOR.inkAmber },
  grey:  { tint: COLOR.tintGrey,  ink: COLOR.navy },
};
function toneAt(tones: string[] | undefined, i: number) {
  const key = String((tones || [])[i] || "").toLowerCase();
  return TONES[key];
}

/** How tall the takeaway bar needs to be for its text, at the width the bar is
 *  actually drawn at. Measured at full width while the bar was narrowed, the
 *  sentence wraps to more lines than it was sized for and overflows its panel —
 *  and the band above, shortened by the SAME wrong height, leaves it too little
 *  room, so it climbs into the prose. Width and height have to agree. */
function noteHeight(note: string | undefined, width: number = GRID.contentWidth): number {
  const text = (note || "").trim();
  if (!text) return 0;
  const lines = estimateLines(text, width - NOTE.pad * 2, NOTE.fontSize);
  return Math.min(NOTE.maxHeight, Math.max(NOTE.minHeight, lines * NOTE.lineHeight + NOTE.pad * 2));
}

/**
 * The content band, shortened when a takeaway bar is present.
 *
 * Every layout that centres a self-contained block — stats, a plot, a card row
 * — measures against this rather than GRID.bandHeight, so adding a note moves
 * the content up instead of drawing the bar on top of it.
 */
/** Every slide gets the deck's name in its footer. Called by both entry
 *  points — the Drive build and the chat draft — so the preview and the deck
 *  carry the same line. */
export function stampFooter(slides: SlideInput[], title: string | undefined): SlideInput[] {
  const t = String(title || "").replace(/[{}]/g, "").trim();
  const footer = t ? `The Content Engine \u00b7 ${t}` : "The Content Engine";
  for (const s of slides) if (s && !s.footer) s.footer = footer;
  return slides;
}

/** The deck's density, put on every slide in it — the same shape as the footer
 *  above, and for the same reason: buildSlideRequests is handed one slide at a
 *  time, so a deck-wide decision has to travel on each of them. Stamping
 *  rather than defaulting is what keeps a deck from being half one density. */
/** The deck's spine, stamped the same way and at the same moments.
 *
 *  Re-exported rather than reimplemented: it lives in edit.ts because that
 *  module has no imports to cycle on and this one imports it, and two rulers
 *  for one question is how the frame's decision and the validator's verdict
 *  would come to disagree. Same reasoning as inkBottom. */
export { stampSteps, deckSteps } from "@/lib/slides/edit";

export function stampDeckSteps(slides: SlideInput[]): SlideInput[] {
  return stampSteps(slides, STEP_BOUNDS) as SlideInput[];
}

/**
 * EVERY DECK-WIDE FIELD, IN ONE CALL. The footer's running head and the spine
 * are the same kind of thing — a decision about the deck that has to travel on
 * each slide because the builder is handed one at a time — and they are now
 * stamped through one door rather than two lines that a fifth entry point can
 * be written without.
 *
 * That is not tidiness. Both build entry points stamped both fields, and
 * deleting EITHER call from EITHER of them left the whole suite green: a deck
 * built by `buildSlidesDraft` without a spine shows the chat preview no rail
 * while `generateSlides` re-derives one at publish, which is the preview/deck
 * divergence this repo has already paid for twice. A check asserts that every
 * entry point calls THIS, so the next one cannot be added with half of it.
 *
 * ALWAYS AFTER THE SPLIT. A continuation is the same thing continued, so it
 * carries its parent's numeral; stamped before the split, a body one paragraph
 * too long would turn seven things into eight.
 */
export function stampDeckChrome(slides: SlideInput[], title: string | undefined): SlideInput[] {
  stampFooter(slides, title);
  stampDeckSteps(slides);
  return slides;
}

export function stampDensity(slides: SlideInput[], name: Density | undefined): SlideInput[] {
  const d: Density = name && DENSITY[name] ? name : DEFAULT_DENSITY;
  for (const s of slides) if (s) s.density = d;
  return slides;
}

/** What this slide is built at. An unknown value is read, not a throw: the
 *  stored specs of every deck ever built are replayed through here, and one
 *  that arrives with a density this build does not know is a deck to draw,
 *  not a deck to lose. */
export function densityOf(slide: Pick<SlideInput, "density"> | undefined): Density {
  const d = slide && slide.density;
  return d && DENSITY[d] ? d : DEFAULT_DENSITY;
}

export function bandHeightFor(slide: Pick<SlideInput, "note">, noteWidth: number = GRID.contentWidth): number {
  const h = noteHeight(slide.note, noteWidth);
  if (!h) return GRID.bandHeight;
  return Math.max(90, NOTE.bottom - h - NOTE.gap - GRID.bodyY);
}

/**
 * The takeaway bar: the "Why this matters:" sentence along the foot.
 *
 * The device the source deck uses on nearly every page. Our engine had nowhere
 * to put it, so it went into `subtitle` — competing with the standfirst — or
 * into `body`, where it read as one more bullet, and the most quotable line on
 * the page lost its emphasis.
 */
function noteRequests(
  page: string, id: (s: string) => string, note: string | undefined, onDark: boolean,
  below?: number,
  width: number = GRID.contentWidth,
  /** Where the bar STARTS. The page margin on every layout whose words start
   *  there, and the type column on one whose picture takes the left. */
  x: number = GRID.margin
): Req[] {
  const text = (note || "").trim();
  if (!text) return [];
  const h = noteHeight(text, width);
  // UNDER THE CONTENT, not at the foot of the page. The reference deck sets
  // its takeaway bar a few points beneath the boxes it comments on, and lets
  // the empty space fall BELOW it; pinned to the bottom, the bar sat up to
  // 150pt under the last bullet, so the room's eye had to cross a void of
  // tinted card to find the sentence the presenter was reading out. A layout
  // that knows where its content ends passes it here; one that does not gets
  // the old pin.
  const y = below !== undefined ? Math.min(below, NOTE.bottom - h) : NOTE.bottom - h;
  const out: Req[] = [
    ...filledShape(id("noteBar"), page, "ROUND_RECTANGLE", onDark ? COLOR.white : COLOR.tintBlue, {
      x, y, width, height: h,
    }, onDark ? 0.1 : 1),
    ...textBox(id("noteTxt"), page, text,
      { font: "Roboto", size: NOTE.fontSize, weight: 300, color: onDark ? COLOR.greyLight : COLOR.navy }, {
        x: x + NOTE.pad, y: y + NOTE.pad - 3,
        width: width - NOTE.pad * 2, height: h - NOTE.pad,
      }, { lineSpacing: 1.15 }),
  ];
  // The bold lead-in, when the note opens with one. Drawn as a RUN rather than
  // a second box, so the sentence still wraps as one paragraph — which is what
  // makes it read as a sentence and not a heading.
  const colon = text.indexOf(":");
  if (colon > 0 && colon <= 46) {
    out.push({
      updateTextStyle: {
        objectId: id("noteTxt"),
        textRange: { type: "FIXED_RANGE", startIndex: 0, endIndex: colon + 1 },
        style: { bold: true, foregroundColor: { opaqueColor: { rgbColor: rgb(onDark ? COLOR.lime : COLOR.blue) } } },
        fields: "bold,foregroundColor",
      },
    });
  }
  return out;
}

/**
 * The brand's accent phrase: braces in a headline mark one italic phrase.
 *
 *     "Great storytelling can {change the world}"
 *
 * On light grounds the phrase turns italic; on dark grounds it turns italic AND
 * lime, while the roman part stays off-white — the colour flip the design
 * system calls the brand's strongest recognisable detail. The braces are
 * MARKUP: they are stripped before the text reaches the slide, and the ranges
 * they marked are what the styling is applied to.
 *
 * Applied to Playfair fields only. Playfair is the headline voice, which is
 * exactly where the brand says the accent belongs; body copy in Roboto passes
 * braces through untouched, so user content is never silently rewritten.
 */
export function parseAccents(source: string): { text: string; ranges: { start: number; end: number }[] } {
  const ranges: { start: number; end: number }[] = [];
  let text = "";
  let i = 0;
  while (i < source.length) {
    const open = source.indexOf("{", i);
    if (open < 0) { text += source.slice(i); break; }
    const close = source.indexOf("}", open + 1);
    if (close < 0) { text += source.slice(i); break; }   // unmatched brace stays literal
    text += source.slice(i, open);
    const start = text.length;
    text += source.slice(open + 1, close);
    // An empty pair marks nothing and is dropped rather than recorded.
    if (text.length > start) ranges.push({ start, end: text.length });
    i = close + 1;
  }
  return { text, ranges };
}

/**
 * Markdown bold, as ranges: "**Focus:** entity authority" strips the markers
 * and returns where the bold runs sit. The source decks open almost every
 * bullet with a bold lead-in — the label that makes a card scannable — and a
 * pipeline that flattens them to uniform weight turns five comparable cards
 * into five paragraphs. Same shape as parseAccents, same reason it exists.
 */
export function parseBold(source: string): { text: string; ranges: { start: number; end: number }[] } {
  const ranges: { start: number; end: number }[] = [];
  let text = "";
  let i = 0;
  while (i < source.length) {
    const open = source.indexOf("**", i);
    if (open < 0) { text += source.slice(i); break; }
    const close = source.indexOf("**", open + 2);
    if (close < 0) { text += source.slice(i); break; }   // unmatched stays literal
    text += source.slice(i, open);
    const start = text.length;
    text += source.slice(open + 2, close);
    if (text.length > start) ranges.push({ start, end: text.length });
    i = close + 2;
  }
  return { text, ranges };
}

/** Light inks mean a dark ground, which is where the accent goes lime. Derived
 *  from the ink rather than passed in, so no call site can get it wrong. */
function accentColorFor(style: TypeStyle): string | undefined {
  return style.color === COLOR.white || style.color === COLOR.greyLight ? COLOR.lime : undefined;
}

function textBox(
  objectId: string,
  pageObjectId: string,
  text: string | undefined,
  style: TypeStyle,
  box: { x: number; y: number; width: number; height: number },
  options: BoxOptions = {}
): Req[] {
  const source = (text ?? "").trim();
  if (!source) return [];
  const { text: content, links } = extractLinks(stripImageMarkdown(source));
  if (!content) return [];
  const collapsed = content;
  if (!collapsed) return [];
  let rendered = style.caps ? collapsed.toUpperCase() : collapsed;

  // The accent phrase, on Playfair fields only. Skipped when the box also
  // carries markdown links: both index into the final text and stripping braces
  // would shift the link ranges — a headline carrying both is not a real case,
  // and leaving the braces visible is more honest than styling the wrong words.
  let accentRanges: { start: number; end: number }[] = [];
  const accented = style.font === "Playfair Display" && links.length === 0 && rendered.indexOf("{") >= 0;
  if (accented) {
    const parsed = parseAccents(rendered);
    rendered = parsed.text;
    accentRanges = parsed.ranges;
  }
  // Bold runs, on any field that is not already carrying links or accents —
  // both index into the final string, and stripping markers under them would
  // shift their ranges onto the wrong words.
  let boldRanges: { start: number; end: number }[] = [];
  if (!accented && links.length === 0 && rendered.indexOf("**") >= 0) {
    const pb = parseBold(rendered);
    rendered = pb.text;
    boldRanges = pb.ranges;
  }

  // WRITTEN DOWN AS IT GOES PAST. See SLIDE_INK: the deck frame draws rects
  // into bands it believes are empty, and this is the only record of what is
  // actually there. Measured on `rendered` — the string Slides receives, after
  // upper-casing and after the markup this pipeline strips — because that is
  // the text whose lines are counted.
  if (SLIDE_INK) {
    SLIDE_INK.push({
      top: box.y,
      bottom: inkBottom({
        y: box.y, w: box.width, text: rendered, size: style.size, font: style.font,
        weight: style.weight ?? (style.bold ? 700 : 400),
        bullets: false, caps: !!style.caps,
      }),
    });
  }

  const requests: Req[] = [
    {
      createShape: {
        objectId,
        shapeType: "TEXT_BOX",
        elementProperties: {
          pageObjectId,
          size: { width: pt(box.width), height: pt(box.height) },
          transform: { scaleX: 1, scaleY: 1, translateX: box.x, translateY: box.y, unit: "PT" },
        },
      },
    },
    { insertText: { objectId, text: rendered, insertionIndex: 0 } },
    textStyleRequest(objectId, style),
    {
      updateParagraphStyle: {
        objectId,
        textRange: { type: "ALL" },
        style: {
          alignment: options.align ?? "START",
          lineSpacing: (options.lineSpacing ?? 1.15) * 100,
          spaceBelow: pt(options.spaceBelow ?? 6),
        },
        fields: "alignment,lineSpacing,spaceBelow",
      },
    },
  ];

  for (let bi = 0; bi < boldRanges.length; bi++) {
    const r = boldRanges[bi];
    requests.push({
      updateTextStyle: {
        objectId,
        textRange: { type: "FIXED_RANGE", startIndex: r.start, endIndex: r.end },
        style: { bold: true },
        fields: "bold",
      },
    });
  }

  // The column's lead-in. Clamped to what was actually drawn: the count is
  // measured on the stripped text and a box that also carried markup would
  // otherwise index past its own string.
  if (options.leadRange && options.leadRange.chars > 0) {
    const end = Math.min(options.leadRange.chars, rendered.length);
    if (end > 0) {
      requests.push({
        updateTextStyle: {
          objectId,
          textRange: { type: "FIXED_RANGE", startIndex: 0, endIndex: end },
          style: {
            bold: true,
            weightedFontFamily: { fontFamily: style.font, weight: 700 },
            foregroundColor: { opaqueColor: { rgbColor: rgb(options.leadRange.color) } },
          },
          fields: "bold,weightedFontFamily,foregroundColor",
        },
      });
    }
  }

  const accentColor = accentColorFor(style);
  for (let ai = 0; ai < accentRanges.length; ai++) {
    const r = accentRanges[ai];
    requests.push({
      updateTextStyle: {
        objectId,
        textRange: { type: "FIXED_RANGE", startIndex: r.start, endIndex: r.end },
        style: {
          italic: true,
          ...(accentColor ? { foregroundColor: { opaqueColor: { rgbColor: rgb(accentColor) } } } : {}),
        },
        fields: accentColor ? "italic,foregroundColor" : "italic",
      },
    });
  }

  // Links LAST, and carrying the brand colour with them. Setting a link makes
  // Slides apply its theme hyperlink colour and an underline, so a link applied
  // after the run style silently repaints that phrase blue — every linked
  // portfolio caption would stop looking like the deck around it.
  for (const [li, link] of links.map((l, i) => [i, l] as const)) {
    requests.push({
      updateTextStyle: {
        objectId,
        textRange: { type: "FIXED_RANGE", startIndex: link.start, endIndex: link.end },
        style: {
          link: { url: link.url },
          foregroundColor: { opaqueColor: { rgbColor: rgb(style.color) } },
          underline: true,
        },
        fields: "link,foregroundColor,underline",
      },
    });
    void li;
  }

  if (options.vCenter || options.vBottom) {
    requests.push({
      updateShapeProperties: {
        objectId,
        shapeProperties: { contentAlignment: options.vBottom ? "BOTTOM" : "MIDDLE" },
        fields: "contentAlignment",
      },
    });
  }

  return requests;
}

function logoRequests(
  objectId: string, pageObjectId: string, style: LayoutStyle, slide?: SlideInput
): Req[] {
  // The STYLE, not the layout: a stat slide's ground is decided per instance
  // (slideStyle), and the lockup has to follow the ground it actually sits on.
  if (!style.logo) return [];
  const place = LOGO_PLACEMENT[style.logoPlacement];
  // The picture only gets a say where the logo actually SITS on it — the
  // full-bleed layouts. On image-split the photograph fills the left half while
  // the lockup sits top-right over off-white, so letting a dark photo ask for
  // the white mark put a white logo on a near-white ground: invisible, and
  // introduced by the fix for the opposite problem.
  const overPhoto = style.background === null;
  const variant = (overPhoto && slide?.resolvedImage?.logo) || style.logo;
  return [
    {
      createImage: {
        objectId,
        url: logoUrl(variant),
        elementProperties: {
          pageObjectId,
          size: { width: pt(place.width), height: pt(place.height) },
          transform: { scaleX: 1, scaleY: 1, translateX: place.x, translateY: place.y, unit: "PT" },
        },
      },
    },
  ];
}

/** A filled shape with no outline — the axis rule and the milestone markers.
 *  Slides gives new shapes a default border, which reads as a stray hairline at
 *  this size, so the outline is explicitly turned off rather than left. */
function filledShape(
  objectId: string,
  pageObjectId: string,
  shapeType: "RECTANGLE" | "ROUND_RECTANGLE" | "ELLIPSE" | "RIGHT_ARROW",
  color: string,
  box: { x: number; y: number; width: number; height: number },
  /** 0–1. A hairline at full strength is a line; at a fifth it is structure. */
  alpha?: number,
  /** A solid hairline edge — the stat card's border. Absent, the default
   *  border Slides gives a new shape is turned OFF, not left. */
  outline?: { color: string; alpha?: number; weight: number }
): Req[] {
  return [
    {
      createShape: {
        objectId,
        shapeType,
        elementProperties: {
          pageObjectId,
          size: { width: pt(box.width), height: pt(box.height) },
          transform: { scaleX: 1, scaleY: 1, translateX: box.x, translateY: box.y, unit: "PT" },
        },
      },
    },
    {
      updateShapeProperties: {
        objectId,
        shapeProperties: {
          shapeBackgroundFill: {
            solidFill: {
              color: { rgbColor: rgb(color) },
              ...(typeof alpha === "number" ? { alpha } : {}),
            },
          },
          outline: outline
            ? {
                outlineFill: { solidFill: {
                  color: { rgbColor: rgb(outline.color) },
                  ...(typeof outline.alpha === "number" ? { alpha: outline.alpha } : {}),
                } },
                weight: pt(outline.weight),
              }
            : { propertyState: "NOT_RENDERED" },
        },
        fields: (typeof alpha === "number" ? "shapeBackgroundFill.solidFill" : "shapeBackgroundFill.solidFill.color")
          + (outline ? ",outline" : ",outline.propertyState"),
      },
    },
  ];
}

/** A straight line segment from (x1,y1) to (x2,y2), drawn as a thin rectangle
 *  rotated by the affine transform.
 *
 *  Slides has no polyline, so a line chart is built from these. The transform
 *  maps the rectangle's local mid-left onto the first point and mid-right onto
 *  the second — verified exact for every direction. The preview reads the same
 *  transform, so a sloped line looks identical in both.
 */
function segment(
  objectId: string, page: string, color: string,
  x1: number, y1: number, x2: number, y2: number, thickness: number, alpha?: number
): Req[] {
  const dx = x2 - x1, dy = y2 - y1;
  const L = Math.hypot(dx, dy) || 1;
  const c = dx / L, sn = dy / L;
  const T = thickness;
  return [
    {
      createShape: {
        objectId, shapeType: "RECTANGLE",
        elementProperties: {
          pageObjectId: page,
          size: { width: pt(L), height: pt(T) },
          transform: {
            scaleX: c, scaleY: c, shearX: -sn, shearY: sn,
            translateX: x1 + sn * (T / 2), translateY: y1 - c * (T / 2), unit: "PT",
          },
        },
      },
    },
    {
      updateShapeProperties: {
        objectId,
        shapeProperties: {
          shapeBackgroundFill: {
            solidFill: { color: { rgbColor: rgb(color) }, ...(typeof alpha === "number" ? { alpha } : {}) },
          },
          outline: { propertyState: "NOT_RENDERED" },
        },
        fields: typeof alpha === "number"
          ? "shapeBackgroundFill.solidFill,outline.propertyState"
          : "shapeBackgroundFill.solidFill.color,outline.propertyState",
      },
    },
  ];
}

/* ─────────────── Three primitives ─────────────── */

/**
 * The hairline, the hung dot and the CTA pill: the three things the handover
 * deck builds its pages out of that no layout here can draw.
 *
 * They are PRIMITIVES rather than layouts on purpose. What makes seven slides
 * of one layout in that deck read as seven different pages is furniture that
 * belongs to every layout — a rule that says where the title ends, a dot that
 * hangs a bullet off the measure, a pill that makes an action look like an
 * action. A thirtieth archetype would give one slide all three and the other
 * twenty-nine none of them.
 *
 * All three compose out of `filledShape` and `textBox`, so the request stream
 * stays the contract boundary and the preview, the PDF, the splitter's probe
 * and validate.ts all read them for free. Nothing here emits a shape kind the
 * preview does not already know — check 43 is what would catch it if it did.
 */

/** How far a rule runs.
 *
 *  `bleed` is the master's own: edge to edge, which is what makes it read as
 *  the page's furniture rather than as part of the slide. `content` is the
 *  measure, for a rule that belongs to the words. `{ from: x }` starts at an
 *  x and runs to the right margin — the handover deck's slide 3 rule begins at
 *  the photograph's right edge rather than at the margin, and slide 5's, with
 *  no photograph, runs the full measure. One reach, two slides, no branch. */
export type HairlineReach = "bleed" | "content" | { from: number; to?: number };

export function hairlineSpan(reach: HairlineReach): { x: number; length: number } {
  if (reach === "bleed") return { x: 0, length: CANVAS.width };
  if (reach === "content") return { x: GRID.margin, length: GRID.contentWidth };
  const right = GRID.margin + GRID.contentWidth;
  const from = Math.max(0, Math.min(reach.from, right));
  // A RIGHT END TOO, for the same reason there is a left one: a rule that runs
  // the whole width of a page whose right third is a bleeding photograph is
  // drawn across the picture, and a hairline struck through a photograph reads
  // as a scratch on it rather than as the page's own furniture.
  return { x: from, length: Math.max(0, (reach.to === undefined ? right : Math.min(reach.to, right)) - from) };
}

/** The ink a rule takes on the ground it is drawn on.
 *
 *  #707070 is the deck's own, and it is 4.66:1 on off-white — comfortable for
 *  a rule and good enough for text, which is not true of the #B7B7B7 the same
 *  deck uses for its inactive stepper numerals. On navy the same grey is a
 *  rule nobody can see, so the dark ground gets the light grey at under half
 *  strength: at full strength #EBEBEB on navy is a stripe, not a hairline. */
export function hairlineInk(onDark: boolean): { color: string; alpha?: number } {
  return onDark ? { color: FRAME.ruleOnDark, alpha: FRAME.ruleOnDarkAlpha } : { color: FRAME.rule };
}

export function hairline(
  objectId: string, page: string, reach: HairlineReach, y: number, onDark: boolean,
  thickness: number = FRAME.thickness
): Req[] {
  const span = hairlineSpan(reach);
  // A rule with nothing to run across is NOT DRAWN. `{ from: x }` clamps to
  // the right margin, so a figure that fills the measure leaves a zero-length
  // span — and Slides rejects a zero-width shape, which fails the whole
  // batchUpdate and takes the deck with it over a hairline.
  if (span.length <= 0) return [];
  const ink = hairlineInk(onDark);
  return filledShape(objectId, page, "RECTANGLE", ink.color,
    { x: span.x, y, width: span.length, height: thickness }, ink.alpha);
}

/** THE CROSSING PAIR: the full-bleed rule, and a vertical arm through it.
 *
 *  A plain rect for the vertical arm rather than the source's hairline asset
 *  rotated 90 degrees. They are identical on screen and the rect keeps the
 *  preview affine-free — the one rotated element this builder draws, the line
 *  chart's segment, is also the one element whose bounding box check 1 has to
 *  sample at four corners rather than read off its size. */
export function crossingHairlines(
  idBase: string, page: string, at: { x: number; y: number }, arm: number, onDark: boolean,
  thickness: number = FRAME.thickness
): Req[] {
  const ink = hairlineInk(onDark);
  const top = Math.max(0, at.y - arm);
  const bottom = Math.min(CANVAS.height, at.y + thickness + arm);
  return [
    ...hairline(`${idBase}h`, page, "bleed", at.y, onDark, thickness),
    ...filledShape(`${idBase}v`, page, "RECTANGLE", ink.color,
      { x: at.x, y: top, width: thickness, height: bottom - top }, ink.alpha),
  ];
}

/** The hung dot: a small disc sitting OUTSIDE the measure, level with the first
 *  line of the paragraph it marks.
 *
 *  Not a Slides bullet. Slides' level-0 disc preset draws its glyph at the text
 *  inset and indents the wrapped lines under the words, so the marker sits
 *  inside the column and every line of prose starts where no line of prose
 *  begins. The deck hangs it into the gutter, which is why its columns read as
 *  columns. That is also why a composition's gutter floor has to be at least
 *  HUNG_DOT.offsetX plus the disc — a dot hung into a 12pt gutter is a dot
 *  drawn on the column to its left.
 *
 *  Vertically it is centred on the first LINE BOX, not on the box: the box
 *  carries Slides' 3.6pt top inset before any ink at all.
 *
 *  IT IS THE DECK'S ONLY BULLET MARKER. Stage 3 shipped it on four layouts and
 *  left five on Slides' preset; rendering the deck showed both markers on one
 *  page and the stored corpus showed 15 of 37 decks drawing both. A reader
 *  asked to look at two markers will look for the difference between them, so
 *  the preset is gone from the builder — `BoxOptions` has no `bullets` any
 *  more — rather than merely unused, and every prose list in the deck runs
 *  through `bulletBlock`. Where a list sits inside a panel the panel's own
 *  padding is the dot's column (see QUAD_PAD); where it sits beside a picture
 *  the gutter is (see image-split's body). */
export const HUNG_DOT = {
  diameter: 5,
  /** The type size `diameter` was chosen against — `read`'s body. The disc is a
   *  mark on a line of prose, so it has to move with the prose: the same 5pt
   *  disc that is right beside 10pt body is 0.63 of an 8pt one, which is the
   *  size a stat slide's bullets step down to under a hero figure, and at that
   *  ratio the mark starts competing with the words. Scaled it stays 0.50 at
   *  every size the deck sets body at, against the source deck's own 0.47. */
  baseSize: 10,
  /** From the left edge of the text box to the left edge of the disc. The
   *  deck's dot sits 11.4pt left of its first glyph, and the glyph itself is
   *  SLIDES_TEXT_INSET.x inside the box. */
  offsetX: 11.4,
  color: COLOR.blue,
} as const;

/** The disc's size beside type of this size. */
export function hungDotSize(fontSize: number): number {
  return HUNG_DOT.diameter * (fontSize / HUNG_DOT.baseSize);
}

export function hungDot(
  objectId: string, page: string,
  box: { x: number; y: number }, fontSize: number,
  color: string = HUNG_DOT.color, diameter: number = hungDotSize(fontSize),
  lineHeight: number = LINE_LEAD
): Req[] {
  const lineTop = box.y + SLIDES_TEXT_INSET.y;
  return filledShape(objectId, page, "ELLIPSE", color, {
    x: box.x + SLIDES_TEXT_INSET.x - HUNG_DOT.offsetX,
    y: lineTop + (fontSize * lineHeight - diameter) / 2,
    width: diameter, height: diameter,
  });
}

/**
 * A PROSE LIST, SET AS A LIST: one box per paragraph, each marked with a hung
 * dot, stacked on a rhythm that binds a wrapped line to the line above it.
 *
 * TWO DEFECTS, ONE SHAPE. Rendering the deck showed both at once and they turn
 * out to be the same mistake seen from two sides.
 *
 * THE RHYTHM WAS INVERTED. One box with Slides' `spaceBelow` between
 * paragraphs was stretched up to 22pt to use the band — so on a 10pt body the
 * step from one bullet to the next was 36.5pt against 14.5pt between the two
 * lines of a bullet that wrapped, a ratio of 2.5. The eye groups by proximity:
 * at that ratio the second line of a wrapped bullet reads as an orphan and two
 * unrelated bullets read as a pair. Space is set BETWEEN PARAGRAPHS and bounded
 * by the leading WITHIN one — PARA_SPACE — and the slack the old code poured
 * into the gaps is not spent at all. A list is not a slack absorber; a
 * three-bullet slide with room under it wants a picture, not looser bullets.
 *
 * THE DOT HAD TO BE A SHAPE. Slides' own BULLET_DISC preset draws its glyph at
 * the text inset and indents every wrapped line 18pt under the words, so the
 * marker sits INSIDE the column and no line of prose starts where the title
 * starts. The handover deck hangs a brand-blue disc into the margin and sets
 * the words on the measure. That disc cannot be a bullet preset — its colour
 * and its size are not the text's — so it is a real ellipse, which has to be
 * POSITIONED, which needs the y of each paragraph's own first line. Hence one
 * box per paragraph: Slides draws a box's first line at the box's top inset and
 * nothing it does to the rest can move it, so the dot is exact whatever the
 * estimator got wrong further down. `hungDot`'s signature says as much — it
 * takes a box and centres on THAT box's first line.
 *
 * AND THE STACK COSTS NOTHING TO READ. A box carries 3.6pt of Slides inset at
 * each end, so boxes stacked flush already give 7.2pt between paragraphs and
 * none within — a 1.50 ratio at 10pt before a single point of gap is added.
 * The inset that made the one-box version measure badly is the paragraph space
 * in this one.
 *
 * WHAT THE SPLITTER SEES IS UNCHANGED IN SHAPE. Under PROBING this draws the
 * one box it always drew, sized to the whole band, so `bodyBox` still reports a
 * ceiling rather than a hug. Two numbers in it do move, and both move the same
 * way — the measure is 18pt wider without Slides' bullet indent, and the
 * reported paragraph space is the 7.2pt the boxes really use rather than the
 * stretched 22 — so the splitter cuts FEWER slides than it did. That direction
 * is the one this file has already been wrong in twice: "seven bullets that
 * fitted a slide were split across two".
 */
/** How much of the line's own leading a paragraph break may add, over and above
 *  the 7.2pt two stacked boxes already give.
 *
 *  0.75 puts the paragraph step at 1.75x the line step at any size — clearly a
 *  break, never a second line. Above 1.0 the break is wider than a line and the
 *  list stops being a list; the old code reached 2.5. */
const PARA_SPACE = 0.75;

/** And the smallest break that still reads as one.
 *
 *  THE STACK COMPRESSES, and it has to. Two boxes that touch give 7.2pt of
 *  paragraph space whether or not the page has 7.2pt to spare, which made a
 *  list 1.2pt per paragraph taller than the single stretched box it replaced —
 *  nothing at all on a slide with room, and on `present`, where the band is a
 *  fifth shorter and a seven-bullet body is already at the edge, exactly enough
 *  to push the last line into the footer. Measured over the 618 stored slides
 *  rebuilt at `present`, that was twenty slides acquiring a fault they did not
 *  have.
 *
 *  So the break is ELASTIC between a quarter of the line and three quarters of
 *  it, and below 7.2pt it is bought by letting the boxes overlap into each
 *  other's INSET — the 3.6pt at each end where Slides draws no glyph. That is
 *  the same trick the table's rows already use, and the overlap sweep already
 *  divides exactly that inset out before it compares, so a compressed list
 *  reports nothing. The compression is bounded by the inset for that reason:
 *  past it the boxes would really meet. */
const PARA_MIN = 0.25;

/** The most a paragraph break may add on top of the 7.2pt two stacked boxes
 *  already give, and the most it may take away. Zero for a face whose leading
 *  is tighter than the inset. */
/** The line step this block is set on. A card body is drawn at 1.3 and a
 *  tightened one at 1.15, and a break measured against the default leading
 *  beside a line that is not on it is the inverted rhythm again in miniature. */
function leadOf(lineSpacing?: number): number {
  return lineSpacing ? 1.26 * lineSpacing : LINE_LEAD;
}
function paraGapCeiling(size: number, lineSpacing?: number): number {
  return Math.max(0, PARA_SPACE * size * leadOf(lineSpacing) - TEXT_INSET_Y);
}
function paraGapFloor(size: number, lineSpacing?: number): number {
  return Math.min(0, PARA_MIN * size * leadOf(lineSpacing) - TEXT_INSET_Y);
}

/** How tall this list is in a box of this width, at a given paragraph gap.
 *
 *  ONE RULER for the drawing below, for the fit ladders that ask whether a list
 *  will go under a figure or a table, and for the splitter's probe. Two of them
 *  is how the builder and the validator came to disagree about the frame, and
 *  the disagreement was the bug.
 *
 *  It is `drawnTextHeight` over the whole list with TEXT_INSET_Y as the
 *  paragraph space, which is exactly what a stack of boxes costs: one inset per
 *  box, and the top inset of box N+1 sits under the bottom inset of box N. */
export function bulletBlockHeight(
  text: string | undefined, width: number,
  style: { size: number; font?: string; caps?: boolean }, gap = 0, lineSpacing?: number,
  opts: { ragged?: boolean } = {}
): number {
  const paras = String(text || "").split("\n").map((l) => l.trim()).filter(Boolean);
  if (!paras.length) return 0;
  // A NARROW MEASURE PAYS FOR ITS RAGGED EDGE — WHERE IT IS ASKED TO.
  //
  // The width decides whether the correction is needed, and the CALLER decides
  // whether this block is one that takes it. Both gates, and the second one is
  // not squeamishness: turning the wrap ruler on under every layout moves 298
  // requests across the 618 stored slides, because a timeline's caption and a
  // swot panel's list are narrow too and their geometry was measured with the
  // count model. This stage may not move a stored deck. So the layouts written
  // against the wrap ruler ask for it, everything else keeps the ruler it was
  // drawn with, and the open issue says which is which.
  const ragged = !!opts.ragged && measuresRagged(width, style.size, style.font);
  let lines = 0;
  for (let i = 0; i < paras.length; i++) {
    lines += Math.max(1, ragged
      ? raggedLines(paras[i], width, style.size, style.font)
      : estimateLines(paras[i], width, style.size, false, !!style.caps, style.font));
  }
  if (paras.length === 1) return drawnTextHeight(lines, style.size, 0, 1, lineSpacing);
  return drawnTextHeight(lines, style.size, TEXT_INSET_Y + gap, paras.length, lineSpacing);
}

/** HOW MUCH OF A COLUMN'S FIRST PARAGRAPH IS ITS LEAD-IN: one sentence, or
 *  none at all.
 *
 *  The tool tells the model a three-column column opens "with one bold accent
 *  sentence", and the first version of this styled the whole first PARAGRAPH
 *  instead. A column written as a single paragraph — which the same tool
 *  description explicitly permits, and which 32 of the 298 stored bodies are —
 *  came out entirely bold brand blue, where the source sets three words that
 *  way and reads on in body copy.
 *
 *  THE CAP IS WHAT MAKES IT A LEAD-IN RATHER THAN A LONG SENTENCE IN BLUE. A
 *  sentence that runs past about sixty characters is most of a narrow column's
 *  first two lines, so past the cap there is no lead-in at all and the
 *  paragraph is body copy like any other. Refusing is the right answer here:
 *  the accent exists to mark the opening of a column, and marking two-thirds
 *  of one marks nothing.
 *
 *  AND THE LENGTH IS NOT A SHORTCUT PAST THE SENTENCE. This returned the whole
 *  string for any paragraph inside the cap, which is right for the source's own
 *  shape and wrong for everything else that is short: rendered, a column
 *  reading "Short. One point." came out bold blue end to end, which is the
 *  defect this function exists to stop, one size down. The scan runs first and
 *  the length is only the FALLBACK — for a paragraph with no stop in it at all,
 *  which is the source's shape exactly: "Work in progress." ends on a full stop
 *  that has no space after it to be found by. */
const LEAD_IN_MAX = 60;
export function leadInLength(para: string | undefined): number {
  const s = drawnText(String(para ?? "")).trim();
  if (!s) return 0;
  // THE FIRST terminal stop, and the closing quote or bracket that may sit on
  // it. A decimal or an abbreviation is not a sentence end, so the stop has to
  // be followed by a space and then a capital, and the scan walks past one that
  // is not rather than stopping there. The FIRST and not the last inside the
  // cap: the tool promises the model one sentence and this function's own
  // heading says one sentence, and taking every whole sentence that fitted
  // sixty characters could accent three of them.
  const m = /[.!?]["'’”)\]]*(?=\s)/g;
  for (;;) {
    const hit = m.exec(s);
    if (!hit) break;
    const at = hit.index + hit[0].length;
    if (at > LEAD_IN_MAX) return 0;
    const next = s.slice(at).replace(/^\s+/, "");
    if (next && next[0] === next[0].toLowerCase() && next[0] !== next[0].toUpperCase()) continue;
    return at;
  }
  return s.length <= LEAD_IN_MAX ? s.length : 0;
}

/** THE SHORTEST BOX A PARAGRAPH MAY BE GIVEN. A text box's height is a claim
 *  on ground and not a limit on ink — Slides draws a box's text from its top
 *  and lets it run — so the floor exists only to keep the height positive, and
 *  it is one constant because two places need the same number: the box's own
 *  clamp, and the probe that decides which paragraphs get a box at all. Read
 *  off different numbers they disagreed, and a paragraph starting less than a
 *  point above its band's foot was drawn as a box ending below it. */
const MIN_BOX_H = 1;

/** A COLUMN'S LEAD-IN: the first SENTENCE set in the accent, with no dot.
 *
 *  The handover deck's three-column pages open every column with one bold blue
 *  sentence and then set the rest of the column under it. It is NOT a heading
 *  — it is the first sentence of the column, and it reads on from the title
 *  rather than labelling what follows — so it takes no marker: a hung disc in
 *  front of it would make it the first item of a list whose remaining items
 *  are its own continuation.
 *
 *  It steps the WEIGHT and the COLOUR and never the size, which is what keeps
 *  this a style swap rather than a second layout engine: every height, every
 *  line count and every gap below is measured exactly as it was, so a column
 *  with a lead-in and a column without lay out identically.
 *
 *  AND IT IS A RANGE INSIDE THE PARAGRAPH, not the paragraph. When the whole
 *  first paragraph IS one sentence — the source's own shape — the range covers
 *  it and nothing has changed; when the column is one paragraph of several
 *  sentences, only the first is accented. See leadInLength. */
function bulletBlock(
  id: (s: string) => string, key: string, page: string,
  text: string | undefined, style: TypeStyle,
  box: { x: number; y: number; width: number; height: number },
  opts: {
    align?: "START" | "CENTER" | "END"; lead?: number; leadIn?: TypeStyle;
    /** Measure this block's paragraphs by wrapping them on WORDS when the
     *  column is narrow enough to need it. See bulletBlockHeight for why the
     *  caller asks rather than the width alone deciding. */
    ragged?: boolean;
  } = {}
): { requests: Req[]; bottom: number } {
  const lead = opts.lead;
  const firstPara = String(text || "").split("\n").map((l) => l.trim()).filter(Boolean)[0];
  /** How many characters of paragraph 0 the accent covers. Zero means no
   *  lead-in on this column at all, which is what a first paragraph with no
   *  sentence break inside the cap gets. */
  const leadChars = opts.leadIn ? leadInLength(firstPara) : 0;
  /** Whether the accent covers the WHOLE first paragraph, in which case the
   *  box is simply drawn in the accent style and no range is needed. */
  const leadWhole = leadChars > 0 && leadChars >= drawnText(String(firstPara ?? "")).trim().length;
  /** The style a paragraph is drawn in, and whether it carries a marker. A
   *  paragraph that OPENS with the accent takes no marker either way: the
   *  lead-in is the first words of the column, not the first item of a list. */
  const styleAt = (i: number): TypeStyle => (i === 0 && leadWhole && opts.leadIn ? opts.leadIn : style);
  const dotAt = (i: number): boolean => !(i === 0 && leadChars > 0);
  /** The accent range a paragraph carries, for the partial case. */
  const rangeAt = (i: number): BoxOptions["leadRange"] =>
    i === 0 && leadChars > 0 && !leadWhole && opts.leadIn
      ? { chars: leadChars, color: opts.leadIn.color } : undefined;
  /** HOW MANY LINES A PARAGRAPH TAKES, and the lead-in is not asked the same
   *  way as the rest.
   *
   *  `faceAdvance` answers 0.443 for Roboto, which is LIGHT's mixed-case mean
   *  plus 6% — the weight every bullet in this deck is set in. A lead-in is
   *  Roboto Bold, which is wider per glyph, so measured at the body's own
   *  advance a lead-in near a wrap boundary would be counted at one line and
   *  drawn at two, and everything below it would be placed a line high.
   *
   *  Measured through `labelWidthPt` rather than by inventing a bold mean:
   *  that sums the REAL per-glyph advances of the bold face, measured off
   *  Google's own webfont, and its header already gives the reason a mean is
   *  the wrong ruler here — a lead-in is one sentence, which is too short for
   *  a mean to average out.
   *
   *  BUT SUMMING A WIDTH AND DIVIDING BY THE MEASURE ROUNDS UP AT EVERY
   *  BOUNDARY, which is the error in the other direction: two columns whose
   *  lead-ins render to the same depth started their next paragraph 14.5pt
   *  apart, one boxed for three lines and drawing two. So a narrow column
   *  wraps its paragraphs WORD BY WORD instead, with the accent's own glyphs
   *  where the accent reaches — see raggedLines, which answers both errors
   *  with the renderer's own algorithm. */
  const ragged = !!opts.ragged && measuresRagged(box.width, style.size, style.font);
  const linesAt = (i: number, para: string): number => {
    const bolded = i === 0 ? leadChars : 0;
    if (ragged) return Math.max(1, raggedLines(para, box.width, style.size, style.font, bolded));
    if (i === 0 && leadWhole && opts.leadIn) {
      const usable = Math.max(opts.leadIn.size, box.width - TEXT_INSET_X);
      return Math.max(1, Math.ceil(labelWidthPt(para, opts.leadIn.size, { face: "Roboto" }) / usable));
    }
    return Math.max(1, estimateLines(para, box.width, style.size, false, !!style.caps, style.font));
  };
  const paras = String(text || "").split("\n").map((l) => l.trim()).filter(Boolean);
  if (!paras.length) return { requests: [], bottom: box.y };
  // THE PROBE GETS THE OLD SHAPE. See the header: the splitter asks this layout
  // how much room the field has, and a stack of boxes drawn to fit two sentinel
  // paragraphs would answer "two paragraphs".
  //
  // AND IT IS ASKED AT THE BLOCK'S FLOOR, not at its ceiling. The question the
  // splitter asks is "will this overflow", and the break is elastic: the block
  // compresses into the insets before it runs over. Probed at the ceiling —
  // the gap a list takes when the band has slack to give it — six bullets that
  // fit a half-width column were reported as not fitting and the slide was cut
  // in two. This file has been wrong in that direction twice, and cutting a
  // slide that would have fitted is a bigger intervention than setting its list
  // tight.
  if (PROBING) {
    // AND IT TELLS THE PROBE WHICH RULER IT WOULD HAVE USED. bodyBox reads the
    // size, the face and the paragraph gap back out of the requests, because
    // they are in them; the choice of ruler is not, and a field wrapped on
    // words when drawn and divided by a character count when probed splits too
    // late and runs off the page. Set only on the block holding the sentinel,
    // so the OTHER fields' blocks on the same probe cannot answer for it.
    if (ragged && paras.join("\n").indexOf(PROBE) >= 0) PROBE_RAGGED = true;
    return {
      requests: textBox(id(key), page, paras.join("\n"), style, box,
        { align: opts.align, lineSpacing: lead, spaceBelow: paraGapFloor(style.size, lead) + TEXT_INSET_Y }),
      bottom: box.y + box.height,
    };
  }
  // A single paragraph is not a list. Drawn with a disc it reads as a stray
  // bullet — the same call textBox already makes for Slides' own preset.
  if (paras.length === 1) {
    const h = drawnTextHeight(linesAt(0, paras[0]), styleAt(0).size, 0, 1, lead);
    return {
      requests: textBox(id(key), page, paras[0], styleAt(0), box,
        { align: opts.align, lineSpacing: lead, spaceBelow: 0, leadRange: rangeAt(0) }),
      bottom: box.y + Math.min(box.height, h),
    };
  }
  const heights = paras.map((p, i) => drawnTextHeight(linesAt(i, p), styleAt(i).size, 0, 1, lead));
  // The stack's own height, which is what the elastic gap is solved against.
  // With a lead-in it has to be the sum of the boxes, because the lead-in's
  // line count is not the one bulletBlockHeight would compute; without one the
  // two are the same number and the established call is kept, so no existing
  // list can move by a float.
  let natural = bulletBlockHeight(text, box.width, style, 0, lead, { ragged: opts.ragged });
  if (leadChars > 0) { natural = 0; for (let i = 0; i < heights.length; i++) natural += heights[i]; }
  const slack = box.height - natural;
  const gap = Math.max(paraGapFloor(style.size, lead),
    Math.min(paraGapCeiling(style.size, lead), slack / (paras.length - 1)));
  // Light ink means a dark ground, where brand blue is 2.39:1. Derived from the
  // style rather than passed in, so no call site can get it wrong — the same
  // rule accentColorFor already applies to the accent phrase.
  const dot = accentColorFor(style) || HUNG_DOT.color;

  // HOW MANY PARAGRAPHS START INSIDE THE ROOM THEY WERE GIVEN.
  //
  // Clamping a box's HEIGHT to the band is not enough, and the first version of
  // this got that wrong in a way no check could see. Once `y` has walked past
  // the foot, every later paragraph is still drawn — one line tall, at whatever
  // `y` reached — so a list that does not fit marches off the bottom of the
  // page and the words on those boxes are missing from the deck rather than
  // overflowing on it. Twenty stored slides at `present` went off-canvas that
  // way, against zero before, and the old single stretched box never could.
  //
  // So the block DEGRADES TO THE SHAPE IT REPLACED exactly when it stops
  // fitting: the paragraphs that no longer have a top edge inside the band are
  // drawn as the tail of the last one that does. Slides draws a box's text from
  // its top and lets it run, so every word is still on the page, and the fault
  // reads the way it always did — one body running over its box, not a column
  // of boxes walking off the slide.
  const foot = box.y + box.height;
  let drawn = paras.length;
  {
    let probe = box.y;
    for (let i = 0; i < paras.length; i++) {
      // AND THE TEST IS THE FLOOR'S, NOT THE FOOT'S. The draw loop below gives
      // every box a positive height — MIN_BOX_H when the band has less than
      // that left — so a paragraph whose top is inside the band by less than
      // the floor was drawn as a box that ends OUTSIDE it. On a full photo
      // rail that was 0.2pt past the foot of the photograph the columns are
      // squared off against, which is the one place in this deck where a box's
      // foot is asserted against a drawn edge rather than against the margin.
      // The two numbers were written a dozen lines apart and disagreed; read
      // off one constant they cannot, and a paragraph with no room for a box
      // takes the path this block already exists to take — the tail of the
      // last one that has.
      if (i > 0 && probe > foot - MIN_BOX_H) { drawn = i; break; }
      probe += heights[i] + gap;
    }
  }
  if (drawn < paras.length) {
    const tail = paras.slice(drawn - 1).join("\n");
    paras.length = drawn;
    paras[drawn - 1] = tail;
    heights[drawn - 1] = drawnTextHeight(
      linesAt(drawn - 1, tail), styleAt(drawn - 1).size, 0, 1, lead);
    heights.length = drawn;
  }

  const requests: Req[] = [];
  let y = box.y;
  for (let i = 0; i < paras.length; i++) {
    // THE FIRST BOX KEEPS THE BARE SUFFIX. An object id's suffix is this
    // deck's only handle on what a box IS — `pathOf` turns it into the spec
    // path that makes the box editable in the preview, `validate.ts` names it
    // in a fault, and the rail's own drop check reads `_body` off it. A list
    // that renamed every box to `body0` would take the field's name off the
    // slide. So the field keeps its name and the continuation paragraphs are
    // numbered from one, and pathOf maps the numbered ones back to the same
    // field — every paragraph of `body` edits `body`, exactly as the single
    // box it replaced did.
    // THE BOX BELONGS TO THE BAND, THE INK BELONGS TO THE CONTENT. A box is
    // never drawn past the foot of the room it was given, even when the words
    // in it are: Slides draws a box's text from its TOP and lets it run, so
    // clamping the height moves no glyph — it keeps the box out of the
    // footer's, which is where the single stretched box it replaced always
    // stayed. Every box's top edge is inside the band by construction, and
    // after this its foot is too, which is what a check can assert without
    // restating this expression back at itself.
    //
    // THE FLOOR IS A POSITIVE HEIGHT, not a line. It was one line, so the last
    // box of a list at the cliff could reach a line past the room it was given
    // — 1.4pt outside a swot panel's own tint at `present`, which reads as
    // words that have escaped their box. Slides draws a box's text from the top
    // and lets it run whatever the box's height is, so a short box loses no
    // glyph; it only stops the BOX making a claim on ground the layout did not
    // give this field.
    const room = Math.max(MIN_BOX_H, foot - y);
    requests.push(...textBox(id(i === 0 ? key : `${key}${i}`), page, paras[i], styleAt(i),
      { x: box.x, y, width: box.width, height: Math.min(heights[i], room) },
      { align: opts.align, lineSpacing: lead, spaceBelow: 0, leadRange: rangeAt(i) }));
    if (dotAt(i)) requests.push(...hungDot(id(`${key}dot${i}`), page, { x: box.x, y }, style.size, dot,
      hungDotSize(style.size), leadOf(lead)));
    y += heights[i] + (i < paras.length - 1 ? gap : 0);
  }
  return { requests, bottom: y };
}

/** WHICH OF A LAYOUT'S COLUMN FIELDS ACTUALLY CARRY WORDS, in the order the
 *  layout draws them.
 *
 *  One function for both prose bands, because the rule is one rule: the count
 *  comes from the CONTENT. Written twice it was followed once — the
 *  three-column band derived its count and the photo rail hard-coded two, so a
 *  photo-rail slide with a single column of copy drew it at half the band, and
 *  every continuation of a split one did the same because the splitter clears
 *  `bodyRight`. A slide with none of them still gets one column, which is what
 *  `droppedContent` reports against. */
function columnFields(
  slide: SlideInput, keys: readonly string[]
): { key: string; text: string | undefined }[] {
  const out: { key: string; text: string | undefined }[] = [];
  for (let i = 0; i < keys.length; i++) {
    const text = (slide as any)[keys[i]] as string | undefined;
    if (String(text || "").trim()) out.push({ key: keys[i], text });
  }
  return out.length ? out : [{ key: keys[0], text: (slide as any)[keys[0]] }];
}

/** The size a prose column may be set at before it stops being body copy. The
 *  deck's own caption floor, and the size the footer sits at. */
const COLUMN_MIN_SIZE = 8;

/** A FIT LADDER FOR A BAND OF PROSE COLUMNS, and an admission when the ladder
 *  runs out.
 *
 *  `splitOnce` divides `body` and only `body`, which is right for a layout
 *  with one column and leaves the sibling columns with nothing between them
 *  and the trim: `bodyRight` and `bodyThird` are never split, and their
 *  measure is half the inherited pair's, so the threshold roughly halves
 *  twice over. Measured, at `present`: a two-column right-hand field runs off
 *  the page at about 70 words, a photo rail's at 50, and a three-column band's
 *  third field at 50 — with no note printed, no size tried and the words drawn
 *  straight through the footer.
 *
 *  `serpentine` in the same stage has a ladder and two on-slide admissions,
 *  and the inconsistency was internal to one stage. So the band steps down a
 *  point at a time to the caption floor, and when the floor will not hold it
 *  either the slide SAYS SO — in the slot every other diagram here uses — and
 *  the model is told which way to fix it. A note-free build passes every
 *  geometric check there is.
 *
 *  THE WHOLE BAND STEPS TOGETHER. Setting only the offending column smaller
 *  would make one column of three a different size from its neighbours, which
 *  reads as a mistake rather than as a fit. */
function columnFit(
  shown: { key: string; text: string | undefined }[],
  width: number, room: number, style: TypeStyle
): { style: TypeStyle; over: number; size: number } {
  const need = (size: number): number => {
    let worst = 0;
    for (let i = 0; i < shown.length; i++) {
      worst = Math.max(worst, bulletBlockHeight(shown[i].text, width, { ...style, size }, 0, undefined,
        { ragged: true }));
    }
    return worst;
  };
  let size = style.size;
  let over = need(size) - room;
  while (over > 0.5 && size > COLUMN_MIN_SIZE) {
    size = Math.max(COLUMN_MIN_SIZE, size - 1);
    over = need(size) - room;
  }
  return { style: size === style.size ? style : { ...style, size }, over: Math.max(0, over), size };
}

/** What a column band that still does not fit says on the slide, and to the
 *  model. See columnFit: nothing is DROPPED — bulletBlock draws the tail of a
 *  list that has run out of band as the last box's own continuation, so every
 *  word is on the page and some of it is past the design. "Showing N of M"
 *  would be a claim about missing content and this is a claim about the
 *  measure, so it does not borrow that sentence. */
function columnOverfullNote(
  objectId: string, page: string, fit: { over: number; size: number },
  note: ((s: string) => void) | undefined, layout: string
): Req[] {
  if (fit.over <= 0.5) return [];
  if (note) {
    note(`this ${layout} slide's columns hold ${Math.ceil(fit.over)}pt more copy than the band has room for,`
      + ` even set at ${fit.size}pt — shorten a column, or move the longest one onto a second slide`);
  }
  return noteBox(objectId, page, "Column copy clipped for room", CANVAS.height - GRID.margin - 16);
}

/** The CTA pill: a label in a filled capsule — "Book a session", "Read the
 *  report" — the one device on a closing slide that looks like something to do.
 *
 *  A SOFTER CORNER THAN THE SOURCE, deliberately. createShape exposes no
 *  geometry adjustments, so ROUND_RECTANGLE renders at Slides' default radius
 *  and the source's adj=50000 true capsule is unreachable. Composing one from
 *  a rect and two ellipses would reach it at three shapes per pill, for a
 *  radius nobody will measure and three more objects for the preview, the PDF
 *  and the overlap sweep to agree about. The corner is the right thing to give
 *  up.
 *
 *  THE LABEL IS WHITE, not the source's #FFD966. That colour is the theme's
 *  hyperlink colour leaking onto a hyperlinked label — 4.08:1 on brand blue
 *  against white's 5.58:1 — which makes it a defect in the source rather than
 *  a design choice, and copying a defect because it is in the reference is not
 *  fidelity. */
export const PILL = {
  height: 26,
  padX: 14,
  fontSize: 10,
  fill: COLOR.blue,
  fillOnDark: COLOR.lime,
} as const;

export function ctaPill(
  idBase: string, page: string, label: string,
  at: { x: number; y: number }, onDark: boolean
): Req[] {
  const text = String(label || "").trim();
  if (!text) return [];
  const fill = onDark ? PILL.fillOnDark : PILL.fill;
  const width = pillWidth(text, PILL.fontSize) + PILL.padX * 2;
  return [
    ...filledShape(`${idBase}bg`, page, "ROUND_RECTANGLE", fill,
      { x: at.x, y: at.y, width, height: PILL.height }),
    // textOn, not a written-down colour: the fill differs by ground and the
    // ink has to follow it rather than be remembered alongside it.
    ...textBox(`${idBase}tx`, page, text,
      { font: "Roboto", size: PILL.fontSize, bold: true, color: textOn(fill), caps: true },
      { x: at.x, y: at.y, width, height: PILL.height },
      { align: "CENTER", vCenter: true }),
  ];
}

/* ─────────────── The stepper ─────────────── */

/**
 * The numbered rail: where this slide sits in the deck's spine, along the top.
 *
 * ONE RIGHT-ALIGNED PARAGRAPH, not one box per numeral, which is what the
 * source deck does and is the better shape here for a reason it did not have:
 * a box is what the overlap sweep, `droppedContent` and `pathOf` each walk, so
 * nine numerals as nine boxes is nine things for every one of them to agree
 * about, and eight adjacencies to keep from touching. As one box the tracking
 * is spaces — the Slides API TextStyle carries no letter-spacing field, so
 * spaces are the only tracking there is — and the current step is a run style
 * over three characters of it, which `preview-model` already carries as an
 * accent range and the PDF already prints.
 *
 * IT IS DRAWN BY THE FRAME, from `slide.step`, which the model never writes.
 * See deckSteps in edit.ts for where the numbers come from and stampSteps for
 * when they are re-derived.
 */

/** The rail's text, and the character range the current numeral occupies in it.
 *  Both from one function, because they are one fact: an index computed
 *  separately from the string it indexes is a range that goes wrong the day
 *  somebody changes the separator. */
export function stepperRail(step: SlideStep): { text: string; start: number; end: number } {
  let text = "";
  let start = 0, end = 0;
  for (let i = 1; i <= step.of; i++) {
    if (i > 1) text += STEPPER.separator;
    const glyph = String(i);
    if (i === step.n) { start = text.length; end = text.length + glyph.length; }
    text += glyph;
  }
  return { text, start, end };
}

/** The rail's box: right-aligned to where the eyebrow's own box ends, on the
 *  eyebrow's line.
 *
 *  THE SAME RIGHT EDGE, deliberately. `GRID.eyebrowWidth` stops 14.4pt short of
 *  the lockup so a long eyebrow cannot run underneath it, and the rail wants
 *  exactly that clearance for exactly that reason. Sharing the edge also means
 *  the two ends of this line are the two ends of ONE line, which is the footer's
 *  contract one band up.
 *
 *  Its top is the eyebrow's top rather than a centring of the two, so the two
 *  line boxes start at the same y and the caps and the digits sit on one
 *  optical line. Its foot, at 12pt, is 46.20 — a clear half point above the
 *  frame's top hairline at 46.80, which is what "over the hairline" means. */
export function stepperBox(step: SlideStep): { x: number; y: number; width: number; height: number } {
  const text = stepperRail(step).text;
  // WIDE ENOUGH FOR THE RULER THAT WILL MEASURE IT, not only for the one that
  // sizes it. `labelWidthPt` sums the real glyph advances and is the right
  // ruler for a label; `estimateLines` — which is what `inkBottom`, the
  // validator and the splitter all reach for on a box that is not bold — uses
  // Roboto's mixed-case MEAN, and eighteen spaces in a twenty-five character
  // string is nothing like the mean. Sized on the glyphs alone the rail draws
  // perfectly on one line and MEASURES as two, so the frame's top hairline
  // yields to ink that is not there and the validator reports an overrun on
  // every stepped slide in the deck. The extra room falls to the LEFT of an
  // end-aligned box, where nothing can see it.
  const ink = labelWidthPt(text, STEPPER.size, { face: "Roboto" });
  // The +1 is the floor in estimateLines' own `perLine`: at exactly the right
  // width the division is a float equality, and losing it costs a whole line.
  const measured = (text.length + 1) * STEPPER.size * faceAdvance("Roboto");
  const width = Math.max(ink, measured) + TEXT_INSET_X;
  const right = GRID.margin + GRID.eyebrowWidth;
  return { x: right - width, y: GRID.eyebrowY, width, height: drawnTextHeight(1, STEPPER.size) };
}

/** Does this page's ground hold a rail at all?
 *
 *  Off-white, white and navy do. A PHOTOGRAPH DOES NOT, and this is measured
 *  rather than cautious: the baked gradient behind a full-bleed layout is
 *  solved to carry WHITE at 4.5:1, which puts the ground it produces at about
 *  0.18 relative luminance — and #8F8F8F on that reads 1.43:1. The inactive
 *  numeral is the whole device; a rail whose six greyed numerals are invisible
 *  answers "how much is left" with nothing. It is the same call the frame makes
 *  for the section divider's blue: a ground the chrome was not designed for
 *  takes none of it, rather than shipping it unreadable. */
function groundHoldsRail(style: LayoutStyle): boolean {
  return style.background !== null;
}

/** Does this LAYOUT's top band hold a rail?
 *
 *  The rail ends where the eyebrow's box ends — `GRID.margin + GRID.eyebrowWidth`
 *  — because the two are the two ends of one line. That is only true of the
 *  layouts whose eyebrow is ON that line. Two are not:
 *
 *  `section` draws its own chapter numeral in the header slot and takes none of
 *  the frame, the rail included; it still CARRIES a step, because that numeral
 *  is now stamped from it.
 *
 *  `image-split` puts its eyebrow in the right-hand text column, at x=380.16 —
 *  so a rail ending at 611.28 lands INSIDE that column and the eyebrow gives up
 *  most of its own measure to it. Measured against the 235 real eyebrows in the
 *  stored corpus, 43% no longer fit at three steps and 79% at seven: "AI
 *  VISIBILITY REVIEW" stacks as three lines and runs down into the standfirst.
 *  Re-aligning the rail to that column's right edge is not the answer either —
 *  695.52 runs under the lockup at 625.68. A page whose top band is a
 *  photograph and a column has no chrome line to put a rail on, so it takes
 *  none, which is the same call this file already makes for a ground the chrome
 *  was not designed for. */
const RAIL_SKIP_LAYOUTS = ["section", "image-split"];
function layoutHoldsRail(layout: string): boolean {
  return RAIL_SKIP_LAYOUTS.indexOf(layout) < 0;
}

/** WHERE THE PAGE'S OWN FURNITURE STARTS.
 *
 *  The frame is drawn for a page made of paper: two hairlines that bleed to the
 *  trim, a running head at the left of the lower one. `image-split` is not that
 *  page. Its photograph bleeds off the left edge and down to the bottom trim,
 *  so the bleeding rules cut the picture into three bands and the running head
 *  — a 6pt grey line — is drawn over whatever the photograph happens to be
 *  there: legible on a pale tower, invisible on a dark one, and never a
 *  decision anybody made.
 *
 *  So on that layout the chrome belongs to the TYPE column: the rules start
 *  where the words do, and the running head starts with them. The photograph
 *  keeps all four of its edges, which is the whole argument for bleeding it. */
function chromeSpanFor(slide: SlideInput, layout: string): { from: number; to: number } {
  const right = GRID.margin + GRID.contentWidth;
  if (layout === "image-split") return { from: IMAGE.splitTextX, to: right };
  // A RAIL PICTURE TAKES THE RIGHT END. `content` and `case-study` bleed a
  // photograph off the right and bottom trim, so the footer's rule ran across
  // it and the folio was drawn in brand blue over whatever the picture happened
  // to be — on a dark frame, invisible. The chrome stops where the picture
  // starts, which is where the page stops being paper.
  const rail = railBox(slide);
  if (rail) return { from: GRID.margin, to: Math.min(right, rail.x - RAIL_CHROME_GAP) };
  return { from: GRID.margin, to: right };
}
/** The air between the end of the page's furniture and a bleeding picture. */
const RAIL_CHROME_GAP = 10;

function stepperRequests(
  objectId: string, page: string, step: SlideStep, onDark: boolean
): Req[] {
  const rail = stepperRail(step);
  const box = stepperBox(step);
  const out = textBox(objectId, page, rail.text,
    { font: "Roboto", size: STEPPER.size, weight: 400, color: STEPPER.inactive },
    box, { align: "END", spaceBelow: 0, lineSpacing: 1.0 });
  if (!out.length) return out;
  out.push({
    updateTextStyle: {
      objectId,
      textRange: { type: "FIXED_RANGE", startIndex: rail.start, endIndex: rail.end },
      style: {
        bold: true,
        foregroundColor: { opaqueColor: { rgbColor: rgb(onDark ? STEPPER.activeOnDark : STEPPER.active) } },
      },
      fields: "bold,foregroundColor",
    },
  });
  return out;
}

/** The room an eyebrow has left on the chrome line once the rail has taken the
 *  right end of it.
 *
 *  The eyebrow gives up EXACTLY what the rail measures and not a point more,
 *  which is why this is computed from the rail's own box rather than written
 *  down as a reserve: a three-step rail costs the eyebrow 59pt and a nine-step
 *  one costs 160, and a fixed reserve would be wrong in both directions. On a
 *  slide with no rail nothing is given up and the eyebrow is the width it has
 *  always been — which is what keeps the 618 stored slides where they are. */
function eyebrowRoom(step: SlideStep | undefined, x: number, width: number): number {
  if (!step) return width;
  const box = stepperBox(step);
  return Math.max(0, Math.min(width, box.x - STEPPER.gutter - x));
}

/* ─────────────── The deck frame ─────────────── */

/**
 * The page's own furniture, stamped once per slide after the content.
 *
 * `stampFooter` is the precedent: a deck-wide element the BUILDER owns, not
 * the model. Nothing here is on the slide spec, nothing here can be asked for
 * per slide, and nothing here moves when a layout changes.
 *
 * DRAWN LAST, AND EVERY RULE MEASURES THE PAGE BEFORE IT IS DRAWN.
 *
 * The first version of this asserted its way to the bands instead: the top rule
 * between the lockup and the title floor, the bottom one between the takeaway
 * bar's floor (374.4) and the footer's box (381), "in a gap that already
 * existed". THE BOTTOM GAP DOES NOT EXIST. A chart's source line is placed from
 * where its own plot ends rather than from the band floor — `lsrc` at the
 * band's bottom plus two, `csrc` under the last bar — so on a chart with enough
 * rows its 7pt line runs to 378.3, and the rule at 376 is drawn along the
 * baseline and through every descender. Over the 618 stored slides that is ten
 * of them, in nine of the thirty-seven decks, all of them real client work, at
 * the DEFAULT density. Nothing would have said so: a rule is a rect, so the
 * overlap sweep never compares it with the line it strikes.
 *
 * So the rule yields. Furniture that strikes a sentence is worse than furniture
 * that is absent, and yielding is also the only version of this that survives a
 * layout nobody has written yet. The alternative — moving the source line up
 * two points — moves type on decks that have already gone to clients, which is
 * the one thing this stage promised not to do.
 *
 * IT IS RARE, WHICH IS WHY A MISSING RULE IS THE RIGHT PRICE. Of the 558 stored
 * slides that carry the chrome, 506 draw the bottom rule, 39 are section
 * dividers that take none by design, and 13 yield: ten to a chart's source
 * credit and three to a body box the validator is already reporting as an
 * overrun. A tested-by-box-instead-of-ink version of this yields on 47, mostly
 * to table cells that deliberately overhang their row and never reach the rule.
 *
 * The page number does NOT yield, and the asymmetry is the point: a missing
 * hairline is furniture nobody counts, and a missing page number is a hole in a
 * sequence. Its slot is cut out of the footer's own line instead.
 *
 * The paper is a page BACKGROUND rather than an element, so it needs no
 * z-order, cannot be selected in Drive, and adds nothing for the overlap
 * sweep, pathOf or droppedContent to walk.
 */
/** Is the strip of page a full-bleed rule would occupy free of type?
 *
 *  The same comparison check 47(d) makes on the drawn slide, and deliberately
 *  the same shape: a box that starts below the rule is under it, ink that stops
 *  above the rule is over it, and anything else is a line with a rule through
 *  it. Ink that has already left its own box counts — the reader sees the
 *  strike whether or not the validator is separately reporting the overrun. */
function bandIsClear(
  ink: { top: number; bottom: number }[], y: number, thickness: number = FRAME.thickness
): boolean {
  for (let i = 0; i < ink.length; i++) {
    if (ink[i].top < y + thickness && ink[i].bottom > y) return false;
  }
  return true;
}

function frameRequests(
  page: string, id: (s: string) => string, style: LayoutStyle, index: number,
  /** False on a SECTION DIVIDER, which takes the ground and the folio and
   *  neither hairline.
   *
   *  The top one because there is no lockup and no title block there to
   *  separate, and because the divider's 100pt index numeral runs from
   *  GRID.eyebrowY straight through where that rule lands — a rect struck
   *  through a numeral, which the overlap sweep would not report.
   *
   *  The bottom one because of the ground. A divider is drawn on brand blue,
   *  and the rule's dark-ground ink — #EBEBEB at 0.45, which reads 3.44:1 on
   *  navy — reads 2.06:1 on blue, under the 3:1 floor this file holds even
   *  large text to. There is no strength that fixes it: fully opaque, #EBEBEB
   *  on blue is 4.68:1, so the alpha that clears 3:1 is 0.7 and a 0.7 rule on
   *  navy is a stripe rather than a hairline. The hairline is designed for two
   *  grounds, off-white and navy, and the divider is neither; its own colour
   *  is the separation. Check 47(d) states this as the general rule — a rule
   *  that is drawn must read on the ground it is drawn on — so a third ground
   *  arriving with a layout fails the check instead of shipping invisible. */
  rules: boolean,
  /** Every text box already drawn on this page, as top-of-box to bottom-of-ink.
   *  See SLIDE_INK. */
  ink: { top: number; bottom: number }[],
  /** Where this slide sits in the deck's spine, or undefined on a slide that is
   *  not on it. Stamped, never the model's — see deckSteps. */
  step?: SlideStep,
  /** Where the furniture starts and stops — see chromeSpanFor. The full content
   *  measure on every page whose ground is the page's own, and less than it on
   *  one where a photograph has taken an end of the line. */
  chrome: { from: number; to: number } = { from: GRID.margin, to: GRID.margin + GRID.contentWidth }
): Req[] {
  const out: Req[] = [];
  const onDark = style.onDark;
  // A photo-led slide sets no ground of its own (background === null) and the
  // backdrop covers the page; a dark slide's ground is the point of it. The
  // paper sheet is near-white, so it belongs to the light grounds and nowhere
  // else — under navy it is not a texture, it is a missing background.
  if (!onDark && style.background != null) {
    out.push({
      updatePageProperties: {
        objectId: page,
        pageProperties: {
          pageBackgroundFill: {
            stretchedPictureFill: { contentUrl: assetUrl(FRAME.paperPath) },
          },
        },
        fields: "pageBackgroundFill.stretchedPictureFill",
      },
    });
  }
  // THE RAIL BEFORE THE RULES, so its numerals are in the ink ledger when the
  // top hairline decides whether it has a band to draw in. They are designed
  // not to meet — the rail's foot is 46.20 and the rule is at 46.80 — and a
  // check asserts that a stepped page still draws its top rule. The order is
  // what keeps that a check rather than a coincidence: if the two ever do meet,
  // the rule gives way, the way it already gives way to a chart's source line.
  if (step && rules && groundHoldsRail(style)) {
    out.push(...stepperRequests(id("step"), page, step, onDark));
  }
  // The top rule only exists at a density whose title floor leaves room for
  // it. At `read` there is none to leave: see DENSITY.read.topRuleY.
  const topY = density().topRuleY;
  const full = GRID.margin + GRID.contentWidth;
  const reach: HairlineReach = chrome.from > GRID.margin || chrome.to < full
    ? { from: chrome.from, to: chrome.to } : "bleed";
  if (rules && topY !== null && bandIsClear(ink, topY)) {
    out.push(...hairline(id("frTop"), page, reach, topY, onDark));
  }
  if (rules && bandIsClear(ink, FRAME.bottomRuleY)) {
    out.push(...hairline(id("frBot"), page, reach, FRAME.bottomRuleY, onDark));
  }
  // The number is the BUILDER'S, from the index it was handed, and every route
  // that draws a deck rebuilds every slide through here — so it renumbers on
  // an insert rather than fossilising the way a model-written number would.
  out.push(
    ...textBox(id("ftn"), page, String(index + 1),
      onDark ? { ...TYPE.footerNumber, color: COLOR.lime } : TYPE.footerNumber,
      {
        x: chrome.to - FRAME.numberWidth, y: FOOTER_Y,
        width: FRAME.numberWidth, height: 12,
      }, { align: "END" }),
  );
  return out;
}

/** A real horizontal timeline: one axis, evenly spaced markers, labels above
 *  and below. Milestones are spaced by slot rather than by date, because these
 *  decks show sequence and ownership, not duration — proportional spacing would
 *  crush three August dates against one another to no benefit. */
function timelineRequests(
  page: string,
  id: (s: string) => string,
  milestones: Milestone[]
): Req[] {
  const requests: Req[] = [];
  // Bounded, because the columns are the canvas width divided by the count and
  // nothing else gives. At eight the column is 84pt — about nine characters of
  // 12pt Playfair — so "Questionnaire" wraps to three lines and runs straight
  // through the detail beneath it, on every one of the eight.
  const shown = milestones.filter(Boolean).slice(0, TIMELINE.maxMilestones);
  const droppedMilestones = milestones.length - shown.length;
  const n = shown.length;
  if (!n) return requests;

  requests.push(
    ...filledShape(id("axis"), page, "RECTANGLE", COLOR.periwinkle, {
      x: GRID.margin,
      y: TIMELINE.axisY - TIMELINE.axisThickness / 2,
      width: GRID.contentWidth,
      height: TIMELINE.axisThickness,
    })
  );

  const slot = GRID.contentWidth / n;
  const labelWidth = slot - TIMELINE.slotGutter;

  // The name's band grows to fit the longest name, and the detail starts under
  // it. Both were fixed constants, so a two-line name overlapped its own
  // detail rather than pushing it down.
  let titleLines = 1;
  for (let i = 0; i < n; i++) {
    titleLines = Math.max(titleLines, estimateLines(shown[i].title, labelWidth, TYPE.milestoneName.size));
  }
  const titleHeight = Math.max(TIMELINE.titleHeight, drawnTextHeight(titleLines, TYPE.milestoneName.size));
  const detailY = TIMELINE.titleY + titleHeight + TIMELINE.bandGap;
  const noteReserve = droppedMilestones > 0 ? 20 : 0;
  const detailHeight = Math.max(24, CANVAS.height - GRID.margin - noteReserve - detailY);

  shown.forEach((m, i) => {
    const centre = GRID.margin + slot * (i + 0.5);
    const size = m.highlight ? TIMELINE.markerSizeHighlight : TIMELINE.markerSize;
    const labelX = centre - labelWidth / 2;

    requests.push(
      ...filledShape(id(`dot${i}`), page, "ELLIPSE", m.highlight ? COLOR.blue : COLOR.navy, {
        x: centre - size / 2,
        y: TIMELINE.axisY - size / 2,
        width: size,
        height: size,
      }),
      ...textBox(id(`d${i}`), page, m.date, TYPE.milestoneDate, {
        x: labelX, y: TIMELINE.dateY, width: labelWidth, height: TIMELINE.dateHeight,
      }, { align: "CENTER" }),
      ...textBox(id(`t${i}`), page, m.title, TYPE.milestoneName, {
        x: labelX, y: TIMELINE.titleY, width: labelWidth, height: titleHeight,
      }, { align: "CENTER" }),
      ...textBox(id(`x${i}`), page, m.detail, TYPE.milestoneText, {
        x: labelX, y: detailY, width: labelWidth, height: detailHeight,
      }, { align: "CENTER" }),
    );
  });

  if (droppedMilestones > 0) {
    requests.push(...noteBox(
      id("mdrop"), page,
      `Showing ${n} of ${milestones.length} milestones`,
      CANVAS.height - GRID.margin - 16
    ));
  }
  return requests;
}

/** THE SERPENTINE: numbered discs on one rule, captions alternating above and
 *  below it.
 *
 *  `timeline` with three changes, and written beside it for that reason: the
 *  numeral goes INSIDE the marker, the captions alternate, and seven steps fit
 *  where five cards do not. It is not a second timeline engine — the axis, the
 *  evenly solved centres, the measure-then-place order and the "showing N of M"
 *  admission are all the ones above, and the three differences are the whole of
 *  the new code.
 *
 *  IT READS `stages`, which is what a seven-step way of working is, and what
 *  `process` already asks the model for. A serpentine is that content drawn at
 *  a count `process` refuses: its cards are laid across the width so a sixth is
 *  100pt wide with a two-word caption in it, and MAX_STAGES says so out loud.
 *  Alternation is what buys the width back — two captions on the SAME side of
 *  the rule are two pitches apart — so the same steps that do not fit as cards
 *  fit here, and the model needs no new payload to say so.
 *
 *  THE PITCH IS SOLVED. See SERPENTINE's header: both constraints bind at once
 *  and give `pitch = (contentWidth + gutter) / (n + 1)`, which lands within
 *  1.7pt of the source's hand-set 83.4 at seven steps. Copying 83.4 would have
 *  been right for seven and wrong for every other count.
 */
function serpentineRequests(
  page: string, id: (s: string) => string, stages: NonNullable<SlideInput["stages"]>,
  onDark: boolean,
  top: number = GRID.bodyY, room: number = GRID.bandHeight,
  note?: (s: string) => void
): Req[] {
  // The same synonyms processRequests reads, and read here for the same
  // reason: a stage written as { title, text } beside a slide `title` is what
  // a model writes first, and a field that has to be REPORTED as dropped is a
  // field the renderer should have read.
  const stageName = (st: any) => String(st?.name ?? st?.title ?? "").trim();
  const stageCaption = (st: any) => String(st?.caption ?? st?.body ?? st?.text ?? "").trim();
  const usable = stages.filter((st) => st && stageName(st));
  const shown = usable.slice(0, SERPENTINE.maxSteps);
  const n = shown.length;
  if (n < 2) return [];

  // ── THE HORIZONTAL SOLVE ────────────────────────────────────────────────
  const W = GRID.contentWidth;
  const g = SERPENTINE.gutter;
  let pitch = (W + g) / (n + 1);
  let capW = 2 * pitch - g;
  if (capW > SERPENTINE.captionMax) {
    // A short run would give every caption a measure nobody wants to read —
    // 330pt is 73 characters of 9pt Roboto, and this file's own rule is that
    // past about 100 a line stops being a column and starts being a document.
    // Capped, the pitch is re-solved so the last caption still lands on the
    // right margin rather than leaving the run bunched at the left.
    capW = SERPENTINE.captionMax;
    pitch = (W - capW) / (n - 1);
  }
  // The FIRST caption's left edge is the left margin and the LAST caption's
  // right edge is the right one, which is what forced the pitch above.
  const firstX = GRID.margin + capW / 2;
  const centreOf = (i: number) => firstX + i * pitch;

  // ── THE VERTICAL SOLVE, MEASURED ────────────────────────────────────────
  // Which side each caption is on. The first is above, as the source's is, and
  // the alternation from there is what the whole layout rests on.
  const above = (i: number) => i % 2 === 0;
  const parts = shown.map((st: any) => {
    const split = splitStageOwner(stageCaption(st), st?.owner);
    return { name: stageName(st), caption: split.caption, owner: split.owner };
  });
  const nameStyle = onDark ? { ...TYPE.stageName, color: COLOR.white } : TYPE.stageName;
  const ownerStyle = onDark ? { ...TYPE.stageOwner, color: COLOR.greyLight } : TYPE.stageOwner;
  const STACK_GAP = 3;
  // A FIT LADDER, which is processRequests' own device and its own reason: the
  // name is the reference's size and the owner is this deck's floor, so
  // neither steps, and the caption is the one thing on the block that can
  // give. Two rungs under the source's 9pt, stopping at the deck's 7.5 floor —
  // below that a caption is smaller than the footer.
  //
  // AND A FOURTH RUNG THAT DROPS THE OWNER ROW, which came from a render and
  // not from reading. Eight owned steps under a standfirst at `present` have
  // 172pt of band for 166pt of captions: every rung "fitted" by arithmetic and
  // the page showed captions touching their own owner lines and one caption
  // drawn straight through its. `process` is the layout that exists for
  // ownership — it draws an Owner line under five cards and says so — so the
  // owner is what a serpentine gives up when the room runs out, and the slide
  // SAYS which of the two it dropped rather than crowding both.
  const RUNGS: { size: number; owners: boolean }[] = [
    { size: SERPENTINE.captionSize, owners: true }, { size: 8, owners: true },
    { size: 7.5, owners: true }, { size: 7.5, owners: false },
  ];
  const measureAt = (rung: { size: number; owners: boolean }) => {
    const size = rung.size;
    const ink = onDark
      ? { ...TYPE.stageCaption, size, color: COLOR.greyLight }
      : { ...TYPE.stageCaption, size };
    const hs = parts.map((p) => {
      const nameH = drawnTextHeight(estimateLines(p.name, capW, nameStyle.size), nameStyle.size);
      const capH = p.caption
        ? STACK_GAP + drawnTextHeight(estimateLines(p.caption, capW, size), size) : 0;
      const ownH = p.owner && rung.owners ? drawnTextHeight(1, ownerStyle.size) : 0;
      return { nameH, capH, ownH, total: nameH + capH + (ownH ? STACK_GAP + ownH : 0) };
    });
    // A SIDE'S DEPTH IS THE DEEPEST NAME PLUS THE DEEPEST CAPTION, not the
    // deepest step. The two need not belong to the same step, and the captions
    // on a side share one top — see `an`/`bn` below — so measuring the deepest
    // BLOCK would under-measure a row whose longest name and longest caption
    // sit at different pitches.
    let a = 0, b = 0, ao = 0, bo = 0, an = 0, bn = 0, ac = 0, bc = 0;
    for (let i = 0; i < n; i++) {
      if (above(i)) { an = Math.max(an, hs[i].nameH); ac = Math.max(ac, hs[i].capH); ao = Math.max(ao, hs[i].ownH); }
      else { bn = Math.max(bn, hs[i].nameH); bc = Math.max(bc, hs[i].capH); bo = Math.max(bo, hs[i].ownH); }
    }
    a = an + ac + (ao ? STACK_GAP + ao : 0);
    b = bn + bc + (bo ? STACK_GAP + bo : 0);
    return { ink, hs, a, b, ao, bo, an, bn, owners: rung.owners, need: a + b + SERPENTINE.disc + SERPENTINE.capGap * 2 };
  };
  let anyOwner = false;
  for (let i = 0; i < parts.length; i++) if (parts[i].owner) anyOwner = true;
  let plan = measureAt(RUNGS[0]);
  for (let k = 1; k < RUNGS.length && plan.need > room + 0.5; k++) {
    // The owner rung is not taken on a row that has no owners: it would be the
    // same measurement twice and would report a loss of nothing.
    if (!RUNGS[k].owners && !anyOwner) break;
    plan = measureAt(RUNGS[k]);
  }
  const inkStyle = plan.ink;
  const heights = plan.hs;
  const drawOwners = plan.owners;
  const aboveNeed = plan.a, belowNeed = plan.b, aboveOwner = plan.ao, belowOwner = plan.bo;
  // The name band each side shares, which is where its captions start. See
  // the caption placement below.
  const aboveName = plan.an, belowName = plan.bn;
  // The run the two caption bands share, once the disc and its air are paid.
  const available = Math.max(20, room - SERPENTINE.disc - SERPENTINE.capGap * 2);
  // THE DEVICE IS A BLOCK, AND A BLOCK IS CENTRED IN ITS BAND. That is this
  // deck's own rule, written on GRID.bandHeight: a self-contained figure is
  // centred so five bars sit balanced and eight fill the page, while prose is
  // not, because a list centred in its band floats away from the title it
  // belongs to. Rendered without this the rule sat at 221 with the captions
  // ending at 300 and seventy points of empty paper under them — the diagram
  // pinned to the top of the band like a paragraph.
  //
  // aboveShare is what decides the split only when the captions DO NOT fit,
  // which is the one case where something has to give: the source gives its
  // upper band 86pt to its lower band's 119, because the page reads downward
  // and the deeper half is the lower one.
  //
  // THE SLACK MOVES THE DEVICE; IT DOES NOT STRETCH THE BANDS. Pouring it into
  // the caption bands instead is the inverted rhythm Stage 3 found in the
  // bullet gaps, in a different place: a four-step row then top-aligned its
  // upper captions in a band half again as deep as they needed and opened 140
  // points between the captions and the rule they belong to. So the band a
  // block gets is exactly what the deepest block on that side needs, and the
  // whole assembly is led into the page by half the slack.
  const slack = room - (aboveNeed + belowNeed + SERPENTINE.disc + SERPENTINE.capGap * 2);
  const fits = slack > 0;
  const aboveBand = fits ? aboveNeed : Math.max(0, Math.min(available, available * SERPENTINE.aboveShare));
  const lead = fits ? slack / 2 : 0;
  const ruleY = top + lead + aboveBand + SERPENTINE.capGap + SERPENTINE.disc / 2;
  const belowTop = ruleY + SERPENTINE.disc / 2 + SERPENTINE.capGap;
  const belowBand = fits ? belowNeed : Math.max(20, top + room - belowTop);
  // EVERY CAPTION ON A SIDE STARTS ON ONE LINE, which is the source's own
  // arrangement — its above captions share a y and so do its below ones — and
  // the reason is the reason processRequests gives for its head block: the
  // slack belongs under a short caption, not above it. Bottom-aligning the
  // upper captions to the rule instead was tried and rendered: the names then
  // sit at four different heights across seven steps and the row stops reading
  // as a row.
  const aboveTop = top + lead;

  // Wide enough for one numeral ON ONE LINE, inset included — processRequests'
  // own arithmetic, for the same reason: a text box the circle's own size
  // leaves the glyph a few points of room and wraps a two-digit step.
  const numeralW = Math.ceil(TEXT_INSET_X + SERPENTINE.numeralSize * PER_CHAR * CAPS_WIDEN * 2);

  const out: Req[] = [];
  out.push(...hairline(id("axis"), page, "content", ruleY, onDark));

  let clipped = 0;
  for (let i = 0; i < n; i++) {
    const p = parts[i];
    const cx = centreOf(i);
    const capX = cx - capW / 2;
    const h = heights[i];
    const up = above(i);
    const bandTop = up ? aboveTop : belowTop;
    const band = up ? aboveBand : belowBand;
    const ownerRow = up ? aboveOwner : belowOwner;
    // THE OWNER IS ANCHORED TO THE FOOT OF THE BAND, not to the end of the
    // caption above it, and the caption is what gives way. Stacked the other
    // way round a long caption pushed its own owner line clean off the band:
    // rendered, step 4 of an eight-step row drew "Owner: Editor" on the
    // footer's line, beside the running head and under the frame's own rule.
    // A field the layout is given may be shortened by the band it is in; it
    // may not be relocated into the page's chrome. This is processRequests'
    // rule and its reason both — the owners sit on one baseline across the
    // row, which is the line a client's team scans for.
    const ownerTop = bandTop + band - ownerRow;
    // THE CAPTIONS ON A SIDE SHARE ONE TOP, exactly as the owner lines do, and
    // for the same reason: a row is read across. Stacked under each name's own
    // estimated box, a name the estimator thinks wraps and that renders on one
    // line pushed only ITS caption down — measured in the browser, two
    // captions of one row sat 20pt below the third with a hole of empty ground
    // under the short name, and validateDeck reported nothing because every
    // box was exactly where the builder put it. The deepest name on the side
    // sets the line; a shorter name simply leaves air under itself, which is
    // what the source does.
    const capTop = bandTop + (up ? aboveName : belowName) + STACK_GAP;
    const capRoom = Math.max(10, (p.owner && drawOwners ? ownerTop - STACK_GAP : bandTop + band) - capTop);
    // A caption that does not fit WHAT IS LEFT FOR IT is clipped and counted,
    // never silently shortened: the box stops at its room and Slides draws the
    // words on from its top, so the overrun is visible in the preview and
    // reported by the validator rather than disappearing.
    //
    // MEASURED AGAINST THE ROOM, NOT AGAINST THE BAND'S SHARE. Comparing the
    // whole block to `band` counted six captions on an eight-step row that
    // were each perfectly drawn — the share is what the crowded case splits
    // the run on, not a promise about any one block — and a warning that names
    // five slides that are fine is how a warning stops being read.
    if ((p.caption && h.capH - STACK_GAP > capRoom + 0.5) || h.nameH > band + 0.5) clipped += 1;
    out.push(...textBox(id(`sn${i}`), page, p.name, nameStyle, {
      x: capX, y: bandTop, width: capW, height: Math.min(h.nameH, band),
    }, { align: "CENTER", spaceBelow: 0 }));
    if (p.caption) {
      out.push(...textBox(id(`sc${i}`), page, p.caption, inkStyle, {
        x: capX, y: capTop, width: capW,
        height: Math.max(10, Math.min(h.capH - STACK_GAP, capRoom)),
      }, { align: "CENTER", spaceBelow: 0 }));
    }
    if (p.owner && drawOwners) {
      out.push(...textBox(id(`so${i}`), page, `Owner: ${p.owner}`, ownerStyle, {
        x: capX, y: ownerTop, width: capW, height: Math.max(9, ownerRow),
      }, { align: "CENTER", spaceBelow: 0 }));
    }
    // THE DISC LAST, so it is drawn over the rule rather than under it: a
    // hairline crossing a filled circle reads as a scratch on the circle.
    out.push(...filledShape(id(`sd${i}`), page, "ELLIPSE", COLOR.blue, {
      x: cx - SERPENTINE.disc / 2, y: ruleY - SERPENTINE.disc / 2,
      width: SERPENTINE.disc, height: SERPENTINE.disc,
    }));
    // textOn, never a written-down white: a palette edit that lightened the
    // disc would otherwise leave the numeral unreadable and nothing would say.
    out.push(...textBox(id(`sdn${i}`), page, String(i + 1),
      { font: "Playfair Display", size: SERPENTINE.numeralSize, color: textOn(COLOR.blue) }, {
        x: cx - numeralW / 2, y: ruleY - SERPENTINE.disc / 2,
        width: numeralW, height: SERPENTINE.disc,
      }, { align: "CENTER", vCenter: true, spaceBelow: 0 }));
  }

  // SAID ON THE SLIDE, not only in a note to the model: a note-free build
  // passes every geometric check there is, which is Stage 3's lesson and the
  // reason every other diagram here draws its own admission.
  // SAID ON THE SLIDE, in the slot every other diagram uses, and named to the
  // model with the fix rather than only with the fact. droppedContent reports
  // the owners' own words as well, which is right: they ARE dropped, and its
  // generic advice — put it in a field this layout uses — is the one thing
  // that would not help here, because the field was right and the room was
  // not.
  if (anyOwner && !drawOwners) {
    out.push(...noteBox(id("sown"), page, "Owners omitted for room", CANVAS.height - GRID.margin - 16));
    if (note) note(`this serpentine had no room for its Owner lines at ${n} steps and was drawn without them`
      + ` — use \`process\` for a row of up to ${MAX_STAGES} steps with owners, or shorten the captions`);
  }
  const dropped = usable.length - n;
  if (dropped > 0) {
    out.push(...noteBox(id("sdrop"), page,
      `Showing ${n} of ${usable.length} steps`, CANVAS.height - GRID.margin - 16));
    if (note) note(`a serpentine draws at most ${SERPENTINE.maxSteps} steps and this slide has ${usable.length}` +
      ` — ${dropped} ${dropped === 1 ? "was" : "were"} left off; split them across two slides`);
  }
  // NOTHING IS CLIPPED IN SILENCE. The ladder has already stepped as far as it
  // will, so a caption still over its band is one the slide cannot hold: the
  // box stops at the band, Slides draws the words on from its top, the
  // validator reports the overrun, and the model is told which way to fix it.
  if (clipped > 0 && note) {
    note(`${clipped} serpentine caption${clipped === 1 ? "" : "s"} ${clipped === 1 ? "is" : "are"} deeper than the band`
      + ` between the rule and the edge of the page, even at ${inkStyle.size}pt — shorten them to about`
      + ` ${Math.max(10, Math.floor((capW - TEXT_INSET_X) / (inkStyle.size * faceAdvance("Roboto"))) * 2)} characters,`
      + ` or split the steps across two slides`);
  }
  return out;
}

/** Parse an ISO date to a UTC timestamp. UTC deliberately: these are calendar
 *  dates, and a local-midnight reading shifts them a day either side of the
 *  meridian, which would silently move a milestone on the chart. */
export function isoDate(s: string | undefined): number | null {
  if (!s) return null;
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(s.trim());
  if (!m) return null;
  const y = +m[1], mo = +m[2], d = +m[3];
  const t = Date.UTC(y, mo - 1, d);
  if (!Number.isFinite(t)) return null;
  // Date.UTC NORMALISES rather than rejects: "2026-13-05" becomes 5 Jan 2027
  // and "2026-02-30" becomes 2 March. Read it back — a date that does not
  // round-trip is not the date the text says, and plotting it puts a confident
  // wrong mark on an axis every other track is then scaled against.
  //
  // The prefix match stays unanchored on purpose, so "2026-08-19T10:30:00Z"
  // still parses; a model emits those.
  const back = new Date(t);
  if (back.getUTCFullYear() !== y || back.getUTCMonth() !== mo - 1 || back.getUTCDate() !== d) {
    return null;
  }
  return t;
}

const MONTHS = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];

/** The tick label's box, and the room one label needs to itself. */
const TICK_LABEL_WIDTH = 48;
const TICK_MIN_GAP = 56;
const AVG_MONTH = (365.2425 / 12) * 86400000;

/** Ticks across the range at the finest grain whose labels do not collide —
 *  months, then 2, 3 or 6 months, then years, then decades.
 *
 *  A fixed month grain was both unreadable AND incomplete on a long programme:
 *  a seven-year plan drew sixty labels five points apart in forty-eight point
 *  boxes, and then stopped, so everything past the fifth year had no axis at
 *  all. The grain is chosen from the space available instead. */
function monthTicks(
  min: number, max: number, plotW: number
): { t: number; label: string }[] {
  const out: { t: number; label: string }[] = [];
  const span = max - min;
  if (!(span > 0) || !(plotW > 0)) return out;

  const needMonths = (TICK_MIN_GAP / plotW) * (span / AVG_MONTH);
  const STEPS = [1, 2, 3, 6, 12, 24, 60, 120, 300, 600, 1200];
  let step = 0;
  for (let i = 0; i < STEPS.length; i++) {
    if (STEPS[i] >= needMonths) { step = STEPS[i]; break; }
  }
  if (!step) step = Math.ceil(needMonths / 12) * 12;

  // Walk an absolute month index snapped up to the step grid, so quarters land
  // on Jan/Apr/Jul/Oct and year steps land on Januaries.
  const start = new Date(min);
  let index = start.getUTCFullYear() * 12 + start.getUTCMonth();
  if (start.getUTCDate() !== 1) index += 1;
  index = Math.ceil(index / step) * step;

  for (let guard = 0; guard < 400; guard++) {
    const y = Math.floor(index / 12), mo = index % 12;
    const t = Date.UTC(y, mo, 1);
    if (t > max) break;
    if (t >= min) {
      // Year only in January (and on the first tick), so the axis does not
      // repeat "26" six times — and so "Jul 26" is never misread as a date.
      // At a year-or-coarser grain every label carries its year.
      const withYear = step >= 12 || mo === 0 || out.length === 0;
      out.push({ t, label: withYear ? `${MONTHS[mo]} ${y}` : MONTHS[mo] });
    }
    index += step;
  }
  // A range shorter than a month can produce no boundary at all. An axis with
  // no labels is a rule with no meaning, so fall back to naming its ends.
  if (out.length < 2) {
    const label = (t: number) => {
      const d = new Date(t);
      return `${d.getUTCDate()} ${MONTHS[d.getUTCMonth()]}`;
    };
    return [{ t: min, label: label(min) }, { t: max, label: label(max) }];
  }
  return out;
}

/** Two or more workstreams on one shared, date-proportional axis.
 *
 *  Two things make this readable rather than merely correct:
 *
 *  1. Phases that overlap in time are packed onto SUB-ROWS within their track.
 *     Drawn on one row they simply cover each other, which hides the overlap —
 *     the one thing the slide exists to show.
 *  2. A phase label goes INSIDE its bar when the bar is wide enough for it, and
 *     to the right when it is not, bounded by the next bar's start. Labels
 *     floated above collide as soon as two phases begin close together.
 */
function parallelTimelineRequests(
  page: string,
  id: (s: string) => string,
  tracks: Track[],
  todayIso?: string,
  /** Where the plot may start. TIMELINE_PARALLEL.bandY when a standfirst is
   *  drawn above it; the top of the content band when there is none. */
  bandTop?: number
): Req[] {
  const requests: Req[] = [];
  const P = TIMELINE_PARALLEL;
  const bandY = bandTop === undefined ? P.bandY : Math.min(P.bandY, bandTop);

  interface Placed {
    start: number; end: number | null; label: string; row: number;
    barX: number; barW: number; isPoint: boolean;
    inside: boolean; labelX: number; labelW: number; footprintEnd: number;
    /** A label pushed to the LEFT of its bar reads from the bar outwards, so it
     *  is set right-aligned against it. */
    alignEnd: boolean;
  }

  const stamps: number[] = [];
  let droppedPhases = 0;
  const parsed = tracks.map((tr) => {
    const items = tr.phases
      .map((ph) => {
        const s = isoDate(ph.start);
        // An end that was SUPPLIED but does not parse, or that falls before its
        // start, is not a phase that can be placed. Letting it fall through to
        // `end: null` drew it as a dot on its start date — claiming a
        // single-day milestone the input never described — and its stamp still
        // stretched the shared axis every other track is scaled against.
        const e = ph.end ? isoDate(ph.end) : null;
        if (s === null || (ph.end && (e === null || e < s))) { droppedPhases += 1; return null; }
        stamps.push(s);
        if (e !== null) stamps.push(e);
        return { start: s, end: e !== null && e > s ? e : null, label: ph.label };
      })
      .filter(Boolean) as { start: number; end: number | null; label: string }[];
    items.sort((a, b) => a.start - b.start);
    return { name: tr.name, items };
  });

  // Without at least two distinct dates there is no range to be proportional
  // to. Nothing is drawn rather than something wrong.
  if (stamps.length < 2) return requests;
  let min = Math.min(...stamps);
  let max = Math.max(...stamps);
  if (max === min) return requests;
  const pad = (max - min) * P.rangePad;
  min -= pad; max += pad;

  const plotX = GRID.margin + P.labelGutter;
  const plotW = GRID.contentWidth - P.labelGutter;
  const x = (t: number) => plotX + ((t - min) / (max - min)) * plotW;

  // Roboto at this size averages a little over half the point size per
  // character; good enough to decide inside-vs-outside without font metrics.
  const textWidth = (s: string) => s.length * 4.3;

  // Packing happens in PIXELS, not dates, and against each phase's FOOTPRINT —
  // the bar plus whatever room its label needs beside it. Packing on dates
  // alone was not enough: a one-day phase produces an eight-point bar whose
  // label is ten times wider, so two phases a week apart do not overlap as
  // dates and collide badly as drawn.
  const placedTracks = parsed.map((tr) => {
    const rowEnds: number[] = [];
    const items: Placed[] = tr.items.map((it) => {
      const isPoint = it.end === null;
      const barX = isPoint ? x(it.start) - P.pointSize / 2 : x(it.start);
      const barW = isPoint ? P.pointSize : Math.max(P.minBarWidth, x(it.end!) - x(it.start));
      const natural = textWidth(it.label) + 10;
      const inside = !isPoint && barW >= natural + 4;
      let labelX = barX + barW + 6;
      let labelW = inside ? barW - 12 : Math.min(natural, 150);
      let alignEnd = false;

      // A late phase has no room to its right: its label was drawn from the bar
      // outwards and ran off the canvas — 790pt on a 720pt slide, so the last
      // milestone in a plan was the one nobody could read. Put it on the other
      // side of the bar instead, and only clip it if there is no room there
      // either.
      if (!inside) {
        const rightEdge = GRID.margin + GRID.contentWidth;
        if (labelX + labelW > rightEdge) {
          const roomLeft = barX - 6 - plotX;
          if (roomLeft >= 40) {
            labelW = Math.min(labelW, roomLeft);
            labelX = barX - 6 - labelW;
            alignEnd = true;
          } else {
            labelW = Math.max(24, rightEdge - labelX);
          }
        }
      }
      const footprintEnd = inside ? barX + barW : Math.max(barX + barW, labelX + labelW);

      let row = rowEnds.findIndex((end) => barX >= end);
      if (row === -1) { row = rowEnds.length; rowEnds.push(footprintEnd + 8); }
      else rowEnds[row] = footprintEnd + 8;

      return { ...it, row, barX, barW, isPoint, inside, labelX, labelW, footprintEnd, alignEnd };
    });
    return { name: tr.name, items, rows: Math.max(1, rowEnds.length) };
  });

  // NOTHING may grow past the bottom of the slide. Tracks were laid out at a
  // fixed 30pt per row with no ceiling, so five tracks — or one track whose
  // phases packed onto six rows — pushed the shared date axis, and every tick
  // on it, clean off the canvas. The axis is the thing the layout exists for.
  //
  // Rows compress first, then the gap between tracks, and only then is a track
  // dropped — and a dropped track is said out loud.
  const MIN_TRACK_ROW = 18;
  const MIN_TRACK_GAP = 10;
  const tailHeight = P.axisGap + P.axisThickness + 5 + P.tickLabelHeight;
  let shown = placedTracks;
  let trackGap: number = P.trackGap;
  let rowHeight: number = P.rowHeight;
  let noteReserve = droppedPhases > 0 ? 16 : 0;
  for (let guard = 0; guard < 24; guard += 1) {
    const rows = shown.reduce((n, t) => n + t.rows, 0) || 1;
    const budget =
      CANVAS.height - GRID.margin - bandY - tailHeight - noteReserve - trackGap * (shown.length - 1);
    rowHeight = Math.min(P.rowHeight, budget / rows);
    if (rowHeight >= MIN_TRACK_ROW) break;
    if (trackGap > MIN_TRACK_GAP) { trackGap = MIN_TRACK_GAP; continue; }
    if (shown.length > 1) { shown = shown.slice(0, -1); noteReserve = 16; continue; }
    break;
  }
  rowHeight = Math.max(MIN_TRACK_ROW, Math.floor(rowHeight * 10) / 10);
  const barHeight = Math.max(12, rowHeight - (P.rowHeight - P.barHeight));
  const droppedTracks = placedTracks.length - shown.length;

  // AND THE BLOCK TAKES THE MIDDLE OF WHAT IS LEFT. `bandY` is where the plot
  // MAY start — it clears the title and the standfirst — and the fitting loop
  // above sizes the tracks to what remains. Drawn from that mark, two tracks
  // that fit easily left the top third of the page empty and crowded the date
  // axis onto the footer. The tracks and their axis are one figure and the
  // band is its frame, which is the same call the stat grid and the card row
  // already make.
  const blockH = shown.reduce((n, t) => n + t.rows * rowHeight, 0)
    + trackGap * (shown.length - 1) + tailHeight + noteReserve;
  const slack = Math.max(0, (CANVAS.height - GRID.margin - bandY) - blockH);
  let cursorY = bandY + slack / 2;
  shown.forEach((tr, ti) => {
    const color = TRACK_COLORS[ti % TRACK_COLORS.length];
    const trackHeight = tr.rows * rowHeight;

    // A LANE behind each track. It was drawn in WHITE on the off-white ground —
    // 1.02:1, invisible — so the device that says "these bars belong to one
    // workstream" said nothing, and the phase pills floated with only a caps
    // label 300pt to their left to attach them to anything. #EBEBEB is the
    // deck's own light surface and the quietest fill that measurably reads on
    // an off-white page: 1.12:1 against it, where white is 1.06 and the warm
    // tint is 1.08 — close enough to the ground that a check asserting one of
    // those would be asserting a rounding error.
    requests.push(
      ...filledShape(id(`band${ti}`), page, "RECTANGLE", COLOR.greyLight, {
        x: GRID.margin,
        y: cursorY - P.bandPadding,
        width: GRID.contentWidth,
        height: trackHeight + P.bandPadding,
      })
    );

    requests.push(
      // Centred in the track's own band rather than hand-offset by half its
      // box: a two-line workstream name drawn from a computed top sits high
      // in its band, which is the fault the label rule exists to stop.
      ...textBox(id(`tn${ti}`), page, tr.name, TYPE.trackName, {
        x: GRID.margin,
        y: cursorY,
        width: P.labelGutter - 12,
        height: trackHeight,
      }, { vCenter: true })
    );

    tr.items.forEach((it, pi) => {
      const barY = cursorY + it.row * rowHeight;

      requests.push(
        ...filledShape(
          id(`p${ti}_${pi}`), page,
          // A PHASE BAR HAS SQUARE ENDS. The two things this layout exists to
          // show are the date a phase starts and the date it ends, and a fully
          // rounded capsule rounds both of them away: the ink at the bar's own
          // x is half a bar-height short of the date it stands for. A
          // milestone stays a disc, because a point has no ends to blur.
          it.isPoint ? "ELLIPSE" : "RECTANGLE", color,
          {
            x: it.barX,
            y: it.isPoint ? barY + barHeight / 2 - P.pointSize / 2 : barY,
            width: it.barW,
            height: it.isPoint ? P.pointSize : barHeight,
          }
        ),
        ...textBox(
          id(`pl${ti}_${pi}`), page, it.label,
          // Inside the bar the label sits on the TRACK's colour, so the colour
          // is measured against it. White was hard-coded and is 2.95:1 on the
          // coral track.
          it.inside ? { ...TYPE.phaseInBar, color: textOn(color) } : TYPE.phaseLabel,
          // The label box is the BAR's rect, and the text centres inside it.
          // It used to be nudged down 4pt while keeping the bar's full height,
          // so it hung 4pt past the bar's bottom edge and an 8pt line in a
          // 12pt bar sat half outside the shape it labels.
          {
            x: it.inside ? it.barX + 6 : it.labelX,
            y: barY,
            width: it.labelW,
            height: barHeight,
          },
          it.alignEnd ? { align: "END", vCenter: true } : { vCenter: true }
        )
      );
    });

    cursorY += trackHeight + trackGap;
  });

  const axisY = cursorY - trackGap + P.axisGap;
  requests.push(
    ...filledShape(id("paxis"), page, "RECTANGLE", COLOR.periwinkle, {
      x: plotX, y: axisY, width: plotW, height: P.axisThickness,
    })
  );
  monthTicks(min, max, plotW).forEach((tick, i) => {
    requests.push(
      ...textBox(id(`tick${i}`), page, tick.label, TYPE.axisTick, {
        x: x(tick.t) - TICK_LABEL_WIDTH / 2, y: axisY + 5, width: TICK_LABEL_WIDTH,
        height: P.tickLabelHeight,
      }, { align: "CENTER" })
    );
  });

  const noteParts: string[] = [];
  if (droppedTracks > 0) noteParts.push(`${shown.length} of ${placedTracks.length} tracks`);
  if (droppedPhases > 0) {
    noteParts.push(`${droppedPhases} phase${droppedPhases === 1 ? "" : "s"} with unusable dates omitted`);
  }
  if (noteParts.length) {
    requests.push(...noteBox(
      id("pdrop"), page, `Showing ${noteParts.join(" · ")}`, axisY + 5 + P.tickLabelHeight
    ));
  }

  // "Today" rule last, so it sits above the bars.
  const now = new Date();
  const today = isoDate(todayIso) ??
    Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
  if (today > min && today < max) {
    const tx = x(today);
    requests.push(
      ...filledShape(id("today"), page, "RECTANGLE", COLOR.coralDeep, {
        x: tx, y: P.bandY - 8, width: 1.4, height: axisY - P.bandY + 8,
      }),
      ...textBox(id("todaylbl"), page, "Today", TYPE.todayLabel, {
        x: tx - 22, y: P.bandY - 22, width: 44, height: 14,
      }, { align: "CENTER" })
    );
  }
  return requests;
}

/** Grid geometry, computed in ONE place.
 *
 *  Resolution has to know the cell's shape to crop an image to it, and drawing
 *  has to know it to place the image — and a cell is 1.70 wide with four across
 *  but nothing like that with two. Two copies of this arithmetic would drift,
 *  and the symptom would be the letterboxing this exists to prevent. */
export function gridGeometry(count: number, captioned: boolean, captionH?: number) {
  const shown = Math.min(count, 12);
  // THE CAPTION BAND IS AS TALL AS THE TALLEST CAPTION. One line was reserved
  // whatever the words were, so a caption that wrapped ran its second line
  // through the footer's hairline and off the bottom of the page. The caller
  // measures at the cell width it is about to get; resolution, which only wants
  // the aspect, keeps the one-line default.
  const capBand = captioned ? Math.max(IMAGE.gridCaptionHeight, captionH || 0) : 0;
  // The band is a fixed 671x230pt, so the arrangement decides the cell shape
  // and neither obvious rule gives a good one: filling a row makes four images
  // 0.70 slivers, squaring off makes eight images 3.07 strips. Instead try
  // every arrangement up to four across and keep the one whose cell is closest
  // to a photographic 1.4 — measured in log space, so half and double are
  // penalised equally.
  const IDEAL = 1.4;
  // AND A RAGGED LAST ROW IS PART OF THE SCORE, which it was not — so four
  // pictures were laid out three-then-one, with two empty cells and a lone
  // photograph on a second row, because that arrangement's cell shape scored
  // 0.12 better than one row of four. The header above this function claims the
  // set always fills the band; the arithmetic did not enforce it. The weight is
  // set where six pictures still choose 3x2 (an exact grid) and four choose one
  // row of four rather than 3+1, which is the pair of cases that matter.
  const RAGGED = 0.9;
  let cols = 1, best = Infinity;
  for (let c = 1; c <= Math.min(4, shown); c++) {
    const r = Math.ceil(shown / c);
    const w = (GRID.contentWidth - IMAGE.gridGap * (c - 1)) / c;
    const h = (IMAGE.gridHeight - IMAGE.gridGap * (r - 1)) / r - capBand;
    if (h <= 8) continue; // too many rows to show anything
    const score = Math.abs(Math.log((w / h) / IDEAL)) + RAGGED * ((c * r - shown) / c);
    if (score < best) { best = score; cols = c; }
  }
  const rows = Math.ceil(shown / cols);
  const cellW = (GRID.contentWidth - IMAGE.gridGap * (cols - 1)) / cols;
  const cellH = (IMAGE.gridHeight - IMAGE.gridGap * (rows - 1)) / rows - capBand;
  return { cols, rows, cellW, cellH, capBand, aspect: cellW / Math.max(1, cellH) };
}

/** Up to twelve thumbnails on one row-and-column grid, sized so the set always
 *  fills the band rather than leaving a ragged last row. */
function gridRequests(
  page: string, id: (s: string) => string,
  images: { url: string; caption?: string }[]
): Req[] {
  if (!images.length) return [];
  const shown = images.slice(0, 12);
  const captioned = shown.some((i) => i.caption);
  // Measured in two passes, because the caption's height depends on the cell
  // width and the cell width depends on the column count. The first pass gets
  // the columns from the one-line default; the second sizes the band to what
  // the captions really take at that width.
  const first = gridGeometry(shown.length, captioned);
  let capH = IMAGE.gridCaptionHeight;
  for (let i = 0; i < shown.length; i++) {
    const t = shown[i].caption;
    if (!t) continue;
    capH = Math.max(capH, drawnTextHeight(
      Math.max(1, estimateLines(t, first.cellW, TYPE.gridCaption.size)), TYPE.gridCaption.size));
  }
  const { cols, cellW, cellH, capBand } = gridGeometry(shown.length, captioned, capH);

  const out: Req[] = [];
  shown.forEach((img, i) => {
    const c = i % cols, r = Math.floor(i / cols);
    // A short last row is CENTRED, the way the card row already centres its
    // own: a hole at the bottom right reads as a picture that failed to load.
    const inRow = Math.min(cols, shown.length - r * cols);
    const rowW = inRow * cellW + (inRow - 1) * IMAGE.gridGap;
    const x = GRID.margin + (GRID.contentWidth - rowW) / 2 + c * (cellW + IMAGE.gridGap);
    const y = IMAGE.gridY + r * (cellH + IMAGE.gridGap + capBand);
    out.push({
      createImage: {
        objectId: id(`g${i}`),
        url: img.url,
        elementProperties: {
          pageObjectId: page,
          size: { width: pt(cellW), height: pt(cellH) },
          transform: { scaleX: 1, scaleY: 1, translateX: x, translateY: y, unit: "PT" },
        },
      },
    });
    out.push(...textBox(id(`gc${i}`), page, img.caption, TYPE.gridCaption, {
      x, y: y + cellH + 2, width: cellW, height: capBand,
    }));
  });
  return out;
}

/** A full-bleed photograph with its scrim, drawn before anything else so text
 *  and the logo sit on top. Returns [] when no image resolved, which is what
 *  makes every photo layout degrade to its solid brand background. */
function backdropRequests(
  page: string, id: (s: string) => string, slide: SlideInput
): Req[] {
  // The image arrives pre-cropped to the canvas and with its gradient already
  // burnt in, so there is no scrim shape here any more — see lib/slides/images.
  const img = slide.resolvedImage;
  if (!img) return [];
  return [
    {
      createImage: {
        objectId: id("bg"),
        url: img.url,
        elementProperties: {
          pageObjectId: page,
          size: { width: pt(CANVAS.width), height: pt(CANVAS.height) },
          transform: { scaleX: 1, scaleY: 1, translateX: 0, translateY: 0, unit: "PT" },
        },
      },
    },
    ...creditRequests(id("credit"), page, img.credit, { x: GRID.margin, width: GRID.contentWidth }, true),
  ];
}

/** The photographer's line.
 *
 *  Its own helper because the split layout needs it too and did not have it:
 *  the resolver produced a credit for every Unsplash photograph and only the
 *  full-bleed path ever drew one, so half the stock pictures in a deck went out
 *  uncredited. textBox returns [] for an empty string, so owned, supplied and
 *  generated images still draw nothing. */
/** The measure a box on the footer line may use.
 *
 *  THE FOLIO OWNS THE RIGHT END OF THAT LINE. Three things are drawn on it —
 *  the running head, a photograph's credit, and now the page number — and the
 *  first two are END-aligned or full-width, so without a rule about who yields
 *  the number is drawn on top of a credit on every photo slide in the deck.
 *  A box that would run into the slot gives it up; one that already ends left
 *  of it — a credit under a picture rail, which belongs under the picture and
 *  not at the margin — keeps its full measure and is not moved at all. */
export function footerLineWidth(
  x: number, width: number,
  /** The right end of the chrome line, which is where the folio sits. Not
   *  always the content measure: a bleeding rail picture takes the right end of
   *  the page, and the folio moves in with the rest of the furniture. */
  folioRight: number = GRID.margin + GRID.contentWidth
): number {
  const folioLeft = folioRight - FRAME.numberWidth - FRAME.numberGap;
  return x + width > folioLeft ? Math.max(0, folioLeft - x) : width;
}

function creditRequests(
  objectId: string, page: string, credit: string | undefined,
  box: { x: number; width: number }, onDark: boolean,
  /** The right end of this page's chrome line, which is where the folio sits.
   *  A rail picture moves it in, and a credit sized to the full measure was
   *  then drawn across it. */
  folioRight: number = GRID.margin + GRID.contentWidth
): Req[] {
  return textBox(objectId, page, credit, onDark ? TYPE.credit : TYPE.creditOnLight, {
    x: box.x, y: IMAGE.creditY, width: footerLineWidth(box.x, box.width, folioRight), height: IMAGE.creditHeight,
  }, { align: "END" });
}

/** How much of the chrome line a credit takes, so the running head at the other
 *  end of it can give up exactly that and no more.
 *
 *  THE LINE HAS THREE ENDS ON A PHOTOGRAPHIC PAGE, not two. The footer's own
 *  contract is "one discreet line, the running head at the left and the folio
 *  at the right"; a picture's credit sits on that same line, and neither of the
 *  other two knew. Every stored slide with a rail picture reported its credit
 *  overlapping the running head — 30 of them — and that was true before this
 *  stage as well as after it. */
function creditRoom(credit: string | undefined): number {
  const t = String(credit || "").trim();
  return t ? labelBoxWidth(t, TYPE.creditOnLight.size) + 8 : 0;
}

/* ─────────────── Screenshots, and pointing at them ─────────────── */

/** A box in canvas points. The layouts above use {x,y,width,height}; the
 *  screenshot geometry is arithmetic on rectangles, so it uses the short
 *  spelling and converts once at the call to filledShape. */
export type ShotBox = { x: number; y: number; w: number; h: number };

const deflateBox = (b: ShotBox, p: number): ShotBox =>
  ({ x: b.x + p, y: b.y + p, w: b.w - 2 * p, h: b.h - 2 * p });
const inflateBox = (b: ShotBox, p: number): ShotBox => deflateBox(b, -p);
const shotRect = (b: ShotBox) => ({ x: b.x, y: b.y, width: b.w, height: b.h });

/** The largest box of `aspect` that fits inside `inner`, centred in it.
 *
 *  No clamp on the aspect. An ultrawide capture or a phone screen simply gets
 *  smaller, and the legibility note says so — a constant pretending to know
 *  better would crop the one thing the slide is pointing at. */
export function fitAspect(inner: ShotBox, aspect: number | undefined): ShotBox {
  const a = typeof aspect === "number" && isFinite(aspect) && aspect > 0 ? aspect : SHOT.unknownAspect;
  let w = inner.w, h = w / a;
  if (h > inner.h) { h = inner.h; w = h * a; }
  return { x: inner.x + (inner.w - w) / 2, y: inner.y + (inner.h - h) / 2, w, h };
}

/** Does this brief actually NAME a picture to go and find?
 *
 *  A continuation carries `{ screenshot: true }` and nothing else — the INTENT,
 *  with the picture itself inherited from the slide it was cut from. Handing
 *  that to the resolver is asking it to find nothing, which it reports back as
 *  a picture the user asked for and did not get. */
export function namesAPicture(image: SlideInput["image"]): image is NonNullable<SlideInput["image"]> {
  return !!(image && (image.url || image.query || image.attachment));
}

/** Is this slide's picture a UI CAPTURE rather than a photograph?
 *
 *  ONE place the question is asked, because four things follow from it and all
 *  four must agree: the file is not re-encoded (JPEG ringing on 12px interface
 *  type is exactly what a callout points at), it is drawn at its own shape on a
 *  mat rather than baked to a box, no gradient is burnt into it, and `feature`
 *  gets a navy stage instead of a full bleed. Callouts imply it — a slide that
 *  points at a control is pointing at an interface. */
export function isScreenshot(slide: Pick<SlideInput, "image">): boolean {
  return !!(slide.image?.screenshot || (slide.image?.callouts && slide.image.callouts.length > 0));
}

/** The layouts that DRAW callouts, and the phrase every note names them with.
 *
 *  image-split and feature only. The content/case-study rail is 239x301 and
 *  PORTRAIT: a 1440px capture there is 6 source pixels per drawn point, so 13px
 *  interface copy lands at 2.2pt and a pin would point at a smudge. Cards
 *  thumbnails are narrower again, and `image.callouts` is a slide-level field
 *  that cannot address a per-card picture at all. The photo-led layouts (cover,
 *  section, closing) write text over a baked gradient, which is the treatment
 *  this whole feature exists to keep off an interface. */
export function drawsCallouts(layout: SlideLayout): boolean {
  return layout === "image-split" || layout === "feature";
}
export const CALLOUT_LAYOUTS = "image-split and feature";

/** Is this picture drawn RAW — at its own shape, unbaked, with nothing written
 *  over it?
 *
 *  Only where the LAYOUT mats it. Everywhere else a screenshot is prepared as a
 *  photograph and keeps its baked gradient, because those layouts write white
 *  type ACROSS the picture: a cover carrying an undarkened UI capture is the
 *  same invisible slide the feature stage exists to fix, one layout along. The
 *  rail layouts keep the bake too — they crop to a portrait box, and a slide
 *  that cannot point at anything is better off cropped than letterboxed. */
export function drawsRawScreenshot(slide: Pick<SlideInput, "image" | "layout">, index: number): boolean {
  return isScreenshot(slide) && drawsCallouts(layoutOf(slide.layout, index));
}

/** The on-slide admission's band, reserved whenever a screenshot carries
 *  callouts at all rather than only when one is lost.
 *
 *  Reserving it conditionally would be circular: whether a pin can be placed
 *  is decided inside the picture box, and the picture box's height depends on
 *  whether the admission needs room. A fixed 15pt makes the geometry a
 *  function of the callouts alone, which is also what lets the splitter's probe
 *  read a stable ceiling. */
const SHOT_ADMISSION_H = 15;

/** Where a screenshot feature's title starts. The photo variant hangs its
 *  title off the bottom of the picture; the stage variant stacks downwards
 *  from the eyebrow, so the title needs a top rather than a bottom. */
const FEATURE_SHOT_TITLE_Y = 46;

/** A percentage as a reader would say it, for a note that quotes one back. */
function pctText(v: number): string {
  return String(Number(v.toFixed(1)));
}

/** Where each pin goes, and what had to be done to get it there.
 *
 *  NUDGE, AND SAY SO. Not "report and overlap": two pins on top of each other
 *  fail the overlap check and look broken. Not "nudge silently": a moved pin
 *  points at the wrong control, and only the author can fix that. The nudge
 *  keeps the slide drawable and the note keeps it honest — the same trade the
 *  hub makes when it drops a group.
 *
 *  Separation is CHEBYSHEV, not Euclidean, because the thing that must not
 *  overlap is the square numeral box: two of them 22.6pt apart at 45 degrees
 *  are 16pt apart in both axes and overlap in both. */
export function placeCallouts(
  box: ShotBox,
  callouts: { x: number; y: number; text: string }[],
  d: number = SHOT.pin
): { placed: ({ x: number; y: number } | null)[]; dropped: number; notes: string[] } {
  const half = d / 2;
  const notes: string[] = [];
  const placed: ({ x: number; y: number } | null)[] = [];
  const clampX = (v: number) => Math.min(box.x + box.w - half, Math.max(box.x + half, v));
  const clampY = (v: number) => Math.min(box.y + box.h - half, Math.max(box.y + half, v));
  let dropped = 0;
  for (let i = 0; i < callouts.length; i++) {
    const c = callouts[i] || ({} as { x: number; y: number; text: string });
    if (typeof c.x !== "number" || typeof c.y !== "number" || !isFinite(c.x) || !isFinite(c.y)) {
      placed.push(null); dropped++;
      notes.push(`callout ${i + 1} has no position — give it an x and a y, as percentages of the picture`);
      continue;
    }
    if (c.x < 0 || c.x > 100 || c.y < 0 || c.y > 100) {
      notes.push(`callout ${i + 1} points outside the picture (${pctText(c.x)}%, ${pctText(c.y)}%)` +
        ` — it is pinned to the edge; x and y are percentages of the picture, 0-100`);
    }
    const ox = clampX(box.x + (c.x / 100) * box.w);
    const oy = clampY(box.y + (c.y / 100) * box.h);
    let px = ox, py = oy, hitWith = -1, stuck = true;
    for (let guard = 0; guard <= 24; guard++) {
      let hit = -1;
      for (let j = 0; j < placed.length; j++) {
        const p = placed[j];
        if (p && Math.max(Math.abs(p.x - px), Math.abs(p.y - py)) < SHOT.separation) { hit = j; break; }
      }
      if (hit < 0) { stuck = false; break; }
      hitWith = hit;
      const p = placed[hit] as { x: number; y: number };
      const dx = px - p.x, dy = py - p.y;
      // Along the LARGER axis of the offset: pushing along the smaller one
      // walks a pin across the picture to escape a neighbour it was already
      // nearly clear of.
      if (Math.abs(dx) >= Math.abs(dy)) px = clampX(p.x + (dx >= 0 ? SHOT.separation : -SHOT.separation));
      else py = clampY(p.y + (dy >= 0 ? SHOT.separation : -SHOT.separation));
    }
    if (stuck) {
      placed.push(null); dropped++;
      notes.push(`callout ${i + 1} could not be placed without covering callout ${hitWith + 1}` +
        ` — it was left off; crop to the panel with image.region, or give it its own slide`);
      continue;
    }
    const moved = Math.sqrt((px - ox) * (px - ox) + (py - oy) * (py - oy));
    if (moved > 0.5) {
      notes.push(`callouts ${hitWith + 1} and ${i + 1} are closer than one pin's width — pin ${i + 1} was moved` +
        ` ${Math.round(moved)}pt so both stay readable; crop tighter with image.region if they must sit apart`);
    }
    placed.push({ x: px, y: py });
  }
  return { placed, dropped, notes };
}

/** One numbered pin: navy ring, white ring, blue disc, white numeral.
 *
 *  Concentric FILLS rather than an outlined disc, because preview-model reads
 *  no solid outline at all — only `outline.dashStyle === "DASH"` — so an
 *  outlined pin would be a pin the deck has and the preview does not. Fills
 *  round-trip already, which keeps the whole device inside the request kinds
 *  the preview check sweeps.
 *
 *  The numeral's box is the FULL pin box on purpose: at 9pt its ink reaches
 *  3.6 + 9*1.38 = 16.0pt, inside 22, so the overflow check sees no overrun, and
 *  with Chebyshev separation of at least the diameter plus one, two numeral
 *  boxes can never overlap. */
function pinRequests(
  id: (part: string) => string, page: string,
  cx: number, cy: number, n: number, d: number, numeralSize: number
): Req[] {
  const ro = d * SHOT.ringOuter, ri = d * SHOT.ringInner;
  const disc = (dd: number) => ({ x: cx - dd / 2, y: cy - dd / 2, width: dd, height: dd });
  return [
    ...filledShape(id("a"), page, "ELLIPSE", COLOR.navy, disc(d)),
    ...filledShape(id("b"), page, "ELLIPSE", COLOR.white, disc(d - 2 * ro)),
    ...filledShape(id("c"), page, "ELLIPSE", COLOR.blue, disc(d - 2 * ro - 2 * ri)),
    ...textBox(id("n"), page, String(n),
      { font: "Roboto", size: numeralSize, bold: true, color: COLOR.white }, disc(d),
      { align: "CENTER", vCenter: true, lineSpacing: 1.0, spaceBelow: 0 }),
  ];
}

/** The mat, the hairline and the picture, in that order.
 *
 *  The keyline is an OUTLINE BY INFLATION: a rectangle one point bigger than
 *  the picture on every side, with the picture drawn on top of it, leaves
 *  exactly 1pt of edge showing. Exact, and it needs nothing taught to the
 *  preview — where `updateImageProperties.outline` and filledShape's own
 *  `outline` are both invisible.
 *
 *  Slides cannot clip or round-corner an image, and nothing here pretends
 *  otherwise: the frame is drawn AROUND the picture, never over it. No scrim,
 *  ever — a gradient over a user interface destroys what the slide points at. */
function screenshotFrame(
  id: (s: string) => string, page: string, box: ShotBox, url: string, onDark: boolean
): Req[] {
  return [
    ...filledShape(id("shmat"), page, "RECTANGLE",
      onDark ? COLOR.white : SHOT.matLight, shotRect(inflateBox(box, SHOT.pad)),
      onDark ? SHOT.matDarkAlpha : undefined),
    ...filledShape(id("shkey"), page, "RECTANGLE",
      onDark ? COLOR.white : COLOR.navy, shotRect(inflateBox(box, SHOT.keyline)),
      onDark ? SHOT.keylineDarkAlpha : SHOT.keylineLightAlpha),
    {
      createImage: {
        objectId: id("shimg"),
        url,
        elementProperties: {
          pageObjectId: page,
          size: { width: pt(box.w), height: pt(box.h) },
          transform: { scaleX: 1, scaleY: 1, translateX: box.x, translateY: box.y, unit: "PT" },
        },
      },
    },
  ];
}

/** Nothing is missing, but what IS there cannot be read from the room.
 *
 *  A whole 1440px app window drawn 295pt wide is 4.9 source pixels per drawn
 *  point, which puts 13px interface body copy — the reference, because that is
 *  what a control's label is set in — at 2.7pt. Nothing geometric notices, so
 *  the note is the only thing that can. */
function legibilityNote(box: ShotBox, sourceWidth: number | undefined): string | null {
  if (!sourceWidth || !(box.w > 0)) return null;
  const perPt = sourceWidth / box.w;
  if (perPt <= SHOT.maxPxPerPt) return null;
  return `the screenshot is drawn ${Math.round(box.w)}pt wide from ${sourceWidth} source pixels —` +
    ` interface text lands at about ${(SHOT.uiBodyPx / perPt).toFixed(1)}pt and will not be readable from the room;` +
    ` crop to the panel with image.region`;
}

/** A pin is a percentage of the DRAWN box, and the drawn box is the shape of
 *  the file — unless nothing ever measured the file.
 *
 *  A draft saved before callouts shipped, and an attachment whose dimensions
 *  could not be read, arrive with no `aspect`: the picture is then fitted to
 *  SHOT.unknownAspect, which is a guess, and pdf-html's object-fit:cover crops
 *  away whatever does not match it. A pin at 20% of that box is not at 20% of
 *  the interface, and no geometry here can tell — the render is the only thing
 *  that sees it, so the note is the only thing that can say it. */
function guessedShapeNote(aspect: number | undefined, pins: number): string | null {
  if (!pins || typeof aspect === "number") return null;
  return `nothing measured this screenshot's proportions, so it is drawn at ${SHOT.unknownAspect}:1 —` +
    ` a guess, and its ${pins} pin${pins === 1 ? "" : "s"} ${pins === 1 ? "is" : "are"} placed against that` +
    ` rather than against the capture; re-attach the image so its shape is read`;
}

/** The callouts this slide will actually draw, and the note for the rest.
 *
 *  quoteClip is load-bearing: droppedContent filters out text a note has
 *  already quoted IN THAT EXACT FORM, so without it the model is told about
 *  the same lost phrase twice in two different voices. */
function calloutsFor(slide: SlideInput, note: (s: string) => void): { x: number; y: number; text: string }[] {
  const all = (slide.image?.callouts || []).filter((c) => c && String(c.text || "").trim());
  if (all.length <= SHOT.max) return all;
  const cut = all.slice(SHOT.max);
  note(`a screenshot carries at most ${SHOT.max} callouts — ${cut.map((c) => quoteClip(c.text)).join(", ")}` +
    ` ${cut.length === 1 ? "was" : "were"} left off; give the extra ones a second slide, or crop to the panel they are in`);
  return all.slice(0, SHOT.max);
}

/** "Showing 5 of 7 callouts" — the slot and the sentence shape the hub, the
 *  timeline, the process row and the stat grid all already use. */
function shotAdmission(
  objectId: string, page: string, shown: number, total: number,
  slot: { x: number; y: number; width: number }, onDark: boolean
): Req[] {
  if (shown >= total) return [];
  const t = `Showing ${shown} of ${total} callouts`;
  const w = Math.min(slot.width, labelBoxWidth(t, 7.5));
  return textBox(objectId, page, t,
    { font: "Roboto", size: 7.5, weight: 300, color: onDark ? COLOR.greyLight : COLOR.ink },
    { x: slot.x + slot.width - w, y: slot.y, width: w, height: SHOT_ADMISSION_H - 2 },
    { align: "END", lineSpacing: 1.0, spaceBelow: 0 });
}

/** A one-line box for a hugged label.
 *
 *  labelWidthPt measures the glyphs; estimateLines measures at a mixed-case
 *  MEAN, and the mean is the wider of the two. A box sized to the glyphs alone
 *  is therefore a box the overflow check reads as holding two lines — which is
 *  not a false alarm to be argued with, because the same estimator is what
 *  every layout here sizes with. So the box takes the wider of the two and the
 *  label is one line by both. */
function labelBoxWidth(t: string, size: number): number {
  const s = drawnText(String(t || "")).trim();
  return Math.max(labelWidthPt(t, size) + 6, s.length * size * faceAdvance() + 0.01) + TEXT_INSET_X;
}

/** How tall a block of text is when it HUGS its words — the height a box would
 *  need, as against the ceiling it is given. */
export function hugHeight(text: string | undefined, width: number, size: number, bullets: boolean): number {
  const paras = String(text || "").split("\n").map((l) => l.trim()).filter(Boolean);
  if (!paras.length) return 0;
  let lines = 0;
  for (let i = 0; i < paras.length; i++) lines += estimateLines(paras[i], width, size, bullets);
  return drawnTextHeight(lines, size, SPACE_BELOW, paras.length);
}

/** The feature legend's rows: `chip + phrase` entries laid across the content
 *  width, at most two rows, BALANCED so five entries read 3+2 rather than 4 and
 *  a lone orphan. Entries that will not fit in two rows are returned as the
 *  shortfall, for the caller to declare. */
function legendEntryWidth(t: string): number {
  // The trailing 18 is the gap to the NEXT entry; the caller drops it from the
  // last one when measuring a row to centre it.
  return SHOT.chip + labelBoxWidth(t, SHOT.legendSize) + 18;
}
function legendRowWidth(row: string[]): number {
  let w = 0;
  for (let i = 0; i < row.length; i++) w += legendEntryWidth(row[i]);
  return w - (row.length ? 18 : 0);
}
function legendLayout(entries: string[]): { rows: string[][]; kept: number } {
  const greedy = (list: string[]): string[][] => {
    const out: string[][] = [];
    let line: string[] = [], used = 0;
    for (let i = 0; i < list.length; i++) {
      const w = legendEntryWidth(list[i]);
      if (line.length && used + w > GRID.contentWidth) { out.push(line); line = []; used = 0; }
      line.push(list[i]); used += w;
    }
    if (line.length) out.push(line);
    return out;
  };
  for (let n = entries.length; n > 0; n--) {
    const kept = entries.slice(0, n);
    const rows = greedy(kept);
    if (rows.length > 2) continue;
    // A row too WIDE for the measure is as much a refusal as a third row, and
    // it used not to be one: greedy puts a phrase longer than the whole content
    // width on a line of its own and returned it, and the caller centred that
    // line — to a NEGATIVE x, so the numbered chip was drawn off the left edge
    // of the slide and the phrase was clipped at both ends. The entry falls
    // through to the n-- below and is declared as shortfall instead.
    let overWide = false;
    for (let i = 0; i < rows.length; i++) if (legendRowWidth(rows[i]) > GRID.contentWidth) overWide = true;
    if (overWide) continue;
    // Balanced, if the balance still fits the measure; greedy otherwise, since
    // an even split that overflows is worse than an uneven one that does not.
    const per = Math.ceil(n / rows.length);
    const even: string[][] = [];
    for (let i = 0; i < n; i += per) even.push(kept.slice(i, Math.min(n, i + per)));
    let fits = even.length <= 2;
    for (let i = 0; i < even.length; i++) if (legendRowWidth(even[i]) > GRID.contentWidth) fits = false;
    return { rows: fits ? even : rows, kept: n };
  }
  return { rows: [], kept: 0 };
}

/** Format a number the way a reader says it, not the way a machine stores it. */
function formatValue(v: number): string {
  const abs = Math.abs(v);
  if (abs >= 1_000_000_000) return `${(v / 1_000_000_000).toFixed(1).replace(/\.0$/, "")}bn`;
  if (abs >= 1_000_000) return `${(v / 1_000_000).toFixed(1).replace(/\.0$/, "")}m`;
  if (abs >= 1_000) return `${(v / 1_000).toFixed(1).replace(/\.0$/, "")}k`;
  return String(Number(v.toFixed(2)));
}

/* ─────────────── The stat card grid (four or more figures) ─────────────── */

type StatIn = { value: string; label: string; detail?: string; primary?: boolean; tone?: string };

/** Four or more figures are drawn as a grid of cards on the LIGHT ground. */
export function isStatGrid(stats: { value: string }[] | undefined): boolean {
  return (stats || []).filter(Boolean).length >= STAT_GRID_MIN;
}

/** The ground a slide is actually drawn on.
 *
 *  LAYOUT_STYLE fixes background, lockup and ink per LAYOUT, and `stat` is the
 *  one layout whose ground depends on the INSTANCE: up to three figures are
 *  the navy hero row, four or more are a card grid on off-white — the
 *  reference deck's page 3. On navy the grid was a 10% white wash between two
 *  light pages, which the room read as a section break that was not one.
 *
 *  EVERY reader of onDark, background or logo goes through here —
 *  buildSlideRequests, the lockup, the rhythm advisor, the image baker and
 *  the layout check — so no reader can answer for the layout while the slide
 *  is drawn on the other ground. */
const STAT_GRID_STYLE: LayoutStyle = { background: COLOR.offWhite, logo: "navy", logoPlacement: "content", onDark: false };
export function slideStyle(slide: Pick<SlideInput, "layout" | "stats" | "image">, index: number): LayoutStyle {
  // A layout-less hub is a hub here as it is in the builder (normaliseSlide).
  const layout = layoutOf(normaliseSlide(slide as SlideInput).layout, index);
  // A FEATURE SLIDE SHOWING A SCREENSHOT IS A NAVY STAGE, not a full bleed.
  // The layout's white eyebrow, title and body are solved for a baked
  // gradient, and a screenshot never gets one — so an attached light UI
  // capture drew white type on a near-white interface and the slide was
  // invisible. Decided here, with the stat grid, because this is the only
  // place a slide's ground may be read from.
  if (layout === "feature" && isScreenshot(slide)) return FEATURE_SHOT_STYLE;
  return layout === "stat" && isStatGrid(slide.stats) ? STAT_GRID_STYLE : LAYOUT_STYLE[layout];
}

/** The FIGURE's ink per tone. TONES carries each tint and its heading ink; the
 *  number on a grey card is brand blue — the reference's own ink for its
 *  landscape figures, 4.8:1 on tintGrey, enough for a 16pt-plus figure. */
const STAT_VALUE_INK: { [k: string]: string } = {
  grey: COLOR.blue, blue: COLOR.blue, teal: COLOR.inkTeal, coral: COLOR.inkCoral, amber: COLOR.inkAmber,
};

/** Which card a figure takes. An explicit tone wins; `primary` with no tone
 *  keeps the mint card it always took, so a spec written before tones existed
 *  draws exactly as it did; everything else is the quiet grey card. */
function statTone(sx: { primary?: boolean; tone?: string }): string {
  const key = String(sx.tone || "").toLowerCase();
  if (TONES[key]) return key;
  return sx.primary ? "teal" : "grey";
}

type StatRung = { value: number; label: number; pad: number; rowGap: number; sources: boolean };
interface StatPlan {
  rung: StatRung; rows: number; perRow: number;
  /** Cell width per ROW — a short last row stretches to the measure. */
  cellW: number[];
  cardH: number; vSize: number; vH: number; labelH: number; srcH: number;
  /** Grid plus the declaration line, when one is needed. */
  height: number; extra: number;
}

/** Measure one grid at one rung: rows of up to four, a short last row
 *  STRETCHED to the full measure (the reference's 4-then-3, where the wider
 *  second row is what gives its longest label two lines instead of three),
 *  every card the height of the tallest content in the grid. */
function planStatGrid(stats: StatIn[], rung: StatRung, extra: number): StatPlan {
  const G = STAT_GRID;
  const n = stats.length;
  const rows = Math.ceil(n / G.perRow);
  const perRow = Math.ceil(n / rows);
  const cellW: number[] = [];
  for (let r = 0; r < rows; r++) {
    const inRow = Math.min(perRow, n - r * perRow);
    cellW.push((GRID.contentWidth - G.gap * (inRow - 1)) / inRow);
  }
  const innerOf = (i: number) => cellW[Math.floor(i / perRow)] - G.padX * 2;
  // ONE size for every figure, solved from the narrowest cell and the longest
  // value: Poppins runs ~0.62 of the size per character, and the box carries
  // its own horizontal inset.
  let longest = 1, narrowest = Infinity;
  for (let i = 0; i < n; i++) {
    longest = Math.max(longest, stats[i].value.length);
    narrowest = Math.min(narrowest, innerOf(i));
  }
  const vSize = Math.max(G.valueMin, Math.min(rung.value, Math.floor((narrowest - TEXT_INSET_X) / (longest * 0.62))));
  const vH = drawnTextHeight(1, vSize, 0, 1, G.valueLead);
  let labelH = 0, srcH = 0;
  for (let i = 0; i < n; i++) {
    labelH = Math.max(labelH, drawnTextHeight(estimateLines(stats[i].label, innerOf(i), rung.label), rung.label, 0, 1, G.labelLead));
    if (rung.sources && stats[i].detail?.trim()) {
      srcH = Math.max(srcH, drawnTextHeight(
        estimateLines(stats[i].detail, innerOf(i), TYPE.statCardSource.size), TYPE.statCardSource.size, 0, 1, G.sourceLead));
    }
  }
  const cardH = rung.pad + vH + labelH + (srcH ? G.sourceGap + srcH : 0) + rung.pad;
  const height = rows * cardH + (rows - 1) * rung.rowGap + extra;
  return { rung, rows, perRow, cellW, cardH, vSize, vH, labelH, srcH, height, extra };
}

/** The grid, and where it ends.
 *
 *  COMPRESS BEFORE DROPPING: every rung at the full count — the last rung
 *  gives up the source lines — and only then one figure fewer, the rule every
 *  plot in this file follows. Whatever goes is DECLARED on the slide; a note
 *  line is part of the height being fitted, or it is the thing that overflows. */
function statGridRequests(
  page: string, id: (s: string) => string, all: StatIn[], band: number, topAlign: boolean,
  bandTop: number = GRID.bodyY
): { reqs: Req[]; height: number; bottom: number } {
  const G = STAT_GRID;
  const DECL_H = 14;
  // The room the cards actually have, which is the band less whatever was
  // taken above them — a standfirst. Written the way every plot in this file
  // writes it (`bandTop` in, `GRID.bodyY + band` as the floor) so the rung
  // ladder steps down against the room it will be drawn in rather than the
  // room the slide would have had without a line of context over it.
  const room = GRID.bodyY + band - bandTop;
  const hasSources = (list: StatIn[]) => list.some((s) => !!s.detail?.trim());
  let shown = all.slice(0, STAT_MAX);
  let plan: StatPlan | null = null;
  for (let count = shown.length; count >= STAT_GRID_MIN && !plan; count--) {
    const subset = all.slice(0, count);
    for (let r = 0; r < G.rungs.length; r++) {
      const rung = G.rungs[r];
      const declares = count < all.length || (!rung.sources && hasSources(subset));
      const p = planStatGrid(subset, rung, declares ? DECL_H : 0);
      if (p.height <= room + 0.01) { plan = p; shown = subset; break; }
    }
  }
  if (!plan) {
    // Four figures at the last rung do not fit the band's 90pt floor. Not
    // reachable through today's bands (a 3-line label with no sources is
    // 68pt); a guard, drawn rather than nothing.
    shown = all.slice(0, STAT_GRID_MIN);
    plan = planStatGrid(shown, G.rungs[G.rungs.length - 1], DECL_H);
  }
  const dropped = all.length - shown.length;
  const top = bandTop + (topAlign ? 0 : Math.max(0, (room - plan.height) / 2));
  const border = { color: COLOR.navy, alpha: G.borderAlpha, weight: G.borderWeight };
  const out: Req[] = [];
  for (let i = 0; i < shown.length; i++) {
    const sx = shown[i];
    const row = Math.floor(i / plan.perRow), col = i % plan.perRow;
    const cellW = plan.cellW[row];
    const inner = cellW - G.padX * 2;
    const x = GRID.margin + col * (cellW + G.gap);
    const y = top + row * (plan.cardH + plan.rung.rowGap);
    const tone = statTone(sx);
    out.push(...filledShape(id(`sc${i}`), page, "ROUND_RECTANGLE", TONES[tone].tint,
      { x, y, width: cellW, height: plan.cardH }, undefined, border));
    out.push(...textBox(id(`sv${i}`), page, sx.value,
      { ...TYPE.statCardValue, size: plan.vSize, color: STAT_VALUE_INK[tone] },
      { x: x + G.padX, y: y + plan.rung.pad, width: inner, height: plan.vH },
      { align: "CENTER", lineSpacing: G.valueLead }));
    // One height for every label in the grid, so the sources sit on one
    // baseline — and the label CENTRED in it, or a one-line label under a
    // two-line neighbour hangs off the top of its own slot.
    out.push(...textBox(id(`sl${i}`), page, sx.label,
      { ...TYPE.statCardLabel, size: plan.rung.label, color: TONES[tone].ink },
      { x: x + G.padX, y: y + plan.rung.pad + plan.vH, width: inner, height: plan.labelH },
      { align: "CENTER", lineSpacing: G.labelLead, vCenter: true }));
    // The source sits at the FOOT of the card, so the slack a shorter label
    // leaves falls between label and source — where the reference puts it —
    // and never between the figure and its caption.
    if (plan.srcH && sx.detail?.trim()) {
      out.push(...textBox(id(`sd${i}`), page, sx.detail, TYPE.statCardSource,
        { x: x + G.padX, y: y + plan.cardH - plan.rung.pad - plan.srcH, width: inner, height: plan.srcH },
        { align: "CENTER", lineSpacing: G.sourceLead, vCenter: true }));
    }
  }
  // A slide that drops data says so, on the slide.
  const gridBottom = top + plan.height - plan.extra;
  const said: string[] = [];
  if (!plan.rung.sources && hasSources(shown)) said.push("Sources omitted for room");
  if (dropped > 0) said.push(`Showing ${shown.length} of ${all.length} figures`);
  if (said.length) {
    out.push(...textBox(id("sdrop"), page, said.join(" · "), TYPE.statCardSource, {
      x: GRID.margin, y: gridBottom + 4, width: GRID.contentWidth, height: 10,
    }, { align: "END" }));
  }
  return { reqs: out, height: plan.height, bottom: top + plan.height };
}

/** Up to three headline numbers.
 *
 *  Often the honest answer when a deck reaches for a chart: a single figure
 *  with a caption carries a point that a plot of one bar only decorates. */
/** One number, as big as it can be drawn, centred on the ground. The crescendo
 *  slide is allowed to shout when it carries a single thing. */
function heroStat(
  page: string, id: (s: string) => string,
  stat: { value: string; label: string; detail?: string },
  band: number = GRID.bandHeight,
  bandTop: number = GRID.bodyY
): Req[] {
  // Poppins runs ~0.62 of the point size per character; solve the size that
  // fills the content width, floored so a short value does not become absurd
  // and capped so a long one still fits with the box insets.
  const INSET = 20;
  const labelH = 26;
  const detailH = stat.detail ? 40 : 0;
  const LEAD = 1.5;   // one Poppins line's drawn height as a fraction of the size
  // Bounded by BOTH the content width AND the vertical band — a short value
  // ("0", "64 GW") would otherwise scale so large it ran off the bottom. The
  // band is measured from `bandTop`, so a standfirst above the figure shrinks
  // the number rather than pushing it off the slide.
  const room = GRID.bodyY + band - bandTop;
  const byWidth = (GRID.contentWidth - INSET) / (Math.max(stat.value.length, 1) * 0.62);
  const byHeight = (room - labelH - (detailH ? detailH + 8 : 0)) / LEAD;
  const size = Math.max(54, Math.min(150, Math.floor(Math.min(byWidth, byHeight))));
  const valueH = size * LEAD;
  const groupH = valueH + labelH + (detailH ? detailH + 8 : 0);
  const top = bandTop + Math.max(0, (room - groupH) / 2);
  const out: Req[] = [
    ...textBox(id("sv0"), page, stat.value, { ...TYPE.statValue, size }, {
      x: GRID.margin, y: top, width: GRID.contentWidth, height: valueH,
    }, { align: "CENTER" }),
    ...textBox(id("sl0"), page, stat.label, TYPE.statLabel, {
      x: GRID.margin, y: top + valueH, width: GRID.contentWidth, height: labelH,
    }, { align: "CENTER" }),
  ];
  if (stat.detail) {
    out.push(...textBox(id("sd0"), page, stat.detail, TYPE.statDetail, {
      x: GRID.margin, y: top + valueH + labelH + 8, width: GRID.contentWidth, height: detailH,
    }, { align: "CENTER" }));
  }
  return out;
}

/** The figures, and the height they actually took.
 *
 *  The height is RETURNED rather than assumed by the caller. The stat band was
 *  a flat 56% of the content band and the body was placed at that mark, so the
 *  moment labels were measured honestly — and the block grew — the source lines
 *  were drawn straight through the first body bullet. A block whose height
 *  depends on its content cannot have its neighbour placed by a constant. */
function statRequests(
  page: string, id: (s: string) => string,
  stats: StatIn[],
  band: number = GRID.bandHeight,
  onDark = false,
  topAlign = false,
  bandTop: number = GRID.bodyY
): { reqs: Req[]; height: number; bottom: number } {
  // Everything below places itself against `bandTop` and measures against the
  // room left beneath it, so the figures can be given the band MINUS a
  // standfirst without a single one of the measurements above changing.
  const room = GRID.bodyY + band - bandTop;
  // EIGHT, not three.
  //
  // This said slice(0, 3), and a source page carrying SEVEN figures with their
  // sources was rendered as three with four silently gone — the single worst
  // failure in a conversion, because the slide looks finished. Seven fits
  // comfortably as two tinted rows, which is exactly how the source deck draws
  // it. Past eight a figure stops being a headline number and the slide wants
  // a table, so eight is the ceiling and anything beyond it is DECLARED.
  const all = stats.filter(Boolean);
  if (!all.length) return { reqs: [], height: 0, bottom: bandTop };
  // FOUR OR MORE take the card grid on the LIGHT ground — see slideStyle()
  // and statGridRequests. The two-row grid used to live below, on navy at a
  // 10% white wash, and only from five: at four the figures were a 54pt hero
  // row with the rest of a source page demoted to bullets beneath it, so the
  // takeaway's "note the second row" pointed at a row that did not exist.
  if (isStatGrid(all)) return statGridRequests(page, id, all, band, topAlign, bandTop);
  const shown = all;

  // A SINGLE stat is the moment the slide exists for — the fee, the headline
  // number — and it earns the whole canvas. statRequests used to size every
  // value to the longest string and cap at 54pt, so a lone "CHF 12,500" sat
  // small in a sea of navy. One stat is drawn big and centred.
  //
  // `primary` among several does NOT drop the others (that would lose data);
  // it tints that column so the eye lands on it. The single-stat hero is the
  // real fix for the ask slide the audit flagged.
  if (shown.length === 1) return { reqs: heroStat(page, id, shown[0], band, bandTop), height: room, bottom: bandTop + room };

  const out: Req[] = [];

  // Two or three: the navy hero row, one figure per column.
  const cell = (GRID.contentWidth - CHART.statGap * (shown.length - 1)) / shown.length;
  let groupH = CHART.statValueHeight + CHART.statLabelHeight + CHART.statDetailHeight + 4;
  let top = bandTop + (topAlign ? 0 : Math.max(0, (room - groupH) / 2));

  // Size the number to its column instead of trusting one fixed size.
  //
  // "92.5 GW" at 54pt is wider than a third of the slide, so it wrapped, and a
  // two-line value in a one-line box overflowed downward straight through its
  // own label and detail. Poppins runs about 0.58 of the point size per
  // character, so the size that fits is solvable rather than guessable.
  //
  // Two corrections after seeing this rendered by Google rather than estimated:
  // a text box carries a default inset of 0.1in on each side, so the usable
  // width is ~15pt less than the box; and Poppins runs nearer 0.62 of the point
  // size per character than the 0.58 first assumed. At 0.58 with no inset
  // allowance, "92.5 GW" was computed to fit at 50pt and wrapped anyway.
  const INSET = 15;
  const PER_CHAR = 0.62;
  // A FIGURE SETS THE ROW'S SIZE; A PHRASE DOES NOT.
  //
  // One size across the row is right for figures — "66" beside "5" must read
  // as the same kind of thing. But the size was solved from the longest value
  // of ANY kind, so one phrase in the row set it for everything: a deck put
  // "Monitoring-only" beside "66" and "5", and both numbers drew at 22pt where
  // the same row of numbers draws at 54pt — the two figures the slide existed
  // for, shrunk to under half by a caption sitting in a value's slot.
  //
  // A figure is anything with a digit in it: "66", "92.5 GW", "CHF 12,500",
  // "70%". A value with none is a phrase, and gets its own fit, never larger
  // than the figures beside it so it cannot out-shout them either.
  const isFigure = (v: string) => /\d/.test(v);
  const figures = shown.filter((sx) => isFigure(sx.value));
  const sizeBasis = figures.length ? figures : shown;
  const longest = Math.max(...sizeBasis.map((sx) => sx.value.length), 1);

  const fitted = Math.floor((cell - INSET) / (longest * PER_CHAR));
  const valueStyle = { ...TYPE.statValue, size: Math.max(22, Math.min(TYPE.statValue.size, fitted)) };
  const styleFor = (v: string) => {
    if (!figures.length || isFigure(v)) return valueStyle;
    const own = Math.floor((cell - INSET) / (Math.max(v.length, 1) * PER_CHAR));
    return { ...valueStyle, size: Math.max(16, Math.min(valueStyle.size, own)) };
  };

  // MEASURE THE LABEL. It used to get a fixed 0.3in and the source line was
  // placed immediately below that, so a label wrapping to three lines — "MORE
  // CLICKS WHEN YOU ARE CITED IN THE AI OVERVIEW" — had its last line drawn
  // through by its own source. The labels are caps, which is why the naive
  // estimate said two lines and Google drew three.
  //
  // One height for the whole row, taken from the tallest label: the columns
  // are read across, so their source lines must sit on one baseline.
  const labelH = Math.max(
    CHART.statLabelHeight,
    ...shown.map((sx) => drawnTextHeight(
      estimateLines(sx.label, cell, TYPE.statLabel.size, false, !!TYPE.statLabel.caps),
      TYPE.statLabel.size)),
  );
  const detailLines = Math.max(0,
    ...shown.map((sx) => estimateLines(sx.detail, cell, TYPE.statDetail.size)));
  // One value for the box AND for the height the caller is told about. They
  // used to differ — the box took a 0.7in floor while the group height took
  // the measurement — which is the same class of mistake as the fixed label.
  const detailH = detailLines
    ? Math.max(drawnTextHeight(detailLines, TYPE.statDetail.size), TYPE.statDetail.size * 1.45 + TEXT_INSET_Y)
    : 0;

  groupH = CHART.statValueHeight + labelH + (detailH ? detailH + 4 : 0);
  top = bandTop + (topAlign ? 0 : Math.max(0, (room - groupH) / 2));

  shown.forEach((sx, i) => {
    const x = GRID.margin + i * (cell + CHART.statGap);
    // The primary column keeps the others' size but takes the lime accent, so
    // one of three numbers reads as THE number without shrinking the rest.
    const base = styleFor(sx.value);
    const thisValue = sx.primary ? { ...base, color: COLOR.lime } : base;
    out.push(
      ...textBox(id(`sv${i}`), page, sx.value, thisValue, {
        x, y: top, width: cell, height: CHART.statValueHeight,
      }),
      ...textBox(id(`sl${i}`), page, sx.label, TYPE.statLabel, {
        x, y: top + CHART.statValueHeight, width: cell, height: labelH,
      }),
      ...textBox(id(`sd${i}`), page, sx.detail, TYPE.statDetail, {
        x, y: top + CHART.statValueHeight + labelH + 4,
        width: cell, height: detailH,
      }),
    );
  });
  return { reqs: out, height: groupH, bottom: top + groupH };
}

/** The gap between a standfirst and whatever it introduces. Named for the two
 *  branches that share this one: the chart band and the figures, which are the
 *  same `if` and would otherwise hold two copies of the number the stat slide
 *  was carved out of. The layers and hub branches set the same 8 of their own,
 *  and are left alone here rather than swept up in a change about `stat`. */
const STANDFIRST_GAP = 8;
/** The air between the figures and the bullets beneath them. */
const STAT_BODY_GAP = 10;

/** WHAT THE FIGURES WOULD ACTUALLY DRAW IN A GIVEN BAND — built, not restated.
 *
 *  The standfirst on a stat slide is not paid for out of slack: it is paid for
 *  out of the band the figures already have. So the question is never "is
 *  there room for a line of type" — the answer to that is always yes, because
 *  the rung ladder will step down and then start dropping figures to make it
 *  true. The question is whether anything CHANGES, and the only honest way to
 *  ask it is to lay the figures out both ways and compare.
 *
 *  Built rather than measured from a second copy of the rules, for the reason
 *  droppedContent gives at length: the stat block has three branches, a five-
 *  rung ladder, a figure-dropping loop and two declaration lines, and any
 *  restatement of when each fires would be a second answer to drift from the
 *  first. The drawn TEXT is the comparison because that is where a loss shows
 *  up — "Showing 6 of 7 figures" and "Sources omitted for room" are drawn
 *  strings, so a standfirst bought with a figure or with the source lines
 *  changes the text and is refused. A rung's smaller type does not change it,
 *  and should not: compression is what the ladder is for, and the takeaway bar
 *  has always shortened this band the same way. */
function statProbe(
  stats: StatIn[], band: number, onDark: boolean, topAlign: boolean, bandTop: number
): { bottom: number; ink: number; drawn: string } {
  const out = statRequests("probe", (s) => `probe_${s}`, stats, band, onDark, topAlign, bandTop);
  // TWO bottoms, because the block has two and they are not the same number.
  // `bottom` is what the block REPORTS, which is where the caller puts the
  // bullets; `ink` is how far the boxes actually reach. A single figure is a
  // hero: it reports the whole band and draws a centred group in the middle of
  // it, so measuring the prose against the ink would promise room under the
  // figure that the caller will never give it.
  let ink = bandTop;
  const text: string[] = [];
  for (let i = 0; i < out.reqs.length; i++) {
    const shape = (out.reqs[i] as any).createShape;
    if (shape) {
      ink = Math.max(ink,
        shape.elementProperties.transform.translateY + shape.elementProperties.size.height.magnitude);
    }
    const ins = (out.reqs[i] as any).insertText;
    if (ins) text.push(String(ins.text));
  }
  return { bottom: out.bottom, ink, drawn: text.join(" · ") };
}

/** The size the bullets under the figures land on, and whether they landed.
 *
 *  Slides does not shrink text to fit a box: it draws it and lets it run
 *  straight through the takeaway bar beneath, which is what happened the
 *  moment that bar came up off the bezel. So the step down to 9 and then the
 *  8pt floor is the fit, and `fits` is false when even the floor overruns —
 *  the one thing the caller may not do silently. One function because the
 *  standfirst has to ask what the prose will do BEFORE the prose is drawn. */
function statBodyFit(
  body: string, room: number, base: TypeStyle
): { style: TypeStyle; fits: boolean } {
  let out = base;
  for (const sz of [base.size, 9, 8]) {
    out = { ...base, size: sz };
    // MEASURED THE WAY IT IS DRAWN: a stack of hung-dot boxes at the full
    // measure, not one indented bulleted box. Two rulers here is a body judged
    // to fit and drawn through the takeaway bar, or the reverse.
    if (bulletBlockHeight(body, GRID.contentWidth, out) <= room) return { style: out, fits: true };
  }
  return { style: out, fits: false };
}

/** Fit a heading into the room above the body, growing UPWARD and shrinking
 *  only when it must.
 *
 *  The title box was a fixed 45pt and the body began the instant it ended — no
 *  gap at all — and Slides does not shrink text to fit a box: it draws it and
 *  lets it run. So a three-line title was drawn straight through the first two
 *  lines of its own body, on a slide that looked fine in code and was
 *  unreadable in Drive. Nothing caught it, because the BOXES did not overlap;
 *  the ink did.
 *
 *  Upward, because the space between the eyebrow and the title is dead — 48pt
 *  of it — while everything below the title is spoken for by charts, plots and
 *  columns that are positioned from the grid. Growing up costs nothing and
 *  needs no layout to change. The font only shrinks when even that is not
 *  enough, and never below a size a room can read.
 */
const TITLE_GAP = 12;
const TITLE_MIN_SIZE = 14;

export function fitHeading(
  text: string | undefined,
  style: TypeStyle,
  width: number,
  opts: {
    bottom: number; minTop: number; minHeight: number; minSize?: number; lineSpacing?: number;
    /** The sizes the ladder may stop at, largest first — the density preset's
     *  own rungs. Absent, the ladder steps down a point at a time, which is
     *  what every caller did before there was a preset and what `read` still
     *  does. See DENSITY.titleRungs for why `present` does not: an eleven-step
     *  ladder draws titles at 30/29/28/27/26, which is four differences nobody
     *  can see and one deck that stops reading as one system. */
    rungs?: readonly number[];
  }
): { style: TypeStyle; y: number; height: number } {
  const floor = opts.minSize ?? TITLE_MIN_SIZE;
  const room = Math.max(opts.minHeight, opts.bottom - opts.minTop);
  // Measured at the spacing the caller will DRAW at. The section divider sets
  // its title at 110% rather than the 115% default; fitted at the default the
  // box carried 2pt of slack per line that the subtitle was then stacked
  // beneath. Undefined keeps LINE_LEAD, so every other caller is unchanged.
  const measure = (at: number) =>
    drawnTextHeight(Math.max(1, estimateLines(text, width, at)), at, 0, 1, opts.lineSpacing);
  let size = style.size;
  let need = measure(size);
  if (opts.rungs && opts.rungs.length) {
    // Indexed loop: tsconfig sets no target, so iterating an array's iterator
    // needs downlevelIteration and fails the production build.
    for (let i = 0; i < opts.rungs.length; i++) {
      size = Math.max(floor, opts.rungs[i]);
      need = measure(size);
      if (need <= room) break;
    }
  } else {
    while (need > room && size > floor) {
      size -= 1;
      need = measure(size);
    }
  }
  const height = Math.min(Math.max(need, opts.minHeight), room);
  return { style: size === style.size ? style : { ...style, size }, y: opts.bottom - height, height };
}

/** The layout to draw, from whatever the model actually said.
 *
 *  `LAYOUT_STYLE[slide.layout]` was read straight from the tool argument, so a
 *  name outside the enum returned undefined and the next line threw — taking
 *  out the WHOLE deck, not one slide, and surfacing as "Google Slides creation
 *  failed" for a call that never reached Google. The aliases are the sibling
 *  .pptx tool's enum, which the model sees in the same turn and reaches for. */
const LAYOUT_ALIASES: Record<string, SlideLayout> = {
  title: "cover", blank: "content", bullets: "content", text: "content",
  image: "feature", photo: "feature", chart: "bar-chart", divider: "section",
  agenda: "content", "thank-you": "closing", end: "closing",
};

export function layoutOf(raw: string | undefined, index: number): SlideLayout {
  if (raw && Object.prototype.hasOwnProperty.call(LAYOUT_STYLE, raw)) return raw as SlideLayout;
  return LAYOUT_ALIASES[(raw || "").toLowerCase()] ?? (index === 0 ? "cover" : "content");
}

/** A deliberately generous estimate of how many lines a string takes in a box,
 *  and how far down the box its last line reaches.
 *
 *  Generous because the consequence of under-estimating is text running off the
 *  slide, and the consequence of over-estimating is a little white space. Slides
 *  does not reflow or shrink to fit — it draws and lets it run — so nothing
 *  downstream corrects a bad guess.
 *
 *  Exported so the layout check measures with the same primitive the layout
 *  does; two estimators would drift and the check would stop meaning anything. */
export const TEXT_INSET_X = SLIDES_TEXT_INSET.x * 2;
export const TEXT_INSET_Y = SLIDES_TEXT_INSET.y * 2;
/** The footer line's top: its text sits ~15pt clear of the bottom edge, which
 *  is outside the overscan of the projectors this deck is shown on. */
export const FOOTER_Y = CANVAS.height - 24;
/** Average glyph advance in ems, PER FACE, plus 6%.
 *
 *  Measured rather than assumed: canvas measureText against Google's own
 *  webfonts, over four real body lines of this deck's copy — Roboto Light
 *  0.418, Playfair Display 0.465, Poppins 0.526 (see the check that pins
 *  these). One global worst case was Poppins, and it over-measured ROBOTO —
 *  the body face every bullet is drawn in — by nearly a third. A bullet that
 *  draws on one line was counted as two, so seven bullets that fitted a slide
 *  were split across two, which is what the deck's bullet slides splitting
 *  unnecessarily was. */
const FACE_ADVANCE: Record<string, number> = {
  "Roboto": 0.443,
  "Playfair Display": 0.493,
  "Poppins": 0.558,
};
/** All-caps advance for a face, absolute rather than a ratio off the mixed
 *  case. Roboto bold caps measures 0.616em, a ratio of 1.47 to Roboto's own
 *  mixed case and nothing like the 1.2 that fits the unnamed default — so one
 *  global ratio cannot serve both. Raising the ratio to Roboto's widened every
 *  caps label measured WITHOUT a face by a quarter, and the overlap battery
 *  caught it on the stacked-bar labels. */
const FACE_CAPS_ADVANCE: Record<string, number> = {
  "Roboto": 0.653,
};
const PER_CHAR = 0.55;              // unchanged, for a caller that names no face
/** The advance for a named face, falling back to the unnamed default. Only a
 *  caller that KNOWS the face gets the narrower measure; every other call
 *  measures exactly as it did before. */
export function faceAdvance(font?: string, caps = false): number {
  if (caps) return (font && FACE_CAPS_ADVANCE[font]) || PER_CHAR * CAPS_WIDEN;
  return (font && FACE_ADVANCE[font]) || PER_CHAR;
}

/** Roboto's advance for every printable ASCII glyph (32–126), in thousandths
 *  of an em, at SEMIBOLD-TO-BOLD: for each glyph the wider of weight 600 and
 *  weight 700.
 *
 *  WHY A TABLE, when faceAdvance is a mean. A mean is right for a paragraph and
 *  wrong for a label, because a label is too short to average out. A hub node
 *  was sized at 0.55em a character with no slack, so any label whose OWN
 *  advance ran above that wrapped inside its node — "MS Teams" is 0.595em at
 *  600, three capitals in eight characters, and a capitals-aware class model
 *  (upper, lower, digit, space) still missed it by 14%. Summed glyph by glyph
 *  the only error left is kerning: 0.0–1.2% on real labels, 2.8% on the worst
 *  case found ("AVATAR TOWER"), all inside the 6% margin.
 *
 *  Measured, 2026-09-15: canvas measureText at 1000px in headless Chrome
 *  against Google's own Roboto webfont (variable, so 600 and 700 are both real
 *  weights), scratchpad glyphs/glyphs.html. 700 is the wider on 67 glyphs, 600
 *  on 23 — by at most 2.4%, on "/" — and they tie on 5. The table takes the
 *  wider per glyph rather than betting on which weight Slides draws for 600,
 *  which is undocumented. Weight 600 row, for the record: 249 268 319 598 571
 *  738 649 164 348 350 449 550 235 367 284 380, 571 for every digit, then
 *  273 251 509 568 518 492 897 667 635 654 651 564 550 681 708 288 557 634 540
 *  875 708 689 642 689 635 611 615 657 649 878 633 615 605 274 419 274 434 446
 *  325 537 562 522 563 538 356 569 558 260 256 528 260 869 559 566 562 565 360
 *  514 336 558 501 738 506 497 506 331 250 331 655.
 *
 *  NOT a replacement for faceAdvance: the splitter's thresholds are pinned to
 *  that mean, and moving them moves every split point in every deck. */
const ROBOTO_BOLD_ADVANCE = [
  249, 270, 319, 598, 574, 739, 657, 164, 350, 351, 454, 550, 246, 394, 290, 380, 574, 574, 574,
  574, 574, 574, 574, 574, 574, 574, 282, 263, 510, 574, 518, 498, 897, 672, 638, 655, 651, 564,
  550, 681, 708, 292, 559, 636, 541, 875, 708, 690, 645, 690, 641, 616, 620, 659, 653, 878, 635,
  619, 607, 277, 422, 277, 438, 446, 330, 537, 563, 522, 563, 540, 358, 571, 560, 265, 260, 534,
  265, 869, 561, 566, 563, 565, 366, 514, 338, 560, 506, 738, 509, 504, 509, 331, 252, 331, 655,
];
/** A glyph outside the table — an accented letter, a curly quote — is taken as
 *  the mean capital: wider than most lower case, so a label full of them
 *  over-measures rather than wraps. */
const ROBOTO_BOLD_UNKNOWN = 642;
/** Playfair Display 400, the same measurement, for the one Playfair box that
 *  must fit a shape rather than a column: the name in a hub's circle.
 *
 *  faceAdvance's 0.493 is a body-copy mean, and a name is not body copy — it is
 *  Title Case and short. "Content Operations Hub" measures 0.502em a character
 *  before the margin, so "Operations Hub" was judged to fit a 99pt line at
 *  14pt, drew 106pt, and took a third line straight through the caption under
 *  it. Kerning error summed per glyph: 0.0–0.7% on names, 5.2% on the worst
 *  pair-heavy case found ("WAVE AVATAR"), inside the margin. Measured
 *  2026-09-15, scratchpad glyphs/playfair.html. */
const PLAYFAIR_ADVANCE = [
  249, 262, 298, 637, 523, 742, 837, 189, 294, 294, 492, 587, 261, 499, 252, 372, 600, 370, 479,
  451, 494, 415, 517, 406, 520, 509, 266, 285, 608, 647, 608, 459, 878, 630, 623, 688, 723, 609,
  569, 703, 757, 339, 326, 655, 588, 871, 706, 741, 585, 741, 648, 540, 621, 682, 630, 905, 634,
  591, 594, 296, 372, 296, 536, 591, 283, 498, 563, 486, 581, 506, 332, 528, 588, 293, 267, 550,
  286, 888, 597, 548, 581, 563, 445, 447, 354, 581, 489, 770, 519, 504, 476, 304, 222, 304, 649,
];
const PLAYFAIR_UNKNOWN = 642;

/** Roboto LIGHT's advance for every printable ASCII glyph (32–126), in
 *  thousandths of an em — weight 300, which is what every bullet in this deck
 *  is set in.
 *
 *  Measured 2026-09-21, the same way the bold table above was: a 1000px span
 *  in headless Chrome against Google's own Roboto webfont, on the deck's own
 *  rendered page so the face is certainly the one Slides will draw, with
 *  `document.fonts.check` asserted before anything was read.
 *
 *  WHY A TABLE HERE WHEN faceAdvance ALREADY HAS A ROBOTO MEAN. Because the
 *  mean is not Roboto's. FACE_ADVANCE records 0.418 for Roboto Light; the four
 *  real body lines of this deck measure 0.4467, 0.4582, 0.4607 and 0.4656 in
 *  the actual face. They measure 0.4113, 0.4192, 0.4199 and 0.4363 — a mean of
 *  0.4217 — in Chrome's FALLBACK serif, which is what a canvas measures when
 *  the webfont has not been awaited with `document.fonts.load`. So the deck's
 *  body ruler is about 3% narrow before its 6% margin is applied, and the net
 *  slack a wrap has to live on is nearer 3% than 6%.
 *
 *  THAT IS NOT FIXED HERE, and deliberately. faceAdvance's 0.443 is what all
 *  618 stored slides were laid out on, and the splitter's thresholds are
 *  pinned to it — the same sentence labelWidthPt's own header ends with. This
 *  table is used only by raggedLines, which only the layouts written against
 *  it ask for, so nothing already drawn moves. The open issue says the rest. */
const ROBOTO_LIGHT_ADVANCE = [
  244, 226, 287, 582, 555, 739, 615, 170, 319, 326, 424, 565, 192, 286, 239, 397, 555, 555, 555,
  555, 555, 555, 555, 555, 555, 555, 210, 195, 511, 553, 519, 454, 913, 625, 613, 649, 655, 569,
  563, 684, 708, 266, 551, 631, 527, 865, 710, 677, 616, 677, 635, 593, 597, 657, 617, 896, 612,
  599, 598, 240, 394, 240, 416, 432, 286, 536, 554, 515, 556, 517, 331, 555, 549, 225, 228, 490,
  225, 887, 550, 560, 554, 558, 337, 507, 322, 549, 481, 754, 487, 475, 487, 330, 221, 330, 685,
];
/** A glyph outside the light table, taken as its mean capital, for the same
 *  reason the bold table takes one: an accented letter should over-measure
 *  rather than wrap. */
const ROBOTO_LIGHT_UNKNOWN = 655;

/** A code point drawn a full em wide whatever the face: CJK, kana, Hangul,
 *  fullwidth forms, and emoji. Roboto and Playfair carry none of these, so the
 *  fallback face draws them, at 1000 (東 1004, オ 1000, ✅ 1000, 🚀 1000 —
 *  Chrome, 2026-09-15). Taken as the mean capital they were under-measured by
 *  a third: "東京オフィス" predicted 4.08em and drew 6.01, wrapping inside its
 *  node and running a centred group name onto the hub's rings with no note. */
function drawsFullWidth(cp: number): boolean {
  return (cp >= 0x1100 && cp <= 0x115f) || (cp >= 0x2600 && cp <= 0x27bf) || (cp >= 0x2b00 && cp <= 0x2bff) ||
    (cp >= 0x2e80 && cp <= 0xa4cf) || (cp >= 0xac00 && cp <= 0xd7a3) || (cp >= 0xf900 && cp <= 0xfaff) ||
    (cp >= 0xfe30 && cp <= 0xfe4f) || (cp >= 0xff00 && cp <= 0xff60) || (cp >= 0xffe0 && cp <= 0xffe6) ||
    (cp >= 0x1f000 && cp <= 0x1faff) || (cp >= 0x20000 && cp <= 0x3fffd);
}

/** How wide a single line is, in points, plus 6%: semibold or bold Roboto by
 *  default, or Playfair Display 400 when `face` says so. Measures what Slides
 *  will hold (markup stripped), in capitals when the box draws them. For a box
 *  that must hold ONE line, or a line wrapped to a shape; a paragraph in a
 *  column wants estimateLines.
 *
 *  Walked by CODE POINT, not UTF-16 unit: an astral emoji is one glyph and
 *  was counted as two, and a variation selector or joiner draws nothing. */
export function labelWidthPt(
  text: string | undefined, size: number, opts: { caps?: boolean; face?: "Roboto" | "Playfair Display" } = {}
): number {
  let s = drawnText(String(text ?? "")).trim();
  if (opts.caps) s = s.toUpperCase();
  const playfair = opts.face === "Playfair Display";
  const table = playfair ? PLAYFAIR_ADVANCE : ROBOTO_BOLD_ADVANCE;
  const unknown = playfair ? PLAYFAIR_UNKNOWN : ROBOTO_BOLD_UNKNOWN;
  let em = 0;
  for (let i = 0; i < s.length;) {
    const cp = s.codePointAt(i) as number;
    i += cp > 0xffff ? 2 : 1;
    if (cp === 0x200d || (cp >= 0xfe00 && cp <= 0xfe0f)) continue;
    em += cp >= 32 && cp <= 126 ? table[cp - 32] : drawsFullWidth(cp) ? 1000 : unknown;
  }
  return (em / 1000) * size * 1.06;
}
const LINE_LEAD = 1.45;             // 115% paragraph spacing on a ~1.26em face
/** How much wider an all-caps run runs than that mixed-case average. Measured
 *  against Google's own render of the deck's caps labels and status pills:
 *  Roboto bold caps is 0.616em against Light's 0.418, a ratio of 1.47.
 *
 *  This moved WITH the per-face advances above and had to. At the old global
 *  0.55 a caps label came out at 0.66em; at Roboto's own 0.443 the old 1.2
 *  would have made it 0.53 — under-measuring every caps label by a seventh,
 *  which is how a correct fix to body copy quietly breaks the eyebrows. The
 *  pair now lands at 0.653 for Roboto and 0.66 for everything else, which is
 *  where caps sat before. */
export const CAPS_WIDEN = 1.2;

/** The lower edge a layout may draw to: its own natural bottom, or the content
 *  band's, whichever is higher.
 *
 *  Every analysis layout — swot, matrix, comparison, scatter, venn — measured
 *  down to `CANVAS.height - GRID.margin`, the page edge, and so knew nothing
 *  about the takeaway bar sitting above it. On the comparison slide the seventh
 *  row was drawn UNDERNEATH the bar: present in the file, invisible on the
 *  slide, and no warning anywhere. `table` had already been fixed this way one
 *  layout at a time; this is the same fix applied to the rest of them at once. */
function floorBand(natural: number, bandBottom?: number, reserve = 0): number {
  // `reserve` is the room a layout draws BELOW its own bottom — an axis label
  // sits under the plot, not inside it. The natural bottom already keeps that
  // room back from the page edge; clamping to the band without subtracting it
  // again simply moved the label under the bar instead of the row.
  return Math.min(natural, bandBottom === undefined ? Infinity : bandBottom - reserve);
}

/** How wide a status capsule must be to hold its token on ONE line.
 *
 *  The width used to be the token's advance plus a flat 16pt, which did not
 *  even cover the text box's own 14.4pt of horizontal inset — and the token is
 *  bold caps, wider again than the mixed-case average PER_CHAR assumes. Every
 *  capsule on the channel scorecard wrapped inside itself: "MED" drawn as
 *  "ME / D", "NONE" as "NON / E".
 *
 *  Exported because the decision it feeds — capsule, or plain text when even
 *  this will not fit — is NOT reachable through a real table: fitColumnWidths
 *  never leaves a status column that narrow, so a check driving the table only
 *  ever sees the capsule branch and the fallback would be pinned by nothing.
 *  This function is the seam where both answers can be asked for. */
export function pillWidth(token: string, size: number): number {
  return token.length * size * PER_CHAR * CAPS_WIDEN + TEXT_INSET_X + 10;
}

/** The characters Slides will actually hold, once the markup this pipeline
 *  strips has been stripped.
 *
 *  Measurement has to run on this, not on the source. The house style opens
 *  almost every bullet with a bold lead-in, and four asterisks a bullet made a
 *  six-line body measure as ten — so the splitter cut slides in half that fit
 *  on one, which is what the bullet slides splitting over two slides was. A
 *  markdown link is worse: the whole URL was counted and none of it is drawn. */
export function drawnText(source: string): string {
  return parseAccents(parseBold(extractLinks(stripImageMarkdown(source)).text).text).text;
}

export function estimateLines(
  text: string | undefined, boxWidth: number, size: number, bullets = false, caps = false, font?: string
): number {
  const s = drawnText(text ?? "").trim();
  if (!s) return 0;
  const usable = Math.max(size, boxWidth - TEXT_INSET_X - (bullets ? BULLET_INDENT : 0));
  // CAPITALS ARE WIDER. PER_CHAR is a mixed-case average, and a `caps: true`
  // style draws every glyph at its widest — a stat label measured as two lines
  // came back from Google as three, and the source line underneath it was drawn
  // straight through the third. The line COUNT changes; the leading does not,
  // so callers still ask drawnTextHeight for the height at the real size.
  const perLine = Math.max(1, Math.floor(usable / (size * faceAdvance(font, caps))));
  const paras = s.split("\n");
  let lines = 0;
  for (let i = 0; i < paras.length; i++) {
    lines += Math.max(1, Math.ceil(paras[i].trim().length / perLine));
  }
  return lines;
}

/** THE RAGGED RIGHT EDGE, AND THE MEASURE AT WHICH IT STOPS BEING FREE.
 *
 *  estimateLines divides a character COUNT by a characters-per-line figure,
 *  which is a model of a paragraph that may break anywhere. Slides breaks on
 *  words, so every line ends short by however much of the next word did not
 *  fit, and that waste is what the count model does not pay for.
 *
 *  It is free on a wide measure and it is not free on a narrow one, because
 *  the waste is ABSOLUTE — about half a word, whatever the column — while the
 *  6% margin baked into faceAdvance is PROPORTIONAL to the line. Setting the
 *  two equal is where the threshold below comes from: half of a 5.5-character
 *  word is 2.75 characters, and 0.06 * usable = 2.75 * size * advance solves
 *  to a line of about 46 characters. It is expressed as characters rather than
 *  as points because it has to hold at both density presets, where the same
 *  column carries a different size.
 *
 *  Measured, not reasoned: 240 real body paragraphs from the stored corpus
 *  rendered through the PDF path in headless Chrome and compared with the box
 *  the builder sized for them. At a 315pt two-column measure 5 of 240 render
 *  taller than their box; at the photo rail's 187pt it is 43, and at the
 *  three-column band's 196pt it is 39. The consequence is not an overrun —
 *  it is the paragraph gap beneath, which the block solves against the stack's
 *  natural height: a paragraph that draws a line more than it was measured for
 *  eats the blank line under it, and two bullets read as one run-on paragraph
 *  while the column beside it keeps its gap. */
const RAGGED_BELOW_CHARS = 46;

/** The margin on a summed word width. Per-glyph advances are exact to within
 *  kerning, which labelWidthPt measured at 0.0–1.2% on real strings and 2.8%
 *  on the worst pair-heavy case it could find. Three per cent covers the
 *  measured range with room, and it is deliberately NOT labelWidthPt's 6%:
 *  that margin is sized for a mean, and applied to a word-by-word wrap it
 *  bought a whole extra line at every boundary — two columns whose lead-ins
 *  render to the same depth started their next paragraph 14.5pt apart. */
const RAGGED_KERN = 1.03;

/** Whether a measure is narrow enough that the ragged edge has to be paid for.
 *  ONE PLACE, because the splitter's probe and the block that draws the words
 *  have to agree: a field measured ragged when drawn and smooth when probed
 *  splits too late and runs off the page, which is the disagreement that made
 *  the builder and the validator argue about the frame. */
export function measuresRagged(boxWidth: number, size: number, font?: string): boolean {
  const usable = Math.max(size, boxWidth - TEXT_INSET_X);
  return usable / (size * faceAdvance(font)) < RAGGED_BELOW_CHARS;
}

/** How many lines a paragraph takes when it is WRAPPED ON WORDS, at the face's
 *  own mean advance — and at the bold face's real per-glyph advances for a
 *  prefix drawn in bold, which is what a column's lead-in is.
 *
 *  `boldPrefix` is a count of characters at the head of the string, not a
 *  separate string, because the wrap does not care where the run boundary is:
 *  a word that straddles it is measured in both faces and wrapped once.
 *
 *  This is also the answer to the OPPOSITE error. A lead-in measured as
 *  `ceil(totalBoldAdvance / usable)` rounds up at every boundary — a sum over
 *  a width always does — so two columns whose lead-ins render to the same
 *  depth started their next paragraph 14.5pt apart. Wrapping word by word is
 *  the renderer's own algorithm and has no boundary to round at. */
export function raggedLines(
  text: string | undefined, boxWidth: number, size: number, font?: string, boldPrefix = 0
): number {
  const s = drawnText(text ?? "").trim();
  if (!s) return 0;
  const usable = Math.max(size, boxWidth - TEXT_INSET_X);
  /** A MEAN IS THE WRONG RULER FOR A WORD, which is labelWidthPt's own
   *  argument one function up: a word is far too short for the averaging to
   *  work, and this wraps a word at a time. So both faces are summed glyph by
   *  glyph — the light table for body copy, the bold one where the lead-in
   *  reaches — and the only error left is kerning, which RAGGED_KERN pays for.
   *  A face this has no table for falls back to the mean it has always used. */
  const light = !font || font === "Roboto";
  const mean = size * faceAdvance(font);
  const sumOf = (slice: string, table: number[], unknown: number): number => {
    let em = 0;
    for (let i = 0; i < slice.length;) {
      const cp = slice.codePointAt(i) as number;
      i += cp > 0xffff ? 2 : 1;
      if (cp === 0x200d || (cp >= 0xfe00 && cp <= 0xfe0f)) continue;
      em += cp >= 32 && cp <= 126 ? table[cp - 32] : drawsFullWidth(cp) ? 1000 : unknown;
    }
    return (em / 1000) * size * RAGGED_KERN;
  };
  /** A slice's width: the bold table where the lead-in reaches, the body face
   *  where it does not. */
  const widthOf = (from: number, to: number): number => {
    const boldTo = Math.max(from, Math.min(to, boldPrefix));
    const bold = boldTo > from
      ? sumOf(s.slice(from, boldTo), ROBOTO_BOLD_ADVANCE, ROBOTO_BOLD_UNKNOWN) : 0;
    const rest = s.slice(Math.max(from, boldTo), Math.max(from, to));
    return bold + (light ? sumOf(rest, ROBOTO_LIGHT_ADVANCE, ROBOTO_LIGHT_UNKNOWN) : rest.length * mean);
  };
  const paras = s.split("\n");
  let lines = 0;
  let at = 0;
  for (let p = 0; p < paras.length; p++) {
    const para = paras[p];
    const base = at;
    at += para.length + 1;
    const trimmed = para.trim();
    if (!trimmed) { lines += 1; continue; }
    // Greedy, exactly as a renderer breaks: take words while they fit, and
    // start a new line at the first that does not. A single word wider than
    // the measure takes its own line and overhangs, which is what Slides does
    // with it too.
    const words = para.split(/\s+/);
    let cursor = base + (para.length - para.replace(/^\s+/, "").length);
    let used = 0;
    let onLine = 0;
    for (let w = 0; w < words.length; w++) {
      const word = words[w];
      if (!word) { cursor += 1; continue; }
      const ww = widthOf(cursor, cursor + word.length);
      const space = onLine ? widthOf(cursor - 1, cursor) : 0;
      if (onLine && used + space + ww > usable) { lines += 1; used = ww; onLine = 1; }
      else { used += space + ww; onLine += 1; }
      cursor += word.length + 1;
    }
    lines += 1;
  }
  return lines;
}

/** Where the last line's ink lands, measured from the top of the box.
 *
 *  `paragraphs` is separate from `lines` because Slides' 6pt spaceBelow falls
 *  between PARAGRAPHS, not between wrapped lines — counting it per line
 *  over-estimated a wrapping body by a third and split slides that fitted. */
export function drawnTextHeight(
  lines: number, size: number, spaceBelow = 0, paragraphs = 1, lineSpacing?: number
): number {
  if (lines <= 0) return 0;
  // LINE_LEAD is 115% paragraph spacing on a ~1.26em face. A box drawn at a
  // DIFFERENT spacing — table cells sit at 105% — was still measured at 145%,
  // so every table row carried 18% of height it never used, and nine rows
  // that fit were judged not to and split across two slides.
  const lead = lineSpacing ? 1.26 * lineSpacing : LINE_LEAD;
  return TEXT_INSET_Y + lines * size * lead + Math.max(0, paragraphs - 1) * spaceBelow;
}

/** The real line box, rather than the splitter's deliberately generous one.
 *  This is measuring a collision, not deciding whether to split. */
const INK_LEAD = 1.38;
/** Slides' own gap between bulleted paragraphs. */
const BULLET_GAP = 6;

/** WHERE A TEXT BOX'S LAST LINE OF INK ACTUALLY LANDS, from the top of the box.
 *
 *  THIS LIVES HERE, AND NOT IN validate.ts WHERE IT WAS WRITTEN, because the
 *  builder now has to ask the same question at build time: the deck frame's
 *  hairlines are full-bleed rects, and a rect drawn through a line of type is
 *  reported by nothing — validate.ts's overlap sweep compares text with text,
 *  and it would stay green with a rule struck through every title in the deck.
 *  So frameRequests measures the ink already on the page before it draws a
 *  rule, and it must measure it with the SAME ruler the validator and the
 *  check script use, or the two disagree and the disagreement is the bug.
 *  validate.ts re-exports this under its own name, so nothing that imported it
 *  from there had to change.
 *
 *  A semibold or bold Roboto box is measured glyph by glyph, with the same
 *  primitive the layouts size those boxes with. Counted at the mixed-case mean
 *  instead, a hub label sized to its own measured width — one line, with 6% to
 *  spare — reads as two lines running onto the node below, and a mean that
 *  cries wolf here is one nobody believes when it is right. The sizing margin
 *  is divided back out: this is the real ink, like the line box below. */
export function inkBottom(el: {
  y: number; w: number; text?: string; size?: number;
  font?: string; weight?: number; bullets?: boolean; caps?: boolean;
}): number {
  const size = el.size || 10;
  const paras = String(el.text || "").split("\n");
  let lines = 0;
  const bold = el.font === "Roboto" && (el.weight || 400) >= 600 && !el.bullets;
  for (let i = 0; i < paras.length; i++) {
    const para = paras[i];
    lines += bold
      ? Math.max(1, Math.ceil(labelWidthPt(para, size) / 1.06 / Math.max(1, el.w - TEXT_INSET_X) - 1e-9))
      // MEASURED IN THE FACE THE BOX IS DRAWN IN, which the branch above
      // already does and this one did not. faceAdvance falls back to the
      // unnamed 0.55em worst case, and its own comment says what that costs:
      // it over-measures ROBOTO — the face 82% of the boxes on a real deck are
      // drawn in — by nearly a third, so "a bullet that draws on one line was
      // counted as two". Every text box in the preview carries a face (Roboto,
      // Playfair Display, Poppins), so the unnamed default fitted none of them
      // and 21 of the 29 overruns this reported on the stored decks were
      // measured with a ruler no box on the deck is drawn with. The caps flag
      // travels with it for the same reason: a caps style draws every glyph at
      // its widest, and the preview's text is already upper-cased when it does.
      : Math.max(1, estimateLines(para, el.w, size, el.bullets, !!el.caps, el.font));
  }
  // One inset — the top. The box's own y is the top of the box, not of the ink.
  return el.y + SLIDES_TEXT_INSET.y + lines * size * INK_LEAD
    + Math.max(0, paras.length - 1) * (el.bullets ? BULLET_GAP : 0);
}

/* ── What this slide has drawn so far ───────────────────────────────────── */

/**
 * The ink of every text box drawn on the slide being built, for the one caller
 * that has to know: the deck frame, which draws furniture into bands nothing
 * is supposed to be in and has no other way to find out that something is.
 *
 * A LEDGER RATHER THAN A SECOND PASS OVER THE REQUESTS. Reconstructing a box's
 * text, face, weight and caps out of the emitted stream is re-implementing
 * preview-model.ts inside the builder, and generate.ts cannot import it —
 * preview-model imports FROM here, so the dependency only runs one way. textBox
 * is the single funnel every line of type on every slide goes through, so the
 * cheapest honest answer is to write the measurement down as it goes past.
 *
 * Module state, scoped to one synchronous build and restored in a finally, for
 * the same reason PROBING and the density preset are: nothing in the build path
 * awaits, so no second build can interleave. Nested builds — the splitter's
 * body probe calls straight back into buildSlideRequests — get their own array
 * and hand the outer one back untouched, which is what keeps a probe's boxes
 * off the slide that asked for it.
 *
 * `caps` is taken from the STYLE here and from a comparison with the spec in
 * preview-model, which sets it only on a box it can trace back to a field. The
 * difference is deliberate and it runs one way: this measures a caps box as at
 * least as tall as the preview does, so the frame can only ever yield where the
 * check would not, never draw where the check says it must not.
 */
let SLIDE_INK: { top: number; bottom: number }[] | null = null;

/** How many rows a chart may draw, and how tall each may be.
 *
 *  Nothing on a slide is allowed to grow past the canvas. The bar chart used to
 *  cap at eight and place its source line wherever the eighth bar ended, which
 *  was 8pt below the bottom edge; the stacked chart capped at nothing at all,
 *  so a ten-category series ran two rows and an entire legend off the slide,
 *  invisible in the deck AND in the preview, with nothing saying data was lost.
 *
 *  Rows are COMPRESSED to fit before any are dropped — losing a little bar
 *  height costs nothing a reader would notice, and losing a category costs them
 *  the data. Only when compression hits a floor is the set truncated, and the
 *  slide then says so out loud. */
const MAX_BARS = 8;
/** Gap plus the source line under a plot. */
const SOURCE_BLOCK = 24;
/** The right-hand slot on the source line, held for the truncation note. */
const NOTE_WIDTH = 168;
const MIN_ROW_HEIGHT = 20;
/** Legend row plus the source line under a stacked plot. A second legend row is
 *  reserved unconditionally: whether the names wrap is not known until they are
 *  laid out, and a budget that assumes they will not is how the legend left the
 *  slide in the first place. */
const LEGEND_ROWS = 2;
const LEGEND_ROW_HEIGHT = 16;
const STACK_TAIL = 42 + LEGEND_ROW_HEIGHT;

function fitRows(
  total: number, cap: number, baseBarH: number, baseGap: number, tailBlock: number,
  bandTop: number = GRID.bodyY
): { count: number; rowH: number; barH: number } {
  const room = CANVAS.height - GRID.margin - bandTop - tailBlock;
  const baseRow = baseBarH + baseGap;
  let count = Math.max(1, Math.min(total, cap));
  let rowH = Math.min(baseRow, room / count);
  while (rowH < MIN_ROW_HEIGHT && count > 1) {
    count -= 1;
    rowH = Math.min(baseRow, room / count);
  }
  rowH = Math.floor(rowH * 10) / 10;
  const gap = Math.min(baseGap, Math.max(4, rowH * 0.3));
  return { count, rowH, barH: Math.max(10, Math.round((rowH - gap) * 10) / 10) };
}

/** "Showing the top 8 of 12" — on the source line, right-aligned, in the slot
 *  the source box gives up when there is something to say.
 *
 *  Its own box with no spec path, so it is never editable and never written
 *  back into the source string. Silence here was the real defect: a deck that
 *  quietly drops four categories reads as the whole picture. */
/** Wide enough for its own text, so a two-clause note is not clipped by a
 *  fixed slot. Right-aligned to the content edge, so growing it grows leftwards
 *  and it can never leave the canvas. */
function noteWidth(text: string): number {
  if (!text) return 0;
  const measured = Math.ceil(text.length * TYPE.chartAxis.size * 0.55 + 15);
  return Math.min(GRID.contentWidth - 140, Math.max(NOTE_WIDTH, measured));
}

function noteBox(objectId: string, page: string, text: string, y: number): Req[] {
  if (!text) return [];
  const w = noteWidth(text);
  return textBox(objectId, page, text, TYPE.chartAxis, {
    x: GRID.margin + GRID.contentWidth - w, y, width: w, height: 16,
  }, { align: "END" });
}

function clip(s: string, n: number): string {
  return s.length <= n ? s : `${s.slice(0, n - 1)}…`;
}

/** What a bar chart is NOT showing, in one line.
 *
 *  Both clauses matter and neither was said. Truncation to the top eight was
 *  silent, and a second series was discarded entirely — this layout draws one
 *  series by design, and a model that sends two got a slide that looked like
 *  the whole picture. */
export function barChartNote(
  chart: NonNullable<SlideInput["chart"]>, total: number, drawn: number
): string {
  const parts: string[] = [];
  const supplied = chart.series?.length || 0;
  if (supplied > 1) {
    parts.push(`“${clip(chart.series?.[0]?.name || "the first series", 18)}” of ${supplied} series`);
  }
  if (total > drawn) parts.push(`${supplied > 1 ? "" : "the "}top ${drawn} of ${total}`);
  return parts.length ? `Showing ${parts.join(" · ")}` : "";
}

/**
 * Round values to label a y axis with, and the reason this exists.
 *
 * A line chart of monthly profit that dips to -25k and climbs to +17k was drawn
 * with ONE horizontal rule, at the bottom of the plot — which is the padded
 * MINIMUM, about -28k, not zero. Every month including the four loss-making
 * ones therefore sat above the only line on the chart, and January read as the
 * low point of a rising line rather than as a loss. Zero was 149px above that
 * rule with nothing marking it, and no y value was drawn anywhere: the layout
 * reserved 34px at the left for labels it never wrote.
 *
 * Ticks are round numbers, not evenly-divided ends: an axis labelled -28,360 /
 * -12,180 / 4,000 is arithmetic nobody reads. Zero is always among them when it
 * is in range, because 0 is a multiple of every step, which is the property the
 * zero rule depends on.
 *
 * Pure and exported so the check can drive it directly rather than infer the
 * scale from a rendered box.
 */
export function niceTicks(lo: number, hi: number, count = 5): number[] {
  if (!Number.isFinite(lo) || !Number.isFinite(hi) || hi <= lo) return [];
  const raw = (hi - lo) / Math.max(1, count);
  const mag = Math.pow(10, Math.floor(Math.log10(raw)));
  const norm = raw / mag;
  const step = (norm <= 1 ? 1 : norm <= 2 ? 2 : norm <= 5 ? 5 : 10) * mag;
  const out: number[] = [];
  // Start at the first step boundary inside the range and walk up. Bounded
  // rather than while(true): a pathological span once produced a step of 0 and
  // an infinite loop is a worse failure than a missing axis.
  const first = Math.ceil(lo / step) * step;
  // first + i*step, NOT v += step. Accumulating a fractional step compounds its
  // own error: a 0.5-to-0.9 axis came out labelled 0.7999999999999999.
  const decimals = Math.min(10, Math.max(0, -Math.floor(Math.log10(step)) + 1));
  for (let i = 0; i < 24; i++) {
    const v = first + i * step;
    if (v > hi + step * 1e-9) break;
    const r = Number(v.toFixed(decimals));
    // -0 prints as "-0". It is the same number and reads as a mistake.
    out.push(Object.is(r, -0) ? 0 : r);
  }
  return out;
}

/** A line chart: change over time. The one device the bar layouts cannot give,
 *  because a trend is a shape, not a set of lengths.
 *
 *  Points are spaced evenly by INDEX across the plot, not by date — the points
 *  carry free-text x labels ("Jan", "Q1", "2024"), and spacing them by a parsed
 *  date would break the moment a label is not a date. Y is scaled from the data
 *  (padded, and including zero when the range is close to it, so a line does not
 *  float in a misleading crop). Up to three series, each its own colour with a
 *  legend; segments are rotated rectangles because Slides has no polyline.
 */
function lineChartRequests(
  page: string, id: (s: string) => string,
  chart: NonNullable<SlideInput["chart"]>, onDark: boolean, bandTop: number = GRID.bodyY,
  band: number = GRID.bandHeight
): Req[] {
  const series = (chart.series || []).filter((sx) => sx.points?.length).slice(0, 3);
  if (!series.length) return [];
  const palette = onDark ? SERIES_DARK : SERIES_LIGHT;
  const axisColor = onDark ? COLOR.periwinkle : COLOR.greyLight;

  // X labels come from the FIRST series; a shorter series simply stops early.
  const labels = series[0].points.map((p) => p.label);
  const n = labels.length;
  if (n < 2) return [];   // a single point is not a line

  const allValues = series.flatMap((sx) => sx.points.map((p) => p.value));
  const bench = chart.benchmark && Number.isFinite(chart.benchmark.value) ? chart.benchmark : null;
  if (bench) allValues.push(bench.value);
  // The RAW extremes, kept before any snapping or padding. The zero rule is
  // decided on the data, not on the scale: padding pushes `lo` below zero on a
  // chart whose values are all positive (120..340 snaps lo to 0, then pads it
  // to -17.6), and testing the padded scale drew a "zero" rule a few pixels
  // above the baseline on charts that never cross zero.
  const rawLo = Math.min(...allValues);
  const rawHi = Math.max(...allValues);
  let lo = rawLo;
  let hi = rawHi;
  // Include zero when the data sits near it, so the line is not floated on a
  // cropped axis that exaggerates the slope.
  if (lo > 0 && lo < hi * 0.5) lo = 0;
  if (hi < 0 && hi > lo * 0.5) hi = 0;
  const pad = (hi - lo) * 0.08 || 1;
  lo -= pad; hi += pad;
  const span = hi - lo || 1;

  const legendH = series.length > 1 ? 20 : 0;
  const plotX = GRID.margin + 34;                       // room for y at the left
  const plotW = GRID.contentWidth - 34;
  // Ends above the footer, with the source line between them; it used to run
  // 2pt short of the bottom margin, which put the source on top of the
  // footer once the footer came up off the bezel.
  const bandBottom = FOOTER_Y - 18;
  const plotTop = bandTop + 6;
  const plotBottom = bandBottom - 18 - legendH;         // room for x labels + legend
  const plotH = Math.max(40, plotBottom - plotTop);

  const xAt = (i: number) => plotX + (n === 1 ? 0 : (i / (n - 1)) * plotW);
  const yAt = (v: number) => plotBottom - ((v - lo) / span) * plotH;

  const out: Req[] = [];

  // A faint baseline/axis along the bottom.
  out.push(...filledShape(id("laxis"), page, "RECTANGLE", axisColor, {
    x: plotX, y: plotBottom, width: plotW, height: CHART.axisThickness,
  }));

  // The y axis: round values in the 34px this layout has always reserved for
  // them and never used. Without these the plot has no scale at all — the only
  // number on it is the last point's own label.
  const ticks = niceTicks(lo, hi);
  for (let i = 0; i < ticks.length; i++) {
    const v = ticks[i];
    const ty = yAt(v);
    // Skip a tick that would collide with the x labels sitting under the axis.
    if (ty > plotBottom - 3) continue;
    out.push(...textBox(id(`lyt${i}`), page, formatValue(v),
      { ...TYPE.chartAxis, color: onDark ? COLOR.periwinkle : COLOR.ink }, {
        x: GRID.margin - 4, y: ty - 6, width: 34, height: 12,
      }, { align: "END" }));
  }

  // THE ZERO RULE. This is the fix: on a chart that crosses zero, the bottom
  // baseline is the padded minimum, so a loss was drawn above the only line on
  // the plot and read as a small positive. Drawn only when the data actually
  // crosses zero — otherwise the baseline IS the floor and a second rule there
  // is redundant ink, which is the same rule the bar chart follows.
  if (rawLo < 0 && rawHi > 0) {
    // Navy, not the baseline's light grey: the bottom rule is a frame and this
    // one is the number the reader is being asked to compare against, so it has
    // to be the stronger of the two.
    out.push(...filledShape(id("lzero"), page, "RECTANGLE", onDark ? COLOR.periwinkle : COLOR.navy, {
      x: plotX, y: yAt(0), width: plotW, height: 1.2,
    }));
  }

  // What the axis is measuring, when the caller says. Horizontal, above the
  // ticks: Slides can rotate a text box, but a rotated label in a 34px gutter
  // is unreadable at deck scale and the rotation is one more thing to get
  // wrong in the preview.
  if (chart.yAxisLabel?.trim()) {
    out.push(...textBox(id("lylab"), page, chart.yAxisLabel.trim(),
      { ...TYPE.chartAxis, color: onDark ? COLOR.periwinkle : COLOR.ink }, {
        x: GRID.margin - 4, y: plotTop - 14, width: 120, height: 12,
      }));
  }

  // The benchmark, if any — a reference rule across the plot. One ink with the
  // bar chart's, and for the same reason: a reference recedes.
  if (bench) {
    out.push(...filledShape(id("lbmk"), page, "RECTANGLE", onDark ? COLOR.greyLight : COLOR.navy, {
      x: plotX, y: yAt(bench.value), width: plotW, height: 1.2,
    }, 0.55));
    if (bench.label?.trim()) {
      out.push(...textBox(id("lbml"), page, bench.label, TYPE.benchmarkLabel, {
        x: plotX, y: yAt(bench.value) - 12, width: 150, height: 12,
      }));
    }
  }

  // X labels under the axis.
  labels.forEach((lab, i) => {
    out.push(...textBox(id(`lx${i}`), page, lab, TYPE.axisTick, {
      x: xAt(i) - 24, y: plotBottom + 4, width: 48, height: 14,
    }, { align: "CENTER" }));
  });

  // Each series: segments, then dots on top, then endpoint value labels.
  series.forEach((sx, si) => {
    const color = palette[si % palette.length];
    const pts = sx.points.slice(0, n);
    for (let i = 0; i < pts.length - 1; i++) {
      out.push(...segment(id(`ls${si}_${i}`), page, color,
        xAt(i), yAt(pts[i].value), xAt(i + 1), yAt(pts[i + 1].value), 2.4));
    }
    pts.forEach((p, i) => {
      const focus = typeof chart.highlight === "number" && chart.highlight === i;
      const r = focus ? 5 : 3.5;
      out.push(...filledShape(id(`ld${si}_${i}`), page, "ELLIPSE", color, {
        x: xAt(i) - r, y: yAt(p.value) - r, width: r * 2, height: r * 2,
      }));
    });
    // Label the LAST point (and the highlighted one) — not every point, which
    // would be a wall of numbers.
    const lastI = pts.length - 1;
    const labelAt = (i: number) => {
      const p = pts[i];
      const above = i === 0 || p.value >= pts[i - 1].value;
      out.push(...textBox(id(`lv${si}_${i}`), page, formatValue(p.value),
        { ...TYPE.chartValue, color: onDark ? COLOR.white : COLOR.navy }, {
          x: Math.min(xAt(i) - 20, GRID.margin + GRID.contentWidth - 44),
          y: above ? yAt(p.value) - 18 : yAt(p.value) + 6, width: 44, height: 14,
        }, { align: i === lastI ? "END" : "CENTER" }));
    };
    labelAt(lastI);
    if (typeof chart.highlight === "number" && chart.highlight !== lastI && chart.highlight < pts.length) {
      labelAt(chart.highlight);
    }
  });

  // Legend for multiple series.
  if (series.length > 1) {
    let lx = plotX;
    const ly = plotBottom + 20;
    series.forEach((sx, si) => {
      const w = Math.min(120, Math.max(34, (sx.name || "").length * 4.6 + 16));
      out.push(
        ...filledShape(id(`lk${si}`), page, "RECTANGLE", palette[si % palette.length], {
          x: lx, y: ly + 3, width: 10, height: 3,
        }),
        ...textBox(id(`ln${si}`), page, sx.name, TYPE.chartAxis, {
          x: lx + 14, y: ly, width: w, height: 14,
        }),
      );
      lx += 14 + w + 10;
    });
  }

  out.push(...textBox(id("lsrc"), page, chart.source, TYPE.chartAxis, {
    x: GRID.margin, y: bandBottom + 2, width: GRID.contentWidth, height: 14,
  }));
  return out;
}

/** Horizontal bars, sorted, with the value printed at the end of each.
 *
 *  Horizontal because category names are words, and words fit beside a bar but
 *  not under one. Sorted because the ranking IS the message; input order makes
 *  the reader do the sorting. Values printed directly, so no axis scale is
 *  needed and the gridlines that would carry it can go — ink belongs to data. */
function barChartRequests(
  page: string, id: (s: string) => string,
  chart: NonNullable<SlideInput["chart"]>, onDark: boolean, bandTop: number = GRID.bodyY,
  band: number = GRID.bandHeight
): Req[] {
  const series = chart.series?.[0];
  if (!series?.points?.length) return [];
  const palette = onDark ? SERIES_DARK : SERIES_LIGHT;
  // Carry each point's ORIGINAL index through the sort. The object id has to
  // name the point in the spec, not its rank on the slide — otherwise editing
  // "Bar 1" edits whichever row happened to be first in the input, and any deck
  // whose data was not already sorted gets the wrong bar changed.
  // A TIME SERIES keeps its order — sorting a monthly trend by value scrambles
  // the line the chart exists to show. A ranking sorts, and carries each
  // point's ORIGINAL index through the sort so the object id names the point in
  // the spec, not its rank on the slide (editing "Bar 1" must not move a row).
  const indexed = series.points.map((p, orig) => ({ ...p, orig }));
  const ranked = chart.sequence ? indexed : indexed.slice().sort((a, b) => b.value - a.value);

  // The source line is part of the block, so it has to be inside the budget.
  // It was not: eight bars pushed it to y=397 on a 405pt canvas, where the
  // attribution for the numbers simply did not exist in the built deck.
  // A callout that cannot fit beside its bar falls back to its own line under
  // the source, so that line has to be in the budget too. It was not: seven
  // bars put the fallback callout straight through the footer, 354pt of
  // overlap, and the overlap battery never saw it because no fixture combined
  // a callout with a full plot. The callout carries the finding on these
  // slides, so losing it loses the point of the chart.
  const calloutReserve = chart.callout?.text?.trim() ? 22 : 0;
  const sourceBlock = SOURCE_BLOCK + calloutReserve;
  const fit = fitRows(ranked.length, MAX_BARS, CHART.barHeight, CHART.barGap, sourceBlock, bandTop);
  // A ranking truncated to the top N drops the SMALLEST; a sequence truncated
  // from the front would drop the earliest months and lie about where the line
  // starts, so a sequence keeps its most recent points instead.
  const points = chart.sequence ? ranked.slice(-fit.count) : ranked.slice(0, fit.count);

  // A zero BASELINE, not an absolute-value scale. Drawing |value| made a -100
  // the longest bar on a slide whose whole message is the ranking — the reader
  // saw the biggest bar against the worst number. With a baseline, a negative
  // bar runs left from zero and reads as the loss it is.
  const bench = chart.benchmark && Number.isFinite(chart.benchmark.value) ? chart.benchmark : null;
  const lo = Math.min(0, ...points.map((p) => p.value), bench ? bench.value : 0);
  const hi = Math.max(0, ...points.map((p) => p.value), bench ? bench.value : 0);
  const span = hi - lo || 1;

  const plotX = GRID.margin + CHART.labelGutter;
  const plotW = GRID.contentWidth - CHART.labelGutter - 52;
  const at = (v: number) => plotX + ((v - lo) / span) * plotW;
  const out: Req[] = [];
  // Same treatment as the stats: five bars centre in the band, eight fill it.
  const bandH = GRID.bodyY + band - bandTop;
  const plotTop = bandTop +
    Math.max(0, (bandH - (points.length * fit.rowH + sourceBlock)) / 2);

  // A highlighted bar is the whole point of the slide: it is drawn in the
  // accent and every other bar is muted to a neutral, so the eye lands on the
  // one that carries the argument instead of reading six equal blues. With no
  // highlight the chart is uniform, as before.
  const hasFocus = typeof chart.highlight === "number" &&
    chart.highlight >= 0 && chart.highlight < series.points.length;
  const muted = onDark ? COLOR.periwinkle : COLOR.greyLight;
  const focusFill = onDark ? COLOR.tealSoft : COLOR.blue;
  // THE REFERENCE RECEDES AND THE ANNOTATION BELONGS TO ITS BAR. Both were
  // drawn in the deep coral, which is the deck's alarm colour: the rule and the
  // sentence beside the highlighted bar read as two errors on a chart where
  // nothing was wrong. The rule takes the deck's quiet voice at a hairline's
  // strength; the callout takes the accent the bar it names is drawn in.
  const benchInk = onDark ? COLOR.greyLight : COLOR.navy;
  const calloutInk = hasFocus ? focusFill : (onDark ? COLOR.greyLight : COLOR.navy);

  points.forEach((p, i) => {
    const y = plotTop + i * fit.rowH;
    const x0 = at(Math.min(p.value, 0));
    const w = Math.max(2, Math.abs(at(p.value) - at(0)));
    const isFocus = hasFocus && p.orig === chart.highlight;
    const barFill = hasFocus ? (isFocus ? focusFill : muted) : palette[0];
    const labelStyle = isFocus ? { ...TYPE.chartValue, color: onDark ? COLOR.tealSoft : COLOR.blue } : TYPE.chartValue;
    out.push(
      ...textBox(id(`bl${p.orig}`), page, p.label, TYPE.chartCategory, {
        x: GRID.margin, y: y + 4, width: CHART.labelGutter - 10, height: fit.barH,
      }),
      ...filledShape(id(`bb${p.orig}`), page, "RECTANGLE", barFill, {
        x: x0, y, width: w, height: fit.barH,
      }),
      // The value goes just past the bar's right-hand end, for a negative bar
      // as much as a positive one. Putting it at the far end of a negative bar
      // would drive it into the category name in the left gutter, and the minus
      // sign already says which way the bar runs.
      ...textBox(id(`bv${p.orig}`), page, formatValue(p.value), labelStyle, {
        x: x0 + w + CHART.valueGap, y: y + 4, width: 60, height: fit.barH,
      }),
    );
  });

  // A benchmark: a vertical rule across the whole plot at its value, with a
  // small caps label above it, so every bar reads as above or below the target.
  // Drawn in the deep coral so it is plainly a REFERENCE, not one of the bars.
  let benchX: number | null = null;
  if (bench) {
    const bx = at(bench.value);
    benchX = bx;
    const plotBottom = plotTop + points.length * fit.rowH;
    out.push(...filledShape(id("bmk"), page, "RECTANGLE", benchInk, {
      x: bx, y: plotTop - 10, width: 1.4, height: plotBottom - plotTop + 10,
    }, 0.55));
    if (bench.label?.trim()) {
      // ONE LINE, AND THE ROOM TO BE ONE. The width was a guess — four and a
      // bit points per character — and "Category average" is sixteen of them,
      // so the box came out narrower than the words and the label wrapped: the
      // second line was drawn straight onto the top bar, letters touching it.
      // Measured with the deck's own ruler it is one line, and the box is
      // placed by its FOOT so a label that does wrap grows upwards into the
      // band's slack instead of downwards into the plot.
      const lw = Math.min(GRID.contentWidth, labelBoxWidth(bench.label, TYPE.benchmarkLabel.size));
      const lx = Math.min(GRID.margin + GRID.contentWidth - lw, Math.max(GRID.margin, bx - lw / 2));
      const lines = Math.max(1, estimateLines(bench.label, lw, TYPE.benchmarkLabel.size, false, true));
      const lh = drawnTextHeight(lines, TYPE.benchmarkLabel.size);
      out.push(...textBox(id("bml"), page, bench.label, TYPE.benchmarkLabel, {
        x: lx, y: plotTop - 12 - lh, width: lw, height: lh,
      }, { align: bx - lw / 2 < GRID.margin ? "START" : "CENTER" }));
    }
  }

  // A zero rule, only when the data crosses it — otherwise the left edge of the
  // plot IS zero and a line there is redundant ink.
  if (lo < 0) {
    out.push(...filledShape(id("bzero"), page, "RECTANGLE", onDark ? COLOR.periwinkle : COLOR.greyLight, {
      x: at(0), y: plotTop - 4, width: CHART.axisThickness,
      height: points.length * fit.rowH + 4,
    }));
  }

  const srcY = plotTop + points.length * fit.rowH + 8;
  const note = barChartNote(chart, ranked.length, points.length);
  out.push(...textBox(id("csrc"), page, chart.source, TYPE.chartAxis, {
    x: GRID.margin, y: srcY,
    width: GRID.contentWidth - (note ? noteWidth(note) : 0), height: 18,
  }));
  out.push(...noteBox(id("cdrop"), page, note, srcY));

  // A callout: one short line explaining a single bar, drawn to the RIGHT of
  // that bar's value in the deep coral, clamped to the canvas. Only when the
  // bar is actually on the slide (a callout on a truncated bar has nowhere to
  // point). The audit's warning was that a naive placement after the longest
  // value box ran off at 711pt; this clamps the width to the room that is left
  // and skips the callout, with a note, when there is too little.
  if (chart.callout && typeof chart.callout.point === "number" && chart.callout.text?.trim()) {
    const idx = points.findIndex((p) => p.orig === chart.callout!.point);
    if (idx >= 0) {
      const p = points[idx];
      const y = plotTop + idx * fit.rowH;
      const valueEnd = at(p.value) + CHART.valueGap + 44;   // past the value box
      const rightEdge = GRID.margin + GRID.contentWidth;
      // AND CLEAR OF THE BENCHMARK RULE. The rule runs the full height of the
      // plot, so a callout placed only against the bar's value was struck
      // through by it — between the "o" and the "n" of a nine-word sentence,
      // on a chart whose benchmark is the second thing the slide is about. The
      // rule is a reference line and may not be broken for an annotation, so
      // the annotation starts past it.
      const clearOfBench = benchX !== null && benchX > valueEnd ? benchX + 10 : valueEnd;
      const room = rightEdge - clearOfBench;
      if (room >= 60) {
        out.push(...textBox(id("cnote"), page, chart.callout.text,
          { ...TYPE.calloutText, color: calloutInk }, {
          x: clearOfBench, y: y + 3, width: room, height: fit.barH,
        }));
      } else {
        // No room beside the bar — the finding still gets said, on its own
        // reserved line under the source, rather than silently dropped.
        // Two points below the source box, on the line reserved for it above.
        // NOT clamped upward against the footer: a clamp rode the callout back
        // into the source line, trading a collision with the brand mark for a
        // collision with the attribution. The reserve is what keeps it on the
        // slide; if it ever cannot fit, the fix is more reserve, not a clamp.
        out.push(...noteBox(id("cnote"), page, chart.callout.text, srcY + 20));
      }
    }
  }
  return out;
}

/** One stacked bar per category — composition, not ranking.
 *
 *  A single row per category rather than a grid of them, because the question
 *  a stacked bar answers is "what is this made of", and stacking is the only
 *  encoding that shows the parts and the whole at once.
 *
 *  A 2pt gap is left between segments. Without it adjacent fills of similar
 *  lightness merge into one shape and the boundary the chart exists to show
 *  disappears — the surface showing through IS the separator. */
function stackedBarRequests(
  page: string, id: (s: string) => string,
  chart: NonNullable<SlideInput["chart"]>, onDark: boolean, bandTop: number = GRID.bodyY,
  band: number = GRID.bandHeight
): Req[] {
  const supplied = (chart.series || []).filter((s) => s.points?.length);
  if (!supplied.length) return [];
  const palette = onDark ? SERIES_DARK : SERIES_LIGHT;

  // A stacked bar cannot draw a negative part — there is no direction for it to
  // go — so negatives leave the DRAWING and the TOTAL alike, and are counted so
  // the slide can say so. Counting them in the total while skipping them in the
  // drawing was worse than either: the printed total contradicted the bar
  // beside it, and because the scale came from those totals a single negative
  // could push a bar clean off the right-hand edge of the slide.
  let negatives = 0;
  const valuesOf = (list: typeof supplied) => {
    const m = new Map<string, number>();
    for (let i = 0; i < list.length; i++) {
      const pts = list[i].points || [];
      for (let j = 0; j < pts.length; j++) {
        if (pts[j].value < 0) { negatives += 1; continue; }
        // Duplicate labels SUM. `find` returned the first and lost the rest, so
        // [{Other,10},{Other,15}] drew 10 twice and printed a total short by 15.
        m.set(pts[j].label, (m.get(pts[j].label) || 0) + pts[j].value);
      }
    }
    return m;
  };

  // Five colours in the palette, and `palette[si % length]` would paint a sixth
  // part in the FIRST part's blue. Dropping the sixth instead left a printed
  // total that excluded it — a wrong number on the slide, not just a missing
  // one. So the remainder is grouped, which is coarser but true.
  const MAX_PARTS = palette.length;
  const folded = Math.max(0, supplied.length - MAX_PARTS);
  const parts: { name: string; values: Map<string, number> }[] = [];
  for (let i = 0; i < Math.min(supplied.length, MAX_PARTS); i++) {
    parts.push({ name: supplied[i].name, values: valuesOf([supplied[i]]) });
  }
  if (folded > 0) parts.push({ name: "Other", values: valuesOf(supplied.slice(MAX_PARTS)) });
  const series = parts;
  // "Other" is not a series, so it does not take a series colour.
  const fillFor = (si: number) => (si < MAX_PARTS ? palette[si] : (onDark ? COLOR.greyLight : COLOR.ink));

  // Categories are the UNION of every part's labels, in first-appearance order.
  // Taking them from the first series alone dropped any category the first
  // series happened not to carry — silently, and from the totals as well.
  // Derived from the aggregation rather than a second pass over the raw points,
  // so a label carried only by negative values cannot enter as an empty row.
  const union = new Map<string, number>();
  for (let i = 0; i < series.length; i++) {
    const keys = Array.from(series[i].values.keys());
    for (let j = 0; j < keys.length; j++) union.set(keys[j], 1);
  }
  const allCategories = Array.from(union.keys());
  // The legend and the source line sit under the plot, so both are inside the
  // budget the rows have to fit. There was no budget at all before: ten
  // categories put two rows and the whole legend off the bottom of the slide.
  const fit = fitRows(allCategories.length, MAX_BARS, CHART.barHeight, CHART.barGap, STACK_TAIL, bandTop);
  const categories = allCategories.slice(0, fit.count);

  const partOf = (cat: string, s: (typeof series)[number]) => s.values.get(cat) ?? 0;
  const totals = categories.map((c) => series.reduce((sum, s) => sum + partOf(c, s), 0));
  const max = Math.max(...totals) || 1;

  const plotX = GRID.margin + CHART.labelGutter;
  const plotW = GRID.contentWidth - CHART.labelGutter - 52;
  const rowH = fit.rowH;
  const bandH = GRID.bodyY + band - bandTop;
  const plotTop = bandTop +
    Math.max(0, (bandH - (categories.length * rowH + STACK_TAIL)) / 2);
  const GAP = 2;

  const out: Req[] = [];
  categories.forEach((cat, ci) => {
    const y = plotTop + ci * rowH;
    let x = plotX;
    out.push(...textBox(id(`kl${ci}`), page, cat, TYPE.chartCategory, {
      x: GRID.margin, y: y + 4, width: CHART.labelGutter - 10, height: fit.barH,
    }));
    series.forEach((s, si) => {
      const v = partOf(cat, s);
      if (v <= 0) return;
      const w = (v / max) * plotW;
      const segW = Math.max(1, w - GAP);
      const fill = fillFor(si);
      out.push(...filledShape(id(`kb${ci}_${si}`), page, "RECTANGLE", fill, {
        x, y, width: segW, height: fit.barH,
      }));

      // THE SPLIT, WRITTEN ON THE SPLIT.
      //
      // Only the total was ever labelled, which on this deck's budget slide
      // meant two bars showing different compositions and both labelled 12k —
      // the one number a stacked bar exists to show was the one number missing,
      // and the reader was left estimating segment widths by eye. A stacked bar
      // answers "what is this made of"; the parts have to carry their values.
      //
      // Drawn only where the segment can actually hold it. A label wider than
      // its own segment spills across the neighbouring colour and reads as
      // belonging to that one instead — worse than no label. Measured with the
      // Slides text insets included, as everywhere else in this file.
      const label = formatValue(v);
      const needed = Math.ceil(label.length * TYPE.chartValue.size * 0.62) + TEXT_INSET_X;
      if (segW >= needed) {
        out.push(...textBox(
          id(`kv${ci}_${si}`), page, label,
          { ...TYPE.chartValue, color: textOn(fill) },
          { x, y, width: segW, height: fit.barH },
          { align: "CENTER", vCenter: true }
        ));
      }
      x += w;
    });
    out.push(...textBox(id(`kt${ci}`), page, formatValue(totals[ci]), TYPE.chartValue, {
      x: x + CHART.valueGap, y: y + 4, width: 60, height: fit.barH,
    }));
  });

  // A legend is required here and cannot be replaced by direct labels: a
  // segment is often too narrow to hold its own name.
  //
  // It WRAPS. Five series with ordinary names — "Sponsored articles",
  // "Infographics and charts" — ran the last entries off the right-hand edge of
  // the slide, because the row only ever advanced and never asked whether the
  // next entry still fit.
  const legendRight = GRID.margin + GRID.contentWidth;
  const legendTop = plotTop + categories.length * rowH + 6;
  let lx = GRID.margin;
  let legendRow = 0;
  series.forEach((s, si) => {
    // The label's box and the advance to the next entry are the SAME width.
    // Giving every label a fixed 110pt box while advancing by its text width
    // overlapped each legend entry with the one after it.
    // Sized with the text-box insets included. Without them a nine-character
    // series name wrapped to two lines inside a box one line tall, and the
    // second line landed on the source attribution underneath.
    const labelW = Math.min(
      132, Math.max(34, Math.ceil(s.name.length * TYPE.chartAxis.size * 0.55) + TEXT_INSET_X)
    );
    if (lx + 13 + labelW > legendRight && lx > GRID.margin && legendRow < LEGEND_ROWS - 1) {
      legendRow += 1;
      lx = GRID.margin;
    }
    const ly = legendTop + legendRow * LEGEND_ROW_HEIGHT;
    out.push(
      ...filledShape(id(`kk${si}`), page, "RECTANGLE", fillFor(si), {
        x: lx, y: ly + 4, width: 9, height: 9,
      }),
      ...textBox(id(`kn${si}`), page, s.name, TYPE.chartAxis, {
        x: lx + 13, y: ly, width: Math.min(labelW, Math.max(28, legendRight - lx - 13)), height: 16,
      }),
    );
    lx += 13 + labelW + 12;
  });
  const legendY = legendTop + legendRow * LEGEND_ROW_HEIGHT;

  const srcY = legendY + 20;
  const note = stackedNote(allCategories.length, categories.length, supplied.length, folded, negatives);
  out.push(...textBox(id("ksrc"), page, chart.source, TYPE.chartAxis, {
    x: GRID.margin, y: srcY, width: GRID.contentWidth - (note ? noteWidth(note) : 0), height: 16,
  }));
  out.push(...noteBox(id("kdrop"), page, note, srcY));
  return out;
}

/** What a stacked bar is not showing, in one line and in priority order —
 *  a dropped category first, then a folded part, then a negative. Only the
 *  first that applies is said: the slot is one line, and three clauses read as
 *  a disclaimer rather than a fact. */
export function stackedNote(
  categories: number, drawn: number, suppliedParts: number, folded: number, negatives: number
): string {
  if (categories > drawn) return `Showing the top ${drawn} of ${categories}`;
  if (folded > 0) return `Showing ${suppliedParts - folded} of ${suppliedParts} parts, rest as “Other”`;
  if (negatives > 0) return "Negative values not shown";
  return "";
}

/** Does this slide show the reader something other than words?
 *
 *  Read by the audit that tells the model how visual a deck is, so a miscount
 *  is not cosmetic: cards, logo walls, process diagrams and quotes were all
 *  counted as prose, so a deck that was five-sixths visual was reported as
 *  "ONLY 1 of 6 (17%)" and the model dutifully told the user it was flat and
 *  offered to fix slides that were already fine. */
export function isVisualSlide(slide: SlideInput | undefined): boolean {
  if (!slide) return false;
  const cards = slide.cards || [];
  const logos = slide.logos || [];
  // Asked of the slide AS IT WILL BE DRAWN: normalised, and only when that is a
  // hub. A `hub` patched onto a content slide is stored and never drawn, and
  // counting it called a prose slide a diagram.
  const drawnAs = normaliseSlide(slide);
  return Boolean(
    slide.resolvedImage ||
    (slide.resolvedImages && slide.resolvedImages.length) ||
    slide.chart ||
    (slide.stats && slide.stats.length) ||
    (slide.milestones && slide.milestones.length) ||
    (slide.tracks && slide.tracks.length) ||
    // The process layout draws its chevrons from the stages alone, and a quote
    // is a designed slide on navy whether or not it carries a portrait.
    (slide.stages && slide.stages.length) ||
    // A hub is a drawn diagram whether or not its nodes carry icons — but only
    // if a node is drawn at all. Counting raw `items.length` called a hub of
    // untitled or misplaced items visual while it drew nothing, so this asks
    // the guard's own question of the same normalised view the builder draws.
    (drawnAs.layout === "hub" && hubHasConnections(drawnAs.hub)) ||
    slide.quote ||
    cards.some((c) => (c.resolvedImage && c.resolvedImage.url) || c.resolvedIcon || c.marker) ||
    logos.some((l) => l.resolvedUrl || l.name)
  );
}

/** Keys whose strings are instructions to the builder, not words on the slide:
 *  a photo search, a URL, a colour token. Comparing these against drawn text
 *  would report a finding on every slide that has a picture. */
const NON_CONTENT_KEYS = new Set([
  "layout", "layoutAsked", "tone", "tones", "style", "color", "colour",
  // `icon` is a Lucide NAME, an instruction like `query`. Left out, every
  // name over ten characters ("layout-dashboard", "calendar-clock") was
  // reported as text the slide dropped, and real icons were swapped out for
  // shorter ones on the strength of it.
  "url", "src", "query", "icon", "resolvedUrl", "resolvedIcon", "imageError",
  // The names that failed to resolve are the same instructions again, and
  // "google-drive" is long enough to be reported as text the slide dropped.
  "iconsMissing",
  // Speaker notes are written to the deck's notes page at publish, not drawn
  // on the slide, so "never draws — do NOT describe it as being in the deck"
  // was false about every slide that carried a note of eleven characters.
  "notes",
  // The footer is stamped by the builder on every slide, and the cover and the
  // closing leave it off by design. Counted as content, every deck with a
  // cover told its author that a field THEY never wrote was being dropped.
  "footer",
  "presentationId", "fidelity", "align", "id", "font",
]);

const contentKey = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();

/** Text a slide CARRIES that its layout never DRAWS.
 *
 *  ── WHY THIS IS NOT A TABLE OF WHICH LAYOUT READS WHICH FIELD ──────────────
 *
 *  Because that table is the thing that drifts. This builds the slide and asks
 *  the only question that matters: is each string in the spec somewhere in the
 *  text the deck will actually contain? A field the layout ignores, a field
 *  spelled the way a SIBLING layout spells it, a field that only applies in a
 *  branch this slide did not take — all three answer the same way, and a new
 *  layout is covered the day it is written.
 *
 *  Three real drops, all of them silent, all of them in one delivered deck:
 *    - `stages: [{ title, body }]` on a process slide, where the renderer read
 *      `name`/`caption`. Four empty blue boxes, published to Drive.
 *    - `venn.overlap` with THREE sets, which only the two-set branch draws.
 *    - `eyebrow` and `body` on a cover, which draws title and subtitle only.
 *
 *  Every one of them passed tsc, passed `unrenderableSlides` (the slide had
 *  the key its layout requires), passed the whole geometry battery, and
 *  rendered a slide that looked deliberate. Nothing else in this file can
 *  catch a field that is READ FROM THE WRONG NAME.
 *
 *  Compared on a five-word normalised prefix, so the transformations the
 *  builder legitimately makes — upper-casing, brace-stripping, `fitCell`'s
 *  ellipsis, a wrapped label — do not read as losses. */
export function droppedContent(slide: SlideInput, index: number, notes?: string[]): string[] {
  let drawn = "";
  try {
    // The same build collects the layout's own notes when asked, so a deck is
    // built once per slide for the audit rather than twice.
    const reqs = buildSlideRequests(slide, index, "audit", notes) as any[];
    const parts: string[] = [];
    for (const r of reqs) if (r.insertText?.text) parts.push(String(r.insertText.text));
    drawn = contentKey(parts.join(" \u00b7 "));
  } catch {
    return [];   // a slide that cannot build is a different report's problem
  }
  const missing: string[] = [];
  const seen: { [k: string]: true } = {};
  const walk = (v: any, key: string) => {
    if (typeof v === "string") {
      if (NON_CONTENT_KEYS.has(key)) return;
      const probe = contentKey(v).split(" ").slice(0, 5).join(" ");
      if (probe.length <= 10) return;          // too short to match reliably
      if (drawn.indexOf(probe) !== -1) return;
      if (seen[probe]) return;
      seen[probe] = true;
      missing.push(v.trim());
      return;
    }
    if (Array.isArray(v)) { for (const x of v) walk(x, key); return; }
    if (v && typeof v === "object") { for (const k of Object.keys(v)) walk(v[k], k); }
  };
  const any = slide as any;
  for (const k of Object.keys(any)) walk(any[k], k);
  // Text a layout NOTE already quotes — a hub caption too long for its circle —
  // is left to that note, whose fix is the right one. The generic advice below
  // it in deckWarnings, "put it in a field this layout uses", told the model to
  // move a caption that was already in hub.caption and only needed shortening.
  if (notes && notes.length) return missing.filter((m) => !notes.some((n) => n.indexOf(quoteClip(m)) >= 0));
  return missing;
}

/**
 * Every `table` slide whose `body` the layout could not fit beneath its rows.
 *
 * The one loss on a table slide that no field rename by the builder can fix.
 * The rows take the band first — a table cut to fit a paragraph is a worse
 * slide than the paragraph moved — so a long body against a tall table has
 * nowhere to go, and the honest outcome is to say so before the deck is built
 * rather than to publish a slide missing its argument. `bodyRight` is the
 * field for it: drawn today, as a rail beside the table, on this very layout.
 *
 * ASKED BY BUILDING, not by a table of which layout reads which field, for the
 * reason droppedContent gives at length: the placement depends on the row
 * count, the cell measure, the standfirst's height and the takeaway bar, so
 * any restatement of the rule here would be a second answer to drift from the
 * first. The slide is built and the box is looked for by name.
 *
 * AND NOT THROUGH droppedContent, which is the near miss worth recording.
 * That function compares a five-word normalised PREFIX and ignores anything
 * under eleven characters, both of which are right for an audit written to
 * survive the transformations a builder legitimately makes — upper-casing,
 * `fitCell`'s ellipsis, a wrapped label. They are wrong for a refusal. A body
 * opening with the words of its own standfirst ("The single closest organic
 * competitor to Amrize…", which is how an analyst writes) matches text drawn
 * elsewhere on the slide and reads as present; a body of "Up 12% YoY" is nine
 * characters normalised and is never compared at all. Both were measured
 * against this very branch while the builder itself was recording that the
 * body "is NOT drawn", and both built and shipped. Asking whether the BOX was
 * emitted has no prefix and no floor, and an echo cannot fool it.
 */
export function undrawnTableBodies(slides: SlideInput[]): { slide: number; title: string; body: string }[] {
  const out: { slide: number; title: string; body: string }[] = [];
  for (let i = 0; i < slides.length; i++) {
    const s = slides[i] || ({} as SlideInput);
    if (layoutOf(s.layout, i) !== "table" || !s.table) continue;
    const body = String(s.body || "").trim();
    if (!body) continue;
    let drawn = false;
    try {
      const reqs = buildSlideRequests(s, i, "guard") as any[];
      for (let r = 0; r < reqs.length; r++) {
        const o = reqs[r].createShape;
        // The box the table branch draws a body into, found by the suffix its
        // id is built from. Other layouts draw a `_body` of their own, which
        // is why the lines above leave this function looking at nothing but a
        // `table` slide carrying a table: on that slide the branch below is
        // the only one that can emit it.
        if (o && String(o.objectId || "").slice(-5) === "_body") { drawn = true; break; }
      }
    } catch {
      continue;   // a slide that cannot build is a different report's problem
    }
    if (!drawn) out.push({ slide: i + 1, title: String(s.title || "").replace(/[{}`]/g, "").trim(), body });
  }
  return out;
}

/** A piece of slide text quoted in a note, clipped the one way everything that
 *  quotes it clips it — so droppedContent can recognise text a layout note
 *  has already named. */
export function quoteClip(t: string): string {
  const s = String(t || "").trim();
  return `"${s.length > 48 ? s.slice(0, 45) + "..." : s}"`;
}

/** What the deck could not do, in a sentence the model can relay.
 *
 *  The slide says it too — a truncated chart carries its own note — but the
 *  model is the one having the conversation, and a user who is told "four of
 *  your six pictures could not be found" can supply them. Silence here meant
 *  the model described a deck that was quietly missing things. */
export function deckWarnings(slides: SlideInput[], measured: string[] = []): string {
  const notes: string[] = [];
  // What was MEASURED on the built deck rather than read off its spec: the
  // geometry faults from lib/slides/validate.ts, which the caller runs because
  // it is the one place holding the built requests. They arrive as sentences
  // and join the same advisory list — a second block of warnings beside this
  // one, with its own framing, is how a deck ends up telling the model two
  // different things about the same slide.
  //
  // Passed IN rather than measured here so that this module does not import
  // the validator that imports it. The list is first because a box drawn off
  // the page outranks a note about dark grounds.
  for (let i = 0; i < measured.length; i++) notes.push(measured[i]);
  for (let i = 0; i < slides.length; i++) {
    const s = slides[i];
    const n = i + 1;
    if (s.layoutAsked) notes.push(`slide ${n} asked for layout "${s.layoutAsked}", drawn as "${s.layout}"`);
    if (s.imageUnavailable) notes.push(`slide ${n} has no photograph — ${s.imageError || "none could be found"}`);
    if (s.imagesDropped) {
      const asked = (s.images || []).length;
      notes.push(`slide ${n} shows ${asked - s.imagesDropped} of ${asked} thumbnails; the rest could not be found`);
    }
    // Words that are in the slide and will not be on it. Named with the text
    // itself, because "slide 24 drops a field" is not actionable and
    // "slide 24 never draws 'We refine together'" is.
    const drawnNotes: string[] = [];
    const lost = droppedContent(s, i, drawnNotes);
    if (lost.length) {
      const shown = lost.slice(0, 3).map(quoteClip).join(", ");
      notes.push(
        `slide ${n} carries text its ${s.layout || "content"} layout never draws — ${shown}` +
        `${lost.length > 3 ? ` and ${lost.length - 3} more` : ""}. Put it in a field this layout uses, or change the layout` +
        ` — do NOT describe that content as being in the deck`
      );
    }
    // What the layout itself could not do: a third hub group, a name too long
    // for its circle or its label. A short group name left off is invisible to
    // droppedContent, which ignores anything under eleven characters.
    for (const d of drawnNotes) notes.push(`slide ${n}: ${d}`);
    // A missing icon is drawn as a stand-in dot, which is tidy and still not
    // what was asked for. Brand names are the usual cause, and a plain noun is
    // the fix only the model can make.
    const missingIcons = Array.isArray(s.iconsMissing) ? s.iconsMissing.filter((x) => typeof x === "string" && x.trim()) : [];
    if (missingIcons.length) {
      notes.push(
        `slide ${n}: no icon could be found for ${missingIcons.slice(0, 4).map((x) => `"${x}"`).join(", ")}` +
        `${missingIcons.length > 4 ? ` and ${missingIcons.length - 4} more` : ""} — Lucide has almost no brand icons;` +
        ` use a plain noun (mail, folder, credit-card, database, message-square)`
      );
    }
  }
  // GROUND RHYTHM, from the design system: roughly 70% light, dark slides as
  // punctuation, and two dark slides in a row reads as a mistake. Advisory —
  // the model is told, the deck still builds.
  const grounds = slides.map((sl, i) => slideStyle(sl, i).onDark);
  const darkShare = grounds.length ? grounds.filter(Boolean).length / grounds.length : 0;
  if (slides.length >= 6 && darkShare > 0.45) {
    notes.push(`${Math.round(darkShare * 100)}% of the deck is on dark grounds — the house ratio is roughly 70% light, with dark slides as punctuation`);
  }
  const adjacentDark: number[] = [];
  for (let i = 1; i < grounds.length; i++) {
    if (grounds[i] && grounds[i - 1]) adjacentDark.push(i + 1);
  }
  if (adjacentDark.length) {
    notes.push(`slides ${adjacentDark.join(", ")} each follow another dark slide — two dark grounds in a row reads as a mistake in this brand`);
  }
  // LAYOUT VARIETY. The prompt has said for months that content is the
  // fallback, that no more than a third of a deck may be content and that two
  // in a row is the limit — and nothing measured it, so a deck could break all
  // three and be told nothing. This is the same lesson as every other check in
  // this repo: a rule that is only WRITTEN is a rule that is only sometimes
  // followed. Advisory, like the ground rhythm above; the deck still builds.
  //
  // Continuations are skipped throughout. A split slide repeats its parent's
  // layout by construction, and counting that as monotony would report the
  // splitter's work as the author's.
  const authored = slides.filter((sl) => !sl.continuation);
  if (authored.length >= 6) {
    const layoutOf = (sl: SlideInput) => sl.layout || "content";
    const prose = authored.filter((sl) => layoutOf(sl) === "content").length;
    if (prose / authored.length > 1 / 3) {
      notes.push(
        `${prose} of ${authored.length} slides are the plain \`content\` layout, over the house limit of a third` +
        ` — a list of things that are the same KIND of thing is \`cards\`, a slide whose point is a figure is \`stat\`,` +
        ` and a comparison is \`comparison\` or \`table\``
      );
    }
    const distinct = new Set(authored.map(layoutOf));
    // Roughly one distinct layout per three slides, capped: a 20-slide deck
    // does not need 20 formats, but six formats in twenty slides is a template.
    const want = Math.min(8, Math.max(4, Math.round(authored.length / 2.5)));
    if (distinct.size < want) {
      notes.push(
        `the deck uses ${distinct.size} layout${distinct.size === 1 ? "" : "s"} across ${authored.length} slides (${Array.from(distinct).join(", ")})` +
        ` — around ${want} is the house range at this length, and there are 28 to choose from`
      );
    }
    const runs: string[] = [];
    let run = 1;
    for (let i = 1; i < authored.length; i++) {
      if (layoutOf(authored[i]) === layoutOf(authored[i - 1])) { run += 1; continue; }
      if (run >= 3) runs.push(`${run} × ${layoutOf(authored[i - 1])} ending at slide ${slides.indexOf(authored[i - 1]) + 1}`);
      run = 1;
    }
    if (run >= 3) runs.push(`${run} × ${layoutOf(authored[authored.length - 1])} ending at slide ${slides.length}`);
    if (runs.length) {
      notes.push(`a run of identical layouts reads as one long slide: ${runs.join("; ")} — break it with a different format`);
    }
  }

  // The house dash rule. Em and en dashes are not part of TCE materials.
  const dashed: number[] = [];
  for (let i = 0; i < slides.length; i++) {
    if (/[\u2013\u2014]/.test(JSON.stringify(slides[i]))) dashed.push(i + 1);
  }
  if (dashed.length) {
    notes.push(`slide${dashed.length > 1 ? "s" : ""} ${dashed.join(", ")} use em or en dashes — house style is hyphens, rewrite those lines`);
  }
  if (!notes.length) return "";
  // ADVISORY, and the wording has to say so. The deck is already built and on
  // screen by the time these are read. A run that saw three notes at once —
  // dropped fields, a run of dark grounds, and em dashes — answered by
  // REBUILDING the whole deck, which costs a second full generation including
  // its photographs, and the turn was cut off mid-rebuild with the first deck
  // still the only one that existed. Relaying takes a sentence; rebuilding
  // takes the rest of the turn.
  return ` The deck is BUILT and shown. These notes are advisory, not errors,` +
    ` and not a rebuild instruction: relay them to the user in one short line,` +
    ` without apologising, and OFFER to redraw. Do not resend the deck in this` +
    ` turn unless they ask — a redraw is a second full generation and the turn` +
    ` has a hard time limit. Notes: ${notes.join("; ")}.`;
}

/** Where a prose slide's picture goes: down the right, bleeding to the right
 *  and bottom edges.
 *
 *  A content slide with an `image.query` resolved a photograph, cropped it,
 *  baked a gradient into it and uploaded it to Blob — and then drew nothing,
 *  because only the full-bleed layouts call backdropRequests. The picture was
 *  paid for and discarded, AND isVisualSlide counted the slide as visual on the
 *  strength of it, so the audit reported a deck as illustrated when every slide
 *  was text. */
export function railBox(
  slide: SlideInput
): { url: string; x: number; y: number; width: number; height: number } | null {
  const url = slide.resolvedImage?.url;
  const layout = slide.layout;
  if (!url || (layout !== "content" && layout !== "case-study")) return null;
  const x = GRID.margin + GRID.proseNarrow + IMAGE.railGap;
  // THE TOP EDGE IS THE TITLE'S RULE, not an arbitrary line 10pt under it. The
  // picture bleeds off the right and the bottom trim; the one edge it has is
  // the top, and floating that edge in white made a full-bleed photograph read
  // as a rectangle somebody had dropped on the page. Started ON the rule — and
  // with the rule run out to meet it — the picture is HUNG from the page's own
  // horizontal instead, which is what three bled edges and one drawn one is
  // supposed to mean.
  const y = GRID.bodyY - RULE.gapAbove;
  return { url, x, y, width: CANVAS.width - x, height: CANVAS.height - y };
}

/** THE PHOTO RAIL'S PICTURE: portrait, inset down the left, on `photo-rail`.
 *
 *  The sibling of `railBox` above and deliberately not a variant of it. That
 *  one bleeds a picture off the right and bottom trim of a prose page and
 *  hangs it from the title's own rule, so its box moves with the density and
 *  its shape is whatever is left of the canvas. This one is held inside all
 *  four margins at a fixed crop, which is why the page keeps its chrome and
 *  why the two text columns beside it have the same measure at both presets.
 *
 *  ONE RULER, and it has to be: this box decides the CROP at resolution time
 *  and the PLACEMENT at draw time, the same contract `cardGeometry` keeps. A
 *  picture baked to one shape and drawn in another letterboxes, which is the
 *  bug `railShape` exists to have closed for the bleeding rail. */
export function photoRailBox(
  slide: Pick<SlideInput, "layout" | "resolvedImage">
): { url: string; x: number; y: number; width: number; height: number } | null {
  if (slide.layout !== "photo-rail") return null;
  const url = slide.resolvedImage?.url;
  if (!url) return null;
  return {
    url, x: GRID.margin, y: PHOTO_RAIL.top,
    width: PHOTO_RAIL.width, height: PHOTO_RAIL.height,
  };
}

/** THE SHAPE A SLIDE'S PICTURE IS DRAWN IN, and therefore the shape it has to
 *  be CROPPED to. Null when the picture is a backdrop rather than a region.
 *
 *  Written once because it was written twice: the attachment path and the
 *  query path each carried their own copy of the bleeding rail's arithmetic,
 *  and a third copy for the photo rail would be a third chance for the crop
 *  and the placement to disagree. A picture baked to one shape and drawn in
 *  another letterboxes, which is the whole reason `railShape` exists.
 *
 *  THE PHOTO RAIL'S SHAPE IS DENSITY-FREE and the bleeding rail's is not.
 *  Images resolve outside `withDensity`, so the bleeding rail — whose box is
 *  measured from GRID.bodyY — is cropped at the default preset whatever the
 *  deck is set to, and at `present` the box it lands in is 54.72pt shorter
 *  than the crop assumed. The inset rail cannot have that fault: its box is
 *  derived from the frame, which does not move. */
export function pictureShape(layout: string | undefined): { width: number; height: number } | null {
  if (layout === "photo-rail") return { width: PHOTO_RAIL.width, height: PHOTO_RAIL.height };
  if (layout === "content" || layout === "case-study") {
    return {
      width: CANVAS.width - (GRID.margin + GRID.proseNarrow + IMAGE.railGap),
      height: CANVAS.height - GRID.bodyY,
    };
  }
  return null;
}

/** The rule under a title: a short accent segment, then a hairline.
 *
 *  IT TAKES A REACH RATHER THAN A WIDTH, because the handover deck's own rule
 *  does not always start at the margin. On its three-column pages it runs the
 *  full measure; on its photo-rail pages it starts at the PICTURE'S RIGHT EDGE
 *  and runs to the right margin, which is the detail that makes those slides
 *  look like theirs rather than like ours with a photograph on them. That is
 *  the same vocabulary `hairline` already speaks — `hairlineSpan`'s own header
 *  names these two slides — so the two rules in this deck are one device with
 *  one span type between them, not a rule and a special case.
 *
 *  A width is still what every caller before Stage 4 passes, expressed as the
 *  reach it always meant: from the margin, for that width. */
function ruleRequests(
  objectId: string, page: string, y: number, reach: HairlineReach, onDark: boolean
): Req[] {
  const accent = onDark ? COLOR.tealSoft : COLOR.blue;
  const hair = onDark ? COLOR.greyLight : COLOR.navy;
  const span = hairlineSpan(reach);
  // Nothing to run across: the same refusal `hairline` makes, and for the same
  // reason — Slides rejects a zero-width shape and takes the whole deck with
  // it over a rule nobody would have seen.
  if (span.length <= 0) return [];
  return [
    ...filledShape(`${objectId}a`, page, "RECTANGLE", accent, {
      x: span.x, y, width: Math.min(RULE.accentWidth, span.length), height: RULE.thickness,
    }),
    ...filledShape(`${objectId}b`, page, "RECTANGLE", hair, {
      x: span.x + RULE.accentWidth, y: y + (RULE.thickness - RULE.hairlineThickness) / 2,
      width: Math.max(0, span.length - RULE.accentWidth), height: RULE.hairlineThickness,
    }, RULE.hairlineAlpha),
  ];
}

/** Card geometry, computed in ONE place — the thumbnail's box decides the crop
 *  at resolution time and the placement at draw time.
 *
 *  The thumbnail is a fraction of the card's HEIGHT rather than a square of its
 *  width. Square-by-width overflowed: with four cards the picture ate so much
 *  of the card that the body was pushed out of the bottom of its own panel. */
export function cardGeometry(count: number, wide = false) {
  // FIVE OR SIX CARDS WRAP TO TWO ROWS. One row of six gave each card 103pt of
  // width — a heading wrapped to four lines over a body squeezed to a word a
  // line — while the source decks set the same content as a 2x3 grid. Four
  // cards and fewer stay on one row, which is where a row still reads as one.
  // WIDE: two columns, however many rows. Six cards in three columns gave each
  // body a 190pt measure, so sentences that sat on two lines in the reference
  // deck's two-column grid wrapped to three and ran off the card. Chosen by
  // the caller from the measured bodies, never by count alone.
  const rows = wide ? Math.ceil(count / 2) : count >= 5 ? 2 : 1;
  const cols = Math.max(1, Math.min(6, wide ? Math.min(2, count) : rows === 2 ? Math.ceil(count / 2) : count));
  const cellW = (GRID.contentWidth - CARDS.gap * (cols - 1)) / cols;
  const innerW = cellW - CARDS.padding * 2;
  const thumbH = CARDS.height * 0.42;
  // Bound how wide a thumbnail may get relative to its height, and centre it
  // when the card is wider than that. Spanning the full card put a 3.4:1 strip
  // on a two-card slide — the same swing that made the image grid pick bad
  // crops before its arrangement was chosen by cell shape.
  const thumbW = Math.min(innerW, thumbH * 2.2);
  return { cols, rows, cellW, innerW, thumbW, thumbH, aspect: thumbW / thumbH };
}

/** Repeated blocks across the band.
 *
 *  Deliberately ONE function rather than the three layouts the source deck
 *  appears to use. Its slide 4 is a label chip over body text with no card
 *  behind it, its slide 6 is a white card holding a thumbnail and a caption,
 *  and its slide 12 is a number beside a description. Those are not three
 *  arrangements — they are the same arrangement with different parts present,
 *  and building them separately would have produced three sets of geometry to
 *  keep in step.
 *
 *  The card panel is only drawn when there is something to hold: a thumbnail,
 *  or a body long enough to read as a block. A chip and a heading floating on
 *  the slide ground is what their pillars slide does, and boxing it would make
 *  it look heavier than they draw it.
 */
/** A card's accent: the bar over it, and the chip inside it. ONE lookup, so
 *  the two cannot disagree — which they did, the bar following the tone and
 *  the chip staying brand blue on all three. */
function cardAccent(tone: string | undefined): string {
  const ACCENT: { [k: string]: string } = {
    coral: COLOR.coralDeep, teal: COLOR.inkTeal, blue: COLOR.blue,
    amber: COLOR.inkAmber, grey: COLOR.navy,
  };
  return ACCENT[String(tone || "").toLowerCase()] || COLOR.blue;
}

function cardsRequests(
  page: string, id: (s: string) => string,
  cards: NonNullable<SlideInput["cards"]>,
  top: number = CARDS.y,
  height: number = CARDS.height,
  meta?: { bottom: number },
  /** Whether the row may take the band's slack. False when something else —
   *  the spanning strip — is measured from where the cards end. */
  centre: boolean = false
): Req[] {
  // `text` IS A SYNONYM HERE TOO, and this one was found by looking at a render
  // rather than by reading: a card written as { title, text } — which is what a
  // model writes beside a `title` — drew its heading and nothing under it, and
  // the slide came out as three bold lines over two thirds of empty page. The
  // audit reported it, as it reports the same shape on a stage, and a field
  // that has to be reported is a field the renderer should have read. Lifted
  // once, here, so every reader below sees it: the height planner, the bullet
  // test and the drawing, which is three places to forget.
  const shown = cards.filter(Boolean).slice(0, 6)
    .map((c: any) => (c && !c.body && typeof c.text === "string" && c.text.trim() ? { ...c, body: c.text } : c));
  if (!shown.length) return [];

  const panelled = shown.some((c) => c.resolvedImage?.url);
  const anyToned = shown.some((c) => toneAt([c.tone || ""], 0));
  const boxedAll = anyToned || panelled;

  // A FIT LADDER, not one rule. Bodies are measured at the drawn size and
  // leading, row by row, against each grid in turn; the first arrangement
  // whose rows all fit their share of the band wins. Choosing "wide" from the
  // narrow measure alone gave four E-E-A-T cards a 2x2 grid whose rows were
  // then capped by the band, and every second line fell out of its card.
  //   1. narrow grid, 9pt at 1.3       — the reference's own card text
  //   2. narrow grid, 8pt at 1.3       — the floor
  //   3. wide grid (two columns), 9 then 8
  //   4. tighter leading as the last resort before anything is cut
  type Plan = { wide: boolean; size: number; lead: number; titleSize: number };
  const T = TYPE.cardTitle.size;
  const LADDER: Plan[] = [
    { wide: false, size: TYPE.cardBody.size, lead: 1.3, titleSize: T }, { wide: false, size: 8, lead: 1.3, titleSize: T },
    { wide: true, size: TYPE.cardBody.size, lead: 1.3, titleSize: T }, { wide: true, size: 8, lead: 1.3, titleSize: T },
    { wide: false, size: 8, lead: 1.15, titleSize: T }, { wide: true, size: 8, lead: 1.15, titleSize: T },
    // A two-line heading costs every card in the row 45pt; one step down on
    // the heading is cheaper than losing a body line.
    { wide: false, size: 8, lead: 1.15, titleSize: 11.5 }, { wide: true, size: 8, lead: 1.15, titleSize: 11.5 },
  ];
  const measureWith = (p: Plan, inlineChips: boolean) => {
    const g = cardGeometry(shown.length, p.wide);
    // BESIDE the heading in a grid three across or fewer; ABOVE it in a
    // four-across grid, where a 100pt card cannot spare half its measure and
    // "Training data - the slow clock" wrapped to four lines beside its chip.
    // The reference stacks on its four-card pages and sets the number inline
    // on its six-card ones, for the same reason.
    const chipWidth = (marker: string) => Math.min(g.innerW * 0.5,
      Math.max(34, Math.ceil(marker.length * TYPE.cardMarker.size * 0.6) + TEXT_INSET_X + 10));
    const tBlock = shown.reduce((tallest, c) => {
      if (!c.title) return tallest;
      const w = g.innerW - (c.marker && inlineChips ? chipWidth(c.marker) + 6 : 0);
      return Math.max(tallest, drawnTextHeight(estimateLines(c.title, w, p.titleSize), p.titleSize));
    }, 0.42 * 72);
    // ONE RULER. The ladder measures a card body exactly as bulletBlock draws
    // it — no Slides bullet indent narrowing the measure, and the stack's own
    // paragraph cost rather than a written-down 4.
    const bodyH = (c: (typeof shown)[number], innerW: number) => {
      const t = (c.body || "").trim();
      if (!t) return 0;
      return bulletBlockHeight(t, innerW, { size: p.size }, 0, p.lead);
    };
    const contentH = (card: (typeof shown)[number]) => {
      const tone = toneAt([card.tone || ""], 0);
      const boxed = !!(tone || boxedAll);
      let h = boxed ? CARDS.padding + (tone || anyToned ? 3 : 0) : 0;
      if (card.resolvedImage?.url) h += g.thumbH + CARDS.titleGap;
      else if (card.resolvedIcon) h += CARDS.iconSize + CARDS.titleGap;
      // A marker sits BESIDE the heading when there is one — "01 · Tier-1
      // press" — and costs no row of its own; six cards with a chip row, a
      // heading and a body could not fit under a takeaway bar at 8pt, and the
      // reference deck never stacks them.
      const beside = !!(card.marker && card.title && inlineChips);
      if (card.marker && !beside) h += CARDS.markerHeight + CARDS.titleGap;
      h += Math.max(tBlock, beside ? CARDS.markerHeight : 0) + 4;
      // AT THE HEIGHT THE BOX IS ACTUALLY DRAWN AT. The drawing floors a body
      // box at 20pt so a card never gets a box with no room in it at all, and
      // the plan measured the words alone — so an arrangement whose bodies
      // came out under the floor was judged to fit and then drew 20pt boxes
      // past the foot of the band, through the takeaway bar and the running
      // head. One number for the planner and the drawing.
      const bh = bodyH(card, boxed ? g.cellW - CARDS.padding * 2 : g.cellW);
      h += bh ? Math.max(20, bh) : 0;
      h += boxed ? CARDS.padding : 0;
      return h;
    };
    // ROWS NEED NOT BE EQUAL. Each row is as tall as its tallest card, and the
    // GRID fits when the rows and their gaps fit the band — a first row of
    // three-line bodies over a second of one-liners is not two rows of the
    // taller. Capping every row at an equal share put the second lines of a
    // five-card set outside their cards while a third of the band sat empty.
    const rowHs: number[] = [];
    for (let r = 0; r < g.rows; r++) {
      let tallest = 0;
      for (let i = r * g.cols; i < Math.min(shown.length, (r + 1) * g.cols); i++) tallest = Math.max(tallest, contentH(shown[i]));
      rowHs.push(Math.max(40, tallest));
    }
    const total = rowHs.reduce((a, b) => a + b, 0) + CARDS.gap * (g.rows - 1);
    return { g, tBlock, rowHs, total, inlineChips, fits: total <= height + 0.5 };
  };

  /**
   * THE CHIP GOES BESIDE THE HEADING, AND ABOVE IT WHEN THE HEADING WRAPS —
   * BUT NEVER AT THE COST OF THE BODY'S ROOM.
   *
   * A heading that wraps beside its chip puts its second line back UNDER the
   * numeral: the chip is a block in the corner of a box that Slides will not
   * flow text around, so the marker is left sitting in a hole. Stacking it is
   * the reference's own answer, and it costs the card a whole row.
   *
   * On a six-card page that row is the body's. Stacking every chip on a
   * 4e54d076-shaped deck dropped the heading a rung, halved the body's box and
   * pushed a one-line body through the footer — trading a hole beside a numeral
   * for words drawn over the running head. So the stack is taken only when the
   * page can still hold it, and a page that cannot keeps the chip inline: the
   * hole is a blemish, the overrun is a loss.
   */
  const measurePlan = (p: Plan) => {
    const g = cardGeometry(shown.length, p.wide);
    const chipW = (marker: string) => Math.min(g.innerW * 0.5,
      Math.max(34, Math.ceil(marker.length * TYPE.cardMarker.size * 0.6) + TEXT_INSET_X + 10));
    const wrapsBeside = shown.some((c) => c.title && c.marker
      && estimateLines(c.title, g.innerW - (chipW(c.marker) + 6), p.titleSize) > 1);
    // BESIDE the heading in a grid three across or fewer; ABOVE it in a
    // four-across grid, where a 100pt card cannot spare half its measure and
    // "Training data - the slow clock" wrapped to four lines beside its chip.
    // The reference stacks on its four-card pages and sets the number inline
    // on its six-card ones, for the same reason.
    const wantInline = g.cols <= 3 && !wrapsBeside;
    const m = measureWith(p, wantInline);
    if (wantInline || m.fits) return m;
    // NEITHER FITS: take the SHORTER of the two. The stack costs the card a
    // whole row, and on a page where nothing fits that row comes out of the
    // body — which is how six stacked chips pushed three one-line bodies
    // through the running head on a slide that had merely been tight before.
    const inline = measureWith(p, true);
    return inline.fits || inline.total < m.total ? inline : m;
  };

  let plan = LADDER[0];
  let measured = measurePlan(plan);
  for (let k = 1; k < LADDER.length && !measured.fits; k++) { plan = LADDER[k]; measured = measurePlan(plan); }
  // WHETHER EVERY CARD HOLDS ITS OWN WORDS, remembered before the fallback
  // below scales the rows to the band. A row that fits may take the band's
  // slack; a row that does NOT fit must not, because the slack is the only
  // thing keeping the text it is already spilling above the takeaway bar and
  // the footer. Four stored slides turned a quiet overrun into a reported one
  // the day the row centred.
  const everyCardFits = measured.fits;
  if (!measured.fits) {
    // Nothing fits whole: take the plan that misses by least, and scale its
    // rows to the band so the grid at least ends where it should. The text
    // then runs a little past its card — declared by deckWarnings, never
    // hidden — rather than the LAST plan's rows, which were the tallest.
    let best = measurePlan(LADDER[0]), bestPlan = LADDER[0];
    for (const p of LADDER) { const m = measurePlan(p); if (m.total < best.total) { best = m; bestPlan = p; } }
    plan = bestPlan; measured = best;
    const k = Math.max(0.5, (height - CARDS.gap * (measured.g.rows - 1)) / (measured.total - CARDS.gap * (measured.g.rows - 1)));
    measured.rowHs = measured.rowHs.map((h) => h * k);
  }
  const BODY_LEAD = plan.lead;
  const bodySize = plan.size;
  const titleSize = plan.titleSize;
  const { cols, rows: gridRows, cellW, thumbW, thumbH } = measured.g;
  const titleBlockH = measured.tBlock;
  const rowHs = measured.rowHs;
  const inlineChips = measured.inlineChips;
  const rowTops: number[] = [];
  {
    // A CARD GRID IS A FIGURE, AND A FIGURE CENTRES IN ITS BAND. The same call
    // the stat row already makes, and the same reasoning: a self-contained
    // block is framed by the room it is given, where prose hangs from a fixed
    // top edge and aligns with the title. Hung from the top, three short cards
    // left the bottom quarter of the page visibly unfinished.
    const used = rowHs.reduce((a, b) => a + b, 0) + CARDS.gap * (rowHs.length - 1);
    let acc = top + (centre && everyCardFits ? Math.max(0, (height - used) / 2) : 0);
    for (const h of rowHs) { rowTops.push(acc); acc += h + CARDS.gap; }
  }

  const out: Req[] = [];
  shown.forEach((card, i) => {
    const col = i % cols;
    const gridRow = Math.floor(i / cols);
    // A short last row is CENTRED: five cards in a three-wide grid left a hole
    // at the bottom right that the room read as a sixth card missing.
    const inRow = Math.min(cols, shown.length - gridRow * cols);
    const rowW = inRow * cellW + (inRow - 1) * CARDS.gap;
    const x = GRID.margin + (GRID.contentWidth - rowW) / 2 + col * (cellW + CARDS.gap);
    const rowTop = rowTops[gridRow];
    const rowH = rowHs[gridRow];
    let y = rowTop;

    const tone = toneAt([card.tone || ""], 0);
    if (tone || boxedAll) {
      out.push(...filledShape(id(`cp${i}`), page, "ROUND_RECTANGLE",
        tone ? tone.tint : COLOR.white, {
        x, y, width: cellW, height: rowH,
      }));
      if (tone) {
        out.push(...filledShape(id(`ca${i}`), page, "RECTANGLE", cardAccent(card.tone), {
          x: x + 6, y: y, width: cellW - 12, height: 3,
        }));
      }
    }
    const boxed = !!(tone || boxedAll);
    const innerX = boxed ? x + CARDS.padding : x;
    const innerW = boxed ? cellW - CARDS.padding * 2 : cellW;
    if (boxed) y += CARDS.padding + (tone || anyToned ? 3 : 0);

    if (card.resolvedImage?.url) {
      out.push({
        createImage: {
          objectId: id(`ci${i}`),
          url: card.resolvedImage.url,
          elementProperties: {
            pageObjectId: page,
            size: { width: pt(thumbW), height: pt(thumbH) },
            transform: {
              scaleX: 1, scaleY: 1,
              translateX: innerX + (innerW - thumbW) / 2, translateY: y, unit: "PT",
            },
          },
        },
      });
      y += thumbH + CARDS.titleGap;
    }

    if (card.resolvedIcon && !card.resolvedImage) {
      const size = CARDS.iconSize;
      out.push({
        createImage: {
          objectId: id(`cn${i}`),
          url: card.resolvedIcon,
          elementProperties: {
            pageObjectId: page,
            size: { width: pt(size), height: pt(size) },
            transform: { scaleX: 1, scaleY: 1, translateX: innerX, translateY: y, unit: "PT" },
          },
        },
      });
      y += size + CARDS.titleGap;
    }

    const inline = !!(card.marker && card.title && inlineChips);
    let titleX = innerX, titleW = innerW;
    if (card.marker) {
      const chipW = Math.min(
        inline ? innerW * 0.5 : innerW,
        Math.max(34, Math.ceil(card.marker.length * TYPE.cardMarker.size * 0.6) + TEXT_INSET_X + 10)
      );
      // THE CHIP IS THE CARD'S OWN COLOUR. It was brand blue on every card,
      // beside an accent bar and a heading that both follow the card's tone —
      // so a green card carried a green bar, a green heading and a blue
      // numeral, and the one element that is supposed to say "this is card
      // two" said "this belongs to something else".
      const chipFill = tone ? cardAccent(card.tone) : COLOR.blue;
      out.push(
        ...filledShape(id(`cm${i}`), page, "RECTANGLE", chipFill, {
          x: innerX, y, width: chipW, height: CARDS.markerHeight,
        }),
        ...textBox(id(`cmt${i}`), page, card.marker, { ...TYPE.cardMarker, color: textOn(chipFill) }, {
          x: innerX, y, width: chipW, height: CARDS.markerHeight,
        }, { align: "CENTER", vCenter: true }),
      );
      if (inline) { titleX = innerX + chipW + 6; titleW = innerW - chipW - 6; }
      else y += CARDS.markerHeight + CARDS.titleGap;
    }

    // The title sits at the TOP of its block, beside its chip when it has
    // one. The block is still the tallest title's height so every body in a
    // row starts on one baseline — but the slack now falls between a short
    // title and its body, not above it.
    const blockH = Math.max(titleBlockH, inline ? CARDS.markerHeight : 0);
    if (card.title) {
      // CENTRED in the row's shared block. The block is the tallest heading's
      // height so every body in the row starts on one line; a one-line
      // heading in a two-line block was drawn hard against the top of it,
      // with 19pt of tint under the words. Bottom-aligning it (the first
      // attempt) put the hole between the chip and the heading instead —
      // both read as a mistake, and centring is what the eye expects.
      out.push(...textBox(id(`ct${i}`), page, card.title,
        { ...TYPE.cardTitle, size: titleSize, ...(tone ? { color: tone.ink } : {}) }, {
        x: titleX, y: inline ? y - 3 : y, width: titleW, height: blockH,
      }, { vCenter: true }));
    }
    y += blockH + 4;

    if (card.body) {
      const remaining = rowTop + rowH - y - (boxed ? CARDS.padding : 0);
      // Bullets stay bullets. Three points written on three lines were being
      // drawn as one paragraph, and the presenter could not count them. They
      // are the deck's OWN bullets now — a hung disc, the same mark a content
      // slide draws — because a deck that sets a disc on one page and Slides'
      // glyph on the next has two bullet styles in it and the reader is asked
      // to believe they mean different things.
      out.push(...bulletBlock(id, `cb${i}`, page, card.body,
        { ...TYPE.cardBody, size: bodySize, ...(tone ? { color: COLOR.ink } : {}) }, {
        x: innerX, y, width: innerW, height: Math.max(20, remaining),
      }, { lead: BODY_LEAD }).requests);
    }
  });
  if (meta) meta.bottom = rowTops[rowTops.length - 1] + rowHs[rowHs.length - 1];
  return out;
}

/**
 * The spanning sub-band under a cards row — "SXO in detail": a full-width
 * tinted panel with a short title and a row of small labelled cells, each
 * elaborating a part of ONE card above. The device that turns three discipline
 * cards plus six sub-disciplines into one slide instead of two.
 */
/** The shortest strip whose cells still sit inside their own panel: 10pt of
 *  pad, a 16pt title line, the cells' own 24pt floor and the pad again. Below
 *  this the panel is not drawn short, it is not drawn. */
const STRIP_MIN_H = 60;

function stripRequests(
  page: string, id: (s: string) => string,
  strip: NonNullable<SlideInput["strip"]>, top: number, height: number
): Req[] {
  const items = (strip.items || []).filter((it) => it && (it.title?.trim() || it.text?.trim())).slice(0, 6);
  if (!items.length && !strip.title?.trim()) return [];
  const out: Req[] = [
    ...filledShape(id("strip"), page, "ROUND_RECTANGLE", COLOR.lav, {
      x: GRID.margin, y: top, width: GRID.contentWidth, height,
    }),
  ];
  const PAD = 10;
  let cursor = top + PAD - 2;
  if (strip.title?.trim()) {
    out.push(...textBox(id("stt"), page, strip.title,
      { font: "Roboto", size: 8.5, weight: 600, color: COLOR.blue }, {
      x: GRID.margin + PAD, y: cursor, width: GRID.contentWidth - PAD * 2, height: 13,
    }));
    cursor += 16;
  }
  if (items.length) {
    const gap = 8;
    const cellW = (GRID.contentWidth - PAD * 2 - gap * (items.length - 1)) / items.length;
    const cellH = Math.max(24, top + height - cursor - PAD + 2);
    // Measured, same as the layer cells: the fixed 12pt title box was shorter
    // than one drawn line of 8pt text.
    const cellTitleH = items.reduce((tall, it) => it.title?.trim()
      ? Math.max(tall, drawnTextHeight(estimateLines(it.title, cellW - 8, 8), 8))
      : tall, 0);
    items.forEach((it, i) => {
      const x = GRID.margin + PAD + i * (cellW + gap);
      out.push(...filledShape(id(`stc${i}`), page, "ROUND_RECTANGLE", COLOR.white, {
        x, y: cursor, width: cellW, height: cellH,
      }));
      if (it.title?.trim()) {
        out.push(...textBox(id(`sth${i}`), page, it.title,
          { font: "Roboto", size: 8, weight: 600, color: COLOR.blue }, {
          x: x + 4, y: cursor + 3, width: cellW - 8, height: cellTitleH,
        }, { align: "CENTER" }));
      }
      if (it.text?.trim()) {
        out.push(...textBox(id(`stx${i}`), page, it.text,
          { font: "Roboto", size: 6.5, weight: 300, color: COLOR.ink }, {
          x: x + 4, y: cursor + 3 + cellTitleH + 1, width: cellW - 8,
          height: Math.max(8, cellH - cellTitleH - 8),
        }, { align: "CENTER", lineSpacing: 1.05 }));
      }
    });
  }
  return out;
}

/** The stacked layer diagram, drawn the way the reference page draws it.
 *
 *  Each band is sized to its own words and centred; the widths step with the
 *  content — the audience band is the widest single-line box, the dashed
 *  synthesis band spans wider than the bands it sits between, and a band whose
 *  connector points UP into the band above adopts that band's width so the
 *  pair reads as one unit. A cells band draws its title as a small band and
 *  its cells as a FREE grid beneath it, four to a row, wrapping past four: one
 *  row of eight is what forced the cell type under 8pt. Heading size is keyed
 *  by style so the stack steps down (12.5 / 10 / 9.5 / 8.5 / 10) and the room
 *  can tell the audience from the plumbing.
 *
 *  Measured at the natural metrics first; when the stack does not fit the
 *  room it steps down a ladder — chrome, then type, then a single row of
 *  cells, then the secondary lines — and the last rung SAYS what it dropped.
 *  Nothing on any rung is below 7.5pt. Leftover room goes into the gaps, a
 *  little each, never into a band. */
type LayerArrow = "down" | "up" | "none";
function layerArrow(v: unknown): LayerArrow {
  if (v === false || v === "none" || v === "false") return "none";
  return v === "up" ? "up" : "down";
}

/** A caption's paragraphs. A newline is one; so is the " - " that follows a
 *  "·"-separated list, because the reference sets its engine list and the
 *  gloss on it as two lines and the model writes them as one string. A plain
 *  sentence with a hyphen in it is left alone. Exported for the battery. */
export function captionParagraphs(caption: string | undefined): string[] {
  const s = (caption || "").trim();
  if (!s) return [];
  if (s.indexOf("\n") >= 0) return s.split("\n").map((l) => l.trim()).filter(Boolean);
  const lastDot = s.lastIndexOf(" · ");
  const dash = lastDot >= 0 ? s.indexOf(" - ", lastDot) : -1;
  if (dash > lastDot) return [s.slice(0, dash).trim(), s.slice(dash + 3).trim()];
  return [s];
}

/** Per-style chrome. `head` is the heading size, keyed by style so the stack
 *  steps DOWN; `minW` is the band's floor width as a share of the content
 *  width — the audience band is the hero, the dashed band spans wider than
 *  its neighbours, everything else hugs its title with a 30% floor. */
const LAYER_STYLE: { [k: string]: { fill: string; ink: string; sub: string; outline?: boolean; head: number; minW: number } } = {
  blue:   { fill: COLOR.blue,      ink: COLOR.white,    sub: COLOR.greyLight, head: 12.5, minW: 0.42 },
  dashed: { fill: COLOR.tintBlue,  ink: COLOR.inkBlue,  sub: COLOR.inkBlue,   head: 10,   minW: 0.60, outline: true },
  teal:   { fill: COLOR.tintTeal,  ink: COLOR.inkTeal,  sub: COLOR.ink,       head: 10,   minW: 0.30 },
  lav:    { fill: COLOR.lav,       ink: COLOR.navy,     sub: COLOR.ink,       head: 9.5,  minW: 0.30 },
  grey:   { fill: COLOR.tintGrey,  ink: COLOR.navy,     sub: COLOR.ink,       head: 8.5,  minW: 0.30 },
  coral:  { fill: COLOR.tintCoral, ink: COLOR.inkCoral, sub: COLOR.ink,       head: 9.5,  minW: 0.30 },
  amber:  { fill: COLOR.tintAmber, ink: COLOR.inkAmber, sub: COLOR.ink,       head: 9.5,  minW: 0.30 },
};

/** The fit ladder: each rung is a complete metric set, and the builder draws
 *  at the first rung that fits. Chrome gives way before type, type before the
 *  second row of cells, the secondary lines last. padY and the cell pad stay
 *  >= TEXT_INSET_Y / 2 on every rung so a text box never leaves its band. */
interface LayerMetrics {
  padY: number; rowGap: number; arrowH: number; arrowGap: number;
  headScale: number; caption: number; cellTitle: number; cellText: number;
  cellGap: number; cellRowGap: number; oneRow: boolean; secondary: boolean;
}
const LAYER_RUNG_0: LayerMetrics = {
  padY: 6, rowGap: 6, arrowH: 7, arrowGap: 1.5, headScale: 1, caption: 8,
  cellTitle: 8, cellText: 7.5, cellGap: 12, cellRowGap: 6, oneRow: false, secondary: true,
};
const LAYER_RUNG_1: LayerMetrics = { ...LAYER_RUNG_0, padY: 4, rowGap: 4, arrowH: 6, arrowGap: 1, cellRowGap: 4 };
const LAYER_RUNG_2: LayerMetrics = { ...LAYER_RUNG_1, headScale: 0.92, caption: 7.5, cellTitle: 7.5 };
const LAYER_RUNG_3: LayerMetrics = { ...LAYER_RUNG_2, oneRow: true, cellGap: 6 };
const LAYER_RUNG_4: LayerMetrics = { ...LAYER_RUNG_3, secondary: false };
const LAYER_RUNGS: LayerMetrics[] = [LAYER_RUNG_0, LAYER_RUNG_1, LAYER_RUNG_2, LAYER_RUNG_3, LAYER_RUNG_4];

/** The air between a band and the cells it heads. They are one block — the
 *  band is the row's title — so this is a hairline's worth of separation, not
 *  the gap between two layers. */
const LAYER_CELL_GAP = 4;

function layersRequests(
  page: string, id: (s: string) => string,
  layers: NonNullable<SlideInput["layers"]>, top: number, room: number
): { requests: Req[]; bottom: number } {
  const shown = layers.filter((l) => l && (l.title?.trim() || (l.cells || []).length)).slice(0, 5);
  if (!shown.length) return { requests: [], bottom: top };
  const PADX = 30;          // ink inset from a band's side
  const CELL_PADX = 8;
  const CELL_PADY = 4;      // >= TEXT_INSET_Y / 2, so a cell's boxes stay inside the cell
  const ARROW_W = 12;
  const ADMISSION_H = 18;   // the "Showing names only" line, when the last rung draws it
  const centre = GRID.margin + GRID.contentWidth / 2;
  const cellsOf = (l: (typeof shown)[number]) =>
    (l.cells || []).filter((c) => c && (c.title?.trim() || c.text?.trim())).slice(0, 8);
  const inkW = (lines: string[], size: number) =>
    lines.reduce((w, l) => Math.max(w, l.trim().length * size * PER_CHAR), 0);
  const styles = shown.map((l) => LAYER_STYLE[String(l.style || "").toLowerCase()] || LAYER_STYLE.lav);

  /** `keep` is how many bands from the top this plan draws. It is `shown.length`
   *  on every rung of the ladder; only the terminal step below ever lowers it,
   *  and a prefix is safe to take because `styles`, `heads`, `paras` and
   *  `widths` are all indexed the same way the stack is. */
  const plan = (m: LayerMetrics, bonus: number, keep: number = shown.length) => {
    const list = keep >= shown.length ? shown : shown.slice(0, Math.max(1, keep));
    const cut = shown.length - list.length;
    const out: Req[] = [];
    const heads = styles.map((st) => Math.max(8, Math.round(st.head * m.headScale * 2) / 2));
    const paras = list.map((l) => (cellsOf(l).length || !m.secondary) ? [] : captionParagraphs(l.caption));
    // Widths from the words: the widest line plus the side inset, floored per
    // style, never past the content width. A band whose connector points UP
    // into the band above adopts that band's width when its own is narrower.
    const widths = list.map((l, i) => {
      // A BAND THAT OWNS CELLS IS AS WIDE AS THEY ARE. The cells are laid out
      // across the full content width, and a band sized to its own words came
      // out 876pt narrower than the four cells hanging under it — so the layer
      // did not contain its own contents, the two rows read as unrelated, and
      // the arrow from the layer beneath pointed into the gap between them. A
      // header strip over its row is one block; a narrow caption over a wide
      // row is two.
      if (cellsOf(l).length) return GRID.contentWidth;
      const need = Math.max(inkW([l.title || ""], heads[i]), inkW(paras[i], m.caption)) + PADX * 2;
      return Math.min(GRID.contentWidth, Math.max(styles[i].minW * GRID.contentWidth, need));
    });
    for (let i = 1; i < list.length; i++) {
      if (layerArrow(list[i - 1].arrow) === "up") widths[i] = Math.max(widths[i], widths[i - 1]);
    }
    let y = top;
    let gaps = 0;
    let dropped = 0;
    list.forEach((layer, li) => {
      const st = styles[li];
      const head = heads[li];
      const W = widths[li];
      const bx = centre - W / 2;
      const cells = cellsOf(layer);
      const title = (layer.title || "").trim();
      const capText = paras[li].join("\n");
      // The ink spans W - 2*PADX; the box is that plus Slides' own inset, so
      // the box sits PADX - 7.2 inside the band and the glyphs sit at PADX.
      const textW = W - PADX * 2 + TEXT_INSET_X;
      const tx = bx + PADX - TEXT_INSET_X / 2;
      const titleLines = title ? estimateLines(title, textW, head) : 0;
      const titleInk = titleLines * head * 1.26;                 // lineSpacing 1.0
      const capLines = capText ? estimateLines(capText, textW, m.caption) : 0;
      const capInk = capLines * m.caption * 1.26 * 1.1;          // lineSpacing 1.1
      const H = m.padY * 2 + titleInk + (capInk ? 1 + capInk : 0);
      out.push(...filledShape(id(`ly${li}`), page, "ROUND_RECTANGLE", st.fill, { x: bx, y, width: W, height: H }));
      if (st.outline) {
        out.push({
          updateShapeProperties: {
            objectId: id(`ly${li}`),
            shapeProperties: {
              outline: { outlineFill: { solidFill: { color: { rgbColor: rgb(COLOR.blue) } } }, weight: pt(1.5), dashStyle: "DASH" },
            },
            fields: "outline",
          },
        });
      }
      let cy = y + m.padY;
      if (title) {
        out.push(...textBox(id(`lyt${li}`), page, title,
          { font: "Roboto", size: head, weight: 600, color: st.ink }, {
          x: tx, y: cy - TEXT_INSET_Y / 2, width: textW, height: drawnTextHeight(titleLines, head, 0, 1, 1.0),
        }, { align: "CENTER", lineSpacing: 1.0 }));
        cy += titleInk;
      }
      if (capText) {
        out.push(...textBox(id(`lyc${li}`), page, capText,
          { font: "Roboto", size: m.caption, weight: 300, color: st.sub }, {
          x: tx, y: cy + 1 - TEXT_INSET_Y / 2, width: textW,
          height: drawnTextHeight(capLines, m.caption, 0, paras[li].length, 1.1),
        }, { align: "CENTER", lineSpacing: 1.1, spaceBelow: 0 }));
      } else if (!m.secondary && !cells.length && layer.caption?.trim()) {
        dropped += 1;
      }
      y += H;
      if (cells.length) {
        // A grid under the title band, four to a row, wrapping past four —
        // TIGHT against the band, because the band is now its header rather
        // than a separate layer above it.
        y += Math.min(m.rowGap, LAYER_CELL_GAP);
        const perRow = (m.oneRow || cells.length <= 4) ? cells.length : Math.ceil(cells.length / 2);
        const rows = Math.ceil(cells.length / perRow);
        const cellW = (GRID.contentWidth - m.cellGap * (perRow - 1)) / perRow;
        const cellTextW = cellW - CELL_PADX * 2 + TEXT_INSET_X;
        for (let r = 0; r < rows; r++) {
          const rowCells = cells.slice(r * perRow, (r + 1) * perRow);
          const nameLines = rowCells.map((c) => c.title?.trim() ? estimateLines(c.title, cellTextW, m.cellTitle) : 0);
          const textLines = rowCells.map((c) => (m.secondary && c.text?.trim()) ? estimateLines(c.text, cellTextW, m.cellText) : 0);
          if (!m.secondary) dropped += rowCells.filter((c) => !!c.text?.trim()).length;
          // One name band and one text band per row, so the cells share a baseline.
          const nameInk = Math.max(...nameLines) * m.cellTitle * 1.26;
          const textInk = Math.max(...textLines) * m.cellText * 1.26;
          const cellH = CELL_PADY * 2 + nameInk + (textInk ? 1 + textInk : 0);
          // A short last row is centred, like the reference's 4 + 3 stat cards.
          const rowW = rowCells.length * cellW + (rowCells.length - 1) * m.cellGap;
          const x0 = centre - rowW / 2;
          rowCells.forEach((c, ci) => {
            const cx = x0 + ci * (cellW + m.cellGap);
            const cid = `${li}_${r * perRow + ci}`;
            out.push(...filledShape(id(`lyc${cid}`), page, "ROUND_RECTANGLE", COLOR.tintBlue, { x: cx, y, width: cellW, height: cellH }));
            if (nameLines[ci]) {
              out.push(...textBox(id(`lyh${cid}`), page, c.title,
                { font: "Roboto", size: m.cellTitle, weight: 600, color: COLOR.navy }, {
                x: cx + CELL_PADX - TEXT_INSET_X / 2, y: y + CELL_PADY - TEXT_INSET_Y / 2, width: cellTextW,
                height: drawnTextHeight(nameLines[ci], m.cellTitle, 0, 1, 1.0),
              }, { align: "CENTER", lineSpacing: 1.0 }));
            }
            if (textLines[ci]) {
              out.push(...textBox(id(`lyx${cid}`), page, c.text,
                { font: "Roboto", size: m.cellText, weight: 300, color: COLOR.ink }, {
                x: cx + CELL_PADX - TEXT_INSET_X / 2, y: y + CELL_PADY + nameInk + 1 - TEXT_INSET_Y / 2, width: cellTextW,
                height: drawnTextHeight(textLines[ci], m.cellText, 0, 1, 1.0),
              }, { align: "CENTER", lineSpacing: 1.0 }));
            }
          });
          y += cellH + (r < rows - 1 ? m.cellRowGap : 0);
        }
      }
      if (li < shown.length - 1) {
        const dir = layerArrow(layer.arrow);
        gaps += 1;
        if (dir === "none") {
          y += m.rowGap + bonus;       // no connector still means a gap
        } else {
          // DOWN_ARROW, or UP_ARROW when the band beneath feeds this one.
          // Inline rather than through filledShape, whose union has no arrows.
          out.push({
            createShape: {
              objectId: id(`lya${li}`), shapeType: dir === "up" ? "UP_ARROW" : "DOWN_ARROW",
              elementProperties: {
                pageObjectId: page,
                size: { width: pt(ARROW_W), height: pt(m.arrowH) },
                transform: { scaleX: 1, scaleY: 1, translateX: centre - ARROW_W / 2, translateY: y + m.arrowGap + bonus / 2, unit: "PT" },
              },
            },
          }, {
            updateShapeProperties: {
              objectId: id(`lya${li}`),
              shapeProperties: {
                shapeBackgroundFill: { solidFill: { color: { rgbColor: rgb(COLOR.navy) }, alpha: 0.55 } },
                outline: { propertyState: "NOT_RENDERED" },
              },
              fields: "shapeBackgroundFill.solidFill,outline",
            },
          });
          y += m.arrowH + m.arrowGap * 2 + bonus;
        }
      }
    });
    if (dropped || cut) {
      // The last rung SAYS what it dropped, right-aligned under the stack in
      // the slot the other layouts use for "Showing N of M" — at 7.5pt, not
      // the 7pt axis style, because nothing on this layout goes below the floor.
      //
      // A DROPPED BAND IS NAMED FIRST. Losing a whole layer is a bigger loss
      // than losing the sentences inside one, and the two can happen together:
      // the terminal step below runs on the last rung, which has already given
      // up every caption it had.
      const said: string[] = [];
      if (cut) said.push(`Showing ${list.length} of ${shown.length} layers`);
      if (dropped) said.push(`${cut ? "" : "showing names only - "}${dropped} description${dropped > 1 ? "s" : ""} omitted`);
      const text = `${said.join(", ")} to fit`.replace(/^s/, "S");
      const w = Math.min(GRID.contentWidth, text.length * 7.5 * PER_CHAR + TEXT_INSET_X + 4);
      out.push(...textBox(id("lydrop"), page, text,
        { font: "Roboto", size: 7.5, weight: 300, color: COLOR.ink }, {
        x: GRID.margin + GRID.contentWidth - w, y: y + 2, width: w, height: ADMISSION_H - 2,
      }, { align: "END", lineSpacing: 1.0 }));
      y += ADMISSION_H;
    }
    return { out, bottom: y, gaps, metrics: m };
  };

  let chosen = plan(LAYER_RUNGS[0], 0);
  for (let r = 1; r < LAYER_RUNGS.length && chosen.bottom - top > room; r++) chosen = plan(LAYER_RUNGS[r], 0);
  // AND WHEN THE LAST RUNG STILL RUNS PAST THE FOOTER, BANDS GO — from the
  // bottom, one at a time, until the stack is clear of it.
  //
  // The ladder used to end unconditionally: five rungs, and whatever the fifth
  // measured was drawn. That was survivable while the band was always read's
  // 270pt, and it stopped being survivable at `present`, where the band gives
  // up a fifth and five bands of cells run 22pt off the bottom of the PAGE —
  // taking the "omitted to fit" line with them, so the one sentence saying
  // content had been lost was itself the content that could not be read.
  // `layers` is excluded from splitOverflowingSlides, so nothing downstream
  // rescues it either.
  //
  // MEASURED AGAINST THE FOOTER, NOT AGAINST `room`, and the two numbers are
  // doing different jobs. `room` is the band — the design intent, what the
  // five rungs above are solving for — and a stack that misses it by a few
  // points borrows the same 7pt gap between the band floor and the footer that
  // a chart's source line already borrows. Dropping a whole layer of an
  // argument to save that is much the worse trade: driven at read, the band
  // floor would cut a band off a five-by-two stack that is drawn perfectly
  // legibly today. FOOTER_Y is the hard floor — below it is the page's own
  // furniture and then the edge of the paper — so this is a safety net rather
  // than a second opinion about the layout.
  //
  // Never below one: a layer diagram of nothing is not a smaller diagram, it is
  // an empty slide, and the words are not lost in any case — droppedContent
  // walks the spec and reports every string the build did not draw.
  let keep = shown.length;
  while (chosen.bottom > FOOTER_Y && keep > 1) {
    keep -= 1;
    chosen = plan(LAYER_RUNGS[LAYER_RUNGS.length - 1], 0, keep);
  }
  // Leftover room goes into the GAPS, up to 12pt each; the rest is left at
  // the foot, which is where the reference leaves it. A band never grows.
  const slack = room - (chosen.bottom - top);
  if (slack > 0 && chosen.gaps > 0) chosen = plan(chosen.metrics, Math.min(12, slack / chosen.gaps), keep);
  return { requests: chosen.out, bottom: chosen.bottom };
}

/** A HUB AND ITS CONNECTIONS: one thing in the middle, what it is wired to
 *  around it, a line from each.
 *
 *  Exists because the layer diagram cannot say "connected to". A stack says
 *  everything below feeds the thing above; a platform wired into a dozen
 *  systems drawn that way came out as four rows of pale pills that read as a
 *  table, on the one slide of the deck whose whole point was the wiring.
 *
 *  Up to two groups, one either side of the hub, each in its own tone so the
 *  sides read as KINDS — the company's data on one side, the team's own tools
 *  on the other. One group is split across both sides and named once, centred
 *  over the hub. Each side's nodes sit on a shallow arc, the middle node
 *  furthest out, so the connectors come out roughly one length and the picture
 *  reads as an orbit rather than two lists. Every node takes the width of the
 *  widest label, measured: nodes of one width read as one set, and hugging
 *  each label made the arc look ragged. */
export const HUB_MAX_PER_SIDE = 7;
const HUB_DEFAULT_TONES = ["blue", "teal"];

/** A group's tint and ink. Exported because the icons are rasterised in the
 *  ink at resolution time, and the two must agree. */
export function hubTone(tone: string | undefined, groupIndex: number): { tint: string; ink: string } {
  const key = String(tone || "").toLowerCase();
  if (key === "lav") return { tint: COLOR.lav, ink: COLOR.navy };
  return TONES[key] || TONES[HUB_DEFAULT_TONES[groupIndex % HUB_DEFAULT_TONES.length]];
}

type HubNode = { title: string; resolvedIcon?: string; group: number };

function hubSides(hub: NonNullable<SlideInput["hub"]>) {
  const every = (hub.groups || []).filter(Boolean);
  const groups = every.slice(0, 2);
  const titledIn = (g: (typeof every)[number] | undefined) => ((g && g.items) || [])
    .map((it) => ({ title: String((it && it.title) || "").trim(), resolvedIcon: it && it.resolvedIcon }))
    .filter((n) => n.title);
  const nodesOf = (gi: number): HubNode[] => titledIn(groups[gi]).map((n) => ({ ...n, group: gi }));
  // A THIRD GROUP is not drawn — two sides, two kinds — but it used to vanish
  // without a word: the admission counted only what survived the slice, so a
  // hub of three groups of two drew four nodes and claimed nothing was missing.
  // Its connections are counted in, and the group is named to the model.
  const beyond = every.slice(2)
    .map((g) => ({ name: String((g && g.name) || "").trim(), count: titledIn(g).length }))
    .filter((g) => g.count > 0);
  const extra = beyond.reduce((m, g) => m + g.count, 0);
  const g0 = nodesOf(0);
  const g1 = groups.length > 1 ? nodesOf(1) : [];
  let left: HubNode[];
  let right: HubNode[];
  if (g0.length && g1.length) {
    left = g0; right = g1;
  } else {
    const one = g0.length ? g0 : g1;
    const half = Math.ceil(one.length / 2);
    left = one.slice(0, half); right = one.slice(half);
  }
  const total = left.length + right.length + extra;
  // What a FULL SIDE cuts is named too. The admission counted it, but nothing
  // told the model which ones: "A8 Tickets" is under droppedContent's
  // eleven-character floor, so a hub reading "Showing 14 of 16 connections"
  // went out with an empty warning and a model describing sixteen.
  const cut = left.slice(HUB_MAX_PER_SIDE).concat(right.slice(HUB_MAX_PER_SIDE)).map((n) => n.title);
  left = left.slice(0, HUB_MAX_PER_SIDE);
  right = right.slice(0, HUB_MAX_PER_SIDE);
  return { groups, left, right, dropped: total - left.length - right.length, beyond, cut };
}

/** Greedy word wrap against a measure, for the few boxes that are sized from
 *  the lines they will draw rather than from a count of characters. A word
 *  wider than the measure is left on a line of its own, where it overflows —
 *  the caller's fit test is what refuses that. */
function wrapWords(text: string, width: number, measure: (line: string) => number): string[] {
  const words = drawnText(text).split(/\s+/).filter(Boolean);
  const lines: string[] = [];
  let line = "";
  for (const w of words) {
    const next = line ? `${line} ${w}` : w;
    if (line && measure(next) > width) { lines.push(line); line = w; } else line = next;
  }
  if (line) lines.push(line);
  return lines;
}

function hubRequests(
  page: string, id: (s: string) => string,
  hub: NonNullable<SlideInput["hub"]>, top: number, room: number,
  /** What the diagram could not do, one clause each, for deckWarnings to
   *  relay. The slide itself says what it can (the admission line); a name
   *  too long for its circle is only fixable by the author. */
  notes?: string[]
): { requests: Req[]; bottom: number } {
  const { groups, left, right, dropped, beyond, cut } = hubSides(hub);
  const title = String(hub.title || "").replace(/[{}]/g, "").trim();
  const caption = String(hub.caption || "").trim();
  const out: Req[] = [];
  const note = (s: string) => { if (notes) notes.push(s); };
  for (const g of beyond) {
    note(`a hub draws two groups — ${g.name ? `"${g.name}"` : "a third group"} and its ${g.count} connection${g.count === 1 ? "" : "s"}` +
      ` were left off; merge them into one of the two groups, or give them a hub slide of their own`);
  }
  if (cut.length) {
    note(`a hub side draws ${HUB_MAX_PER_SIDE} connections — ${cut.slice(0, 3).map(quoteClip).join(", ")}` +
      `${cut.length > 3 ? ` and ${cut.length - 3} more` : ""} ${cut.length === 1 ? "was" : "were"} left off; merge the smallest, or split the hub across two slides`);
  }
  if (!left.length && !right.length && !title && !caption) return { requests: out, bottom: top };
  const HALO = 24;          // two lavender rings round the hub, 12pt apart
  const LABEL_H = 16;       // a group's caps label above its column
  const ICON = 13, PAD = 9, ICON_GAP = 7, CURVE = 22, DOT = 6, MIN_WIRE = 14;
  const ADMISSION_H = 18;
  const cx = GRID.margin + GRID.contentWidth / 2;
  const nameOf = (gi: number) => String((groups[gi] && groups[gi].name) || "").trim();
  // ONE GROUP SPLIT ACROSS BOTH SIDES is named once, centred over the hub. It
  // used to be named over the left column only, and the identical column on
  // the right then read as a second, unnamed KIND — which is exactly what the
  // two sides are drawn to mean — with a lone odd node looking orphaned.
  const split = left.length > 0 && right.length > 0 && right[0].group === left[0].group;
  const leftLabel = left.length && !split ? nameOf(left[0].group) : "";
  const rightLabel = right.length && !split ? nameOf(right[0].group) : "";
  const centreLabel = split ? nameOf(left[0].group) : "";
  const labelH = leftLabel || rightLabel || centreLabel ? LABEL_H : 0;
  const avail = Math.max(40, room - (dropped > 0 ? ADMISSION_H : 0) - labelH);
  const maxN = Math.max(left.length, right.length, 1);

  // Pitch: a 26pt node with up to 12pt between. The gap gives way first, to
  // 4pt, then the node, to 20pt — one 9pt line and its inset. Only a COLUMN
  // shrinks, and a node never grows: with one node a side there is no gap, so
  // "the gap is under 4pt" was always true, and the node was handed the whole
  // diagram's height — a 254pt slab from under the title to the footer, on a
  // hub of one or two connections, which is an ordinary hub.
  let nodeH = 26;
  let gap = maxN > 1 ? Math.min(12, (avail - maxN * nodeH) / (maxN - 1)) : 0;
  if (maxN > 1 && gap < 4) {
    nodeH = Math.min(26, Math.max(20, Math.floor((avail - 4 * (maxN - 1)) / maxN)));
    gap = Math.max(0, Math.min(12, (avail - maxN * nodeH) / (maxN - 1)));
  }
  const span = maxN * nodeH + (maxN - 1) * gap;
  // Centred in the room, like every self-contained block (GRID.bandHeight).
  const cy = top + labelH + avail / 2;
  const R = Math.max(28, Math.min(62, avail / 2 - HALO));

  const all = left.concat(right);
  const anyIcon = all.some((n) => !!n.resolvedIcon);
  const fixed = PAD * 2 + (anyIcon ? ICON + ICON_GAP : 0);
  // THE WIDEST LABEL, MEASURED — not the longest one at a mean advance. Sized
  // at 0.55em a character, the node gave its longest label exactly its own
  // length in room and no slack, so any label with more capitals than average
  // wrapped inside a 26pt node. "HubSpot CRM + MS Teams" needs 116pt and was
  // given 109. Width is linear in size, so the widest at 9pt is the widest at
  // every size, and the size it fits at is one division.
  const widestTitle = all.reduce((m, n) => (labelWidthPt(n.title, 9) > labelWidthPt(m, 9) ? n.title : m), "");
  const widest = Math.max(1, labelWidthPt(widestTitle, 9));
  // From the hub's outer ring to the margin: node, arc and the shortest wire.
  const sideRoom = cx - GRID.margin - (R + HALO);
  const nodeW = Math.max(Math.min(120, sideRoom - MIN_WIRE),
    Math.min(196, sideRoom - MIN_WIRE, fixed + widest));
  const labelSize = Math.max(7.5, Math.min(9, Math.floor(((nodeW - fixed) / (widest / 9)) * 2 + 1e-9) / 2));
  if (widestTitle && labelWidthPt(widestTitle, labelSize) > nodeW - fixed + 0.01) {
    note(`"${widestTitle}" is too long to hold one line in its node even at ${labelSize}pt — name each connection in two or three words`);
  }
  const curve = Math.max(0, Math.min(CURVE, sideRoom - nodeW - MIN_WIRE));
  const reach = sideRoom - nodeW - curve;    // hub ring to the nearest node edge

  type Placed = { n: HubNode; yc: number; inner: number; x: number; key: string };
  const place = (nodes: HubNode[], dir: number, side: string): Placed[] => nodes.map((n, i) => {
    // A shorter column is centred on the taller one's pitch.
    const yc = cy - span / 2 + ((maxN - nodes.length) * (nodeH + gap)) / 2 + i * (nodeH + gap) + nodeH / 2;
    const half = span / 2 - nodeH / 2;
    const t = half > 0 ? Math.max(-1, Math.min(1, (yc - cy) / half)) : 0;
    // TWO CLEAN COLUMNS, and the WIRES do the fanning. The pills used to be
    // pushed out along an arc — the middle one furthest from the hub — so
    // neither their outer edges nor their inner ones lined up, and with three
    // to a side an arc of that depth does not read as an arc, it reads as
    // three pills nobody aligned. Their outer edges are the page's own margins
    // now; the connectors still fan, which is where the movement belongs.
    void t;
    const inner = cx + dir * (R + HALO + reach + curve);
    return { n, yc, inner, x: dir < 0 ? inner - nodeW : inner, key: `${side}${i}` };
  });
  const placed = place(left, -1, "l").concat(place(right, 1, "r"));

  // Rings, then wires, then the hub on top, so every wire runs in under the
  // hub's edge instead of stopping short of it.
  out.push(
    ...filledShape(id("hbo"), page, "ELLIPSE", COLOR.lav, {
      x: cx - R - HALO, y: cy - R - HALO, width: 2 * (R + HALO), height: 2 * (R + HALO),
    }, 0.45),
    ...filledShape(id("hbi"), page, "ELLIPSE", COLOR.lav, {
      x: cx - R - HALO / 2, y: cy - R - HALO / 2, width: 2 * R + HALO, height: 2 * R + HALO,
    }),
  );
  for (const p of placed) {
    const tone = hubTone(groups[p.n.group] && groups[p.n.group].tone, p.n.group);
    const a = Math.atan2(p.yc - cy, p.inner - cx);
    out.push(...segment(id(`hw${p.key}`), page, tone.ink, p.inner, p.yc,
      cx + (R - 2) * Math.cos(a), cy + (R - 2) * Math.sin(a), 1.25, 0.6));
  }
  out.push(...filledShape(id("hbc"), page, "ELLIPSE", COLOR.navy, { x: cx - R, y: cy - R, width: 2 * R, height: 2 * R }));

  if (title || caption) {
    // THE CENTRE IS A CIRCLE, not a box. The title and caption were sized by
    // clamping character counts to two and three lines, and nothing asked
    // whether the lines fitted the disc: "Enterprise Knowledge Platform" over a
    // long caption drew three title lines in a box sized for two, the caption
    // printed across the third, and its last lines ran off the navy where white
    // type is invisible. So the lines are wrapped at WORDS, each line is held
    // to the circle's width at its own depth, and the title takes the largest
    // size at which it holds two lines — it used to shrink to 11pt trying for
    // one, and then wrap anyway, two points above the labels round it.
    const innerW = 2 * R * 0.8;
    const CAP_SIZE = 7.5, TITLE_LEAD = 1.26 * 1.0, CAP_LEAD = 1.26 * 1.1;
    const capGap = 2 - TEXT_INSET_Y / 2;     // the boxes share an inset, never ink
    const titleW = (line: string, size: number) => labelWidthPt(line, size, { face: "Playfair Display" });
    const capW = (line: string) => labelWidthPt(line, CAP_SIZE);   // Light measured as bold: wider, never narrower
    // Holds a line of this width and height, starting at `yTop`, inside the
    // disc — 92% of the chord at the line's far edge, so ink never meets it.
    const clears = (w: number, yTop: number, h: number) => {
      const dy = Math.max(Math.abs(yTop - cy), Math.abs(yTop + h - cy));
      return dy < R && w <= 2 * Math.sqrt(R * R - dy * dy) * 0.92;
    };
    const centre = (size: number, withCaption: boolean) => {
      const tLines = title ? wrapWords(title, innerW, (l) => titleW(l, size)) : [];
      const cLines = withCaption && caption ? wrapWords(caption, innerW, capW) : [];
      const tH = drawnTextHeight(tLines.length, size, 0, 1, 1.0);
      const capH = drawnTextHeight(cLines.length, CAP_SIZE, 0, 1, 1.1);
      // The gap sits BETWEEN the two blocks: a caption with no name over it is
      // centred on its own.
      const gapH = tLines.length && cLines.length ? capGap : 0;
      const y0 = cy - (tH + gapH + capH) / 2;
      let fits = tLines.length <= 2 && cLines.length <= 3;
      for (let i = 0; i < tLines.length; i++) {
        if (!clears(titleW(tLines[i], size), y0 + TEXT_INSET_Y / 2 + i * size * TITLE_LEAD, size * TITLE_LEAD)) fits = false;
      }
      for (let i = 0; i < cLines.length; i++) {
        if (!clears(capW(cLines[i]), y0 + tH + gapH + TEXT_INSET_Y / 2 + i * CAP_SIZE * CAP_LEAD, CAP_SIZE * CAP_LEAD)) fits = false;
      }
      return { size, tLines, cLines, tH, capH, gapH, y0, fits };
    };
    let plan = centre(18, false);
    for (let size = 17; size >= 12 && !plan.fits; size--) plan = centre(size, false);
    // A NAME THAT ALMOST FITS ONE LINE GETS ONE LINE. "The answer" measures
    // 99.7pt against a 99.2pt chord at 18pt — half a point over — and was set
    // as "The / answer" in the middle of the disc because two lines "fit" and
    // the ladder stopped there. Chasing one line all the way to the floor is
    // what the ladder was written to avoid, and this does not: two points is
    // the whole search, and below that a two-line name is genuinely a two-line
    // name.
    for (let size = plan.size - 1; plan.fits && plan.tLines.length > 1 && size >= plan.size - 2 && size >= 12; size--) {
      const tighter = centre(size, false);
      if (tighter.fits && tighter.tLines.length === 1) { plan = tighter; break; }
    }
    // TOO MANY WORDS AND ONE WORD TOO WIDE are different failures. A name
    // that needs three lines at 12pt is the author's to shorten, and shrinking
    // it further only makes a paragraph smaller. A name that holds two lines
    // but still fails has a word wider than the disc — "Datenschutzbeauftragter"
    // at 12pt ran 23pt past the navy onto the lavender ring, white on pale,
    // under a note calling it "1 line" as if it were short — and that one can
    // give up a few more points and stay inside.
    const tooMany = !plan.fits && plan.tLines.length > 2;
    for (let size = 11; size >= 9 && !plan.fits && !tooMany; size--) plan = centre(size, false);
    if (title && !plan.fits) {
      // Drawn at the floor with the height it really takes, never clamped to a
      // box it overflows, and said: only the author can shorten a name.
      const widestWord = title.split(/\s+/).reduce((m, w) => (titleW(w, plan.size) > titleW(m, plan.size) ? w : m), "");
      note(tooMany
        ? `the hub's name "${title}" is too long for the circle — ${plan.tLines.length} lines at 12pt;` +
          ` hub.title is one to three short words, and the claim belongs in the slide title`
        : `the hub's name "${title}" is too wide for the circle even at ${plan.size}pt — "${widestWord}" alone is wider than the circle;` +
          ` name it in shorter words`);
    } else if (title && plan.size < 12) {
      note(`the hub's name "${title}" is drawn at ${plan.size}pt, smaller than the connections round it, because one of its words is wider than the circle at 12pt — a shorter name reads better`);
    }
    if (plan.fits && caption) {
      // The caption may cost the title some size, down to the floor. A
      // caption that fits at no size is NOT DRAWN — half a sentence on navy is
      // worse than none — and the note below says so.
      for (let size = plan.size; size >= Math.min(12, plan.size); size--) {
        const withCaption = centre(size, true);
        if (withCaption.fits) { plan = withCaption; break; }
      }
    }
    // DRAWN AS IT WAS WRAPPED. The lines above are measured with this file's
    // own ruler and the box is sized from them, but the TEXT went to the
    // renderer whole and was re-wrapped by its metrics — so "The answer",
    // measured at 99.7pt against a 99.2pt chord, was given a two-line box and
    // drawn on one line inside it, and the caption under it sat a whole line
    // low with 44pt of navy between them. Sending the lines is what makes the
    // measure authoritative in both renderers. contentKey folds a newline to a
    // space, so the audit still matches the field it came from.
    if (plan.tLines.length) {
      out.push(...textBox(id("hbt"), page, plan.tLines.join("\n"), { font: "Playfair Display", size: plan.size, color: COLOR.white }, {
        x: cx - innerW / 2 - TEXT_INSET_X / 2, y: plan.y0, width: innerW + TEXT_INSET_X, height: plan.tH,
      }, { align: "CENTER", lineSpacing: 1.0, spaceBelow: 0 }));
    }
    if (plan.cLines.length) {
      out.push(...textBox(id("hbs"), page, plan.cLines.join("\n"), { font: "Roboto", size: CAP_SIZE, weight: 300, color: COLOR.greyLight }, {
        x: cx - innerW / 2 - TEXT_INSET_X / 2, y: plan.y0 + plan.tH + plan.gapH, width: innerW + TEXT_INSET_X, height: plan.capH,
      }, { align: "CENTER", lineSpacing: 1.1, spaceBelow: 0 }));
    }
    // A caption left off is named with ITS OWN fix. droppedContent's generic
    // advice — "put it in a field this layout uses" — was the only word about
    // it, and it is already in the field the layout uses; what it needs is to
    // be shorter. droppedContent leaves text a note quotes to that note.
    if (caption && !plan.cLines.length) {
      note(`the hub's caption ${quoteClip(caption)} was not drawn — it does not fit in the circle${title ? " under the name" : ""};` +
        ` keep hub.caption under about 60 characters`);
    }
  }
  // AN EMPTY CENTRE IS SAID. hub.title is only copied from the slide's title
  // when that is a name (three words or fewer), so the incident's own call — a
  // real headline, the caption and groups beside it — built with a navy circle
  // holding nothing, and the one note the model got told it to move a caption
  // that was already where it belonged. What is missing is the name.
  if (!title && (left.length || right.length)) {
    note(`the hub has no centre name, so its circle ${out.some((r: any) => r.createShape && r.createShape.objectId === id("hbs")) ? "carries only the caption" : "is empty"}` +
      ` — give hub.title the short name of the thing in the middle, one to three words; the slide's own title stays the headline`);
  }

  for (const p of placed) {
    const tone = hubTone(groups[p.n.group] && groups[p.n.group].tone, p.n.group);
    const y = p.yc - nodeH / 2;
    out.push(
      ...filledShape(id(`hn${p.key}`), page, "ROUND_RECTANGLE", tone.tint, { x: p.x, y, width: nodeW, height: nodeH }),
      // The port: where the wire meets the node.
      ...filledShape(id(`hd${p.key}`), page, "ELLIPSE", tone.ink, {
        x: p.inner - DOT / 2, y: p.yc - DOT / 2, width: DOT, height: DOT,
      }),
    );
    if (p.n.resolvedIcon) {
      out.push({
        createImage: {
          objectId: id(`hi${p.key}`), url: p.n.resolvedIcon,
          elementProperties: {
            pageObjectId: page,
            size: { width: pt(ICON), height: pt(ICON) },
            transform: { scaleX: 1, scaleY: 1, translateX: p.x + PAD, translateY: p.yc - ICON / 2, unit: "PT" },
          },
        },
      });
    } else if (anyIcon) {
      // A STAND-IN, NOT A GAP. The icon slot is reserved on every node once
      // any node has an icon, so the labels line up; a name Lucide does not
      // carry ("microsoft", "xero" — brand names are what a hub invites) left
      // that slot empty and its label visibly indented beside its neighbours.
      // A small dot in the group's ink holds the column. Same `hi` key, so one
      // mark per node however the icons resolved.
      const DOT_IN = 5;
      out.push(...filledShape(id(`hi${p.key}`), page, "ELLIPSE", tone.ink, {
        x: p.x + PAD + (ICON - DOT_IN) / 2, y: p.yc - DOT_IN / 2, width: DOT_IN, height: DOT_IN,
      }));
    }
    const tx = p.x + PAD + (anyIcon ? ICON + ICON_GAP : 0);
    out.push(...textBox(id(`ht${p.key}`), page, p.n.title,
      { font: "Roboto", size: labelSize, weight: 600, color: COLOR.navy }, {
      x: tx - TEXT_INSET_X / 2, y, width: p.x + nodeW - PAD - tx + TEXT_INSET_X, height: nodeH,
    }, { vCenter: true, lineSpacing: 1.0, spaceBelow: 0 }));
  }

  // GROUP LABELS ARE MEASURED. They were drawn bold caps in a 14pt box the
  // width of a node and never measured, and nothing caps a group name's
  // length: "Engine company data sources and systems" is 197pt of capitals in
  // 120pt, so it wrapped and its second line ran down into the first node. A
  // label steps down to 7pt inside its natural width, then widens into the
  // clear row beside it; if nothing fits, it is said.
  const LABEL_SIZES = [8, 7.5, 7], LABEL_CLEAR = 4;
  const fitLabel = (text: string, widths: number[]) => {
    for (const w of widths) {
      for (const s of LABEL_SIZES) if (labelWidthPt(text, s, { caps: true }) <= w + 0.01) return { size: s, width: w, fits: true };
    }
    return { size: LABEL_SIZES[LABEL_SIZES.length - 1], width: widths[widths.length - 1], fits: false };
  };
  // What a label row between y0 and y1 would run into, as x-spans: a node, a
  // wire, the rings.
  const blockedIn = (y0: number, y1: number): [number, number][] => {
    const spans: [number, number][] = [];
    for (const p of placed) {
      if (p.yc + nodeH / 2 > y0 && p.yc - nodeH / 2 < y1) spans.push([p.x, p.x + nodeW]);
      const a = Math.atan2(p.yc - cy, p.inner - cx);
      const ex = cx + (R - 2) * Math.cos(a), ey = cy + (R - 2) * Math.sin(a);
      const lo = Math.max(y0, Math.min(p.yc, ey)), hi = Math.min(y1, Math.max(p.yc, ey));
      if (lo > hi) continue;
      const xAt = (y: number) => (Math.abs(ey - p.yc) < 1e-6 ? p.inner : p.inner + ((y - p.yc) / (ey - p.yc)) * (ex - p.inner));
      spans.push(Math.abs(ey - p.yc) < 1e-6 ? [Math.min(p.inner, ex), Math.max(p.inner, ex)] : [Math.min(xAt(lo), xAt(hi)), Math.max(xAt(lo), xAt(hi))]);
    }
    const ring = R + HALO;
    const dy = y1 < cy ? cy - y1 : y0 > cy ? y0 - cy : 0;
    if (dy < ring) { const half = Math.sqrt(ring * ring - dy * dy); spans.push([cx - half, cx + half]); }
    return spans;
  };
  const tooLong = (text: string) =>
    note(`the group name "${text}" is too long for its label even at 7pt — a group name is two or three words`);
  const firstOf = (side: string) => placed.find((p) => p.key === `${side}0`);
  const labelFor = (side: "l" | "r", text: string) => {
    const p = firstOf(side);
    if (!p || !text) return;
    const tone = hubTone(groups[p.n.group] && groups[p.n.group].tone, p.n.group);
    const y = p.yc - nodeH / 2 - LABEL_H;
    const row = blockedIn(y, y + LABEL_H - 2);
    // Widening runs toward the hub, from the column's outer edge to the first
    // thing in the row.
    const room = side === "l"
      ? row.reduce((m, s) => (s[0] > p.x + 0.5 ? Math.min(m, s[0]) : m), GRID.margin + GRID.contentWidth) - LABEL_CLEAR - p.x
      : p.x + nodeW - LABEL_CLEAR - row.reduce((m, s) => (s[1] < p.x + nodeW - 0.5 ? Math.max(m, s[1]) : m), GRID.margin);
    const fit = fitLabel(text, [nodeW, Math.max(nodeW, room)]);
    if (!fit.fits) tooLong(text);
    out.push(...textBox(id(`hg${side}`), page, text, { font: "Roboto", size: fit.size, bold: true, color: tone.ink, caps: true }, {
      x: (side === "l" ? p.x : p.x + nodeW - fit.width) - TEXT_INSET_X / 2, y, width: fit.width + TEXT_INSET_X, height: LABEL_H - 2,
    }, { align: side === "l" ? "START" : "END", lineSpacing: 1.0, spaceBelow: 0 }));
  };
  labelFor("l", leftLabel);
  labelFor("r", rightLabel);
  if (centreLabel) {
    const p = firstOf("l")!;
    const tone = hubTone(groups[p.n.group] && groups[p.n.group].tone, p.n.group);
    // Above the rings, in the row the label reservation already keeps: R is
    // at most half the room less the halo, so the halo's top clears it.
    const y = cy - R - HALO - LABEL_H;
    const half = blockedIn(y, y + LABEL_H - 2)
      .reduce((m, s) => Math.min(m, s[0] > cx ? s[0] - cx : s[1] < cx ? cx - s[1] : 0), GRID.contentWidth / 2) - LABEL_CLEAR;
    const fit = fitLabel(centreLabel, [2 * Math.max(0, half)]);
    if (!fit.fits) tooLong(centreLabel);
    // Hugs its words, like every label, so it reads as a label and not a rule.
    const w = Math.min(fit.width, labelWidthPt(centreLabel, fit.size, { caps: true }) + 4);
    out.push(...textBox(id("hgc"), page, centreLabel, { font: "Roboto", size: fit.size, bold: true, color: tone.ink, caps: true }, {
      x: cx - w / 2 - TEXT_INSET_X / 2, y, width: w + TEXT_INSET_X, height: LABEL_H - 2,
    }, { align: "CENTER", lineSpacing: 1.0, spaceBelow: 0 }));
  }

  let bottom = Math.max(cy + span / 2, cy + R + HALO);
  if (dropped > 0) {
    // Said on the slide, in the slot the other diagrams use.
    const shown = left.length + right.length;
    const text = `Showing ${shown} of ${shown + dropped} connections`;
    const w = Math.min(GRID.contentWidth, text.length * 7.5 * PER_CHAR + TEXT_INSET_X + 4);
    out.push(...textBox(id("hdrop"), page, text, { font: "Roboto", size: 7.5, weight: 300, color: COLOR.ink }, {
      x: GRID.margin + GRID.contentWidth - w, y: bottom + 2, width: w, height: ADMISSION_H - 2,
    }, { align: "END", lineSpacing: 1.0 }));
    bottom += ADMISSION_H;
  }
  return { requests: out, bottom };
}

/** A pull quote, set large on navy with the speaker beneath.
 *
 *  Their deck names people — a Chief Sustainability Officer, a former CEO — and
 *  had nowhere to put them; a testimonial buried in body copy is not a
 *  testimonial. The change of ground is what makes this land as a moment
 *  rather than as another content slide. */
function quoteRequests(
  page: string, id: (s: string) => string, q: NonNullable<SlideInput["quote"]>
): Req[] {
  // A quote is set to FIT rather than split or overflow.
  //
  // Splitting is wrong here — half a testimonial on each of two slides is not
  // two slides — and overflowing runs the last line straight through the
  // speaker's name, which is the one thing on the slide that has to stay
  // legible. So the type comes down instead, and only as far as it must: a
  // 180-character quote is untouched at 22pt.
  const textWidth = q.resolvedImage ? QUOTE.textWidth - 2.1 * 72 : QUOTE.textWidth;
  const CHAR_RATIO = 0.5;   // Playfair's average glyph, as a fraction of its size
  const LINE = 1.15;
  let quoteSize = TYPE.quoteText.size;
  while (quoteSize > 13) {
    const perLine = Math.max(12, Math.floor(textWidth / (quoteSize * CHAR_RATIO)));
    const lines = Math.ceil((q.text?.length || 0) / perLine);
    if (lines * quoteSize * LINE <= QUOTE.textHeight) break;
    quoteSize -= 1;
  }

  const out: Req[] = [
    ...textBox(id("qm"), page, "“", TYPE.quoteMark, {
      x: QUOTE.markX, y: QUOTE.markY, width: QUOTE.markWidth, height: QUOTE.markHeight,
    }),
    ...textBox(id("qt"), page, q.text, { ...TYPE.quoteText, size: quoteSize }, {
      x: QUOTE.textX, y: QUOTE.textY,
      width: textWidth,
      height: QUOTE.textHeight,
    }),
    ...textBox(id("qn"), page, q.name, TYPE.quoteName, {
      x: QUOTE.textX, y: QUOTE.attributionY, width: QUOTE.textWidth, height: QUOTE.attributionHeight,
    }),
    ...textBox(id("qr"), page, q.role, TYPE.quoteRole, {
      x: QUOTE.textX, y: QUOTE.roleY, width: QUOTE.textWidth, height: QUOTE.roleHeight,
    }),
  ];
  if (q.resolvedImage?.url) {
    out.push({
      createImage: {
        objectId: id("qp"), url: q.resolvedImage.url,
        elementProperties: {
          pageObjectId: page,
          size: { width: pt(QUOTE.portrait.size), height: pt(QUOTE.portrait.size) },
          transform: { scaleX: 1, scaleY: 1, translateX: QUOTE.portrait.x, translateY: QUOTE.portrait.y, unit: "PT" },
        },
      },
    });
  }
  return out;
}

/** Numbered step cards carried left to right by arrows.
 *
 *  Each stage is a CARD: a coloured numeral circle, a bold name, the
 *  description, and an "Owner: ..." line anchored to the card's foot. Drawn
 *  rather than bulleted because a process has direction; drawn as cards
 *  rather than pills because the pill was the loudest element on the slide
 *  and carried the least information - 58pt of blue around a 9pt caps label,
 *  the description that mattered set small and centred beneath it, and the
 *  owner run into its last sentence. The presenter could not say "step
 *  three" and point at a 3, and the client's team could not find who owns
 *  what without reading every card to its end.
 *
 *  Cards hug their words: the row is as tall as its tallest card, starts on
 *  the band's top edge, and reports where it ends so the takeaway bar
 *  follows it instead of pinning to the foot of the band. */
/** Five stages fill the width; a sixth would be a 100pt card with a two-word
 *  caption. Bounded, and said out loud rather than quietly trimmed. */
const MAX_STAGES = 5;

/** One accent per step, cycled; the circle and the card's top rule share it.
 *  Every one of these carries WHITE at 4.5:1 or better (blue 5.5, teal 6.2,
 *  amber 6.7, coral 6.9, navy 13). The brand periwinkle that the reference's
 *  purple suggests is 3.0:1 under white and is left out for that reason.
 *  textOn() still decides the numeral's ink, so a palette edit cannot quietly
 *  put white on a ground that will not hold it. */
const STEP_ACCENTS = [COLOR.blue, COLOR.inkTeal, COLOR.inkAmber, COLOR.inkCoral, COLOR.navy];

/** A TRAILING "Owner: TCE + your team" clause on a caption, split off into
 *  the owner slot. The reference sets ownership as its own line at the
 *  card's foot; the schema had nowhere to put it, so the model ran it into
 *  the description's last sentence. An explicit `owner` wins, and the clause
 *  is removed from the caption either way so nothing is drawn twice. Only a
 *  trailing clause is read: "owner:" mid-sentence is prose. Exported so the
 *  layout check can ask it directly. */
const OWNER_CLAUSE = /(?:^|\s)\(?owner\s*:\s*([^\n]+?)\)?\s*$/i;
export function splitStageOwner(caption: string, explicit?: string): { caption: string; owner: string } {
  let text = (caption || "").trim();
  let owner = (explicit || "").trim();
  const m = OWNER_CLAUSE.exec(text);
  if (m) {
    if (!owner) owner = m[1].trim().replace(/[.\s]+$/, "");
    text = text.slice(0, m.index).trim().replace(/[,;:\-]+$/, "").trim();
  }
  return { caption: text, owner };
}

function processRequests(
  page: string, id: (s: string) => string, stages: NonNullable<SlideInput["stages"]>,
  top: number = GRID.bodyY, room: number = GRID.bandHeight, meta?: { bottom: number }
): Req[] {
  const stageName = (st: any) => String(st?.name ?? st?.title ?? "").trim();
  // `text` IS A SYNONYM, and it is the word a model reaches for first. The
  // schema says `caption`, the renderer also read `body`, and neither is what
  // anyone writes beside a `title`: a stage written as { title, text } drew its
  // name and silently dropped its sentence. droppedContent reported it, which
  // is why the loss was never invisible — but a field that has to be reported
  // is a field the renderer should have read.
  const stageCaption = (st: any) => String(st?.caption ?? st?.body ?? st?.text ?? "").trim();
  const shown = stages.filter((st) => st && stageName(st)).slice(0, MAX_STAGES);
  if (!shown.length) return [];
  const n = shown.length;
  const gaps = n - 1;
  const P = PROCESS;
  const boxW = (GRID.contentWidth - gaps * P.connectorWidth) / n;
  const parts = shown.map((st: any) => {
    const split = splitStageOwner(stageCaption(st), st?.owner);
    return { name: stageName(st), caption: split.caption, owner: split.owner };
  });
  let anyOwner = false;
  for (let i = 0; i < parts.length; i++) if (parts[i].owner) anyOwner = true;

  // The numeral BESIDE the name in four cards or fewer; ABOVE it in five,
  // where a 115pt card cannot spare a third of its measure and
  // "Commissioning" would break mid-word beside its circle. The same rule as
  // the cards layout's inline chips.
  const beside = n <= 4;
  // Wide enough for one bold digit ON ONE LINE, inset included - pillWidth's
  // arithmetic without its capsule padding. An 18pt box holds 3.6pt of glyph
  // room once Slides' 14.4pt inset is paid, and a bold digit is 5.6.
  const numeralW = Math.ceil(TEXT_INSET_X + TYPE.stageNumeral.size * PER_CHAR * CAPS_WIDEN);
  const nameX = beside ? P.pad + P.numeral / 2 + numeralW / 2 : P.pad;
  const nameW = boxW - nameX - P.pad;
  const descW = boxW - P.pad * 2;
  const ownerH = anyOwner ? drawnTextHeight(1, TYPE.stageOwner.size) : 0;

  const nameHs = parts.map((p) =>
    drawnTextHeight(estimateLines(p.name, nameW, TYPE.stageName.size), TYPE.stageName.size));
  // ONE head block for the row, so every description starts on one line:
  // the slack falls under a short name, not above its description.
  let tallestName = 0;
  for (let i = 0; i < nameHs.length; i++) tallestName = Math.max(tallestName, nameHs[i]);
  const headH = beside ? Math.max(P.numeral, tallestName) : P.numeral + P.numeralGap + tallestName;
  const descTop = top + P.pad + headH + P.headGap;

  // A FIT LADDER for the description: the reference's 8pt at 1.3, then 8pt
  // at 1.15. The name and the owner never step - 10.5 is the reference's
  // size and 7.5 is this deck's floor.
  const PLANS: { size: number; lead: number }[] = [{ size: 8, lead: 1.3 }, { size: 8, lead: 1.15 }];
  const measure = (plan: { size: number; lead: number }) => {
    const descHs = parts.map((p) => p.caption
      ? drawnTextHeight(estimateLines(p.caption, descW, plan.size), plan.size, 4, 1, plan.lead)
      : 0);
    let tallest = 0;
    for (let i = 0; i < descHs.length; i++) tallest = Math.max(tallest, descHs[i]);
    // A ROW WITH NO CAPTIONS KEEPS NO ROOM FOR ONE. Rendering a process slide
    // whose stages carried only a name and an owner showed a hole between the
    // two: the card was paying `headGap` to reach a description band of zero
    // height and then `ownerGap` to leave it again — two gaps around nothing.
    // With no caption anywhere in the row the head is what the owner follows,
    // so it costs the one gap that follows a head.
    //
    // PER ROW, NOT PER CARD, deliberately. The owner sits on one baseline
    // across the row — the line the client's team scans for — so a card
    // without a caption beside cards with one keeps the band and the baseline.
    const capBand = tallest > 0 ? P.headGap + tallest + (anyOwner ? P.ownerGap : 0) : (anyOwner ? P.headGap : 0);
    const cardH = P.pad + headH + capBand + (anyOwner ? ownerH : 0) + P.padBottom;
    return { descHs, cardH: Math.max(P.minHeight, cardH) };
  };
  let plan = PLANS[0];
  let m = measure(plan);
  for (let k = 1; k < PLANS.length && m.cardH > room + 0.5; k++) { plan = PLANS[k]; m = measure(plan); }
  // Nothing fits whole: the card ends where the band does and the tightest
  // plan's text runs a little past its slot - visible in the preview, never
  // hidden under the bar. The same fallback cardsRequests makes.
  const cardH = Math.min(m.cardH, room);
  const cardBottom = top + cardH;
  const ownerTop = cardBottom - P.padBottom - ownerH;
  const midY = top + P.pad + P.numeral / 2;   // the numerals' centre line: where the arrows run

  const out: Req[] = [];
  for (let i = 0; i < n; i++) {
    const p = parts[i];
    const x = GRID.margin + i * (boxW + P.connectorWidth);
    const accent = STEP_ACCENTS[i % STEP_ACCENTS.length];
    const cx = x + P.pad + P.numeral / 2;
    out.push(
      ...filledShape(id(`pb${i}`), page, "ROUND_RECTANGLE", COLOR.tintGrey, {
        x, y: top, width: boxW, height: cardH,
      }),
      // The top rule, inset by 6 like a toned card's so it does not poke out
      // of the rounded corners; the reference runs it edge to edge on a
      // square card.
      ...filledShape(id(`pk${i}`), page, "RECTANGLE", accent, {
        x: x + 6, y: top, width: boxW - 12, height: P.accent,
      }),
      ...filledShape(id(`pn${i}`), page, "ELLIPSE", accent, {
        x: cx - P.numeral / 2, y: top + P.pad, width: P.numeral, height: P.numeral,
      }),
      // The digit's box is WIDER than its circle and centred on it: a text
      // box the circle's own size would leave the glyph 3.6pt of room. It is
      // transparent, so nothing shows but the digit.
      ...textBox(id(`pnt${i}`), page, String(i + 1), { ...TYPE.stageNumeral, color: textOn(accent) }, {
        x: cx - numeralW / 2, y: top + P.pad, width: numeralW, height: P.numeral,
      }, { align: "CENTER", vCenter: true, spaceBelow: 0 }),
      // Beside its circle and level with it: a one-line name shares the
      // circle's centre; a two-line name is centred in its own taller box, so
      // its first line sits ~2pt under the circle's centre and reads aligned.
      ...textBox(id(`ps${i}`), page, p.name, TYPE.stageName, {
        x: x + nameX,
        y: beside ? top + P.pad : top + P.pad + P.numeral + P.numeralGap,
        width: nameW,
        height: beside ? Math.max(P.numeral, nameHs[i]) : nameHs[i],
      }, beside ? { vCenter: true, spaceBelow: 0 } : { spaceBelow: 0 }),
    );
    if (p.caption) {
      out.push(...textBox(id(`pc${i}`), page, p.caption, { ...TYPE.stageCaption, size: plan.size }, {
        x: x + P.pad, y: descTop, width: descW,
        // Its measured height when the plan fits; what is left above the
        // owner slot when nothing did.
        height: Math.max(12, Math.min(m.descHs[i],
          (anyOwner ? ownerTop - P.ownerGap : cardBottom - P.padBottom) - descTop)),
      }, { lineSpacing: plan.lead, spaceBelow: 4 }));
    }
    if (p.owner) {
      // Anchored to the card's FOOT, on one baseline across the row - the
      // line the client's team scans for.
      out.push(...textBox(id(`po${i}`), page, `Owner: ${p.owner}`, TYPE.stageOwner, {
        x: x + P.pad, y: ownerTop, width: descW, height: ownerH,
      }, { spaceBelow: 0 }));
    }

    if (i < gaps) {
      const cxr = x + boxW;
      out.push(
        ...filledShape(id(`pr${i}`), page, "RECTANGLE", COLOR.periwinkle, {
          x: cxr + 3, y: midY - P.connectorThickness / 2,
          width: P.connectorWidth - 6 - P.chevron, height: P.connectorThickness,
        }),
        // RIGHT_ARROW, not TRIANGLE. Slides draws a triangle pointing UP, so
        // the first render had five arrowheads aimed at the ceiling on a
        // left-to-right process - correct geometry, wrong direction.
        ...filledShape(id(`pa${i}`), page, "RIGHT_ARROW", COLOR.periwinkle, {
          x: cxr + P.connectorWidth - 3 - P.chevron,
          y: midY - P.chevron / 2,
          width: P.chevron, height: P.chevron,
        }),
      );
    }
  }

  let bottom = cardBottom;
  if (stages.length > shown.length) {
    // UNDER THE CARDS, not at the foot of the page, where it sat underneath
    // the takeaway bar whenever the slide had one.
    out.push(...noteBox(
      id("sdrop"), page, `Showing the first ${shown.length} of ${stages.length} stages`,
      cardBottom + 2
    ));
    bottom = cardBottom + 18;
  }
  if (meta) meta.bottom = bottom;
  return out;
}

/** Client marks on a clean ground, fitted whole. */
function logoWallRequests(
  page: string, id: (s: string) => string,
  logos: NonNullable<SlideInput["logos"]>
): Req[] {
  // A client whose mark could not be found is still a client: their name is
  // set instead. Dropping the cell silently shortened the credibility slide,
  // and filling it with a stock photograph would have been worse.
  const shown = logos.filter((l) => l && (l.resolvedUrl || l.name?.trim())).slice(0, 12);
  if (!shown.length) return [];
  // THE ROWS ARE EVEN. Four across for anything over four put six marks on a
  // 4 + 2 grid with two holes at the bottom right, and a hole in a client wall
  // reads as a client who has been removed. The columns are chosen so the rows
  // are as equal as they can be — six become 3 x 2, seven 4 + 3.
  const n = shown.length;
  const maxCols = n <= 4 ? n : n <= 9 ? 4 : 6;
  let cols = maxCols;
  for (let c = maxCols; c >= 2; c--) {
    const r = Math.ceil(n / c);
    if (c * r === n) { cols = c; break; }
    if (n - (r - 1) * c >= c - 1) cols = c;      // the last row is nearly full
  }
  const rows = Math.ceil(n / cols);
  const cellW = (GRID.contentWidth - LOGO_WALL.gap * (cols - 1)) / cols;
  const markH = (LOGO_WALL.height - LOGO_WALL.gap * (rows - 1)) / rows - LOGO_WALL.nameHeight;
  const cellH = markH + LOGO_WALL.nameHeight;
  // The wall centres in the room it has, the way every other block of repeated
  // cells on this page does.
  const used = rows * cellH + LOGO_WALL.gap * (rows - 1);
  const top = LOGO_WALL.y + Math.max(0, (LOGO_WALL.height - used) / 2);

  return shown.flatMap((logo, i) => {
    const c = i % cols, r = Math.floor(i / cols);
    // A short last row is centred, like the card row and the picture grid.
    const inRow = Math.min(cols, n - r * cols);
    const rowW = inRow * cellW + (inRow - 1) * LOGO_WALL.gap;
    const cellX = GRID.margin + (GRID.contentWidth - rowW) / 2 + c * (cellW + LOGO_WALL.gap);
    const x = cellX + LOGO_WALL.inset;
    const y = top + r * (cellH + LOGO_WALL.gap) + LOGO_WALL.inset;
    const w = cellW - LOGO_WALL.inset * 2;
    // AND THE NAME IS DRAWN UNDER THE MARK. A wall of logos whose only job is
    // to say WHO these people are said nothing at all: six marks and not one
    // name on the page. A mark a reader does not recognise is a coloured shape,
    // and the ones worth putting on this slide are often exactly the ones a
    // room does not know yet.
    const name = (logo.name || "").trim();
    const out: Req[] = [];
    if (!logo.resolvedUrl) {
      out.push(...textBox(id(`lw${i}`), page, name, TYPE.logoWallName, {
        x, y, width: w, height: markH + LOGO_WALL.nameHeight - LOGO_WALL.inset * 2,
      }, { align: "CENTER", vCenter: true }));
      return out;
    }
    out.push({
      createImage: {
        objectId: id(`lw${i}`), url: logo.resolvedUrl!,
        elementProperties: {
          pageObjectId: page,
          size: { width: pt(w), height: pt(markH - LOGO_WALL.inset * 2) },
          transform: { scaleX: 1, scaleY: 1, translateX: x, translateY: y, unit: "PT" },
        },
      },
    });
    if (name) {
      out.push(...textBox(id(`lwn${i}`), page, name, TYPE.logoWallCaption, {
        x: cellX, y: y + markH - LOGO_WALL.inset, width: cellW, height: LOGO_WALL.nameHeight,
      }, { align: "CENTER" }));
    }
    return out;
  });
}

/** A scatter plot: two continuous axes, points placed by value and coloured by
 *  an optional named group. The correlation device — a shape a bar chart cannot
 *  show. Axes are scaled from the data (padded); labels are drawn only when the
 *  cloud is sparse enough not to become a thicket. */
function scatterRequests(
  page: string, id: (s: string) => string,
  sc: NonNullable<SlideInput["scatter"]>, onDark: boolean, bandTop: number, bandBottom?: number
): Req[] {
  const points = (sc.points || []).filter((p) => Number.isFinite(p.x) && Number.isFinite(p.y));
  if (points.length < 2) return [];
  const palette = onDark ? SERIES_DARK : SERIES_LIGHT;
  const groups = Array.from(new Set(points.map((p) => p.group).filter(Boolean))) as string[];
  const colourOf = (g?: string) => (g && groups.length ? palette[groups.indexOf(g) % palette.length] : palette[0]);

  const left = GRID.margin + 40;
  const right = GRID.margin + GRID.contentWidth - 8;
  const legendH = groups.length > 1 ? 20 : 0;
  const top = bandTop + 8;
  const bottom = floorBand(CANVAS.height - GRID.margin - 18 - legendH, bandBottom, 18 + legendH);
  const w = right - left, h = bottom - top;

  const xs = points.map((p) => p.x), ys = points.map((p) => p.y);
  const pad = (a: number[], lo: number, hi: number) => { const s = (hi - lo) * 0.08 || 1; return [lo - s, hi + s]; };
  const [xlo, xhi] = pad(xs, Math.min(...xs), Math.max(...xs));
  const [ylo, yhi] = pad(ys, Math.min(...ys), Math.max(...ys));
  const xAt = (v: number) => left + ((v - xlo) / (xhi - xlo || 1)) * w;
  const yAt = (v: number) => bottom - ((v - ylo) / (yhi - ylo || 1)) * h;

  const axisColor = onDark ? COLOR.periwinkle : COLOR.greyLight;
  const out: Req[] = [
    ...filledShape(id("sxa"), page, "RECTANGLE", axisColor, { x: left, y: bottom, width: w, height: CHART.axisThickness }),
    ...filledShape(id("sya"), page, "RECTANGLE", axisColor, { x: left, y: top, width: CHART.axisThickness, height: h }),
  ];
  // Axis labels.
  if (sc.xAxis) out.push(...textBox(id("sxl"), page, sc.xAxis, TYPE.axisEnd, { x: left, y: bottom + 3, width: w, height: 12 }, { align: "CENTER" }));
  if (sc.yAxis) out.push(...textBox(id("syl"), page, sc.yAxis, TYPE.axisEnd, { x: GRID.margin - 4, y: top - 16, width: 160, height: 12 }));

  // Points. Labels only when there are few, so the plot does not become a
  // thicket of overlapping text.
  const label = points.length <= 8;
  points.slice(0, 40).forEach((p, i) => {
    const cx = xAt(p.x), cy = yAt(p.y);
    const r = 4;
    out.push(...filledShape(id(`sd${i}`), page, "ELLIPSE", colourOf(p.group), { x: cx - r, y: cy - r, width: r * 2, height: r * 2 }));
    if (label && p.label) {
      const lw = Math.min(120, Math.max(30, p.label.length * 4.4 + 6));
      const lx = cx + r + 3 + lw > right ? cx - r - 3 - lw : cx + r + 3;
      out.push(...textBox(id(`sl${i}`), page, p.label, TYPE.dotLabel, { x: Math.max(left, lx), y: cy - 7, width: lw, height: 14 }, lx < cx ? { align: "END" } : {}));
    }
  });

  if (groups.length > 1) {
    let lx = left;
    const ly = bottom + 20;
    groups.forEach((g, si) => {
      const lw = Math.min(120, Math.max(34, g.length * 4.6 + 16));
      out.push(
        ...filledShape(id(`sk${si}`), page, "ELLIPSE", palette[si % palette.length], { x: lx, y: ly + 2, width: 8, height: 8 }),
        ...textBox(id(`sn${si}`), page, g, TYPE.chartAxis, { x: lx + 12, y: ly, width: lw, height: 14 }),
      );
      lx += 12 + lw + 10;
    });
  }
  return out;
}

/** "Name (gloss)", "Name - gloss", "Name – gloss", "Name: gloss" → the name and
 *  its descriptor. The reference labels every set as a bold caps name over a
 *  small gloss, and the model writes the pair with a dash or a colon as often
 *  as with brackets: the page this was measured against used dashes, and the
 *  bracket-only split drew all nine words as one Playfair name. */
export function splitVennLabel(text: string): { name: string; desc: string } {
  const t = (text || "").trim();
  const paren = /^(.*?)\s*\((.*)\)\s*$/.exec(t);
  if (paren) return { name: paren[1].trim(), desc: paren[2].trim() };
  const dash = /^(.+?)(?:\s+[-–—]\s+|\s*[–—]\s*|:\s+)(.+)$/.exec(t);
  if (dash) return { name: dash[1].trim(), desc: dash[2].trim() };
  return { name: t, desc: "" };
}

/** Lines a run of words needs at an ink width, wrapping greedily by WORD on the
 *  estimator's per-character advance. estimateLines wraps by character count,
 *  which is right for prose and wrong for a label: "YOUR CONTENT PLAN" is two
 *  lines by count and three by words in a 59pt lens, and Slides draws words.
 *  Returns undefined when one word alone is wider than the box — Slides cannot
 *  break it, so the label does not fit whatever the count says. */
export function wrapLines(text: string, inkWidth: number, size: number, caps = false): number | undefined {
  const cw = size * PER_CHAR * (caps ? CAPS_WIDEN : 1);
  const paras = (text || "").trim().split("\n");
  let lines = 0;
  for (let p = 0; p < paras.length; p++) {
    const words = paras[p].split(/\s+/).filter(Boolean);
    if (!words.length) { lines += 1; continue; }
    let cur = 0, count = 1;
    for (let i = 0; i < words.length; i++) {
      const ww = words[i].length * cw;
      if (ww > inkWidth + 1e-6) return undefined;
      const need = cur === 0 ? ww : cur + cw + ww;
      if (need <= inkWidth + 1e-6) cur = need; else { count++; cur = ww; }
    }
    lines += count;
  }
  return lines;
}

/** Sizes a set name is tried at, one size for the whole diagram. */
const VENN_NAME_SIZES: number[] = [8.5, 8];
/** The descriptor box starts this far up inside the name box's bottom inset,
 *  so the gloss sits 13pt under the name — the reference's pitch. */
const VENN_DESC_TUCK = 4;

export interface VennMeasure {
  nameSize: number; nameLines: number; descLines: number;
  nameH: number; descH: number; blockH: number; inkH: number; fits: boolean;
}

/** Whether a name-over-descriptor label fits an ink box, and how tall it draws. */
export function measureVennLabel(
  name: string, desc: string, inkWidth: number, inkHeight: number,
  nameSize: number, maxNameLines = 3, maxDescLines = 4
): VennMeasure {
  const nl = wrapLines(name, inkWidth, nameSize, true);
  const dl = desc ? wrapLines(desc, inkWidth, TYPE.vennDesc.size) : 0;
  const nameLines = nl === undefined ? 1 : nl;
  const descLines = dl === undefined ? 0 : dl;
  const nameH = drawnTextHeight(nameLines, nameSize);
  const descH = descLines ? drawnTextHeight(descLines, TYPE.vennDesc.size, 0, 1, 1.0) : 0;
  const blockH = nameH + (descLines ? descH - VENN_DESC_TUCK : 0);
  const inkH = blockH - TEXT_INSET_Y;
  const fits = nl !== undefined && dl !== undefined
    && nameLines <= maxNameLines && descLines <= maxDescLines && inkH <= inkHeight + 1e-6;
  return { nameSize, nameLines, descLines, nameH, descH, blockH, inkH, fits };
}

/** Where a label sits inside its region, in units of R, relative to the
 *  circle's centre. Solved as the largest inscribed rectangle of each region
 *  for centres VENN.sep·R apart, then shortened where a taller box would touch
 *  the centre label. */
interface VennBox { dx: number; dy: number; w: number; h: number; trim?: boolean }
const VENN_BOX = {
  three: {
    sets: [
      { dx: -0.325, dy: -0.26, w: 0.93, h: 0.70 },
      { dx: 0.325, dy: -0.26, w: 0.93, h: 0.70 },
      { dx: 0, dy: 0.34, w: 1.45, h: 0.66 },
    ] as VennBox[],
    // THE MEET BOX IS TALLER THAN THE THREE-WAY LENS, deliberately. It is a
    // room for a LABEL, not an outline of the region: every line in it is
    // separately held inside the circle at its own depth (see `clears`), so
    // the extra height buys lines rather than spill. At 0.40R a `present`
    // deck's smaller circles could not hold the one sentence the diagram
    // exists to make — three lines at 7.5pt want 34.8pt and the box had 27.5 —
    // and the centre of the picture came out empty.
    meet: { dx: 0, dy: 0, w: 1.10, h: 0.52 } as VennBox,
  },
  two: {
    sets: [
      { dx: -0.385, dy: 0, w: 0.95, h: 0.80, trim: true },
      { dx: 0.385, dy: 0, w: 0.95, h: 0.80, trim: true },
    ] as VennBox[],
    meet: { dx: 0, dy: 0, w: 0.80, h: 0.58, trim: true } as VennBox,
  },
};

interface VennSidebar { head: string; body: string; headH: number; bodyH: number; h: number }

/** The takeaway as a callout beside the diagram. */
function vennSidebarFor(note: string): VennSidebar {
  const colon = note.indexOf(":");
  const hasHead = colon > 0 && colon <= 46;
  const head = hasHead ? note.slice(0, colon).trim() : "";
  const body = (hasHead ? note.slice(colon + 1) : note).trim();
  const innerW = VENN.side.width - VENN.side.pad * 2;
  const headLines = head ? estimateLines(head, innerW, TYPE.noteHead.size) : 0;
  const headH = headLines ? drawnTextHeight(headLines, TYPE.noteHead.size) : 0;
  const paras = Math.max(1, body.split("\n").filter((l) => l.trim()).length);
  const bodyLines = estimateLines(body, innerW, NOTE.fontSize);
  const bodyH = bodyLines ? drawnTextHeight(bodyLines, NOTE.fontSize, 4, paras, 1.2) : 0;
  return { head, body, headH, bodyH, h: VENN.side.pad * 2 + headH + bodyH };
}

/** A Venn diagram: two or three overlapping sets, drawn as translucent circles
 *  so the overlaps blend.
 *
 *  Measured against the reference deck's page — 174pt circles with centres
 *  ~100pt apart, every set labelled INSIDE its own region, the takeaway as a
 *  callout beside the diagram. Ours sat 0.92R apart at 50% alpha with 14pt
 *  serif labels outside: the three-way overlap covered most of each circle,
 *  the centre went grey-purple, and the picture said "these three are the same
 *  thing" — the opposite of "three arenas".
 *  `meta.noteDrawn` tells the caller the note is on the slide already. */
function vennRequests(
  page: string, id: (s: string) => string,
  venn: NonNullable<SlideInput["venn"]>, onDark: boolean, bandTop: number, bandBottom?: number,
  note?: string, meta?: { noteDrawn: boolean }
): Req[] {
  const sets = (venn.sets || []).filter((sx) => sx?.label?.trim()).slice(0, 3);
  if (sets.length < 2) return [];
  const out: Req[] = [];
  const n = sets.length;
  const top = bandTop + 4;
  // A CIRCLE ENDS ABOVE THE FOOTER'S RULE, with air. The page margin alone put
  // the bottom circle's edge at 380.52 against a hairline at 376: tangent to it
  // at `read` and cut flat by it at `present`, so a diagram whose whole subject
  // is three closed shapes drew one of them open. The frame is furniture and
  // does not move for content, so the content stops above it — the same
  // decision the takeaway bar's own floor already makes.
  const vennFloor = FRAME.bottomRuleY - FRAME.contentGap;
  const fullBottom = floorBand(vennFloor, GRID.bodyY + GRID.bandHeight);
  const barBottom = floorBand(vennFloor, bandBottom);
  const cxMid = GRID.margin + GRID.contentWidth / 2;
  const sep = VENN.sep;
  const sin60 = Math.sin(Math.PI / 3);
  const unitW = 2 + sep;
  const unitH = n === 2 ? 2 : 2 + sep * sin60;
  const parsed = sets.map((s) => splitVennLabel(s.label));
  const overlap = venn.overlap?.trim() ? splitVennLabel(venn.overlap) : undefined;
  const boxes = n === 2 ? VENN_BOX.two : VENN_BOX.three;
  const inkW = (b: VennBox, R: number) => b.w * R - (b.trim ? TEXT_INSET_X : 0);
  const radiusFor = (bandH: number, availW: number, labelRoom: number) =>
    Math.min((bandH - labelRoom) / unitH, availW / unitW, VENN.maxR);
  const nameSizeFor = (R: number): number | undefined => {
    for (let si = 0; si < VENN_NAME_SIZES.length; si++) {
      let all = true;
      for (let i = 0; i < n; i++) {
        const b = boxes.sets[i];
        if (!measureVennLabel(parsed[i].name, parsed[i].desc, inkW(b, R), b.h * R, VENN_NAME_SIZES[si]).fits) { all = false; break; }
      }
      if (all) return VENN_NAME_SIZES[si];
    }
    return undefined;
  };

  let R = radiusFor(fullBottom - top, GRID.contentWidth, 0);
  let nameSize = nameSizeFor(R);
  let bottom = fullBottom;
  let side: VennSidebar | undefined;
  const noteText = (note || "").trim();
  if (nameSize !== undefined && noteText) {
    const sb = vennSidebarFor(noteText);
    if (sb.h <= fullBottom - top) side = sb;
    else {
      bottom = barBottom;
      R = radiusFor(bottom - top, GRID.contentWidth, 0);
      nameSize = nameSizeFor(R);
    }
  }
  const inside = nameSize !== undefined;
  let room = 0;
  let outsideM: VennMeasure[] = [];
  if (!inside) {
    bottom = barBottom;
    const availW = n === 2 ? GRID.contentWidth : GRID.contentWidth - 2 * VENN.outsideLabel;
    R = radiusFor(bottom - top, availW, 46);
    for (let pass = 0; pass < 2; pass++) {
      if (n === 2) {
        const lw = (1 + sep / 2) * R - 8;
        outsideM = parsed.map((p) => measureVennLabel(p.name, p.desc, lw - TEXT_INSET_X, Infinity, VENN_NAME_SIZES[0], 9, 9));
        room = Math.max(outsideM[0].blockH, outsideM[1].blockH) + 4;
      } else {
        const sideW = cxMid - (1 + sep / 2) * R - 8 - GRID.margin;
        outsideM = [
          measureVennLabel(parsed[0].name, parsed[0].desc, sideW - TEXT_INSET_X, Infinity, VENN_NAME_SIZES[0], 9, 9),
          measureVennLabel(parsed[1].name, parsed[1].desc, sideW - TEXT_INSET_X, Infinity, VENN_NAME_SIZES[0], 9, 9),
          measureVennLabel(parsed[2].name, parsed[2].desc, 4 * R - TEXT_INSET_X, Infinity, VENN_NAME_SIZES[0], 9, 9),
        ];
        room = outsideM[2].blockH + 6;
      }
      R = radiusFor(bottom - top, availW, room);
    }
  }

  const clusterW = unitW * R, clusterH = unitH * R;
  const sideX = GRID.margin + GRID.contentWidth - VENN.side.width;
  const availRight = side ? sideX - VENN.side.gap : GRID.margin + GRID.contentWidth;
  const cx = Math.min(cxMid, availRight - clusterW / 2);
  const roomAbove = !inside && n === 2 ? room : 0;
  const roomBelow = !inside && n === 3 ? room : 0;
  const clusterTop = top + roomAbove + (bottom - top - roomAbove - roomBelow - clusterH) / 2;
  const cy0 = clusterTop + R;
  const centres: [number, number][] = [[cx - sep * R / 2, cy0], [cx + sep * R / 2, cy0]];
  if (n === 3) centres.push([cx, cy0 + sep * R * sin60]);
  const clusterBottom = centres[n - 1][1] + R;
  const meetPt: [number, number] = n === 2 ? [cx, cy0] : [cx, cy0 + sep * R * sin60 / 3];

  for (let i = 0; i < n; i++) {
    out.push(...filledShape(id(`vc${i}`), page, "ELLIPSE", VENN.fills[i], {
      x: centres[i][0] - R, y: centres[i][1] - R, width: R * 2, height: R * 2,
    }, VENN.alpha));
  }

  const drawLabel = (
    key: string, p: { name: string; desc: string }, m: VennMeasure,
    box: { x: number; y: number; width: number }, align: "START" | "CENTER" | "END"
  ) => {
    const nameStyle: TypeStyle = { ...TYPE.vennName, size: m.nameSize };
    out.push(...textBox(id(`vn${key}`), page, p.name, nameStyle,
      { x: box.x, y: box.y, width: box.width, height: m.nameH }, { align, vCenter: true }));
    if (p.desc && m.descLines) {
      out.push(...textBox(id(`vd${key}`), page, p.desc, TYPE.vennDesc,
        { x: box.x, y: box.y + m.nameH - VENN_DESC_TUCK, width: box.width, height: m.descH },
        { align, lineSpacing: 1.0, vCenter: true }));
    }
  };

  if (inside) {
    for (let i = 0; i < n; i++) {
      const b = boxes.sets[i], w = inkW(b, R);
      const m = measureVennLabel(parsed[i].name, parsed[i].desc, w, b.h * R, nameSize as number);
      const lx = centres[i][0] + b.dx * R, ly = centres[i][1] + b.dy * R;
      drawLabel(String(i), parsed[i], m, { x: lx - (w + TEXT_INSET_X) / 2, y: ly - m.blockH / 2, width: w + TEXT_INSET_X }, "CENTER");
    }
  } else if (n === 2) {
    const lw = (1 + sep / 2) * R - 8;
    for (let i = 0; i < 2; i++) {
      const x = i === 0 ? centres[0][0] - R : cx + 8;
      drawLabel(String(i), parsed[i], outsideM[i], { x, y: cy0 - R - 4 - outsideM[i].blockH, width: lw }, "CENTER");
    }
  } else {
    const leftEdge = centres[0][0] - R, rightEdge = centres[1][0] + R;
    drawLabel("0", parsed[0], outsideM[0], { x: GRID.margin, y: cy0 - outsideM[0].blockH / 2, width: leftEdge - 8 - GRID.margin }, "END");
    drawLabel("1", parsed[1], outsideM[1], { x: rightEdge + 8, y: cy0 - outsideM[1].blockH / 2, width: GRID.margin + GRID.contentWidth - rightEdge - 8 }, "START");
    drawLabel("2", parsed[2], outsideM[2], { x: cx - 2 * R, y: centres[2][1] + R + 6, width: 4 * R }, "CENTER");
  }

  if (overlap) {
    // THE OVERLAP IS THE THING A VENN EXISTS TO SAY, and for one release a
    // three-circle diagram refused to draw it: the meet box allowed the name
    // ONE line, so "Where a citation is actually earned" — thirty-four
    // characters against a 1.10R box — measured as two and was dropped. The
    // centre of the picture was empty on a slide whose title was "one
    // overlap". Two lines fit the meet box's own 0.40R height twice over, and
    // the size ladder the SET labels already walk is walked here too before
    // anything is given up.
    const mb = boxes.meet, w = inkW(mb, R), h = mb.h * R;
    // THREE LINES AND ONE SIZE FURTHER DOWN THAN THE SET LABELS GET.
    //
    // The meet region is the smallest room on the page and the sentence in it
    // is the largest claim the picture makes, so it is the one label that may
    // set tighter than its neighbours rather than be dropped. At `present` the
    // band is a fifth shorter, the circles with it, and a two-line ladder
    // stopping at 8pt left "Where a citation is actually earned" undrawn in the
    // middle of a slide titled "one overlap". Every line is still held to the
    // chord at its own depth, so a smaller size buys room rather than spill.
    const maxName = n === 2 ? 3 : 3;
    const ladder = VENN_NAME_SIZES.concat([TYPE.vennDesc.size]);
    let desc = overlap.desc;
    let m = measureVennLabel(overlap.name, desc, w, h, nameSize === undefined ? ladder[0] : nameSize, maxName, 2);
    for (let si = 0; !m.fits && si < ladder.length; si++) {
      m = measureVennLabel(overlap.name, desc, w, h, ladder[si], maxName, 2);
    }
    if (!m.fits && desc) {
      desc = "";
      for (let si = 0; !m.fits && si < ladder.length; si++) {
        m = measureVennLabel(overlap.name, "", w, h, ladder[si], maxName, 0);
      }
    }
    if (m.fits) {
      drawLabel("o", { name: overlap.name, desc }, m,
        { x: meetPt[0] - (w + TEXT_INSET_X) / 2, y: meetPt[1] - m.blockH / 2, width: w + TEXT_INSET_X }, "CENTER");
    }
  }

  if (side) {
    const pad = VENN.side.pad, innerW = VENN.side.width - pad * 2;
    const y = Math.max(top, Math.min(clusterBottom, NOTE.bottom) - side.h);
    out.push(...filledShape(id("noteBar"), page, "ROUND_RECTANGLE", onDark ? COLOR.white : COLOR.tintBlue, {
      x: sideX, y, width: VENN.side.width, height: side.h,
    }, onDark ? 0.1 : 1));
    let ty = y + pad - 3;
    if (side.headH) {
      out.push(...textBox(id("noteHead"), page, side.head, onDark ? TYPE.noteHeadDark : TYPE.noteHead, {
        x: sideX + pad, y: ty, width: innerW, height: side.headH,
      }));
      ty += side.headH;
    }
    out.push(...textBox(id("noteTxt"), page, side.body,
      { font: "Roboto", size: NOTE.fontSize, weight: 300, color: onDark ? COLOR.greyLight : COLOR.navy }, {
        x: sideX + pad, y: ty, width: innerW, height: side.bodyH,
      }, { lineSpacing: 1.2, spaceBelow: 4 }));
    if (meta) meta.noteDrawn = true;
  }
  return out;
}

/** The quadrant panel's own padding.
 *
 *  `QUAD_INSET` is the air between the panel's edge and the type on the right
 *  and at the foot; `QUAD_PAD` is the left one, and it is wider by exactly the
 *  hung dot's offset so the DISC lands on QUAD_INSET and the words land on one
 *  glyph line with the panel's heading. A padding a marker hangs into is what a
 *  padding is for; two insets — a narrow one for the head and a wider one for
 *  the list — would put the three-left-edges defect inside every quadrant. */
const QUAD_INSET = 12;
const QUAD_PAD = QUAD_INSET + HUNG_DOT.offsetX - SLIDES_TEXT_INSET.x;

/** SWOT: four labelled quadrants of bullets on pale tints. A staple of the
 *  strategy deck, and the model had no way to draw one — it fell to bullets. */
function swotRequests(
  page: string, id: (s: string) => string,
  swot: NonNullable<SlideInput["swot"]>, bandTop: number, bandBottom?: number
): Req[] {
  const cells: { key: string; head: string; items: string[]; tint: string; ink: string }[] = [
    { key: "s", head: "Strengths", items: swot.strengths || [], tint: COLOR.tintTeal, ink: COLOR.inkTeal },
    { key: "w", head: "Weaknesses", items: swot.weaknesses || [], tint: COLOR.tintCoral, ink: COLOR.inkCoral },
    { key: "o", head: "Opportunities", items: swot.opportunities || [], tint: COLOR.tintBlue, ink: COLOR.inkBlue },
    { key: "t", head: "Threats", items: swot.threats || [], tint: COLOR.tintAmber, ink: COLOR.inkAmber },
  ];
  const gap = 10;
  const top = bandTop;
  // A PANEL ENDS ABOVE THE FOOTER'S RULE. Taken to the page margin, the two
  // lower quadrants ran flush into the hairline at both presets: bounded by the
  // frame instead of by themselves, which reads as a clipped panel rather than
  // a panel.
  const bottom = floorBand(FRAME.bottomRuleY - FRAME.contentGap, bandBottom);
  const cw = (GRID.contentWidth - gap) / 2;
  const out: Req[] = [];
  // THE PANELS ARE AS TALL AS WHAT IS IN THEM, AND THE GRID CENTRES.
  //
  // Every panel was a fixed quarter of the band, so four quadrants written with
  // three bullets each were 40% empty and the grid still ran to the foot of the
  // page. A quadrant is a figure: it is sized by its contents and the band is
  // its frame. The rows are measured with the deck's own list ruler — the same
  // one bulletBlock draws with — so a panel is never shorter than the list
  // inside it, and the pair is scaled down together if the band cannot hold
  // them both.
  const QUAD_HEAD_H = 32, QUAD_FOOT = QUAD_INSET;
  const itemW = cw - QUAD_PAD - QUAD_INSET;
  const need = cells.map((c) =>
    QUAD_HEAD_H + bulletBlockHeight(c.items.join("\n"), itemW, TYPE.quadItem) + QUAD_FOOT);
  const rowNeed = [Math.max(need[0], need[1]), Math.max(need[2], need[3])];
  const room = bottom - top - gap;
  const scale = Math.min(1, room / Math.max(1, rowNeed[0] + rowNeed[1]));
  // THE FLOOR MAY NOT BEAT THE ROOM. A panel under about 60pt is not a panel,
  // but a 60pt floor applied to both rows of a band that only has 100pt puts
  // the grid 20pt past its own floor — and at `present`, where the band is a
  // fifth shorter, that is the last line of a full quadrant drawn into the
  // footer's own band. The floor is itself floored by half the room.
  const rowFloor = Math.min(60, (room - 0) / 2);
  const rowH = [Math.max(rowFloor, rowNeed[0] * scale), Math.max(rowFloor, rowNeed[1] * scale)];
  const gridTop = top + Math.max(0, (room - rowH[0] - rowH[1]) / 2);
  cells.forEach((c, i) => {
    const row = Math.floor(i / 2);
    const ch = rowH[row];
    const cx = GRID.margin + (i % 2) * (cw + gap);
    const cy = gridTop + row * (rowH[0] + gap);
    out.push(...filledShape(id(`q${c.key}`), page, "RECTANGLE", c.tint, { x: cx, y: cy, width: cw, height: ch }));
    out.push(...textBox(id(`qh${c.key}`), page, c.head, { ...TYPE.quadHeader, color: c.ink }, {
      x: cx + QUAD_PAD, y: cy + 10, width: cw - QUAD_PAD - QUAD_INSET, height: 18,
    }));
    // ONE LEFT EDGE INSIDE THE PANEL. The header and the items are set on the
    // same glyph line — cx + QUAD_PAD + HUNG_DOT.offsetX — and the discs hang
    // back into the panel's own padding, which is what a padding is for. Two
    // insets, one for the head and a wider one for the marked list, would put
    // the three-left-edges defect inside every quadrant.
    out.push(...bulletBlock(id, `qi${c.key}`, page, c.items.join("\n"), TYPE.quadItem, {
      x: cx + QUAD_PAD, y: cy + QUAD_HEAD_H, width: itemW, height: Math.max(20, ch - QUAD_HEAD_H - QUAD_FOOT),
    }).requests);
  });
  return out;
}

/** A 2x2 quadrant matrix — impact/effort, risk/reward. Two axes crossing at the
 *  centre, quadrant labels in the corners, items plotted by x and y in 0..1. */
function matrixRequests(
  page: string, id: (s: string) => string,
  m: NonNullable<SlideInput["matrix"]>, bandTop: number, bandBottom?: number
): Req[] {
  const top = bandTop + 6;
  // THE AXIS ROW IS BELOW THE PANEL AND ABOVE THE FRAME. Floored on the page
  // margin, "LOW EFFORT / HIGH EFFORT" were drawn at 378.5 — past the footer
  // hairline at 376 — so at `present` the panel was clipped by the rule and its
  // own axis crushed into the last few points above it.
  const AXIS_ROW = 16;
  const bottom = floorBand(FRAME.bottomRuleY - FRAME.contentGap - AXIS_ROW, bandBottom, AXIS_ROW);
  const left = GRID.margin + 46;
  const right = GRID.margin + GRID.contentWidth - 12;
  const w = right - left, h = bottom - top;
  const midX = left + w / 2, midY = top + h / 2;
  const out: Req[] = [];

  // Quadrant tints (faint), then the crossing axes on top.
  const tints = [COLOR.tintBlue, COLOR.tintTeal, COLOR.tintGrey, COLOR.tintAmber];
  const quadBoxes = [[left, top], [midX, top], [left, midY], [midX, midY]];
  quadBoxes.forEach(([qx, qy], i) => {
    out.push(...filledShape(id(`mq${i}`), page, "RECTANGLE", tints[i], { x: qx, y: qy, width: w / 2, height: h / 2 }, 0.5));
  });
  out.push(
    ...filledShape(id("mvx"), page, "RECTANGLE", COLOR.navy, { x: midX, y: top, width: 1, height: h }, 0.35),
    ...filledShape(id("mhz"), page, "RECTANGLE", COLOR.navy, { x: left, y: midY, width: w, height: 1 }, 0.35),
  );

  // Axis end labels.
  if (m.xAxis) {
    out.push(
      ...textBox(id("mxl"), page, m.xAxis[0], TYPE.axisEnd, { x: left, y: bottom + 2, width: w / 2, height: 12 }),
      ...textBox(id("mxr"), page, m.xAxis[1], TYPE.axisEnd, { x: midX, y: bottom + 2, width: w / 2, height: 12 }, { align: "END" }),
    );
  }
  if (m.yAxis) {
    out.push(
      ...textBox(id("myb"), page, m.yAxis[0], TYPE.axisEnd, { x: GRID.margin, y: bottom - 12, width: 44, height: 12 }),
      ...textBox(id("myt"), page, m.yAxis[1], TYPE.axisEnd, { x: GRID.margin, y: top, width: 44, height: 12 }),
    );
  }
  // Quadrant names are drawn as faint captions in the OUTER corners, each one
  // placed by its own axis coordinates. The caller may address them that way
  // ({ label, x, y }) or pass the legacy four-tuple, read as TL, TR, BL, BR.
  //
  // Both halves of this used to be wrong at once. The tuple made the caller
  // derive a corner from the axes it had just written — and one got it exactly
  // inverted, printing "Later" over high-impact/low-effort — while the renderer
  // drew indices 0 and 1 only, so the "do now" the caller HAD supplied was
  // dropped without a word. Two labels silently discarded is not a layout
  // decision; the bottom captions sit inside the plot above the axis line and
  // the item labels dodge them, the way they already dodge the top pair.
  const quadCaps: Record<string, string> = {};
  if (Array.isArray(m.quadrants)) {
    const corner = ["lowhigh", "highhigh", "lowlow", "highlow"];  // TL, TR, BL, BR
    (m.quadrants as unknown[]).forEach((q, i) => {
      if (typeof q === "string") { if (q.trim() && corner[i]) quadCaps[corner[i]] = q; }
      else if (q && typeof q === "object") {
        const { label, x, y } = q as { label?: string; x?: string; y?: string };
        if (label?.trim()) quadCaps[`${x === "high" ? "high" : "low"}${y === "high" ? "high" : "low"}`] = label;
      }
    });
  }
  // The bottom pair sits clear of the x-axis end labels below the plot, and
  // declares the two lines a wrapped caption actually takes: at 12pt high it
  // overran onto "LOW EFFORT", which is the overlap battery doing its job.
  const capBandTop = bottom - 30;
  const capBandH = 26;
  /** Where the four corner captions actually ARE. The item labels used to dodge
   *  a BAND — "anything in the top 22pt goes below its dot" — rather than a
   *  caption, so a dot nowhere near a corner still had its label thrown under
   *  it while its neighbours kept theirs beside. Six items ended up in three
   *  different relations to their own dots and the reader could not tell which
   *  label belonged to which point. */
  const capRects: { x: number; y: number; w: number; h: number }[] = [];
  {
    // Sized to the TEXT, not to the half-quadrant.
    //
    // These were w/2 - 12 wide with the right-hand one set END-aligned, so the
    // top-right caption's BOX covered the entire right half of the plot while
    // its visible words occupied a corner of it. Any item label up there
    // overlapped it by geometry — which the overlap battery reports, correctly,
    // because a box that wide is a claim on space the caption does not use.
    // MEASURED WITH THE DECK'S OWN RULER, not with a guess of 4.8 points per
    // character: "Do now" measured as 38.8 and drew as two lines jammed against
    // the right edge of the panel.
    const capW = (t: string) => Math.min(w / 2 - 12, Math.max(40, labelBoxWidth(t, TYPE.quadLabel.size)));
    // AND THE BOX HUGS ITS LINES. The bottom pair was given a flat 26pt to
    // declare the two lines a caption used to wrap onto; measured, most of them
    // are one line, and a one-line caption in a 26pt box is 7pt of slack inside
    // a tint — which is the same "a box is a claim on space" fault the widths
    // above were fixed for.
    const capH = (t: string) => drawnTextHeight(
      Math.max(1, estimateLines(t, capW(t), TYPE.quadLabel.size)), TYPE.quadLabel.size);
    const cap = (key: string, n: string, atFoot: number | null, yTop: number, atRight: boolean) => {
      const t = quadCaps[key];
      if (!t) return;
      const cw = capW(t), ch = capH(t);
      const cy = atFoot === null ? yTop : atFoot - ch;
      const cx = atRight ? right - 6 - cw : left + 6;
      capRects.push({ x: cx, y: cy, w: cw, h: ch });
      out.push(...textBox(id(n), page, t, TYPE.quadLabel, {
        x: cx, y: cy, width: cw, height: ch,
      }, atRight ? { align: "END" } : {}));
    };
    cap("lowhigh",  "mql0", null, top + 4, false);
    cap("highhigh", "mql1", null, top + 4, true);
    cap("lowlow",   "mql2", capBandTop + capBandH, 0, false);
    cap("highlow",  "mql3", capBandTop + capBandH, 0, true);
  }

  // Items: a dot at (x,y), label beside it. y is inverted (1 = top). A label
  // that would land in the top strip where a quadrant caption sits is pushed
  // BELOW its dot instead.
  (m.items || []).slice(0, 12).forEach((it, i) => {
    const px = left + Math.max(0, Math.min(1, it.x)) * w;
    const py = bottom - Math.max(0, Math.min(1, it.y)) * h;
    const r = it.highlight ? 6 : 4.5;
    const fill = it.highlight ? COLOR.blue : COLOR.navy;
    out.push(...filledShape(id(`md${i}`), page, "ELLIPSE", fill, { x: px - r, y: py - r, width: r * 2, height: r * 2 }));
    // Label beside the dot, clamped inside the plot. Placed below the dot when
    // the dot sits high (near a quadrant caption) and above when it sits low.
    const lw = Math.min(140, Math.max(40, it.label.length * 4.6 + 8));
    // ONE RELATION, AND IT ONLY CHANGES WHEN IT HAS TO. A label sits BESIDE its
    // dot, on the dot's own line — the relation a reader learns once on the
    // first point and then trusts for the rest. It moves only when it would be
    // drawn over a corner caption, and it moves SIDEWAYS first, because a label
    // on the other side of its dot is still beside it while a label above or
    // below is a different relation again.
    const LH = 14;
    const hits = (x: number, y: number) => {
      for (let k = 0; k < capRects.length; k++) {
        const c = capRects[k];
        if (x < c.x + c.w && x + lw > c.x && y < c.y + c.h && y + LH > c.y) return true;
      }
      return false;
    };
    const rightSide = px + r + 4, leftSide = px - r - 4 - lw;
    let lx = rightSide + lw > right ? leftSide : rightSide;
    let ly = py - 7;
    if (hits(lx, ly)) {
      const alt = lx === rightSide ? leftSide : rightSide;
      if (alt >= left && alt + lw <= right && !hits(alt, ly)) lx = alt;
      // Nowhere beside it: step off the caption, downwards from a dot in the
      // top half and upwards from one in the bottom, so the label is still the
      // nearest ink to its own point.
      else ly = py < midY ? py + r + 3 : py - r - 3 - LH;
    }
    ly = Math.max(top + 2, Math.min(bottom - LH - 2, ly));
    out.push(...textBox(id(`ml${i}`), page, it.label, it.highlight ? { ...TYPE.dotLabel, bold: true } : TYPE.dotLabel, {
      x: Math.max(left, lx), y: ly, width: lw, height: LH,
    }, lx < px ? { align: "END" } : {}));
  });
  return out;
}

/** A comparison table: a header row of options, then criterion rows. A cell of
 *  "yes"/"no" draws a tick or cross; anything else prints as text. */
function comparisonRequests(
  page: string, id: (s: string) => string,
  cmp: NonNullable<SlideInput["comparison"]>, bandTop: number, bandBottom?: number
): Req[] {
  const cols = (cmp.columns || []).slice(0, 4);
  const rows = (cmp.rows || []).slice(0, 8);
  if (!cols.length || !rows.length) return [];
  const out: Req[] = [];
  const top = bandTop;
  const labelW = GRID.contentWidth * 0.34;
  const colW = (GRID.contentWidth - labelW) / cols.length;
  const headH = 28;
  const bottom = floorBand(CANVAS.height - GRID.margin, bandBottom);
  const rowH = Math.min(40, (bottom - top - headH) / rows.length);

  // Header: option names across the top, over a rule.
  cols.forEach((c, j) => {
    out.push(...textBox(id(`ch${j}`), page, c, TYPE.cellHeadLight, {
      x: GRID.margin + labelW + j * colW, y: top, width: colW, height: headH,
    }, { align: "CENTER" }));
  });
  out.push(...filledShape(id("crh"), page, "RECTANGLE", COLOR.navy, {
    x: GRID.margin, y: top + headH, width: GRID.contentWidth, height: RULE.hairlineThickness,
  }, 0.4));

  rows.forEach((r, i) => {
    const ry = top + headH + 4 + i * rowH;
    if (r.highlight) {
      out.push(...filledShape(id(`crb${i}`), page, "RECTANGLE", COLOR.tintBlue, {
        x: GRID.margin, y: ry, width: GRID.contentWidth, height: rowH,
      }, 0.6));
    }
    out.push(...textBox(id(`crl${i}`), page, r.label, { ...TYPE.cellText, bold: true }, {
      x: GRID.margin + 6, y: ry + rowH / 2 - 8, width: labelW - 12, height: 16,
    }));
    (r.cells || []).slice(0, cols.length).forEach((cell, j) => {
      const cx = GRID.margin + labelW + j * colW;
      const v = cell.trim().toLowerCase();
      if (v === "yes" || v === "y" || v === "true" || v === "✓") {
        out.push(...textBox(id(`cc${i}_${j}`), page, "\u2713", { ...TYPE.cellText, size: 13, bold: true, color: COLOR.inkTeal }, {
          x: cx, y: ry + rowH / 2 - 9, width: colW, height: 18,
        }, { align: "CENTER" }));
      } else if (v === "no" || v === "n" || v === "false" || v === "\u2717" || v === "x") {
        out.push(...textBox(id(`cc${i}_${j}`), page, "\u2717", { ...TYPE.cellText, size: 13, bold: true, color: COLOR.inkCoral }, {
          x: cx, y: ry + rowH / 2 - 9, width: colW, height: 18,
        }, { align: "CENTER" }));
      } else {
        out.push(...textBox(id(`cc${i}_${j}`), page, cell, TYPE.cellText, {
          x: cx, y: ry + rowH / 2 - 8, width: colW, height: 16,
        }, { align: "CENTER" }));
      }
    });
    // A hairline between rows.
    if (i < rows.length - 1) {
      out.push(...filledShape(id(`crr${i}`), page, "RECTANGLE", COLOR.navy, {
        x: GRID.margin, y: ry + rowH, width: GRID.contentWidth, height: RULE.hairlineThickness,
      }, 0.15));
    }
  });
  return out;
}

/** The most columns a slide can carry before the cells are too narrow to read,
 *  and the most rows before it is a spreadsheet on a projector. */
export const TABLE_MAX_COLS = 6;
export const TABLE_MAX_ROWS = 12;

/** The narrowest a column may be drawn. Below this even a three-character
 *  figure loses characters to the ellipsis, which is worse than no table. */
export const TABLE_MIN_COL = 46;

/** The air between the last row and the paragraph beneath it. The same step
 *  the stat grid leaves between its figures and the bullets under them. */
const TABLE_BODY_GAP = 10;

/** The least band a table may be left with once the prose beneath it has taken
 *  its room: a header band and one row. Below that there is no table to draw,
 *  so the reserve is refused before it is measured rather than after. */
const TABLE_MIN_BAND = 40;

/**
 * Share the width between columns, narrow ones first.
 *
 * NOT proportional shrinking, which is what shipped and what a real ten-row
 * action table exposed: with two long prose columns beside "#" and "Effort",
 * every column lost the same PERCENTAGE, so "2 hours" was drawn as "2 ho…"
 * while the prose columns still had two hundred pixels each. A column of
 * figures is either complete or useless; a column of prose reads fine with an
 * ellipsis on the end.
 *
 * So: find the widest any column may be, and cap at that. Columns needing less
 * than the cap keep exactly what they need; the ones above it share what is
 * left equally. Max-min fair, which is the standard answer to this and is the
 * one that protects the narrow columns.
 */
export function fitColumnWidths(natural: number[], available: number): number[] {
  const total = natural.reduce((a, b) => a + b, 0);
  if (!natural.length) return [];
  if (total <= available) {
    // Room to spare: give it to the columns that can use it, in proportion to
    // what they already take, so prose gets the space and "DR" stays narrow.
    const slack = available - total;
    return natural.map((w) => w + (w / (total || 1)) * slack);
  }
  // Binary search the cap. 40 iterations is far past the precision a slide can
  // draw and cannot loop: the interval halves every pass.
  let lo = 0, hi = Math.max(...natural);
  for (let i = 0; i < 40; i++) {
    const mid = (lo + hi) / 2;
    const sum = natural.reduce((a, w) => a + Math.min(w, mid), 0);
    if (sum > available) hi = mid; else lo = mid;
  }
  const cap = Math.max(lo, TABLE_MIN_COL);
  return natural.map((w) => Math.min(w, cap));
}

/**
 * Is this column numeric?
 *
 * Right-aligning figures is the whole reason this layout exists rather than
 * reusing `comparison`: a column of centred numbers cannot be scanned, because
 * the digits do not line up. Decided per column on the CELLS, by majority, so
 * one "n/a" in a column of thousands does not left-align the lot.
 */
export function isNumericColumn(cells: string[]): boolean {
  const filled = cells.map((c) => String(c ?? "").trim()).filter((c) => c !== "");
  if (!filled.length) return false;
  let numeric = 0;
  for (const c of filled) {
    // A figure, with optional currency, thousands separators, decimals, a
    // percentage, a leading sign, or a multiplier suffix ("153x", "3.2k").
    if (/^[-+(]?\s*[£$€]?\s*\d[\d,.\s]*\s*(%|x|k|m|bn)?\)?$/i.test(c)) numeric++;
  }
  return numeric * 2 > filled.length;
}

/**
 * One cell, cut to the characters that fit on `lines` lines of its column.
 *
 * A TABLE CELL IS NOT A PARAGRAPH. Left to wrap, a long first-column label
 * pushed its row into the one beneath it, and eight long headings ran the whole
 * header block over the first three rows of data — caught by the overlap
 * detector on the deliberately overloaded fixture, not by eye. Truncating is
 * what a table does at this size; the alternative is a row height set by the
 * worst cell in the table, which wastes the slide for every other row.
 */
export function fitCell(text: string, boxWidth: number, size: number, lines = 1): string {
  const s = String(text ?? "").replace(/\s+/g, " ").trim();
  if (!s) return "";
  const usable = Math.max(size, boxWidth - TEXT_INSET_X);
  const perLine = Math.max(1, Math.floor(usable / (size * PER_CHAR)));
  const budget = perLine * lines;
  if (s.length <= budget) return s;
  // A word boundary if one is close, so a cut does not land mid-word when it
  // does not have to.
  const cut = s.slice(0, Math.max(1, budget - 1));
  const space = cut.lastIndexOf(" ");
  return (space > budget * 0.6 ? cut.slice(0, space) : cut).trimEnd() + "…";
}

/** THE TABLE'S OWN WIDTH, in one place. With a rail beside it the table gives
 *  up a third of the measure; without one it takes the whole content width.
 *  The prose that now sits BENEATH the rows is set on the same measure, so
 *  this has to be one number rather than two that happen to agree today. */
function tableWidthFor(hasRail: boolean): number {
  return hasRail ? Math.floor(GRID.contentWidth * 0.63) : GRID.contentWidth;
}

/** What the table reports back about the space it took.
 *
 *  `bottom` is where the rows end, so the takeaway bar — and now the body —
 *  can follow them. `size` and `clipped` are what the branch above needs to
 *  answer the only question worth asking about a body beneath a table: can
 *  both be drawn whole, and if the type had to come down to manage it, did
 *  anyone say so. */
interface TableMeta { bottom: number; size?: number; clipped?: boolean }

/** A data table: a header row and rows of cells, figures right-aligned. */
/**
 * A data table, optionally with a commentary rail beside it.
 *
 * The rail exists because of a real conversion: a source slide carried a
 * baselines-and-targets table PLUS two analysis panels beside it ("Renegotiate
 * the AI citation target", "Split the traffic target"). The table layout had
 * nowhere to put them, so the model moved the analysis into speaker notes and
 * spare closing slides, and the converted slide showed the numbers with none
 * of the argument. The commentary is usually the whole point of such a slide.
 */
function tableRequests(
  page: string, id: (s: string) => string,
  spec: NonNullable<SlideInput["table"]>, bandTop: number,
  rail?: string,
  bandBottom?: number,
  opts: { onDark?: boolean; meta?: TableMeta; hugRows?: boolean } = {}
): Req[] {
  const onDark = !!opts.onDark;
  const columns = (spec.columns || []).map((c) => String(c ?? "")).slice(0, TABLE_MAX_COLS);
  const allRows = (spec.rows || []).filter((r) => Array.isArray(r) && r.some((c) => String(c ?? "").trim() !== ""));
  if (!columns.length || !allRows.length) return [];
  // With a rail the table gives up a third of the width. Cells clip earlier,
  // which is the trade: a table that fills the slide while its argument sits in
  // the speaker notes is the failure this exists to fix.
  const hasRail = !!rail?.trim();
  const tableW = tableWidthFor(hasRail);
  const rows = allRows.slice(0, TABLE_MAX_ROWS).map((r) => columns.map((_, j) => String(r[j] ?? "")));

  const out: Req[] = [];
  const top = bandTop;
  const dropped = allRows.length - rows.length;
  const droppedCols = (spec.columns || []).length - columns.length;
  // A dropped row is SAID, never silently cut: a table that quietly shows the
  // first twelve of twenty reads as the whole set.
  const note = dropped > 0 || droppedCols > 0;
  // No SOURCE_BLOCK here: that constant reserves room for a chart's source
  // line, which a table never draws. Reserving it anyway cost every table 24pt
  // of band — precisely the difference between a ten-row scorecard fitting
  // with wrapped cells at 7pt and falling back to single-line clipping.
  const tail = note ? 14 : 2;

  // COLUMN WIDTHS ARE MEASURED, NOT WEIGHTED — and now the TYPE is searched
  // as well. A ten-row scorecard whose "Why" column wraps to two lines cannot
  // physically fit at 9pt: the band holds ~240pt and ten rows of two-line
  // cells need ~330, a third of it the fixed 7.2pt Slides inset charged per
  // cell box. The source deck solves this the honest way — smaller type — so
  // this engine now does too: it tries 9pt, then 8, 7, 6.5, each at a 3-line
  // and then 2-line allowance, and commits to the FIRST combination where
  // every cell fits whole. Only when none fits does it fall back to 9pt
  // single-line clipping, which is the old behaviour as the floor instead of
  // the default. Column widths are recomputed per candidate size, because
  // PER_CHAR scales with the glyphs.
  const aligns = columns.map((_, j) =>
    spec.align?.[j] || (isNumericColumn(rows.map((r) => r[j])) ? "right" : "left")
  );
  const PAD = 0;
  // The BAND's bottom, not the canvas's. The table measured itself against
  // the page edge and ignored the takeaway bar entirely, so on a nine-row
  // engine table the bar sat squarely on top of the ninth row — DeepSeek was
  // drawn, and then painted over.
  const bottom = Math.min(CANVAS.height - GRID.margin - tail, bandBottom ?? Infinity);
  // Never into the footer: the "Showing N of M" line sits under the last row,
  // and it was drawn 5pt into the footer once the footer came up off the bezel.
  const bottomClear = Math.min(bottom, FOOTER_Y - 6 - ((spec.rows || []).length > TABLE_MAX_ROWS ? 14 : 0));

  interface TablePlan {
    size: number; headSize: number; cap: number;
    widths: number[]; xs: number[]; inner: (j: number) => number;
    heads: string[]; headH: number;
    rowHs: number[]; rowCaps: number[]; fits: boolean;
  }
  /** Text sits 6pt in from a column's edge, so the header band and the zebra
   *  have a margin and the label column does not touch the slide edge. The
   *  width planner must know it, or a narrow value column loses exactly those
   *  6pt and "2 hours" is cut to "2 hou…" — which the battery caught.
   *
   *  NOT ON THE FIRST COLUMN, and that is what put three left edges on one
   *  slide. Rendering the deck showed the title's glyphs at x=31.68, the
   *  table's band at 24.48 and the first cell's text at 37.68 — three
   *  different starts, which reads as none of them being the column.
   *
   *  THE DECK HAS TWO EDGES AND ALWAYS HAS: furniture on the page margin — the
   *  frame's hairlines, the accent rule under a title, the takeaway bar, this
   *  band — and TYPE on the glyph line 7.2pt inside it, which is where Slides'
   *  own text inset puts every title, standfirst and bullet on every other
   *  slide. A first column with no extra inset lands on that line exactly. It
   *  loses nothing: the 7.2pt inset is still there, so the label still does not
   *  touch the band's edge, and the band still bleeds 7.2pt further left than
   *  its type, which is what a band is for. */
  const CELL_X = 6;
  const cellX = (j: number) => (j === 0 ? 0 : CELL_X);
  const planFor = (size: number, cap: number): TablePlan => {
    const headSize = Math.max(8, Math.min(TYPE.cellHead.size, size + 0.5));
    const natural = columns.map((c, j) => {
      let cells = 0;
      for (const r of rows) cells = Math.max(cells, r[j].length);
      // The heading may wrap to two lines, so its width claim is half its
      // length; a cell past ~35 characters claims at half rate too, because
      // two measured lines are the design, not a failure.
      const headW = Math.ceil(c.length / 2 + 1) * headSize * PER_CHAR;
      const cellClaim = cells <= 35 ? cells : 35 + (cells - 35) / 2;
      const cellW = cellClaim * size * PER_CHAR;
      return Math.max(TABLE_MIN_COL + cellX(j), Math.max(headW, cellW) + TEXT_INSET_X + cellX(j));
    });
    const widths = fitColumnWidths(natural, tableW);
    const xs: number[] = [];
    let acc = GRID.margin;
    for (const w of widths) { xs.push(acc); acc += w; }
    // The column's TEXT width: its share of the table less the 6pt inset the
    // cells are drawn with. Measured and drawn at the same number, or the
    // planner passes a cell that the renderer then cuts — which is exactly
    // what happened to "Master entity plus satellites…" in a three-row table
    // with 140pt to spare.
    const inner = (j: number) => Math.max(10, widths[j] - cellX(j));
    const heads = columns.map((c, j) => fitCell(c, inner(j), headSize, 2));
    const headLines = heads.reduce((n, h, j) => Math.max(n, estimateLines(h, inner(j), headSize)), 1);
    const headH = Math.max(22, drawnTextHeight(headLines, headSize, 0, 1, 1.05));
    const availRows = bottomClear - top - headH - 4;
    const rowCaps = rows.map((r) => r.reduce((n, cell, j) => cell.trim()
      ? Math.max(n, Math.min(cap, estimateLines(cell, inner(j), size)))
      : n, 1));
    // THE ROW PITCH EXCLUDES SLIDES' INSET. Every text box carries 7.2pt of
    // vertical inset the API cannot switch off; paid per ROW, ten rows spent
    // 72pt on nothing, and a scorecard that fits the reference's page at 7.8pt
    // needed 268pt of rows here against 244 available. So a row is as tall as
    // its LINES at the cells' own 105% leading plus a hair of air, and the
    // cell's box (below) overhangs the row by half the inset top and bottom,
    // its text centred: the boxes overlap their neighbours' empty inset, the
    // glyphs never do. Two lines at 7.5pt come to 21.8pt — the reference's own
    // 21.6.
    const rowHs = rowCaps.map((n) => Math.max(size * 1.26 * 1.05 + 6, n * size * 1.26 * 1.05 + 2));
    const total = rowHs.reduce((a, b) => a + b, 0);
    return { size, headSize, cap, widths, xs, inner, heads, headH, rowHs, rowCaps, fits: total <= availRows };
  };

  let plan: TablePlan | null = null;
  // 6pt is the floor: the source decks set dense tables at the equivalent of
  // ~5pt, and a nine-row table with wrapped cells needs it. Small and whole
  // beats large and cut mid-phrase.
  // 7.5pt is the floor — "about 8", the user's own number. Below it the room
  // cannot read the column that carries the argument; a table that will not
  // fit at 7.5 declares the rows it drops rather than shrinking to 6.
  outer: for (const trySize of [TYPE.cellText.size, 8.5, 8, 7.5]) {
    for (const tryCap of [3, 2]) {
      const cand = planFor(trySize, tryCap);
      // A candidate only counts when nothing in it is clipped: every cell's
      // measured lines within the cap, at this size.
      const clipped = rows.some((r) => r.some((cell, j) =>
        cell.trim() !== "" && estimateLines(cell, cand.inner(j), trySize) > tryCap));
      if (process.env.TABLE_DEBUG) {
        const total = cand.rowHs.reduce((a, b) => a + b, 0);
        const worst = rows.reduce((n, r) => Math.max(n, ...r.map((cell, j) => cell.trim() ? estimateLines(cell, cand.inner(j), trySize) : 0)), 0);
        console.log(`   [table] ${trySize}pt cap ${tryCap}: rows ${total.toFixed(0)} avail ${(bottomClear - top - cand.headH - 4).toFixed(0)} fits=${cand.fits} worstLines=${worst} clipped=${clipped}`);
      }
      if (cand.fits && !clipped) { plan = cand; break outer; }
    }
  }
  if (!plan) {
    plan = planFor(TYPE.cellText.size, 1);
    const availRows = bottomClear - top - plan.headH - 4;
    const total = plan.rowHs.reduce((a, b) => a + b, 0);
    if (total > availRows) {
      const k = availRows / total;
      plan.rowHs = plan.rowHs.map((h) => Math.max(11, h * k));
    }
    // THE FLOOR IS A LOSS, AND IT IS NOW SAID OUT LOUD. Nothing above fitted,
    // so the cells are cut to one line apiece by fitCell — which is the only
    // place in this function where words disappear without a "Showing N of M"
    // line to declare them. The branch above reads this to decide whether a
    // body may take room from the rows: it may not, if the rows are already
    // being cut.
    if (opts.meta) opts.meta.clipped = true;
  } else {
    // Deal the slack back, bounded, so the table breathes instead of huddling.
    const availRows = bottomClear - top - plan.headH - 4;
    const total = plan.rowHs.reduce((a, b) => a + b, 0);
    // Rows hug their words. The slack used to be dealt back up to 12pt a row,
    // which made a five-row table into five 60pt bands of tint with three
    // lines in each — "waiting for a line that never comes".
    //
    // With prose BENEATH the table the slack belongs to the prose, not to the
    // rows: the rows hug their words and what is left falls below them, which
    // is exactly what the stat grid does when bullets follow its figures. This
    // gives nothing up — no row is dropped and no cell is cut — it only
    // declines to pad.
    const extra = opts.hugRows ? 0 : Math.min(3, Math.max(0, (availRows - total) / rows.length));
    plan.rowHs = plan.rowHs.map((h) => h + extra);
  }
  if (opts.meta) opts.meta.size = plan.size;
  const { widths, xs, inner, heads, headH, rowHs, rowCaps } = plan;
  const cellStyle = { ...TYPE.cellText, size: plan.size };
  const headStyle = { ...TYPE.cellHead, size: plan.headSize };
  const rowYs: number[] = [];
  {
    let acc2 = top + headH + 4;
    for (const h of rowHs) { rowYs.push(acc2); acc2 += h; }
  }

  // A HEADER BAND: navy with white bold heads (inverted on a dark ground).
  // Serif heads over a hairline read as a fourth row from the back, and the
  // presenter had to say what the columns were.
  out.push(...filledShape(id("thb"), page, "RECTANGLE", onDark ? COLOR.white : COLOR.navy, {
    x: GRID.margin, y: top, width: tableW, height: headH,
  }, onDark ? 0.92 : 1));
  const bandHead = { ...headStyle, color: onDark ? COLOR.navy : COLOR.white };
  heads.forEach((c, j) => {
    out.push(...textBox(id(`th${j}`), page, c, bandHead, {
      x: xs[j] + PAD + cellX(j), y: top, width: inner(j), height: headH,
    }, { align: aligns[j] === "right" ? "END" : "START", vCenter: true, lineSpacing: 1.05 }));
  });

  const highlighted = new Set((spec.highlight || []).filter((n) => Number.isInteger(n)));

  // Status and tier values render as COLOURED PILLS, the way the source decks
  // draw them: a scorecard whose HIGH/MED/LOW all read in the same ink asks
  // the reader to parse words where the original let them read colour.
  const PILL: { [k: string]: { fill: string; ink: string } } = {
    HIGH:   { fill: COLOR.tintTeal,  ink: COLOR.inkTeal },
    MED:    { fill: COLOR.tintAmber, ink: COLOR.inkAmber },
    MEDIUM: { fill: COLOR.tintAmber, ink: COLOR.inkAmber },
    LOW:    { fill: COLOR.tintGrey,  ink: COLOR.ink },
    NONE:   { fill: COLOR.tintCoral, ink: COLOR.inkCoral },
    P1:     { fill: COLOR.blue,      ink: COLOR.white },
    P2:     { fill: COLOR.lav,       ink: COLOR.navy },
    P3:     { fill: COLOR.tintGrey,  ink: COLOR.ink },
  };
  const pillFor = (cell: string) => {
    const m = cell.trim().toUpperCase().match(/^(HIGH|MEDIUM|MED|LOW|NONE|P[1-3])(?:\s*[·—-].*)?$/);
    return m ? { key: m[1], spec: PILL[m[1]] } : null;
  };

  /** The capsule is 16pt tall and Slides insets 7.2pt of that, so a label only
   *  sits inside it up to about 7.5pt. Above that the glyphs ride out of their
   *  own pill. */
  const PILL_H = 16;
  const PILL_MAX_SIZE = 7.5;
  const PILL_MIN_SIZE = 6;

  /** ONE size per pilled column, chosen by that column's LONGEST token.
   *
   *  The tier column asked for 9pt. Its widest token, "P3 · LONG TAIL", needed
   *  108pt of an 84pt column, so it fell through to the plain-text branch —
   *  while "P1 · CORE" fitted and drew as a capsule. Three rows of one column
   *  rendered two different ways, which reads as a broken slide rather than as
   *  a considered fallback.
   *
   *  A pill column is a single visual device: it steps down until its longest
   *  token fits, and if even the floor will not fit it draws NO pills at all.
   *  Sizing each cell independently would be worse than either — a column of
   *  capsules in three different type sizes. */
  const pillSize: (number | null)[] = columns.map((_, j) => {
    const tokens: string[] = [];
    for (const r of rows) {
      const cell = r[j];
      if (!cell || !cell.trim()) continue;
      const p = pillFor(cell);
      if (!p) continue;
      // A label column is never a status pill — but a TIER token (P1/P2/P3) is
      // the row's identity, and the source draws exactly that as a pill in its
      // first column. Status words stay barred there.
      if (j === 0 && !/^P[1-3]$/.test(p.key)) continue;
      tokens.push(cell.trim());
    }
    if (!tokens.length) return null;
    const start = Math.min(cellStyle.size, PILL_MAX_SIZE);
    for (let sz = start; sz >= PILL_MIN_SIZE; sz -= 0.5) {
      let all = true;
      for (const t of tokens) if (pillWidth(t, sz) > inner(j)) { all = false; break; }
      if (all) return sz;
    }
    return null;
  });

  rows.forEach((r, i) => {
    const ry = rowYs[i];
    const rowH = rowHs[i];
    if (highlighted.has(i)) {
      out.push(...filledShape(id(`trb${i}`), page, "RECTANGLE", COLOR.tintBlue, {
        x: GRID.margin, y: ry, width: tableW, height: rowH,
      }, 0.6));
    } else if (i % 2 === 1) {
      // Zebra: the eye tracks a row across four columns on the tint, and slips
      // a row without it. Alternate rows, light, under everything in the row.
      out.push(...filledShape(id(`tz${i}`), page, "RECTANGLE", onDark ? COLOR.white : COLOR.tintBlue, {
        x: GRID.margin, y: ry, width: tableW, height: rowH,
      }, onDark ? 0.06 : 0.45));
    }
    r.forEach((cell, j) => {
      if (!cell.trim()) return;
      const pill = (() => {
        const p = pillFor(cell);
        if (!p) return null;
        return j > 0 || /^P[1-3]$/.test(p.key) ? p : null;
      })();
      const psize = pill ? pillSize[j] : null;
      if (pill && psize) {
        const label = cell.trim();
        const pw = pillWidth(label, psize);
        // A capsule keeps the 6pt even in the first column: it is a FILL, and a
        // fill flush against the band's own edge is the misalignment cellX is
        // fixing rather than an instance of the fix. Its label is centred in
        // it, so it lands within a point of the plain cells' glyph line anyway.
        const px = aligns[j] === "right" ? xs[j] + inner(j) - pw : xs[j] + CELL_X;
        const capsule = { x: px, y: ry + rowH / 2 - PILL_H / 2, width: pw, height: PILL_H };
        out.push(...filledShape(id(`tp${i}_${j}`), page, "ROUND_RECTANGLE", pill.spec.fill, capsule));
        // vCenter, because the label and the capsule are the SAME rectangle:
        // Slides top-aligns text and insets it 3.6pt, so without this the word
        // sits high in its own pill with an empty band beneath it. An offset
        // would be a guess at centring; contentAlignment is the answer.
        out.push(...textBox(id(`tc${i}_${j}`), page, label,
          { ...cellStyle, size: psize, bold: true, color: pill.spec.ink },
          capsule, { align: "CENTER", vCenter: true }));
        return;
      }
      const style = j === 0 ? { ...cellStyle, bold: true } : cellStyle;
      const capForCell = rowCaps[i];
      // Never taller than the row that holds it: when the whole table is
      // squeezed to fit, a full-height text box in a scaled-down row overlaps
      // the neighbour below — the exact collision the battery's stress table
      // caught the moment this engine landed.
      // The cell is the row's full height and its text centres in it — so a
      // one-line cell sits level with its row's pill and with the first line
      // of a two-line neighbour, instead of a computed offset that put
      // "P1 · CORE" level with the third line of its own description.
      out.push(...textBox(id(`tc${i}_${j}`), page, fitCell(cell, inner(j), style.size, capForCell), style, {
        x: xs[j] + PAD + cellX(j), y: ry - TEXT_INSET_Y / 2, width: inner(j), height: rowH + TEXT_INSET_Y,
      }, { align: aligns[j] === "right" ? "END" : "START", lineSpacing: 1.05, vCenter: true }));
    });
    if (i < rows.length - 1) {
      out.push(...filledShape(id(`trr${i}`), page, "RECTANGLE", COLOR.navy, {
        x: GRID.margin, y: ry + rowH, width: tableW, height: RULE.hairlineThickness,
      }, 0.15));
    }
  });

  const lastRowBottom = rowYs[rowYs.length - 1] + rowHs[rowHs.length - 1];
  if (opts.meta) opts.meta.bottom = lastRowBottom + (note ? 16 : 0);
  if (note) {
    const parts: string[] = [];
    if (dropped > 0) parts.push(`${rows.length} of ${allRows.length} rows`);
    if (droppedCols > 0) parts.push(`${columns.length} of ${(spec.columns || []).length} columns`);
    out.push(...textBox(id("tdrop"), page, `Showing ${parts.join(" and ")}`, TYPE.chartAxis, {
      x: GRID.margin, y: rowYs[rowYs.length - 1] + rowHs[rowHs.length - 1] + 4, width: tableW, height: 12,
    }));
  }

  if (hasRail) {
    const railX = GRID.margin + tableW + 22;
    const railW = GRID.contentWidth - tableW - 22;
    // The disc hangs 7.8pt left of the rail's box, inside the 22pt gutter
    // between the table and the prose — so the rail's words keep one left edge
    // with nothing but air between them and the table.
    out.push(...bulletBlock(id, "trail", page, String(rail).trim(), TYPE.cellText, {
      x: railX, y: top, width: railW, height: CANVAS.height - GRID.margin - top,
    }).requests);
  }
  return out;
}

/** The kit's density budget: three panel items read comfortably, four is the
 *  ceiling. Anything past that is dropped and said, never silently cut. */
export const PANEL_MAX_ITEMS = 4;

/** The master template's rounded panel beside the prose. */
function panelRequests(
  page: string, id: (s: string) => string,
  spec: NonNullable<SlideInput["panel"]>, box: { x: number; y: number; width: number; height: number },
  meta?: { bottom: number }
): Req[] {
  const soft = spec.style === "soft";
  const fill = soft ? COLOR.lav : COLOR.blue;
  const inkTitle = soft ? COLOR.navy : COLOR.white;
  const inkBody = soft ? COLOR.ink : COLOR.white;
  const allItems = (spec.items || []).filter((it) => it && (it.title?.trim() || it.text?.trim()));
  const items = allItems.slice(0, PANEL_MAX_ITEMS);

  const out: Req[] = [];
  // The panel shape is pushed once its height is known — see below.

  const PAD = 15;                       // the master's 26px inner padding, minus a step for our tighter canvas
  const innerW = box.width - PAD * 2;

  // MEASURED AGAINST THE BOX, not paid out and hoped for.
  //
  // The cursor walked down at fixed sizes and never looked at box.height, so a
  // fourth item whose text wrapped to two lines wrote its last line out through
  // the bottom of the panel and onto the slide — "…that link back to / you."
  // with "you." below the rounded corner. Panels are the one place a layout has
  // a hard, drawn edge, which is exactly why it has to be measured.
  //
  // The ladder tightens type and gaps before it drops anything; a drop is the
  // last resort and is declared on the panel.
  const PLANS = [
    { gap: 8, head: 8.5, body: 8,   lead: 1.1 },
    { gap: 6, head: 8,   body: 7.5, lead: 1.05 },
    { gap: 5, head: 7.5, body: 7,   lead: 1.0 },
    { gap: 4, head: 7,   body: 6.5, lead: 1.0 },
  ];
  const textW = innerW - 11;
  const titleStyle: TypeStyle = { font: "Roboto", size: 11, weight: 600, color: inkTitle };
  const titleH = spec.title?.trim()
    ? drawnTextHeight(estimateLines(spec.title, innerW, titleStyle.size), titleStyle.size) + 8
    : 0;
  const stackHeight = (plan: typeof PLANS[number], n: number) => {
    let h = titleH;
    for (let i = 0; i < n; i++) {
      const it = items[i];
      if (it.title?.trim()) h += drawnTextHeight(estimateLines(it.title, textW, plan.head), plan.head) + 1;
      if (it.text?.trim()) h += drawnTextHeight(estimateLines(it.text, textW, plan.body), plan.body);
      h += plan.gap;
    }
    return h;
  };
  const room = box.height - PAD * 2;
  let plan = PLANS[0];
  let count = items.length;
  const fitting = PLANS.find((p) => stackHeight(p, items.length) <= room);
  if (fitting) {
    plan = fitting;
  } else {
    // Nothing fits whole: take the tightest plan and the most items it holds,
    // keeping back the line that says so — a declaration drawn over the last
    // item would be its own version of this bug.
    plan = PLANS[PLANS.length - 1];
    count = items.length;
    while (count > 1 && stackHeight(plan, count) > room - 14) count--;
  }
  const drawn = items.slice(0, count);
  const shortfall = allItems.length - drawn.length;
  // AS TALL AS ITS STACK. The panel used to fill the whole column beside the
  // prose — 48pt of void between its heading and first item, 61pt under the
  // last — and read as padding. It is now the height of what it holds.
  const usedH = Math.min(box.height, PAD + titleH + stackHeight(plan, count) + PAD);
  out.push(...filledShape(id("pnl"), page, "ROUND_RECTANGLE", fill, { ...box, height: usedH }));
  if (meta) meta.bottom = box.y + usedH;

  let cursor = box.y + PAD;
  if (spec.title?.trim()) {
    out.push(...textBox(id("pnt"), page, spec.title, titleStyle, {
      x: box.x + PAD, y: cursor, width: innerW, height: titleH - 8,
    }));
    cursor += titleH;
  }
  drawn.forEach((it, i) => {
    // The dotted circular marker from the master, as a small open ring.
    out.push({
      createShape: {
        objectId: id(`pnm${i}`), shapeType: "ELLIPSE",
        elementProperties: {
          pageObjectId: page,
          size: { width: pt(5), height: pt(5) },
          transform: { scaleX: 1, scaleY: 1, translateX: box.x + PAD, translateY: cursor + 2, unit: "PT" },
        },
      },
    }, {
      updateShapeProperties: {
        objectId: id(`pnm${i}`),
        shapeProperties: {
          shapeBackgroundFill: { solidFill: { color: { rgbColor: rgb(soft ? COLOR.blue : COLOR.lime) } } },
          outline: { outlineFill: { solidFill: { color: { rgbColor: rgb(soft ? COLOR.blue : COLOR.lime) } } }, weight: pt(1) },
        },
        fields: "shapeBackgroundFill.solidFill.color,outline",
      },
    });
    const textX = box.x + PAD + 11;
    if (it.title?.trim()) {
      const hStyle: TypeStyle = { font: "Roboto", size: plan.head, weight: 600, color: inkTitle };
      const h = drawnTextHeight(estimateLines(it.title, textW, hStyle.size), hStyle.size);
      out.push(...textBox(id(`pnh${i}`), page, it.title, hStyle, {
        x: textX, y: cursor, width: textW, height: h,
      }, { spaceBelow: 0 }));
      cursor += h + 1;
    }
    if (it.text?.trim()) {
      const bStyle: TypeStyle = { font: "Roboto", size: plan.body, weight: 300, color: inkBody };
      const h = drawnTextHeight(estimateLines(it.text, textW, bStyle.size), bStyle.size);
      out.push(...textBox(id(`pnb${i}`), page, it.text, bStyle, {
        x: textX, y: cursor, width: textW, height: h,
      }, { spaceBelow: 0, lineSpacing: plan.lead }));
      cursor += h;
    }
    cursor += plan.gap;
  });
  if (shortfall > 0) {
    out.push(...textBox(id("pnd"), page, `Showing ${drawn.length} of ${allItems.length} items`, { font: "Roboto", size: 6, weight: 300, color: inkBody }, {
      x: box.x + PAD, y: box.y + box.height - 14, width: innerW, height: 10,
    }));
  }
  return out;
}

/** One slide → its full request list. Exported so the layout geometry can be
 *  exercised without a Google round-trip; nothing else should call it. */
/**
 * Every request for one slide, built at the deck's own density.
 *
 * The preset is fixed for the duration of this ONE call and put back in a
 * finally. Module state rather than a parameter for the reason withDensity's
 * own comment gives — 81 readers of GRID.bodyY — and safe for the reason
 * PROBING below is safe: nothing in here awaits, so no second build can
 * interleave with this one. The wrapper is where the scope lives, so that
 * every return path out of a 1,300-line function is inside it.
 */
export function buildSlideRequests(
  slide: SlideInput, index: number, run = "r0",
  /** Collects what a layout could not do, for deckWarnings. Only the hub
   *  writes to it today; every other caller leaves it out. */
  notes?: string[]
): Req[] {
  // The ink ledger is scoped exactly as the density is, and for the same
  // reason. A nested build — the splitter's body probe reaches straight back
  // in here — gets its own array, so the boxes it draws to answer a question
  // are not counted as boxes on the slide that asked it.
  const outerInk = SLIDE_INK;
  SLIDE_INK = [];
  try {
    return withDensity(densityOf(slide), () => buildSlideRequestsAt(slide, index, run, notes));
  } finally { SLIDE_INK = outerInk; }
}

function buildSlideRequestsAt(
  slide: SlideInput, index: number, run: string,
  notes?: string[]
): Req[] {
  // READ-TOLERANT, from the first line. The preview, PDF and publish routes
  // build client-held slides with no guard in front of them, so a draft saved
  // before the guard normalised — `groups` beside the title, bare-string items,
  // a hub with no layout at all — is repaired here too. It has to be HERE and
  // not in the hub branch: a layout-less hub never reaches the hub branch
  // unless the layout it is drawn as is decided from the normalised view.
  // Pure, and a no-op on every slide that is not hub-shaped.
  slide = normaliseSlide(slide);
  const layout: SlideLayout = layoutOf(slide.layout, index);
  // The ground per INSTANCE, not per layout: four or more figures put a stat
  // slide on off-white. Everything below — onDark, the page fill, the ink and
  // the lockup — follows this one decision.
  const style = slideStyle(slide, index);
  // THE RAIL THIS PAGE WILL DRAW, or undefined. Read once, here, because two
  // things downstream depend on it and they must not be able to disagree: the
  // frame draws it, and the eyebrow gives up exactly the room it takes. An
  // eyebrow narrowed for a rail that is not drawn is a short eyebrow for no
  // reason; a rail drawn over an eyebrow that kept its full measure is two
  // boxes on one line.
  const rail = layoutHoldsRail(layout) && groundHoldsRail(style) ? slide.step : undefined;
  // THE CHROME LINE, decided once. The footer's two ends and the picture
  // credit that shares the line with them all read this, so they cannot
  // disagree about where the line starts and stops — which is how a credit came
  // to be drawn across the folio and the running head at the same time.
  const chrome = chromeSpanFor(slide, layout);
  // Whether a credit will be drawn on that line at all. `cover` and `closing`
  // draw no running head, and a layout with no picture has nothing to credit.
  const creditDrawn = layout !== "cover" && layout !== "closing"
    ? slide.resolvedImage?.credit : undefined;
  const eyebrowW = eyebrowRoom(rail, GRID.margin, GRID.eyebrowWidth);
  // Object ids are scoped to this RUN, not just the slide index. On an update
  // the deck still holds the previous run's shapes when the new ones are
  // created, and Slides rejects a batch that reuses an existing objectId.
  const page = `${run}_s${index}`;
  const id = (suffix: string) => `${run}_s${index}_${suffix}`;

  const requests: Req[] = [
    {
      createSlide: {
        objectId: page,
        insertionIndex: index,
        slideLayoutReference: { predefinedLayout: "BLANK" },
      },
    },
    {
      updatePageProperties: {
        objectId: page,
        pageProperties: {
          // A photo-led layout with no image supplied falls back to navy —
          // neutral and on-brand, where a default white slide would not be.
          pageBackgroundFill: {
            solidFill: { color: { rgbColor: rgb(style.background ?? COLOR.navy) } },
          },
        },
        fields: "pageBackgroundFill.solidFill.color",
      },
    },
  ];

  // Photograph first, so every text box lands on top of it. A section divider
  // is photo-led when it has a picture (the prompt asks for one) and falls back
  // to the flat blue ground when it does not — the image used to be resolved,
  // and paid for, then never drawn.
  const sectionPhoto = layout === "section" && !!slide.resolvedImage;
  // A SCREENSHOT ON `feature` IS NOT A BLEED. It is matted on the navy stage
  // the style above chose for it, so no full-canvas image and no credit line
  // are drawn here — the branch below places the picture itself.
  if (style.background === null || (layout === "feature" && !isScreenshot(slide)) || sectionPhoto) {
    requests.push(...backdropRequests(page, id, slide));
  }
  /** A layout's own clause for deckWarnings — only the hub, and now the
   *  screenshot branches, write to it. */
  const shotNote = (s: string) => { if (notes) notes.push(s); };
  // Callouts on a layout that cannot draw them are DECLARED rather than
  // silently ignored: the model asked for a pointer and got none, and only it
  // can move the slide to a layout that points.
  {
    const asked = (slide.image?.callouts || []).filter((c) => c && String(c.text || "").trim()).length;
    if (asked && !drawsCallouts(layout)) {
      shotNote(`callouts are drawn on ${CALLOUT_LAYOUTS} only — this slide is a ${layout}, so its ${asked}` +
        ` callout${asked === 1 ? "" : "s"} ${asked === 1 ? "was" : "were"} not drawn; move it to image-split`);
    }
  }
  /** Where this slide's content ENDS, set by layouts that size their boxes to
   *  their words. The takeaway bar sits just beneath it. Left unset, the bar
   *  keeps its old place at the foot of the band. */
  let contentBottom: number | undefined;
  /** Set by a layout that has already drawn the note on the slide itself —
   *  the Venn's sidebar — so the generic bar is not drawn as well. */
  let noteDrawn = false;

  const onDark = style.onDark;
  const bodyStyle = onDark ? TYPE.bodyDark : TYPE.body;
  const eyebrowStyle = onDark ? TYPE.eyebrowDark : TYPE.eyebrow;

  // The heading, fitted to the room it actually has. Every layout below draws
  // its title from THIS, not from the grid constants, so a long title can never
  // again be drawn through the body underneath it.
  // Prose layouts set their title on the same measure as their body, so the
  // two align and the heading is fitted to the width it will actually occupy.
  const isProse = layout === "content" || layout === "case-study" || layout === "dark-index";
  // A panel narrows the prose exactly as a rail does — the title has to be
  // measured against the width it will actually be drawn in, or fitHeading
  // fits it to a column the panel is about to take a third of.
  // The content band, shortened when a takeaway bar is present. Computed once
  // here so every layout below measures against the same number.
  const hasPanel = !!(slide.panel && ((slide.panel.items || []).length || slide.panel.title?.trim()));
  // ONE decision about whether the right-hand column is taken — by a picture
  // rail or a panel — and every width that depends on it reads this boolean.
  //
  // The prose column always narrowed for it. The takeaway bar did not: it was
  // drawn at full content width on every layout, so on any prose slide with a
  // photograph the slide's key sentence ran underneath the picture. Deriving
  // the bar's width here, beside the column's, rather than re-testing for a
  // rail at the call site, is what keeps the two from drifting apart again.
  const rightColumnTaken = isProse && !!(railBox(slide) || hasPanel);
  const proseColumn = isProse
    ? (rightColumnTaken ? GRID.proseNarrow : GRID.proseWidth)
    : GRID.contentWidth;
  // THE TAKEAWAY BAR SITS ON THE MEASURE THIS PAGE'S WORDS HAVE, which is not
  // always the content measure. Where a picture bleeds off the RIGHT the bar
  // narrows and keeps its left edge; on the photo rail the picture is on the
  // LEFT, so the bar has to MOVE — drawn from the page margin it was painted
  // across the bottom corner of the photograph, which is the same fault the
  // chrome span already fixes for the bleeding rail one band down.
  const noteX = layout === "photo-rail" ? PHOTO_RAIL.textX : GRID.margin;
  const noteWidth = layout === "photo-rail" ? PHOTO_RAIL.textWidth
    : rightColumnTaken ? GRID.proseNarrow : GRID.contentWidth;
  // After the width is known: the band is shortened by the note's height AT
  // that width, so the prose above leaves room for the bar it actually gets.
  const band = bandHeightFor(slide, noteWidth);
  const titleWidth = layout === "image-split" ? IMAGE.splitTextWidth
    : layout === "photo-rail" ? PHOTO_RAIL.textWidth : proseColumn;
  // image-split sets its title in a HALF-WIDTH column, so the same words take
  // roughly twice the lines. Measuring it against the full-width title band
  // was survivable while that band was tall; once it tightened, a two-line
  // title in a narrow column ran out of its box and onto the body beneath.
  // Its body starts under the title rather than at a fixed y, so the extra
  // room costs nothing.
  // THE ALLOWANCE BELONGS TO A LAYOUT WITH NO RULE UNDER ITS TITLE, and
  // `photo-rail` was given it for one render before the render showed why not.
  // image-split sets its heading in a 315pt column and lets it reach 34pt past
  // GRID.bodyY, which costs nothing there because its body starts under the
  // title and nothing else is drawn on that line. The photo rail has a rule on
  // that line — the one that starts at the picture's right edge and is the
  // whole reason its pages look like the source's — so the same allowance drew
  // a hairline straight through "Put the audience first". Its title is fitted
  // to end above the rule like every other ruled layout; the narrow measure is
  // already handled by `titleWidth` below, which is what decides the SIZE.
  const split = layout === "image-split";
  // THE LADDER IS THE PRESET'S, not this call site's. At `read` every one of
  // these four is what it has always been — the floor is TITLE_MIN_SIZE, the
  // ceiling is six points under the eyebrow's box, and with no rungs the
  // ladder still steps down a point at a time.
  const heading = fitHeading(slide.title, onDark ? TYPE.slideTitleDark : TYPE.slideTitle, titleWidth, {
    bottom: GRID.bodyY - TITLE_GAP + (split ? 34 : 0),
    minTop: density().titleMinTop,
    minHeight: GRID.titleHeight,
    minSize: density().titleMinSize,
    rungs: density().titleRungs,
  });
  const titleStyle = heading.style;
  const titleBox = { y: heading.y, height: heading.height };

  if (layout === "cover") {
    if (!slide.resolvedImage) {
      // A COVER WITH NO PHOTOGRAPH used to be a plain navy slide with a title in
      // the corner — the dullest possible opening. Designed instead: an accent
      // rule, a centred title, the kicker beneath, on navy. The photo cover is
      // still the default (the prompt asks for an image.query), but the deck no
      // longer opens on nothing when there is not one.
      // The accent rule is drawn 22pt above the title, so the TITLE's ceiling
      // is what keeps the rule off the logo. At a 0.24-height ceiling the rule
      // landed at y=103 while the logo runs 55.4 to 111.6 — a lime bar struck
      // straight through the wordmark on the cover of a client deck, and no
      // geometry check looked at the logo because nothing else on a cover goes
      // near it. The ceiling is now derived from the logo's own box, and the
      // floor drops to make room for the title that has to fit under it.
      const logoFloor = LOGO_PLACEMENT.cover.y + LOGO_PLACEMENT.cover.height;
      const np = fitHeading(slide.title, TYPE.coverTitle, GRID.contentWidth, {
        bottom: CANVAS.height * 0.62, minTop: logoFloor + 10 + 22,
        minHeight: GRID.coverTitleHeight, minSize: 22,
      });
      requests.push(
        ...filledShape(id("crule"), page, "RECTANGLE", COLOR.lime, {
          x: (CANVAS.width - RULE.accentWidth) / 2, y: np.y - 22, width: RULE.accentWidth, height: RULE.thickness,
        }),
        ...textBox(id("title"), page, slide.title, np.style, {
          x: GRID.margin, y: np.y, width: GRID.contentWidth, height: np.height,
        }, { align: "CENTER" }),
        ...textBox(id("sub"), page, slide.subtitle, TYPE.closingKicker, {
          x: GRID.margin, y: np.y + np.height + 12, width: GRID.contentWidth, height: 28,
        }, { align: "CENTER" }),
      );
    } else {
      // Bottom-anchored over the photo: the kicker sits under it and a three-line
      // title used to be drawn straight over it.
      const cover = fitHeading(slide.title, TYPE.coverTitle, GRID.coverTitleWidth, {
        bottom: GRID.coverKickerY - 10,
        minTop: CANVAS.height * 0.3,
        minHeight: GRID.coverTitleHeight,
        minSize: 20,
      });
      requests.push(
        ...textBox(id("title"), page, slide.title, cover.style, {
          x: GRID.coverTitleX, y: cover.y,
          width: GRID.coverTitleWidth, height: cover.height,
        }),
        ...textBox(id("sub"), page, slide.subtitle, TYPE.coverKicker, {
          x: GRID.coverKickerX, y: GRID.coverKickerY,
          width: GRID.coverKickerWidth, height: GRID.coverKickerHeight,
        }),
      );
    }
  } else if (layout === "closing") {
    // THE STACK MOVES UP WHEN THE BODY IS LONG. The action lines live between
    // the sign-off and the logo; measured honestly, a resources line plus two
    // contact lines did not fit there, and clamping the box merely clipped
    // them mid-glyph. So the body's need is measured FIRST, and title and
    // sign-off shift up by the shortfall — the source's own closing sets its
    // thank-you high for exactly this reason.
    const closingLines = (slide.body || "").split("\n").map((l) => l.trim()).filter(Boolean);
    const closingDrawn = closingLines.reduce((n, l) => n + estimateLines(l, GRID.contentWidth, TYPE.closingAction.size), 0);
    const closingNeed = closingLines.length
      ? drawnTextHeight(closingDrawn, TYPE.closingAction.size, 8, closingLines.length) + 4 : 0;
    const closingLogoTop = LOGO_PLACEMENT.closing.y - 10;
    const closingRoom = closingLogoTop - (GRID.closingSubtitleY + GRID.closingSubtitleHeight + 14);
    const closingShift = Math.max(0, Math.min(70, closingNeed - closingRoom));
    const closingSubY = GRID.closingSubtitleY - closingShift;
    const closing = fitHeading(slide.title, TYPE.coverTitle, GRID.contentWidth, {
      bottom: closingSubY - 10,
      minTop: GRID.eyebrowY + GRID.eyebrowHeight + 6,
      minHeight: GRID.closingTitleHeight,
      minSize: 20,
    });
    requests.push(
      ...textBox(id("title"), page, slide.title, closing.style, {
        x: GRID.margin, y: closing.y,
        width: GRID.contentWidth, height: closing.height,
      }, { align: "CENTER" }),
      ...textBox(id("sub"), page, slide.subtitle, TYPE.closingKicker, {
        x: GRID.margin, y: closingSubY,
        width: GRID.contentWidth, height: GRID.closingSubtitleHeight,
      }, { align: "CENTER" }),
    );
    // The close ACTS: a bare "Thank You" ends the deck on nothing, so a body —
    // one action per line, an email, a next step, a URL — is drawn centred
    // beneath the sign-off. The deck's last slide is the one that says what to
    // do now.
    if (slide.body?.trim()) {
      const lines = closingLines;
      const y = closingSubY + GRID.closingSubtitleHeight + 14;
      // Measured (see closingNeed above), and stopping above the logo: the
      // stack has already moved up to make this fit.
      const h = Math.min(closingLogoTop - y, closingNeed);
      requests.push(...textBox(id("body"), page, lines.join("\n"), TYPE.closingAction, {
        x: GRID.margin, y, width: GRID.contentWidth, height: Math.max(22, h),
      }, { align: "CENTER", spaceBelow: 8 }));
    }
  } else if (layout === "section") {
    // A NUMERIC eyebrow ("01", "3") is the divider's index — drawn large in the
    // brand lime, the source deck's signature divider device. A worded eyebrow
    // ("PART ONE") is the KICKER, and it lives in the lockup below, not in the
    // page-header slot. This is not the killed "parse Part N" regex; it only
    // treats a bare number as a numeral, so it cannot misfire on "Teil 02" or
    // any localised label.
    //
    // AND ON A STEPPED DECK THE NUMBER IS THE BUILDER'S, not the model's. The
    // rail is derived and re-derived on every edit precisely because a static
    // number lies the moment someone inserts a chapter; a 64pt static numeral
    // beside it inherits that objection ten times over. Insert a chapter and
    // the deck would draw two dividers both saying "02" while the rail under
    // them counts 2 and 3. So the model's numeral says THAT this divider is
    // numbered and in what form ("01" or "1"), and the spine says which.
    const written = slide.eyebrow?.trim().match(/^\d{1,2}$/)?.[0];
    const numeral = written && slide.step
      ? (String(slide.step.n).length < written.length
        ? "0".repeat(written.length - String(slide.step.n).length) + String(slide.step.n)
        : String(slide.step.n))
      : written;
    // THE NUMERAL IS PART OF THE LOCKUP, not a mark in the corner.
    //
    // It kept the page-header slot while the kicker, title and subtitle were
    // measured as a block and centred on the canvas — so a divider drew a 64pt
    // lime numeral at the top, then 80pt of empty blue, then its lockup, then
    // 146pt more empty blue down to the footer. Rendered and looked at, it is
    // the emptiest page in the deck and the one a reader hits three times.
    // Joined to the stack it is what it says it is — the first line of the
    // chapter's own title block — and the whole group takes the middle of the
    // page. The photo divider gains by the same move: the numeral lands where
    // the baked gradient is solved rather than over an unknown corner.
    const numeralH = numeral
      ? drawnTextHeight(1, TYPE.sectionNumeral.size, 0, 1, SECTION.titleLead) : 0;

    // ONE LOCKUP. Kicker, title and subtitle are measured as a stack and the
    // stack is centred on the canvas as a group — the reference's divider is a
    // 111pt block with 16pt and 13pt of air in it. The old code drew the kicker
    // at y=36, the title in a fixed 100pt box at y=152 and the subtitle at
    // y=257: three orphaned lines with 125pt and 76pt of empty blue between
    // them, and a running header where the title's label should be.
    const kicker = numeral ? "" : (slide.eyebrow || "").trim();
    const kickerH = kicker
      ? drawnTextHeight(estimateLines(kicker, GRID.contentWidth, TYPE.sectionKicker.size, false, true), TYPE.sectionKicker.size)
      : 0;
    const subText = (slide.subtitle || "").trim();
    // WHITE on a photograph: the baked gradient guarantees 4.5:1 for white, and
    // the standfirst grey (#EBEBEB) lands at ~3.8:1 on the same pixels. On the
    // flat blue field that grey is 4.7:1 and is the reference's muted second
    // voice under a white title.
    const subStyle = sectionPhoto ? { ...TYPE.standfirstDark, color: COLOR.white } : TYPE.standfirstDark;
    const subLines = subText ? estimateLines(subText, GRID.contentWidth, subStyle.size) : 0;
    const subH = subLines ? drawnTextHeight(subLines, subStyle.size) : 0;
    // The room the stack may use: under the numeral (or the header slot) and
    // above the takeaway bar when there is one — `band` is already shortened
    // for it — so the stack is never drawn through the bar.
    const stackCeiling = SECTION.minTop;
    const stackFloor = GRID.bodyY + band;
    const aboveTitle = (kicker ? kickerH + SECTION.kickerGap : 0) + numeralH;
    const belowTitle = subText ? SECTION.subtitleGap + subH : 0;
    // The title is fitted to what is LEFT once the kicker and subtitle have
    // taken theirs, and shrinks — to SECTION.titleMinSize — rather than pushing
    // the subtitle onto the bar or the footer. Measured at the lead it is
    // drawn at, or the box carries slack the subtitle would sit under.
    const sec = fitHeading(slide.title, TYPE.sectionTitle, GRID.contentWidth, {
      bottom: stackFloor - belowTitle,
      minTop: stackCeiling + aboveTitle,
      minHeight: drawnTextHeight(1, TYPE.sectionTitle.size, 0, 1, SECTION.titleLead),
      minSize: SECTION.titleMinSize,
      lineSpacing: SECTION.titleLead,
    });
    const stackH = aboveTitle + sec.height + belowTitle;
    let y = Math.max(stackCeiling, Math.min(CANVAS.height / 2 - stackH / 2, stackFloor - stackH));
    if (numeral) {
      requests.push(...textBox(id("num"), page, numeral, TYPE.sectionNumeral, {
        x: GRID.margin, y, width: SECTION.numeralWidth, height: numeralH,
      }, { lineSpacing: SECTION.titleLead, spaceBelow: 0 }));
      y += numeralH;
    }
    if (kicker) {
      requests.push(...textBox(id("eyebrow"), page, kicker, TYPE.sectionKicker, {
        x: GRID.margin, y, width: GRID.contentWidth, height: kickerH,
      }));
      y += kickerH + SECTION.kickerGap;
    }
    // spaceBelow 0: a title the model stacks with a newline ("Understand\n&
    // Diagnose", the reference's own device) keeps the same pitch as one that
    // wraps, instead of opening a 6pt paragraph gap in the middle of the block.
    requests.push(...textBox(id("title"), page, slide.title, sec.style, {
      x: GRID.margin, y, width: GRID.contentWidth, height: sec.height,
    }, { lineSpacing: SECTION.titleLead, spaceBelow: 0 }));
    y += sec.height;
    if (subText) {
      y += SECTION.subtitleGap;
      // id "sub", not "body": the preview maps "sub" to the spec path
      // ["subtitle"], so an in-place edit lands on the field that was drawn.
      // Under "body" it wrote slide.body, which the divider never draws.
      requests.push(...textBox(id("sub"), page, subText, subStyle, {
        x: GRID.margin, y, width: GRID.contentWidth, height: subH,
      }));
      y += subH;
    }
    // contentBottom is deliberately left unset: the lockup is centred as a
    // group, so a takeaway bar (rare on a divider) keeps its place at the foot
    // rather than following the stack to mid-page. stackFloor already keeps
    // the stack clear of it by NOTE.gap.
  } else if (layout === "timeline") {
    requests.push(
      ...textBox(id("eyebrow"), page, slide.eyebrow, eyebrowStyle, {
        x: GRID.margin, y: GRID.eyebrowY,
        width: eyebrowW, height: GRID.eyebrowHeight,
      }),
      ...textBox(id("title"), page, slide.title, titleStyle, {
        x: GRID.margin, y: titleBox.y, width: GRID.contentWidth, height: titleBox.height,
      }),
      ...textBox(id("sub"), page, slide.subtitle, bodyStyle, {
        x: GRID.margin, y: GRID.bodyY, width: GRID.contentWidth, height: 20,
      }),
      ...timelineRequests(page, id, slide.milestones || []),
    );
  } else if (layout === "quote") {
    requests.push(
      ...textBox(id("eyebrow"), page, slide.eyebrow, eyebrowStyle, {
        x: GRID.margin, y: GRID.eyebrowY,
        width: eyebrowW, height: GRID.eyebrowHeight,
      }),
      ...(slide.quote ? quoteRequests(page, id, slide.quote) : []),
    );
  } else if (layout === "process" || layout === "logo-wall") {
    requests.push(
      ...textBox(id("eyebrow"), page, slide.eyebrow, eyebrowStyle, {
        x: GRID.margin, y: GRID.eyebrowY,
        width: eyebrowW, height: GRID.eyebrowHeight,
      }),
      ...textBox(id("title"), page, slide.title, titleStyle, {
        x: GRID.margin, y: titleBox.y, width: GRID.contentWidth, height: titleBox.height,
      }),
    );
    if (layout === "process") {
      // The row starts on the band's top edge and measures against the band
      // the takeaway bar has already shortened; where it ends is where the
      // bar goes.
      const processMeta = { bottom: 0 };
      requests.push(...processRequests(page, id, slide.stages || [], GRID.bodyY, band, processMeta));
      if (processMeta.bottom) contentBottom = processMeta.bottom;
    } else {
      requests.push(...logoWallRequests(page, id, slide.logos || []));
    }
  } else if (layout === "cards") {
    requests.push(
      ...textBox(id("eyebrow"), page, slide.eyebrow, eyebrowStyle, {
        x: GRID.margin, y: GRID.eyebrowY,
        width: eyebrowW, height: GRID.eyebrowHeight,
      }),
      ...textBox(id("title"), page, slide.title, titleStyle, {
        x: GRID.margin, y: titleBox.y, width: GRID.contentWidth, height: titleBox.height,
      }),
    );
    // The row starts under the standfirst when there is one, and under the
    // title band when there is not — CARDS.y was a fixed constant, which held
    // while the grid never moved and stopped holding the day it did.
    let cardsTop = GRID.bodyY;
    if (slide.subtitle?.trim()) {
      const standStyle = onDark ? TYPE.standfirstDark : TYPE.standfirst;
      const standH = drawnTextHeight(
        estimateLines(slide.subtitle, GRID.contentWidth, standStyle.size), standStyle.size);
      requests.push(...textBox(id("sub"), page, slide.subtitle, standStyle, {
        x: GRID.margin, y: GRID.bodyY, width: GRID.contentWidth, height: standH,
      }));
      cardsTop = GRID.bodyY + standH + 10;
    }
    // The strip and the note both take their room from the card row, so the
    // three stack without touching: cards, strip, note, footer.
    const bandBottom = GRID.bodyY + band;
    const stripItems = (slide.strip?.items || []).length || (slide.strip?.title?.trim() ? 1 : 0);
    const stripH = stripItems ? Math.min(88, Math.max(48, 20 + 44)) : 0;
    const cardsH = Math.max(80, bandBottom - cardsTop - (stripH ? stripH + 10 : 0));
    const cardsMeta = { bottom: 0 };
    // The row takes the band's slack only when nothing below it is measured
    // from where the cards end — the spanning strip is, and a centred row would
    // push it into the reserve it was given.
    requests.push(...cardsRequests(page, id, slide.cards || [], cardsTop, cardsH, cardsMeta, !stripH));
    if (cardsMeta.bottom) contentBottom = cardsMeta.bottom;
    if (stripH && slide.strip) {
      const stripTop = (cardsMeta.bottom || cardsTop + cardsH) + 10;
      // THE STRIP IS BOUNDED BY THE BAND, not by the room the cards left over.
      //
      // The reservation above is honest until `cardsH`'s own 80pt floor wins —
      // a row of cards shorter than that is not a row of cards — and then the
      // cards end wherever they end and the strip is drawn under them. The
      // floor only wins on a band short enough, and the standfirst is what
      // decides that: at read's 270pt band it never happens, and at `present`
      // three lines of 14pt standfirst over five tinted cards put the strip's
      // whole panel 18pt past the bottom of the page and its last cell into
      // the folio's slot.
      //
      // Half a point of slack, so a strip that fits keeps the float it already
      // had: the reservation and this subtraction are the same arithmetic in
      // the opposite order, and an ulp between them would rewrite the height of
      // every strip in the corpus.
      const room = bandBottom - stripTop;
      const drawnH = room >= stripH - 0.5 ? stripH : room;
      // Under its own minimum the strip is NOT DRAWN SHORTER — its cells are
      // floored at 24pt and would hang out of the panel they sit in, which is a
      // worse slide than no strip. The words are not lost: droppedContent walks
      // the spec and reports every string this build did not draw.
      if (drawnH >= STRIP_MIN_H) {
        requests.push(...stripRequests(page, id, slide.strip, stripTop, drawnH));
        contentBottom = stripTop + drawnH;
      }
    }
  } else if (layout === "layers") {
    requests.push(
      ...textBox(id("eyebrow"), page, slide.eyebrow, eyebrowStyle, {
        x: GRID.margin, y: GRID.eyebrowY,
        width: eyebrowW, height: GRID.eyebrowHeight,
      }),
      ...textBox(id("title"), page, slide.title, titleStyle, {
        x: GRID.margin, y: titleBox.y, width: GRID.contentWidth, height: titleBox.height,
      }),
    );
    let diagTop = GRID.bodyY;
    if (slide.subtitle?.trim()) {
      const standStyle = onDark ? TYPE.standfirstDark : TYPE.standfirst;
      const standH = drawnTextHeight(
        estimateLines(slide.subtitle, GRID.contentWidth, standStyle.size), standStyle.size);
      requests.push(...textBox(id("sub"), page, slide.subtitle, standStyle, {
        x: GRID.margin, y: GRID.bodyY, width: GRID.contentWidth, height: standH,
      }));
      diagTop = GRID.bodyY + standH + 8;
    }
    // A diagram earns the note bar's gap when there is no note: the source
    // page runs nearly full height, and 12pt is the difference between five
    // bands fitting and the last one falling off the canvas.
    // The room is the band, exactly. The 12pt the diagram borrowed when there
    // was no note ran the last band to 386, under the footer at 381; the
    // ladder inside layersRequests is what fits five bands now. The diagram
    // reports where it ends so the takeaway bar follows it (Phase A rule).
    const lay = layersRequests(page, id, slide.layers || [], diagTop, Math.max(100, GRID.bodyY + band - diagTop));
    requests.push(...lay.requests);
    contentBottom = lay.bottom;
  } else if (layout === "hub") {
    requests.push(
      ...textBox(id("eyebrow"), page, slide.eyebrow, eyebrowStyle, {
        x: GRID.margin, y: GRID.eyebrowY,
        width: eyebrowW, height: GRID.eyebrowHeight,
      }),
      ...textBox(id("title"), page, slide.title, titleStyle, {
        x: GRID.margin, y: titleBox.y, width: GRID.contentWidth, height: titleBox.height,
      }),
    );
    let hubTop = GRID.bodyY;
    if (slide.subtitle?.trim()) {
      const standStyle = onDark ? TYPE.standfirstDark : TYPE.standfirst;
      const standH = drawnTextHeight(
        estimateLines(slide.subtitle, GRID.contentWidth, standStyle.size), standStyle.size);
      requests.push(...textBox(id("sub"), page, slide.subtitle, standStyle, {
        x: GRID.margin, y: GRID.bodyY, width: GRID.contentWidth, height: standH,
      }));
      hubTop = GRID.bodyY + standH + 8;
    }
    // `slide` is already the normalised view (the first line of this
    // function), the same one the generate_slides guard stores. The diagram
    // reports where it ends so the takeaway bar follows it.
    const hubbed = hubRequests(page, id, slide.hub || {}, hubTop, Math.max(100, GRID.bodyY + band - hubTop), notes);
    requests.push(...hubbed.requests);
    contentBottom = hubbed.bottom;
  } else if (layout === "stat" || layout === "bar-chart" || layout === "stacked-bar" || layout === "line-chart") {
    requests.push(
      ...textBox(id("eyebrow"), page, slide.eyebrow, eyebrowStyle, {
        x: GRID.margin, y: GRID.eyebrowY,
        width: eyebrowW, height: GRID.eyebrowHeight,
      }),
      ...textBox(id("title"), page, slide.title, titleStyle, {
        x: GRID.margin, y: titleBox.y, width: GRID.contentWidth, height: titleBox.height,
      }),
    );

    // The standfirst — the FINDING the chart proves, in a sentence, under an
    // assertion title. On the chart layouts the subtitle used to be dropped
    // entirely: the one slot for a takeaway line was discarded on exactly the
    // slides that carry evidence. When present it takes the top of the band and
    // the plot starts beneath it.
    //
    // `stat` IS STILL EXCLUDED HERE, and draws its own standfirst below,
    // because it is the one layout in this branch that has to BUY the line
    // rather than simply place it. A plot is a solved rectangle and shrinks to
    // whatever band it is handed; the figures are up to eight cards on a five-
    // rung ladder that starts dropping data once the rungs run out, so the
    // same two statements — "draw the subtitle, start the content beneath it"
    // — mean "the plot is a little shorter" here and "one of the figures is
    // gone" there. Chris decided on 2026-09-17 that it gets drawn on `stat`
    // (docs/PLAN-slides-creative-2026-09.md, Stage 0), and the half of that
    // decision about `image-split` is written where someone could act on it —
    // in the image-split branch itself, which never reaches this condition.
    let chartBandTop = GRID.bodyY;
    if (slide.subtitle?.trim() && layout !== "stat") {
      const standStyle = onDark ? TYPE.standfirstDark : TYPE.standfirst;
      const standH = drawnTextHeight(
        estimateLines(slide.subtitle, GRID.contentWidth, standStyle.size), standStyle.size
      );
      requests.push(...textBox(id("sub"), page, slide.subtitle, standStyle, {
        x: GRID.margin, y: GRID.bodyY, width: GRID.contentWidth, height: standH,
      }));
      chartBandTop = GRID.bodyY + standH + STANDFIRST_GAP;
    }

    if (layout === "stat") {
      // A stat slide's BODY is its second row of figures — the supporting
      // numbers a source page sets under the headline ones. The layout never
      // drew it, so a page of seven figures came out as four and an empty
      // middle, which was the very first thing the client noticed. With a
      // body the headline row takes the upper share of the band and the body
      // the rest; without one the row stays centred as before.
      //
      // The split used to be a flat 56% of the band, with the body placed at
      // that mark whatever the figures above it did. The moment the labels were
      // measured honestly the block grew past the mark, and the source lines
      // were drawn through the first bullet. So: top-align the figures when
      // there is a body, and start the body where they actually end.
      const hasBody = !!slide.body?.trim();
      const grid = isStatGrid(slide.stats);
      // The grid is top-aligned whenever something follows it — bullets, or
      // the takeaway — so the bar sits just under the cards and the slack
      // falls BELOW the bar, where the reference page leaves it. Alone, it
      // centres in the band like every other self-contained block.
      const topAlign = hasBody || (grid && !!slide.note?.trim());
      const bodyBase = onDark ? TYPE.bodyDark : TYPE.body;

      // ── THE STANDFIRST, WHEN THE FIGURES CAN PAY FOR IT ────────────────────
      //
      // A headline number with a line of context beneath the title is a better
      // slide than a bare number, and the model has been writing that line all
      // along: over the 39 decks built to 2026-09-16, thirteen stat slides
      // carried a `subtitle` that this layout drew nowhere, and droppedContent
      // reported every one of them. Chris decided on 2026-09-17 that it gets
      // drawn here.
      //
      // Not by simply deleting the exclusion, though — that is the version
      // that looks right and prints the standfirst THROUGH the figures. The
      // chart layouts hand `chartBandTop` to a plot that redraws itself in
      // whatever is left; `stat` hands the whole band to statRequests, so the
      // line of type would have been drawn at the top of a band the figures
      // still believed they owned. The band is re-split instead: the
      // standfirst takes the top of it, the figures are given the rest, and
      // every measurement inside the block — the rung ladder, the honest label
      // heights, the centring, the hero's solved size — now works from
      // `bandTop` rather than from `GRID.bodyY`.
      //
      // AND THE FIGURES ARE NOT MADE TO PAY. The ladder will always make room
      // if it is asked to: it steps down five rungs, then gives up the source
      // lines, then starts dropping figures — each of which it declares, so a
      // standfirst bought that way would be a slide that traded a number for a
      // sentence and said so in 7pt. So the block is laid out BOTH ways and
      // compared, and the line is drawn only when the figures and the bullets
      // beneath them come out exactly as they would have without it. When they
      // do not, nothing is clipped and nothing is quietly half-drawn: the
      // subtitle is left undrawn and the deck SAYS the field could not be
      // placed. The note names the field and deliberately does not quote the
      // line, because droppedContent leaves text a note has already quoted to
      // that note — quoting it here would make "nothing was dropped" true by
      // suppression and blind the audit at the same time.
      let bandTop = GRID.bodyY;
      const sub = String(slide.subtitle || "").trim();
      if (sub) {
        const standStyle = onDark ? TYPE.standfirstDark : TYPE.standfirst;
        const standH = drawnTextHeight(estimateLines(sub, GRID.contentWidth, standStyle.size), standStyle.size);
        const under = GRID.bodyY + standH + STANDFIRST_GAP;
        // The probe is handed exactly what the real call below is handed, so
        // what it measures is what will be drawn and not a tidied version of it.
        const asIs = statProbe(slide.stats || [], band, onDark, topAlign, GRID.bodyY);
        const after = statProbe(slide.stats || [], band, onDark, topAlign, under);
        // The prose is asked the same question the figures are: not "does it
        // fit" but "does it come out the same". A body pushed from 10pt to 8pt
        // to make room for a standfirst is the slide's argument demoted to a
        // footnote, and it is a silent demotion — so it counts as unaffordable
        // rather than as a step-down to declare.
        //
        // SAME OUTCOME, not absolute fit. This read `now.fits && …`, which is
        // a stricter rule than the one stated above and it cost a real slide
        // its line: a hero figure reports the whole band as its height, so the
        // bullets under a single big number are already placed below the band
        // floor and overrun whatever the standfirst does (conversation
        // df7700f1, slide 15 — the prose is byte-identical either way, and the
        // line was refused anyway). Prose that is already overrunning must not
        // be made to pay a second time; it is the pre-existing overrun that
        // wants fixing, not the sentence above it. So the test is that the
        // outcome and the size are unchanged, and — for the already-overrunning
        // case, where "unchanged" cannot be read off a size alone — that the
        // box beneath the figures has not been pushed down as well.
        const proseKept = !hasBody || (() => {
          const roomOf = (bottom: number) => Math.max(30, GRID.bodyY + band - (bottom + STAT_BODY_GAP));
          const was = statBodyFit(slide.body as string, roomOf(asIs.bottom), bodyBase);
          const now = statBodyFit(slide.body as string, roomOf(after.bottom), bodyBase);
          if (was.fits !== now.fits || was.style.size !== now.style.size) return false;
          return now.fits || after.bottom <= asIs.bottom + 0.01;
        })();
        if (after.drawn === asIs.drawn && after.ink <= GRID.bodyY + band + 0.01 && proseKept) {
          requests.push(...textBox(id("sub"), page, sub, standStyle, {
            x: GRID.margin, y: GRID.bodyY, width: GRID.contentWidth, height: standH,
          }));
          bandTop = under;
        } else {
          // THE REMEDY HAS TO BE FREE ON THIS SLIDE. "Move it to `note`" is
          // sound advice on a slide with no takeaway and wrong on one that has
          // one — and a takeaway is usually WHY the band ran out, since
          // bandHeightFor takes the bar's height out of it. Measured across
          // every stat shape: of the slides that refuse, most already carry a
          // `note`, so the unconditional wording pointed the model at a field
          // it would have had to overwrite. When the bar is already there the
          // honest advice is the other direction — shortening it gives the
          // band back, which is the same room the standfirst was asking for.
          shotNote(
            "the standfirst in `subtitle` is not drawn on this stat slide: the figures need the whole band," +
            " and a line of context above them would cost a figure, its source line or the prose beneath —" +
            (slide.note?.trim()
              ? " shorten it, or shorten the takeaway in `note`, which is taking part of the band"
              : " move it to `note` for the takeaway bar, or shorten it")
          );
        }
      }

      const stat = statRequests(page, id, slide.stats || [], band, onDark, topAlign, bandTop);
      requests.push(...stat.reqs);
      if (grid && !hasBody) contentBottom = stat.bottom;
      if (hasBody) {
        const bodyTop = bandTop + stat.height + STAT_BODY_GAP;
        const room = Math.max(30, GRID.bodyY + band - bodyTop);
        // The bullets step down to what fits under the figures — 10, 9, then
        // the 8pt floor — because Slides draws an overflowing body straight
        // through the takeaway bar beneath it, which is what happened the
        // moment the bar came up off the bezel.
        const bodyStyle2 = statBodyFit(slide.body as string, room, bodyBase).style;
        requests.push(...bulletBlock(id, "body", page, slide.body, bodyStyle2, {
          x: GRID.margin, y: bodyTop, width: GRID.contentWidth, height: room,
        }).requests);
        contentBottom = bodyTop + room;
      }
    }
    else if (slide.chart) {
      requests.push(...(
        layout === "stacked-bar" ? stackedBarRequests(page, id, slide.chart, onDark, chartBandTop, band)
        : layout === "line-chart" ? lineChartRequests(page, id, slide.chart, onDark, chartBandTop, band)
        : barChartRequests(page, id, slide.chart, onDark, chartBandTop, band)));
    }
  } else if (layout === "swot" || layout === "matrix" || layout === "comparison" || layout === "table" || layout === "scatter" || layout === "venn") {
    requests.push(
      ...textBox(id("eyebrow"), page, slide.eyebrow, eyebrowStyle, {
        x: GRID.margin, y: GRID.eyebrowY, width: eyebrowW, height: GRID.eyebrowHeight,
      }),
      ...textBox(id("title"), page, slide.title, titleStyle, {
        x: GRID.margin, y: titleBox.y, width: GRID.contentWidth, height: titleBox.height,
      }),
    );
    let aTop = GRID.bodyY;
    if (slide.subtitle?.trim()) {
      const standStyle = onDark ? TYPE.standfirstDark : TYPE.standfirst;
      const standH = drawnTextHeight(estimateLines(slide.subtitle, GRID.contentWidth, standStyle.size), standStyle.size);
      requests.push(...textBox(id("sub"), page, slide.subtitle, standStyle, {
        x: GRID.margin, y: GRID.bodyY, width: GRID.contentWidth, height: standH,
      }));
      aTop = GRID.bodyY + standH + 8;
    }
    if (layout === "swot" && slide.swot) requests.push(...swotRequests(page, id, slide.swot, aTop, GRID.bodyY + band));
    else if (layout === "matrix" && slide.matrix) requests.push(...matrixRequests(page, id, slide.matrix, aTop, GRID.bodyY + band));
    else if (layout === "comparison" && slide.comparison) requests.push(...comparisonRequests(page, id, slide.comparison, aTop, GRID.bodyY + band));
    else if (layout === "table" && slide.table) {
      // THE TABLE DRAWS ITS `body`, BENEATH THE ROWS.
      //
      // It never did, at any row count: the gate here passed only `bodyRight`
      // into tableRequests, so a `body` on a table slide was carried into the
      // deck and drawn nowhere. Measured over the 39 decks built between
      // 2026-08-18 and 2026-09-16 that is 17 shipped client slides and 963
      // words of analyst copy — the "so what" beside the figures, which is
      // usually the point of the slide. The tool's own guidance has told the
      // model for weeks to put that commentary in `bodyRight`, and the model
      // keeps writing `body`, which is the field every other layout reads.
      //
      // WHO GETS THE BAND. The rows do. A table cut to fit a paragraph is a
      // worse slide than the paragraph moved elsewhere, and the cut is the one
      // loss this function makes without declaring it (the single-line floor,
      // where fitCell trims cells with no "Showing N of M" line to say so). So
      // the prose is offered the room at 10pt, then 9, then 8 — the stat
      // grid's own ladder — and the first reserve that still leaves every row
      // and every cell WHOLE is the one taken. Rows hug their words while a
      // body follows, so the slack falls below them rather than padding them.
      // If no reserve does, the body is not drawn and the slide says so;
      // prepareSlidesForBuild turns that into a refusal naming `bodyRight`,
      // which is drawn today as a rail beside the table and exists for exactly
      // this sentence.
      const floor = GRID.bodyY + band;
      const base = onDark ? TYPE.bodyDark : TYPE.body;
      // On the SAME measure as the rows: full width, or the table's 63% when a
      // rail already has the rest of the slide. A full-width paragraph under a
      // 63% table would run straight under the rail, which is drawn to the
      // foot of the slide.
      const bodyW = tableWidthFor(!!slide.bodyRight?.trim());
      const paras = String(slide.body || "").split("\n").map((l) => l.trim()).filter(Boolean);
      const needAt = (size: number) => {
        let lines = 0;
        for (let i = 0; i < paras.length; i++) lines += Math.max(1, estimateLines(paras[i], bodyW, size, true));
        return drawnTextHeight(lines, size, 4, paras.length);
      };
      // The baseline: the table with the whole band to itself, exactly as it
      // has been drawn until now. It is what ships if the body cannot be
      // placed, so a slide that built yesterday still builds today.
      const baseMeta: TableMeta = { bottom: 0 };
      let tableReqs = tableRequests(page, id, slide.table, aTop, slide.bodyRight, floor, { onDark, meta: baseMeta });
      let meta = baseMeta;
      let placed: { size: number; height: number } | null = null;
      if (paras.length && !baseMeta.clipped) {
        for (const size of [base.size, 9, 8]) {
          const need = needAt(size);
          if (floor - aTop - need - TABLE_BODY_GAP < TABLE_MIN_BAND) continue;
          const tryMeta: TableMeta = { bottom: 0 };
          const tryReqs = tableRequests(page, id, slide.table, aTop, slide.bodyRight,
            floor - need - TABLE_BODY_GAP, { onDark, meta: tryMeta, hugRows: true });
          if (tryMeta.clipped || !tryMeta.bottom) continue;
          if (tryMeta.bottom + TABLE_BODY_GAP + need > floor + 0.5) continue;
          tableReqs = tryReqs; meta = tryMeta; placed = { size, height: need };
          break;
        }
      }
      requests.push(...tableReqs);
      if (placed) {
        const bodyTop = meta.bottom + TABLE_BODY_GAP;
        // What is measured is what is drawn: the blank lines between an
        // analyst's paragraphs are dropped here rather than rendered as empty
        // bullets that the measure above never counted. Bulleted, like the
        // rail beside the table and like every other body in the deck.
        requests.push(...bulletBlock(id, "body", page, paras.join("\n"), { ...base, size: placed.size }, {
          x: GRID.margin, y: bodyTop, width: bodyW, height: placed.height,
        }).requests);
        contentBottom = bodyTop + placed.height;
        // SAID, NEVER SILENT — ON BOTH SIDES OF THE GAP. Nothing was dropped
        // or cut, but the rows may be set smaller than they would have been on
        // their own, and the paragraph may be set smaller than every other
        // body in the deck. Both are changes the reader can see and the author
        // did not ask for, and 8pt is `caption` size — two steps under body —
        // so a paragraph placed there reads as a footnote rather than as the
        // slide's argument. Whoever wrote it should be the one to decide
        // whether that is acceptable or the text should come down instead.
        if (baseMeta.size && meta.size && meta.size < baseMeta.size) {
          shotNote(`the table is set at ${meta.size}pt rather than ${baseMeta.size}pt to leave room for the paragraph beneath it`);
        }
        if (placed.size < base.size) {
          shotNote(`the paragraph beneath the table is set at ${placed.size}pt rather than ${base.size}pt so it fits under the rows`
            + ` — shorten it, or give the table fewer rows, to read it at full size`);
        }
      } else {
        if (meta.bottom) contentBottom = meta.bottom;
        if (paras.length) {
          // THE NOTE NAMES THE FIELD AND NOT THE TEXT, deliberately.
          // droppedContent leaves a string alone when a layout note already
          // quotes it, so quoting the paragraph here would silence the audit
          // the user reads — deckWarnings, which passes the notes in — and
          // make "nothing was dropped" true by suppression rather than by
          // drawing. It would NOT blind the build-time refusal, which asks the
          // builder whether the box was emitted and never looks at a note; the
          // two are independent on purpose, and it is worth knowing which one
          // this sentence is protecting. The words stay reported; the note
          // says where to put them.
          shotNote(`its \`body\` does not fit beneath ${(slide.table.rows || []).length} rows of table and is NOT drawn`
            + ` — put it in \`bodyRight\`, which is drawn as a rail beside the table, or shorten it`);
        }
      }
    }
    else if (layout === "scatter" && slide.scatter) requests.push(...scatterRequests(page, id, slide.scatter, onDark, aTop, GRID.bodyY + band));
    else if (layout === "venn" && slide.venn) {
      const vennMeta = { noteDrawn: false };
      requests.push(...vennRequests(page, id, slide.venn, onDark, aTop, GRID.bodyY + band, slide.note, vennMeta));
      noteDrawn = vennMeta.noteDrawn;
    }
  } else if (layout === "timeline-parallel") {
    requests.push(
      ...textBox(id("eyebrow"), page, slide.eyebrow, eyebrowStyle, {
        x: GRID.margin, y: GRID.eyebrowY,
        width: eyebrowW, height: GRID.eyebrowHeight,
      }),
      ...textBox(id("title"), page, slide.title, titleStyle, {
        x: GRID.margin, y: titleBox.y, width: GRID.contentWidth, height: titleBox.height,
      }),
      ...textBox(id("sub"), page, slide.subtitle, bodyStyle, {
        x: GRID.margin, y: GRID.bodyY, width: GRID.contentWidth, height: 20,
      }),
      // THE PLOT STARTS UNDER WHAT IS ACTUALLY ABOVE IT. `bandY` clears a
      // standfirst whether or not the slide has one, so a deck with a bare
      // title left 73pt of empty page between the title and the first track
      // and then crowded the date axis onto the footer.
      ...parallelTimelineRequests(page, id, slide.tracks || [], slide.today,
        slide.subtitle?.trim() ? undefined : GRID.bodyY),
    );
  } else if (layout === "statement") {
    // One big Playfair sentence on the paper ground — the slide that makes the
    // argument. From the master template's catalogue: at most ~14 words in the
    // title, an optional Roboto lead below, nothing else. The vertical centring
    // is what keeps a nearly-empty slide reading as composed rather than
    // unfinished.
    const stTitle = fitHeading(slide.title, TYPE.statementTitle, GRID.contentWidth * 0.86, {
      bottom: CANVAS.height * 0.62,
      minTop: CANVAS.height * 0.30,
      minHeight: 60,
      minSize: 18,
    });
    requests.push(
      ...textBox(id("eyebrow"), page, slide.eyebrow, eyebrowStyle, {
        x: GRID.margin, y: GRID.eyebrowY, width: eyebrowW, height: GRID.eyebrowHeight,
      }),
      ...textBox(id("title"), page, slide.title, stTitle.style, {
        x: GRID.margin, y: stTitle.y, width: GRID.contentWidth * 0.86, height: stTitle.height,
      }, { lineSpacing: 1.18 }),
      ...textBox(id("lead"), page, slide.subtitle || slide.body, TYPE.statementLead, {
        x: GRID.margin, y: stTitle.y + stTitle.height + 14, width: GRID.contentWidth * 0.7, height: 60,
      }),
    );
  } else if (layout === "feature" && isScreenshot(slide)) {
    // A SCREENSHOT FEATURE CANNOT BE A FULL BLEED, and pretending otherwise is
    // the bug this closes. A 16:10 capture filling 405pt of height is 648pt
    // wide, leaving 72pt for a statement; anything written over it covers the
    // interface. So the picture becomes a matted STAGE on navy, with the words
    // above it and a numbered legend under it.
    const W = GRID.contentWidth * 0.72;
    const fitted = fitHeading(slide.title, TYPE.featureTitle, W, {
      bottom: CANVAS.height * 0.40, minTop: FEATURE_SHOT_TITLE_Y,
      minHeight: GRID.titleHeight, minSize: 18,
    });
    requests.push(
      ...textBox(id("eyebrow"), page, slide.eyebrow, TYPE.eyebrowDark, {
        x: GRID.margin, y: GRID.eyebrowY, width: eyebrowW, height: GRID.eyebrowHeight,
      }),
      ...textBox(id("title"), page, slide.title, fitted.style, {
        x: GRID.margin, y: FEATURE_SHOT_TITLE_Y, width: W, height: fitted.height,
      }),
    );
    const titleBottom = FEATURE_SHOT_TITLE_Y + fitted.height;
    const bodyTop = titleBottom + 6;
    const bodyHug = hugHeight(slide.body, W, TYPE.featureBody.size, false);

    // MEASURED UPWARDS FROM THE TAKEAWAY BAR, never downwards from the title.
    // Everything under the picture — the legend, the "showing N of M" line —
    // has a fixed end and no float, and the bar is drawn LAST, on top of
    // whatever is there. Measured downwards, a long body walked the legend
    // through the bar and then off the bottom of the page, and the only thing
    // that noticed was a render. So the foot is the fixed end, and the picture
    // is what gives way.
    // AND CLEAR OF THE FRAME'S OWN RULE. NOTE.bottom is 374 and the hairline is
    // at 376: the matted capture ended 1pt above it, so a picture the layout
    // draws a frame around appeared to be resting on the footer.
    const shotFloor = Math.min(FRAME.bottomRuleY - FRAME.contentGap, NOTE.bottom)
      - noteHeight(slide.note, noteWidth) - (slide.note?.trim() ? NOTE.gap : 0);

    const asked = calloutsFor(slide, shotNote);
    // The admission's band is reserved because this slide WAS GIVEN callouts,
    // not because it ends up drawing any — the line that says so is needed
    // most in the case where none of them survive.
    const admission = asked.length ? SHOT_ADMISSION_H : 0;

    // The whole geometry as a function of the callouts, so it can be asked
    // twice: once with them, and — when the answer is that there is no room
    // for a picture worth pointing at — once without.
    const planStage = (calls: { x: number; y: number; text: string }[]) => {
      const legend = calls.length ? legendLayout(calls.map((c) => c.text)) : { rows: [] as string[][], kept: 0 };
      const legendH = legend.rows.length * (SHOT.chip + 6);
      const bottom = shotFloor - admission - (legendH ? legendH + SHOT.legendGap : 0);
      // What is left for the body once the stage has taken its minimum, and
      // what the splitter is told when it probes — so a body too long for this
      // slide is CUT IN TWO rather than drawn at its own height and pushing
      // the legend off the page. Probing reads the ceiling, drawing reads the
      // hug, exactly as image-split does a few branches down.
      //
      // The ceiling is a function of the title, the takeaway and the callouts
      // and NEVER of the body: the splitter rewrites the body between the
      // probe and the draw, so a geometry that read the body's own height
      // would answer two different questions and settle on neither.
      const ceiling = bottom - SHOT.legendGap - SHOT.minStage - bodyTop;
      const bodyH = bodyHug > 0 && ceiling > 0
        ? (PROBING ? ceiling : Math.min(ceiling, bodyHug))
        : 0;
      const top = (bodyH ? bodyTop + bodyH : titleBottom) + SHOT.legendGap;
      return { legend, legendH, bottom, ceiling, bodyH, top };
    };

    let calls = asked;
    let plan = planStage(calls);
    if (plan.bottom - plan.top < SHOT.minStage && calls.length) {
      // The title, the body and the takeaway have taken the slide. Pins the
      // reader cannot match to a legend are worse than no pins, so both go —
      // and the slide says so rather than drawing a stage the size of a stamp.
      shotNote(`there is no room under the picture for a legend on this slide —` +
        ` ${calls.map((c) => quoteClip(c.text)).join(", ")}` +
        ` ${calls.length === 1 ? "was" : "were"} left off; shorten the title or the takeaway, or use image-split,` +
        ` which lists them down the side`);
      calls = [];
      plan = planStage(calls);
    }
    if (bodyHug > 0 && !plan.bodyH) {
      shotNote(`this slide's body had nowhere to go above the picture and was not drawn —` +
        ` ${quoteClip(slide.body || "")}; shorten the title or the takeaway, or move the words to image-split`);
    } else if (!PROBING && plan.bodyH && bodyHug > plan.bodyH + 0.5) {
      // The splitter has already had its turn by the time anything is drawn, so
      // a body still taller than its box here is one it could not divide — a
      // single paragraph. It is clipped, which every layout does with a
      // paragraph it cannot split, and clipping is exactly the kind of loss
      // nothing else on the slide would ever mention.
      shotNote(`this slide's body does not fit above the picture and is clipped —` +
        ` ${quoteClip(slide.body || "")}; shorten it, break it into separate lines so it can be split` +
        ` across two slides, or move the words to image-split`);
    }
    const { legend, legendH } = plan;
    if (plan.bodyH) {
      requests.push(...bulletBlock(id, "body", page, slide.body, TYPE.featureBody, {
        x: GRID.margin, y: bodyTop, width: W, height: plan.bodyH,
      }).requests);
    }

    // No clamp off the lockup: the title block alone clears it by 50pt
    // (FEATURE_SHOT_TITLE_Y 46 + the title's 45.36 minimum + the 14pt gap
    // against a mark that ends at 54.8), so a clamp here would be a line that
    // can never bind pretending to be a guard. Check 41c is what holds it.
    const stage: ShotBox = {
      x: GRID.margin, y: plan.top, w: GRID.contentWidth, h: plan.bottom - plan.top,
    };
    let drawn = 0;
    let legendTop = stage.y + stage.h;
    let pins: ({ x: number; y: number } | null)[] = [];
    if (slide.resolvedImage) {
      const box = fitAspect(deflateBox(stage, SHOT.pad), slide.resolvedImage.aspect);
      requests.push(...screenshotFrame(id, page, box, slide.resolvedImage.url, true));
      // Only the callouts the legend can NAME get a pin: a number on the
      // picture with no line under it explaining it is worse than no number.
      const placement = placeCallouts(box, calls.slice(0, legend.kept), SHOT.pin);
      pins = placement.placed;
      for (let i = 0; i < placement.notes.length; i++) shotNote(placement.notes[i]);
      for (let i = 0; i < pins.length; i++) {
        const p = pins[i];
        if (!p) continue;
        drawn++;
        requests.push(...pinRequests((part) => id(`shp${i}${part}`), page, p.x, p.y, i + 1, SHOT.pin, SHOT.numeral));
      }
      const leg = legibilityNote(box, slide.resolvedImage.sourceWidth);
      if (leg) shotNote(leg);
      const guess = guessedShapeNote(slide.resolvedImage.aspect, drawn);
      if (guess) shotNote(guess);
      legendTop = box.y + box.h + SHOT.pad + SHOT.legendGap;
    } else if (calls.length) {
      shotNote(`callouts need a picture — this slide has none, so its ${calls.length}` +
        ` callout${calls.length === 1 ? "" : "s"} ${calls.length === 1 ? "was" : "were"} not drawn`);
    }

    let entry = 0, legendY = legendTop;
    if (slide.resolvedImage) {
      for (let r = 0; r < legend.rows.length; r++) {
        const row = legend.rows[r];
        // Clamped to the margin as well as centred. legendLayout refuses a row
        // wider than the measure, so this can only be belt and braces — but the
        // failure it stops is a chip drawn at a NEGATIVE x, entirely off the
        // left edge of the slide, which is what centring on an over-wide row
        // used to do.
        let lx = Math.max(GRID.margin, GRID.margin + (GRID.contentWidth - legendRowWidth(row)) / 2);
        for (let k = 0; k < row.length; k++) {
          const i = entry++;
          const tw = labelBoxWidth(row[k], SHOT.legendSize);
          // An entry whose pin could not be placed keeps its SLOT — so the row
          // stays centred where it was measured — and draws nothing in it.
          if (pins[i]) {
            requests.push(...pinRequests((part) => id(`shc${i}${part}`), page,
              lx + SHOT.chip / 2, legendY + SHOT.chip / 2, i + 1, SHOT.chip, SHOT.chipNumeral));
            // The box starts at the chip's own edge: the gap to the glyphs is
            // the box's left inset, which is what SHOT.chipGap is worth. Pulled
            // back by the inset instead, the box would start INSIDE the chip
            // and the two would be reported as overlapping text.
            requests.push(...textBox(id(`col${i}`), page, row[k],
              { font: "Roboto", size: SHOT.legendSize, weight: 300, color: COLOR.greyLight }, {
                x: lx + SHOT.chip, y: legendY, width: tw, height: SHOT.chip,
              }, { vCenter: true, lineSpacing: 1.0, spaceBelow: 0 }));
          }
          lx += SHOT.chip + tw + 18;
        }
        legendY += SHOT.chip + 6;
      }
      // Three nets, not one: the note above, this line on the slide, and
      // droppedContent naming every phrase the deck does not carry.
      //
      // It hugs the legend, but never past the band reserved for it. With no
      // legend rows at all there is nothing between the picture and the foot,
      // and hugging alone put the line level with the footer — inside the
      // bottom margin, where no layout is allowed to draw.
      requests.push(...shotAdmission(id("shdrop"), page,
        Math.min(drawn, legend.kept), (slide.image?.callouts || []).filter((c) => c && String(c.text || "").trim()).length,
        { x: GRID.margin, y: Math.min(legendY + 2, shotFloor - SHOT_ADMISSION_H + 2), width: GRID.contentWidth }, true));
      // THE PHOTOGRAPHER'S LINE, which this branch used to lose entirely. It
      // was drawn by backdropRequests, and a screenshot stage does not call it
      // — so a stock picture declared a screenshot went out uncredited, the
      // exact hole creditRequests was pulled out of backdropRequests to close.
      requests.push(...creditRequests(id("credit"), page, slide.resolvedImage.credit,
        { x: GRID.margin, width: GRID.contentWidth }, true, chrome.to));
    }
    if (legend.kept < calls.length) {
      const lost = calls.slice(legend.kept);
      shotNote(`a legend under the picture holds two rows — ${lost.map((c) => quoteClip(c.text)).join(", ")}` +
        ` ${lost.length === 1 ? "was" : "were"} left off; shorten the phrases, or use image-split, which lists them down the side`);
    }
  } else if (layout === "feature") {
    const feature = fitHeading(slide.title, TYPE.featureTitle, GRID.contentWidth * 0.72, {
      bottom: IMAGE.overlayBodyY - 10,
      minTop: CANVAS.height * 0.28,
      minHeight: IMAGE.overlayTitleHeight,
      minSize: 18,
    });
    requests.push(
      ...textBox(id("eyebrow"), page, slide.eyebrow, TYPE.eyebrowDark, {
        x: GRID.margin, y: GRID.eyebrowY,
        width: eyebrowW, height: GRID.eyebrowHeight,
      }),
      ...textBox(id("title"), page, slide.title, feature.style, {
        x: GRID.margin, y: feature.y,
        width: GRID.contentWidth * 0.72, height: feature.height,
      }),
      ...bulletBlock(id, "body", page, slide.body, TYPE.featureBody, {
        x: GRID.margin, y: IMAGE.overlayBodyY,
        width: GRID.contentWidth * 0.72, height: IMAGE.overlayBodyHeight,
      }).requests,
    );
  } else if (layout === "image-split") {
    // THE SUBTITLE IS NOT DRAWN HERE, AND THAT IS A DECISION, NOT AN OVERSIGHT.
    //
    // Over the 39 decks built to 2026-09-16, nine image-split slides carried a
    // `subtitle`; this layout draws none of them. Chris took that on
    // 2026-09-17 alongside the opposite call for `stat`
    // (docs/PLAN-slides-creative-2026-09.md, Stage 0): on `stat` a headline
    // number gains a line of context and the band can be re-split to pay for
    // it, while here the line would compete with the photograph for the one
    // half-width column the words already share. Do NOT add it — reopen the
    // decision with Chris instead.
    //
    // The loss is DECLARED, in the channel that already exists rather than a
    // second one: `subtitle` is not in NON_CONTENT_KEYS, so droppedContent
    // reports it and deckWarnings names it to the user verbatim. That was
    // checked against the real slides rather than assumed — eight of the nine
    // are reported, and the ninth (conversation 04c5d402, slide 9) is silent
    // only because the same sentence is repeated in `body` and IS drawn, which
    // is droppedContent working, not failing. Adding a layout note here would
    // declare the same loss twice AND silence droppedContent about it, because
    // text a note already quotes is left to that note.
    //
    // Image bleeds off the left edge; text takes the right half. Bleeding
    // rather than insetting is what makes it read as editorial instead of as a
    // picture pasted into a document — which is exactly why a SCREENSHOT does
    // the opposite: an interface bled off the edge reads as a mistake, and
    // cropping it to the half-slide's shape cuts off what the slide is about.
    const shot = isScreenshot(slide);
    const calls = shot ? calloutsFor(slide, shotNote) : [];
    let shotBox: ShotBox | null = null;
    if (slide.resolvedImage && shot) {
      const region: ShotBox = {
        x: GRID.margin, y: GRID.margin,
        w: IMAGE.splitWidth - GRID.margin, h: CANVAS.height - 2 * GRID.margin,
      };
      shotBox = fitAspect(deflateBox(region, SHOT.pad), slide.resolvedImage.aspect);
    }
    // THE NUMBERED ROWS, MEASURED BEFORE THE BODY. They depend only on the
    // callouts — never on the body — so the body's ceiling can give up exactly
    // the room they take with no circularity, and the splitter's probe reads a
    // ceiling that already knows about them. A body that no longer fits beside
    // five callouts SPLITS instead of running under them.
    const listTextW = IMAGE.splitTextWidth - SHOT.chip - SHOT.chipGap;
    // THE ROOM IS RESERVED FROM THE CALLOUTS, NOT FROM THE PICTURE. Splitting
    // runs BEFORE images are resolved, so at probe time no slide has a
    // resolvedImage at all — a ceiling that keyed on one measured the full
    // column and every body was judged to fit beside five callouts it would
    // then be drawn straight through. (The rail had the same bug, and the
    // probe's own comment is about the fix.) Drawing still needs the picture.
    const reserveList = calls.length > 0;
    const drawList = !!shotBox && reserveList;
    const rowHeights: number[] = [];
    if (reserveList) {
      for (let i = 0; i < calls.length; i++) {
        rowHeights.push(Math.max(SHOT.chip,
          drawnTextHeight(estimateLines(calls[i].text, listTextW, TYPE.body.size), TYPE.body.size)));
      }
    }
    let listBlock = 0;
    for (let i = 0; i < rowHeights.length; i++) listBlock += rowHeights[i] + (i ? SHOT.rowGap : 0);
    // THE TAKEAWAY BAR IS PART OF THE FLOOR. It is drawn last and over
    // everything, and this branch used to measure to the bottom margin as
    // though the bar were not there — so on a slide with a takeaway the
    // numbered rows and the "showing N of M" line were painted over by it, and
    // the one statement on the slide saying a callout had been dropped was the
    // thing the bar hid. Every other layout gives way by exactly this height.
    const columnFloor = Math.min(
      CANVAS.height - GRID.margin - 18,
      NOTE.bottom - noteHeight(slide.note, noteWidth) - (slide.note?.trim() ? NOTE.gap : 0),
    ) - (reserveList ? SHOT_ADMISSION_H : 0);
    const bodyTop = Math.max(GRID.bodyY, titleBox.y + titleBox.height + 8);
    const splitBodyCeiling = Math.max(reserveList ? 40 : 60,
      columnFloor - bodyTop - listBlock - (listBlock ? SHOT.legendGap : 0));
    // WHERE THE ROWS ACTUALLY START, and how many of them reach the floor.
    //
    // The rows hug the body, and the body's ceiling has a hard 40pt floor that
    // says a one- or two-line body always "fits" — so the two can both be true
    // and still not both fit, and the rows used to be clamped UP to
    // `columnFloor - listBlock` to make room, straight through the body. An
    // ordinary slide — one-line title, one-sentence body, five phrases —
    // printed its callouts over its own body, and nothing said a word.
    //
    // So the body keeps its room, the rows start beneath it, and the ones that
    // no longer reach the floor are dropped and declared like everything else.
    // THE BOX HUGS ITS WORDS when rows follow it, and takes the ceiling when
    // nothing does. The slack belongs UNDER the box, not inside it: a
    // ceiling-sized box pushes the rows to the foot of the column and opens a
    // hole where the sentence ended — and, because the rows then start lower,
    // drops rows that would otherwise have fitted.
    //
    // The `!PROBING` is belt and braces beside the clamp: when the hug is under
    // the ceiling the body genuinely fits, and when it is over, the clamp
    // answers the ceiling either way. It is the statement of intent, and the
    // feature stage's own PROBING guard is not redundant at all.
    const drawnBodyHeight = drawList && !PROBING
      ? Math.min(splitBodyCeiling, Math.max(20, hugHeight(slide.body, IMAGE.splitTextWidth, bodyStyle.size, true)))
      : splitBodyCeiling;
    const listTop = bodyTop + drawnBodyHeight + SHOT.legendGap;
    let keptRows = 0;
    for (let i = 0, yy = listTop; i < rowHeights.length; i++) {
      if (yy + rowHeights[i] > columnFloor) break;
      keptRows++;
      yy += rowHeights[i] + SHOT.rowGap;
    }

    // Placed BEFORE the rows are drawn, so a row whose pin could not be placed
    // is left out rather than carrying a number that points at nothing. The
    // row's HEIGHT is still reserved, so the geometry the splitter probed does
    // not move under it.
    let pins: ({ x: number; y: number } | null)[] = [];
    if (shotBox && slide.resolvedImage) {
      requests.push(...screenshotFrame(id, page, shotBox, slide.resolvedImage.url, false));
      // Only the callouts that get a NUMBERED LINE get a pin, the same rule the
      // feature legend keeps: a number on the picture the reader cannot match
      // to a phrase is worse than no number at all.
      const placement = placeCallouts(shotBox, calls.slice(0, keptRows), SHOT.pin);
      pins = placement.placed;
      for (let i = 0; i < placement.notes.length; i++) shotNote(placement.notes[i]);
      for (let i = 0; i < pins.length; i++) {
        const p = pins[i];
        if (!p) continue;
        requests.push(...pinRequests((part) => id(`shp${i}${part}`), page, p.x, p.y, i + 1, SHOT.pin, SHOT.numeral));
      }
      const leg = legibilityNote(shotBox, slide.resolvedImage.sourceWidth);
      if (leg) shotNote(leg);
      const guess = guessedShapeNote(slide.resolvedImage.aspect, pins.filter(Boolean).length);
      if (guess) shotNote(guess);
    } else if (slide.resolvedImage) {
      requests.push({
        createImage: {
          objectId: id("half"),
          url: slide.resolvedImage.url,
          elementProperties: {
            pageObjectId: page,
            size: { width: pt(IMAGE.splitWidth), height: pt(CANVAS.height) },
            transform: { scaleX: 1, scaleY: 1, translateX: 0, translateY: 0, unit: "PT" },
          },
        },
      });
    }
    if (calls.length && !shotBox) {
      shotNote(`callouts need a picture — this slide has none, so its ${calls.length}` +
        ` callout${calls.length === 1 ? "" : "s"} ${calls.length === 1 ? "was" : "were"} not drawn`);
    }
    requests.push(
      ...textBox(id("eyebrow"), page, slide.eyebrow, eyebrowStyle, {
        x: IMAGE.splitTextX, y: GRID.eyebrowY,
        width: eyebrowRoom(rail, IMAGE.splitTextX, IMAGE.splitTextWidth), height: GRID.eyebrowHeight,
      }),
      ...textBox(id("title"), page, slide.title, titleStyle, {
        x: IMAGE.splitTextX, y: titleBox.y,
        width: IMAGE.splitTextWidth, height: titleBox.height,
      }),
      // THE DOT HANGS INTO THE GUTTER, not onto the photograph. The picture
      // bleeds to x=339.84 and the column starts at 380.16, so the disc at
      // 375.96 sits 36pt clear of the trim of the image — a real gutter, which
      // is the condition HUNG_DOT's header sets for hanging a mark at all.
      ...bulletBlock(id, "body", page, slide.body, bodyStyle, {
        x: IMAGE.splitTextX,
        // Under the title, wherever it ended up — not at a fixed y that the
        // title may now reach past.
        y: bodyTop,
        width: IMAGE.splitTextWidth,
        height: drawnBodyHeight,
      }).requests,
      // In the TEXT column, not on the picture. On the picture it would sit
      // beside what it credits, but this layout resolves with gradient:false —
      // nothing measures that corner, so a 6pt light line over an unknown
      // photograph is exactly the invisible credit this is here to stop.
      ...creditRequests(id("credit"), page, slide.resolvedImage?.credit,
        { x: IMAGE.splitTextX, width: IMAGE.splitTextWidth }, false, chrome.to),
    );
    if (drawList) {
      // A NEW LIST RATHER THAN REUSING `body`. The numbers have to match the
      // pins, and `body` is a disc-bulleted, unnumbered field whose order the
      // splitter is allowed to change. `body` still draws, above the list; if
      // both genuinely do not fit, the splitter takes the slide, which is the
      // correct outcome.
      //
      // The list HUGS the body. It is never pushed UP to make room for itself —
      // that is what printed it over the body — so a row that does not reach
      // the floor is left off and named instead.
      let y = listTop;
      let drawn = 0;
      for (let i = 0; i < keptRows; i++) {
        const h = rowHeights[i];
        if (pins[i]) {
          requests.push(...pinRequests((part) => id(`shc${i}${part}`), page,
            IMAGE.splitTextX + SHOT.chip / 2, y + SHOT.chip / 2 + 1.5, i + 1, SHOT.chip, SHOT.chipNumeral));
          requests.push(...textBox(id(`col${i}`), page, calls[i].text, TYPE.body, {
            x: IMAGE.splitTextX + SHOT.chip + SHOT.chipGap, y,
            width: listTextW, height: Math.max(SHOT.chip, h),
          }, { spaceBelow: 0 }));
          drawn++;
        }
        y += h + SHOT.rowGap;
      }
      // Said on the slide as well as in the note, in the slot every other
      // diagram uses: a note-free build passes every geometric check there is.
      requests.push(...shotAdmission(id("shdrop"), page, drawn,
        (slide.image?.callouts || []).filter((c) => c && String(c.text || "").trim()).length,
        // Hugging the last row, but never below the band columnFloor reserved
        // for it — the same rule the feature stage keeps.
        { x: IMAGE.splitTextX, y: Math.min(y - SHOT.rowGap + 3, columnFloor + 2), width: IMAGE.splitTextWidth }, false));
      if (keptRows < calls.length) {
        const lost = calls.slice(keptRows);
        shotNote(`the text column has room for ${keptRows} numbered line${keptRows === 1 ? "" : "s"}` +
          ` beside this body — ${lost.map((c) => quoteClip(c.text)).join(", ")}` +
          ` ${lost.length === 1 ? "was" : "were"} left off; shorten the body, or give the extra ones a second slide`);
      }
    }
  } else if (layout === "image-grid") {
    requests.push(
      ...textBox(id("eyebrow"), page, slide.eyebrow, eyebrowStyle, {
        x: GRID.margin, y: GRID.eyebrowY,
        width: eyebrowW, height: GRID.eyebrowHeight,
      }),
      ...textBox(id("title"), page, slide.title, titleStyle, {
        x: GRID.margin, y: titleBox.y, width: GRID.contentWidth, height: titleBox.height,
      }),
      ...gridRequests(page, id, slide.resolvedImages || []),
    );
  } else if (layout === "two-column") {
    // The comparison slide, designed. It was two bare bullet piles — no rule,
    // no headers, no divider, ~55% dead paper — and it catches exactly the
    // before/after and pricing content that closes a deal. Now: a rule under
    // the title, an optional standfirst, per-column headers over an accent
    // underline, and a hairline down the middle so the two sides read as a
    // comparison rather than two lists that happen to share a slide.
    requests.push(
      ...textBox(id("eyebrow"), page, slide.eyebrow, eyebrowStyle, {
        x: GRID.margin, y: GRID.eyebrowY,
        width: eyebrowW, height: GRID.eyebrowHeight,
      }),
      ...textBox(id("title"), page, slide.title, titleStyle, {
        x: GRID.margin, y: titleBox.y, width: GRID.contentWidth, height: titleBox.height,
      }),
      ...ruleRequests(id("rule"), page, GRID.bodyY - RULE.gapAbove,
        { from: GRID.margin, to: GRID.margin + GRID.contentWidth }, onDark),
    );

    let colTop = GRID.columnY;
    if (slide.subtitle?.trim()) {
      const standStyle = onDark ? TYPE.standfirstDark : TYPE.standfirst;
      const standH = drawnTextHeight(
        estimateLines(slide.subtitle, GRID.contentWidth, standStyle.size), standStyle.size
      );
      requests.push(...textBox(id("sub"), page, slide.subtitle, standStyle, {
        x: GRID.margin, y: GRID.bodyY, width: GRID.contentWidth, height: standH,
      }));
      colTop = GRID.bodyY + standH + 12;
    }

    // TINTED PANELS, when tones are given, and the hairline when they are not.
    //
    // Two bare lists with a rule between them is the treatment the source deck
    // reserves for its plainest pages; everywhere it wants the reader to feel a
    // contrast — what works against what does not — it tints the two columns
    // and inks their headings to match. The hairline is redundant once the
    // cards are there, and drawing both looked like a mistake.
    const toneL = toneAt(slide.tones, 0);
    const toneR = toneAt(slide.tones, 1);
    const panelBottom = NOTE.bottom - noteHeight(slide.note, noteWidth) - (slide.note?.trim() ? NOTE.gap : 0);
    const TONE_PAD = 12;
    const tinted = !!(toneL || toneR);
    const hasHeads = !!(slide.columns?.left?.trim() || slide.columns?.right?.trim());

    // Smaller inside a card, which is how the source deck sets it: the tint
    // already separates the two sides, so the type does not also have to be
    // full size to hold the column together.
    // 8pt in a tinted card — the floor, and the reference's own size for these
    // lists. The gap between items is bulletBlock's now: it was a written-down
    // 4pt here, which at 8pt is already inside the 4.5pt ceiling that keeps a
    // wrapped item reading as one item, so nothing moves and nothing is lost.
    const colBodyStyle = tinted
      ? { ...bodyStyle, size: Math.max(8, bodyStyle.size - 2), color: COLOR.ink }
      : bodyStyle;

    // SIZED TO THE WORDS. The tinted panels used to stretch from the standfirst
    // to the takeaway bar whatever they held: five bullets ending a third of
    // the way down a 246pt card, the room reading the empty tint as content
    // that had not arrived. The reference hugs its text and leaves the slack
    // at the FOOT of the slide, outside the boxes. So: measure both columns,
    // draw the panel to the taller one, and tell the takeaway bar where the
    // content ends.
    const textW = GRID.columnWidth - (tinted ? TONE_PAD * 2 : 0);
    // MEASURED THE WAY IT IS DRAWN — one ruler, see bulletBlockHeight. The
    // panel is sized to its words, so a measure that disagreed with the drawing
    // would size a card to a list it does not hold.
    const measure = (body: string | undefined) => bulletBlockHeight(body, textW, colBodyStyle);
    const leftH = measure(slide.body), rightH = measure(slide.bodyRight);
    const headBlock = hasHeads ? (tinted ? 24 : 34) : 0;
    const wanted = (tinted ? TONE_PAD : 0) + headBlock + Math.max(leftH, rightH) + (tinted ? TONE_PAD + 2 : 0);
    const panelH = PROBING ? Math.max(60, panelBottom - colTop) : Math.max(60, Math.min(panelBottom - colTop, wanted));

    // INSIDE the margin. The panels used to reach 12pt past the column edges
    // on both sides, so they overhung the takeaway bar beneath them and the
    // title above — three left edges on one slide, the cards visibly jutting.
    if (tinted) {
      if (toneL) requests.push(...filledShape(id("tl"), page, "ROUND_RECTANGLE", toneL.tint, {
        x: GRID.columnLeftX, y: colTop, width: GRID.columnWidth, height: panelH,
      }));
      if (toneR) requests.push(...filledShape(id("tr"), page, "ROUND_RECTANGLE", toneR.tint, {
        x: GRID.columnRightX, y: colTop, width: GRID.columnWidth, height: panelH,
      }));
    } else {
      const midX = (GRID.columnLeftX + GRID.columnWidth + GRID.columnRightX) / 2;
      requests.push(...filledShape(id("vrule"), page, "RECTANGLE", onDark ? COLOR.greyLight : COLOR.navy, {
        x: midX, y: colTop, width: RULE.hairlineThickness, height: panelH,
      }, RULE.hairlineAlpha));
    }

    const inset = tinted ? TONE_PAD : 0;
    const leftX = GRID.columnLeftX + inset, rightX = GRID.columnRightX + inset;
    let bodyTop = colTop + inset;
    // A tinted card is a LIGHT surface whatever the ground, so its ink comes
    // from the tone rather than from the slide.
    const headStyle = tinted
      ? { ...TYPE.columnHeader, color: (toneL || toneR)!.ink }
      : onDark ? { ...TYPE.columnHeader, color: COLOR.white } : TYPE.columnHeader;
    if (hasHeads) {
      requests.push(
        ...textBox(id("lh"), page, slide.columns?.left,
          toneL ? { ...headStyle, color: toneL.ink } : headStyle, {
          x: leftX, y: bodyTop, width: textW, height: 20,
        }),
        ...textBox(id("rh"), page, slide.columns?.right,
          toneR ? { ...headStyle, color: toneR.ink } : headStyle, {
          x: rightX, y: bodyTop, width: textW, height: 20,
        }),
      );
      // The accent underline is the plain treatment's device. Inside a tinted
      // card the coloured heading already does that job, and the extra rule
      // read as clutter.
      if (!tinted) {
        requests.push(
          ...filledShape(id("lhu"), page, "RECTANGLE", onDark ? COLOR.tealSoft : COLOR.blue, {
            x: leftX, y: bodyTop + 22, width: RULE.accentWidth, height: RULE.thickness,
          }),
          ...filledShape(id("rhu"), page, "RECTANGLE", onDark ? COLOR.tealSoft : COLOR.blue, {
            x: rightX, y: bodyTop + 22, width: RULE.accentWidth, height: RULE.thickness,
          }),
        );
      }
      bodyTop += headBlock;
    }

    const colH = Math.max(30, colTop + panelH - bodyTop - (tinted ? TONE_PAD : 0));
    // THE DOTS HANG INTO REAL GUTTERS HERE, which is the condition HUNG_DOT's
    // own header sets: the left column hangs into the page margin, and the
    // right into the 41.04pt gutter between the columns, whose hairline sits
    // 16pt clear of the disc. A tinted card gives the dot its own 12pt padding.
    requests.push(
      ...bulletBlock(id, "left", page, slide.body, colBodyStyle, {
        x: leftX, y: bodyTop, width: textW, height: colH,
      }).requests,
      ...bulletBlock(id, "right", page, slide.bodyRight, colBodyStyle, {
        x: rightX, y: bodyTop, width: textW, height: colH,
      }).requests,
    );
    contentBottom = colTop + panelH;
  } else if (layout === "photo-rail") {
    /* C — THE PHOTO RAIL: a portrait picture inset down the left, two prose
     * columns beside it. Four of the handover deck's ten slides, and the one
     * page `image-split` cannot make: that layout bleeds the picture off the
     * trim and gives the words ONE half-width column, and the difference is
     * not a matter of degree. See PHOTO_RAIL for why insetting is what lets
     * this page keep the whole frame and the stepper rail.
     *
     * BUILT AS A COMPOSITION, NOT AS AN ARCHETYPE, and that is deliberate:
     * the picture region is `photoRailBox` and the words are `columnBand(2)`
     * over the band the picture leaves. Stage 5 expresses this and the
     * three-column band below as ONE composition — a figure on one side, n
     * prose columns on the other — and a hard-coded twin would have to be
     * unpicked to get there.
     */
    const photo = photoRailBox(slide);
    // THE COUNT COMES FROM THE CONTENT, never from the layout's name — the
    // rule the three-column band below states and this layout did not follow.
    // A photo rail with one column of copy drew it at half the band and left
    // 228pt of the page blank, and because the splitter clears `bodyRight` on
    // a continuation, EVERY continued photo-rail slide was drawn that way.
    const railShown = columnFields(slide, ["body", "bodyRight"]);
    const cols = columnBand(railShown.length, { x: PHOTO_RAIL.textX, width: PHOTO_RAIL.textWidth });
    if (photo) {
      requests.push({
        createImage: {
          objectId: id("rail"),
          url: photo.url,
          elementProperties: {
            pageObjectId: page,
            size: { width: pt(photo.width), height: pt(photo.height) },
            transform: { scaleX: 1, scaleY: 1, translateX: photo.x, translateY: photo.y, unit: "PT" },
          },
        },
      });
    }
    requests.push(
      // THE EYEBROW IS DRAWN WHERE EVERY OTHER PAPER PAGE DRAWS IT: at the
      // margin, in the room the stepper rail leaves.
      //
      // It began at the picture's left edge, on the reasoning that the words
      // start there — and the picture never reaches this line. The eyebrow
      // band is y=21.6 to 39.6, entirely above the frame's top rule at 46.8
      // and above the picture's own top at 52, so nothing about the photograph
      // touches it. What it DID touch was the stepper: this was the one layout
      // whose eyebrow kept the full page measure instead of `eyebrowRoom`'s,
      // so a 44-character eyebrow ran 152pt into a seven-step rail and the
      // numerals were drawn inside the word RELATIONSHIP, at both presets and
      // at every step count from three to nine. Narrowing the old box instead
      // of moving it trades the overlap for a wrap: from about 30 characters
      // the eyebrow then took two lines and ran through the title.
      ...textBox(id("eyebrow"), page, slide.eyebrow, eyebrowStyle, {
        x: GRID.margin, y: GRID.eyebrowY, width: eyebrowW, height: GRID.eyebrowHeight,
      }),
      // THE TITLE'S TOP EDGE IS THE PICTURE'S TOP EDGE, where there is room
      // for it to be. fitHeading anchors a title to the FOOT of its band so it
      // ends above the rule, which is right everywhere else and leaves a hole
      // here: at `present` the band is deeper, so a one-line title dropped to
      // y=95.7 against a picture starting at 52 and opened 44pt of empty
      // ground beside the photograph's top corner. The source sets the title's
      // cap-line level with the top of its picture. A title too tall to start
      // there keeps the fitted position, so it still ends above the rule.
      ...textBox(id("title"), page, slide.title, titleStyle, {
        x: PHOTO_RAIL.textX, y: Math.min(PHOTO_RAIL.top, titleBox.y),
        width: PHOTO_RAIL.textWidth, height: titleBox.height,
      }),
      // THE RULE STARTS AT THE PICTURE'S RIGHT EDGE, not at the page margin,
      // and that single detail is what makes this read as the source's page.
      // A full-measure rule here would be drawn straight across a photograph
      // that is holding all four of its own edges.
      ...ruleRequests(id("rule"), page, GRID.bodyY - RULE.gapAbove,
        { from: GRID.margin + PHOTO_RAIL.width, to: GRID.margin + GRID.contentWidth }, onDark),
    );

    let colTop = GRID.bodyY;
    if (slide.subtitle?.trim()) {
      // The source's own photo-rail pages carry no standfirst, but the field
      // exists and droppedContent reports one that is not drawn — so it is
      // drawn, across the type band, and the columns start under it. A line
      // the layout refuses is a line somebody has to be told about.
      const standStyle = onDark ? TYPE.standfirstDark : TYPE.standfirst;
      const standH = drawnTextHeight(
        estimateLines(slide.subtitle, PHOTO_RAIL.textWidth, standStyle.size), standStyle.size);
      requests.push(...textBox(id("sub"), page, slide.subtitle, standStyle, {
        x: PHOTO_RAIL.textX, y: colTop, width: PHOTO_RAIL.textWidth, height: standH,
      }));
      colTop = colTop + standH + 12;
    }
    // THE COLUMNS STOP WHERE THE PICTURE DOES, so the page has one foot rather
    // than two. The takeaway bar, when there is one, takes its own room off
    // this the way it does on every other layout.
    const colFloor = Math.min(
      PHOTO_RAIL.bottom,
      NOTE.bottom - noteHeight(slide.note, noteWidth) - (slide.note?.trim() ? NOTE.gap : 0),
    );
    const colH = Math.max(30, colFloor - colTop);
    const railFit = columnFit(railShown, cols.width, colH, bodyStyle);
    for (let i = 0; i < railShown.length; i++) {
      requests.push(...bulletBlock(id, railShown[i].key, page, railShown[i].text, railFit.style, {
        x: cols.x[i], y: colTop, width: cols.width, height: colH,
      }, { ragged: true }).requests);
    }
    requests.push(...columnOverfullNote(id("colclip"), page, railFit, shotNote, "photo-rail"));
    requests.push(...creditRequests(id("credit"), page, slide.resolvedImage?.credit,
      { x: PHOTO_RAIL.textX, width: PHOTO_RAIL.textWidth }, onDark, chrome.to));
    contentBottom = colFloor;
  } else if (layout === "three-column") {
    /* D — THE THREE-COLUMN BAND. Two of the handover deck's ten slides.
     *
     * The column geometry was three constants and exactly two slots; it is
     * `columnBand(n)` now, which is what this needs and what Stage 5 needs.
     * The source's own gutters are 30.24 and 53.28 — hand-set and unequal by
     * 23pt between columns about 180pt wide — and they are SOLVED EQUAL here
     * rather than copied: reproducing the deck exactly would reproduce a slip.
     *
     * A COLUMN IS PROSE WITH A LEAD-IN, not a card. `cards` can put three
     * blocks across the band, but a card is a panel with a marker chip and a
     * heading; this is a column of body copy whose first sentence is set in
     * the accent and reads on into the rest. The difference is what the source
     * uses to make a page of argument rather than a page of parts.
     */
    // THE COUNT COMES FROM THE CONTENT, never from the layout's name. A model
    // that writes two columns gets two full-width ones rather than three with
    // an empty slot, which is the shape `cards` already takes from its array.
    const shown = columnFields(slide, ["body", "bodyRight", "bodyThird"]);
    const cols = columnBand(shown.length);
    requests.push(
      ...textBox(id("eyebrow"), page, slide.eyebrow, eyebrowStyle, {
        x: GRID.margin, y: GRID.eyebrowY, width: eyebrowW, height: GRID.eyebrowHeight,
      }),
      ...textBox(id("title"), page, slide.title, titleStyle, {
        x: GRID.margin, y: titleBox.y, width: GRID.contentWidth, height: titleBox.height,
      }),
      // FULL WIDTH, unlike the photo rail's. There is no picture to stop at.
      ...ruleRequests(id("rule"), page, GRID.bodyY - RULE.gapAbove,
        { from: GRID.margin, to: GRID.margin + GRID.contentWidth }, onDark),
    );

    let colTop = GRID.bodyY;
    if (slide.subtitle?.trim()) {
      // The standfirst runs the FULL measure above the columns, which is the
      // source's own arrangement: it is the sentence the three columns are
      // three answers to, so it belongs to the page and not to a column.
      const standStyle = onDark ? TYPE.standfirstDark : TYPE.standfirst;
      const standH = drawnTextHeight(
        estimateLines(slide.subtitle, GRID.contentWidth, standStyle.size), standStyle.size);
      requests.push(...textBox(id("sub"), page, slide.subtitle, standStyle, {
        x: GRID.margin, y: colTop, width: GRID.contentWidth, height: standH,
      }));
      colTop = colTop + standH + 12;
    }
    const colFloor = NOTE.bottom - noteHeight(slide.note, noteWidth) - (slide.note?.trim() ? NOTE.gap : 0);
    const colH = Math.max(30, colFloor - colTop);
    // The lead-in: the accent on a dark ground is the teal, for the same
    // reason the rule's accent is — brand blue on navy is 2.39:1.
    // WEIGHT, NOT `bold`. TypeStyle carries both and the emitter reads
    // `style.weight ?? (style.bold ? 700 : 400)` — so spreading the body
    // style, which is Roboto Light at weight 300, kept the 300 and the flag
    // did nothing. Rendered, every lead-in came out the same weight as the
    // column under it and the device was invisible.
    //
    // AND NOT ON A CONTINUATION. A continuation by definition does not start a
    // column — its first paragraph is a bullet from the middle of the list the
    // splitter cut — so accenting it promotes an ordinary point into the
    // opening of an argument it is halfway through. The eyebrow and the
    // standfirst are dropped from a continuation for exactly this reason, and
    // the lead-in is the same decision one field along.
    const colFit = columnFit(shown, cols.width, colH, bodyStyle);
    const leadIn = slide.continuation
      ? undefined
      : { ...colFit.style, weight: 700, bold: true, color: onDark ? COLOR.tealSoft : COLOR.blue };
    for (let i = 0; i < shown.length; i++) {
      requests.push(...bulletBlock(id, shown[i].key, page, shown[i].text, colFit.style, {
        x: cols.x[i], y: colTop, width: cols.width, height: colH,
      }, { leadIn, ragged: true }).requests);
    }
    requests.push(...columnOverfullNote(id("colclip"), page, colFit, shotNote, "three-column"));
    contentBottom = colFloor;
  } else if (layout === "serpentine") {
    /* E — THE SERPENTINE. The handover deck's slide 8: seven steps, against
     * `process`'s cap of five. See SERPENTINE and serpentineRequests — this is
     * `timeline` with the numeral inside the marker, the captions alternating,
     * and a seventh slot, not a new engine.
     */
    requests.push(
      ...textBox(id("eyebrow"), page, slide.eyebrow, eyebrowStyle, {
        x: GRID.margin, y: GRID.eyebrowY, width: eyebrowW, height: GRID.eyebrowHeight,
      }),
      // CENTRED, as the source's is: the device below it is symmetrical about
      // the page, and a title hard left over a centred rule reads as two
      // decisions rather than one.
      ...textBox(id("title"), page, slide.title, titleStyle, {
        x: GRID.margin, y: titleBox.y, width: GRID.contentWidth, height: titleBox.height,
      }, { align: "CENTER" }),
    );
    let top = GRID.bodyY;
    if (slide.subtitle?.trim()) {
      const standStyle = onDark ? TYPE.standfirstDark : TYPE.standfirst;
      const standH = drawnTextHeight(
        estimateLines(slide.subtitle, GRID.contentWidth, standStyle.size), standStyle.size);
      requests.push(...textBox(id("sub"), page, slide.subtitle, standStyle, {
        x: GRID.margin, y: top, width: GRID.contentWidth, height: standH,
      }, { align: "CENTER" }));
      top = top + standH + 12;
    }
    // A DRAWN BLOCK STOPS ABOVE THE FRAME'S OWN RULE. NOTE.bottom is 374.4 and
    // the hairline is at 376, so a band floored on the takeaway bar's line
    // alone puts the lowest owner 1.6pt off a rule the frame would then have
    // to yield — which is the swot-and-venn fault Stage 3 closed with
    // FRAME.contentGap. The furniture does not move for content; content stops
    // above it.
    const floor = Math.min(FRAME.bottomRuleY - FRAME.contentGap, NOTE.bottom)
      - noteHeight(slide.note, noteWidth) - (slide.note?.trim() ? NOTE.gap : 0);
    requests.push(...serpentineRequests(page, id, slide.stages || [], onDark,
      top, Math.max(60, floor - top), shotNote));
    contentBottom = floor;
  } else {
    // content, case-study, dark-index all share the title + body skeleton;
    // the eyebrow is what makes a case study read as one.
    //
    // This is the slide most decks are mostly made of, and measured it carried
    // 12.5% ink, no drawn object of any kind, 116 characters to a line, and the
    // bottom 47% of the canvas empty. Four things change that, none of them a
    // new layout: a measure, a rule, a middle step in the type scale, and the
    // photograph the slide already asked for and used to throw away.
    // A panel replaces the rail: the master's split carries either a panel or
    // an image on the right, never both.
    const panel = slide.panel && (slide.panel.items?.length || slide.panel.title?.trim()) ? slide.panel : undefined;
    const rail = panel ? null : railBox(slide);
    // ONE decision, made above: proseColumn already narrows for a panel the
    // same way it narrows for a rail. A second panel-check here is how the
    // drawn box and the measured width drift apart — the mutation that removes
    // the narrowing from one of them is invisible until a title wraps wrong.
    const proseWidth = proseColumn;

    if (panel) {
      const panelW = GRID.contentWidth - GRID.proseNarrow - 18;
      const panelMeta = { bottom: 0 };
      requests.push(...panelRequests(page, id, panel, {
        x: GRID.margin + GRID.proseNarrow + 18, y: GRID.bodyY,
        width: panelW, height: CANVAS.height - GRID.margin - GRID.bodyY - 4,
      }, panelMeta));
    }

    if (rail) {
      requests.push({
        createImage: {
          objectId: id("rail"), url: rail.url,
          elementProperties: {
            pageObjectId: page,
            size: { width: pt(rail.width), height: pt(rail.height) },
            transform: { scaleX: 1, scaleY: 1, translateX: rail.x, translateY: rail.y, unit: "PT" },
          },
        },
      });
    }

    requests.push(
      ...textBox(id("eyebrow"), page, slide.eyebrow, eyebrowStyle, {
        x: GRID.margin, y: GRID.eyebrowY,
        width: eyebrowW, height: GRID.eyebrowHeight,
      }),
      ...textBox(id("title"), page, slide.title, titleStyle, {
        x: GRID.margin, y: titleBox.y, width: proseWidth, height: titleBox.height,
      }),
      // THE RULE RUNS OUT TO THE PICTURE when there is one, so the two make one
      // horizontal across the page rather than a short rule and a floating
      // rectangle with a gap between them.
      ...ruleRequests(id("rule"), page, GRID.bodyY - RULE.gapAbove,
        { from: GRID.margin, to: GRID.margin + (rail ? rail.x - GRID.margin : proseWidth) }, onDark),
    );

    // The standfirst takes the room it needs and the bullets start under it.
    let bodyTop = GRID.bodyY;
    if (slide.subtitle?.trim()) {
      const standStyle = onDark ? TYPE.standfirstDark : TYPE.standfirst;
      const standHeight = drawnTextHeight(
        estimateLines(slide.subtitle, proseWidth, standStyle.size), standStyle.size
      );
      requests.push(...textBox(id("sub"), page, slide.subtitle, standStyle, {
        x: GRID.margin, y: bodyTop, width: proseWidth, height: standHeight,
      }));
      bodyTop += standHeight + 10;
    }

    // THE BULLETS, hung off the measure rather than indented into it, and on a
    // rhythm that binds a wrapped line to the one above it. See bulletBlock:
    // the band's slack stops here rather than being poured into the gaps.
    const bodyHeight = Math.max(40, GRID.bodyY + band - bodyTop);
    const body = bulletBlock(id, "body", page, slide.body, bodyStyle, {
      x: GRID.margin, y: bodyTop, width: proseWidth,
      // Down to the foot of the band, not the old fixed height that stopped
      // 39pt short of it and pooled every list under the title.
      height: bodyHeight,
    });
    requests.push(
      ...body.requests,
      ...(rail
        ? creditRequests(id("credit"), page, slide.resolvedImage?.credit,
            { x: GRID.margin, width: proseWidth }, onDark, chrome.to)
        : []),
    );
  }

  // The takeaway bar, on every layout. Drawn after the content so it sits on
  // top of nothing — the band above was already shortened to make room.
  if (!noteDrawn) requests.push(...noteRequests(page, id, slide.note, onDark,
    contentBottom !== undefined ? contentBottom + NOTE.gap : undefined, noteWidth, noteX));

  requests.push(...logoRequests(id("logo"), page, style, slide));

  // The footer, from the master template: "The Content Engine" at the left and
  // the page number at the right of every slide except the cover and the
  // closing. It lives in the bottom margin band, below where any layout is
  // allowed to draw, so it can never collide with content. The number is the
  // builder's own — index is authoritative here in a way a model-supplied
  // number never is.
  if (layout !== "cover" && layout !== "closing") {
    // ONE DISCREET LINE WITH TWO ENDS: the running head, and the folio.
    //
    // The footer used to sit 1.5pt from the bottom edge — inside the overscan
    // of most projectors, so on the room's screen it was either cropped or
    // stuck to the bezel — and carried a page number written as static text,
    // which went wrong the moment the user merged two slides by hand. They
    // removed both from every page. The reference deck's credit line sits
    // ~15pt clear of the edge and names the programme; this does the same,
    // with the deck's title stamped by the builder rather than typed per
    // slide.
    //
    // THE NUMBER IS BACK, and the objection that removed it is answered rather
    // than forgotten. What went wrong was a number the MODEL wrote into a spec
    // that then outlived the edit; this one is `index + 1` computed by the
    // builder, and every route that draws a deck — draft, preview, PDF,
    // publish, and every edit through applyEditSlide — rebuilds all of its
    // slides through this function with fresh indices, so an insert renumbers
    // the pages after it. It can only be wrong if somebody edits in Drive,
    // which is exactly as true of the deck title sitting beside it.
    //
    // The running head gives up a slot at its right end rather than having the
    // number laid over it: this box spans the whole content measure, so a
    // number box on the same line would overlap it on every slide in the deck,
    // and 618 box overlaps the geometry check is right to report is a check
    // nobody reads any more.
    const inkLeft = onDark ? { ...TYPE.footerLeft, color: COLOR.greyLight } : TYPE.footerLeft;
    const chromeFrom = chrome.from;
    const chromeWidth = chrome.to - chrome.from;
    // AND IT GIVES UP THE CREDIT'S ROOM AS WELL AS THE FOLIO'S. Three things
    // are on this line whenever a photograph is credited, not two, and the same
    // argument that put the folio in its own slot applies to the third.
    const creditOnLine = creditRoom(creditDrawn);
    const headWidth = footerLineWidth(chromeFrom, chromeWidth, chrome.to) - creditOnLine;
    if (headWidth >= 60) {
      requests.push(
        ...textBox(id("ftl"), page, slide.footer || "The Content Engine", inkLeft, {
          x: chromeFrom, y: FOOTER_Y, width: headWidth, height: 12,
        }),
      );
    }
    // THE FRAME, last, and only on the pages that carry the chrome. A section
    // divider is punctuation rather than a page: it carries no lockup either
    // (LOGO_PLACEMENT has no entry for it), and it takes the ground and the
    // folio without either hairline — see frameRequests' `rules`.
    requests.push(...frameRequests(page, id, style, index, layout !== "section", SLIDE_INK || [], rail, chrome));
  }
  return requests;
}

/** Speaker notes need a second pass: they live on a notes page whose shape id
 *  Google assigns when the slide is created, so it cannot be referenced in the
 *  same batchUpdate that creates it. Best-effort — a deck that lands without
 *  its notes is still the deck the user asked for. */
async function applySpeakerNotes(
  presentationId: string,
  slides: SlideInput[],
  token: string
): Promise<void> {
  if (!slides.some((s) => s.notes?.trim())) return;

  const fields = "slides(objectId,slideProperties(notesPage(notesProperties(speakerNotesObjectId))))";
  const read = await googleFetch(`${SLIDES_API}/${presentationId}?fields=${encodeURIComponent(fields)}`, token);
  if (!read.ok) {
    console.warn(`[Slides] could not read notes pages (${read.status})`);
    return;
  }

  const pages: any[] = read.json?.slides || [];
  const requests: Req[] = [];
  slides.forEach((slide, i) => {
    const text = slide.notes?.trim();
    const notesId = pages[i]?.slideProperties?.notesPage?.notesProperties?.speakerNotesObjectId;
    if (text && notesId) requests.push({ insertText: { objectId: notesId, text, insertionIndex: 0 } });
  });
  if (!requests.length) return;

  const res = await googleFetch(`${SLIDES_API}/${presentationId}:batchUpdate`, token, {
    method: "POST",
    body: JSON.stringify({ requests }),
  });
  if (!res.ok) console.warn(`[Slides] speaker notes failed (${res.status}) — deck itself is fine`);
}

/* ─────────────── Orchestration ─────────────── */

/** Every Google call in this file, and it NEVER throws.
 *
 *  It used to. A 45s timeout or a dropped socket rejected instead of returning
 *  {ok:false}, and each caller had been written on the assumption that a failure
 *  arrives as a status code. So the batchUpdate timeout skipped the cleanup that
 *  promises to leave nothing behind and orphaned a titled, empty presentation in
 *  the user's Drive; and a timeout on the speaker notes — which run AFTER the
 *  deck is finished and are best-effort by design — threw past the success
 *  return and reported a complete, correct deck as a failure.
 *
 *  status 0 means the request never got an answer, which is a different thing
 *  from a rejection and callers that can act on the difference do. */
async function googleFetch(url: string, token: string, init: RequestInit = {}) {
  try {
    const res = await fetch(url, {
      ...init,
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
        ...(init.headers || {}),
      },
      // The chat lambda is 300s and the stall guard does not cover tool
      // execution, so an unbounded fetch could burn the whole turn.
      signal: AbortSignal.timeout(45_000),
    });
    const json = await res.json().catch(() => ({} as any));
    return { ok: res.ok, status: res.status, json };
  } catch (err: any) {
    const message = err?.name === "TimeoutError" || err?.name === "AbortError"
      ? "Google did not answer in time"
      : err?.message || "Could not reach Google";
    console.warn(`[Slides] ${init.method || "GET"} ${url.split("?")[0]} failed: ${message}`);
    return { ok: false, status: 0, json: { error: { message } } as any };
  }
}

/**
 * Split a slide whose body will not fit, rather than letting it overflow.
 *
 * Slides does not reflow or shrink text to fit a box — it draws it and lets it
 * run past the edge, off the bottom of the slide. So an over-long body silently
 * loses its last bullets, and nothing in the deck says so.
 *
 * Splitting rather than shrinking is deliberate: type size is part of the brand
 * and a slide set two points smaller than its neighbours reads as a mistake,
 * where a second slide reads as a deck. The continuation keeps the title with a
 * marker so it is obviously the same thought, not a new one.
 *
 * Estimated, not measured — there is no text metric server-side. The estimate
 * is deliberately generous: splitting a slide that would have fit is a smaller
 * error than dropping the words that did not.
 */
/** A table the writer split by hand — "Title (continued)" over the same
 *  columns — is one table again. The engine never splits a table (the
 *  splitter excludes them on purpose), so a "(continued)" table is always the
 *  MODEL's doing, and the reference deck keeps nine engines on one page. The
 *  renderer declares "Showing N of M" if the rejoined rows exceed the cap. */
export function mergeContinuedTables(slides: SlideInput[]): SlideInput[] {
  const out: SlideInput[] = [];
  for (const s of slides) {
    const prev = out[out.length - 1];
    const cont = !!(s && s.layout === "table" && s.table && /\(continued\)\s*$/i.test(String(s.title || "")));
    const sameCols = !!(prev && prev.layout === "table" && prev.table &&
      JSON.stringify(prev.table.columns || []) === JSON.stringify(s?.table?.columns || []));
    if (cont && sameCols) {
      prev.table = { ...prev.table, rows: [...(prev.table!.rows || []), ...(s.table!.rows || [])] };
      if (s.note?.trim()) prev.note = s.note;
      if (s.notes?.trim()) prev.notes = [prev.notes, s.notes].filter(Boolean).join("\n");
      continue;
    }
    out.push(s);
  }
  return out;
}

export function splitOverflowingSlides(slides: SlideInput[]): SlideInput[] {
  // A "(continued)" table is rejoined BEFORE anything is split, on every path
  // that builds a deck, so the preview and the Drive build agree.
  slides = mergeContinuedTables(slides);
  const out: SlideInput[] = [];
  for (let i = 0; i < slides.length; i++) {
    // A FIXPOINT, not one pass. Splitting a body in two used to assume the
    // remainder fitted; a body three times the box produced one full slide and
    // one that still overflowed.
    const pending: SlideInput[] = [slides[i]];
    for (let guard = 0; guard < 12 && pending.length; guard += 1) {
      const slide = pending.shift() as SlideInput;
      const pieces = splitOnce(slide, out.length);
      if (pieces.length === 1) { out.push(pieces[0]); continue; }
      out.push(pieces[0]);
      pending.unshift(...pieces.slice(1));
    }
    // Whatever the guard did not resolve still belongs in the deck.
    for (let j = 0; j < pending.length; j++) out.push(pending[j]);
  }
  return out;
}

/** The box a layout actually draws `body` into, found by PROBING the builder.
 *
 *  Measured rather than listed, the same trick textBandsFor uses, because the
 *  estimate has to follow the geometry: the splitter measured every body
 *  against the full 671pt content width, and image-split draws it into 315pt.
 *  A body it judged to be eight lines was sixteen in the box it landed in, so
 *  the slide that most needed splitting was the one never split. */
const PROBE = "\u241E";

/** True while the splitter is measuring a layout with a dummy body. A layout
 *  that sizes its box to its words must report its CEILING here, not the hug:
 *  the splitter asks "how much room does this field have", and a box drawn
 *  to fit a two-line probe answered "two lines" — so every real body was
 *  judged to overflow and a 39-slide deck came back as 53. */
let PROBING = false;

/** Whether the block holding the probe's sentinel wraps its paragraphs on
 *  words. Written by bulletBlock during the probe and read once by bodyBox —
 *  the same shape as PROBING above, and for the same reason: it is an answer
 *  the request stream cannot carry. */
let PROBE_RAGGED = false;

function bodyBox(
  slide: SlideInput, index: number, field: "body" | "bodyRight"
): {
  width: number; height: number; size: number; bullets: boolean; spaceBelow: number;
  font?: string; ragged?: boolean;
} | undefined {
  // The probe must measure the box this slide will END UP with, not the box it
  // has right now. On content/case-study a picture becomes a RIGHT-HAND RAIL
  // that narrows the body from 540pt to 432pt — but splitting runs BEFORE image
  // resolution, so the slide carries only `image: {query}` and railBox, which
  // keys on resolvedImage, would report no rail and measure the wide column. A
  // body that overflows the narrow column then never splits and runs off the
  // slide. So: if the slide WILL carry a rail (it has an image intent, resolved
  // or not), the probe gets a stub resolvedImage to force the narrow measure.
  const willRail = (slide.resolvedImage?.url || slide.image?.query || slide.image?.url) &&
    (slide.layout === "content" || slide.layout === "case-study");
  const probe: any = {
    ...slide,
    resolvedImage: willRail ? { url: "probe", scrim: 0 } : undefined,
  };
  probe[field] = `${PROBE}\n${PROBE}`;
  PROBING = true;
  PROBE_RAGGED = false;
  let reqs: any[];
  try { reqs = buildSlideRequests(probe, index, "m") as any[]; } finally { PROBING = false; }
  const ragged = PROBE_RAGGED;
  let id: string | undefined;
  for (const r of reqs) {
    if (r.insertText && String(r.insertText.text).indexOf(PROBE) >= 0) { id = r.insertText.objectId; break; }
  }
  if (!id) return undefined;   // this layout does not draw that field at all
  // `bullets` is a const now and reads false for ever: the builder stopped
  // emitting Slides' own bullet preset when the hung disc took over every list,
  // so nothing downstream can turn it back on. It stays as a named value rather
  // than being inlined because the measurement helpers below take it, and a
  // literal `false` at four call sites says nothing about why.
  const bullets = false;
  let width = 0, height = 0, size = TYPE.body.size, spaceBelow = SPACE_BELOW;
  let font: string | undefined;
  for (const r of reqs) {
    if (r.createShape && r.createShape.objectId === id) {
      width = r.createShape.elementProperties.size.width.magnitude;
      height = r.createShape.elementProperties.size.height.magnitude;
    }
    if (r.updateTextStyle && r.updateTextStyle.objectId === id && r.updateTextStyle.style?.fontSize) {
      size = r.updateTextStyle.style.fontSize.magnitude;
    }
    // The FACE, read the same way as the size. Measuring body copy against the
    // widest face in the deck is what split slides that fitted.
    if (r.updateTextStyle && r.updateTextStyle.objectId === id && r.updateTextStyle.style?.weightedFontFamily?.fontFamily) {
      font = r.updateTextStyle.style.weightedFontFamily.fontFamily;
    }
    // The gap the layout actually draws between paragraphs, so the splitter
    // and the renderer never disagree about how tall a list is.
    if (r.updateParagraphStyle && r.updateParagraphStyle.objectId === id && r.updateParagraphStyle.style?.spaceBelow?.magnitude !== undefined) {
      spaceBelow = r.updateParagraphStyle.style.spaceBelow.magnitude;
    }
  }
  return { width, height, size, bullets, spaceBelow, font, ragged };
}

/** How much room a block of paragraphs needs in a given box. */
const SPACE_BELOW = 6;

function blockHeight(
  paras: string[],
  box: { width: number; size: number; bullets: boolean; spaceBelow?: number; font?: string; ragged?: boolean }
): number {
  // THE SPLITTER MEASURES WITH THE RULER THE BLOCK WILL BE DRAWN WITH, and the
  // probe is what says which one that is. Left on the count model here, a
  // photo rail's 187pt column would be judged to fit a body the block then
  // draws a line taller per paragraph, so the slide that most needed splitting
  // is the one never split — the same two-rulers failure bodyBox itself was
  // written to end.
  const ragged = !!box.ragged;
  let lines = 0;
  for (let i = 0; i < paras.length; i++) {
    lines += Math.max(1, ragged
      ? raggedLines(paras[i], box.width, box.size, box.font)
      : estimateLines(paras[i], box.width, box.size, box.bullets, false, box.font));
  }
  return drawnTextHeight(lines, box.size, box.spaceBelow ?? SPACE_BELOW, paras.length);
}

/** One split, or none. */
function splitOnce(slide: SlideInput, index: number): SlideInput[] {
  const body = slide.body;
  // Only prose layouts overflow this way; a chart's geometry is bounded.
  // Structured layouts are excluded wholesale: a slide is split by dividing
  // its BODY, and everything else on it is copied — so splitting a table
  // slide would print the entire table twice, once per half. The body on
  // those layouts is commentary, bounded, and better slightly long than
  // duplicated.
  const splittable = !slide.chart && !slide.stats && !slide.milestones && !slide.tracks &&
    !slide.cards && !slide.quote && !slide.stages && !slide.logos &&
    !slide.table && !slide.comparison && !slide.swot && !slide.matrix &&
    !slide.venn && !slide.scatter && !slide.layers && !slide.hub && !slide.images && !slide.panel;
  if (!body || !splittable) return [slide];

  // The cover and the closing size their body box TO THE CONTENT, so the
  // probe (which measures a two-line body) reports a box the real body would
  // never be given, and the closing's three wrapped lines became "Thank you
  // (continued)". A box that grows with its text cannot overflow; it is
  // clamped to the canvas instead.
  if (slide.layout === "closing" || slide.layout === "cover") return [slide];
  const box = bodyBox(slide, index, "body");
  if (!box || box.width <= 0) return [slide];

  const paras = body.split("\n");
  if (blockHeight(paras, box) <= box.height) return [slide];

  let take = 0;
  for (let i = 0; i < paras.length; i++) {
    if (take && blockHeight(paras.slice(0, i + 1), box) > box.height) break;
    take = i + 1;
  }
  // A single paragraph taller than the whole box cannot be split by lines; let
  // it through rather than emitting an empty slide and looping.
  if (!take || take >= paras.length) return [slide];

  // BALANCE. Filling the first slide to the brim and leaving one bullet on the
  // second is how a deck ends up with a slide carrying a title and the words
  // "Fee: CHF 6,000". If the remainder would be nearly empty, split down the
  // middle instead — as long as the first half still fits.
  const rest = () => paras.slice(take);
  if (blockHeight(rest(), box) < box.height * 0.4 && take > 1) {
    const middle = Math.ceil(paras.length / 2);
    if (middle < take && blockHeight(paras.slice(0, middle), box) <= box.height) take = middle;
  }

  const cleared: Record<string, undefined> = {};
  for (let i = 0; i < CONTINUATION_CLEARS.length; i++) cleared[CONTINUATION_CLEARS[i]] = undefined;
  return [
    { ...slide, body: paras.slice(0, take).join("\n") },
    {
      ...slide,
      // "(continued)" once, however many times a body has to be split — a
      // fixpoint over a very long body otherwise produced "T (continued)
      // (continued) (continued)".
      title: /\(continued\)\s*$/.test(slide.title || "")
        ? slide.title
        : `${slide.title || ""} (continued)`.trim(),
      body: rest().join("\n"),
      // The eyebrow and the speaker notes belong to the first half — an eyebrow
      // repeated reads as a new section starting. The picture is INHERITED
      // instead of re-requested: dropping it left an image-split slide as a
      // column of text beside half a slide of nothing, and keeping the query
      // would buy a second, different photograph for the same point. See
      // inheritContinuationImages, which runs after resolution — splitting
      // happens BEFORE it, so there is nothing to copy yet at this moment.
      // THE COLUMN FIELDS AND THE EYEBROW GO WITH IT, and the list is DERIVED
      // rather than written here: the spread copies every field, so a
      // two-column slide whose LEFT column overflowed repeated its whole right
      // column on the continuation. Written by hand the list was followed
      // once — `bodyThird` was added to the builder and to the edit path's
      // TEXT_EXTRAS and not here, so the third column of a split three-column
      // slide was repeated verbatim on all four pieces. See
      // CONTINUATION_CLEARS: one list, so the next column field cannot be
      // added to one of them and not the other.
      // The standfirst and the takeaway belong to the FIRST half too. A real
      // conversion produced a continuation carrying one leftover sentence,
      // padded to a full slide by the intro and the takeaway repeated verbatim
      // — framing cloned to dress up a slide that holds almost nothing.
      // THE ONE THING THE PICTURE'S BRIEF LEAVES BEHIND IS THAT IT IS A
      // SCREENSHOT. Clearing `image` outright cleared that too, so the tail
      // inherited an un-baked, un-gradiented UI capture and treated it as a
      // photograph: `feature` bled it full-bleed under white type and
      // image-split cropped it to the half-slide and ran it off the edge — the
      // invisible slide this whole treatment exists to prevent, one slide
      // along. The callouts do NOT come with it: the pins and their numbered
      // lines belong to the half of the body that explains them.
      image: isScreenshot(slide) ? { screenshot: true } : undefined,
      ...cleared,
      subtitle: undefined, note: undefined, strip: undefined, tones: undefined,
      continuation: true,
    },
  ];
}

/**
 * Turn every slide's image BRIEF into an actual picture, before anything is
 * drawn or previewed.
 *
 * Resolution happens once, up front, for a reason: the preview and the built
 * deck must show the same photograph. Resolving lazily at draw time would give
 * a draft one Unsplash hit and the published deck another, and the preview
 * would stop predicting the deck — which is the one thing it has to do.
 *
 * Slides resolve concurrently, and a slide whose image cannot be found simply
 * keeps its solid brand background rather than failing the deck.
 */
/** Where this layout will draw text on top of the photograph, as fractions of
 *  the canvas — read from the layout ITSELF rather than listed by hand.
 *
 *  Listing them by hand is what went wrong: the gradient was built for a cover,
 *  whose title sits across the foot, and every other full-bleed layout inherited
 *  a shape that was never measured against where its own words land. A closing
 *  slide writes across the middle and a feature slide starts at the very top,
 *  and both were given a picture that is lightest exactly there.
 *
 *  Derived from the same request list the deck is built from, so a box that
 *  moves takes its gradient with it. */
export function textBandsFor(slide: SlideInput, index: number): TextBand[] {
  const raw: TextBand[] = [];
  for (const req of buildSlideRequests({ ...slide, resolvedImage: undefined }, index, "band")) {
    const shape = (req as any).createShape;
    if (!shape || shape.shapeType !== "TEXT_BOX") continue;
    const y = shape.elementProperties.transform.translateY;
    const h = shape.elementProperties.size.height.magnitude;
    const top = Math.max(0, Math.min(1, y / CANVAS.height));
    const bottom = Math.max(0, Math.min(1, (y + h) / CANVAS.height));
    if (bottom > top) raw.push({ top, bottom });
  }
  // The photo credit is added by hand, because it is the one box that cannot be
  // derived: it exists only once the image has been resolved, and this runs to
  // decide how to bake that image. White 6pt type on an unmeasured foot is
  // exactly the case that leaves a photographer's name invisible.
  raw.push({
    top: IMAGE.creditY / CANVAS.height,
    bottom: (IMAGE.creditY + IMAGE.creditHeight) / CANVAS.height,
  });

  // Merged, because eight overlapping boxes is eight measurements of nearly the
  // same pixels.
  raw.sort((a, b) => a.top - b.top);
  const merged: TextBand[] = [];
  for (const band of raw) {
    const last = merged[merged.length - 1];
    if (last && band.top <= last.bottom + 0.02) last.bottom = Math.max(last.bottom, band.bottom);
    else merged.push({ ...band });
  }
  return merged;
}

/** Give every continuation the picture of the slide it was cut from.
 *
 *  Run AFTER resolution, because splitting runs before it: at the moment the
 *  slide is cut there is only an image QUERY, and nothing to copy. Keeping the
 *  query on the tail instead would buy a second, different photograph for the
 *  same point — and pay for it. This was shipped once as `resolvedImage` left
 *  on the continuation, which did nothing at all: the field is empty when the
 *  splitter runs, and the check that was supposed to prove otherwise used a
 *  fixture with the picture already resolved.
 */
export function inheritContinuationImages(slides: SlideInput[]): void {
  for (let i = 1; i < slides.length; i++) {
    const slide = slides[i];
    if (!slide.continuation || slide.resolvedImage) continue;
    const parent = slides[i - 1];
    if (parent.resolvedImage) slide.resolvedImage = parent.resolvedImage;
  }
}

/** Reissue the capability URLs a persisted draft carries.
 *
 *  They last thirty days; the draft in the thread lasts for ever. A deck
 *  reopened five weeks later handed Google links it could only 404 — and one
 *  unfetchable image fails the whole batchUpdate, so the deck did not build at
 *  all rather than building with a gap. Anything not minted by us passes
 *  through untouched. */
export function refreshDeckImageUrls(slides: SlideInput[]): void {
  for (let i = 0; i < slides.length; i++) {
    const s: any = slides[i];
    if (s.resolvedImage?.url) s.resolvedImage.url = refreshSignedMediaUrl(s.resolvedImage.url);
    if (s.quote?.resolvedImage?.url) {
      s.quote.resolvedImage.url = refreshSignedMediaUrl(s.quote.resolvedImage.url);
    }
    for (const r of s.resolvedImages || []) if (r?.url) r.url = refreshSignedMediaUrl(r.url);
    for (const l of s.logos || []) if (l?.resolvedUrl) l.resolvedUrl = refreshSignedMediaUrl(l.resolvedUrl);
    for (const c of s.cards || []) {
      if (c?.resolvedImage?.url) c.resolvedImage.url = refreshSignedMediaUrl(c.resolvedImage.url);
      if (c?.resolvedIcon) c.resolvedIcon = refreshSignedMediaUrl(c.resolvedIcon);
    }
    for (const g of s.hub?.groups || []) {
      for (const it of g?.items || []) {
        if (it?.resolvedIcon) it.resolvedIcon = refreshSignedMediaUrl(it.resolvedIcon);
      }
    }
  }
}

/** Hands back the bytes of the user's Nth attached image (1-based), or null.
 *  Injected rather than imported so lib/slides never reaches into the chat
 *  layer — the same reason the image GENERATOR is injected. */
export type AttachmentSupplier = (
  index: number
) => Promise<{ bytes: Buffer; contentType: string } | null>;

export async function resolveDeckImages(
  slides: SlideInput[],
  generate?: ImageGenerator,
  attachments?: AttachmentSupplier,
  /** Ticked once per slide whose picture had to be fetched or generated. The
   *  execution phase used to be SILENT — a 27-slide deck with photographs sat
   *  behind one static line for minutes and read as hung. */
  onProgress?: (done: number, total: number) => void
): Promise<void> {
  // Normalise the layout name ONCE, here, because every build path goes through
  // this function. A slide asking for "title" or "bullets" — names the sibling
  // .pptx tool uses, which the model sees in the same turn — is drawn as the
  // nearest real layout instead of throwing, and the substitution is recorded
  // on the slide so the deck can be described accurately afterwards.
  slides.forEach((slide, i) => {
    // THE HUB THE BUILDER WILL DRAW, first and in place. The publish route
    // hands client-held slides straight here, and a draft stored before the
    // guard normalised keeps `groups` beside the title — or has no layout at
    // all, which the line below would otherwise settle as "content" for good,
    // before normaliseSlide could call it a hub. In place, because this
    // function already writes its results onto the slide.
    const drawnView = normaliseSlide(slide);
    if (drawnView !== slide) {
      for (const k of Object.keys(slide)) if (!(k in drawnView)) delete (slide as any)[k];
      Object.assign(slide, drawnView);
    }
    const asked = slide.layout as string | undefined;
    const used = layoutOf(asked, i);
    if (asked && asked !== used) {
      slide.layoutAsked = asked;
      console.warn(`[Slides] slide ${i + 1}: unknown layout "${asked}" — drawn as "${used}"`);
    }
    slide.layout = used;
  });

  // A deck-wide art-direction note, set once by the model, threaded into every
  // PHOTOGRAPH query so a deck's images read as one commission — a beach cover
  // and a factory feature can share "muted, cinematic, cool light" instead of
  // being two unrelated stock grabs. Never applied to a `url` (an exact image),
  // and never to logos, icons or a named person's portrait.
  const deckStyle = slides.find((sx) => sx.imageStyle?.trim())?.imageStyle?.trim();
  const styled = (req: ImageRequest): ImageRequest => {
    if (req.url || !req.query || !deckStyle) return req;
    return { ...req, query: `${req.query}. ${deckStyle}` };
  };

  const pending = slides.filter((sx) => namesAPicture(sx.image) && !sx.resolvedImage && !sx.imageUnavailable).length;
  let done = 0;
  const tick = () => { done++; try { onProgress?.(done, pending); } catch { /* progress must never break a build */ } };

  await Promise.all(
    slides.map(async (slide, slideIndex) => {
      const counted = !!(namesAPicture(slide.image) && !slide.resolvedImage && !slide.imageUnavailable);
      try {
      await (async () => {
      // `imageUnavailable` means we already tried and could not find one. It
      // is checked as well as `resolvedImage` because publishing re-runs this
      // whole resolution: a slide that previewed as flat navy — because
      // Unsplash 403'd on the demo tier, or the generator was rate-limited —
      // could pick up a picture nobody had reviewed on the way into Drive, and
      // the deck the user approved is not the deck they got. A retry is still
      // available: changing the image in the preview resolves it explicitly.
      // An ATTACHED image is resolved first and separately: it is not something
      // a stock search or a generator could ever supply — a screenshot of the
      // user's own product has to be the actual file they sent.
      if (slide.image?.attachment && !slide.resolvedImage && attachments) {
        const file = await attachments(slide.image.attachment);
        if (file) {
          const src = await attachmentImageSource(file.bytes, file.contentType, slide.image.region);
          if (src) {
            const railShape = pictureShape(slide.layout);
            const split = slide.layout === "image-split";
            if (drawsRawScreenshot(slide, slideIndex)) {
              // NOT BAKED AT ALL. The upload is already a signed, Google-
              // fetchable PNG of exactly the region asked for, and bakeBackdrop
              // re-encodes at JPEG q86 — which puts ringing on 12px interface
              // type, the one thing a callout points at. The layout draws it at
              // its own shape on a mat instead of cropping it to a box, so
              // nothing letterboxes either.
              //
              // Skipping the bake also skips safeFetchBuffer's SSRF guard, and
              // that is only safe because these are bytes the USER uploaded
              // rather than a URL. A `screenshot: true` with `image.url` still
              // goes through the bake below.
              slide.resolvedImage = {
                url: src.url, scrim: 0,
                aspect: src.width && src.height ? src.width / src.height : undefined,
                sourceWidth: src.width,
              };
            } else {
              // An attached PHOTOGRAPH is baked to the box it will sit in, like
              // any other picture, so it does not letterbox — AND it gets the
              // gradient wherever text sits on it. This said `gradient: false`
              // unconditionally, which is why an attached photo on a feature
              // slide was drawn under white type on raw daylight.
              const baked = await bakeImageSource(src, {
                aspect: railShape ? railShape.width / railShape.height
                  : split ? IMAGE.splitWidth / CANVAS.height
                  : CANVAS.width / CANVAS.height,
                gradient: !split && !railShape,
                textBands: split || railShape ? undefined : textBandsFor(slide, slideIndex),
                // contain, not cover: an attached picture is one the user chose
                // deliberately, and cropping it to fill a box cuts off whatever
                // made them choose it.
                fit: "contain",
              });
              slide.resolvedImage = { url: baked.url, scrim: 0, credit: baked.credit, logo: baked.logo };
            }
          }
        }
        if (!slide.resolvedImage) {
          slide.imageUnavailable = true;
          slide.imageError = `attachment ${slide.image.attachment} could not be read`;
        }
      }

      if (namesAPicture(slide.image) && !slide.resolvedImage && !slide.imageUnavailable) {
        // Crop to the SHAPE OF THE BOX the image will sit in. Baking everything
        // to 16:9 and dropping it into a tall half-slide letterboxes exactly the
        // way the full-bleed cover used to, which is the bug this closes.
        // Gradient only where text sits on the picture.
        const split = slide.layout === "image-split";
        // A prose slide's picture is a rail down the right, not a backdrop, so
        // it is cropped to the rail's own shape. Baking it 16:9 and dropping it
        // into a 239x272 box is the letterboxing every other path fixed.
        const railShape = pictureShape(slide.layout);
        // Tell the baker where this layout's lockup will land, so it measures
        // the part of the picture the mark actually sits on.
        const style = slideStyle(slide, slideIndex);
        const place = LOGO_PLACEMENT[style.logoPlacement];
        // A `url` or `query` picture declared a SCREENSHOT still goes through
        // the bake — this is the path that fetches an arbitrary URL, and the
        // SSRF guard lives in it. Nothing measured its shape, so it is fitted
        // whole onto the MAT's own colour at 16:10: the bars then read as the
        // picture sitting on its mat rather than as letterboxing.
        const shot = drawsRawScreenshot(slide, slideIndex);
        const r = await resolveImage(styled(slide.image), generate, {
          aspect: shot ? SHOT.unknownAspect
            : railShape
            ? railShape.width / railShape.height
            : split ? IMAGE.splitWidth / CANVAS.height : CANVAS.width / CANVAS.height,
          // No text sits on the rail or the split picture, so neither is
          // darkened; a gradient there would dim a photograph for nothing. And
          // a gradient over an INTERFACE destroys what the slide points at.
          gradient: !shot && !split && !railShape,
          ...(shot ? { fit: "contain" as const, background: SHOT.matLight } : {}),
          textBands: shot || split || railShape ? undefined : textBandsFor(slide, slideIndex),
          logoRegion: {
            x: place.x / CANVAS.width, y: place.y / CANVAS.height,
            w: place.width / CANVAS.width, h: place.height / CANVAS.height,
          },
        });
        // `unusable` means the bake failed on a picture that CARRIES TEXT. The
        // baked gradient is the contrast mechanism there — the flat scrim
        // rectangle it replaced is gone — so using the raw file would put white
        // type on raw daylight. The designed navy ground is better, and the
        // reason is recorded rather than swallowed.
        if (r && !r.unusable) {
          slide.resolvedImage = {
            url: r.url, scrim: r.scrim, credit: r.credit, logo: r.logo,
            ...(shot ? { aspect: SHOT.unknownAspect } : {}),
          };
        } else {
          slide.imageUnavailable = true;
          slide.imageError = r?.unusable || "no image could be found for it";
        }
      }
      if (slide.quote?.image && !slide.quote.resolvedImage) {
        // trademark:true — the same guard the logos use, for the same reason.
        // A quote is attributed to a real named person, and the owned→stock→
        // generated chain would answer a "portrait of a CSO" query with a stock
        // photograph of a stranger, printed under that person's name. A missing
        // portrait must stay missing. A supplied `url` (an actual photo of the
        // person) still resolves — trademark only blocks the search/generate.
        const r = await resolveImage(slide.quote.image, generate, {
          aspect: 1, gradient: false, trademark: true,
        });
        if (r) slide.quote.resolvedImage = { url: r.url };
      }
      if (slide.logos?.length) {
        await Promise.all(slide.logos.map(async (l) => {
          if (!l || l.resolvedUrl) return;
          // contain, never cover: a cropped client mark is a misused trademark.
          // trademark, so a mark that cannot be found stays missing rather than
          // being filled in by stock photography or a generated picture.
          const r = await resolveImage({ url: l.url, query: l.query }, generate,
            { aspect: 2, gradient: false, fit: "contain", trademark: true });
          if (r) l.resolvedUrl = r.url;
        }));
      }
      if (slide.cards?.length) {
        const cardAspect = cardGeometry(slide.cards.length).aspect;
        await Promise.all(slide.cards.map(async (card) => {
          if (!card) return;
          if (card.icon && !card.resolvedIcon) {
            const icon = await resolveIcon(card.icon);
            if (icon) card.resolvedIcon = icon;
          }
          if (!card.image || card.resolvedImage) return;
          const r = await resolveImage(styled(card.image), generate, { aspect: cardAspect, gradient: false });
          if (r) card.resolvedImage = { url: r.url };
        }));
      }
      // Resolved on the hub the builder will DRAW: the slide was normalised in
      // place at the top of this function, so its icons are found on the same
      // view buildSlideRequests draws.
      if (slide.hub?.groups?.length) {
        // Rasterised in the group's ink, so an icon matches its node's tone.
        const hubGroups = slide.hub.groups;
        await Promise.all(hubGroups.map(async (g, gi) => {
          if (!g) return;
          const ink = hubTone(g.tone, gi).ink;
          await Promise.all((g.items || []).map(async (it) => {
            if (!it || !it.icon || it.resolvedIcon) return;
            const icon = await resolveIcon(it.icon, ink);
            if (icon) it.resolvedIcon = icon;
          }));
        }));
        // Recorded FRESH, from what is unresolved now, on the two groups that
        // are drawn: resolution re-runs at publish, and appending would repeat
        // a name per run and keep one the model has since replaced.
        const missing: string[] = [];
        for (const g of hubGroups.filter(Boolean).slice(0, 2)) {
          for (const it of g.items || []) {
            if (it && it.icon && !it.resolvedIcon && String(it.title || "").trim() && missing.indexOf(String(it.icon)) < 0) missing.push(String(it.icon));
          }
        }
        if (missing.length) slide.iconsMissing = missing;
        else delete slide.iconsMissing;
      } else if (slide.iconsMissing) {
        delete slide.iconsMissing;
      }
      if (slide.images?.length && !slide.resolvedImages) {
        const specs = slide.images.slice(0, 12);
        // WHICH pictures we get has to be settled before the shape to crop them
        // to can be. The crop came from the requested set and the cells from the
        // survivors, so six asked for and four found baked a 1.70 crop into a
        // 2.29 cell — and Slides letterboxes rather than stretches, which is
        // 57pt of dead ground per cell. The caption flip does the same thing:
        // whether ANY image carries a caption changes the cell height, and it
        // was read over the requested set too.
        const found = (await Promise.all(specs.map(async (spec) => {
          if (!spec) return null;
          const src = await selectImageSource(styled(spec), generate);
          return src ? { src, caption: spec.caption } : null;
        }))).filter(Boolean) as { src: ImageSource; caption?: string }[];

        if (found.length) {
          const aspect = gridGeometry(found.length, found.some((f) => f.caption)).aspect;
          // No text sits on a grid cell, so no gradient.
          slide.resolvedImages = await Promise.all(found.map(async (f) => ({
            url: (await bakeImageSource(f.src, { aspect, gradient: false })).url,
            caption: f.caption,
          })));
        }
        if (found.length < specs.length) {
          slide.imagesDropped = specs.length - found.length;
          console.warn(`[SlideImages] grid: ${slide.imagesDropped} of ${specs.length} images not found`);
        }
      }
      })();
      } finally {
        if (counted) tick();
      }
    })
  );

  // Tails of split slides take the picture of the slide they came from.
  inheritContinuationImages(slides);
}

/** Short unique prefix for one generation run. Base36 of the clock plus a few
 *  random characters: unique enough within a single presentation, and short
 *  enough to leave room under the 50-character objectId limit. */
function runId(): string {
  return `r${Date.now().toString(36)}${Math.random().toString(36).slice(2, 5)}`;
}

/** Replace every slide in an existing deck, keeping the FILE.
 *
 *  This is the difference between "make it more visual" changing the deck the
 *  user has open and handing them a second link to a near-identical file. The
 *  URL, revision history and any comments survive; only the slides are swapped.
 *
 *  New slides are created first and the old ones deleted in the same batch, so
 *  the deck is never momentarily empty and the whole swap is one atomic update.
 */
export async function updateSlides(
  presentationId: string,
  title: string,
  slides: SlideInput[],
  userEmail: string,
  generateImageFn?: ImageGenerator,
  attachments?: AttachmentSupplier,
  onImageProgress?: (done: number, total: number) => void
): Promise<SlidesResult> {
  const auth = await getUserGoogleToken(userEmail);
  if (!auth.ok || !auth.accessToken) {
    const reason = auth.reason as SlidesAuthFailure;
    return { ok: false, error: authFailureMessage(reason), reason };
  }
  const token = auth.accessToken;

  const existing = await googleFetch(
    `${SLIDES_API}/${presentationId}?fields=slides(objectId)`, token
  );
  if (!existing.ok) {
    // 404 here usually means the deck was created by something other than this
    // app: drive.file only reaches files we made. Reported, not worked around.
    return {
      ok: false,
      notFound: existing.status === 404 || existing.status === 403,
      error: `Could not open that deck to update it: ${existing.json?.error?.message || `HTTP ${existing.status}`}`,
    };
  }
  const oldIds: string[] = (existing.json?.slides || []).map((s: any) => s.objectId);

  slides = splitOverflowingSlides(slides);
  refreshDeckImageUrls(slides);
  await resolveDeckImages(slides, generateImageFn, attachments, onImageProgress);

  const run = runId();
  const requests: Req[] = slides.flatMap((slide, i) => buildSlideRequests(slide, i, run));
  for (const objectId of oldIds) requests.push({ deleteObject: { objectId } });

  const updated = await googleFetch(`${SLIDES_API}/${presentationId}:batchUpdate`, token, {
    method: "POST",
    body: JSON.stringify({ requests }),
  });
  if (!updated.ok) {
    const detail = updated.json?.error?.message || `HTTP ${updated.status}`;
    console.warn(`[Slides] update failed: ${detail}`);
    // No cleanup here, deliberately: the batch is atomic, so a failure leaves
    // the user's existing deck exactly as it was. Deleting would destroy it.
    return { ok: false, error: `Could not update the slides: ${detail}` };
  }

  // Keep the filename in step with the deck's own title.
  await googleFetch(`${DRIVE_API}/${presentationId}?supportsAllDrives=true`, token, {
    method: "PATCH",
    body: JSON.stringify({ name: title }),
  });

  await applySpeakerNotes(presentationId, slides, token);

  return {
    ok: true,
    presentationId,
    url: `https://docs.google.com/presentation/d/${presentationId}/edit`,
    title,
    slideCount: slides.length,
    updated: true,
    thumbnails: await captureThumbnails(presentationId, token),
  };
}

export async function generateSlides(
  title: string,
  slides: SlideInput[],
  userEmail: string,
  generateImageFn?: ImageGenerator,
  attachments?: AttachmentSupplier,
  onImageProgress?: (done: number, total: number) => void
): Promise<SlidesResult> {
  if (!userEmail) return { ok: false, error: "No signed-in user to create the deck for." };
  if (!slides?.length) return { ok: false, error: "No slides to build." };
  // The running head and the spine, re-derived here rather than trusted from
  // the draft: this is the deck that is about to exist in somebody's Drive, and
  // the numbers on it are the builder's own for the same reason the folio is.
  stampDeckChrome(slides, title);

  const auth = await getUserGoogleToken(userEmail);
  if (!auth.ok || !auth.accessToken) {
    const reason = auth.reason as SlidesAuthFailure;
    return { ok: false, error: authFailureMessage(reason), reason };
  }
  const token = auth.accessToken;

  const created = await googleFetch(SLIDES_API, token, {
    method: "POST",
    body: JSON.stringify({ title }),
  });
  if (!created.ok || !created.json?.presentationId) {
    const detail = created.json?.error?.message || `HTTP ${created.status}`;
    console.warn(`[Slides] create failed: ${detail}`);
    // A disabled API is the one failure with an actionable fix, and its message
    // is otherwise opaque enough that it looks like a permissions problem.
    if (/has not been used|is disabled/i.test(detail)) {
      return { ok: false, error: "The Google Slides API isn't enabled on this project yet." };
    }
    return { ok: false, error: `Could not create the presentation: ${detail}` };
  }

  const presentationId: string = created.json.presentationId;
  const defaultSlideId: string | undefined = created.json.slides?.[0]?.objectId;

  slides = splitOverflowingSlides(slides);
  refreshDeckImageUrls(slides);
  await resolveDeckImages(slides, generateImageFn, attachments, onImageProgress);

  const run = runId();
  const requests: Req[] = slides.flatMap((slide, i) => buildSlideRequests(slide, i, run));
  // Delete Slides' own starter slide LAST — removing it first would leave the
  // deck momentarily empty, and insertionIndex is evaluated as requests apply.
  if (defaultSlideId) requests.push({ deleteObject: { objectId: defaultSlideId } });

  const updated = await googleFetch(`${SLIDES_API}/${presentationId}:batchUpdate`, token, {
    method: "POST",
    body: JSON.stringify({ requests }),
  });

  if (!updated.ok) {
    const detail = updated.json?.error?.message || `HTTP ${updated.status}`;
    console.warn(`[Slides] batchUpdate failed: ${detail}`);

    // A request that never got an answer is not the same as one that was
    // refused. Google frequently finishes a batch we stopped waiting for, so
    // ASK before destroying: deleting a deck that was in fact built correctly,
    // and telling the user it failed, is the worse of the two mistakes.
    if (updated.status === 0) {
      const check = await googleFetch(
        `${SLIDES_API}/${presentationId}?fields=${encodeURIComponent("slides(objectId)")}`,
        token
      );
      const built: any[] = check.json?.slides || [];
      if (check.ok && built.length >= slides.length) {
        console.log(`[Slides] batch completed despite the timeout — ${built.length} slides present`);
        await applySpeakerNotes(presentationId, slides, token);
        return {
          ok: true,
          presentationId,
          url: `https://docs.google.com/presentation/d/${presentationId}/edit`,
          title,
          slideCount: slides.length,
          thumbnails: await captureThumbnails(presentationId, token),
        };
      }
    }

    // Leave nothing behind. An empty "Untitled presentation" appearing in
    // someone's Drive after a failed request is worse than no file at all.
    const cleanup = await googleFetch(`${DRIVE_API}/${presentationId}?supportsAllDrives=true`, token, {
      method: "DELETE",
    });
    if (!cleanup.ok) console.warn(`[Slides] could not clean up ${presentationId} (${cleanup.status})`);
    return { ok: false, error: `Could not build the slides: ${detail}` };
  }

  await applySpeakerNotes(presentationId, slides, token);

  return {
    ok: true,
    presentationId,
    url: `https://docs.google.com/presentation/d/${presentationId}/edit`,
    title,
    slideCount: slides.length,
    thumbnails: await captureThumbnails(presentationId, token),
  };
}
