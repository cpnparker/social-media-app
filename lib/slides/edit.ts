/**
 * One-slide deck edits: patch a slide, or insert a new one.
 *
 * SEAMED OUT OF providers.ts DELIBERATELY. This is pure logic over a slide
 * array, and the interesting failures are all in its refusals — an index that
 * does not exist, an edit that names no change, an insert with nothing in it.
 * providers.ts cannot be imported by a check script (it pulls in the provider
 * SDKs and server-only config), so logic that lived there could not be tested
 * at all. Guarded by scripts/verify-slide-edit.ts.
 */

/** What each layout is DRAWN FROM. A layout in this table with its field
 *  missing has nothing to render: the slide comes out as a title over empty
 *  space. Layouts absent from the table are drawn from title/subtitle/body and
 *  cannot be blank in this way. */
const REQUIRED_PAYLOAD: { [layout: string]: string } = {
  cards: "cards",
  stat: "stats",
  "bar-chart": "chart",
  "stacked-bar": "chart",
  "line-chart": "chart",
  swot: "swot",
  matrix: "matrix",
  comparison: "comparison",
  scatter: "scatter",
  venn: "venn",
  timeline: "milestones",
  "timeline-parallel": "tracks",
  process: "stages",
  "logo-wall": "logos",
  quote: "quote",
  "image-grid": "images",
};

function isEmptyPayload(v: any): boolean {
  if (v == null) return true;
  if (Array.isArray(v)) return v.length === 0;
  if (typeof v === "object") return Object.keys(v).length === 0;
  return false;
}

/**
 * Every slide in a deck that would be drawn BLANK, whatever route it arrived by.
 *
 * WHY THIS IS NOT JUST THE INSERT GUARD. The insert path refuses a layout it
 * cannot fill, but the model does not only insert — it also resends the whole
 * deck through `slides`, and the deck it resends is the one it can SEE, which
 * is the stored spec replayed into its context. So once a blank slide is in the
 * deck it is copied forward verbatim on every subsequent turn, and an
 * insert-only guard never runs again. That is exactly what happened on
 * 2026-08-27: a `cards` slide with no `cards` array survived three further
 * generations byte-identical, because nothing validated the array as a whole.
 *
 * Returns human-readable faults, most useful first. Empty means the deck draws.
 */
export function unrenderableSlides(slides: any[]): string[] {
  const faults: string[] = [];
  for (let i = 0; i < slides.length; i++) {
    const s = slides[i] || {};
    const n = i + 1;
    const layout = s.layout || (i === 0 ? "cover" : "content");
    const needs = REQUIRED_PAYLOAD[layout];
    if (needs && isEmptyPayload(s[needs])) {
      faults.push(
        `slide ${n} ("${s.title || "untitled"}") is a "${layout}" slide with no \`${needs}\` — it will be drawn as a title over empty space. Either supply \`${needs}\`, or change the layout to "content" and put the points in \`body\`, one per line.`
      );
    }
  }
  return faults;
}

/** Apply a single-slide edit to the FULL deck, changing only the named slide
 *  and leaving every other slide — text, layout, resolved image — untouched.
 *  Or, with `insertAfter`, add one new slide and leave all the rest untouched.
 *
 *  THROWS when the edit cannot be applied. It used to return the deck unchanged,
 *  which was indistinguishable from success: the route saved the untouched deck
 *  and the model — already narrating — told the user about a slide it had not
 *  made. Every generate_slides call site catches and reports the message back to
 *  the model, so throwing is what stops it claiming a change that never
 *  happened. Found live in production 2026-08-27. */
/** Layouts an inserted slide can be BUILT FROM the fields editSlide carries.
 *
 *  Everything else — stat, bar-chart, swot, matrix, timeline, quote, process,
 *  logo-wall and the rest — is defined by a structured payload (`stats`,
 *  `chart`, `milestones`, `cards`...) that this tool has no field for. A layout
 *  whose content field cannot be supplied renders as a BLANK SLIDE: correct
 *  title, correct position, nothing on it. That is exactly what shipped on
 *  2026-08-27 — the model picked `cards`, which needs a `cards` array, and the
 *  user got an empty slide where four cards should have been. So the insert
 *  refuses a layout it cannot fill and says what to do instead. */
const TEXT_LAYOUTS = [
  "content", "section", "cover", "case-study", "dark-index",
  "image-split", "feature", "closing", "two-column",
];

