/**
 * A workbook, as text a model can read.
 *
 * ── THE BUG THIS EXISTS FOR ─────────────────────────────────────────────────
 *
 * `/api/media/upload` accepts seventeen content types. The chat's extractor
 * handled four of them: PDF, Word, PowerPoint and `text/*`. A spreadsheet
 * therefore uploaded cleanly, attached to the message, and extracted to
 * `undefined` — and the model was handed "no text could be extracted from it,
 * and this file type cannot be read directly", which is true and useless. A
 * 2027 forecast went into a conversation and the conversation stopped there.
 *
 * Nothing was broken in a way anything could notice. The upload said yes, the
 * extractor said nothing, and the only place the two lists were ever compared
 * was in a user's head, after the fact. So the fix ships with
 * `verify-chat-attachments.ts`, which runs both lists and fails when they
 * disagree.
 *
 * ── WHY THE SHAPE OF THE OUTPUT MATTERS ─────────────────────────────────────
 *
 * The thing people attach a spreadsheet for is the NUMBERS, and the number a
 * model quotes back is the one a client sees. So:
 *
 * FORMATTED, NOT RAW. `raw: false` yields what the cell displays, so a currency
 * cell arrives as "£1,234" and a percentage as "70%" rather than as 1234 and
 * 0.7. A model reading 0.7 beside a column headed "Renewal %" will write 0.7%
 * about as often as it writes 70%.
 *
 * EVERY SHEET IS NAMED, INCLUDING ONES THAT DID NOT FIT. A forecast keeps its
 * summary on one tab and its workings on another, and a budget spent
 * first-come would hand over three thousand rows of workings and never mention
 * that a "Scenarios" tab exists. The header lists every sheet with its real
 * size before any of them are serialised.
 *
 * AND IT SAYS WHEN IT CUT. Truncating in silence is how a model concluded a
 * brief "doesn't cover budget" when budget was on page 6. The marker the Drive
 * reader uses is appended here too, from the one place it is defined.
 */

import * as XLSX from "xlsx";
import { TRUNCATION_MARKER } from "@/lib/ai/truncation";

/** The whole budget for one attached workbook, in characters. Generous,
 *  because the alternative to sending the numbers is a conversation that
 *  cannot start; bounded, because a workbook can be arbitrarily large. */
export const SHEET_TEXT_MAX_CHARS = 60_000;

/** Guards a sheet with a million empty-but-formatted rows, which is ordinary
 *  in an exported model and would otherwise spend the budget on separators. */
export const SHEET_MAX_ROWS = 2_000;

/** And a sheet whose used range runs out to column ZZ. */
export const SHEET_MAX_COLS = 60;

export interface SheetSummary {
  name: string;
  /** Rows in the sheet's used range, and the widest row in it. */
  rows: number;
  cols: number;
  /** Rows with anything in them. This, not `rows`, is what "shown" is measured
   *  against: blank rows are dropped on the way out, so `emitted < rows` is
   *  ordinary for a sparse sheet and is not evidence of anything. */
  nonEmpty: number;
  /** How many rows were written out. Less than `nonEmpty` means cut. */
  emitted: number;
}

export interface WorkbookText {
  text: string;
  sheets: SheetSummary[];
  /** True when anything was left out, for a caller that would rather branch
   *  than read the marker back out of the string. */
  truncated: boolean;
}

export interface SheetTextOptions {
  maxChars?: number;
  maxRows?: number;
  maxCols?: number;
}

/**
 * One sheet's used range, as text.
 *
 * Blank rows are dropped and trailing blank cells trimmed: a sheet whose used
 * range reaches column BZ otherwise spends most of its budget on pipes. Row
 * order is never changed — someone matching a figure back to the file needs the
 * row it was on.
 */
export function serializeSheet(
  ws: XLSX.WorkSheet,
  opts?: SheetTextOptions
): { text: string; rows: number; cols: number; nonEmpty: number; emitted: number } {
  const maxRows = opts?.maxRows ?? SHEET_MAX_ROWS;
  const maxCols = opts?.maxCols ?? SHEET_MAX_COLS;
  const maxChars = opts?.maxChars ?? SHEET_TEXT_MAX_CHARS;

  // Dates first: the displayed value is right for money and percentages and
  // wrong for a date, because "3/4/27" is the fourth of March to the author and
  // the third of April to a model, and nothing downstream can tell which. This
  // workspace has a standing rule against letting a model interpret a date.
  isoDates(ws);

  // `raw: false` gives the DISPLAYED value. See the docblock: a percentage that
  // arrives as 0.7 gets quoted back as 0.7%.
  const grid: any[][] = XLSX.utils.sheet_to_json(ws, { header: 1, raw: false, defval: "" });

  const lines: string[] = [];
  let used = 0;
  let emitted = 0;
  let nonEmpty = 0;
  let widest = 0;
  let stopped = false;

  for (let i = 0; i < grid.length; i++) {
    const row = grid[i] || [];
    widest = Math.max(widest, row.length);
    const cells = row.slice(0, maxCols).map((c) => String(c == null ? "" : c).replace(/\s+/g, " ").trim());
    let end = cells.length;
    while (end > 0 && cells[end - 1] === "") end--;
    if (end === 0) continue;
    // Counted BEFORE the budget test, so `nonEmpty` is the sheet's real size
    // and not "the size of the part that happened to fit".
    nonEmpty++;
    if (stopped) continue;
    const line = cells.slice(0, end).join(" | ");
    if (emitted >= maxRows || used + line.length + 1 > maxChars) { stopped = true; continue; }
    lines.push(line);
    used += line.length + 1;
    emitted++;
  }

  return { text: lines.join("\n"), rows: grid.length, cols: widest, nonEmpty, emitted };
}

