/**
 * Slack emoji shortcodes, pasted as text, turned back into the emoji they were.
 *
 * ── THE INCIDENT ────────────────────────────────────────────────────────────
 *
 * 2026-09-28, thread 8479ea99. Chris pasted two colleagues' Slack status
 * updates into the composer and asked for his weekly summary. Slack writes
 * emoji onto the clipboard's text/plain as SHORTCODES, so the prompt that
 * went out read ":white_check_mark:" six times and ":x:" once where the
 * updates showed ✅ and ❌ — the difference between done and not done,
 * spelled in a code the reader has to decode.
 *
 * ── WHERE THE NAME COMES FROM ───────────────────────────────────────────────
 *
 * Slack's copy writes text/plain from the message's data-stringify-*
 * attributes, so an emoji arrives as its canonical short name. The text/html
 * flavour carries that same name in data-stringify-emoji, the code points in
 * the <img> src for a standard emoji, and an alt that is LOCALISED (":lächeln:"
 * for :smile: in a German workspace — WordPress/gutenberg#41464), so the alt
 * is never a source. A textarea only ever receives text/plain, and the name
 * in it is all the conversion needs; it is also what GitHub, a markdown file
 * and a Slack export write. The names are iamcal/emoji-data's short_names,
 * which are Slack's own.
 *
 * ── WHAT IS NOT A SHORTCODE ─────────────────────────────────────────────────
 *
 * Only a name the table knows converts. ":party-parrot:" is a workspace's
 * custom emoji — an image nothing outside Slack can draw — and stays as text.
 * And a known name converts only where Slack would have written one: at the
 * start of the text, after whitespace or "(", and followed by the end,
 * whitespace or closing punctuation. That boundary is what keeps "10:30:00",
 * "a:b:c", "std::x::y", a URL, a JSON value (":x:" after a quote) and a
 * Python slice ("a[:x:]") exactly as pasted; ":b:", ":x:", ":m:", ":100:" are
 * all real names, so a looser rule turns ordinary text into pictures. Code —
 * a `span` or a ``` fence — is never touched.
 *
 * Skin tones arrive as a second shortcode, ":+1::skin-tone-3:", and are
 * applied to the emoji before them when it takes one — to both people, when
 * it holds two. A tone after anything else becomes the swatch it names;
 * nothing is dropped. A two-tone form (":skin-tone-2-3:", if Slack writes
 * one) is not a name the table knows and stays as text.
 *
 * React-free and DOM-free: lib/emoji/paste.ts is the composer's door, and
 * scripts/verify-emoji-paste.ts drives THIS conversion on the stored message.
 */

export interface EmojiEntry {
  emoji: string;
  /** 0: takes no tone. 1: one person — the tone follows the first code point.
   *  2: two people in a ZWJ sequence — the tone follows the first AND the last. */
  tone: 0 | 1 | 2;
}

export type ShortcodeTable = Map<string, EmojiEntry>;

/**
 * The generated table (lib/emoji/shortcode-table.ts), one emoji per line:
 * its code points in hex joined by "-", a space, its names separated by
 * spaces, then " ~" when it takes one skin tone and " ~~" when both people
 * in it do.
 *
 * Hex rather than the emoji themselves because of what the minifier does
 * with them: it writes every non-ASCII character as a \u escape, twelve
 * bytes a code point. Measured on the built chunk, the literal table shipped
 * at 56.7KB (15.6KB gzip); in hex it is 43.9KB (14.6KB gzip) — 13KB less to
 * parse, 1KB less on the wire. The names are most of what is left.
 *
 * A Map, never an object literal: "__proto__" and "constructor" match the
 * name alphabet, and on a plain object ":constructor:" would find a function.
 */
export function parseShortcodeTable(raw: string): ShortcodeTable {
  const table: ShortcodeTable = new Map();
  const lines = raw.split("\n");
  for (let i = 0; i < lines.length; i++) {
    if (!lines[i]) continue;
    const parts = lines[i].split(" ");
    let end = parts.length;
    let tone: 0 | 1 | 2 = 0;
    if (parts[end - 1] === "~") { tone = 1; end--; }
    else if (parts[end - 1] === "~~") { tone = 2; end--; }
    const cps = parts[0].split("-");
    let emoji = "";
    for (let c = 0; c < cps.length; c++) emoji += String.fromCodePoint(parseInt(cps[c], 16));
    const entry: EmojiEntry = { emoji, tone };
    for (let j = 1; j < end; j++) table.set(parts[j], entry);
  }
  return table;
}

/**
 * The emoji with a skin-tone modifier applied. The modifier goes straight
 * after the person code point and REPLACES the variation selector there
 * (☝️ is 261D FE0F; with a tone it is 261D 1F3FC, not 261D FE0F 1F3FC).
 * scripts/gen-emoji-shortcodes.ts proves this against every skin variation
 * in emoji-data before it writes the table, so the rule and the data agree.
 */
export function applySkinTone(emoji: string, kind: 1 | 2, modifier: string): string {
  const cps = Array.from(emoji);
  const rest = cps[1] === "\uFE0F" ? 2 : 1;
  if (kind === 1) return cps[0] + modifier + cps.slice(rest).join("");
  const last = cps.length - 1;
  return cps[0] + modifier + cps.slice(rest, last).join("") + cps[last] + modifier;
}