export function applyEditSlide(
  slides: any[],
  edit: {
    slideNumber?: number;
    insertAfter?: number;
    layout?: string;
    imageQuery?: string;
    title?: string;
    subtitle?: string;
    body?: string;
    bodyRight?: string;
    eyebrow?: string;
    cards?: { marker?: string; icon?: string; title?: string; body?: string }[];
  }
): any[] {
  // ADD a slide. `insertAfter` is the slide number the new one goes after, so 0
  // puts it first and slides.length appends. Without this the tool could only
  // patch, so "add a slide after slide 5" was structurally impossible — and
  // because the patch path failed silently, it looked like it had worked.
  if (edit.insertAfter != null) {
    const at = edit.insertAfter;
    if (!Number.isInteger(at) || at < 0 || at > slides.length) {
      throw new Error(
        `Cannot insert after slide ${at}: the deck has ${slides.length} slides, so insertAfter must be between 0 (before the first) and ${slides.length} (after the last).`
      );
    }
    if (
      typeof edit.title !== "string" &&
      typeof edit.body !== "string" &&
      typeof edit.subtitle !== "string"
    ) {
      throw new Error(
        "Cannot insert an empty slide: give the new slide at least a title or a body."
      );
    }

    const cards = Array.isArray(edit.cards) ? edit.cards.filter((c) => c && (c.title || c.body)) : [];
    const layout = edit.layout || (cards.length ? "cards" : "content");

    // A layout is only allowed if this tool can actually fill it. Otherwise the
    // slide is drawn with its title and nothing else.
    if (layout !== "cards" && TEXT_LAYOUTS.indexOf(layout) === -1) {
      throw new Error(
        `Cannot insert a "${layout}" slide with editSlide: that layout is drawn from a structured payload this tool cannot carry, so the slide would come out blank. Either insert it as one of ${TEXT_LAYOUTS.join(", ")}, or as "cards" with a cards array — or resend the whole deck through \`slides\`, which supports every layout.`
      );
    }
    if (layout === "cards" && cards.length < 2) {
      throw new Error(
        `A "cards" slide needs at least two cards, each with a title or a body — otherwise it is drawn empty. Pass \`cards\`, or use layout "content" with one bullet per line in \`body\`.`
      );
    }

    const fresh: any = { layout };
    if (typeof edit.title === "string") fresh.title = edit.title;
    if (typeof edit.subtitle === "string") fresh.subtitle = edit.subtitle;
    if (typeof edit.body === "string") fresh.body = edit.body;
    if (typeof edit.bodyRight === "string") fresh.bodyRight = edit.bodyRight;
    if (typeof edit.eyebrow === "string") fresh.eyebrow = edit.eyebrow;
    if (cards.length) fresh.cards = cards;
    if (edit.imageQuery?.trim()) fresh.image = { query: edit.imageQuery.trim() };
    return slides.slice(0, at).concat([fresh], slides.slice(at));
  }

  const idx = (edit.slideNumber ?? 0) - 1;
  if (idx < 0 || idx >= slides.length) {
    throw new Error(
      `Cannot edit slide ${edit.slideNumber ?? "(none given)"}: the deck has ${slides.length} slides. To ADD a slide pass insertAfter; to change one, pass a slideNumber between 1 and ${slides.length}.`
    );
  }
  if (
    !edit.imageQuery?.trim() &&
    typeof edit.title !== "string" &&
    typeof edit.subtitle !== "string" &&
    typeof edit.body !== "string"
  ) {
    throw new Error(
      `No change was given for slide ${edit.slideNumber}: pass at least one of title, subtitle, body or imageQuery.`
    );
  }
  return slides.map((sl, i) => {
    if (i !== idx) return sl;                       // every other slide byte-for-byte
    const next: any = { ...sl };
    if (edit.imageQuery?.trim()) {
      // New picture: set the brief and drop the resolved image so a fresh one is
      // fetched. imageUnavailable is cleared so resolution runs again.
      next.image = { query: edit.imageQuery.trim() };
      delete next.resolvedImage;
      delete next.imageUnavailable;
      delete next.imageError;
    }
    if (typeof edit.title === "string") next.title = edit.title;
    if (typeof edit.subtitle === "string") next.subtitle = edit.subtitle;
    if (typeof edit.body === "string") next.body = edit.body;
    return next;
  });
}
