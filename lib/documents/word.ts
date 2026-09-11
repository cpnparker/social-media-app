/**
 * Markdown → Word (.docx) generation for EngineAI's generate_word_document tool.
 *
 * Why a real converter and not the three regexes the RFP export uses: the model
 * writes ordinary markdown, and this app's own system prompt *mandates* markdown
 * tables for data queries ("Use markdown tables with clear column headers"). A
 * line-level `##`/`-`/`**bold**` pass drops tables, ordered lists, code, links
 * and blockquotes straight through as literal `| a | b |` text in Word — which
 * looks like a broken export, not a document.
 *
 * Storage and delivery deliberately mirror generateDocument() (the .pptx path)
 * in lib/ai/providers.ts: Vercel Blob with access "private", surfaced through
 * the /api/media/file auth proxy. Nothing new to secure, nothing new to learn.
 */
import { put } from "@vercel/blob";
import { COLOR as BRAND } from "@/lib/slides/brand";
import {
  AlignmentType,
  BorderStyle,
  Document,
  ExternalHyperlink,
  Footer,
  Header,
  HeadingLevel,
  PageNumber,
  Packer,
  PageBreak,
  Paragraph,
  ShadingType,
  Table,
  TableCell,
  TableLayoutType,
  TableRow,
  TextRun,
  WidthType,
  convertInchesToTwip,
} from "docx";

/**
 * The document's type and colour, taken from the DECK's brand so the two
 * deliverables look like they came from the same firm.
 *
 * Until this existed a generated document declared no font at all and no
 * colour of its own: the one colour in the file was #2E74B5, Microsoft's stock
 * heading blue, arriving by default from the docx library. The same .docx also
 * rendered in a different typeface in Word than in the Google Doc, because an
 * empty docDefaults leaves the face to whatever the reader happens to open it
 * in.
 *
 * FONTS ARE CHOSEN TO EXIST IN BOTH TARGETS. The deck's Playfair Display and
 * Roboto are Google Fonts: perfect in the Google Doc, substituted in Word.
 * Georgia and Arial are present in Word on both platforms and in Google Docs'
 * core list, so one file looks the same in both. Embedding the real faces is
 * possible (docx takes `fonts`) at ~300KB a document and no benefit to the
 * Doc; not worth it here.
 */
const DOC = {
  headingFont: "Georgia",
  bodyFont: "Arial",
} as const;

const BODY_SIZE = 22; // half-points → 11pt
const MUTED = "6B7280";
const RULE = "D1D5DB";
const HEADER_SHADE = "F3F4F6";

/** Brand colours, from the deck's palette. One direction only: lib/slides must
 *  never import from lib/documents. */
const INK = BRAND.navy;        // 13.3:1 on white
const ACCENT = BRAND.blue;     // headings and rules
const PANEL = BRAND.tintBlue;  // callout fill, validated against inkBlue
const PANEL_INK = BRAND.inkBlue;

/**
 * Heading sizes in half-points, indexed by markdown depth.
 *
 * NEEDED because `inlineRuns` defaults every run to BODY_SIZE, and in OOXML a
 * size on the RUN beats the one on the paragraph style. So a heading carried
 * the Heading1 style and an explicit 11pt run, and Word obeyed the run: every
 * heading in every generated document came out at body size and unbolded. The
 * whole hierarchy collapsed to a 28pt title, a 13pt subtitle, then a wall of
 * flat text — which is most of why the documents read as formless.
 *
 * The style is still applied, so Word's navigation pane, a table of contents
 * and Google Docs' outline all keep working; these sizes only stop the run
 * from contradicting it.
 */
const HEADING_SIZES = [32, 26, 24, 22, 22, 22]; // 16, 13, 12, 11pt

/** Word's built-in heading levels, indexed by markdown depth (1-6). */
const HEADINGS = [
  HeadingLevel.HEADING_1,
  HeadingLevel.HEADING_2,
  HeadingLevel.HEADING_3,
  HeadingLevel.HEADING_4,
  HeadingLevel.HEADING_5,
  HeadingLevel.HEADING_6,
] as const;

