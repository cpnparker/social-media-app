/**
 * maybeSingle() must never be used on a lookup that can legitimately match
 * twice.
 *
 * PostgREST raises PGRST116 — "JSON object requested, multiple (or no) rows
 * returned" — as soon as two rows match. In an entity graph two matching rows
 * is not a corruption, it is a state: the same organisation arriving from
 * Engine and from a calendar, a duplicate edge from a re-run. So the lookups
 * whose whole job is to FIND and reconcile duplicates were the ones that broke
 * on them, and the backfill printed "lookup failed" while carrying on.
 *
 * The rule: maybeSingle() is fine after an insert (which returns exactly one
 * row) or after limit(1). Anywhere else it is a bug waiting for a duplicate.
 */
import { readFileSync } from "fs";

const FILES = [
  "lib/entities/record.ts",
  "lib/entities/resolve.ts",
  "lib/entities/capture.ts",
  "scripts/backfill-entity-graph.ts",
  "scripts/backfill-engagements.ts",
];

let failures = 0;
console.log("");
for (const f of FILES) {
  let src: string;
  try { src = readFileSync(f, "utf8"); } catch { console.log(`  skip  ${f} not present`); continue; }
  // Look backwards from each maybeSingle() for what justifies it.
  // Comments stripped first. The initial version flagged the comments EXPLAINING
  // why maybeSingle() was removed — a check that fails on its own documentation
  // teaches people to delete the documentation.
  const code = src
    .replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, " "))
    .replace(/(^|[^:])\/\/[^\n]*/g, (m, p1) => p1 + " ".repeat(Math.max(0, m.length - p1.length)));
  const lines = code.split("\n");
  let flagged = 0;
  for (let i = 0; i < lines.length; i++) {
    if (lines[i].indexOf("maybeSingle()") < 0) continue;
    // Sixteen lines back, not six: an insert payload is often a dozen lines of
    // object literal, so a window sized for a one-line query flags the safe
    // insert-then-select case as fragile.
    const window = lines.slice(Math.max(0, i - 16), i + 1).join(" ");
    const justified = /\.insert\(/.test(window) || /\.limit\(1\)/.test(window) || /\.upsert\(/.test(window);
    if (!justified) {
      failures++; flagged++;
      console.log(`  FAIL  ${f}:${i + 1} maybeSingle() on a lookup that could match twice`);
      console.log(`        ${lines[i].trim().slice(0, 90)}`);
    }
  }
  if (!flagged) console.log(`  ok    ${f}`);
}

console.log(failures
  ? `\n${failures} fragile lookup(s) — use .limit(1) and take the first row instead.\n`
  : `\nAll checks passed.\n`);
process.exit(failures ? 1 : 0);
