/**
 * What may be uploaded, and what can actually be read once it has been.
 *
 * These two lists were never in the same place. `/api/media/upload` accepted
 * seventeen content types; the chat's extractor handled four of them. A
 * spreadsheet uploaded cleanly, attached to the message, extracted to
 * `undefined`, and the model was told the file could not be read. Nothing
 * logged, nothing failed, and the only comparison of the two lists happened in
 * a user's head after a conversation had already stalled on it.
 *
 * So they live together now, and `verify-chat-attachments.ts` RUNS them: every
 * accepted type must either be extractable or be named here as one we know we
 * cannot read. Adding a type to the allowlist without deciding which it is
 * fails the check rather than shipping another silent hole.
 */

/** Uploadable. The upload route imports this; nothing else decides it. */
export const ALLOWED_UPLOAD_TYPES = [
  "image/jpeg",
  "image/png",
  "image/gif",
  "image/webp",
  "video/mp4",
  "video/quicktime",
  "video/webm",
  "application/pdf",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  "application/vnd.ms-excel",
  "application/vnd.openxmlformats-officedocument.presentationml.presentation",
  "application/vnd.ms-powerpoint",
  "application/rtf",
  "application/json",
  "application/xml",
  "text/plain",
  "text/csv",
  "text/markdown",
  "text/xml",
  "text/tab-separated-values",
  "text/html",
];

/**
 * Types that reach the model without being turned into text.
 *
 * Images and video go to the vision path, and a PDF is sent to Anthropic as a
 * document block rather than extracted here. They are not holes; they are
 * handled somewhere else, and the check needs to know the difference.
 */
export const HANDLED_ELSEWHERE = [
  "image/jpeg",
  "image/png",
  "image/gif",
  "image/webp",
  "video/mp4",
  "video/quicktime",
  "video/webm",
];

/**
 * Accepted, and genuinely not readable.
 *
 * `application/vnd.ms-powerpoint` is the pre-2007 binary .ppt container. There
 * is no maintained pure-JS reader for it, and guessing at its record structure
 * would produce plausible-looking fragments of a deck, which is worse than
 * saying so. It stays uploadable because attaching one and being told plainly
 * that it cannot be read is better than a rejected upload with no explanation.
 *
 * Anything on this list must be genuinely undecodable, not merely unimplemented
 * — it is the list that switches the check off, so it is the list that has to
 * be argued for.
 */
export const KNOWN_UNREADABLE = ["application/vnd.ms-powerpoint"];

/** Every extension the spreadsheet reader claims, lower case, with the dot. */
export const SPREADSHEET_EXTENSIONS = [".xlsx", ".xlsm", ".xlsb", ".xls", ".csv", ".tsv"];

const SPREADSHEET_TYPES = [
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  "application/vnd.ms-excel",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.template",
  "application/vnd.ms-excel.sheet.macroenabled.12",
];

/**
 * Is this attachment a spreadsheet?
 *
 * BOTH the type and the name, because neither is reliable on its own. Browsers
 * hand `.csv` over as `application/vnd.ms-excel` about as often as `text/csv`,
 * and a file dragged out of some export tools arrives as
 * `application/octet-stream` with only its extension to go on. Type first so a
 * correctly-labelled file never depends on its name.
 */
export function isSpreadsheet(att: { type?: string; name?: string }): boolean {
  const type = String(att.type || "").toLowerCase();
  if (SPREADSHEET_TYPES.indexOf(type) >= 0) return true;
  const name = String(att.name || "").toLowerCase();
  for (const ext of SPREADSHEET_EXTENSIONS) {
    if (name.endsWith(ext)) return true;
  }
  return false;
}

/**
 * Is this something we read as plain text?
 *
 * `application/json` and `application/xml` are text with a non-text label, and
 * both were silently dropped for exactly that reason.
 */
export function isPlainTextish(att: { type?: string; name?: string }): boolean {
  const type = String(att.type || "").toLowerCase();
  if (type.startsWith("text/")) return true;
  return type === "application/json" || type === "application/xml";
}
