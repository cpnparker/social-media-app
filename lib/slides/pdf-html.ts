/**
 * A deck draft as a printable HTML document — the PDF export's whole substance.
 *
 * ── WHY IT RENDERS THE PREVIEW MODEL AND NOT THE SPEC ───────────────────────
 *
 * The preview model is the one drawing of a deck that already exists in three
 * places: the chat preview renders it, the layout battery measures it, and it
 * is derived from the very requests Google Slides executes. Rendering the SPEC
 * again here would be a fourth layout engine, drifting from the other three the
 * day it ships. This file instead turns PreviewElements — absolute boxes with
 * text, fills, images and ranges — into absolutely-positioned HTML, so the PDF
 * is the preview the user just approved, printed.
 *
 * The canvas is the master template's: 960 × 540 px, 10 × 5.625 in. Preview
 * geometry is in the 720 × 405 pt Slides canvas, so everything scales by 4/3.
 *
 * ── WHAT IS DELIBERATELY SIMPLE ─────────────────────────────────────────────
 *
 * Fonts come from Google Fonts (Playfair Display and Roboto are both there;
 * the route waits for document.fonts.ready before printing). Rotated chart
 * segments use the affine as a CSS matrix. Ellipses are border-radius. This is
 * a print of a picture, not an editable document — deck.json stays the
 * editable form, exactly as the source kit's own contract says.
 *
 * ── AND WHAT IS NOT NEGOTIABLE ──────────────────────────────────────────────
 *
 * Every string is escaped. Slide text is user- and model-authored, and this
 * HTML runs inside a headless Chromium with network access on our
 * infrastructure: an unescaped <script> in a slide title would execute there.
 * The check drives exactly that fixture through and asserts it arrives inert.
 */

import type { PreviewDeck, PreviewSlide, PreviewElement } from "./preview-model";
import { runsOf } from "./preview-style";

/** 720pt → 960px. */
const S = 4 / 3;
export const PDF_PAGE_W = 960;
export const PDF_PAGE_H = 540;

