/**
 * A Slack paste arrives as the emoji it showed, and nothing else changes.
 *
 * Run: npx tsx scripts/verify-emoji-paste.ts
 *      npx tsx scripts/verify-emoji-paste.ts --self-test
 *      npx tsx scripts/verify-emoji-paste.ts --pull          (fixture === the stored message)
 *      npx tsx scripts/verify-emoji-paste.ts --data <emoji-datasource emoji.json>
 *      npx tsx scripts/verify-emoji-paste.ts --next          (after `next build`: the chunk split)
 *      npx tsx scripts/verify-emoji-paste.ts --screenshot <file.png>
 *
 * ── THE INCIDENT ────────────────────────────────────────────────────────────
 *
 * 2026-09-28, thread 8479ea99. Chris pasted two colleagues' Slack status
 * updates into the home composer — the thread's first message — and asked
 * for his weekly summary. Slack writes emoji onto text/plain as shortcodes,
 * so the stored prompt carries ":white_check_mark:" six times and ":x:" once
 * where Slack showed ✅ and ❌. scripts/fixtures/slack-paste-weekly-status.txt is that stored
 * message with its colleague and client names replaced; --pull re-reads the
 * original (READ-ONLY, PostgREST) and fails if its shortcodes or line count drift.
 *
 * ── WHAT IS DRIVEN, AND WHY IT IS THE REAL THING ────────────────────────────
 *
 *   1  the generated table through the real parser: every name it holds
 *      converts through the real door, the counts its header declares all
 *      arrive, and a set of names is pinned to code points written out in
 *      hex here, not read back from the table. With --data, EVERY name and
 *      every skin-tone variation in emoji-data is compared with what the
 *      converter produces.
 *   2  the stored message through convertShortcodes: every shortcode becomes
 *      its emoji, and substituting the shortcodes back gives the stored
 *      message byte for byte — so nothing else moved.
 *   3  the text that must NOT change — times, "a:b:c", URLs, code, JSON,
 *      custom emoji, names that are Object.prototype's — and the forms that
 *      must: chains, skin tones on one and two people, keycaps. Then the
 *      GATE, which decides what loads the table and which first paste is
 *      held while it loads: shortcode-shaped text with no Slack boundary —
 *      every timestamp is some — is not a candidate; everything that
 *      converts is.
 *   4  the REAL ChatInput, bundled from source and mounted in real Chrome,
 *      fed by TRUSTED pastes (a synthetic ClipboardEvent inserts nothing).
 *      What the box holds, where the caret is, what undo and redo do, and
 *      what the component SENDS — because a value in the DOM that never
 *      reached React's state is a paste the user sees and the model never
 *      gets. The table is loaded through the module's own dynamic import;
 *      that it stays unloaded until a candidate paste is asserted, and a
 *      FAILED load, a retry after one, and a SLOW load with the caret moved
 *      or text typed while it loads are injected at that one module
 *      boundary — it is where the network is. Which ROAD each paste took is
 *      recorded too — the browser's own paste, insertHTML, insertText, or
 *      the setRangeText fallback — and how long the tab was held from the
 *      keypress: a paste over a selection that already holds its result
 *      goes in once; a 2,000-line transcript is the browser's own paste; a
 *      2,100-line Slack paste that converts is in within 250ms on both the
 *      first and later pastes; and the insertText road (an engine without
 *      insertHTML, made by refusing it) keeps typing and paste apart in
 *      undo and never takes a long paste.
 *   5  the wiring. The home composer is inside app/engineai/page.tsx, which
 *      cannot be mounted here, so its textarea is read from the SYNTAX TREE:
 *      its onPaste must be exactly the imported handler, bound by an import
 *      from lib/emoji/paste and not shadowed, and its onChange must write
 *      the event's value to the state it shows — the handler's edit reaches
 *      React only through that.
 *   6  --next reads the build output: the table is in exactly one chunk, no
 *      chunk a chat page loads up front holds it, and the door itself did
 *      ship with the page.
 *
 * Needs Chrome (CHROME_EXECUTABLE_PATH, or the default macOS path) and fails
 * rather than skipping without it: not looking and finding nothing are
 * different claims. Headless Chrome has its own clipboard; the machine's is
 * never touched.
 *
 * MUTATION LOG — run in a throwaway copy of the tree (never the shared one,
 * which deploys); each mutation asserted to have CHANGED the file, the file
 * restored and compared byte-for-byte after. Kills AND survivors.
 *
 * Round 1 (2026-09-28, first version of this check): 34 mutations, 28
 * KILLED, 5 SURVIVED, one not applied — the variation selector in
 * shortcodes.ts had been written as the invisible character itself, so the
 * mutation's text never matched. It is now the escape "\uFE0F". The
 * survivors, and what they said about the check:
 *
 *   failed chunk load remembered (no retry)       every load in the harness
 *     was one esbuild init, so a retry could not happen. The chunk boundary
 *     is now a thenable the page answers per import() → KILLED
 *   async path does not restore the aimed caret   nothing moved the caret
 *     during the load. A slow chunk now does (case G)                → KILLED
 *   typing group not closed BEFORE the insert     the paste helper sets the
 *     selection before every paste, which closes the group by itself.
 *     Case F types and pastes with nothing between — still SURVIVED, see
 *     round 2
 *   CRLF not normalised                           see round 2
 *   a no-op run re-emitted unchanged              see round 2
 *
 * Round 2 (2026-09-28), against the round-2 code (insertText door, loose
 * gate; baseline, unmutated: exit 0). 37 mutations, 34 KILLED, 3 SURVIVED:
 *
 *   the conversion (lib/emoji/shortcodes.ts)
 *     prefix boundary widened to any character                      → KILLED
 *     suffix boundary removed                                       → KILLED
 *     code spans not skipped                                        → KILLED
 *     links not skipped                                             → KILLED
 *     unknown names dropped instead of kept                         → KILLED
 *     tone keeps the variation selector (☝️ + tone)                 → KILLED
 *     two-person tone applied to the first person only              → KILLED
 *     tones never applied                                           → KILLED
 *     candidate gate always false                                   → KILLED
 *     candidate gate always true (table loads on every paste)       → KILLED
 *     failed load remembered, never retried                         → KILLED
 *     parser keeps only each emoji's first name                     → KILLED
 *     lookup through a plain object (":constructor:")               → KILLED
 *   the table (lib/emoji/shortcode-table.ts, hand-edited)
 *     white_check_mark mapped to U+2714                             → KILLED
 *     the thumbsup alias dropped                                    → KILLED
 *     +1 loses its tone marker                                      → KILLED
 *   the door (lib/emoji/paste.ts)
 *     setRangeText only, no insertText (no undo)                    → KILLED
 *     typing group never closed                                     → KILLED
 *     typing group not closed AFTER the insert                      → KILLED
 *     async path does not restore the aimed selection               → KILLED
 *     async path restores it even after the box changed             → KILLED
 *     async path inserts at the end of the box                      → KILLED
 *     async path drops the paste when the chunk fails               → KILLED
 *     sync path prevents even when nothing converted                → KILLED
 *     fallback fires no input event (React never hears)             → KILLED
 *     fallback removed                                              → KILLED
 *   the wiring
 *     ChatInput's onPaste removed                                   → KILLED
 *     home composer's onPaste removed / a no-op                     → KILLED ×2
 *     home composer's handler shadowed by a local                   → KILLED
 *     home composer's handler an aliased import from elsewhere      → KILLED
 *     home composer's onChange ignores the event                    → KILLED
 *   the build (--next, after `next build`)
 *     the table imported statically                                 → KILLED
 *       (54KB gzip in a chunk all three chat pages load up front; the
 *        harness's slow and failing chunk cases fail with it)
 *   the generator
 *     applySkinTone keeps the variation selector → the generator refuses,
 *       85 problems, nothing written                                → KILLED
 *
 *   SURVIVED — typing group not closed BEFORE the insert. Measured in a bare
 *     textarea it is what keeps typed-then-pasted apart: without it, "abc"
 *     typed then pasted then undone came back EMPTY. In the composer, React
 *     writes defaultValue after every keystroke, and that write closes the
 *     group already — measured by adding the same write to the bare
 *     textarea: undo then steps back a character at a time. Kept, because
 *     the door is not React's and React's reason for that write is not ours.
 *   SURVIVED — CRLF not normalised. Chrome's insertText and setRangeText both
 *     normalise line breaks in a textarea themselves (case C and case D
 *     assert the result on both paths). Kept for the engines this check
 *     cannot drive.
 *   SURVIVED — a run that converted to itself is re-emitted rather than
 *     skipped. Equivalent: the output is the same string either way, and
 *     === compares strings by value.
 *
 * Round 3 (2026-09-28), after review found two defects this check was
 * green over. (1) A converted paste over a selection that already held its
 * result went in TWICE: the insert was judged by whether the box changed,
 * an identical replacement does not change it, and the fallback added the
 * paste again — nothing here pasted over identical text (case H now does).
 * (2) Long pastes froze the tab: insertText's cost grows with the square
 * of its lines, and the gate took every timestamp for a shortcode, so even
 * a transcript that converted nothing was held and re-inserted — nothing
 * here pasted more than 1,332 characters (cases I, J and K now paste 2,000+
 * lines and time it). The door now inserts through insertHTML, judges by
 * what the box holds, and the gate is the conversion's own pattern.
 * 42 mutations — the round-2 set re-run against the new door (32) and 10
 * new ones; 39 KILLED, 3 SURVIVED:
 *
 *   the conversion and the table — the 16 of round 2             → KILLED
 *     NEW the gate back to any ":name:" anywhere                  → KILLED
 *       (the transcript is held and the table loaded; through insertHTML
 *        it no longer freezes — 25ms — which is why case I asserts the
 *        road and the table, not the time)
 *   the door
 *     NEW success judged by whether the box CHANGED (round 2's test) → KILLED
 *       (the select-all re-paste went in twice, and ❌ over ❌ gave ❌❌)
 *     NEW round 2's road: insertText only, no line limit          → KILLED
 *       (3,518ms from keypress to edit for the 2,117-line paste; budget 250)
 *     NEW insertHTML not tried                                    → KILLED
 *     NEW no line limit on insertText (an engine without insertHTML)
 *       → 3,486ms                                                 → KILLED
 *     NEW the markup not escaped                                  → KILLED
 *     NEW caret not set after the insert                          → KILLED
 *       (before a trailing newline; and on the insertText road the
 *        keystroke after the held paste merged into it)
 *     NEW typing group never closed on either side                → KILLED
 *     NEW a wrong edit handled like a refusal (paste added to it) → KILLED
 *     the async aim not restored / restored after the box changed /
 *       the end of the box / the paste dropped on a failed chunk; the
 *       sync path preventing on nothing; the fallback's input event;
 *       the fallback removed — the 7 of round 2                   → KILLED
 *     CRLF not normalised — SURVIVED in round 2                   → KILLED
 *       (the text no longer matches what the box holds, so the insert
 *        falls to the undo-losing repair; case C now asserts the road)
 *   the wiring — the 6 of round 2                                 → KILLED
 *
 *   SURVIVED — a run that converted to itself re-emitted. Equivalent, as in
 *     round 2.
 *   SURVIVED — typing group not closed BEFORE the insert. As in round 2:
 *     React's per-keystroke defaultValue write closes it already, on both
 *     roads. The after-close is not masked for the HELD paste, which case K
 *     drives on the insertText road.
 *   SURVIVED — no stop after a wrong edit: the next command is tried on top
 *     of it. The box ends right either way, because the repair writes the
 *     WHOLE expected value; the stop only saves a wasted command and an
 *     input event carrying wrong text. Kept for that.
 *
 * Not re-run this round: the --next static-import mutation and the
 * generator's (round 2, both KILLED); neither file changed.
 */
