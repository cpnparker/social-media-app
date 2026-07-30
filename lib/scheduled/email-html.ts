/**
 * Markdown → email-safe HTML for scheduled-prompt deliveries.
 *
 * The chat UI renders markdown through formatMarkdown() + `.ai-*` classes in
 * globals.css. Email has no stylesheet, so this is a separate, deliberately
 * small renderer that inlines every style — and, critically, turns markdown
 * TABLES into real <table> markup. Escaping the pipes and joining with <br/>
 * (what the runner used to do) makes a 9-column forecast unreadable.
 *
 * Scope is the subset the scheduled runs actually produce: tables, headings,
 * bullet/numbered lists, rules, paragraphs, bold/italic/code/links.
 */

const SANS = "-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif";
const MONO = "ui-monospace,SFMono-Regular,Menlo,Consolas,monospace";

/** Gmail clips a message around 102KB; stay well under so nothing is hidden
 *  behind a "[Message clipped]" link. */
const HTML_BUDGET = 80_000;
const MAX_TABLE_ROWS = 200;

function esc(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

/** Escape first, then apply inline markdown to the escaped text. */
function inline(s: string): string {
  let t = esc(s);
  // Code spans first so their contents aren't re-formatted.
  t = t.replace(/`([^`\n]+)`/g, `<code style="font-family:${MONO};font-size:0.92em;background:#f3f4f6;padding:1px 4px;border-radius:4px">$1</code>`);
  t = t.replace(/\*\*([^*\n]+)\*\*/g, "<strong>$1</strong>");
  // Asterisk italics only — underscores are common inside identifiers and
  // column labels, and turning net_profit_row into italics is worse than
  // leaving the odd _emphasis_ unstyled.
  t = t.replace(/(^|[^*])\*([^*\n]+)\*(?!\*)/g, "$1<em>$2</em>");
  t = t.replace(/\[([^\]\n]+)\]\((https?:\/\/[^\s)]+)\)/g, '<a href="$2" style="color:#1a56db;text-decoration:underline">$1</a>');
  return t;
}

const NUMERIC = /^[-+(]?\s*(?:CHF|GBP|USD|EUR|£|\$|€)?\s*[\d][\d,.\s]*\s*%?\)?$/i;
const NEGATIVE = /^\s*[-(]/;

/** Strip inline markers before testing a cell's shape — a totals row is
 *  usually written **-48,000**, and the asterisks would otherwise make it
 *  read as text: no right-alignment, no negative colour, on the one row that
 *  matters most. */
function plain(cell: string): string {
  return cell.replace(/\*\*/g, "").replace(/`/g, "").replace(/^\*|\*$/g, "").trim();
}

function isNumeric(cell: string): boolean {
  const c = plain(cell);
  return c !== "" && NUMERIC.test(c);
}

/** "| a | b |" → ["a","b"], tolerating missing outer pipes. */
function splitRow(line: string): string[] {
  let t = line.trim();
  if (t.startsWith("|")) t = t.slice(1);
  if (t.endsWith("|")) t = t.slice(0, -1);
  return t.split("|").map((c) => c.trim());
}

function isSeparator(line: string): boolean {
  const cells = splitRow(line);
  return cells.length > 0 && cells.every((c) => /^:?-{2,}:?$/.test(c.replace(/\s/g, "")));
}

function renderTable(header: string[], rows: string[][]): string {
  // Decide alignment per column from the body, so a numeric column stays
  // right-aligned even when one cell says "n/a".
  const cols = Math.max(header.length, ...rows.map((r) => r.length));
  const rightAlign: boolean[] = [];
  for (let c = 0; c < cols; c++) {
    const vals = rows.map((r) => plain(r[c] ?? "")).filter((v) => v !== "" && v !== "—" && v !== "-");
    rightAlign[c] = c > 0 && vals.length > 0 && vals.filter(isNumeric).length >= Math.ceil(vals.length / 2);
  }

  const th = (label: string, c: number) =>
    `<th style="padding:7px 9px;border-bottom:2px solid #111827;background:#f3f4f6;font-weight:600;font-size:11px;letter-spacing:.02em;text-transform:uppercase;color:#374151;white-space:nowrap;text-align:${rightAlign[c] ? "right" : "left"}">${inline(label)}</th>`;

  const td = (val: string, c: number, zebra: boolean) => {
    const v = val.trim();
    const numeric = isNumeric(v);
    const neg = numeric && NEGATIVE.test(plain(v));
    const first = c === 0;
    const style = [
      "padding:6px 9px",
      "border-bottom:1px solid #e5e7eb",
      "font-size:12px",
      "white-space:nowrap",
      `text-align:${rightAlign[c] ? "right" : "left"}`,
      first ? "font-weight:600;color:#111827" : neg ? "color:#b42318" : "color:#1f2937",
      numeric ? `font-family:${MONO};font-variant-numeric:tabular-nums` : "",
      zebra ? "background:#fafafa" : "",
    ].filter(Boolean).join(";");
    return `<td style="${style}">${inline(v)}</td>`;
  };

  const capped = rows.slice(0, MAX_TABLE_ROWS);
  const body = capped
    .map((r, i) => `<tr>${Array.from({ length: cols }, (_, c) => td(r[c] ?? "", c, i % 2 === 1)).join("")}</tr>`)
    .join("");
  const more = rows.length > capped.length
    ? `<tr><td colspan="${cols}" style="padding:6px 9px;font-size:11px;color:#6b7280">… ${rows.length - capped.length} more rows — open the thread for the full table</td></tr>`
    : "";

  return (
    `<div style="overflow-x:auto;margin:14px 0">` +
    `<table role="presentation" cellspacing="0" cellpadding="0" style="border-collapse:collapse;font-family:${SANS};min-width:100%">` +
    `<thead><tr>${Array.from({ length: cols }, (_, c) => th(header[c] ?? "", c)).join("")}</tr></thead>` +
    `<tbody>${body}${more}</tbody></table></div>`
  );
}