/* ─────────────── Inline formatting ─────────────── */

/**
 * Split one line of markdown into docx runs.
 *
 * Order matters: code spans are matched first so `**not bold**` inside
 * backticks survives, and links are matched before emphasis so a bold link
 * label doesn't get torn in half.
 */
function inlineRuns(text: string, opts: { size?: number; color?: string; bold?: boolean } = {}): (TextRun | ExternalHyperlink)[] {
  const size = opts.size ?? BODY_SIZE;
  const runs: (TextRun | ExternalHyperlink)[] = [];

  // One pass, one regex: whichever construct starts earliest wins.
  const PATTERN =
    /(`[^`]+`)|(\[[^\]]+\]\([^)\s]+\))|(\*\*[^*]+\*\*)|(__[^_]+__)|(\*[^*\n]+\*)|(_[^_\n]+_)|(~~[^~]+~~)/;

  let rest = text;
  let guard = 0;
  while (rest.length > 0 && guard++ < 500) {
    const m = PATTERN.exec(rest);
    if (!m) break;

    if (m.index > 0) {
      runs.push(new TextRun({ text: rest.slice(0, m.index), size, color: opts.color, bold: opts.bold }));
    }
    const token = m[0];

    if (token.startsWith("`")) {
      runs.push(
        new TextRun({
          text: token.slice(1, -1),
          size: size - 2,
          font: "Consolas",
          color: "B91C1C",
          shading: { type: ShadingType.CLEAR, fill: "F3F4F6" },
        })
      );
    } else if (token.startsWith("[")) {
      const linkMatch = /^\[([^\]]+)\]\(([^)\s]+)\)$/.exec(token);
      if (linkMatch) {
        runs.push(
          new ExternalHyperlink({
            link: linkMatch[2],
            children: [new TextRun({ text: linkMatch[1], size, color: "2563EB", underline: {} })],
          })
        );
      } else {
        runs.push(new TextRun({ text: token, size, color: opts.color, bold: opts.bold }));
      }
    } else if (token.startsWith("**") || token.startsWith("__")) {
      runs.push(new TextRun({ text: token.slice(2, -2), size, bold: true, color: opts.color }));
    } else if (token.startsWith("~~")) {
      runs.push(new TextRun({ text: token.slice(2, -2), size, strike: true, color: opts.color }));
    } else {
      runs.push(new TextRun({ text: token.slice(1, -1), size, italics: true, bold: opts.bold, color: opts.color }));
    }

    rest = rest.slice(m.index + token.length);
  }

  if (rest.length > 0) {
    runs.push(new TextRun({ text: rest, size, color: opts.color, bold: opts.bold }));
  }
  return runs.length > 0 ? runs : [new TextRun({ text: "", size })];
}

/* ─────────────── Tables ─────────────── */

function splitRow(line: string): string[] {
  return line
    .replace(/^\s*\|/, "")
    .replace(/\|\s*$/, "")
    .split("|")
    .map((c) => c.trim());
}

/**
 * A `| --- | :--: |` separator is what distinguishes a table from stacked pipes.
 *
 * The pipe is REQUIRED. Without it a bare `---` section break — which models
 * emit constantly — reads as a divider, and any preceding prose line that
 * merely contains a `|` ("Revenue | Costs shown below.") gets promoted to a
 * table header, silently boxing the next few paragraphs into a grid.
 */
function isTableDivider(line: string): boolean {
  if (!line.includes("|")) return false;
  const cells = splitRow(line);
  return cells.length > 0 && cells.every((c) => /^:?-{1,}:?$/.test(c.trim()));
}

/** The `:--:` markers, which were parsed to identify the divider and then
 *  thrown away — so a column of figures the model explicitly right-aligned
 *  came out ragged left like everything else. */
function alignmentsOf(divider: string): (typeof AlignmentType[keyof typeof AlignmentType])[] {
  return splitRow(divider).map((c) => {
    const t = c.trim();
    const left = t.startsWith(":");
    const right = t.endsWith(":");
    if (left && right) return AlignmentType.CENTER;
    if (right) return AlignmentType.RIGHT;
    return AlignmentType.LEFT;
  });
}