/**
 * A run of shortcodes, ":a:" or ":a::b::c:", with the character before it.
 * Before: start of text, whitespace (NBSP included — Slack puts two after a
 * sender's name), or "(". After: end of text, whitespace, or ) . , ; ! ?
 * Deliberately NOT quotes, brackets, slashes or letters — see the header.
 */
const RUN = /(^|[\s(])((?::[a-z0-9_+\-]+:)+)(?=$|[\s).,;!?])/g;
const TONE = /^skin-tone-[2-6]$/;

/**
 * Cheap enough to run on every paste: is there anything that WOULD convert,
 * were its name known? Only then is the table worth loading, and only then
 * is a first paste held while it loads.
 *
 * It is RUN itself, boundary and all. It used to be any ":name:" anywhere,
 * and every timestamp is one — "00:01:23" holds ":01:" — so the first paste
 * of a meeting transcript, a caption file or a log was held, the table
 * loaded, and the whole text re-inserted unchanged: 17.5 seconds of frozen
 * tab for a 4,000-line transcript, measured, when nothing in it converts. A
 * gate as wide as the conversion cannot miss a conversion, and cannot hold a
 * paste the conversion would never touch.
 */
const CANDIDATE = new RegExp(RUN.source);
export function hasShortcodeCandidate(text: string): boolean {
  return CANDIDATE.test(text);
}

/** Code spans and fences, as [start, end) ranges. An unclosed fence runs to
 *  the end — a paste cut off mid-block is still code; an unclosed single
 *  backtick is just a backtick. */
function codeRanges(text: string): Array<[number, number]> {
  const out: Array<[number, number]> = [];
  let i = 0;
  while (i < text.length) {
    const tick = text.indexOf("`", i);
    if (tick < 0) break;
    if (text.slice(tick, tick + 3) === "```") {
      const close = text.indexOf("```", tick + 3);
      const end = close < 0 ? text.length : close + 3;
      out.push([tick, end]);
      i = end;
      continue;
    }
    const close = text.indexOf("`", tick + 1);
    const nl = text.indexOf("\n", tick + 1);
    if (close >= 0 && (nl < 0 || close < nl)) {
      out.push([tick, close + 1]);
      i = close + 1;
    } else {
      i = tick + 1;
    }
  }
  return out;
}

/** The whitespace-delimited word around [start, end) is a link. "(" is an
 *  allowed opener, and a URL can hold one. */
function insideLink(text: string, start: number, end: number): boolean {
  let a = start;
  while (a > 0 && !/\s/.test(text.charAt(a - 1))) a--;
  let b = end;
  while (b < text.length && !/\s/.test(text.charAt(b))) b++;
  const word = text.slice(a, b).toLowerCase();
  return word.indexOf("://") >= 0 || word.indexOf("www.") === 0 || word.indexOf("(www.") === 0 || word.indexOf("mailto:") >= 0;
}

/** One run's names, converted where known; unknown names stay as written. */
function convertRun(names: string[], table: ShortcodeTable): string {
  const pieces: string[] = [];
  let last: EmojiEntry | null = null;
  let toned = false;
  for (let i = 0; i < names.length; i++) {
    const name = names[i];
    const entry = table.get(name);
    if (entry && TONE.test(name) && last && last.tone !== 0 && !toned) {
      pieces[pieces.length - 1] = applySkinTone(last.emoji, last.tone, entry.emoji);
      toned = true;
      continue;
    }
    if (entry) {
      pieces.push(entry.emoji);
      last = entry;
    } else {
      pieces.push(":" + name + ":");
      last = null;
    }
    toned = false;
  }
  return pieces.join("");
}

/**
 * The text with every known shortcode replaced by its emoji and nothing else
 * changed. Returns the SAME string when nothing converted, so a caller can
 * tell "leave the paste alone" with ===.
 */
export function convertShortcodes(text: string, table: ShortcodeTable): string {
  if (!hasShortcodeCandidate(text)) return text;
  const code = codeRanges(text);
  let out = "";
  let from = 0;
  let changed = false;
  RUN.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = RUN.exec(text))) {
    const start = m.index + m[1].length;
    const end = start + m[2].length;
    let inCode = false;
    for (let k = 0; k < code.length; k++) {
      if (start >= code[k][0] && start < code[k][1]) { inCode = true; break; }
    }
    if (inCode || insideLink(text, start, end)) continue;
    const converted = convertRun(m[2].slice(1, -1).split("::"), table);
    if (converted === m[2]) continue;
    out += text.slice(from, start) + converted;
    from = end;
    changed = true;
  }
  return changed ? out + text.slice(from) : text;
}

// ── The table, loaded on the first paste that needs it ──────────────────────

let loaded: ShortcodeTable | null = null;
let loading: Promise<ShortcodeTable> | null = null;

/** The table if a paste has already loaded it — the synchronous path. */
export function loadedShortcodeTable(): ShortcodeTable | null {
  return loaded;
}

/**
 * The table, from its own chunk. ~2,000 names are not worth a byte on the
 * page's first load when nearly no paste contains one; the first paste that
 * does pays one small request, and every paste after it converts in place.
 * A failed load is forgotten so the next paste tries again.
 */
export function loadShortcodeTable(): Promise<ShortcodeTable> {
  if (loaded) return Promise.resolve(loaded);
  if (!loading) {
    loading = import("./shortcode-table").then(
      (mod) => (loaded = parseShortcodeTable(mod.SHORTCODE_TABLE)),
      (err) => { loading = null; throw err; },
    );
  }
  return loading;
}