import { readFileSync, existsSync, readdirSync, statSync, writeFileSync, mkdtempSync, rmSync } from "fs";
import { join, relative } from "path";
import { tmpdir } from "os";
import { execFileSync } from "child_process";
import { gzipSync, brotliCompressSync } from "zlib";
import * as ts from "typescript";
import {
  parseShortcodeTable,
  convertShortcodes,
  hasShortcodeCandidate,
  type ShortcodeTable,
} from "../lib/emoji/shortcodes";
import { SHORTCODE_TABLE } from "../lib/emoji/shortcode-table";

const ROOT = join(__dirname, "..");
const FIXTURE = join(ROOT, "scripts/fixtures/slack-paste-weekly-status.txt");
const THREAD = "8479ea99-7245-46d0-b6e5-4082adbfc7e0";

let failures = 0;
function assert(ok: boolean, label: string, detail?: string): void {
  if (ok) console.log(`  ✓ ${label}`);
  else {
    failures++;
    console.log(`  ✗ ${label}${detail ? `\n      ${detail}` : ""}`);
  }
}

function hex(s: string): string {
  return Array.from(s).map((c) => c.codePointAt(0)!.toString(16).toUpperCase()).join("-");
}
function fromHex(u: string): string {
  const p = u.split("-");
  let s = "";
  for (let i = 0; i < p.length; i++) s += String.fromCodePoint(parseInt(p[i], 16));
  return s;
}
function count(hay: string, needle: string): number {
  let n = 0;
  for (let i = hay.indexOf(needle); i >= 0; i = hay.indexOf(needle, i + needle.length)) n++;
  return n;
}
/** A meeting transcript the way one is pasted: every line opens with a
 *  timestamp, and every timestamp holds a shortcode-shaped ":01:". */
function transcript(lines: number): string {
  const speakers = ["Chris", "Alex", "Sam"];
  const out: string[] = [];
  for (let i = 0; i < lines; i++) {
    const t = i * 7;
    const two = (n: number) => (n < 10 ? "0" : "") + n;
    out.push(`${two(Math.floor(t / 3600))}:${two(Math.floor(t / 60) % 60)}:${two(t % 60)} ${speakers[i % 3]}: so the next thing on the list is the deck and the proposal`);
  }
  return out.join("\n");
}
function arg(name: string): string | null {
  const i = process.argv.indexOf(name);
  return i >= 0 && i + 1 < process.argv.length ? process.argv[i + 1] : null;
}
const flag = (name: string) => process.argv.indexOf(name) >= 0;

// ── Pinned by hand, from the Unicode charts — not read back from the table ──

const PINNED: Array<[string, string]> = [
  ["white_check_mark", "2705"], ["x", "274C"], ["+1", "1F44D"], ["thumbsup", "1F44D"],
  ["-1", "1F44E"], ["heavy_check_mark", "2714-FE0F"], ["100", "1F4AF"], ["tada", "1F389"],
  ["eyes", "1F440"], ["rocket", "1F680"], ["warning", "26A0-FE0F"], ["point_up", "261D-FE0F"],
  ["hash", "0023-FE0F-20E3"], ["zero", "0030-FE0F-20E3"], ["flag-ch", "1F1E8-1F1ED"],
  ["people_holding_hands", "1F9D1-200D-1F91D-200D-1F9D1"],
  ["skin-tone-2", "1F3FB"], ["skin-tone-3", "1F3FC"], ["skin-tone-4", "1F3FD"],
  ["skin-tone-5", "1F3FE"], ["skin-tone-6", "1F3FF"],
];

/** input → expected output. Every one of these is a CHANGE. */
const CONVERTS: Array<[string, string]> = [
  [":white_check_mark:", "\u2705"],
  ["done :x:", "done \u274C"],
  [":+1: and :-1:", "\uD83D\uDC4D and \uD83D\uDC4E"],
  [":white_check_mark::x:", "\u2705\u274C"],
  [":x::party-parrot:", "\u274C:party-parrot:"],
  [":party-parrot::x:", ":party-parrot:\u274C"],
  ["(:x: delayed)", "(\u274C delayed)"],
  ["(:x:)", "(\u274C)"],
  ["shipped :tada:!", "shipped \uD83C\uDF89!"],
  ["line one :x:\nline two :white_check_mark:", "line one \u274C\nline two \u2705"],
  ["Wed\u00A0:x:", "Wed\u00A0\u274C"],
  [":thumbsup::skin-tone-2:", fromHex("1F44D-1F3FB")],
  [":+1::skin-tone-6:", fromHex("1F44D-1F3FF")],
  // The variation selector is REPLACED by the tone, not kept before it.
  [":point_up::skin-tone-3:", fromHex("261D-1F3FC")],
  // A ZWJ sequence: the tone follows the person, not the end.
  [":man-raising-hand::skin-tone-4:", fromHex("1F64B-1F3FD-200D-2642-FE0F")],
  // Two people: both take it.
  [":people_holding_hands::skin-tone-5:", fromHex("1F9D1-1F3FE-200D-1F91D-200D-1F9D1-1F3FE")],
  [":handshake::skin-tone-6:", fromHex("1F91D-1F3FF")],
  // A tone after an emoji that takes none stays the swatch — what Slack draws.
  [":smile::skin-tone-2:", fromHex("1F604-1F3FB")],
  // A second tone is its own swatch.
  [":+1::skin-tone-2::skin-tone-3:", fromHex("1F44D-1F3FB-1F3FC")],
  [":hash: :zero:", fromHex("0023-FE0F-20E3") + " " + fromHex("0030-FE0F-20E3")],
  [":100:", fromHex("1F4AF")],
  ["`code` then :x:", "`code` then \u274C"],
];

