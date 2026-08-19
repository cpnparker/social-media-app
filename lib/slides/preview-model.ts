/**
 * A renderable model of a deck that does NOT exist yet.
 *
 * The published preview uses Google's thumbnail API, which needs a real file in
 * Drive. That is the wrong way round for reviewing a draft: it means a deck
 * lands, gets discussed, gets rebuilt, and the user is left working out which
 * of several files in their Drive is the current one. So a draft is rendered
 * from the SAME layout engine that will later build it — buildSlideRequests —
 * and nothing is written to Drive until the user asks for it.
 *
 * This walks the Slides API requests rather than re-implementing the layout.
 * Two renderers computing positions independently would drift, and the preview
 * would stop predicting the deck — which would make it worse than useless.
 */

import { buildSlideRequests, type SlideInput } from "@/lib/slides/generate";
import { CANVAS } from "@/lib/slides/brand";

export interface PreviewElement {
  kind: "rect" | "ellipse" | "text" | "image";
  /** Points, in the 720 × 405 canvas. The client scales to its own width. */
  x: number; y: number; w: number; h: number;
  fill?: string;
  text?: string;
  font?: string;
  size?: number;
  weight?: number;
  color?: string;
  align?: "start" | "center" | "end";
  bullets?: boolean;
  src?: string;
  /** 0–1. Carries the scrim's transparency; absent means fully opaque. */
  opacity?: number;
  /** Slides rounds ROUND_RECTANGLE far more than a 4px radius suggests. */
  rounded?: boolean;
  /** Where in the slide SPEC this text came from, as a path — ["title"], or
   *  ["stats", 0, "value"], or ["chart","series",0,"points",2,"label"].
   *
   *  A path rather than a field name because most text on a rich slide lives
   *  in nested arrays: a bar's label, a milestone's date, a stat's caption. A
   *  flat field name could only ever address the handful of top-level strings,
   *  which left the text people most want to fix — the words inside a chart —
   *  editable only by asking the model to rebuild the slide. */
  path?: (string | number)[];
  /** The style upper-cases this text for display; the spec keeps the original. */
  caps?: boolean;
  /** Text is centred vertically inside its box. */
  vCenter?: boolean;
}

/** Object ids are `<run>_s<index>_<suffix>`, and the suffix says which box it
 *  is. Turning that back into a spec path is what makes every word on a slide
 *  editable rather than just the top-level ones. */
const FLAT: Record<string, (string | number)[]> = {
  title: ["title"],
  sub: ["subtitle"],
  body: ["body"],
  eyebrow: ["eyebrow"],
  left: ["body"],
  right: ["bodyRight"],
  csrc: ["chart", "source"],
  lsrc: ["chart", "source"],
};

/** Indexed boxes: prefix → how to address the thing it renders. */
const INDEXED: [RegExp, (i: number) => (string | number)[]][] = [
  [/^sv(\d+)$/, (i) => ["stats", i, "value"]],
  [/^sl(\d+)$/, (i) => ["stats", i, "label"]],
  [/^sd(\d+)$/, (i) => ["stats", i, "detail"]],
  [/^bl(\d+)$/, (i) => ["chart", "series", 0, "points", i, "label"]],
  [/^bv(\d+)$/, (i) => ["chart", "series", 0, "points", i, "value"]],
  [/^d(\d+)$/,  (i) => ["milestones", i, "date"]],
  [/^t(\d+)$/,  (i) => ["milestones", i, "title"]],
  [/^x(\d+)$/,  (i) => ["milestones", i, "detail"]],
  [/^gc(\d+)$/, (i) => ["images", i, "caption"]],
  [/^tn(\d+)$/, (i) => ["tracks", i, "name"]],
];

function pathOf(objectId: string): (string | number)[] | undefined {
  const suffix = objectId.split("_").slice(2).join("_") || objectId.split("_").pop() || "";
  if (FLAT[suffix]) return FLAT[suffix];
  for (const [re, build] of INDEXED) {
    const m = re.exec(suffix);
    if (m) return build(Number(m[1]));
  }
  // Two-index boxes: a phase label inside a track.
  const phase = /^pl(\d+)_(\d+)$/.exec(suffix);
  if (phase) return ["tracks", Number(phase[1]), "phases", Number(phase[2]), "label"];
  return undefined;
}

/** Read a value out of a spec by path. */
export function readPath(spec: any, path: (string | number)[]): any {
  return path.reduce((o, k) => (o == null ? o : o[k]), spec);
}

export interface PreviewSlide {
  background: string;
  elements: PreviewElement[];
}

export interface PreviewDeck {
  width: number;
  height: number;
  slides: PreviewSlide[];
}

