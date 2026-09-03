/**
 * Facts about how Slides itself draws text, shared by the layout engine and the
 * in-chat preview.
 *
 * They live in their own module because the preview component cannot import
 * lib/slides/generate.ts — that module reaches the Google token store and the
 * Blob client, which is why the component imports its types only. Two copies of
 * these numbers would drift, and the drift would show up as the preview and the
 * deck disagreeing about where a line wraps.
 *
 * None of them is settable through the Slides API; they are Google's defaults
 * for a text box, mirrored here so both sides measure the same box.
 */

/** Slides insets text inside its box: 0.1in left and right, 0.05in top and
 *  bottom. Drawing text flush gave the preview 14.4pt of width per box that the
 *  deck does not have — enough for a title to wrap here and not there. */
export const SLIDES_TEXT_INSET = { x: 7.2, y: 3.6 } as const;

/** The hanging indent Slides' level-0 disc preset applies to a bulleted list.
 *  The glyph sits at the inset and wrapped lines align under the text. */
export const BULLET_INDENT = 18;

/** Split a line into plain and linked segments.
 *
 *  Ranges are recorded against the WHOLE box's text, and the renderer draws it
 *  a line at a time, so the caller passes the offset this line starts at. The
 *  pieces always reassemble to the original line — a renderer that loses a
 *  character is worse than one that loses an underline. */
export function runsOf(
  line: string,
  offset: number,
  links?: { start: number; end: number; url: string }[],
  accents?: { start: number; end: number; italic?: boolean; bold?: boolean; color?: string }[]
): { text: string; url?: string; italic?: boolean; bold?: boolean; color?: string }[] {
  const spans: { start: number; end: number; url?: string; italic?: boolean; bold?: boolean; color?: string }[] = [
    ...(links || []),
    ...(accents || []),
  ];
  if (!spans.length) return [{ text: line }];
  const end = offset + line.length;
  const here = spans
    .filter((l) => l.end > offset && l.start < end)
    .map((l) => ({ start: Math.max(0, l.start - offset), stop: Math.min(line.length, l.end - offset), url: (l as any).url, italic: (l as any).italic, bold: (l as any).bold, color: (l as any).color }))
    .sort((a, b) => a.start - b.start);
  if (!here.length) return [{ text: line }];

  const out: { text: string; url?: string; italic?: boolean; bold?: boolean; color?: string }[] = [];
  let at = 0;
  for (let i = 0; i < here.length; i++) {
    const run = here[i];
    if (run.start > at) out.push({ text: line.slice(at, run.start) });
    if (run.stop > Math.max(at, run.start)) {
      out.push({ text: line.slice(Math.max(at, run.start), run.stop), url: run.url, italic: run.italic, bold: (run as any).bold, color: run.color });
    }
    at = Math.max(at, run.stop);
  }
  if (at < line.length) out.push({ text: line.slice(at) });
  return out;
}
