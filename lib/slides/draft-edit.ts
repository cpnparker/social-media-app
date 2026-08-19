/**
 * Editing a draft deck in place, without asking the model.
 *
 * The reason this is pure client-side patching rather than a round-trip: slide
 * geometry is FIXED. Every box's position and size comes from the brand grid,
 * not from its contents, so changing the words changes nothing else on the
 * slide. Re-running the layout engine to alter a title would return the same
 * boxes with different text in one of them.
 *
 * Which makes the round-trip worse than merely slow. Asking a model to reissue
 * a deck because one heading is wrong spends tokens re-emitting slides nobody
 * touched, and gives it licence to reword them on the way past. "Make the title
 * say X" should make the title say X.
 *
 * The model is still the right answer for anything that is genuinely a content
 * decision — adding a slide, tightening prose, restructuring an argument. That
 * goes through the comment box, unchanged.
 */

import type { SlideDraft } from "@/components/ai-writer/SlideDraftPreview";

type Field = "title" | "subtitle" | "body" | "eyebrow" | "bodyRight";

/** Structural clone, so React sees new objects and re-renders. */
function clone(draft: SlideDraft): SlideDraft {
  return {
    title: draft.title,
    slides: draft.slides.map((s: any) => ({ ...s })),
    preview: {
      ...draft.preview,
      slides: draft.preview.slides.map((s) => ({ ...s, elements: s.elements.map((e) => ({ ...e })) })),
    },
  };
}

/** Write new text into both the spec and the rendered preview.
 *
 *  Both, deliberately: the spec is what gets published, the preview is what the
 *  user is looking at, and letting them drift is how a preview stops predicting
 *  the deck. */
export function setSlideText(
  draft: SlideDraft, slideIndex: number, field: Field, value: string
): SlideDraft {
  const next = clone(draft);
  const spec = next.slides[slideIndex] as any;
  if (!spec) return draft;
  spec[field] = value;

  for (const el of next.preview.slides[slideIndex]?.elements ?? []) {
    if (el.kind === "text" && el.field === field) {
      el.text = el.caps ? value.toUpperCase() : value;
    }
  }
  return next;
}

/** Point one slide at a different picture. The URL is already resolved and
 *  baked by /api/slides/image, so this is the same patch as text. */
export function setSlideImage(
  draft: SlideDraft, slideIndex: number, url: string, query?: string, credit?: string
): SlideDraft {
  const next = clone(draft);
  const spec = next.slides[slideIndex] as any;
  if (!spec) return draft;
  spec.image = { query: query ?? spec.image?.query };
  spec.resolvedImage = { url, scrim: 0, credit };

  const elements = next.preview.slides[slideIndex]?.elements ?? [];
  // The backdrop is the full-canvas image; the logo is the other one, and must
  // not be swapped for a photograph.
  const backdrop = elements.find(
    (e) => e.kind === "image" && e.w >= next.preview.width - 1 && e.h >= next.preview.height - 1
  ) ?? elements.find((e) => e.kind === "image" && !e.src?.includes("logo_engine"));
  if (backdrop) backdrop.src = url;
  return next;
}

export function deleteSlide(draft: SlideDraft, slideIndex: number): SlideDraft {
  const next = clone(draft);
  next.slides.splice(slideIndex, 1);
  next.preview.slides.splice(slideIndex, 1);
  return next;
}

/** Move a slide one place in either direction. Both arrays move together or
 *  the preview starts describing a different deck than the one that publishes. */
export function moveSlide(draft: SlideDraft, from: number, delta: number): SlideDraft {
  const to = from + delta;
  if (to < 0 || to >= draft.slides.length) return draft;
  const next = clone(draft);
  const [spec] = next.slides.splice(from, 1);
  next.slides.splice(to, 0, spec);
  const [page] = next.preview.slides.splice(from, 1);
  next.preview.slides.splice(to, 0, page);
  return next;
}

/** Which fields a slide actually shows, so the editor only offers real ones. */
export function editableFields(draft: SlideDraft, slideIndex: number): { field: Field; label: string; value: string }[] {
  const labels: Record<Field, string> = {
    eyebrow: "Eyebrow", title: "Title", subtitle: "Subtitle", body: "Body", bodyRight: "Right column",
  };
  const spec = draft.slides[slideIndex] as any;
  const present = new Set(
    (draft.preview.slides[slideIndex]?.elements ?? [])
      .filter((e) => e.kind === "text" && e.field)
      .map((e) => e.field as Field)
  );
  return (Object.keys(labels) as Field[])
    .filter((f) => present.has(f))
    .map((f) => ({ field: f, label: labels[f], value: String(spec?.[f] ?? "") }));
}
