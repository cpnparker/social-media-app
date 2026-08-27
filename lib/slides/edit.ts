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
    const fresh: any = { layout: edit.layout || "content" };
    if (typeof edit.title === "string") fresh.title = edit.title;
    if (typeof edit.subtitle === "string") fresh.subtitle = edit.subtitle;
    if (typeof edit.body === "string") fresh.body = edit.body;
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
