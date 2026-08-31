/**
 * Guards what you can attach to a chat message against what the model actually
 * receives.
 *
 * Run: npx tsx scripts/verify-chat-attachments.ts --self-test
 *
 * ── WHAT WENT WRONG ─────────────────────────────────────────────────────────
 *
 * `/api/media/upload` accepted seventeen content types. The extractor in the
 * messages route handled four: PDF, Word, PowerPoint and `text/*`. Everything
 * else uploaded cleanly, attached to the message, extracted to `undefined`, and
 * reached the model as "no text could be extracted from it, and this file type
 * cannot be read directly". A 2027 forecast went into a conversation and the
 * conversation stopped on it.
 *
 * Nothing failed. No error, no log line, no red anything. The two lists were
 * three directories apart and were compared for the first time by a user, after
 * the fact, in a thread that had already stalled. So this check compares them,
 * every time, by RUNNING them: every uploadable type must be handled by the
 * vision path, extractable, or named in KNOWN_UNREADABLE with an argument.
 *
 * ── AND WHY THE FIXTURES ARE REAL FILES ─────────────────────────────────────
 *
 * The workbooks below are built with SheetJS in memory: real zip containers,
 * real sheets, real number formats, real formulas with cached values. A mock of
 * the reader would assert that the mock works. The one thing that actually
 * matters about this feature is that the numbers come out the way the numbers
 * went in, and only a real file can show that.
 *
 * ── MUTATION LOG ────────────────────────────────────────────────────────────
 *
 * The self-test is the mutation log: each detector is driven against input that
 * should trip it, and the script refuses to report anything if one stays quiet.
 *
 * KILLED  raw values instead of displayed ones (70% arriving as 0.7)
 * KILLED  a workbook truncated with nothing saying so
 * KILLED  the budget spent first-come, starving the last sheet
 * KILLED  a sheet dropped from the contents list
 * KILLED  an uploadable type with no reader and no entry on the unreadable list
 * KILLED  blank rows counted as truncation, firing the marker on a sparse sheet
 * KILLED  RTF control words emitted as if they were words
 * KILLED  a date cell handed over in the workbook's own display order
 * KILLED  a date formatted through UTC, which grew an "02:00" on it in Zurich
 *           and would have moved it to the previous day west of Greenwich
 *
 * SURVIVED, then killed by section 7: that same UTC-formatting mutation, run on
 *   a machine whose own timezone is UTC. Local and UTC fields are identical
 *   there, so every date assertion stayed green while the formatter was wrong
 *   everywhere else — and CI is usually UTC. The file now re-runs itself once
 *   in a child process under a different zone.
 *
 * A NOTE ON THE FIRST ATTEMPT AT THAT MUTATION. It was run in a detached
 * worktree with no node_modules, so `xlsx` did not resolve, the script died
 * before its first assertion, and the grep for failures came back empty. An
 * error read as a pass. Symlink node_modules into the worktree, and check the
 * baseline actually prints its summary line before trusting a mutation result.
 */
import * as XLSX from "xlsx";
import {
  workbookToText,
  serializeSheet,
  SHEET_TEXT_MAX_CHARS,
} from "../lib/ai/spreadsheet-text";
import { rtfToText } from "../lib/ai/rtf-text";
import { TRUNCATION_MARKER } from "../lib/ai/truncation";
import {
  ALLOWED_UPLOAD_TYPES,
  HANDLED_ELSEWHERE,
  KNOWN_UNREADABLE,
  isSpreadsheet,
  isPlainTextish,
} from "../lib/media/allowed-types";
import { readFileSync } from "fs";
import { join } from "path";
import { execFileSync } from "child_process";

const root = join(__dirname, "..");
const read = (p: string) => readFileSync(join(root, p), "utf8");

let failures = 0;
const fail = (m: string) => { failures++; console.log(`  ✗ ${m}`); };
const pass = (m: string) => console.log(`  ✓ ${m}`);
const assert = (ok: boolean, m: string) => (ok ? pass(m) : fail(m));

/** A workbook shaped like the one that started this: a summary tab with
 *  scenarios, and a much larger tab of workings after it. */
