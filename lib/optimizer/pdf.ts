/**
 * Reading a PDF, in one place.
 *
 * Two callers need this — a PDF fetched from a URL and a PDF uploaded as a
 * background source — and the call has a workaround in it that must not be
 * copy-pasted: pdf-parse's package ROOT runs a demo against a bundled test file
 * at import time, which throws in a serverless filesystem and has nothing to do
 * with the caller's document. The lib entry is the one that works. A comment
 * explaining that, duplicated, is a comment that goes stale in one of its two
 * homes.
 *
 * WHY A PDF IS READ HERE AT ALL, given that importing one as a DOCUMENT is
 * refused a few files away: the refusal is about SCORING. A PDF's words arrive
 * with no headings, lists or figures, so scoring one describes the file format
 * rather than the writing. Background material is never scored — it is material
 * the writing draws on, and words are the whole of what it needs. Same bytes,
 * different question, opposite answer.
 */

/** Text and metadata from a PDF, or a stated reason there is none. */
export type PdfRead =
  | { ok: true; text: string; title: string; pages: number }
  | { ok: false; reason: "scanned" | "unreadable"; error: string };

/** Tidy the raw extraction: pdf-parse leaves ragged line endings from column
 *  breaks, and a source is read as prose. */
export function tidyPdfText(raw: string): string {
  return String(raw || "")
    .replace(/\r\n?/g, "\n")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

/**
 * A PDF's own title, else something honest from the filename.
 *
 * `info.Title` is frequently the authoring tool's leftover ("Microsoft Word -
 * report_final_v3.docx") rather than a title, so a value that still looks like
 * a filename is rejected in favour of deriving one — otherwise the source list
 * fills with rows named after somebody's file system.
 */
export function pdfTitle(info: unknown, fallbackName: string): string {
  const meta = String((info as { Title?: unknown })?.Title || "").trim();
  const looksLikeFilename = /\.(docx?|pdf|pages|indd|qxp)\s*$/i.test(meta) || /^Microsoft Word\s*-/i.test(meta);
  if (meta && !looksLikeFilename) return meta.slice(0, 200);
  const cleaned = String(fallbackName || "")
    .replace(/\.pdf$/i, "")
    .replace(/[-_]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  return (cleaned || "PDF document").slice(0, 200);
}

/**
 * Read a PDF buffer. Never throws — a caller deciding what to tell the writer
 * needs the REASON, and an exception flattens "this is a scan" and "this file
 * is corrupt" into the same unhelpful sentence.
 */
export async function readPdf(buffer: Buffer, fallbackName: string): Promise<PdfRead> {
  let parsed: { text?: unknown; numpages?: unknown; info?: unknown };
  try {
    // The lib entry, not the package root — see the header.
    // @ts-expect-error - pdf-parse ships types for its package root only, and
    // the root is the entry that must be avoided.
    const mod = await import("pdf-parse/lib/pdf-parse.js");
    const pdfParse = (mod.default || mod) as (b: Buffer) => Promise<typeof parsed>;
    parsed = await pdfParse(buffer);
  } catch {
    return { ok: false, reason: "unreadable", error: "That PDF could not be read. It may be encrypted or damaged." };
  }

  const text = tidyPdfText(String(parsed?.text || ""));
  if (!text) {
    // A scanned PDF is images of words. Said plainly, because "no text found"
    // reads as a bug when it is an accurate description of the file.
    return {
      ok: false,
      reason: "scanned",
      error: "That PDF has no selectable text — it looks like a scan. Attach the source document, or a copy that has been through OCR.",
    };
  }

  const pages = Number(parsed?.numpages) || 0;
  return { ok: true, text, title: pdfTitle(parsed?.info, fallbackName), pages };
}
