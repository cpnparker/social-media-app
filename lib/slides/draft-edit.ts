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

export type SpecPath = (string | number)[];

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

function samePath(a?: SpecPath, b?: SpecPath): boolean {
  return !!a && !!b && a.length === b.length && a.every((v, i) => v === b[i]);
}

/** Write a value into a nested spec, creating nothing that is not already
 *  there — a path only ever comes from an element the layout actually drew. */
function writePath(spec: any, path: SpecPath, value: any): void {
  let node = spec;
  for (const key of path.slice(0, -1)) {
    if (node == null) return;
    node = node[key];
  }
  if (node != null) node[path[path.length - 1]] = value;
}

/** Write new text into both the spec and the rendered preview.
 *
 *  Both, deliberately: the spec is what gets published, the preview is what the
 *  user is looking at, and letting them drift is how a preview stops predicting
 *  the deck.
 *
 *  Addressed by path, so this reaches a bar's label or a stat's caption and not
 *  just the handful of top-level strings. */
export function setSlideText(
  draft: SlideDraft, slideIndex: number, path: SpecPath, value: string
): SlideDraft {
  const next = clone(draft);
  const spec = next.slides[slideIndex] as any;
  if (!spec) return draft;

  // A field the layout renders as a number is stored as one; typing letters
  // into it must not silently turn the data into a string.
  const current = path.reduce((o: any, k) => (o == null ? o : o[k]), spec);
  if (typeof current === "number") {
    const parsed = Number(value.replace(/[, ]/g, ""));
    if (!Number.isFinite(parsed)) return draft;
    writePath(spec, path, parsed);
  } else {
    writePath(spec, path, value);
  }

  for (const el of next.preview.slides[slideIndex]?.elements ?? []) {
    if (el.kind === "text" && samePath(el.path, path)) {
      el.text = el.caps ? value.toUpperCase() : value;
    }
  }
  return next;
}

/** Point one slide at a different picture. The URL is already resolved and
 *  baked by /api/slides/image, so this is the same patch as text. */
export function setSlideImage(
  draft: SlideDraft, slideIndex: number, url: string, query?: string, credit?: string,
  logo?: "white" | "navy"
): SlideDraft {
  const next = clone(draft);
  const spec = next.slides[slideIndex] as any;
  if (!spec) return draft;
  spec.image = { query: query ?? spec.image?.query };
  // `logo` is the variant the bake measured for THIS picture. Without it the
  // slide keeps the last image's answer, so swapping a dark photograph for a
  // bright one leaves a white lockup on a white sky.
  spec.resolvedImage = { url, scrim: 0, credit, logo: logo ?? spec.resolvedImage?.logo };

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

const LABELS: Record<string, string> = {
  eyebrow: "Eyebrow", title: "Title", subtitle: "Subtitle",
  body: "Body", bodyRight: "Right column",
  value: "Value", label: "Label", detail: "Detail", name: "Name",
  source: "Source", caption: "Caption", date: "Date",
};

/** A readable name for a path: "Stat 2 · Value", "Bar 3 · Label". */
function describe(path: SpecPath): string {
  const leaf = LABELS[String(path[path.length - 1])] ?? String(path[path.length - 1]);
  const group = path[0];
  // The LAST number in the path is the item's index. The first is the series
  // index on a chart path, which labelled every bar "Bar 1".
  const index = [...path].reverse().find((p) => typeof p === "number");
  if (path.length === 1) return leaf;
  const groupName =
    group === "stats" ? "Stat" :
    group === "milestones" ? "Milestone" :
    group === "tracks" ? (path.includes("phases") ? "Phase" : "Track") :
    group === "images" ? "Image" :
    group === "chart" ? (path.includes("points") ? "Bar" : "Chart") : String(group);
  return index === undefined ? `${groupName} · ${leaf}` : `${groupName} ${Number(index) + 1} · ${leaf}`;
}

/** EVERY piece of text the slide actually renders, in the order it is drawn.
 *
 *  Derived from the preview rather than from the layout, so a field only
 *  appears when it is genuinely on the slide — and every field that IS on the
 *  slide appears, including the words inside a chart or a timeline. */
export function editableFields(
  draft: SlideDraft, slideIndex: number
): { path: SpecPath; label: string; value: string; multiline: boolean }[] {
  const spec = draft.slides[slideIndex] as any;
  const seen = new Set<string>();
  const out: { path: SpecPath; label: string; value: string; multiline: boolean }[] = [];

  for (const el of draft.preview.slides[slideIndex]?.elements ?? []) {
    if (el.kind !== "text" || !el.path) continue;
    const key = el.path.join(".");
    if (seen.has(key)) continue;
    seen.add(key);
    const value = el.path.reduce((o: any, k) => (o == null ? o : o[k]), spec);
    if (value === undefined || value === null) continue;
    const leaf = String(el.path[el.path.length - 1]);
    out.push({
      path: el.path,
      label: describe(el.path),
      value: String(value),
      multiline: leaf === "body" || leaf === "bodyRight" || leaf === "detail",
    });
  }
  return out;
}
