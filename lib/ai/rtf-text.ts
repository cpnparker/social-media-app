/**
 * RTF, as the words in it.
 *
 * `application/rtf` sat on the upload allowlist and fell straight through the
 * extractor with everything else that was not a PDF, a .docx, a .pptx or
 * `text/*`. It is decodable, so putting it on the "known unreadable" list would
 * have been a convenient lie; twenty lines is cheaper than an exception.
 *
 * This is deliberately a STRIPPER, not a parser. It does not try to recover
 * bold, tables or lists, because nothing downstream would use them: the output
 * feeds a model that wants the words. What it does have to get right is not
 * emitting control words as if they were content — a naive brace-strip turns a
 * one-page letter into a paragraph of "pard plain f0 fs24 cf1", and a model
 * will summarise that as readily as it summarises English.
 */

/**
 * Groups whose whole point is that they are not content: font tables, colour
 * tables, stylesheets, revision info, and anything marked optional-destination
 * with `\*`.
 */
const SKIP_DESTINATIONS = /^(fonttbl|colortbl|stylesheet|info|pict|object|themedata|colorschememapping|latentstyles|datastore|generator|listtable|listoverridetable|xmlnstbl)\b/;

/** Control words that mean whitespace rather than formatting. */
const BREAKS: { [word: string]: string } = {
  par: "\n",
  line: "\n",
  page: "\n\n",
  sect: "\n\n",
  tab: "\t",
  cell: " | ",
  row: "\n",
  lquote: "‘", rquote: "’",
  ldblquote: "“", rdblquote: "”",
  emdash: "—", endash: "–",
  bullet: "•", nbsp: " ",
};

export function rtfToText(input: string): string {
  const s = String(input || "");
  if (!s) return "";

  let out = "";
  let depth = 0;
  // The brace depth at which we started skipping a non-content destination, or
  // -1 when we are not skipping. Nested groups inside it are skipped too.
  let skippingFrom = -1;
  let i = 0;

  while (i < s.length) {
    const ch = s[i];

    if (ch === "{") {
      depth++;
      i++;
      continue;
    }
    if (ch === "}") {
      if (skippingFrom >= 0 && depth === skippingFrom) skippingFrom = -1;
      depth--;
      i++;
      continue;
    }
    if (ch === "\\") {
      // An escaped literal: \\ \{ \} are the characters themselves.
      const next = s[i + 1];
      if (next === "\\" || next === "{" || next === "}") {
        if (skippingFrom < 0) out += next;
        i += 2;
        continue;
      }
      // \'hh is a byte in the current code page. Latin-1 is the overwhelmingly
      // common case and a wrong accent beats a dropped word.
      if (next === "'") {
        const hex = s.slice(i + 2, i + 4);
        if (/^[0-9a-f]{2}$/i.test(hex)) {
          if (skippingFrom < 0) out += String.fromCharCode(parseInt(hex, 16));
          i += 4;
          continue;
        }
      }
      // \*\destination — the group is explicitly optional, so skip it whole.
      if (next === "*") {
        if (skippingFrom < 0) skippingFrom = depth;
        i += 2;
        continue;
      }
      // A control word: letters, an optional signed number, then one optional
      // space which belongs to the word and is not content.
      const m = /^\\([a-z]+)(-?\d+)? ?/i.exec(s.slice(i));
      if (m) {
        const word = m[1].toLowerCase();
        if (skippingFrom < 0 && SKIP_DESTINATIONS.test(word)) {
          skippingFrom = depth;
        } else if (skippingFrom < 0) {
          if (word === "u" && m[2]) {
            // \uN is a Unicode code point, followed by a fallback character
            // that must not be emitted as well.
            out += String.fromCharCode(Number(m[2]) < 0 ? Number(m[2]) + 65536 : Number(m[2]));
            i += m[0].length;
            if (s[i] === "?") i++;
            continue;
          }
          if (BREAKS[word] !== undefined) out += BREAKS[word];
        }
        i += m[0].length;
        continue;
      }
      i++;
      continue;
    }

    if (skippingFrom < 0) out += ch;
    i++;
  }

  return out
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .replace(/[ \t]{2,}/g, " ")
    .trim();
}
