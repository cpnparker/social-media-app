/**
 * Uploaded documents — a .docx with its structure and its figures intact.
 *
 * WHY convertToHtml AND NOT extractRawText. Every other mammoth caller in this
 * repo (lib/gdrive/docs.ts, lib/rfp/extract.ts, lib/ai/client-context-extract.ts,
 * the chat attachment path) calls extractRawText, because they feed a MODEL and
 * a model only needs the words. The optimiser is the opposite case: it SCORES
 * structure. Headings, lists, tables and figures are the subject matter, not
 * packaging, and an article flattened to raw text scores badly for reasons that
 * belong to the importer rather than the writer — one chunk, no headings,
 * nothing for the chunk-level criteria to hold. So this path is deliberately
 * the structural one, and it is the only mammoth caller here that keeps images.
 *
 * IMAGE STORAGE. Figures go to Vercel Blob as PRIVATE objects and are
 * referenced through /api/media/file, not through a signed URL. Both parts are
 * deliberate:
 *
 *  - Private, because an uploaded client document is not public material. The
 *    proxy requires a session, and — because the path carries a `w<uuid>`
 *    segment — membership of THAT workspace, which is a check that route
 *    already implements and enforces.
 *  - The proxy rather than signedMediaUrl, because a signed URL EXPIRES. The
 *    URL is written into the draft body and stored; a draft reopened after the
 *    TTL would show a page of broken figures, with the rot arriving silently
 *    some time after the import looked perfect.
 *
 * PDFs are refused rather than imported as text — see importFile.
 */

import { put } from "@vercel/blob";
import { toEditorHtml } from "./import-html";

export interface FileImportResult {
  ok: boolean;
  html?: string;
  title?: string;
  imageCount?: number;
  /** Things the writer should know about what did NOT survive the import. */
  warnings?: string[];
  error?: string;
}

/** Per-image and per-document ceilings. A document is prose with figures; one
 *  that breaches these is a picture library and would take the request down
 *  with it. */
const MAX_IMAGE_BYTES = 12 * 1024 * 1024;
const MAX_IMAGES = 80;

const EXT_OF: { [mime: string]: string } = {
  "image/jpeg": "jpg", "image/png": "png", "image/gif": "gif",
  "image/webp": "webp", "image/bmp": "bmp", "image/tiff": "tiff",
};

/**
 * Convert a .docx buffer to editor HTML, uploading its figures on the way.
 *
 * `warnings` is part of the contract, not decoration: an image that fails to
 * upload is DROPPED, and a silently shorter document is exactly the kind of
 * quiet loss that makes an import untrustworthy.
 */
/**
 * How a figure gets stored. Injectable so the check can drive the conversion
 * without a blob store or a network — and, more usefully, so it can force the
 * FAILURE path, which is the one that has to stay honest: an image that cannot
 * be stored must be dropped AND reported, never dropped quietly.
 */
export type ImageUploader = (
  buf: Buffer,
  contentType: string,
  index: number
) => Promise<string | null>;

function blobUploader(workspaceId: string): ImageUploader {
  return async (buf, contentType, index) => {
    const ext = EXT_OF[String(contentType).toLowerCase()] || "bin";
    // The w<uuid> segment is load-bearing: /api/media/file reads it and
    // requires membership of that workspace. Without it the blob falls back to
    // "any signed-in user" and a client's document would be readable across
    // workspaces.
    const blob = await put(`optimizer/w${workspaceId}/${Date.now()}-${index}.${ext}`, buf, {
      access: "private",
      contentType: contentType || "application/octet-stream",
      addRandomSuffix: true,
    });
    return `/api/media/file?path=${encodeURIComponent(blob.pathname)}`;
  };
}