function forecastWorkbook(opts?: { workingsRows?: number }): Buffer {
  const wb = XLSX.utils.book_new();

  const scenarios = XLSX.utils.aoa_to_sheet([
    // NO PERCENTAGE IN THE LABELS. They read "70% renewals", and the assertion
    // below that a percentage arrives formatted was then passing on the LABEL
    // rather than on the number: it stayed green with the number formatting
    // stripped, which the self-test caught by staying silent. A fixture that
    // cannot trip the defect certifies nothing.
    ["Scenario", "Renewal rate", "Revenue", "Cost", "Profit"],
    ["Booked only", 0.0, 1200000, 1180000, 20000],
    ["Half of renewals", 0.5, 1450000, 1420000, 30000],
    ["Most renewals", 0.7, 1600000, 1598000, 2000],
    ["All renewals", 1.0, 1900000, 1700000, 200000],
  ]);
  // Number formats are the point: without them the reader has nothing to
  // display and falls back to the raw number.
  for (const cell of ["B2", "B3", "B4", "B5"]) (scenarios as any)[cell].z = "0%";
  for (const col of ["C", "D", "E"]) {
    for (let r = 2; r <= 5; r++) (scenarios as any)[`${col}${r}`].z = '"£"#,##0';
  }
  // A formula with a cached value, which is what Excel stores and what a
  // reader gets when it does not recalculate.
  (scenarios as any).E6 = { t: "n", v: 252000, f: "SUM(E2:E5)", z: '"£"#,##0' };
  (scenarios as any)["!ref"] = "A1:E6";
  XLSX.utils.book_append_sheet(wb, scenarios, "Scenarios");

  const n = opts?.workingsRows ?? 40;
  const workings: any[][] = [["Client", "Contract end", "CU", "At risk"]];
  for (let i = 0; i < n; i++) {
    // LOCAL midnight, which is how SheetJS writes and reads an Excel date: the
    // value is wall-clock and carries no zone. A UTC-midnight fixture grows an
    // hour on it everywhere east of Greenwich and loses a day west of it.
    workings.push([`Client ${i + 1}`, new Date(2027, i % 12, 15), 10 + i, i % 3 === 0 ? "Yes" : "No"]);
  }
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(workings), "Workings");

  // A sheet AFTER the big one, to catch a budget spent first-come.
  XLSX.utils.book_append_sheet(
    wb,
    XLSX.utils.aoa_to_sheet([["Note"], ["Break-even at 70% renewals"], ["Owner: Chris"]]),
    "Notes"
  );

  return XLSX.write(wb, { type: "buffer", bookType: "xlsx" }) as Buffer;
}

