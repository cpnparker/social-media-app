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
  table: "table",
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
/** Layouts drawn from title/subtitle/body alone, so they need no payload. */
const TEXT_LAYOUTS = [
  "content", "section", "cover", "case-study", "dark-index",
  "image-split", "feature", "closing", "two-column",
];

/**
 * The structured fields an edit may carry, which is every payload a layout is
 * drawn from.
 *
 * WHY THIS TOOL NOW CARRIES THEM. It used to accept only text layouts and
 * `cards`, and refused everything else on the honest grounds that a layout
 * whose payload it could not supply would render blank. The consequence turned
 * up building a 35-slide client deck: `generate_slides` REPLACES the deck, so
 * the only way to add a table slide was to resend all thirty-five at once —
 * which is the call that gets cut off. A deck with a chart or a table in it
 * could not be built up in pieces at all.
 *
 * Derived from REQUIRED_PAYLOAD rather than listed again, so a new layout
 * cannot be added to one and forgotten in the other.
 */
export const PAYLOAD_FIELDS: string[] = Object.keys(REQUIRED_PAYLOAD)
  .map((l) => REQUIRED_PAYLOAD[l])
  .filter((f, i, all) => all.indexOf(f) === i);

/** Can this layout be inserted with the fields given? Exported because it is
 *  the whole rule, and a rule worth enforcing is worth being able to run. */
export function insertableLayout(layout: string, edit: any): { ok: boolean; needs?: string } {
  const need = REQUIRED_PAYLOAD[layout];
  if (!need) return { ok: TEXT_LAYOUTS.indexOf(layout) >= 0 };
  return { ok: !isEmptyPayload(edit?.[need]), needs: need };
}

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
    /** SEVERAL slides at once, in order, at `insertAfter`. One slide per call
     *  is arithmetically hopeless for a long deck: the tool is capped at three
     *  calls a turn, so thirty-five slides would take twelve turns of a user
     *  typing "continue". A dozen at a time makes it one. */
    insertSlides?: any[];
    /** Any structured payload a layout is drawn from — `table`, `chart`,
     *  `stats`, `swot`, `milestones` and the rest. Same shape as in `slides`. */
    [payload: string]: any;
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
    // SEVERAL AT ONCE. Each is validated exactly as a single insert is, so a
    // batch cannot smuggle in a blank slide that one at a time would refuse.
    const batch = Array.isArray(edit.insertSlides) ? edit.insertSlides : null;
    if (batch) {
      if (!batch.length) throw new Error("insertSlides was empty: pass at least one slide, or use the single-slide fields.");
      const faults: string[] = [];
      const built = batch.map((raw: any, i: number) => {
        const one: any = { ...(raw || {}) };
        const lay = one.layout || (Array.isArray(one.cards) && one.cards.length ? "cards" : "content");
        if (typeof one.title !== "string" && typeof one.body !== "string" && typeof one.subtitle !== "string") {
          faults.push(`slide ${i + 1} of the batch has no title or body`);
          return one;
        }
        const ok = insertableLayout(lay, one);
        if (!ok.ok) {
          faults.push(ok.needs
            ? `slide ${i + 1} of the batch is "${lay}" but carries no \`${ok.needs}\`, so it would be blank`
            : `slide ${i + 1} of the batch names an unknown layout "${lay}"`);
        }
        one.layout = lay;
        if (one.imageQuery && String(one.imageQuery).trim()) {
          one.image = { query: String(one.imageQuery).trim() };
          delete one.imageQuery;
        }
        return one;
      });
      if (faults.length) throw new Error(`Cannot insert these slides: ${faults.join("; ")}.`);
      return slides.slice(0, at).concat(built, slides.slice(at));
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

    // A layout is allowed if this tool can actually FILL it — either it needs
    // no payload, or the payload was supplied. The check is the same one
    // `unrenderableSlides` applies to a whole deck, so an inserted slide cannot
    // pass here and be reported blank there.
    const can = insertableLayout(layout, edit);
    if (!can.ok) {
      throw new Error(
        can.needs
          ? `Cannot insert a "${layout}" slide without \`${can.needs}\`: that is what the layout is drawn from, so the slide would come out blank — a correct title with nothing under it. Pass \`${can.needs}\` alongside the title.`
          : `Cannot insert a "${layout}" slide: there is no such layout. Text layouts are ${TEXT_LAYOUTS.join(", ")}; every other layout needs its own payload (${PAYLOAD_FIELDS.join(", ")}).`
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
    for (const f of PAYLOAD_FIELDS) {
      if (f !== "cards" && !isEmptyPayload(edit[f])) fresh[f] = edit[f];
    }
    if (edit.imageQuery?.trim()) fresh.image = { query: edit.imageQuery.trim() };
    return slides.slice(0, at).concat([fresh], slides.slice(at));
  }

  const idx = (edit.slideNumber ?? 0) - 1;
  if (idx < 0 || idx >= slides.length) {
    throw new Error(
      `Cannot edit slide ${edit.slideNumber ?? "(none given)"}: the deck has ${slides.length} slides. To ADD a slide pass insertAfter; to change one, pass a slideNumber between 1 and ${slides.length}.`
    );
  }
  const changesPayload = PAYLOAD_FIELDS.some((f) => !isEmptyPayload(edit[f]));
  if (
    !edit.imageQuery?.trim() &&
    typeof edit.title !== "string" &&
    typeof edit.subtitle !== "string" &&
    typeof edit.body !== "string" &&
    !changesPayload
  ) {
    throw new Error(
      `No change was given for slide ${edit.slideNumber}: pass at least one of title, subtitle, body, imageQuery, or a payload such as ${PAYLOAD_FIELDS.slice(0, 3).join(", ")}.`
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
    // A payload change carries its layout with it: replacing a slide's `table`
    // without moving it off `content` leaves the table stored and undrawn.
    if (typeof edit.layout === "string" && edit.layout.trim()) next.layout = edit.layout.trim();
    for (const f of PAYLOAD_FIELDS) {
      if (!isEmptyPayload(edit[f])) next[f] = edit[f];
    }
    return next;
  });
}
