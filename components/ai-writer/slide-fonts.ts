/**
 * The deck's three faces, loaded for the in-chat slide preview.
 *
 * The preview's font stack always NAMED Roboto, but nothing in the app loaded
 * it, so on a Mac every label was measured and drawn in Helvetica Neue — about
 * 7% wider at the semibold the hub labels use. "HR Absence Calendar" wrapped
 * on screen in a node where the deck keeps it on one line, and the PDF export,
 * which does link the webfonts (lib/slides/pdf-html.ts), disagreed with the
 * chat about the same slide. A preview drawn in a different face is not a
 * preview of the deck.
 *
 * Self-hosted through next/font rather than a fonts.googleapis.com <link>,
 * because the deployed site sits behind a CSP set outside this repo, and a
 * blocked stylesheet fails silently back to Helvetica Neue — which is the
 * defect itself, with nothing on screen to say so.
 *
 * The weights and styles mirror the link in pdf-html.ts, with one difference
 * forced on us: Next 14's bundled Google metadata lists Roboto as static
 * 100/300/400/500/700/900, and its build refuses weight 600 outright ("Unknown
 * weight"), even though Google now serves Roboto on a variable axis with a
 * real 600. The deck's semibold (weightedFontFamily 600) therefore draws from
 * the 700 face here — CSS font matching picks the next heavier face above 500.
 * For Roboto that is about 0.3% wider on a whole label (measured in
 * lib/slides/generate.ts, whose label table already takes the wider of the two
 * weights per glyph), so the preview can only err toward wrapping early.
 *
 * `adjustFontFallback: false` matters. By default next/font puts a
 * metric-adjusted Arial into the variable, sized to Roboto's AVERAGE glyph, and
 * that would sit in front of every fallback the preview names — a failed load
 * would then draw a lookalike that wraps where an average-width Roboto wraps,
 * in either direction. Without it the variable holds only the webfont, and the
 * stack in SlideDraftPreview falls through to faces that draw WIDER than
 * Roboto, never flattering the deck.
 *
 * `preload: false` because the chat shell renders on every EngineAI page and
 * most of them never show a deck; the browser fetches a face only when a slide
 * actually draws text in it. `display: "block"`, as the PDF uses, so a slide is
 * never painted first in the fallback face with its lines broken in the wrong
 * places and then reflowed.
 *
 * Loader arguments must be literals — next/font reads them at compile time —
 * so the variable names are repeated in fontStack by hand. check 39 in
 * scripts/verify-slide-layouts.ts renders the preview and asserts the two
 * agree, and runs these exact arguments through Next's own validator.
 *
 * A BUILD NOW NEEDS GOOGLE. next/font/google downloads these faces at build
 * time, and in a production build a failed download is a failed build (Next
 * 14.2's loader falls back to a local face only in dev). Every build of this
 * project runs on Vercel, which reaches fonts.googleapis.com, so that is
 * accepted; a build on a machine without that access fails here, not at
 * runtime. The way out, if it is ever needed, is next/font/local with Google's
 * variable woff2 files committed beside Geist — which would also give the
 * preview a real Roboto 600.
 */
import { Roboto, Playfair_Display, Poppins } from "next/font/google";

const roboto = Roboto({
  weight: ["300", "400", "500", "700"],
  style: ["normal", "italic"],
  display: "block",
  preload: false,
  adjustFontFallback: false,
  variable: "--font-slide-roboto",
});

const playfair = Playfair_Display({
  weight: ["400"],
  style: ["normal", "italic"],
  display: "block",
  preload: false,
  adjustFontFallback: false,
  variable: "--font-slide-playfair",
});

const poppins = Poppins({
  weight: ["400", "600"],
  display: "block",
  preload: false,
  adjustFontFallback: false,
  variable: "--font-slide-poppins",
});

/** The classes that declare the three variables. Applied on each slide's own
 *  frame rather than on the page, so every place a slide is drawn — the
 *  thumbnail grid and the full-size lightbox alike — carries them. */
export const SLIDE_FONT_CLASS = `${roboto.variable} ${playfair.variable} ${poppins.variable}`;