/**
 * Rewrite every date cell's DISPLAYED text to ISO.
 *
 * A workbook written in the UK shows 04/03/27 for the fourth of March and one
 * written in the US shows it for the third of April, and by the time the text
 * reaches a model the format that decided which is gone. So the display value,
 * which is the right answer for every other cell type, is replaced here with
 * the one form that cannot be read two ways. The time is kept only when there
 * is one, since a bare date with " 00:00" on it invites a different mistake.
 *
 * Mutates the worksheet. It comes from a parse of one uploaded file and is not
 * used for anything else afterwards.
 */
export function isoDates(ws: XLSX.WorkSheet): number {
  let changed = 0;
  for (const addr of Object.keys(ws)) {
    if (addr[0] === "!") continue;
    const cell: any = (ws as any)[addr];
    if (!cell || cell.t !== "d" || !(cell.v instanceof Date)) continue;
    const d: Date = cell.v;
    // LOCAL getters, not toISOString(). An Excel date is a wall-clock value
    // with no timezone in it at all, and SheetJS builds the Date in local time
    // to represent that. Reading it back through UTC shifts it by the offset:
    // a contract ending on 15 April, written at local midnight, came out of the
    // first version of this as "2027-04-15 02:00" in Zurich, and in a negative
    // offset it would have come out as the day before.
    const pad = (n: number) => String(n).padStart(2, "0");
    const day = `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
    const midnight = d.getHours() === 0 && d.getMinutes() === 0 && d.getSeconds() === 0;
    cell.w = midnight ? day : `${day} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
    changed++;
  }
  return changed;
}

/**
 * A whole workbook, as text.
 *
 * The budget is shared between sheets and rolls forward: each sheet gets at
 * least an even share of what is left, and whatever the small ones do not use
 * is available to the ones after them. First-come would let one sheet of
 * workings take the lot, and the summary tab the file was attached for would
 * never appear.
 */
export function workbookToText(
  buffer: Buffer | ArrayBuffer | Uint8Array,
  opts?: SheetTextOptions
): WorkbookText {
  return sheetsToText(XLSX.read(buffer as any, { type: "buffer", cellDates: true }), opts);
}

/**
 * A delimited text file, through the same serialiser.
 *
 * CSV and TSV are `text/*` and would otherwise have gone down the plain-text
 * branch, which hands a model a wall of commas. The columns are the content;
 * the same row treatment as a workbook makes them legible, and costs one parse.
 */
export function delimitedToText(
  content: string,
  opts?: SheetTextOptions & { delimiter?: string }
): WorkbookText {
  const wb = XLSX.read(content, { type: "string", FS: opts?.delimiter || "," });
  return sheetsToText(wb, opts);
}

/** The serialiser itself, over an already-parsed workbook, so nothing has to
 *  write a workbook back out to a buffer just to read it again. */
export function sheetsToText(wb: XLSX.WorkBook, opts?: SheetTextOptions): WorkbookText {
  const budget = opts?.maxChars ?? SHEET_TEXT_MAX_CHARS;
  const names = wb.SheetNames || [];
  if (!names.length) return { text: "", sheets: [], truncated: false };

  const summaries: SheetSummary[] = [];
  const blocks: string[] = [];
  let spent = 0;

  for (let i = 0; i < names.length; i++) {
    const ws = wb.Sheets[names[i]];
    if (!ws) continue;
    const remaining = names.length - i;
    const allowance = Math.max(500, Math.floor((budget - spent) / remaining));
    const s = serializeSheet(ws, { maxRows: opts?.maxRows, maxCols: opts?.maxCols, maxChars: allowance });
    summaries.push({ name: names[i], rows: s.rows, cols: s.cols, nonEmpty: s.nonEmpty, emitted: s.emitted });

    if (!s.text) {
      blocks.push(`### Sheet: ${names[i]} — empty`);
      spent += names[i].length + 24;
      continue;
    }
    const head = `### Sheet: ${names[i]} (${s.nonEmpty} row${s.nonEmpty === 1 ? "" : "s"}${s.cols ? ` × ${s.cols} column${s.cols === 1 ? "" : "s"}` : ""})`;
    const cut = s.emitted < s.nonEmpty
      ? `\n… ${s.emitted} of this sheet's ${s.nonEmpty} rows are shown. The rest were not included.`
      : "";
    blocks.push(`${head}\n${s.text}${cut}`);
    spent += head.length + s.text.length + cut.length + 2;
  }

  // The contents page. A model that can see a sheet exists can ask for it; one
  // that cannot will answer as though the file did not contain it.
  const index = summaries
    .map((s) => `${s.name} (${s.nonEmpty} row${s.nonEmpty === 1 ? "" : "s"}${s.emitted < s.nonEmpty ? `, ${s.emitted} shown` : ""})`)
    .join("; ");
  const truncated = summaries.some((s) => s.emitted < s.nonEmpty);

  let text = `Workbook with ${summaries.length} sheet${summaries.length === 1 ? "" : "s"}: ${index}\n\n${blocks.join("\n\n")}`;

  if (truncated) {
    text +=
      `\n\n${TRUNCATION_MARKER} — this workbook did not fit. The sheet list above gives every sheet's real ` +
      `row count and how many of them are shown. You have NOT seen the rest. Do not total, count, or ` +
      `conclude that something is absent, from rows you were not given; say which part you saw and offer ` +
      `to look at a named sheet or range.]`;
  }

  return { text, sheets: summaries, truncated };
}