/** Does this line start a new block? Used to stop the table-row scanner. */
function startsNewBlock(line: string): boolean {
  const t = line.trim();
  return (
    t === "" ||
    /^#{1,6}\s/.test(t) ||
    /^```/.test(t) ||
    /^>\s?/.test(t) ||
    /^(-{3,}|\*{3,}|_{3,})$/.test(t) ||
    /^\s*[-*+]\s+/.test(line) ||
    /^\s*\d+[.)]\s+/.test(line)
  );
}

function buildTable(headerIn: string[], rowsIn: string[][], aligns: (typeof AlignmentType[keyof typeof AlignmentType])[] = []): Table {
  // A cell value containing an unescaped "|" splits into two, pushing the real
  // last column off the end. Widening to the longest row keeps that content in
  // the document — misaligned, but present. Silently dropping it would put the
  // wrong number against the right label, which is worse than an ugly cell.
  const colCount = Math.max(headerIn.length, ...rowsIn.map((r) => r.length), 1);
  const header = [...headerIn, ...Array(Math.max(0, colCount - headerIn.length)).fill("")];
  const rows = rowsIn.map((r) => [...r, ...Array(Math.max(0, colCount - r.length)).fill("")]);

  // EXPLICIT COLUMN WIDTHS, or the table is destroyed in Google Docs.
  //
  // Word auto-fits a table that declares none. Drive's importer does not: it
  // collapses every column to its minimum, and a header of "Pillar | Score |
  // Reading" renders as three one-character columns with the letters stacked
  // vertically down the page. That is what a reader actually opened, while the
  // .docx looked correct in every check — the file was fine and the CONVERSION
  // was not, which is the failure mode this whole path is built on.
  //
  // Widths are proportional to the longest cell in each column, clamped so one
  // long sentence cannot squeeze a figures column to nothing, and expressed in
  // twips of the real text measure (letter page minus one-inch margins).
  const TEXT_WIDTH_TWIPS = 9360;
  const longest = header.map((h, i) =>
    Math.max(String(h).length, ...rows.map((r) => String(r[i] ?? "").length), 3)
  );
  const clamped = longest.map((n) => Math.min(Math.max(n, 6), 46));
  const total = clamped.reduce((a, b) => a + b, 0) || 1;
  const columnWidths = clamped.map((n) => Math.round((n / total) * TEXT_WIDTH_TWIPS));
  const colWidth = (i: number) => ({ size: columnWidths[i], type: WidthType.DXA });
  const width = { size: TEXT_WIDTH_TWIPS, type: WidthType.DXA };
  // Size 1 is an eighth of a point — below what Word renders reliably, so the
  // grid read as a smudge. 4 is a half-point hairline that actually draws.
  const border = { style: BorderStyle.SINGLE, size: 4, color: RULE };
  const borders = { top: border, bottom: border, left: border, right: border };
  const margins = { top: 100, bottom: 100, left: 140, right: 140 };
  const at = (i: number) => aligns[i] ?? AlignmentType.LEFT;
  // NO trailing space inside a cell. Body paragraphs want space after them and
  // cells do not, and cell paragraphs carry no properties of their own — so
  // whatever the document default is reaches them. Set here explicitly rather
  // than relying on the default staying empty.
  const cellPara = (children: any[], alignment: any) =>
    new Paragraph({ children, alignment, spacing: { after: 0, line: 240 } });

  const headerRow = new TableRow({
    tableHeader: true,
    // A header row that repeats when a table breaks across pages, and does not
    // itself split.
    cantSplit: true,
    children: header.map(
      (cell, i) =>
        new TableCell({
          borders,
          width: colWidth(i),
          shading: { type: ShadingType.CLEAR, fill: INK },
          margins,
          children: [cellPara(inlineRuns(cell, { bold: true, color: "FFFFFF" }), at(i))],
        })
    ),
  });

  const bodyRows = rows.map(
    (cells, r) =>
      new TableRow({
        cantSplit: true,
        children: header.map(
          (_h, i) =>
            new TableCell({
              borders,
              width: colWidth(i),
              margins,
              // Banded rows: a wide table of figures is much easier to read
              // across when alternate rows carry a tint.
              ...(r % 2 === 1 ? { shading: { type: ShadingType.CLEAR, fill: HEADER_SHADE } } : {}),
              // Ragged rows are common in model output — pad rather than drop
              // the row, so a missing trailing cell can't shift a whole column.
              children: [cellPara(inlineRuns(cells[i] ?? ""), at(i))],
            })
        ),
      })
  );

  // columnWidths on the Table itself is what writes the <w:tblGrid>, and the
  // grid is what Drive's importer reads.
  return new Table({ width, columnWidths, layout: TableLayoutType.FIXED, rows: [headerRow, ...bodyRows] });
}

/* ─────────────── Block parsing ─────────────── */

/**
 * Convert a markdown document into docx block nodes.
 *
 * Exported for the assertion script — this is the part worth pinning down,
 * because a silent regression here produces a plausible-looking file with the
 * content quietly mangled rather than an error.
 */
export function markdownToDocxBlocks(markdown: string): (Paragraph | Table)[] {
  const lines = (markdown || "").replace(/\r\n/g, "\n").split("\n");
  const blocks: (Paragraph | Table)[] = [];
  let i = 0;

  while (i < lines.length) {
    const line = lines[i];
    const trimmed = line.trim();

    if (trimmed === "") {
      i++;
      continue;
    }

    // Fenced code — consumed verbatim, never re-parsed for inline markup.
    if (/^```/.test(trimmed)) {
      i++;
      const code: string[] = [];
      while (i < lines.length && !/^```/.test(lines[i].trim())) {
        code.push(lines[i]);
        i++;
      }
      i++; // closing fence
      for (const codeLine of code) {
        blocks.push(
          new Paragraph({
            spacing: { after: 0 },
            shading: { type: ShadingType.CLEAR, fill: "F9FAFB" },
            children: [new TextRun({ text: codeLine || " ", size: BODY_SIZE - 2, font: "Consolas" })],
          })
        );
      }
      continue;
    }

    // Table: a header line followed by a divider line.
    if (trimmed.includes("|") && i + 1 < lines.length && isTableDivider(lines[i + 1])) {
      const header = splitRow(trimmed);
      const aligns = alignmentsOf(lines[i + 1]);
      i += 2;
      const rows: string[][] = [];
      // Stop at anything that opens a new block, not just at a blank line —
      // otherwise a bullet or a sentence that happens to contain a "|"
      // ("Totals above are gross | net is lower.") is swallowed as a table row
      // and loses its own formatting.
      while (i < lines.length && lines[i].includes("|") && !startsNewBlock(lines[i])) {
        rows.push(splitRow(lines[i]));
        i++;
      }
      blocks.push(buildTable(header, rows, aligns));
      // Word collapses adjacent tables into one; a spacer keeps them apart.
      blocks.push(new Paragraph({ spacing: { after: 120 }, children: [new TextRun({ text: "", size: BODY_SIZE })] }));
      continue;
    }

    // An explicit page break the model can place. A long report wants its
    // sections to start on a fresh page, and until now it had no way to say so
    // — the renderer's expressive range was larger than anything the tool
    // description admitted, which is a theme of this file.
    if (/^(\\pagebreak|<!--\s*pagebreak\s*-->)$/i.test(trimmed)) {
      blocks.push(new Paragraph({ children: [new PageBreak()] }));
      i++;
      continue;
    }

    // Horizontal rule
    if (/^(-{3,}|\*{3,}|_{3,})$/.test(trimmed)) {
      blocks.push(
        new Paragraph({
          spacing: { before: 160, after: 160 },
          border: { bottom: { style: BorderStyle.SINGLE, size: 6, color: RULE, space: 1 } },
          children: [new TextRun({ text: "", size: BODY_SIZE })],
        })
      );
      i++;
      continue;
    }

    // Headings
    const heading = /^(#{1,6})\s+(.+)$/.exec(trimmed);
    if (heading) {
      const depth = heading[1].length;
      blocks.push(
        new Paragraph({
          heading: HEADINGS[depth - 1],
          // A heading alone at the foot of a page belongs to nothing.
          keepNext: true,
          spacing: { before: depth <= 2 ? 320 : 220, after: 120 },
          children: inlineRuns(heading[2], { size: HEADING_SIZES[depth - 1], bold: true }),
        })
      );
      i++;
      continue;
    }

    // Blockquote
    const quote = /^>\s?(.*)$/.exec(trimmed);
    if (quote) {
      blocks.push(
        new Paragraph({
          spacing: { before: 120, after: 160 },
          indent: { left: convertInchesToTwip(0.12) },
          // A CALLOUT, not a whisper. This is the construct the prompt names
          // for the figure a section turns on, and it was rendered in muted
          // grey — lighter than the body text it was supposed to stand out
          // from. Brand rule, brand tint, brand ink, and a size up.
          border: { left: { style: BorderStyle.SINGLE, size: 18, color: ACCENT, space: 10 } },
          shading: { type: ShadingType.CLEAR, fill: PANEL },
          children: inlineRuns(quote[1], { color: PANEL_INK, size: BODY_SIZE + 1 }),
        })
      );
      i++;
      continue;
    }

    // Bulleted list — indentation (2 spaces or a tab per level) sets nesting.
    const bullet = /^(\s*)[-*+]\s+(.+)$/.exec(line);
    if (bullet) {
      const level = Math.min(Math.floor(bullet[1].replace(/\t/g, "  ").length / 2), 4);
      blocks.push(
        new Paragraph({
          bullet: { level },
          spacing: { after: 60 },
          children: inlineRuns(bullet[2]),
        })
      );
      i++;
      continue;
    }

    // Ordered list. docx's `numbering` needs a configured instance, which would
    // renumber across every list in the document; rendering the model's own
    // numbers keeps each list independent and matches what the user was shown.
    // The bold form counts too: a model writing `**1. Publish the page**`
    // produced a plain unindented paragraph, because the digit had to be the
    // first thing on the line.
    const ordered = /^(\s*)(?:\*\*)?(\d+)[.)]\s+(.+?)(?:\*\*)?$/.exec(line);
    if (ordered) {
      const level = Math.min(Math.floor(ordered[1].replace(/\t/g, "  ").length / 2), 4);
      blocks.push(
        new Paragraph({
          indent: { left: convertInchesToTwip(0.25 + level * 0.25), hanging: convertInchesToTwip(0.25) },
          spacing: { after: 60 },
          children: [
            new TextRun({ text: `${ordered[2]}.\t`, size: BODY_SIZE }),
            ...inlineRuns(ordered[3]),
          ],
        })
      );
      i++;
      continue;
    }

    // Paragraph — join soft-wrapped lines until a blank line or a new block.
    const para: string[] = [trimmed];
    i++;
    while (i < lines.length) {
      const next = lines[i];
      const nextTrimmed = next.trim();
      if (
        nextTrimmed === "" ||
        /^(#{1,6})\s/.test(nextTrimmed) ||
        /^```/.test(nextTrimmed) ||
        /^>\s?/.test(nextTrimmed) ||
        /^(\s*)[-*+]\s+/.test(next) ||
        /^(\s*)\d+[.)]\s+/.test(next) ||
        /^(-{3,}|\*{3,}|_{3,})$/.test(nextTrimmed) ||
        (nextTrimmed.includes("|") && i + 1 < lines.length && isTableDivider(lines[i + 1]))
      ) {
        break;
      }
      para.push(nextTrimmed);
      i++;
    }
    blocks.push(
      new Paragraph({
        spacing: { after: 160 },
        children: inlineRuns(para.join(" ")),
      })
    );
  }

  return blocks;
}