/** Every one of these must come back EXACTLY as given. */
const UNTOUCHED: string[] = [
  "10:30:00",
  "at 10:30: we start",
  "a:b:c",
  "ratio 1:1:1",
  "std::x::y",
  "fe80::a:b:",
  "[9:36 AM]",
  "https://example.com/:smile:/x",
  "see https://example.com/a(:x:) for it",
  "www.example.com/(:x:)",
  "mailto:(:x:)",
  "C:\\Users\\x:y:",
  "`:x:`",
  "run `echo :white_check_mark:` first",
  "```\n:x: in a fence\n```",
  "```\nan unclosed fence :x:",
  "{\"emoji\":\":x:\"}",
  "\":white_check_mark:\"",
  "a[:x:]",
  "arr[::2]",
  ":party-parrot:",
  ":constructor:",
  ":__proto__:",
  ":tostring:",
  ":X:",
  ":White_Check_Mark:",
  ":x:s",
  "done:x:",
  ":x:/:x:",
  ":skin-tone-2-3:",
  "| :---: | :--- |",
  ":-) :) ;-)",
  "::",
  ":::",
  "",
];

/** Shortcode-SHAPED, and never where Slack writes a shortcode. None of these
 *  may load the table, and none may hold a first paste while it loads. */
const NOT_CANDIDATES: string[] = [
  "00:01:23 Alex: so the next thing",
  "WEBVTT\n\n00:00:01.000 --> 00:00:04.000\nhello",
  "2026-09-28T10:30:00Z INFO job:run:done",
  "10:30:00",
  "at 10:30: we start",
  "a:b:c",
  "std::x::y",
  "fe80::a:b:",
  "https://example.com/:smile:/x",
  "`:x:`",
  "{\"emoji\":\":x:\"}",
  "a[:x:]",
  "done:x:",
  ":x:s",
  ":x:/:x:",
];

type Convert = (s: string) => string;

/** Sections 2 and 3, against any converter — the real one, or --self-test's
 *  deliberately wrong ones, which these assertions must reject. */
function pureChecks(convert: Convert, fixture: string, report: boolean): number {
  let bad = 0;
  const check = (ok: boolean, label: string, detail?: string) => {
    if (!ok) bad++;
    if (report) assert(ok, label, detail);
  };

  // 2 — the stored message.
  const out = convert(fixture);
  check(count(out, "\u2705") === 6 && count(out, "\u274C") === 1,
    "the stored message: six ✅ and one ❌ where it held six :white_check_mark: and one :x:",
    `✅ ${count(out, "\u2705")}, ❌ ${count(out, "\u274C")}`);
  check(!/:[a-z0-9_+\-]+:/.test(out), "no shortcode is left in it", (out.match(/:[a-z0-9_+\-]+:/g) || []).join(" "));
  const back = out.split("\u2705").join(":white_check_mark:").split("\u274C").join(":x:");
  check(back === fixture, "and putting the shortcodes back gives the stored message byte for byte — nothing else changed",
    back === fixture ? "" : `first difference at ${firstDiff(back, fixture)}`);
  check(out.indexOf("[9:36 AM]") >= 0 && out.indexOf("[10:12 AM]") >= 0 && out.indexOf("Alex\u00A0\u00A0[") >= 0,
    "the timestamps and the NBSPs Slack writes after a name are untouched");

  // 3 — what must change, and what must not.
  if (report) console.log("\n3. What must change, and what must not");
  let wrong: string[] = [];
  for (let i = 0; i < CONVERTS.length; i++) {
    const got = convert(CONVERTS[i][0]);
    if (got !== CONVERTS[i][1]) wrong.push(`${JSON.stringify(CONVERTS[i][0])} → ${hex(got)} (want ${hex(CONVERTS[i][1])})`);
  }
  check(wrong.length === 0, `${CONVERTS.length} forms convert exactly: chains, a custom neighbour, "(", NBSP, tones on one and two people, keycaps`, wrong.join("\n      "));
  wrong = [];
  for (let i = 0; i < UNTOUCHED.length; i++) {
    const got = convert(UNTOUCHED[i]);
    if (got !== UNTOUCHED[i]) wrong.push(`${JSON.stringify(UNTOUCHED[i])} → ${JSON.stringify(got)}`);
  }
  check(wrong.length === 0, `${UNTOUCHED.length} texts come back exactly: times, "a:b:c", URLs, code, JSON, slices, custom and prototype names, uppercase, glued words`, wrong.join("\n      "));
  return bad;
}

/** 3b — the gate. It decides which pastes load the table and which FIRST
 *  paste is held while it loads; held, a paste is re-inserted whole. */
function gateChecks(): void {
  console.log("\n3b. The gate: what loads the table and holds a first paste");
  const unshaped: string[] = [];
  const held: string[] = [];
  for (let i = 0; i < NOT_CANDIDATES.length; i++) {
    if (!/:[a-z0-9_+\-]+:/.test(NOT_CANDIDATES[i])) unshaped.push(NOT_CANDIDATES[i]);
    if (hasShortcodeCandidate(NOT_CANDIDATES[i])) held.push(NOT_CANDIDATES[i]);
  }
  const t = transcript(2000);
  assert(unshaped.length === 0, `PRECONDITION: all ${NOT_CANDIDATES.length} fixtures hold a shortcode-SHAPED run`, unshaped.join(" | "));
  assert(held.length === 0 && !hasShortcodeCandidate(t),
    `none of them is a candidate, and nor is a 2,000-line timestamped transcript: times, captions, logs, words, URLs, code and JSON never load the table or hold a paste`,
    held.map((x) => JSON.stringify(x)).join(" | ") + (hasShortcodeCandidate(t) ? " | the transcript" : ""));
  const missed: string[] = [];
  for (let i = 0; i < CONVERTS.length; i++) if (!hasShortcodeCandidate(CONVERTS[i][0])) missed.push(CONVERTS[i][0]);
  assert(missed.length === 0 && hasShortcodeCandidate(readFileSync(FIXTURE, "utf8")), "and every form that converts, and the stored message, IS one", missed.join(" | "));
}

function firstDiff(a: string, b: string): string {
  let i = 0;
  while (i < a.length && i < b.length && a[i] === b[i]) i++;
  return `${i}: ${JSON.stringify(a.slice(i, i + 30))} vs ${JSON.stringify(b.slice(i, i + 30))}`;
}

// ── 1. The table ─────────────────────────────────────────────────────────────

function tableChecks(table: ShortcodeTable): void {
  console.log("\n1. The generated table, through the real parser and the real door");
  // The counts are in the generated file's header comment, written by the
  // generator from the data — not in the string the parser reads.
  const header = /(\d+) emoji, (\d+) names, (\d+) that take a skin tone/.exec(readFileSync(join(ROOT, "lib/emoji/shortcode-table.ts"), "utf8"));
  assert(!!header, "the table's header declares its counts");
  if (!header) return;
  const names: string[] = [];
  table.forEach((_v, k) => { names.push(k); });
  const emoji = new Set<string>();
  let toned = 0;
  const seenEntry = new Set<object>();
  table.forEach((v) => {
    emoji.add(v.emoji);
    if (!seenEntry.has(v)) { seenEntry.add(v); if (v.tone) toned++; }
  });
  assert(names.length === Number(header[2]), `all ${header[2]} names arrive through parseShortcodeTable`, `${names.length} arrived`);
  assert(emoji.size === Number(header[1]), `for ${header[1]} distinct emoji`, `${emoji.size}`);
  assert(toned === Number(header[3]), `${header[3]} of them take a skin tone`, `${toned}`);

  const refused: string[] = [];
  for (let i = 0; i < names.length; i++) {
    const got = convertShortcodes(":" + names[i] + ":", table);
    if (got !== table.get(names[i])!.emoji) refused.push(":" + names[i] + ":");
  }
  assert(refused.length === 0, `every name the table holds converts through convertShortcodes on its own`, refused.slice(0, 20).join(" "));

  const off: string[] = [];
  for (let i = 0; i < PINNED.length; i++) {
    const got = convertShortcodes(":" + PINNED[i][0] + ":", table);
    if (got !== fromHex(PINNED[i][1])) off.push(`:${PINNED[i][0]}: → ${hex(got)} (want ${PINNED[i][1]})`);
  }
  assert(off.length === 0, `${PINNED.length} names pinned to code points written out here`, off.join("\n      "));

  const data = arg("--data");
  if (data) {
    const rows: any[] = JSON.parse(readFileSync(data, "utf8"));
    const T = ["1F3FB", "1F3FC", "1F3FD", "1F3FE", "1F3FF"];
    const bad: string[] = [];
    const dataNames = new Set<string>();
    let n = 0, v = 0;
    for (let r = 0; r < rows.length; r++) {
      const row = rows[r];
      for (let i = 0; i < row.short_names.length; i++) {
        const name = row.short_names[i];
        dataNames.add(name);
        n++;
        const got = convertShortcodes(":" + name + ":", table);
        if (got !== fromHex(row.unified)) bad.push(`:${name}: → ${hex(got)} (emoji-data ${row.unified})`);
        const sv = row.skin_variations;
        if (!sv) continue;
        for (let t = 0; t < T.length; t++) {
          const want = sv[T[t]] || sv[T[t] + "-" + T[t]];
          const toned = convertShortcodes(`:${name}::skin-tone-${t + 2}:`, table);
          v++;
          if (!want || toned !== fromHex(want.unified)) bad.push(`:${name}::skin-tone-${t + 2}: → ${hex(toned)} (emoji-data ${want ? want.unified : "none"})`);
        }
      }
    }
    const extra: string[] = [];
    for (let i = 0; i < names.length; i++) if (!dataNames.has(names[i])) extra.push(names[i]);
    assert(bad.length === 0, `--data: all ${n} names and ${v} named skin-tone forms convert to exactly what emoji-data lists`, bad.slice(0, 20).join("\n      "));
    assert(extra.length === 0, "--data: the table holds no name emoji-data does not", extra.slice(0, 20).join(" "));
  }
}