function hex(rgbColor: any): string {
  const c = (v: number | undefined) => Math.round((v ?? 0) * 255).toString(16).padStart(2, "0");
  return `#${c(rgbColor?.red)}${c(rgbColor?.green)}${c(rgbColor?.blue)}`;
}

function alignOf(a: string | undefined): PreviewElement["align"] {
  return a === "CENTER" ? "center" : a === "END" ? "end" : "start";
}

export function toPreviewModel(slides: SlideInput[]): PreviewDeck {
  const out: PreviewSlide[] = [];

  slides.forEach((slide, i) => {
    const requests = buildSlideRequests(slide, i, `p${i}`);
    const current: PreviewSlide = { background: "#FFFFFF", elements: [] };
    // Element order in the request list IS the z-order, so a map plus the
    // original order keeps the axis under the bars and the logo on top.
    const byId = new Map<string, PreviewElement>();

    for (const req of requests) {
      const [kind, body] = Object.entries(req)[0] as [string, any];

      if (kind === "updatePageProperties") {
        current.background = hex(body.pageProperties?.pageBackgroundFill?.solidFill?.color?.rgbColor);
      } else if (kind === "createShape") {
        const el: PreviewElement = {
          kind: body.shapeType === "ELLIPSE" ? "ellipse" : "rect",
          rounded: body.shapeType === "ROUND_RECTANGLE",
          x: body.elementProperties.transform.translateX,
          y: body.elementProperties.transform.translateY,
          w: body.elementProperties.size.width.magnitude,
          h: body.elementProperties.size.height.magnitude,
        };
        // A TEXT_BOX has no fill of its own; only the drawn shapes do.
        if (body.shapeType === "TEXT_BOX") el.kind = "text";
        byId.set(body.objectId, el);
        current.elements.push(el);
      } else if (kind === "createImage") {
        const el: PreviewElement = {
          kind: "image",
          src: body.url,
          x: body.elementProperties.transform.translateX,
          y: body.elementProperties.transform.translateY,
          w: body.elementProperties.size.width.magnitude,
          h: body.elementProperties.size.height.magnitude,
        };
        byId.set(body.objectId, el);
        current.elements.push(el);
      } else if (kind === "updateShapeProperties") {
        const el = byId.get(body.objectId);
        if (el && body.shapeProperties?.contentAlignment === "MIDDLE") el.vCenter = true;
        const solid = body.shapeProperties?.shapeBackgroundFill?.solidFill;
        const fill = solid?.color?.rgbColor;
        if (el && fill) el.fill = hex(fill);
        // ALPHA MATTERS. Dropping it renders the scrim — a full-canvas navy
        // rectangle at partial opacity — as solid navy, which hides the
        // photograph underneath completely. The deck was right and the preview
        // was not, which is the one failure a preview cannot have.
        if (el && typeof solid?.alpha === "number") el.opacity = solid.alpha;
      } else if (kind === "insertText") {
        const el = byId.get(body.objectId);
        if (el) {
          el.kind = "text";
          el.text = body.text;
          const path = pathOf(body.objectId);
          if (path) el.path = path;
        }
      } else if (kind === "updateTextStyle") {
        const el = byId.get(body.objectId);
        if (!el) continue;
        el.font = body.style?.weightedFontFamily?.fontFamily;
        el.weight = body.style?.weightedFontFamily?.weight;
        el.size = body.style?.fontSize?.magnitude;
        el.color = hex(body.style?.foregroundColor?.opaqueColor?.rgbColor);
      } else if (kind === "updateParagraphStyle") {
        const el = byId.get(body.objectId);
        if (el) el.align = alignOf(body.style?.alignment);
      } else if (kind === "createParagraphBullets") {
        const el = byId.get(body.objectId);
        if (el) el.bullets = true;
      }
    }

    // Whether a box is upper-cased is decided by COMPARING the rendered text to
    // the spec value it came from, not by inspecting the letters. "L" is
    // already upper-case and is not a caps style; guessing from the glyphs
    // writes an edit back shouting.
    for (const el of current.elements) {
      if (el.kind !== "text" || !el.path || !el.text) continue;
      const source = readPath(slide as any, el.path);
      if (typeof source === "string" && source !== el.text && source.toUpperCase() === el.text) {
        el.caps = true;
      }
    }

    // A text box that never received text would render as an invisible box; a
    // shape with no fill was a text box all along.
    current.elements = current.elements.filter(
      (el) => el.kind !== "text" || (el.text && el.text.trim())
    );
    out.push(current);
  });

  return { width: CANVAS.width, height: CANVAS.height, slides: out };
}
