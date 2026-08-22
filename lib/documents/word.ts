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
  Paragraph,
  ShadingType,
  Table,
  TableCell,
  TableRow,
  TextRun,
  WidthType,
  convertInchesToTwip,
} from "docx";

const BODY_SIZE = 22; // half-points → 11pt
const MUTED = "6B7280";
const RULE = "D1D5DB";
const HEADER_SHADE = "F3F4F6";

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

function buildTable(headerIn: string[], rowsIn: string[][]): Table {
  // A cell value containing an unescaped "|" splits into two, pushing the real
  // last column off the end. Widening to the longest row keeps that content in
  // the document — misaligned, but present. Silently dropping it would put the
  // wrong number against the right label, which is worse than an ugly cell.
  const colCount = Math.max(headerIn.length, ...rowsIn.map((r) => r.length), 1);
  const header = [...headerIn, ...Array(Math.max(0, colCount - headerIn.length)).fill("")];
  const rows = rowsIn.map((r) => [...r, ...Array(Math.max(0, colCount - r.length)).fill("")]);

  const width = { size: 100, type: WidthType.PERCENTAGE };
  const border = { style: BorderStyle.SINGLE, size: 1, color: RULE };
  const borders = { top: border, bottom: border, left: border, right: border };

  const headerRow = new TableRow({
    tableHeader: true,
    children: header.map(
      (cell) =>
        new TableCell({
          borders,
          shading: { type: ShadingType.CLEAR, fill: HEADER_SHADE },
          margins: { top: 80, bottom: 80, left: 120, right: 120 },
          children: [new Paragraph({ children: inlineRuns(cell, { bold: true }) })],
        })
    ),
  });

  const bodyRows = rows.map(
    (cells) =>
      new TableRow({
        children: header.map(
          (_h, i) =>
            new TableCell({
              borders,
              margins: { top: 80, bottom: 80, left: 120, right: 120 },
              // Ragged rows are common in model output — pad rather than drop
              // the row, so a missing trailing cell can't shift a whole column.
              children: [new Paragraph({ children: inlineRuns(cells[i] ?? "") })],
            })
        ),
      })
  );

  return new Table({ width, rows: [headerRow, ...bodyRows] });
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
      blocks.push(buildTable(header, rows));
      // Word collapses adjacent tables into one; a spacer keeps them apart.
      blocks.push(new Paragraph({ spacing: { after: 120 }, children: [new TextRun({ text: "", size: BODY_SIZE })] }));
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
          spacing: { before: depth <= 2 ? 320 : 220, after: 120 },
          children: inlineRuns(heading[2]),
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
          indent: { left: convertInchesToTwip(0.3) },
          spacing: { after: 120 },
          border: { left: { style: BorderStyle.SINGLE, size: 12, color: RULE, space: 8 } },
          children: inlineRuns(quote[1], { color: MUTED }),
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
    const ordered = /^(\s*)(\d+)[.)]\s+(.+)$/.exec(line);
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

export async function generateWordDocument(
  input: WordDocInput
): Promise<{ url: string; filename: string }> {
  const { title, body, subtitle, coverPage = false, workspaceId } = input;

  const children: (Paragraph | Table)[] = [];

  children.push(
    new Paragraph({
      heading: HeadingLevel.TITLE,
      alignment: coverPage ? AlignmentType.CENTER : AlignmentType.LEFT,
      spacing: { after: subtitle ? 120 : 320 },
      children: inlineRuns(title, { size: 56, bold: true }),
    })
  );

  if (subtitle) {
    children.push(
      new Paragraph({
        alignment: coverPage ? AlignmentType.CENTER : AlignmentType.LEFT,
        spacing: { after: 240 },
        children: [new TextRun({ text: subtitle, size: 26, color: MUTED })],
      })
    );
  }

  if (coverPage) {
    children.push(
      new Paragraph({
        alignment: AlignmentType.CENTER,
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
  }

  children.push(...markdownToDocxBlocks(body));

  const doc = new Document({
    title,
    creator: "EngineAI",
    description: subtitle || undefined,
    sections: [
      {
        properties: {
          page: { margin: { top: 1440, right: 1440, bottom: 1440, left: 1440 } },
        },
        headers: {
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

  const buffer = await Packer.toBuffer(doc);

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
  };
}