export function markdownToEmailHtml(md: string): { html: string; truncated: boolean; hasTable: boolean } {
  const lines = (md || "").replace(/\r\n/g, "\n").split("\n");
  const blocks: string[] = [];
  let hasTable = false;
  let i = 0;

  const flushPara = (buf: string[]) => {
    if (!buf.length) return;
    blocks.push(
      `<p style="margin:0 0 12px;font-size:14px;line-height:1.6;color:#1f2937;font-family:${SANS}">${buf.map(inline).join("<br/>")}</p>`
    );
    buf.length = 0;
  };

  const para: string[] = [];

  while (i < lines.length) {
    const line = lines[i];
    const trimmed = line.trim();

    if (trimmed === "") { flushPara(para); i++; continue; }

    // Fenced code
    if (/^```/.test(trimmed)) {
      flushPara(para);
      const buf: string[] = [];
      i++;
      while (i < lines.length && !/^```/.test(lines[i].trim())) { buf.push(lines[i]); i++; }
      i++;
      blocks.push(
        `<pre style="margin:12px 0;padding:10px 12px;background:#f6f8fa;border:1px solid #e5e7eb;border-radius:8px;overflow-x:auto;font-family:${MONO};font-size:12px;line-height:1.5;color:#1f2937">${esc(buf.join("\n"))}</pre>`
      );
      continue;
    }

    // Table: a pipe row followed by a --- separator
    if (trimmed.includes("|") && i + 1 < lines.length && isSeparator(lines[i + 1])) {
      flushPara(para);
      const header = splitRow(trimmed);
      i += 2;
      const rows: string[][] = [];
      while (i < lines.length && lines[i].includes("|") && lines[i].trim() !== "") {
        if (!isSeparator(lines[i])) rows.push(splitRow(lines[i]));
        i++;
      }
      blocks.push(renderTable(header, rows));
      hasTable = true;
      continue;
    }

    // Heading
    const h = trimmed.match(/^(#{1,6})\s+(.*)$/);
    if (h) {
      flushPara(para);
      const level = h[1].length;
      const size = level <= 1 ? 19 : level === 2 ? 16 : 14;
      blocks.push(
        `<h${Math.min(level, 4)} style="margin:18px 0 8px;font-size:${size}px;line-height:1.3;font-weight:650;color:#111827;font-family:${SANS}">${inline(h[2])}</h${Math.min(level, 4)}>`
      );
      i++;
      continue;
    }

    // Horizontal rule
    if (/^(-{3,}|_{3,}|\*{3,})$/.test(trimmed)) {
      flushPara(para);
      blocks.push(`<hr style="border:0;border-top:1px solid #e5e7eb;margin:18px 0"/>`);
      i++;
      continue;
    }

    // Lists
    const isUl = /^[-*+]\s+/.test(trimmed);
    const isOl = /^\d+[.)]\s+/.test(trimmed);
    if (isUl || isOl) {
      flushPara(para);
      const items: string[] = [];
      while (i < lines.length) {
        const t = lines[i].trim();
        const m = isUl ? t.match(/^[-*+]\s+(.*)$/) : t.match(/^\d+[.)]\s+(.*)$/);
        if (!m) break;
        items.push(`<li style="margin:0 0 5px">${inline(m[1])}</li>`);
        i++;
      }
      const tag = isUl ? "ul" : "ol";
      blocks.push(
        `<${tag} style="margin:0 0 12px;padding-left:22px;font-size:14px;line-height:1.6;color:#1f2937;font-family:${SANS}">${items.join("")}</${tag}>`
      );
      continue;
    }

    para.push(trimmed);
    i++;
  }
  flushPara(para);

  // Trim on BLOCK boundaries — the old character-slice cut the forecast table
  // mid-row, which is where "…continued in the thread" landed.
  const kept: string[] = [];
  let used = 0;
  let truncated = false;
  for (const b of blocks) {
    if (used + b.length > HTML_BUDGET) { truncated = true; break; }
    kept.push(b);
    used += b.length;
  }

  return { html: kept.join("\n"), truncated, hasTable };
}
