/**
 * Writes lib/emoji/shortcode-table.ts — Slack's emoji names and the emoji
 * each one is — from iamcal/emoji-data, the list Slack's names come from.
 *
 * Run (the data is not a dependency; the table is generated from it once):
 *
 *   npm pack emoji-datasource@16.0.0 --pack-destination <scratch>
 *   tar xzf <scratch>/emoji-datasource-16.0.0.tgz -C <scratch> package/emoji.json
 *   npx tsx scripts/gen-emoji-shortcodes.ts <scratch>/package/emoji.json
 *
 * emoji-datasource is MIT (Copyright (c) 2013 Cal Henderson); the notice is
 * written into the generated file's header, which the minifier strips, so it
 * costs the bundle nothing.
 *
 * WHY A GENERATED STRING AND NOT A PACKAGE. The runtime packages that carry
 * these names ship the whole of emoji-data — categories, sheet positions,
 * keywords, per-vendor flags — for a job that needs a name and a string. The
 * table here is one line per emoji and nothing else, loaded in its own chunk
 * on the first paste that holds a shortcode (lib/emoji/shortcodes.ts):
 * 43.9KB minified, 14.6KB gzip, 12.1KB brotli, and none of it on first load.
 *
 * WHAT THIS REFUSES TO WRITE. The skin-tone rule in lib/emoji/shortcodes.ts
 * (applySkinTone) is a rule, not a lookup, so before writing anything this
 * applies it to every emoji that takes a tone, in all five tones, and compares
 * the result with the variation emoji-data lists. One mismatch and nothing is
 * written. Likewise a name outside the alphabet the paste door matches, a
 * name that appears twice, or an emoji that would break the template literal.
 */
import { readFileSync, writeFileSync } from "fs";
import { createHash } from "crypto";
import { resolve } from "path";
import { applySkinTone } from "../lib/emoji/shortcodes";

interface Variation { unified: string }
interface Row {
  unified: string;
  short_names: string[];
  sort_order: number;
  skin_variations?: { [key: string]: Variation };
}

const TONES = ["1F3FB", "1F3FC", "1F3FD", "1F3FE", "1F3FF"];
const ROOT = resolve(__dirname, "..");
const OUT = resolve(ROOT, "lib/emoji/shortcode-table.ts");

function fromUnified(u: string): string {
  const parts = u.split("-");
  let s = "";
  for (let i = 0; i < parts.length; i++) s += String.fromCodePoint(parseInt(parts[i], 16));
  return s;
}

function main() {
  const src = process.argv[2];
  if (!src) {
    console.error("usage: npx tsx scripts/gen-emoji-shortcodes.ts <path to emoji-datasource's emoji.json>");
    process.exit(2);
  }
  const bytes = readFileSync(src);
  const sha = createHash("sha256").update(bytes).digest("hex");
  const pkgPath = resolve(src, "../package.json");
  let version = "unknown";
  try { version = JSON.parse(readFileSync(pkgPath, "utf8")).version; } catch { /* the version is a note, not a gate */ }
  const rows: Row[] = JSON.parse(bytes.toString("utf8"));
  rows.sort((a, b) => a.sort_order - b.sort_order);

  const problems: string[] = [];
  const seen = new Map<string, string>();
  const lines: string[] = [];
  let names = 0;
  let toned = 0;
  let variationsChecked = 0;

  for (let r = 0; r < rows.length; r++) {
    const row = rows[r];
    const emoji = fromUnified(row.unified);
    if (!/^[0-9A-F]{4,6}(-[0-9A-F]{4,6})*$/.test(row.unified)) problems.push(`${row.unified}: not a hex code point sequence`);
    for (let i = 0; i < row.short_names.length; i++) {
      const n = row.short_names[i];
      if (!/^[a-z0-9_+\-]+$/.test(n)) problems.push(`:${n}: is outside the alphabet the paste door matches`);
      if (seen.has(n)) problems.push(`:${n}: names both ${seen.get(n)} and ${row.unified}`);
      seen.set(n, row.unified);
      names++;
    }

    let kind: 0 | 1 | 2 = 0;
    const sv = row.skin_variations;
    if (sv) {
      // One-person emoji list a variation per tone ("1F3FB"); two-person ZWJ
      // sequences list every PAIR ("1F3FB-1F3FC"), and one Slack tone is the
      // pair with both the same.
      kind = sv[TONES[0]] ? 1 : sv[TONES[0] + "-" + TONES[0]] ? 2 : 0;
      if (kind === 0) problems.push(`${row.unified}: skin variations in neither shape`);
      for (let t = 0; t < TONES.length && kind !== 0; t++) {
        const want = sv[kind === 1 ? TONES[t] : TONES[t] + "-" + TONES[t]];
        const got = applySkinTone(emoji, kind, fromUnified(TONES[t]));
        variationsChecked++;
        if (!want || got !== fromUnified(want.unified)) {
          problems.push(`:${row.short_names[0]}: tone ${TONES[t]}: the rule gives ${Array.from(got).map((c) => c.codePointAt(0)!.toString(16)).join("-")}, emoji-data says ${want ? want.unified : "(none)"}`);
        }
      }
      if (kind !== 0) toned++;
    }
    lines.push(row.unified.toLowerCase() + " " + row.short_names.join(" ") + (kind === 1 ? " ~" : kind === 2 ? " ~~" : ""));
  }

  // The tone names are what the converter recognises as tones; they must be
  // the five Fitzpatrick modifiers, in order.
  for (let t = 0; t < TONES.length; t++) {
    const n = `skin-tone-${t + 2}`;
    if (seen.get(n) !== TONES[t]) problems.push(`:${n}: is ${seen.get(n) || "missing"}, expected ${TONES[t]}`);
  }

  // The table is a template literal: nothing in it may end or interpolate it.
  const joined = lines.join("\n");
  if (/[`\\]|\$\{/.test(joined)) problems.push("a line holds a backtick, a backslash or ${");

  if (problems.length) {
    console.error(`✗ ${problems.length} problem(s); nothing written:\n  ` + problems.slice(0, 40).join("\n  "));
    process.exit(1);
  }

  const licence = readFileSync(resolve(src, "../LICENSE"), "utf8").trim().split("\n").map((l) => (" * " + l).trimEnd()).join("\n");
  const body = `/**
 * GENERATED by scripts/gen-emoji-shortcodes.ts — do not edit by hand.
 *
 * Source: emoji-datasource@${version} (iamcal/emoji-data), emoji.json
 *         sha256 ${sha}
 * ${rows.length} emoji, ${names} names, ${toned} that take a skin tone
 * (${variationsChecked} tone variations checked against the data).
 *
 * One emoji per line: its code points in hex, its names, then " ~" when it
 * takes one skin tone or " ~~" when both people in it do. Parsed by
 * parseShortcodeTable in lib/emoji/shortcodes.ts, which loads this module in
 * its own chunk (why hex, and not the emoji: see that function).
 *
 * emoji-data is used under the MIT License:
 *
${licence}
 */
export const SHORTCODE_TABLE = \`
${joined}
\`;
`;
  writeFileSync(OUT, body);
  console.log(`✓ wrote ${OUT}\n  ${rows.length} emoji, ${names} names, ${toned} toned, ${variationsChecked} variations checked, ${Buffer.byteLength(body)} bytes`);
}

main();