/* ─────────────── Document assembly ─────────────── */

export interface WordDocInput {
  title: string;
  /** Markdown body. Headings, lists, tables, code, quotes and links all render. */
  body: string;
  subtitle?: string;
  /** Omit the cover block for short documents (letters, memos, one-pagers). */
  coverPage?: boolean;
  /** Scopes the stored blob. Omitted only by callers that have no workspace. */
  workspaceId?: number | string;
}

/** Filesystem-safe display name derived from the document title. */
function displayFilename(title: string): string {
  const stem =
    (title || "Document")
      .replace(/[^a-zA-Z0-9\s-]/g, "")
      .trim()
      .replace(/\s+/g, "_")
      .slice(0, 60) || "Document";
  return `${stem}.docx`;
}

/**
 * The document itself, as bytes. No network, no blob token, no upload.
 *
 * Split out so the rendered RESULT can be asserted — heading sizes, the cover
 * page's page break — rather than only the block objects that go into it. The
 * cover page shipped for months as a centred masthead with no page break at
 * all, and every existing assertion passed, because nothing ever rendered a
 * whole document and looked at it.
 */
export async function buildWordDocxBuffer(input: WordDocInput): Promise<Buffer> {
  const { title, body, subtitle, coverPage = false } = input;

  const children: (Paragraph | Table)[] = [];

  // A COVER IS COMPOSED, not just centred. Left-aligned on a third of the page
  // with a brand rule above the title: the previous version put a centred
  // title at the very top of an otherwise blank sheet, which reads as a page
  // that failed to load rather than a cover.
  if (coverPage) {
    children.push(
      new Paragraph({ spacing: { after: 0 }, children: [new TextRun({ text: "", size: 22 })] }),
      new Paragraph({
        spacing: { before: 2600, after: 200 },
        border: { bottom: { style: BorderStyle.SINGLE, size: 24, color: ACCENT, space: 10 } },
        children: [new TextRun({ text: "", size: 8 })],
      })
    );
  }

  children.push(
    new Paragraph({
      heading: HeadingLevel.TITLE,
      alignment: AlignmentType.LEFT,
      spacing: { after: subtitle ? 160 : 320 },
      children: inlineRuns(title, { size: coverPage ? 60 : 56, bold: true }),
    })
  );

  if (subtitle) {
    children.push(
      new Paragraph({
        alignment: AlignmentType.LEFT,
        spacing: { after: 240 },
        // The standfirst is the JUDGEMENT on a report, so it is set to be read
        // rather than to be small: brand ink, not the muted grey that made it
        // look like a caption under the title.
        children: [new TextRun({ text: subtitle, size: 26, color: coverPage ? PANEL_INK : MUTED, font: DOC.headingFont })],
      })
    );
  }

  if (coverPage) {
    children.push(
      new Paragraph({
        alignment: AlignmentType.LEFT,
        spacing: { after: 640 },
        children: [
          new TextRun({
            text: new Date().toLocaleDateString("en-GB", { year: "numeric", month: "long", day: "numeric" }),
            size: 22,
            color: MUTED,
          }),
        ],
      })
    );
    // AND A PAGE BREAK, which is what makes it a cover PAGE. Without one the
    // whole feature was a centred title, a centred subtitle, a date and 0.44
    // inch of air, with the first body heading directly beneath it on the same
    // page — a masthead. The schema promises "a formal standalone deliverable"
    // and the AuthorityOn report path sets it on every client document, so
    // every one of those shipped without the cover it was asked for.
    children.push(new Paragraph({ children: [new PageBreak()] }));
  }

  children.push(...markdownToDocxBlocks(body));

  const doc = new Document({
    title,
    creator: "EngineAI",
    description: subtitle || undefined,
    // THE DOCUMENT'S TYPE AND COLOUR.
    //
    // Three deliberate restrictions, each one a trap that was verified rather
    // than guessed:
    //   - NO `size` in docDefaults. Nearly every run carries an explicit size
    //     from BODY_SIZE, and a run beats docDefaults, so a default size here
    //     would be dead code that reads as if it worked.
    //   - NO paragraph `spacing.after` in docDefaults. Table cells are emitted
    //     with no paragraph properties at all and there is no table style, so
    //     docDefaults is the ONLY layer that reaches them: a document-wide
    //     `after` silently adds trailing space to every cell in every table.
    //     Line spacing alone is safe and is what body copy actually needed.
    //   - COLOUR moves into the heading styles, but SIZE and BOLD stay on the
    //     runs. Two live assertions read the run-level size, and more
    //     importantly a style-level size is overridden by the run anyway.
    styles: {
      default: {
        document: { run: { font: DOC.bodyFont, color: INK }, paragraph: { spacing: { line: 276 } } },
        title: { run: { font: DOC.headingFont, color: INK } },
        heading1: { run: { font: DOC.headingFont, color: INK } },
        heading2: { run: { font: DOC.headingFont, color: ACCENT } },
        heading3: { run: { font: DOC.headingFont, color: ACCENT } },
        heading4: { run: { font: DOC.headingFont, color: INK } },
        heading5: { run: { font: DOC.headingFont, color: INK } },
        heading6: { run: { font: DOC.headingFont, color: INK } },
      },
    },
    sections: [
      {
        properties: {
          page: {
            margin: { top: 1440, right: 1440, bottom: 1440, left: 1440 },
            // Numbering belongs to the PAGE properties, not the section root.
            // Start at 0 so the cover is 0 and the first content page is 1.
            ...(coverPage ? { pageNumbers: { start: 0 } } : {}),
          },
          // A COVER PAGE CARRIES NO FURNITURE. Without this the cover showed
          // the running header and a page number, and counted as page 1 — so
          // the first page of actual content was numbered 2, which reads as a
          // missing page. `titlePage` gives the first page its own (empty)
          // header and footer; the numbering then starts at 0 so the first
          // content page is 1.
          ...(coverPage ? { titlePage: true } : {}),
        },
        headers: {
          // Empty on the cover.
          ...(coverPage ? { first: new Header({ children: [new Paragraph({ children: [] })] }) } : {}),
          default: new Header({
            children: [
              new Paragraph({
                alignment: AlignmentType.RIGHT,
                children: [new TextRun({ text: title, size: 16, color: MUTED, italics: true })],
              }),
            ],
          }),
        },
        footers: {
          ...(coverPage ? { first: new Footer({ children: [new Paragraph({ children: [] })] }) } : {}),
          default: new Footer({
            children: [
              new Paragraph({
                alignment: AlignmentType.CENTER,
                children: [new TextRun({ children: [PageNumber.CURRENT], size: 16, color: MUTED })],
              }),
            ],
          }),
        },
        children,
      },
    ],
  });

  return Packer.toBuffer(doc).then((b) => Buffer.from(b));
}