// ── 5. Wiring, from the syntax tree ──────────────────────────────────────────

interface Wiring { onPaste: string | null; importedFrom: string | null; aliased: boolean; shadowed: boolean; onChangeWrites: string | null; count: number }

function textareaWiring(file: string, valueName: string): Wiring {
  const src = readFileSync(join(ROOT, file), "utf8");
  const sf = ts.createSourceFile(file, src, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const res: Wiring = { onPaste: null, importedFrom: null, aliased: false, shadowed: false, onChangeWrites: null, count: 0 };
  let localDecls = 0;
  const attr = (attrs: ts.JsxAttributes, name: string): ts.Expression | null => {
    for (let i = 0; i < attrs.properties.length; i++) {
      const p = attrs.properties[i];
      if (ts.isJsxAttribute(p) && p.name.getText(sf) === name && p.initializer && ts.isJsxExpression(p.initializer) && p.initializer.expression) {
        return p.initializer.expression;
      }
    }
    return null;
  };
  const visit = (n: ts.Node) => {
    if (ts.isImportDeclaration(n) && n.importClause && n.importClause.namedBindings && ts.isNamedImports(n.importClause.namedBindings)) {
      const els = n.importClause.namedBindings.elements;
      for (let i = 0; i < els.length; i++) {
        if (els[i].name.text === "pasteShortcodesAsEmoji") {
          res.importedFrom = (n.moduleSpecifier as ts.StringLiteral).text;
          res.aliased = !!els[i].propertyName && els[i].propertyName!.getText(sf) !== "pasteShortcodesAsEmoji";
        }
      }
    }
    if ((ts.isVariableDeclaration(n) || ts.isFunctionDeclaration(n) || ts.isParameter(n)) && n.name && ts.isIdentifier(n.name) && n.name.text === "pasteShortcodesAsEmoji") localDecls++;
    if ((ts.isJsxSelfClosingElement(n) || ts.isJsxOpeningElement(n)) && n.tagName.getText(sf) === "textarea") {
      const v = attr(n.attributes, "value");
      if (v && ts.isIdentifier(v) && v.text === valueName) {
        res.count++;
        const p = attr(n.attributes, "onPaste");
        res.onPaste = p ? p.getText(sf) : null;
        const c = attr(n.attributes, "onChange");
        // (e) => setX(e.target.value), and nothing else.
        if (c && ts.isArrowFunction(c) && c.parameters.length === 1 && ts.isCallExpression(c.body) && c.body.arguments.length === 1) {
          const param = c.parameters[0].name.getText(sf);
          if (c.body.arguments[0].getText(sf).replace(/\s/g, "") === `${param}.target.value`) res.onChangeWrites = c.body.expression.getText(sf);
        }
      }
    }
    ts.forEachChild(n, visit);
  };
  visit(sf);
  res.shadowed = localDecls > 0;
  return res;
}

function wiringChecks(): void {
  console.log("\n5. The wiring, read from the syntax tree");
  const sites: Array<[string, string, string, string]> = [
    ["app/engineai/page.tsx", "homeInput", "setHomeInput", "the home composer — where a conversation, and the incident, begins"],
    ["components/ai-writer/ChatInput.tsx", "value", "setValue", "the chat composer (also mounted for real in 4)"],
  ];
  for (let i = 0; i < sites.length; i++) {
    const [file, valueName, setter, what] = sites[i];
    const w = textareaWiring(file, valueName);
    assert(w.count === 1, `${file}: exactly one textarea shows ${valueName}`, `${w.count}`);
    assert(w.onPaste === "pasteShortcodesAsEmoji", `${what}: its onPaste IS pasteShortcodesAsEmoji`, `onPaste={${w.onPaste}}`);
    assert(w.importedFrom === "@/lib/emoji/paste" && !w.aliased && !w.shadowed,
      `…bound by the import from @/lib/emoji/paste, not aliased, not shadowed`, JSON.stringify(w));
    assert(w.onChangeWrites === setter, `…and its onChange writes the event's value to ${setter}, so the handler's edit reaches the state that is sent`, `${w.onChangeWrites}`);
  }
}

// ── 4. The real ChatInput in Chrome ──────────────────────────────────────────

const ENTRY = `
import React from "react";
import { createRoot } from "react-dom/client";
import ChatInput from "@/components/ai-writer/ChatInput";
import { loadedShortcodeTable } from "@/lib/emoji/shortcodes";
const w = window as any;
w.__sent = [];
w.__tableLoaded = () => loadedShortcodeTable() !== null;
w.__mount = () => createRoot(document.getElementById("root")!).render(
  <ChatInput onSend={(c: string) => { w.__sent.push(c); }} placeholder="Type your message..." />
);
`;

async function bundle(): Promise<string> {
  const esbuild: any = await import("esbuild");
  const res = await esbuild.build({
    stdin: { contents: ENTRY, resolveDir: ROOT, loader: "tsx", sourcefile: "verify-emoji-entry.tsx" },
    bundle: true, write: false, format: "iife", jsx: "automatic", logLevel: "silent",
    define: { "process.env.NODE_ENV": '"production"' },
    plugins: [{
      name: "repo",
      setup(b: any) {
        // The table's chunk, and nothing else, is interposed — it is where
        // the network is. import() adopts a namespace that has a then(), so
        // each load asks the page: __failTable makes it FAIL the way a chunk
        // request fails on a flaky network, __delayTable makes it SLOW, and
        // each import() asks afresh, so a retry after a failure is real.
        // Everything else is the repository's own code.
        b.onResolve({ filter: /^\.\/shortcode-table$/ }, () => ({ path: "table", namespace: "chunk" }));
        b.onLoad({ filter: /.*/, namespace: "chunk" }, () => ({
          loader: "ts", resolveDir: ROOT,
          contents: `import { SHORTCODE_TABLE as T } from "./lib/emoji/shortcode-table";
            export function then(resolve: (ns: unknown) => void, reject: (e: Error) => void) {
              const w = window as any;
              w.__tableLoads = (w.__tableLoads || 0) + 1;
              const ns = { SHORTCODE_TABLE: T };
              if (w.__failTable) reject(new Error("the chunk did not load"));
              else if (w.__delayTable) setTimeout(() => resolve(ns), w.__delayTable);
              else resolve(ns);
            }
            export const SHORTCODE_TABLE = T;`,
        }));
        b.onResolve({ filter: /^@\// }, async (a: any) => {
          const r = await b.resolve("./" + a.path.slice(2), { resolveDir: ROOT, kind: a.kind });
          return { path: r.path };
        });
      },
    }],
  });
  return res.outputFiles[0].text;
}

const HARNESS = (css: string) => `<!doctype html><html><head><meta charset="utf-8"><style>${css}</style></head>
<body class="bg-background text-foreground">
<div id="src" contenteditable="true" style="position:absolute;left:-9999px">copy source</div>
<textarea id="probe" style="position:absolute;left:-9999px"></textarea>
<div id="root" style="max-width:52rem;margin:40px auto"></div>
<script>
window.__clip = null;
window.__pastes = [];
// Which editing commands the door called, and what each input event was:
// "insertFromPaste" is the browser's own paste, "" is insertHTML's,
// "insertText" is insertText's, "synthetic" is the setRangeText fallback.
// Reset by each paste; with the keydown and input times, they say which
// road a paste took and how long the tab was held.
window.__cmds = [];
window.__inputs = [];
window.__t = {};
(function () {
  var exec = document.execCommand;
  document.execCommand = function (c, u, v) {
    var r = exec.call(document, c, u, v);
    window.__cmds.push(r ? c : c + ":refused");
    return r;
  };
})();
document.addEventListener("keydown", function () { window.__t.kd = performance.now(); }, true);
document.addEventListener("input", function (e) {
  window.__t.in = performance.now();
  window.__inputs.push(e instanceof InputEvent ? e.inputType : "synthetic");
}, true);
document.addEventListener("copy", function (e) {
  if (!window.__clip) return;
  e.clipboardData.setData("text/plain", window.__clip.plain);
  if (window.__clip.html != null) e.clipboardData.setData("text/html", window.__clip.html);
  e.preventDefault();
}, true);
// Bubbling, on the document: after React's root listener has run, so this
// records whether the composer's handler took the paste over.
document.addEventListener("paste", function (e) {
  window.__pastes.push({ prevented: e.defaultPrevented, plain: e.clipboardData ? e.clipboardData.getData("text/plain") : null });
});
</script></body></html>`;

const BOX = "#root textarea";
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** What Slack's text/html carries for the same paste: the name in
 *  data-stringify-emoji, a localised alt, the code points in the src. */
function slackHtml(plain: string): string {
  const esc = plain.replace(/&/g, "&amp;").replace(/</g, "&lt;");
  return "<meta charset='utf-8'><div>" + esc
    .split(":white_check_mark:").join('<img data-stringify-type="emoji" data-stringify-emoji=":white_check_mark:" alt=":weißes_häkchen:" src="https://a.slack-edge.com/production-standard-emoji-assets/14.0/apple-medium/2705@2x.png">')
    .split(":x:").join('<img data-stringify-type="emoji" data-stringify-emoji=":x:" alt=":x:" src="https://a.slack-edge.com/production-standard-emoji-assets/14.0/apple-medium/274c@2x.png">')
    .split("\n").join("<br>") + "</div>";
}

async function browserChecks(fixture: string, table: ShortcodeTable): Promise<void> {
  console.log("\n4. The real ChatInput in Chrome, fed by trusted pastes");
  const exe = process.env.CHROME_EXECUTABLE_PATH || "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
  if (!existsSync(exe)) {
    assert(false, `Chrome at ${exe}`, "set CHROME_EXECUTABLE_PATH — the browser section does not skip");
    return;
  }
  const code = await bundle();
  const shot = arg("--screenshot");
  const css = shot ? compileCss() : "";
  const puppeteer: any = (await import("puppeteer-core")).default;
  const browser = await puppeteer.launch({ executablePath: exe, args: ["--no-sandbox", "--disable-dev-shm-usage"], headless: true });

  const open = async (): Promise<any> => {
    const page = await browser.newPage();
    await page.setViewport({ width: 900, height: 700, deviceScaleFactor: 2 });
    await page.setContent(HARNESS(css));
    await page.addScriptTag({ content: code });
    await page.evaluate(() => (window as any).__mount());
    await page.waitForSelector(BOX);
    return page;
  };
  const setClip = async (page: any, plain: string, html: string | null) => {
    await page.evaluate((p: string, h: string | null) => { (window as any).__clip = { plain: p, html: h }; }, plain, html);
    await page.focus("#src");
    await page.evaluate(() => {
      const r = document.createRange(); r.selectNodeContents(document.getElementById("src")!);
      const s = getSelection()!; s.removeAllRanges(); s.addRange(r);
    });
    await page.keyboard.press("KeyC", { commands: ["copy"] });
  };
  /** A trusted paste at the box's current selection. The copy moves focus,
   *  so the selection is put back — and putting it back closes the browser's
   *  typing group, which case F exists to avoid. */
  const paste = async (page: any, plain: string, html: string | null = null, wait = 300) => {
    const sel = await page.evaluate((s: string) => { const el = document.querySelector(s) as HTMLTextAreaElement; return [el.selectionStart, el.selectionEnd]; }, BOX);
    await setClip(page, plain, html);
    await page.focus(BOX);
    await page.evaluate((s: string, a: number, b: number) => { (document.querySelector(s) as HTMLTextAreaElement).setSelectionRange(a, b); }, BOX, sel[0], sel[1]);
    await fresh(page);
    await page.keyboard.press("KeyV", { commands: ["paste"] });
    await sleep(wait);
  };
  const fresh = async (page: any) => page.evaluate(() => { const w = window as any; w.__cmds = []; w.__inputs = []; w.__t = {}; });
  const box = async (page: any) => page.evaluate((s: string) => {
    const el = document.querySelector(s) as HTMLTextAreaElement;
    const w = window as any;
    const p = w.__pastes;
    return {
      value: el.value, start: el.selectionStart, end: el.selectionEnd, last: p.length ? p[p.length - 1] : null, loaded: w.__tableLoaded(),
      cmds: w.__cmds.join(","), inputs: w.__inputs.join(","), ms: w.__t.in && w.__t.kd ? Math.round(w.__t.in - w.__t.kd) : -1,
    };
  }, BOX);
  /** Refuse insertHTML, the way an engine without it would; everything
   *  else goes through. `literal` makes it write the markup AS TEXT instead —
   *  an engine that accepts the command and does the wrong thing with it. */
  const withoutInsertHtml = async (page: any, literal: boolean) => page.evaluate((lit: boolean) => {
    const exec = document.execCommand.bind(document);
    (document as any).execCommand = (c: string, u: boolean, v: string) => {
      if (c !== "insertHTML") return exec(c, u, v);
      (window as any).__cmds.push(lit ? "insertHTML:as-text" : "insertHTML:refused");
      return lit ? exec("insertText", false, v) : false;
    };
  }, literal);
  const select = async (page: any, a: number, b: number) => {
    await page.focus(BOX);
    await page.evaluate((s: string, x: number, y: number) => { (document.querySelector(s) as HTMLTextAreaElement).setSelectionRange(x, y); }, BOX, a, b);
  };
  const undo = async (page: any) => { await page.keyboard.press("KeyZ", { commands: ["undo"] }); await sleep(120); };
  const redo = async (page: any) => { await page.keyboard.press("KeyZ", { commands: ["redo"] }); await sleep(120); };
  const send = async (page: any) => {
    await page.focus(BOX);
    await page.keyboard.press("Enter");
    await sleep(150);
    return page.evaluate(() => { const s = (window as any).__sent; return s.length ? s[s.length - 1] : null; });
  };
  const conv = (s: string) => convertShortcodes(s, table).replace(/\r\n?/g, "\n");

  try {
    // ── A: laziness, the first (async) paste into the middle, undo, redo ────
    {
      const page = await open();
      let st = await box(page);
      assert(st.loaded === false, "the table is not loaded when the composer mounts");
      await paste(page, "nothing shaped like a shortcode here: 10:30");
      st = await box(page);
      assert(st.value === "nothing shaped like a shortcode here: 10:30" && st.last && !st.last.prevented && st.loaded === false,
        "a paste with no candidate is the browser's own — not prevented — and loads nothing", JSON.stringify(st));

      await select(page, 0, st.value.length);
      await page.keyboard.press("Backspace");
      await page.keyboard.type("Status  today");
      await select(page, 7, 7);
      await paste(page, ":white_check_mark: done");
      st = await box(page);
      const want = "Status \u2705 done today";
      assert(st.value === want, "the FIRST candidate paste waits for the table and lands where it was aimed, converted", JSON.stringify(st.value));
      assert(st.start === 7 + "\u2705 done".length && st.end === st.start, "the caret sits straight after the pasted text", `${st.start}-${st.end}`);
      assert(st.loaded === true, "and the table is now loaded");
      assert(st.cmds === "insertHTML" && st.inputs === "", "it went in through insertHTML — one command, no fallback", JSON.stringify({ cmds: st.cmds, inputs: st.inputs }));
      await page.keyboard.type("!");
      st = await box(page);
      assert(st.value === "Status \u2705 done! today", "typing carries on at the caret", JSON.stringify(st.value));
      await undo(page);
      st = await box(page);
      assert(st.value === want, "undo takes back the keystroke alone — it did not merge into the paste", JSON.stringify(st.value));
      await undo(page);
      st = await box(page);
      assert(st.value === "Status  today", "undo again takes back the paste alone — not the typing before it", JSON.stringify(st.value));
      await redo(page);
      st = await box(page);
      assert(st.value === want, "redo puts the converted paste back", JSON.stringify(st.value));

      // The sync path, over a selection.
      await select(page, st.value.indexOf("today"), st.value.indexOf("today") + 5);
      await paste(page, ":thumbsup::skin-tone-2: :x:");
      st = await box(page);
      const want2 = "Status \u2705 done " + fromHex("1F44D-1F3FB") + " \u274C";
      assert(st.value === want2 && st.start === want2.length, "a later paste converts in place over a selection, tone applied, caret after it", JSON.stringify(st));
      await undo(page);
      st = await box(page);
      assert(st.value === want && st.value.slice(st.start, st.end) === "today", "undo restores the replaced selection", JSON.stringify(st));

      await select(page, st.value.length, st.value.length);
      await paste(page, " :party-parrot:");
      st = await box(page);
      assert(st.value === want + " :party-parrot:" && st.last && !st.last.prevented,
        "a paste whose shortcodes are all unknown is left to the browser", JSON.stringify(st));
      await paste(page, " 10:30:00 a:b:c https://x.com/:smile: `:x:`");
      st = await box(page);
      assert(st.value === want + " :party-parrot: 10:30:00 a:b:c https://x.com/:smile: `:x:`" && st.last && !st.last.prevented,
        "so is one whose shortcode-shaped text is a time, a word, a URL and code", JSON.stringify(st));
      const sent = await send(page);
      assert(sent === (want + " :party-parrot: 10:30:00 a:b:c https://x.com/:smile: `:x:`").trim(), "and what ChatInput SENDS is what the box shows", JSON.stringify(sent));
      await page.close();
    }

    // ── B: the incident, as the very first paste, with Slack's two flavours ─
    {
      const page = await open();
      await paste(page, fixture, slackHtml(fixture));
      const st = await box(page);
      const want = conv(fixture);
      assert(st.value === want, "the stored message, pasted with Slack's text/plain AND text/html, is exactly the converted text",
        st.value === want ? "" : firstDiff(st.value, want));
      assert(count(st.value, "\u2705") === 6 && count(st.value, "\u274C") === 1 && st.value.indexOf(":white_check_mark:") < 0,
        "six ✅ and one ❌ in the box, no shortcode left");
      assert(st.start === want.length, "the caret is at the end of the paste", `${st.start}`);
      assert(st.cmds === "insertHTML" && st.inputs === "", "through insertHTML, with no fallback", JSON.stringify({ cmds: st.cmds, inputs: st.inputs }));
      if (shot) {
        // Scrolled to the lines the incident was about, not the box's end.
        await page.evaluate((s: string) => {
          const el = document.querySelector(s) as HTMLTextAreaElement;
          const line = el.value.slice(0, el.value.indexOf("\u2705")).split("\n").length - 1;
          el.scrollTop = Math.max(0, line * parseFloat(getComputedStyle(el).lineHeight || "24") - 8);
        }, BOX);
        await sleep(100);
        const el = await page.$("#root");
        await el.screenshot({ path: shot });
        console.log(`  · screenshot of the composer after the paste: ${shot}`);
      }
      const sent = await send(page);
      assert(sent === want.trim(), "and the message ChatInput sends carries the emoji", sent === want.trim() ? "" : firstDiff(String(sent), want.trim()));
      await paste(page, fixture, slackHtml(fixture));
      await undo(page);
      const after = await box(page);
      assert(after.value === "", "undo of the whole paste leaves the box as it was — empty", JSON.stringify(after.value.slice(0, 40)));
      await page.close();
    }

    // ── C: CRLF — what the browser's own paste would have made of it ────────
    {
      const page = await open();
      const crlf = "Done :white_check_mark:\r\nNot done :x:\rend";
      await setClip(page, crlf, null);
      await page.focus("#probe");
      await page.keyboard.press("KeyV", { commands: ["paste"] });
      const native = await page.$eval("#probe", (e: any) => e.value);
      assert(native === crlf.replace(/\r\n?/g, "\n") && native !== crlf,
        "PRECONDITION: a native paste of this clipboard normalises CRLF and lone CR — the fixture exercises the difference");
      await paste(page, crlf);
      const st = await box(page);
      assert(st.value === "Done \u2705\nNot done \u274C\nend", "a CRLF paste lands with the line breaks the browser's own paste would give", JSON.stringify(st.value));
      assert(st.cmds === "insertHTML" && st.inputs === "",
        "and through insertHTML at the first attempt — the text the door hands it is already what a textarea holds, so the result is what it expects and the undo-losing repair never runs",
        JSON.stringify({ cmds: st.cmds, inputs: st.inputs }));
      await page.close();
    }

    // ── D: every command refused — the fallback still reaches React ────────
    {
      const page = await open();
      await page.focus(BOX);
      await page.keyboard.type("a  b");
      await page.evaluate(() => { (document as any).execCommand = () => false; });
      await select(page, 2, 2);
      await paste(page, ":x:");
      const st = await box(page);
      assert(st.value === "a \u274C b" && st.start === 3, "with every editing command refused, setRangeText does the edit and the caret is right", JSON.stringify(st));
      await paste(page, " one :x:\r\ntwo");
      const st2 = await box(page);
      assert(st2.value === "a \u274C one \u274C\ntwo b", "the fallback gives a CRLF paste the line breaks a native paste would", JSON.stringify(st2.value));
      const sent = await send(page);
      assert(sent === "a \u274C one \u274C\ntwo b", "and the edit reached React's state — it is what is sent", JSON.stringify(sent));
      await page.close();
    }

    // ── E: the chunk fails to load — the paste is never dropped ─────────────
    {
      const page = await open();
      await page.evaluate(() => { (window as any).__failTable = true; });
      await paste(page, "still here :x:");
      let st = await box(page);
      assert(st.value === "still here :x:" && st.loaded === false, "when the table cannot load, the text goes in exactly as pasted", JSON.stringify(st));
      await page.evaluate(() => { (window as any).__failTable = false; });
      await paste(page, " and :x:");
      st = await box(page);
      const loads = await page.evaluate(() => (window as any).__tableLoads);
      assert(st.value === "still here :x: and \u274C" && st.loaded === true && loads === 2,
        "and the next candidate paste tries the load again — a failure is not remembered", JSON.stringify({ value: st.value, loads }));
      await page.close();
    }

    // ── F: typed, then pasted, with nothing in between ──────────────────────
    // Every other case sets the selection before pasting, and setting it
    // closes the browser's typing group on its own. Here the clipboard is
    // filled FIRST, then the user types and pastes straight away — the way
    // hands do it. On the insertHTML road nothing merges with typing; case K
    // drives the same hands on the insertText road, where only the door's own
    // closing of the typing group keeps them apart.
    {
      const page = await open();
      await paste(page, ":x:");
      await setClip(page, " :white_check_mark:", null);
      await page.focus(BOX);
      await page.keyboard.type(" done");
      await fresh(page);
      await page.keyboard.press("KeyV", { commands: ["paste"] });
      await sleep(200);
      let st = await box(page);
      assert(st.value === "\u274C done \u2705" && st.loaded === true && st.cmds === "insertHTML", "typed then pasted: the paste converts in place", JSON.stringify(st));
      await undo(page);
      st = await box(page);
      assert(st.value === "\u274C done", "undo takes back the paste alone — not the words typed just before it", JSON.stringify(st.value));
      await page.close();
    }

    // ── G: a slow chunk, and the box moving while it loads ──────────────────
    {
      const page = await open();
      await page.focus(BOX);
      await page.keyboard.type("abcd");
      await page.evaluate(() => { (window as any).__delayTable = 500; });
      await select(page, 2, 2);
      await paste(page, ":white_check_mark:", null, 60);
      let st = await box(page);
      assert(st.value === "abcd" && st.last && st.last.prevented, "PRECONDITION: while the chunk loads, the paste is held — nothing is in the box yet", JSON.stringify(st));
      await select(page, 0, 0);
      await sleep(700);
      st = await box(page);
      assert(st.value === "ab\u2705cd" && st.start === 3, "the caret moved during the load and the paste still lands where it was aimed", JSON.stringify(st));
      await page.close();
    }
    {
      const page = await open();
      await page.focus(BOX);
      await page.keyboard.type("abcd");
      await page.evaluate(() => { (window as any).__delayTable = 500; });
      await select(page, 2, 2);
      await paste(page, ":x:", null, 60);
      await page.keyboard.type("X");
      await sleep(700);
      const st = await box(page);
      assert(st.value === "abX\u274Ccd" && st.start === 4, "the user typed during the load: the paste lands at the caret, after what they typed", JSON.stringify(st));
      await page.close();
    }

    // ── H: a paste over a selection that already holds what it converts to ──
    // An insert is judged by what the box holds. Judged by whether the box
    // CHANGED, this paste changed nothing, read as refused, and the fallback
    // put the whole of it in a second time.
    {
      const page = await open();
      const want = conv(fixture);
      await paste(page, fixture, slackHtml(fixture));
      let st = await box(page);
      assert(st.value === want, "PRECONDITION: the stored message is in the box, converted");
      await select(page, 0, want.length);
      await paste(page, fixture, slackHtml(fixture));
      st = await box(page);
      assert(st.last && st.last.prevented && st.cmds === "insertHTML", "PRECONDITION: the second paste was the door's, not the browser's", JSON.stringify({ last: st.last && st.last.prevented, cmds: st.cmds }));
      assert(st.value === want && st.start === want.length,
        "the stored message pasted again over a select-all of itself goes in ONCE",
        `${st.value.length} chars and ${count(st.value, "\u2705")} \u2705 — want ${want.length} and 6`);
      const sent = await send(page);
      assert(sent === want.trim(), "and the message sent holds it once", `${String(sent).length} chars, want ${want.trim().length}`);

      await page.keyboard.type("Status ");
      await paste(page, ":x:");
      await select(page, 7, 8);
      await paste(page, ":x:");
      st = await box(page);
      assert(st.value === "Status \u274C" && st.start === 8 && st.end === 8, "a \u274C selected and \":x:\" pasted over it: one \u274C, the caret after it", JSON.stringify(st));

      await select(page, st.value.length, st.value.length);
      await paste(page, " :white_check_mark:\n");
      st = await box(page);
      assert(st.value === "Status \u274C \u2705\n" && st.start === st.value.length && st.end === st.start,
        "a paste ending in a newline leaves the caret after the newline, where the browser's own paste leaves it", JSON.stringify(st));

      const markup = "<b>R&D</b> &amp; <!-- x --> a < b :x:";
      const before = st.value;
      await paste(page, markup);
      st = await box(page);
      assert(st.value === before + markup.replace(":x:", "❌") && st.cmds === "insertHTML" && st.inputs === "",
        "markup in a paste goes in as the characters it is — tags, entities, comments — through insertHTML, not put right afterwards",
        JSON.stringify({ tail: st.value.slice(before.length), cmds: st.cmds, inputs: st.inputs }));
      await page.close();
    }

    // ── I: a timestamped transcript, as the first paste on the page ─────────
    // Every timestamp holds a ":01:"-shaped run. When the gate took any such
    // run as a candidate, this paste was held, the table loaded and the text
    // re-inserted unchanged through insertText — measured on a 2,000-line
    // transcript, 3.8 seconds of frozen tab, where the browser's own paste
    // took 27ms.
    {
      const page = await open();
      const t = transcript(2000);
      assert(/:[a-z0-9_+\-]+:/.test(t), "PRECONDITION: the transcript is full of shortcode-SHAPED text");
      await paste(page, t, null, 800);
      const st = await box(page);
      assert(st.value === t && st.last && !st.last.prevented && st.inputs === "insertFromPaste" && st.cmds === "" && st.loaded === false,
        `a 2,000-line timestamped transcript (${t.length} chars) as the FIRST paste is the browser's own: not held, not re-inserted, the table not loaded — ${st.ms} ms`,
        JSON.stringify({ same: st.value === t, prevented: st.last && st.last.prevented, inputs: st.inputs, cmds: st.cmds, loaded: st.loaded, ms: st.ms }));
      await page.close();
    }

    // ── J: a long Slack paste that DOES convert: no frozen tab ──────────────
    // insertText's cost grows with the square of its lines; this is ~2,100.
    {
      const page = await open();
      let big = "";
      while (big.length < 60000) big += fixture + "\n";
      const want = conv(big);
      const lines = big.split("\n").length;
      await paste(page, big, null, 1500);
      let st = await box(page);
      assert(st.value === want && st.cmds === "insertHTML",
        `the incident's text repeated to ${lines} lines (${big.length} chars), as the FIRST paste, converts exactly, through insertHTML`,
        st.value === want ? JSON.stringify({ cmds: st.cmds }) : firstDiff(st.value, want));
      assert(st.ms >= 0 && st.ms < 250, `…without freezing the tab: ${st.ms} ms from the keypress to the edit (budget 250)`);
      await select(page, want.length, want.length);
      await paste(page, big, null, 1500);
      st = await box(page);
      assert(st.value === want + want && st.cmds === "insertHTML", "a second one, on the synchronous path, converts exactly", st.value === want + want ? "" : firstDiff(st.value, want + want));
      assert(st.ms >= 0 && st.ms < 250, `…in ${st.ms} ms (budget 250)`);
      await undo(page);
      st = await box(page);
      assert(st.value === want, "undo takes the whole of the second paste back, in one step", `${st.value.length} chars, want ${want.length}`);
      const plain = big.split(":white_check_mark:").join("done").split(":x:").join("no");
      await select(page, 0, st.value.length);
      await paste(page, plain, null, 1000);
      st = await box(page);
      console.log(`  · for scale, the browser's own paste of the same text with its shortcodes removed: ${st.ms} ms (${st.inputs})`);
      await page.close();
    }

    // ── K: an engine without insertHTML — the insertText road ───────────────
    // Chrome never takes it, so it is driven by refusing the command. On it,
    // the typing group must be closed on both sides of the paste, and a long
    // paste must not be handed to insertText at all. The HELD paste is driven
    // first, because that is where it shows: measured, with the door's
    // closing removed, the keystroke after a paste inserted from the chunk's
    // promise merged into it, while after one inserted inside the paste event
    // it did not — something of React's closes the group there already (the
    // same masking the round-2 log records for the close BEFORE the insert).
    {
      const page = await open();
      await withoutInsertHtml(page, false);
      await page.focus(BOX);
      await page.keyboard.type("Status  today");
      await select(page, 7, 7);
      await paste(page, ":x:");
      let st = await box(page);
      assert(st.value === "Status \u274C today" && st.cmds === "insertHTML:refused,insertText" && st.inputs === "insertText",
        "PRECONDITION: with insertHTML refused, the first paste goes in through insertText, where it was aimed", JSON.stringify(st));
      await page.keyboard.type("!");
      await undo(page);
      st = await box(page);
      assert(st.value === "Status \u274C today", "undo takes back the keystroke alone — it did not merge into the paste", JSON.stringify(st.value));
      await undo(page);
      st = await box(page);
      assert(st.value === "Status  today", "undo again takes back the paste alone — not the typing before it", JSON.stringify(st.value));

      await select(page, 0, st.value.length);
      await page.keyboard.press("Backspace");
      await setClip(page, " :white_check_mark:", null);
      await page.focus(BOX);
      await page.keyboard.type("done");
      await fresh(page);
      await page.keyboard.press("KeyV", { commands: ["paste"] });
      await sleep(200);
      await page.keyboard.type("!");
      st = await box(page);
      assert(st.value === "done \u2705!" && st.cmds === "insertHTML:refused,insertText", "typed, pasted, typed, with nothing between: the paste converts in place on this road", JSON.stringify(st));
      await undo(page);
      st = await box(page);
      assert(st.value === "done \u2705", "undo takes back the keystroke alone", JSON.stringify(st.value));
      await undo(page);
      st = await box(page);
      assert(st.value === "done", "undo again takes back the paste alone", JSON.stringify(st.value));

      let big = "";
      while (big.length < 60000) big += fixture + "\n";
      await select(page, st.value.length, st.value.length);
      await paste(page, big, null, 1500);
      st = await box(page);
      const want = "done" + conv(big);
      assert(st.value === want && st.cmds === "insertHTML:refused" && st.inputs === "synthetic",
        `a ${big.split("\n").length}-line paste is not handed to insertText: it goes in through setRangeText`,
        st.value === want ? JSON.stringify({ cmds: st.cmds, inputs: st.inputs }) : firstDiff(st.value, want));
      assert(st.ms >= 0 && st.ms < 250, `…in ${st.ms} ms (budget 250)`);
      const sent = await send(page);
      assert(sent === want.trim(), "and it reached React's state — it is what is sent", sent === want.trim() ? "" : firstDiff(String(sent), want.trim()));
      await page.close();
    }

    // ── L: an engine that accepts insertHTML and writes the MARKUP ──────────
    // Not an engine anyone has seen do it; it is how the door behaves when a
    // command does something other than what was asked: the box is put
    // right, never added to.
    {
      const page = await open();
      await withoutInsertHtml(page, true);
      await page.focus(BOX);
      await page.keyboard.type("x ");
      await paste(page, "a & b <c> :x:");
      const st = await box(page);
      assert(st.cmds.indexOf("insertHTML:as-text") === 0, "PRECONDITION: the command wrote the markup as text", JSON.stringify(st.cmds));
      assert(st.value === "x a & b <c> \u274C" && st.start === st.value.length, "the box holds what was pasted, converted — the wrong edit replaced, not added to", JSON.stringify(st));
      const sent = await send(page);
      assert(sent === "x a & b <c> \u274C", "and React holds the corrected text", JSON.stringify(sent));
      await page.close();
    }
  } finally {
    await browser.close();
  }
}

function compileCss(): string {
  const dir = mkdtempSync(join(tmpdir(), "emojipaste-"));
  const out = join(dir, "harness.css");
  try {
    execFileSync("npx", ["tailwindcss", "-c", "tailwind.config.ts", "-i", "app/globals.css", "-o", out],
      { cwd: ROOT, stdio: ["ignore", "ignore", "pipe"] });
    return readFileSync(out, "utf8");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

// ── 6. The build output ──────────────────────────────────────────────────────

function walk(dir: string, out: string[]): void {
  const names = readdirSync(dir);
  for (let i = 0; i < names.length; i++) {
    const p = join(dir, names[i]);
    if (statSync(p).isDirectory()) walk(p, out);
    else if (p.slice(-3) === ".js") out.push(p);
  }
}

async function nextChecks(): Promise<void> {
  console.log("\n6. The build output (.next): where the table and the door went");
  const nextDir = join(ROOT, ".next");
  const manifestPath = join(nextDir, "app-build-manifest.json");
  if (!existsSync(manifestPath)) {
    assert(false, ".next/app-build-manifest.json exists", "run `npx next build` first");
    return;
  }
  const manifest = JSON.parse(readFileSync(manifestPath, "utf8")).pages as { [k: string]: string[] };
  const files: string[] = [];
  walk(join(nextDir, "static/chunks"), files);
  // A name only the table holds, and the door's own pattern.
  const TABLE_MARK = "white_check_mark";
  const DOOR_MARK = "a-z0-9_+\\-]+:";
  const holding: string[] = [];
  for (let i = 0; i < files.length; i++) if (readFileSync(files[i], "utf8").indexOf(TABLE_MARK) >= 0) holding.push(files[i]);
  assert(holding.length === 1, "the table is in exactly one chunk", holding.map((f) => relative(nextDir, f)).join(", "));
  if (holding.length) {
    const b = readFileSync(holding[0]);
    console.log(`  · ${relative(nextDir, holding[0])}: ${b.length} bytes raw, ${gzipSync(b, { level: 9 }).length} gzip, ${brotliCompressSync(b).length} brotli`);
    const escaped = (b.toString("utf8").match(/\\u[dD][89abAB][0-9a-fA-F]{2}/g) || []).length;
    console.log(`  · \\u-escaped surrogates in it: ${escaped} (the minifier writes every astral code point as two)`);
    // The budget, with room: 14.6KB gzip measured for the hex table on
    // 2026-09-28. The literal-emoji table shipped at 15.6KB; a runtime emoji
    // package is several times this.
    const gz = gzipSync(b, { level: 9 }).length;
    assert(gz <= 16000, `the table's chunk is within its budget: ${gz} bytes gzip ≤ 16000`);
  }
  const pages = ["/engineai/page", "/(app)/ai-writer/page", "/(app)/content/[id]/page"];
  for (let p = 0; p < pages.length; p++) {
    const list = manifest[pages[p]];
    if (!list) { assert(false, `${pages[p]} is in the app build manifest`); continue; }
    let table = false, door = false;
    for (let i = 0; i < list.length; i++) {
      const f = join(nextDir, list[i]);
      if (list[i].slice(-3) !== ".js" || !existsSync(f)) continue;
      const s = readFileSync(f, "utf8");
      if (s.indexOf(TABLE_MARK) >= 0) table = true;
      if (s.indexOf(DOOR_MARK) >= 0) door = true;
    }
    assert(!table && door, `${pages[p]}: the door ships with the page, the table does not load up front`, `table in initial chunks: ${table}; door: ${door}`);
  }
}

async function eagerCost(): Promise<void> {
  const esbuild: any = await import("esbuild");
  const res = await esbuild.build({
    entryPoints: [join(ROOT, "lib/emoji/paste.ts")], bundle: true, write: false, minify: true, format: "esm",
    external: ["react", "./shortcode-table"], logLevel: "silent",
  });
  const b = Buffer.from(res.outputFiles[0].text);
  console.log(`  · the door, minified (paste.ts + shortcodes.ts, the table excluded): ${b.length} bytes, ${gzipSync(b, { level: 9 }).length} gzip`);
}

// ── main ─────────────────────────────────────────────────────────────────────

async function pull(): Promise<string> {
  const env: { [k: string]: string } = {};
  // The service key is read here and never printed. ENV_FILE points at
  // another tree's .env.local when this runs from a scratch copy.
  const raw = readFileSync(process.env.ENV_FILE || join(ROOT, ".env.local"), "utf8").split("\n");
  for (let i = 0; i < raw.length; i++) {
    const at = raw[i].indexOf("=");
    if (at < 0 || raw[i].trim().charAt(0) === "#") continue;
    env[raw[i].slice(0, at).trim()] = raw[i].slice(at + 1).trim().replace(/^["']|["']$/g, "");
  }
  const url = env.NEXT_PUBLIC_SUPABASE_URL, key = env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error(".env.local carries no Supabase URL and key");
  const r = await fetch(`${url}/rest/v1/ai_messages?id_conversation=eq.${THREAD}&role_message=eq.user&select=document_message&order=date_created.asc&limit=1`,
    { headers: { apikey: key, Authorization: `Bearer ${key}`, "Accept-Profile": "intelligence" } });
  const rows = await r.json();
  if (!Array.isArray(rows) || !rows.length) throw new Error(`the pull failed: ${JSON.stringify(rows).slice(0, 200)}`);
  return rows[0].document_message;
}

async function main() {
  const fixture = readFileSync(FIXTURE, "utf8");
  const table = parseShortcodeTable(SHORTCODE_TABLE);

  if (flag("--self-test")) {
    // Two converters that are WRONG in the two directions this check exists
    // for. The assertions must reject both, or they prove nothing.
    console.log("\nSelf-test: the pure assertions against deliberately wrong converters");
    const naive: Convert = (s) => s.replace(/:([a-z0-9_+\-]+):/g, (m, n) => (table.has(n) ? table.get(n)!.emoji : m));
    const none: Convert = (s) => s;
    const noTone: Convert = (s) => convertShortcodes(s.replace(/::skin-tone-[2-6]:/g, ""), table);
    const bads: Array<[string, Convert]> = [["a naive global replace", naive], ["no conversion at all", none], ["skin tones dropped", noTone]];
    for (let i = 0; i < bads.length; i++) {
      const n = pureChecks(bads[i][1], fixture, false);
      assert(n > 0, `${bads[i][0]} is rejected (${n} assertion(s) fail)`);
    }
    assert(pureChecks((s) => convertShortcodes(s, table), fixture, false) === 0, "and the real converter passes every one");
    console.log(failures ? `\n✗ ${failures} self-test failure(s)\n` : "\n✓ self-test passed\n");
    process.exit(failures ? 1 : 0);
  }

  if (flag("--pull")) {
    console.log("\n0. The fixture against the stored message (READ-ONLY)");
    const stored = await pull();
    // The fixture is the stored message with its colleague and client names
    // replaced, so no client's name is committed. What must still match is what
    // this check is about: the same shortcodes in the same order, on the same
    // number of lines.
    const codes = (x: string) => (x.match(/:[a-z0-9_+\-]+:/g) || []).join(" ");
    const lines = (x: string) => x.split("\n").length;
    assert(codes(stored) === codes(fixture) && lines(stored) === lines(fixture),
      `scripts/fixtures/slack-paste-weekly-status.txt carries thread ${THREAD.slice(0, 8)}'s shortcodes in order, on the same ${lines(stored)} lines`,
      `stored: ${codes(stored)} (${lines(stored)} lines) · fixture: ${codes(fixture)} (${lines(fixture)} lines)`);
  }

  tableChecks(table);

  console.log("\n2. The stored message through convertShortcodes");
  assert(count(fixture, ":white_check_mark:") === 6 && count(fixture, ":x:") === 1 && hasShortcodeCandidate(fixture),
    "PRECONDITION: the fixture holds the incident — six :white_check_mark:, one :x:");
  pureChecks((s) => convertShortcodes(s, table), fixture, true);
  gateChecks();

  await browserChecks(fixture, table);
  wiringChecks();

  if (flag("--next")) {
    await nextChecks();
    await eagerCost();
  }

  console.log(failures ? `\n✗ ${failures} failure(s)\n` : "\n✓ All checks passed\n");
  process.exit(failures ? 1 : 0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