// ── 1. The numbers survive the trip ────────────────────────────────────────
console.log("\n1. What the model is handed");
{
  const out = workbookToText(forecastWorkbook());

  assert(out.sheets.length === 3, `every sheet is read (${out.sheets.length})`);
  assert(/### Sheet: Scenarios/.test(out.text), "the summary tab is in the text");
  assert(/### Sheet: Notes/.test(out.text), "and so is the one after the big tab");

  // THE ASSERTION THIS FILE EXISTS FOR. A percentage stored as 0.7 and handed
  // over as "0.7" gets quoted back as 0.7%, in a document that goes to a
  // client. It has to arrive as the cell displays it.
  assert(!/70%/.test("Booked only Half of renewals Most renewals All renewals"),
    "precondition: no label in this fixture contains 70%, so the next line can only be about the number");
  assert(/70%/.test(out.text), "a percentage arrives as it is displayed, not as 0.7");
  assert(!/\b0\.7\b/.test(out.text), "and the raw fraction is not what is sent");
  assert(/£1,600,000/.test(out.text), "currency keeps its format, so a figure cannot be read off by three orders of magnitude");

  // A formula cell carries its cached value; the formula itself is not the
  // answer to anything a reader wants.
  assert(/£252,000/.test(out.text), "a formula cell arrives as its computed value");
  assert(!/SUM\(E2:E5\)/.test(out.text), "not as its formula");

  // Row order is how someone matches a number back to the file.
  const scen = out.text.indexOf("Booked only");
  const seventy = out.text.indexOf("Most renewals");
  const hundred = out.text.indexOf("All renewals");
  assert(scen > 0 && scen < seventy && seventy < hundred, "rows keep the order they are in on the sheet");

  assert(out.truncated === false, "a workbook that fits is not reported as truncated");
  assert(out.text.indexOf(TRUNCATION_MARKER) < 0, "and carries no truncation marker");

  // DATES ARE THE ONE CELL TYPE WHERE THE DISPLAYED VALUE IS THE WRONG ANSWER.
  // The fixture's contract dates are the 15th on purpose: a day past 12 cannot
  // be mistaken for a month, so any US-order default would still read as a
  // valid date and slip through a looser fixture. The assertion is on the ISO
  // form, which is the only one that cannot be read two ways.
  assert(/2027-01-15/.test(out.text), "a date cell arrives as ISO, not in the workbook's own display order");
  assert(!/1\/15\/27/.test(out.text) && !/15\/01\/27/.test(out.text), "and not in either ambiguous order");
}

// ── 1b. The date rule, on the day that is actually ambiguous ───────────────
console.log("\n1b. A date that could be read two ways");
{
  const wb = XLSX.utils.book_new();
  // The fourth of March. Displayed by the author's locale as 3/4/27 or 4/3/27,
  // and there is no way to tell which from the text alone.
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([["When"], [new Date(2027, 2, 4)]]), "D");
  const buf = XLSX.write(wb, { type: "buffer", bookType: "xlsx" }) as Buffer;
  const out = workbookToText(buf);
  assert(/2027-03-04/.test(out.text), `the fourth of March is unambiguous (${out.text.split("\n").pop()})`);
  assert(!/3\/4\/27/.test(out.text), "and is not handed over as 3/4/27");
  // A DATE WITH NO TIME MUST NOT GROW ONE. The first version formatted through
  // toISOString(), which reads a local wall-clock value in UTC and shifts it by
  // the offset: a 15 April contract end arrived as "2027-04-15 02:00" in
  // Zurich, and west of Greenwich it would have arrived as the 14th. These two
  // hold in every zone, and fail in every zone but UTC if the local getters are
  // swapped back for UTC ones.
  assert(!/2027-03-04 \d\d:/.test(out.text), `a midnight date carries no time (TZ=${Intl.DateTimeFormat().resolvedOptions().timeZone})`);
  assert(!/2027-03-03|2027-03-05/.test(out.text), "and does not slip to the day either side");
}

// ── 2. The contents page ───────────────────────────────────────────────────
//
// A model that can see a sheet exists can ask for it. One that cannot will
// answer as though the file did not contain it, which is the same failure as
// truncating in silence wearing a different hat.
console.log("\n2. Every sheet is named, whether or not it fitted");
{
  const out = workbookToText(forecastWorkbook({ workingsRows: 4000 }), { maxChars: 3000 });
  const header = out.text.slice(0, out.text.indexOf("\n\n"));
  assert(/Scenarios/.test(header) && /Workings/.test(header) && /Notes/.test(header),
    "all three sheets are listed in the header, including any that were cut");
  assert(/Workings \(\d+ rows, \d+ shown\)/.test(header),
    `a cut sheet says how many rows it really has and how many are shown (${header.slice(0, 120)})`);
  assert(out.truncated === true, "and the result reports itself as truncated");
  assert(out.text.indexOf(TRUNCATION_MARKER) >= 0, "with the marker the rest of this codebase uses");
  assert(/Do not total, count, or\s+conclude/.test(out.text.replace(/\n/g, " ")) || /Do not total/.test(out.text),
    "which tells the model what not to do with a partial read");
}

// ── 3. The budget is shared, not raced for ─────────────────────────────────
//
// The bug this prevents is subtle and total: a workbook whose first tab is
// three thousand rows of workings eats the whole budget, and the summary tab
// the file was attached FOR never appears. The model then answers confidently
// from the workings.
console.log("\n3. A big sheet cannot starve the ones after it");
{
  const wb = XLSX.utils.book_new();
  const big: any[][] = [["Row", "Value"]];
  for (let i = 0; i < 5000; i++) big.push([`Row ${i}`, i * 37]);
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(big), "Huge");
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([["Answer"], ["Break-even at 70%"]]), "Summary");
  const buf = XLSX.write(wb, { type: "buffer", bookType: "xlsx" }) as Buffer;

  const out = workbookToText(buf, { maxChars: 4000 });
  assert(out.sheets.length === 2, "both sheets are visited");
  const huge = out.sheets.filter((s) => s.name === "Huge")[0];
  assert(!!huge && huge.emitted < huge.nonEmpty, `precondition: the big sheet really was cut (${huge && huge.emitted} of ${huge && huge.nonEmpty})`);
  assert(/Break-even at 70%/.test(out.text), "and the sheet after it still reaches the model");
}

