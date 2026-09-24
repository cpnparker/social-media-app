/**
 * Guards the studio's OWN words, not the model's.
 *
 * Run: npx tsx scripts/verify-optimizer-copy.ts --self-test
 *
 * ── WHY THIS EXISTS ─────────────────────────────────────────────────────────
 *
 * house-style.ts governs text this app asks a model to write FOR a piece. It
 * says nothing about the app's own interface copy, and that turned out to be
 * the half that reads worst: a panel heading said
 *
 *     "The published text, through the same rubric"
 *
 * which is a caption for a stock photograph, not a label on a working tool.
 * Reported by the owner, with the instruction to stop writing marketing
 * straplines and say the practical thing instead.
 *
 * ── WHAT IS CHECKABLE, AND WHAT IS NOT ──────────────────────────────────────
 *
 * "Write better headings" is not a check. Two things are:
 *
 *   THE APPOSITIVE STRAPLINE — a noun phrase, a comma or a dash, and a modifier
 *   that explains rather than instructs. That is the exact shape of the heading
 *   above, it is mechanical, and `isTagline` decides it. Kept narrow on purpose:
 *   a rule wide enough to catch every clumsy heading would flag ordinary ones,
 *   and a copy check that cries wolf is one nobody keeps.
 *
 *   THE STOCK PHRASES already listed for model output. There is no reason the
 *   ban on "delve into" and "unlock the power" should apply to a draft and not
 *   to the button above it.
 *
 * ── MUTATION LOG ────────────────────────────────────────────────────────────
 *
 * KILLED  the reported strapline restored as a heading                    → 2
 * KILLED  isTagline always answering no                                   → 1
 * KILLED  the heading extractor matching nothing (check 2's precondition)  → 2
 */
import { isTagline, houseStyleFlags } from "../lib/optimizer/house-style";
import { readFileSync, readdirSync } from "fs";
import { join } from "path";

const root = join(__dirname, "..");
const read = (p: string) => readFileSync(join(root, p), "utf8");

let failures = 0;
const fail = (m: string) => { failures++; console.log(`  ✗ ${m}`); };
const pass = (m: string) => console.log(`  ✓ ${m}`);
const assert = (ok: boolean, m: string) => (ok ? pass(m) : fail(m));

/**
 * The files whose copy a user reads.
 *
 * A directory listing rather than a hand-kept list, for the reason CLAUDE.md's
 * own check loop had to become a glob: a list of the things that catch drift is
 * itself a thing that drifts.
 */
const FILES = readdirSync(join(root, "components/optimizer"))
  .filter((f) => f.endsWith(".tsx"))
  .map((f) => `components/optimizer/${f}`);

/**
 * Headings, as rendered.
 *
 * Only headings: the strapline rule is about labels, and the same construction
 * inside a paragraph is ordinary English. Matched on the semibold/bold spans
 * and heading tags this codebase uses, with JSX's own line wrapping normalised
 * away — copy split across two source lines is one string on screen, and an
 * extractor that does not know that reads half a heading.
 */
export function headingsIn(src: string): string[] {
  const out: string[] = [];
  const re = /<(h1|h2|h3|span|p)\b[^>]*(?:font-semibold|font-bold|text-\[1[3-9])[^>]*>([^<>{}]+)</g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(src))) {
    const text = m[2].replace(/\s+/g, " ").trim();
    if (text.length >= 6 && /[a-z]/i.test(text)) out.push(text);
  }
  return out;
}

// ── 1. The reported heading, and its shape ─────────────────────────────────
console.log("\n1. The strapline shape");
{
  assert(isTagline("The published text, through the same rubric"), "the reported heading is caught");
  assert(isTagline("Writing that gets cited, built for engines"), "and so is another of the same shape");
  assert(isTagline("A better draft — written for retrieval"), "including the dash-joined form");

  // The half that decides whether anyone keeps it switched on.
  assert(!isTagline("How the live page scores"), "a plain label is not flagged");
  assert(!isTagline("What changed, and why"), "nor a heading whose comma joins two plain words");
  assert(!isTagline("What else would an engine ask?"), "nor a question, which instructs the reader");
  assert(!isTagline("Version history") && !isTagline("Before it ships") && !isTagline("Talk it through"),
    "nor the headings this studio already uses");
  assert(!isTagline("Sources, references and citations"), "nor an ordinary list in a heading");
}

// ── 2. No heading in the studio is one ─────────────────────────────────────
console.log("\n2. The studio's own headings");
{
  assert(FILES.length >= 8, `${FILES.length} optimiser components are read (a glob, so a new one is covered on the day it lands)`);

  let scanned = 0;
  const offenders: string[] = [];
  for (const f of FILES) {
    for (const h of headingsIn(read(f))) {
      scanned++;
      if (isTagline(h)) offenders.push(`${f.split("/").pop()}: "${h}"`);
    }
  }
  // The extractor's own precondition. Finding nothing because it matched
  // nothing would certify the whole studio while reading none of it.
  assert(scanned >= 20, `${scanned} headings were actually extracted and read`);
  assert(offenders.length === 0, offenders.length ? `straplines found — ${offenders.join("; ")}` : "no heading reads as a strapline");
}

// ── 3. And no stock phrasing anywhere a user reads ─────────────────────────
console.log("\n3. Stock phrasing in the interface");
{
  const hits: string[] = [];
  for (const f of FILES) {
    const src = read(f)
      // Comments are notes to whoever maintains this, not copy. They are
      // allowed to say "delve" if that is the accurate word.
      .replace(/\/\*[\s\S]*?\*\//g, " ")
      .replace(/^\s*\/\/.*$/gm, " ");
    const visible = (src.match(/>[^<>{}]{12,}</g) || []).join(" ").replace(/\s+/g, " ");
    const flags = houseStyleFlags(visible);
    for (const t of flags.tropes) hits.push(`${f.split("/").pop()}: ${t}`);
  }
  assert(hits.length === 0, hits.length ? `stock phrasing in the interface — ${hits.join("; ")}` : "no stock AI phrasing in any visible string");
}

// ── Self-test ──────────────────────────────────────────────────────────────
if (process.argv.includes("--self-test")) {
  console.log("\n── self-test: each detector against input that should trip it ──");
  let selfFail = 0;
  const must = (ok: boolean, what: string) => {
    if (ok) console.log(`  ✓ fires on ${what}`);
    else { selfFail++; console.log(`  ✗ SILENT on ${what}`); }
  };

  must(isTagline("The published text, through the same rubric"), "the reported strapline");
  must(!isTagline("How the live page scores"), "a plain heading being flagged (must stay clean)");
  must(headingsIn('<span className="text-[13.5px] font-semibold">A heading here</span>').length === 1,
    "the heading extractor finding a heading");
  must(headingsIn('<span className="text-[11px]">tiny caption</span>').length === 0,
    "the extractor picking up body text as a heading");
  must(houseStyleFlags("we delve into the detail").tropes.length > 0, "a stock phrase in interface copy");

  if (selfFail > 0) {
    console.log(`\n✗ ${selfFail} detector(s) silent — refusing to report the run above as meaningful.`);
    process.exit(1);
  }
  console.log("  all detectors fire");
}

console.log(failures === 0 ? "\n✓ the studio's own copy holds\n" : `\n✗ ${failures} failure(s)\n`);
process.exit(failures === 0 ? 0 : 1);