/**
 * Build the .docx AND upload it.
 *
 * The building is `buildWordDocxBuffer` above, deliberately separate: a check
 * can render a real document and read its XML back without a blob token and
 * without writing anything anywhere. Stubbing the upload from outside does not
 * work — `put` is a static import, already bound by the time a test could
 * intercept it — so the seam has to exist in the code rather than in the test.
 */
export async function generateWordDocument(
  input: WordDocInput
): Promise<{ url: string; filename: string; buffer: Buffer }> {
  const { title, workspaceId } = input;
  const buffer = await buildWordDocxBuffer(input);

  // Workspace-scoped, unlike the .pptx path's flat `presentations/` prefix.
  //
  // /api/media/file authorises on session presence alone and then trusts the
  // caller-supplied path — no ownership check, no DB lookup. So the pathname is
  // the ONLY thing standing between one person's document and any other signed-in
  // user, and the workspace prefix is not itself a secret (every member sees it
  // in their own links). That makes the random component load-bearing:
  // Math.random() is ~31 bits from a non-cryptographic PRNG whose state is
  // recoverable from observed output, which is not a credential. randomUUID is.
  // This narrows the hole for new documents; it does not close it — the route
  // still needs a real ownership check for every blob type.
  const { randomUUID } = await import("crypto");
  const scope = workspaceId ? `w${workspaceId}` : "shared";
  const blobPath = `documents/${scope}/${Date.now()}-${randomUUID()}.docx`;

  const blob = await put(blobPath, Buffer.from(buffer), {
    access: "private",
    contentType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  });

  return {
    url: `/api/media/file?path=${encodeURIComponent(blob.pathname)}`,
    filename: displayFilename(title),
    buffer: Buffer.from(buffer),
  };
}