// ── 4. Blank rows are not truncation ───────────────────────────────────────
//
// Serialising drops empty rows, so `emitted < rows` is ordinary. Reading that
// as a cut fires the marker on almost every real workbook, and a warning that
// is always on is a warning nobody reads.
console.log("\n4. A sparse sheet is not a truncated one");
{
  const rows: any[][] = [["Header", "Value"]];
  for (let i = 0; i < 30; i++) { rows.push([]); rows.push([`Item ${i}`, i]); }
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(rows), "Sparse");
  const buf = XLSX.write(wb, { type: "buffer", bookType: "xlsx" }) as Buffer;

  const ws = XLSX.read(buf, { type: "buffer" }).Sheets["Sparse"];
  const s = serializeSheet(ws);
  assert(s.nonEmpty < s.rows, `precondition: the sheet has blank rows (${s.nonEmpty} of ${s.rows} used)`);
  assert(s.emitted === s.nonEmpty, "every non-empty row is emitted");

  const out = workbookToText(buf);
  assert(out.truncated === false, "so the workbook is not called truncated");
  assert(out.text.indexOf(TRUNCATION_MARKER) < 0, "and no marker is attached to a complete read");
}

// ── 5. Upload and extraction agree ─────────────────────────────────────────
//
// The check the original bug needed. Both lists are RUN, not read: a type is
// acceptable only if something here claims it.
console.log("\n5. Everything uploadable can be read, or is admitted to be unreadable");
{
  const EXT_FOR: { [type: string]: string } = {
    "application/pdf": "a.pdf",
    "application/vnd.openxmlformats-officedocument.wordprocessingml.document": "a.docx",
    "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet": "a.xlsx",
    "application/vnd.ms-excel": "a.xls",
    "application/vnd.openxmlformats-officedocument.presentationml.presentation": "a.pptx",
    "application/vnd.ms-powerpoint": "a.ppt",
    "application/rtf": "a.rtf",
    "application/json": "a.json",
    "application/xml": "a.xml",
  };

  const route = read("app/api/ai/conversations/[id]/messages/route.ts");
  // Claimed by a branch in the extractor. These four are read out of the route
  // because they are conditions rather than exported predicates; the two that
  // carry the bug (spreadsheets, text-ish) are exported and RUN below.
  const handlesPdf = /att\.type === "application\/pdf"/.test(route);
  const handlesDocx = /wordprocessingml\.document"/.test(route);
  const handlesPptx = /presentationml\.presentation"/.test(route);
  const handlesRtf = /rtfToText\(/.test(route);
  assert(handlesPdf && handlesDocx && handlesPptx && handlesRtf, "the extractor still has its PDF, Word, PowerPoint and RTF branches");

  const unhandled: string[] = [];
  for (const type of ALLOWED_UPLOAD_TYPES) {
    if (HANDLED_ELSEWHERE.indexOf(type) >= 0) continue;
    if (KNOWN_UNREADABLE.indexOf(type) >= 0) continue;
    const att = { type, name: EXT_FOR[type] || "a.bin" };
    const claimed =
      isSpreadsheet(att) ||
      isPlainTextish(att) ||
      (type === "application/pdf" && handlesPdf) ||
      (type.indexOf("wordprocessingml") >= 0 && handlesDocx) ||
      (type.indexOf("presentationml") >= 0 && handlesPptx) ||
      (type === "application/rtf" && handlesRtf);
    if (!claimed) unhandled.push(type);
  }
  assert(unhandled.length === 0,
    unhandled.length
      ? `uploadable but nothing reads them: ${unhandled.join(", ")}`
      : `every one of the ${ALLOWED_UPLOAD_TYPES.length} uploadable types is read, sent to vision, or listed as unreadable`);

  // The escape hatch has to stay small and argued for, or it becomes the place
  // holes are hidden rather than recorded.
  assert(KNOWN_UNREADABLE.length <= 2, `the unreadable list stays short (${KNOWN_UNREADABLE.join(", ") || "empty"})`);
  for (const t of KNOWN_UNREADABLE) {
    assert(ALLOWED_UPLOAD_TYPES.indexOf(t) >= 0, `${t} is on the unreadable list because it is uploadable, not as a leftover`);
  }

  // The upload route must take the shared list rather than keeping its own.
  const upload = read("app/api/media/upload/route.ts");
  assert(/ALLOWED_UPLOAD_TYPES/.test(upload), "the upload route uses the shared list");
  assert(!/^\s*const ALLOWED_TYPES = \[/m.test(upload), "and no longer keeps a second copy of it");

  // The extension sniff matters as much as the type: a .csv arrives labelled
  // application/vnd.ms-excel about as often as text/csv.
  assert(isSpreadsheet({ type: "application/octet-stream", name: "Forecast 2027.xlsx" }), "a mislabelled .xlsx is still read as a workbook");
  assert(isSpreadsheet({ type: "application/vnd.ms-excel", name: "export.csv" }), "and a .csv wearing Excel's content type");
  assert(!isSpreadsheet({ type: "application/pdf", name: "report.pdf" }), "while a PDF is not mistaken for one");
}

// ── 6. RTF gives up its words and not its control codes ────────────────────
console.log("\n6. RTF");
{
  const rtf = String.raw`{\rtf1\ansi\deff0{\fonttbl{\f0\froman Times New Roman;}}{\colortbl;\red0\green0\blue0;}
\pard\plain\f0\fs24 Renewals reach \b 70%\b0  in the base case.\par
Profit is \'a32,000 on that scenario.\par
{\*\generator Riched20 10.0}}`;
  const text = rtfToText(rtf);

  assert(/Renewals reach 70% in the base case\./.test(text), `the sentence comes out (${JSON.stringify(text.slice(0, 60))})`);
  assert(/£2,000/.test(text), "with its escaped currency symbol decoded");
  assert(!/fonttbl|colortbl|Times New Roman|Riched20/.test(text), "and the font, colour and generator tables are not treated as prose");
  assert(!/\\?(pard|plain|fs24|deff0)\b/.test(text), "no control word is emitted as a word");
  assert(text.split("\n").length >= 2, "paragraph breaks survive");
}

// ── 7. The date rule holds off this machine's timezone ─────────────────────
//
// WHY THIS RUNS ITSELF AGAIN. The date assertions above compare a local
// wall-clock value against what the formatter emits, and on a UTC machine those
// two are the same thing: swapping the local getters for UTC ones changes
// nothing, every assertion stays green, and the check certifies a formatter
// that moves a contract end date to the day before in Zurich. Measured — the
// mutation is killed in Europe/Zurich and America/Los_Angeles and survives in
// UTC. CI is usually UTC, which is the worst place for that blind spot.
//
// So the whole file re-runs in a zone west of Greenwich, once, in a child. The
// guard variable is what stops that recursing.
if (!process.env.VERIFY_ATTACHMENTS_TZ_CHILD) {
  console.log("\n7. The same assertions, in a timezone that is not this one");
  const zone = Intl.DateTimeFormat().resolvedOptions().timeZone;
  const other = zone === "America/Los_Angeles" ? "Pacific/Auckland" : "America/Los_Angeles";
  try {
    // `npx tsx`, not process.execPath: this file is TypeScript, and plain node
    // exits before the first assertion — which the first version of this read
    // as "the child passed".
    execFileSync("npx", ["tsx", __filename], {
      env: { ...process.env, TZ: other, VERIFY_ATTACHMENTS_TZ_CHILD: "1" },
      stdio: ["ignore", "pipe", "pipe"],
    });
    pass(`every assertion also holds under TZ=${other} (this machine is ${zone})`);
  } catch (e: any) {
    const out = String(e.stdout || "") + String(e.stderr || "");
    const first = (out.match(/^  ✗ .*$/m) || ["(no assertion line captured)"])[0].trim();
    fail(`under TZ=${other}: ${first}`);
  }
}

// ── Self-test ──────────────────────────────────────────────────────────────
if (process.argv.indexOf("--self-test") >= 0) {
  console.log("\n── self-test: each detector against input that should trip it ──");
  const before = failures;
  let fired = 0;
  const detector = (name: string, tripped: boolean) => {
    if (tripped) { console.log(`  ✓ fires on ${name}`); fired++; }
    else console.log(`  ✗ SILENT on ${name}`);
  };

  // Raw instead of displayed.
  const rawText = (() => {
    const ws = XLSX.read(forecastWorkbook(), { type: "buffer" }).Sheets["Scenarios"];
    const grid: any[][] = XLSX.utils.sheet_to_json(ws, { header: 1, raw: true, defval: "" });
    return grid.map((r) => r.join(" | ")).join("\n");
  })();
  detector(
    "raw values instead of displayed ones",
    !/70%/.test(rawText) && !/£1,600,000/.test(rawText) && /\b0\.7\b/.test(rawText) && /\b1600000\b/.test(rawText)
  );

  // Truncation with no marker.
  const cut = workbookToText(forecastWorkbook({ workingsRows: 4000 }), { maxChars: 3000 });
  detector("a truncated workbook (the marker must be present here)", cut.text.indexOf(TRUNCATION_MARKER) >= 0);

  // A sheet that would be starved by a first-come budget.
  const starved = (() => {
    const wb = XLSX.utils.book_new();
    const big: any[][] = [["Row"]];
    for (let i = 0; i < 5000; i++) big.push([`Row ${i} ${"x".repeat(40)}`]);
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(big), "Huge");
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([["LAST SHEET MARKER"]]), "Last");
    const buf = XLSX.write(wb, { type: "buffer", bookType: "xlsx" }) as Buffer;
    // First-come: give the whole budget to sheet one and see what is left.
    const firstComeWouldLeave = SHEET_TEXT_MAX_CHARS - serializeSheet(
      XLSX.read(buf, { type: "buffer" }).Sheets["Huge"], { maxChars: SHEET_TEXT_MAX_CHARS }
    ).text.length;
    return { out: workbookToText(buf, { maxChars: 4000 }), firstComeWouldLeave };
  })();
  detector(
    "a budget spent first-come (the last sheet must survive here)",
    starved.firstComeWouldLeave < 200 && /LAST SHEET MARKER/.test(starved.out.text)
  );

  // A type on the allowlist that nothing reads.
  const rogue = "application/vnd.oasis.opendocument.spreadsheet";
  const rogueClaimed = isSpreadsheet({ type: rogue, name: "a.ods" }) || isPlainTextish({ type: rogue, name: "a.ods" });
  detector("an uploadable type with no reader", !rogueClaimed);

  // Blank rows must not be counted as truncation.
  const sparse = (() => {
    const rows: any[][] = [["H"]];
    for (let i = 0; i < 50; i++) { rows.push([]); rows.push([`v${i}`]); }
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(rows), "S");
    return workbookToText(XLSX.write(wb, { type: "buffer", bookType: "xlsx" }) as Buffer);
  })();
  detector("blank rows being read as a cut (must be quiet here)", sparse.truncated === false);

  // A date left in the workbook's display order.
  const ambiguous = (() => {
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([[new Date(2027, 2, 4)]]), "D");
    const buf = XLSX.write(wb, { type: "buffer", bookType: "xlsx" }) as Buffer;
    const ws = XLSX.read(buf, { type: "buffer", cellDates: true }).Sheets["D"];
    // Without the ISO pass, this is what the serialiser would have emitted.
    const asShipped: any[][] = XLSX.utils.sheet_to_json(ws, { header: 1, raw: false, defval: "" });
    return String(asShipped[0][0]);
  })();
  detector("a date in the workbook's own display order", /^\d{1,2}\/\d{1,2}\/\d{2}/.test(ambiguous));

  // Control words as prose.
  const naive = String.raw`{\rtf1\pard\plain\f0\fs24 Hello\par}`.replace(/[{}]/g, "").replace(/\\/g, " ");
  detector("RTF control words emitted as words", /pard|fs24/.test(naive) && !/pard|fs24/.test(rtfToText(String.raw`{\rtf1\pard\plain\f0\fs24 Hello\par}`)));

  if (fired < 7) { console.log("  a detector stayed silent — this run proves nothing"); failures++; }
  else if (failures === before) console.log("  all detectors fire");
}

console.log(failures === 0 ? "\n✓ what can be uploaded can be read\n" : `\n✗ ${failures} failure(s)\n`);
process.exit(failures === 0 ? 0 : 1);