export async function importDocx(
  buffer: Buffer,
  opts: { workspaceId: string; maxChars: number; uploadImage?: ImageUploader }
): Promise<FileImportResult> {
  const upload: ImageUploader = opts.uploadImage || blobUploader(opts.workspaceId);
  const warnings: string[] = [];
  let imageCount = 0;
  let uploadFailures = 0;
  let oversize = 0;

  let mammoth: any;
  try {
    mammoth = await import("mammoth");
  } catch {
    return { ok: false, error: "The document converter is unavailable on this deployment." };
  }

  let result: any;
  try {
    result = await mammoth.convertToHtml(
      { buffer },
      {
        // Word's "Title" style is not a heading and maps to a bare <p> by
        // default, so the article's own title arrived as body text and the
        // piece looked headless. The class is how it is found again below;
        // it does not survive sanitising, and is not meant to.
        styleMap: [
          "p[style-name='Title'] => h1.docx-title:fresh",
          "p[style-name='Subtitle'] => p.docx-subtitle:fresh",
        ],
        convertImage: mammoth.images.imgElement(async (image: any) => {
          if (imageCount >= MAX_IMAGES) { oversize++; return { src: "" }; }
          try {
            const buf: Buffer = await image.read();
            if (buf.length > MAX_IMAGE_BYTES) { oversize++; return { src: "" }; }
            const src = await upload(buf, String(image.contentType || ""), imageCount);
            if (!src) { uploadFailures++; return { src: "" }; }
            imageCount++;
            return { src, alt: image.altText || "" };
          } catch {
            uploadFailures++;
            // An empty src is dropped by the sanitiser. Reported, never silent.
            return { src: "" };
          }
        }),
      }
    );
  } catch (e: any) {
    return { ok: false, error: `That document could not be read: ${String(e?.message || e).slice(0, 160)}` };
  }

  let raw: string = result.value || "";
  if (!raw.replace(/<[^>]+>/g, "").trim()) {
    return { ok: false, error: "That document appears to be empty." };
  }

  // Lift the Title-styled paragraph out of the body. The studio has its own
  // title field, and leaving it in the body would have the rubric score the
  // headline twice — once as the title, once as an H1 with no section under it.
  let title = "";
  const titleMatch = raw.match(/<h1 class="docx-title">([\s\S]*?)<\/h1>/i);
  if (titleMatch) {
    title = titleMatch[1].replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
    raw = raw.replace(titleMatch[0], "");
  }

  const html = toEditorHtml(raw, true);

  if (!title) {
    const firstBlock = html.match(/<(h[1-6]|p)\b[^>]*>([\s\S]*?)<\/\1>/i);
    const t = firstBlock ? firstBlock[2].replace(/<[^>]+>/g, " ") : "";
    title = t.replace(/&amp;/g, "&").replace(/\s+/g, " ").trim();
  }

  if (html.length > opts.maxChars) {
    return {
      ok: false,
      error: `That document is ${Math.round(html.length / 1000)}k characters of markup, past the ${Math.round(opts.maxChars / 1000)}k import ceiling. Split it into the individual articles you want to optimise — a score over several pieces at once describes none of them.`,
    };
  }

  if (uploadFailures > 0) {
    warnings.push(`${uploadFailures} image${uploadFailures === 1 ? "" : "s"} could not be stored and ${uploadFailures === 1 ? "was" : "were"} left out of the draft.`);
  }
  if (oversize > 0) {
    warnings.push(`${oversize} image${oversize === 1 ? " was" : "s were"} too large to import and ${oversize === 1 ? "was" : "were"} left out.`);
  }
  // Word style names that mammoth could not map are worth surfacing only when
  // they are structural; a stray character style is noise.
  const unmapped = (result.messages || [])
    .filter((m: any) => m.type === "warning" && /Unrecognised paragraph style/.test(m.message || ""))
    .map((m: any) => (String(m.message).match(/'([^']+)'/) || [])[1])
    .filter(Boolean);
  const distinct = unmapped.filter((v: string, i: number) => unmapped.indexOf(v) === i);
  if (distinct.length) {
    warnings.push(`Word styles with no HTML equivalent came through as body text: ${distinct.slice(0, 5).join(", ")}.`);
  }

  return { ok: true, html, title: title.slice(0, 200), imageCount, warnings };
}

/**
 * Route an uploaded file by type.
 *
 * PDF IS REFUSED, deliberately, and this is a judgement call worth stating.
 * pdf-parse is already a dependency and would return the words — but a PDF's
 * words arrive with no headings, no lists and no figures, so the optimiser
 * would hand back a low score that describes the FILE FORMAT rather than the
 * writing. That is the same failure the truncated-Drive-document path refuses
 * for the same reason: a number nobody should act on is worse than no number.
 */
export async function importFile(
  file: { name: string; type: string; buffer: Buffer },
  opts: { workspaceId: string; maxChars: number; uploadImage?: ImageUploader }
): Promise<FileImportResult> {
  const name = (file.name || "").toLowerCase();
  const ext = (name.match(/\.([a-z0-9]+)$/) || [])[1] || "";

  if (ext === "docx") return importDocx(file.buffer, opts);

  if (ext === "doc") {
    return { ok: false, error: "That is the older binary .doc format, which cannot be read for its structure. Open it in Word and save as .docx." };
  }
  if (ext === "pdf") {
    return { ok: false, error: "A PDF carries no headings, lists or figures that survive extraction — importing one would score the file format rather than the writing. Export the source document as .docx and upload that." };
  }
  if (ext === "html" || ext === "htm") {
    const html = toEditorHtml(file.buffer.toString("utf8"), true);
    if (!html.replace(/<[^>]+>/g, "").trim()) return { ok: false, error: "That file appears to be empty." };
    if (html.length > opts.maxChars) return { ok: false, error: "That file is past the import ceiling — split it into individual articles." };
    const firstBlock = html.match(/<(h[1-6]|p)\b[^>]*>([\s\S]*?)<\/\1>/i);
    const t = firstBlock ? firstBlock[2].replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim() : "";
    return { ok: true, html, title: t.slice(0, 200), imageCount: 0, warnings: [] };
  }
  if (ext === "md" || ext === "markdown" || ext === "txt" || ext === "rtf") {
    const text = file.buffer.toString("utf8");
    if (!text.trim()) return { ok: false, error: "That file appears to be empty." };
    const html = toEditorHtml(text, false);
    if (html.length > opts.maxChars) return { ok: false, error: "That file is past the import ceiling — split it into individual articles." };
    const firstBlock = html.match(/<(h[1-6]|p)\b[^>]*>([\s\S]*?)<\/\1>/i);
    const t = firstBlock ? firstBlock[2].replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim() : "";
    return { ok: true, html, title: t.slice(0, 200), imageCount: 0, warnings: [] };
  }

  return { ok: false, error: `${ext ? `.${ext} files` : "That file type"} cannot be imported. Upload a .docx, .html, .md or .txt.` };
}


/**
 * Read an uploaded file as BACKGROUND MATERIAL — words, not structure.
 *
 * The sibling above, importFile, refuses a PDF and is right to: it feeds the
 * optimiser, the optimiser scores headings and lists, and a PDF has none that
 * survive extraction, so the number would describe the file format rather than
 * the writing.
 *
 * A source is a different question with the opposite answer. It is never
 * edited, never scored, never listed as content — it is material the writing
 * draws on, and the route that stores it already strips every tag before it
 * lands. Refusing a PDF here was importFile's judgement applied where its
 * reasoning does not hold, and it shut out the format most background material
 * actually arrives in: reports.
 *
 * So the two paths stay separate on purpose. Widening importFile to accept a
 * PDF would have been one line and would have quietly reintroduced the scoring
 * problem the comment above exists to prevent.
 */
export async function extractSourceText(
  file: { name: string; type: string; buffer: Buffer }
): Promise<{ ok: true; text: string; title: string } | { ok: false; error: string }> {
  // NO LENGTH CAP HERE, deliberately. The route already caps at
  // MAX_SOURCE_CHARS and reports `truncated` to the writer from
  // `text.length > MAX_SOURCE_CHARS`. Truncating first would make that
  // comparison false and the flag would go quiet on exactly the long reports
  // it exists for — a second cap does not add safety, it removes a signal.
  const name = (file.name || "").trim();
  const ext = (name.toLowerCase().match(/\.([a-z0-9]+)$/) || [])[1] || "";
  const named = () => name.replace(/\.[a-z0-9]+$/i, "").replace(/[-_]+/g, " ").trim().slice(0, 200);

  if (ext === "pdf") {
    const { readPdf } = await import("./pdf");
    const r = await readPdf(file.buffer, name);
    if (!r.ok) return { ok: false, error: r.error };
    return { ok: true, text: r.text, title: r.title };
  }

  if (ext === "doc") {
    return { ok: false, error: "That is the older binary .doc format, which cannot be read. Open it in Word and save as .docx." };
  }

  if (ext === "docx") {
    // extractRawText, not convertToHtml: every other caller that feeds a MODEL
    // wants words, and that is what a source is for.
    try {
      const mammoth = await import("mammoth");
      const out = await mammoth.extractRawText({ buffer: file.buffer });
      const text = String(out?.value || "").replace(/\n{3,}/g, "\n\n").trim();
      if (!text) return { ok: false, error: "That document appears to be empty." };
      return { ok: true, text, title: named() || "Document" };
    } catch {
      return { ok: false, error: "That .docx could not be read." };
    }
  }

  if (ext === "html" || ext === "htm") {
    const text = file.buffer.toString("utf8").replace(/<(script|style)[\s\S]*?<\/\1>/gi, " ")
      .replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
    if (!text) return { ok: false, error: "That file appears to be empty." };
    return { ok: true, text, title: named() || "Page" };
  }

  if (ext === "md" || ext === "markdown" || ext === "txt" || ext === "rtf" || ext === "csv") {
    const text = file.buffer.toString("utf8").trim();
    if (!text) return { ok: false, error: "That file appears to be empty." };
    return { ok: true, text, title: named() || "Notes" };
  }

  return { ok: false, error: `Attach a .pdf, .docx, .html, .md, .txt or .csv — ${ext ? "." + ext : "that file type"} cannot be read.` };
}