export function escapeHtml(s: string): string {
  return String(s)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

/** Only http(s) and data images may reach the print browser. A slide spec is
 *  model-authored; a file:// or chrome:// src would be a read primitive inside
 *  our own infrastructure. */
export function safeSrc(src: string | undefined): string | null {
  const s = String(src || "").trim();
  if (/^https?:\/\//i.test(s) || /^data:image\//i.test(s)) return s;
  return null;
}

function fontStack(font?: string): string {
  if (font === "Playfair Display") return "'Playfair Display', Georgia, serif";
  if (font === "Poppins") return "'Poppins', 'Helvetica Neue', Arial, sans-serif";
  return "'Roboto', 'Helvetica Neue', Arial, sans-serif";
}

/** One line of text as spans, with link/accent ranges styled the way both the
 *  deck and the chat preview style them. */
function lineHtml(
  line: string,
  offset: number,
  el: PreviewElement
): string {
  const runs = runsOf(line, offset, el.links, el.accents);
  return runs
    .map((r) => {
      const styles: string[] = [];
      if (r.url) styles.push("text-decoration:underline");
      if (r.italic) styles.push("font-style:italic");
      if ((r as any).bold) styles.push("font-weight:700");
      if (r.color) styles.push(`color:${escapeHtml(r.color)}`);
      const inner = escapeHtml(r.text);
      return styles.length ? `<span style="${styles.join(";")}">${inner}</span>` : inner;
    })
    .join("");
}

function elementHtml(el: PreviewElement): string {
  const pos = el.transform
    ? `left:0;top:0;transform:matrix(${el.transform.scaleX},${el.transform.shearY},${el.transform.shearX},${el.transform.scaleY},${el.transform.translateX * S},${el.transform.translateY * S});transform-origin:0 0;width:${el.w * S}px;height:${el.h * S}px;`
    : `left:${el.x * S}px;top:${el.y * S}px;width:${el.w * S}px;height:${el.h * S}px;`;
  const opacity = typeof el.opacity === "number" ? `opacity:${el.opacity};` : "";

  if (el.kind === "image") {
    const src = safeSrc(el.src);
    if (!src) return "";
    return `<img src="${escapeHtml(src)}" style="position:absolute;${pos}${opacity}object-fit:cover;" />`;
  }
  if (el.kind === "rect" || el.kind === "ellipse") {
    const radius = el.kind === "ellipse" ? "border-radius:50%;" : el.rounded ? "border-radius:12px;" : "";
    const fill = el.fill ? `background:${escapeHtml(el.fill)};` : "";
    // The two arrow shapes and the dashed emphasis band, mirrored from the
    // chat preview — the PDF prints the same picture or it stops being a
    // print of the preview.
    const arrow = (el as any).arrow
      ? "clip-path:polygon(0% 30%, 60% 30%, 60% 0%, 100% 50%, 60% 100%, 60% 70%, 0% 70%);"
      : (el as any).arrowDown
      ? "clip-path:polygon(30% 0%, 70% 0%, 70% 55%, 100% 55%, 50% 100%, 0% 55%, 30% 55%);"
      : "";
    const dashed = (el as any).dashed ? "border:1.5px dashed #3950FF;box-sizing:border-box;" : "";
    return `<div style="position:absolute;${pos}${opacity}${fill}${radius}${arrow}${dashed}"></div>`;
  }

  // Text. Lines are rendered separately so the range indices — measured
  // against the whole box's text with newlines — land on the right words.
  const text = el.caps ? (el.text || "").toUpperCase() : el.text || "";
  const lines = text.split("\n");
  let offset = 0;
  const parts: string[] = [];
  for (const line of lines) {
    const bullet = el.bullets && line.trim() ? `<span style="margin-right:5px">•</span>` : "";
    parts.push(`<div>${bullet}${lineHtml(line, offset, el)}</div>`);
    offset += line.length + 1;
  }
  const align = el.align === "center" ? "center" : el.align === "end" ? "right" : "left";
  const vAlign = el.vCenter ? "justify-content:center;" : el.vBottom ? "justify-content:flex-end;" : "";
  const weight = el.weight || 400;
  const size = (el.size || 10) * S;
  const lineHeight = el.lineSpacing ? `line-height:${el.lineSpacing / 100};` : "line-height:1.15;";
  const spaceBelow = el.spaceBelow ? `row-gap:${el.spaceBelow * S}px;` : "";
  return (
    `<div style="position:absolute;${pos}${opacity}display:flex;flex-direction:column;${vAlign}${spaceBelow}` +
    `font-family:${fontStack(el.font)};font-weight:${weight};font-size:${size}px;${lineHeight}` +
    `color:${escapeHtml(el.color || "#023250")};text-align:${align};overflow:hidden;">${parts.join("")}</div>`
  );
}

function slideHtml(slide: PreviewSlide): string {
  const bg = slide.background ? `background:${escapeHtml(slide.background)};` : "background:#F8F8F8;";
  return (
    `<section class="slide" style="position:relative;width:${PDF_PAGE_W}px;height:${PDF_PAGE_H}px;overflow:hidden;${bg}">` +
    slide.elements.map((el) => elementHtml(el as PreviewElement)).join("") +
    `</section>`
  );
}

export function deckToHtml(deck: PreviewDeck, title: string): string {
  const slides = (deck.slides || []).map(slideHtml).join("\n");
  return `<!DOCTYPE html>
<html>
<head>
<meta charset="utf-8" />
<title>${escapeHtml(title)}</title>
<link rel="preconnect" href="https://fonts.googleapis.com" />
<link href="https://fonts.googleapis.com/css2?family=Playfair+Display:ital@0;1&family=Roboto:ital,wght@0,300;0,400;0,500;0,600;0,700;1,300;1,400&family=Poppins:wght@400;600&display=block" rel="stylesheet" />
<style>
@page { size: 10in 5.625in; margin: 0; }
* { margin: 0; padding: 0; box-sizing: border-box; }
html, body { background: #fff; }
.slide { page-break-after: always; break-after: page; }
.slide:last-child { page-break-after: auto; break-after: auto; }
</style>
</head>
<body>
${slides}
</body>
</html>`;
}
